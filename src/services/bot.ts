import { metaApiClient, MarketDataSubscription } from '../lib/metaapi/client';
import { prisma } from '../lib/db';
import {
  Candle,
  Signal,
  Trade,
  Position,
  BotConfig,
  DEFAULT_BOT_CONFIG,
  Timeframe,
  StrategyType,
  TIMEFRAME_MAP,
} from '../lib/types';
import { performMTFAnalysis } from '../lib/analysis/multi-timeframe';
import { runAllStrategies, StrategyContext } from '../lib/strategies';
import { calculatePositionSize } from '../lib/risk/position-sizing';
import { tradeManager } from '../lib/risk/trade-manager';
import { analysisStore } from './analysis-store';
import { v4 as uuidv4 } from 'uuid';
import {
  TradingBotSyncListener,
  SymbolPrice,
  CandleUpdate,
  PositionUpdate,
} from '../lib/metaapi/sync-listener';
import {
  getSymbolTimeframes,
  DEFAULT_LIVE_CONFIG,
} from '../lib/strategies/strategy-profiles';

/**
 * Trading Bot Orchestrator
 * Main service that coordinates all bot operations
 */

export class TradingBot {
  private static instance: TradingBot;
  private isRunning = false;
  private config: BotConfig;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastAnalysisTime: Map<string, number> = new Map();
  private syncListener: TradingBotSyncListener | null = null;
  private latestPrices: Map<string, SymbolPrice> = new Map();
  private candleBuffers: Map<string, Map<string, Candle[]>> = new Map(); // symbol -> timeframe -> candles

  private constructor(config?: Partial<BotConfig>) {
    this.config = { ...DEFAULT_BOT_CONFIG, ...config };
  }

  static getInstance(config?: Partial<BotConfig>): TradingBot {
    if (!TradingBot.instance) {
      TradingBot.instance = new TradingBot(config);
    }
    return TradingBot.instance;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Bot is already running');
      return;
    }

    console.log('Starting trading bot (event-driven mode)...');

    try {
      // Connect to MetaAPI
      await metaApiClient.connect();

      // Set up event-driven listener
      await this.setupEventListener();

      // Subscribe to market data for all symbols
      await this.subscribeToMarketData();

      // Update bot state
      await this.updateBotState(true);

      this.isRunning = true;

      // Start heartbeat for maintenance tasks only (not for data fetching)
      this.startHeartbeat();

      console.log('Trading bot started successfully (event-driven)');
    } catch (error) {
      console.error('Failed to start trading bot:', error);
      throw error;
    }
  }

  /**
   * Set up the synchronization listener for real-time events
   */
  private async setupEventListener(): Promise<void> {
    this.syncListener = new TradingBotSyncListener({
      onPriceUpdate: (symbol, price) => this.handlePriceUpdate(symbol, price),
      onCandleUpdate: (candles) => this.handleCandleUpdate(candles),
      onPositionUpdate: (positions, removedIds) => this.handlePositionUpdate(positions, removedIds),
      onConnected: () => console.log('[Bot] MetaAPI connected'),
      onDisconnected: () => console.log('[Bot] MetaAPI disconnected'),
      onRateLimitWarning: (symbol, message) => console.warn(`[Bot] Rate limit warning: ${symbol} - ${message}`),
    });

    metaApiClient.addSynchronizationListener(this.syncListener);
    console.log('[Bot] Event listener set up');
  }

  /**
   * Subscribe to market data for all configured symbols
   * Uses symbol-specific LTF timeframes based on Jan 2026 optimization
   */
  private async subscribeToMarketData(): Promise<void> {
    for (const symbol of this.config.symbols) {
      // Get symbol-specific LTF timeframe
      const symbolTf = getSymbolTimeframes(DEFAULT_LIVE_CONFIG, symbol);
      const ltfMetaApi = TIMEFRAME_MAP[symbolTf.ltf];

      const subscriptions: MarketDataSubscription[] = [
        { type: 'quotes', intervalInMilliseconds: 5000 },
        { type: 'candles', timeframe: ltfMetaApi, intervalInMilliseconds: 10000 },
      ];

      try {
        await metaApiClient.subscribeToMarketData(symbol, subscriptions);
        console.log(`[Bot] Subscribed to market data for ${symbol} (LTF: ${symbolTf.ltf})`);
      } catch (error) {
        console.error(`[Bot] Failed to subscribe to ${symbol}:`, error);
      }
    }
  }

  /**
   * Handle real-time price updates (pushed from MetaAPI)
   */
  private handlePriceUpdate(symbol: string, price: SymbolPrice): void {
    // Store the latest price
    this.latestPrices.set(symbol, price);

    // Update analysis store with current price for UI
    const analysis = analysisStore.get(symbol);
    if (analysis) {
      const currentPrice = (price.bid + price.ask) / 2;
      analysisStore.set(symbol, analysis.analysis, currentPrice);
    }
  }

  /**
   * Handle candle updates (pushed from MetaAPI when candles complete)
   * Uses symbol-specific LTF timeframes for triggering analysis
   */
  private async handleCandleUpdate(candles: CandleUpdate[]): Promise<void> {
    for (const candle of candles) {
      // Only process candles for our configured symbols
      if (!this.config.symbols.includes(candle.symbol)) continue;

      console.log(`[Bot] Candle update: ${candle.symbol} ${candle.timeframe} @ ${candle.time.toISOString()}`);

      // Get symbol-specific LTF timeframe
      const symbolTf = getSymbolTimeframes(DEFAULT_LIVE_CONFIG, candle.symbol);
      const ltfMetaApi = TIMEFRAME_MAP[symbolTf.ltf];

      // Trigger analysis when we get a new candle on this symbol's LTF
      if (candle.timeframe === ltfMetaApi) {
        // Rate limit analysis to avoid overwhelming
        const lastTime = this.lastAnalysisTime.get(candle.symbol) || 0;
        if (Date.now() - lastTime < 10000) continue; // Min 10 seconds between analyses

        this.lastAnalysisTime.set(candle.symbol, Date.now());
        await this.analyzeSymbol(candle.symbol);
      }
    }
  }

  /**
   * Handle position updates (pushed from MetaAPI)
   */
  private async handlePositionUpdate(positions: PositionUpdate[], removedIds: string[]): Promise<void> {
    console.log(`[Bot] Position update: ${positions.length} positions, ${removedIds.length} removed`);

    // Convert to our Position format and sync with trade manager
    const convertedPositions: Position[] = positions.map((pos) => ({
      id: pos.id,
      symbol: pos.symbol,
      type: pos.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL',
      volume: pos.volume,
      openPrice: pos.openPrice,
      currentPrice: pos.currentPrice || pos.openPrice,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      profit: pos.profit || 0,
      swap: pos.swap || 0,
      openTime: pos.time,
    }));

    await tradeManager.syncWithBrokerPositions(convertedPositions);
  }

  /**
   * Start heartbeat for maintenance tasks (signal expiration, health checks)
   * This runs less frequently since data is pushed to us
   */
  private startHeartbeat(): void {
    // Heartbeat every 60 seconds for maintenance tasks
    this.heartbeatInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        await this.updateBotState(true);

        // Expire old signals
        await tradeManager.expireOldSignals();

        // Log status
        console.log(`[Bot] Heartbeat - Prices: ${this.latestPrices.size}, Symbols: ${this.config.symbols.length}`);

      } catch (error) {
        console.error('[Bot] Heartbeat error:', error);
      }
    }, 60000);

    // Also run initial analysis for all symbols
    this.analyzeAllSymbols();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('Bot is not running');
      return;
    }

    console.log('Stopping trading bot...');

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Unsubscribe from market data
    for (const symbol of this.config.symbols) {
      try {
        await metaApiClient.unsubscribeFromMarketData(symbol);
      } catch (error) {
        console.error(`Failed to unsubscribe from ${symbol}:`, error);
      }
    }

    // Remove synchronization listener
    if (this.syncListener) {
      metaApiClient.removeSynchronizationListener(this.syncListener);
      this.syncListener = null;
    }

    // Clear local state
    this.latestPrices.clear();
    this.candleBuffers.clear();

    await this.updateBotState(false);

    this.isRunning = false;

    console.log('Trading bot stopped');
  }

  private async updateBotState(isRunning: boolean): Promise<void> {
    await prisma.botState.upsert({
      where: { id: 'singleton' },
      update: {
        isRunning,
        lastHeartbeat: new Date(),
        activeSymbols: this.config.symbols.join(','),
        config: JSON.stringify(this.config),
      },
      create: {
        id: 'singleton',
        isRunning,
        lastHeartbeat: new Date(),
        activeSymbols: this.config.symbols.join(','),
        config: JSON.stringify(this.config),
      },
    });
  }

  private async analyzeAllSymbols(): Promise<void> {
    for (const symbol of this.config.symbols) {
      await this.analyzeSymbol(symbol);
    }
  }

  private async analyzeSymbol(symbol: string): Promise<void> {
    try {
      // Rate limit analysis per symbol (minimum 30 seconds between analysis)
      const lastTime = this.lastAnalysisTime.get(symbol) || 0;
      if (Date.now() - lastTime < 30000) {
        return;
      }
      this.lastAnalysisTime.set(symbol, Date.now());

      console.log(`[Bot] Analyzing ${symbol}...`);

      // Get symbol-specific timeframes (based on Jan 2026 optimization)
      // Falls back to config defaults if symbol not in SYMBOL_TIMEFRAMES
      const symbolTf = getSymbolTimeframes(DEFAULT_LIVE_CONFIG, symbol);
      const htfTimeframe = symbolTf.htf;
      const mtfTimeframe = symbolTf.mtf;
      const ltfTimeframe = symbolTf.ltf;

      // Fetch candle data for all timeframes
      // These calls read from terminalState which is kept in sync by the streaming connection
      const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
        metaApiClient.getCandles(symbol, htfTimeframe, 200),
        metaApiClient.getCandles(symbol, mtfTimeframe, 300),
        metaApiClient.getCandles(symbol, ltfTimeframe, 200),
      ]);

      if (!htfCandles.length || !mtfCandles.length || !ltfCandles.length) {
        console.log(`[Bot] Insufficient data for ${symbol}`);
        return;
      }

      // Get current price - prefer cached price from streaming, fall back to API
      let price: { bid: number; ask: number };
      const cachedPrice = this.latestPrices.get(symbol);
      if (cachedPrice) {
        price = { bid: cachedPrice.bid, ask: cachedPrice.ask };
      } else {
        price = await metaApiClient.getCurrentPrice(symbol);
      }

      // Perform MTF analysis
      const analysis = performMTFAnalysis(
        {
          htfCandles,
          mtfCandles,
          ltfCandles,
        },
        symbol,
        htfTimeframe,
        mtfTimeframe,
        ltfTimeframe
      );

      console.log(`[Bot] ${symbol} Analysis - HTF Bias: ${analysis.htf.bias}, MTF Bias: ${analysis.mtf.bias}, Confluence: ${analysis.confluenceScore}`);

      // Store analysis result for UI display
      const currentPrice = (price.bid + price.ask) / 2;
      analysisStore.set(symbol, analysis, currentPrice);

      // Create strategy context
      const context: StrategyContext = {
        symbol,
        currentPrice: (price.bid + price.ask) / 2,
        bid: price.bid,
        ask: price.ask,
        analysis,
        htfCandles,
        mtfCandles,
        ltfCandles,
      };

      // Run all enabled strategies
      const signal = runAllStrategies(context, this.config.strategies);

      if (signal) {
        console.log(`[Bot] Signal generated for ${symbol}: ${signal.direction} via ${signal.strategy}`);
        await this.processSignal(signal, price.bid, price.ask);
      }

    } catch (error) {
      console.error(`[Bot] Error analyzing ${symbol}:`, error);
    }
  }

  private async processSignal(
    signal: Signal,
    bid: number,
    ask: number
  ): Promise<void> {
    try {
      // Record the signal
      await tradeManager.recordSignal(signal);

      // Get current positions
      const positions = await metaApiClient.getPositions();

      // Check if we can open a trade
      const canOpen = await tradeManager.canOpenTrade(
        signal.symbol,
        signal.direction,
        positions
      );

      if (!canOpen.canOpen) {
        console.log(`Signal rejected: ${canOpen.reason}`);
        await tradeManager.updateSignalStatus(signal.id, 'REJECTED', canOpen.reason);
        return;
      }

      // Get account info for position sizing
      const accountInfo = await metaApiClient.getAccountInfo();
      const symbolInfo = await metaApiClient.getSymbolInfo(signal.symbol);

      // Calculate position size
      const positionInfo = calculatePositionSize(
        accountInfo.balance,
        this.config.riskPercent,
        signal.entryPrice,
        signal.stopLoss,
        symbolInfo
      );

      console.log(`Position size calculated: ${positionInfo.lotSize} lots, Risk: $${positionInfo.riskAmount.toFixed(2)}`);

      // Execute the trade
      const orderResult = await metaApiClient.placeMarketOrder(
        signal.symbol,
        signal.direction,
        positionInfo.lotSize,
        signal.stopLoss,
        signal.takeProfit,
        `SMC ${signal.strategy}`
      );

      console.log(`Order placed: ${orderResult.orderId}`);

      // Record the trade
      const trade: Omit<Trade, 'id'> = {
        signalId: signal.id,
        symbol: signal.symbol,
        direction: signal.direction,
        strategy: signal.strategy,
        entryPrice: signal.direction === 'BUY' ? ask : bid,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        lotSize: positionInfo.lotSize,
        openTime: new Date(),
        status: 'OPEN',
        mt5OrderId: orderResult.orderId,
        mt5PositionId: orderResult.positionId,
        riskAmount: positionInfo.riskAmount,
        riskRewardRatio: Math.abs(signal.takeProfit - signal.entryPrice) /
                         Math.abs(signal.entryPrice - signal.stopLoss),
      };

      await tradeManager.recordTrade(trade);
      await tradeManager.updateSignalStatus(signal.id, 'TAKEN');

      // Record account snapshot
      await prisma.accountSnapshot.create({
        data: {
          balance: accountInfo.balance,
          equity: accountInfo.equity,
          margin: accountInfo.margin,
          freeMargin: accountInfo.freeMargin,
          openPnl: positions.reduce((sum, p) => sum + p.profit, 0),
        },
      });

    } catch (error) {
      console.error('Error processing signal:', error);
      await tradeManager.updateSignalStatus(
        signal.id,
        'REJECTED',
        `Execution error: ${error}`
      );
    }
  }

  getStatus(): {
    isRunning: boolean;
    config: BotConfig;
    symbols: string[];
  } {
    return {
      isRunning: this.isRunning,
      config: this.config,
      symbols: this.config.symbols,
    };
  }

  updateConfig(config: Partial<BotConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async getAccountInfo() {
    return metaApiClient.getAccountInfo();
  }

  async getPositions() {
    return metaApiClient.getPositions();
  }
}

// Export singleton instance
export const tradingBot = TradingBot.getInstance();
