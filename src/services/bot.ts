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
  BreakevenConfig,
  TieredTPConfig,
  TIERED_TP_PROFILES,
} from '../lib/types';
import { performMTFAnalysis } from '../lib/analysis/multi-timeframe';
import { runAllStrategies, StrategyContext } from '../lib/strategies';
import { calculatePositionSize } from '../lib/risk/position-sizing';
import { tradeManager } from '../lib/risk/trade-manager';
import { BreakevenManager } from '../lib/risk/breakeven-manager';
import { TieredTPManager } from '../lib/risk/tiered-tp-manager';
import { analysisStore } from './analysis-store';
import { telegramNotifier } from './telegram';
import { analysisScheduler } from './analysis-scheduler';
import { telegramListener } from './telegram-listener';
import { telegramSignalAnalyzer } from './telegram-signal-analyzer';
import { telegramTradeExecutor } from './telegram-trade-executor';
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
  SYMBOL_TRADING_LIMITS,
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
  private lastKnownPositions: Map<string, PositionUpdate> = new Map(); // positionId -> last known state
  private breakevenManager: BreakevenManager;
  private tieredTPManager: TieredTPManager;

  private constructor(config?: Partial<BotConfig>) {
    this.config = { ...DEFAULT_BOT_CONFIG, ...config };
    // Initialize breakeven manager with config
    const beConfig: BreakevenConfig = this.config.breakeven || {
      enabled: true,
      triggerR: 1.0,
      bufferPips: 5,
    };
    this.breakevenManager = new BreakevenManager(beConfig);

    // Initialize tiered TP manager with config
    const tieredConfig: TieredTPConfig = this.config.tieredTP || TIERED_TP_PROFILES['RUNNER'];
    this.tieredTPManager = new TieredTPManager(tieredConfig);
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

    // Initialize Telegram notifications
    telegramNotifier.initialize();

    // Start market analysis scheduler
    analysisScheduler.start();

    // Pre-initialize Telegram services so they're ready when user starts from dashboard
    try {
      telegramListener.initialize();
      telegramSignalAnalyzer.initialize();
      telegramTradeExecutor.initialize();
      console.log('[Bot] Telegram services initialized (listener off by default — start from dashboard)');
    } catch (listenerError) {
      console.error('[Bot] Telegram listener init failed (non-blocking):', listenerError);
    }

    try {
      // Connect to MetaAPI
      await metaApiClient.connect();

      // Sync historical trades from MT5 to ensure all past trades are known
      await this.syncHistoricalTradesOnStartup();

      // Sync open positions with MT5 on startup
      await this.syncPositionsOnStartup();

      // Set up event-driven listener
      await this.setupEventListener();

      // Subscribe to market data for all symbols
      await this.subscribeToMarketData();

      // Update bot state (forceStartedAt=true since bot is actually starting)
      await this.updateBotState(true, true);

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
   * Sync historical trades from MT5 on startup
   * Fetches closed deals from MT5 and imports them into the database
   * This ensures all past trades are known locally
   */
  private async syncHistoricalTradesOnStartup(): Promise<void> {
    console.log('[Bot] Syncing historical trades from MT5...');

    try {
      // Fetch deals from the last 30 days by default
      const endTime = new Date();
      const startTime = new Date();
      startTime.setDate(startTime.getDate() - 30);

      const deals = await metaApiClient.getHistoricalDeals(startTime, endTime);
      console.log(`[Bot] Found ${deals.length} historical deals from MT5`);

      if (deals.length > 0) {
        const result = await tradeManager.syncHistoricalTrades(deals);
        if (result.imported > 0) {
          console.log(`[Bot] Historical trades sync complete: ${result.imported} imported, ${result.skipped} skipped`);
        } else {
          console.log('[Bot] Historical trades sync complete: No new trades to import');
        }
      }
    } catch (error) {
      console.error('[Bot] Error syncing historical trades:', error);
      // Don't throw - allow bot to start even if historical sync fails
    }
  }

  /**
   * Sync positions with MT5 on startup
   * Imports any open positions from MT5 that don't exist in DB
   * Marks any DB trades as closed if they no longer exist on MT5
   */
  private async syncPositionsOnStartup(): Promise<void> {
    console.log('[Bot] Syncing positions with MT5...');

    try {
      // Get current positions from MT5 (already converted to our Position type)
      const positions = await metaApiClient.getPositions();
      console.log(`[Bot] Found ${positions.length} open positions on MT5`);

      // Sync with trade manager
      const result = await tradeManager.syncWithBrokerPositions(positions);

      if (result.imported > 0 || result.closed > 0) {
        console.log(`[Bot] Sync complete: ${result.imported} positions imported, ${result.closed} trades marked as closed`);
      } else {
        console.log('[Bot] Sync complete: No changes needed');
      }

      // Store initial position state for tracking (convert to PositionUpdate format for lastKnownPositions)
      const positionUpdates: PositionUpdate[] = [];
      for (const pos of positions) {
        const posUpdate: PositionUpdate = {
          id: pos.id,
          symbol: pos.symbol,
          type: pos.type === 'BUY' ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL',
          volume: pos.volume,
          openPrice: pos.openPrice,
          currentPrice: pos.currentPrice,
          stopLoss: pos.stopLoss,
          takeProfit: pos.takeProfit,
          profit: pos.profit,
          swap: pos.swap,
          time: pos.openTime,
          comment: pos.comment,
        };
        this.lastKnownPositions.set(pos.id, posUpdate);
        positionUpdates.push(posUpdate);
      }

      // Initialize breakeven manager with current positions
      if (this.breakevenManager.isEnabled()) {
        await this.breakevenManager.initializeFromPositions(positionUpdates);
        console.log(`[Bot] Breakeven manager initialized`);
      }

      // Initialize tiered TP manager with current positions
      if (this.tieredTPManager.isEnabled()) {
        for (const pos of positionUpdates) {
          // Get the trade from DB to find entry details
          const trade = await prisma.trade.findFirst({
            where: { mt5PositionId: pos.id },
          });
          if (trade) {
            await this.tieredTPManager.initializePosition(
              pos.id,
              pos.symbol,
              pos.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL',
              trade.entryPrice,
              trade.stopLoss,
              pos.volume
            );
          }
        }
        console.log(`[Bot] Tiered TP manager initialized`);
      }

    } catch (error) {
      console.error('[Bot] Error syncing positions on startup:', error);
      // Don't throw - allow bot to start even if sync fails
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
   * Tracks position state and handles closures with proper PnL
   */
  private async handlePositionUpdate(positions: PositionUpdate[], removedIds: string[]): Promise<void> {
    console.log(`[Bot] Position update: ${positions.length} positions, ${removedIds.length} removed`);

    // Update last known state for all current positions
    for (const pos of positions) {
      this.lastKnownPositions.set(pos.id, pos);
    }

    // Handle removed positions (closed trades)
    for (const removedId of removedIds) {
      const lastKnown = this.lastKnownPositions.get(removedId);
      if (lastKnown) {
        console.log(`[Bot] Position ${removedId} closed: ${lastKnown.symbol} @ ${lastKnown.currentPrice}, Profit: $${lastKnown.profit?.toFixed(2) || 'N/A'}`);

        // Close the trade with the last known price and profit
        if (lastKnown.currentPrice && lastKnown.profit !== undefined) {
          await tradeManager.closeTradeFromBroker(
            removedId,
            lastKnown.currentPrice,
            lastKnown.profit,
            new Date()
          );
        }

        // Clean up breakeven tracking
        this.breakevenManager.onPositionClosed(removedId);

        // Clean up tiered TP tracking
        this.tieredTPManager.onPositionClosed(removedId);

        // Send Telegram notification for closed trade
        if (telegramNotifier.isEnabled()) {
          const openPositions = positions.map(p => ({
            symbol: p.symbol,
            direction: p.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL',
            entryPrice: p.openPrice,
            currentPrice: p.currentPrice ?? p.openPrice,
            profit: p.profit ?? 0,
            lotSize: p.volume,
          }));
          await telegramNotifier.notifyTradeClosed(
            {
              symbol: lastKnown.symbol,
              direction: lastKnown.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL',
              entryPrice: lastKnown.openPrice,
              exitPrice: lastKnown.currentPrice!,
              profit: lastKnown.profit!,
              lotSize: lastKnown.volume,
            },
            openPositions
          );
        }

        // Remove from tracking
        this.lastKnownPositions.delete(removedId);
      } else {
        console.log(`[Bot] Position ${removedId} removed but no last known state`);
      }
    }

    // Check breakeven for all current positions (only if tiered TP is disabled)
    // Tiered TP handles its own BE management, so don't run both
    if (this.breakevenManager.isEnabled() && !this.tieredTPManager.isEnabled()) {
      for (const pos of positions) {
        const result = await this.breakevenManager.checkAndMoveToBreakeven(pos);
        if (result.moved) {
          console.log(`[Bot] ${pos.symbol} moved to breakeven: ${result.reason}`);
        }
      }
    }

    // Check tiered take-profits for all current positions
    if (this.tieredTPManager.isEnabled()) {
      for (const pos of positions) {
        const result = await this.tieredTPManager.checkAndExecuteTieredTP(pos);
        if (result.tpHit) {
          console.log(`[Bot] ${pos.symbol} tiered TP executed: ${result.tpHit} - ${result.reason}`);
        }
      }
    }

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
      comment: pos.comment,
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

    // Stop market analysis scheduler
    analysisScheduler.stop();

    // NOTE: Telegram listener is NOT stopped here — it's independently managed
    // via the /api/telegram-listener route and dashboard controls.

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
    this.lastKnownPositions.clear();

    await this.updateBotState(false);

    this.isRunning = false;

    console.log('Trading bot stopped');
  }

  private async updateBotState(isRunning: boolean, forceStartedAt: boolean = false): Promise<void> {
    const now = new Date();

    // Only update startedAt when bot starts (forceStartedAt) or stops
    // Don't reset it on every heartbeat
    const updateData: any = {
      isRunning,
      lastHeartbeat: now,
      activeSymbols: this.config.symbols.join(','),
      config: JSON.stringify(this.config),
    };

    // Only set startedAt when explicitly starting or stopping
    if (forceStartedAt || !isRunning) {
      updateData.startedAt = isRunning ? now : null;
    }

    await prisma.botState.upsert({
      where: { id: 'singleton' },
      update: updateData,
      create: {
        id: 'singleton',
        isRunning,
        startedAt: isRunning ? now : null,
        lastHeartbeat: now,
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

      // Validate minimum stop loss distance (prevents being stopped by spread/noise)
      const tradingLimits = SYMBOL_TRADING_LIMITS[signal.symbol];
      if (tradingLimits) {
        const slDistance = Math.abs(signal.entryPrice - signal.stopLoss);
        const slPips = slDistance / symbolInfo.pipSize;
        if (slPips < tradingLimits.minSlPips) {
          const reason = `SL too close: ${slPips.toFixed(1)} pips < ${tradingLimits.minSlPips} min`;
          console.log(`Signal rejected: ${reason}`);
          await tradeManager.updateSignalStatus(signal.id, 'REJECTED', reason);
          return;
        }
      }

      // Calculate position size
      const positionInfo = calculatePositionSize(
        accountInfo.balance,
        this.config.riskPercent,
        signal.entryPrice,
        signal.stopLoss,
        symbolInfo
      );

      console.log(`Position size calculated: ${positionInfo.lotSize} lots, Risk: $${positionInfo.riskAmount.toFixed(2)}`);

      // Reject if SL is too wide to size properly (would exceed intended risk)
      if (positionInfo.wasClampedToMin) {
        const actualRisk = positionInfo.lotSize * positionInfo.pipRisk * positionInfo.pipValue;
        const reason = `SL too wide: min lot ${symbolInfo.minVolume} would risk $${actualRisk.toFixed(2)} vs intended $${positionInfo.riskAmount.toFixed(2)}`;
        console.log(`Signal rejected: ${reason}`);
        await tradeManager.updateSignalStatus(signal.id, 'REJECTED', reason);
        return;
      }

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

      // Initialize tiered TP tracking for this position
      if (this.tieredTPManager.isEnabled() && orderResult.positionId) {
        await this.tieredTPManager.initializePosition(
          orderResult.positionId,
          signal.symbol,
          signal.direction,
          trade.entryPrice,
          signal.stopLoss,
          positionInfo.lotSize
        );
        console.log(`[Bot] Tiered TP initialized for position ${orderResult.positionId}`);
      }

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

      // Send Telegram notification
      if (telegramNotifier.isEnabled()) {
        const openPositions = positions.map(p => ({
          symbol: p.symbol,
          direction: p.type === 'BUY' ? 'BUY' : 'SELL',
          entryPrice: p.openPrice,
          currentPrice: p.currentPrice,
          profit: p.profit,
          lotSize: p.volume,
        }));
        await telegramNotifier.notifyTradeOpened(
          {
            symbol: trade.symbol,
            direction: trade.direction,
            strategy: trade.strategy,
            entryPrice: trade.entryPrice,
            stopLoss: trade.stopLoss,
            takeProfit: trade.takeProfit,
            lotSize: trade.lotSize,
            riskAmount: trade.riskAmount,
            riskRewardRatio: trade.riskRewardRatio,
          },
          openPositions
        );
      }

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
    telegramListener: { enabled: boolean; listening: boolean };
  } {
    return {
      isRunning: this.isRunning,
      config: this.config,
      symbols: this.config.symbols,
      telegramListener: {
        enabled: telegramListener.isEnabled(),
        listening: telegramListener.isListening(),
      },
    };
  }

  updateConfig(config: Partial<BotConfig>): void {
    this.config = { ...this.config, ...config };
    // Update breakeven manager if config changed
    if (config.breakeven) {
      this.breakevenManager.updateConfig(config.breakeven);
    }
    // Update tiered TP manager if config changed
    if (config.tieredTP) {
      this.tieredTPManager.updateConfig(config.tieredTP);
    }
  }

  async getAccountInfo() {
    return metaApiClient.getAccountInfo();
  }

  async getPositions(): Promise<Position[]> {
    // Use lastKnownPositions for real-time profit updates from streaming connection
    // Falls back to MetaAPI terminalState if no streaming data available
    if (this.lastKnownPositions.size > 0) {
      return Array.from(this.lastKnownPositions.values()).map((pos) => ({
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
        comment: pos.comment,
      }));
    }
    return metaApiClient.getPositions();
  }
}

// Export singleton instance
export const tradingBot = TradingBot.getInstance();
