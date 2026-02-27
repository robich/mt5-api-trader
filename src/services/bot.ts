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
import { telegramTPMonitor } from './telegram-tp-monitor';
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
  private notifiedClosePositions: Set<string> = new Set(); // dedup close notifications
  private breakevenManager: BreakevenManager;
  private tieredTPManager: TieredTPManager;
  private heartbeatCount = 0;
  private pauseStateCache: { isPaused: boolean; reason: string | null; checkedAt: number } = {
    isPaused: false,
    reason: null,
    checkedAt: 0,
  };

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

    // Restore persisted config from DB (preserves autoTrading toggle etc. across deploys)
    try {
      const savedState = await prisma.botState.findUnique({ where: { id: 'singleton' } });
      if (savedState?.config) {
        const savedConfig = JSON.parse(savedState.config);
        // Restore specific runtime settings, keep structural defaults
        if (savedConfig.autoTrading !== undefined) {
          this.config.autoTrading = savedConfig.autoTrading;
          console.log(`[Bot] Restored autoTrading=${this.config.autoTrading} from DB`);
        }
      }
    } catch (err) {
      console.error('[Bot] Failed to restore config from DB:', err);
    }

    // Initialize Telegram notifications
    telegramNotifier.initialize();

    // Start market analysis scheduler
    analysisScheduler.start();

    // Pre-initialize Telegram services (auto-start handled by server.mjs independently)
    try {
      telegramListener.initialize();
      telegramSignalAnalyzer.initialize();
      telegramTradeExecutor.initialize();
      console.log('[Bot] Telegram services initialized');
    } catch (listenerError) {
      console.error('[Bot] Telegram listener init failed (non-blocking):', listenerError);
    }

    try {
      // Connect to MetaAPI
      await metaApiClient.connect();

      // Sync historical trades from MT5 to ensure all past trades are known
      const historicalDeals = await this.syncHistoricalTradesOnStartup();

      // Sync open positions with MT5 on startup (pass historical deals for close data)
      await this.syncPositionsOnStartup(historicalDeals);

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
   * @returns The historical deals array for use in position sync backfill
   */
  private async syncHistoricalTradesOnStartup(): Promise<any[]> {
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

      return deals;
    } catch (error) {
      console.error('[Bot] Error syncing historical trades:', error);
      // Don't throw - allow bot to start even if historical sync fails
      return [];
    }
  }

  /**
   * Sync positions with MT5 on startup
   * Imports any open positions from MT5 that don't exist in DB
   * Marks any DB trades as closed if they no longer exist on MT5
   * @param historicalDeals Historical deals for backfilling close data
   */
  private async syncPositionsOnStartup(historicalDeals: any[] = []): Promise<void> {
    console.log('[Bot] Syncing positions with MT5...');

    try {
      // Get current positions from MT5 (already converted to our Position type)
      const positions = await metaApiClient.getPositions();
      console.log(`[Bot] Found ${positions.length} open positions on MT5`);

      // Sync with trade manager (pass historical deals for close data recovery)
      const result = await tradeManager.syncWithBrokerPositions(positions, historicalDeals);

      if (result.imported > 0 || result.closed > 0) {
        console.log(`[Bot] Sync complete: ${result.imported} positions imported, ${result.closed} trades marked as closed`);
      } else {
        console.log('[Bot] Sync complete: No changes needed');
      }

      // Backfill any remaining closed trades with missing close data
      // Use ALL deals from history storage (not just 30-day window) for complete coverage
      try {
        const allDeals = await metaApiClient.getAllDeals();
        if (allDeals.length > 0) {
          const backfilled = await tradeManager.backfillMissingCloseData(allDeals);
          if (backfilled > 0) {
            console.log(`[Bot] Backfilled close data for ${backfilled} trades (from ${allDeals.length} total deals)`);
          }
        }
      } catch (backfillError) {
        // Fall back to 30-day deals if getAllDeals fails
        if (historicalDeals.length > 0) {
          const backfilled = await tradeManager.backfillMissingCloseData(historicalDeals);
          if (backfilled > 0) {
            console.log(`[Bot] Backfilled close data for ${backfilled} trades (30-day fallback)`);
          }
        }
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

      // Initialize Telegram TP monitor from Trade.notes for EXTERNAL positions
      await telegramTPMonitor.initializeFromPositions(positionUpdates);
      console.log(`[Bot] Telegram TP monitor initialized`);

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
      // Rate limiting is handled inside analyzeSymbol() (30s per symbol)
      if (candle.timeframe === ltfMetaApi) {
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
        // Remove from tracking immediately to prevent duplicate handling
        // if MetaAPI fires another onPositionsUpdated while we're awaiting
        this.lastKnownPositions.delete(removedId);

        console.log(`[Bot] Position ${removedId} closed: ${lastKnown.symbol} @ ${lastKnown.currentPrice}, Profit: $${lastKnown.profit?.toFixed(2) || 'N/A'}`);

        // Close the trade with the last known price and profit
        if (lastKnown.currentPrice != null && lastKnown.profit != null) {
          await tradeManager.closeTradeFromBroker(
            removedId,
            lastKnown.currentPrice,
            lastKnown.profit,
            new Date()
          );
        } else {
          // Fallback: look up exit deal from history storage when lastKnown data is incomplete
          console.log(`[Bot] Position ${removedId} missing price/profit, looking up exit deal...`);
          try {
            const posDeals = metaApiClient.getDealsByPosition(removedId);
            const exitDeal = posDeals.find((d: any) => d.entryType === 'DEAL_ENTRY_OUT');
            if (exitDeal) {
              const closePrice = exitDeal.price;
              const profit = exitDeal.profit || 0;
              console.log(`[Bot] Found exit deal for ${removedId}: @ ${closePrice}, Profit: $${profit.toFixed(2)}`);
              await tradeManager.closeTradeFromBroker(removedId, closePrice, profit, new Date(exitDeal.time));
            } else {
              // Last resort: close with whatever data we have so trade doesn't stay OPEN
              console.warn(`[Bot] No exit deal found for ${removedId}, closing with available data`);
              await tradeManager.closeTradeFromBroker(
                removedId,
                lastKnown.currentPrice || lastKnown.openPrice,
                lastKnown.profit || 0,
                new Date()
              );
            }
          } catch (dealError) {
            console.error(`[Bot] Error looking up exit deal for ${removedId}:`, dealError);
            // Still close the trade to avoid leaving it OPEN
            await tradeManager.closeTradeFromBroker(
              removedId,
              lastKnown.currentPrice || lastKnown.openPrice,
              lastKnown.profit || 0,
              new Date()
            );
          }
        }

        // Clean up breakeven tracking
        this.breakevenManager.onPositionClosed(removedId);

        // Clean up tiered TP tracking
        this.tieredTPManager.onPositionClosed(removedId);

        // Clean up Telegram TP monitor tracking
        telegramTPMonitor.onPositionClosed(removedId);

        // Send Telegram notification for closed trade (deduplicated)
        if (telegramNotifier.isEnabled() && !this.notifiedClosePositions.has(removedId)) {
          this.notifiedClosePositions.add(removedId);
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

    // Check Telegram TP monitor for proactive partial closes
    for (const pos of positions) {
      await telegramTPMonitor.checkAndExecuteTP(pos);
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

        // Periodic cleanup of close notification dedup set (keeps last 5 min)
        // Safe to clear since MetaAPI won't re-send removals after this long
        this.heartbeatCount++;
        if (this.heartbeatCount % 5 === 0) {
          this.notifiedClosePositions.clear();
        }

        // Hourly cleanup: delete analysis scans older than 7 days
        if (this.heartbeatCount % 60 === 0) {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          prisma.analysisScan.deleteMany({
            where: { scannedAt: { lt: sevenDaysAgo } },
          }).catch((err) => console.error('[Bot] Failed to cleanup old scans:', err));
        }

        // Fallback: re-analyze symbols that haven't been analyzed in 5+ minutes
        // (in case streaming candle events stopped arriving)
        const staleThreshold = 5 * 60 * 1000;
        for (const symbol of this.config.symbols) {
          const lastTime = this.lastAnalysisTime.get(symbol) || 0;
          if (Date.now() - lastTime > staleThreshold) {
            console.log(`[Bot] Heartbeat: ${symbol} analysis stale (${Math.round((Date.now() - lastTime) / 1000)}s ago), re-analyzing`);
            await this.analyzeSymbol(symbol);
          }
        }

        // Log status
        console.log(`[Bot] Heartbeat - Prices: ${this.latestPrices.size}, Symbols: ${this.config.symbols.length}`);

      } catch (error) {
        console.error('[Bot] Heartbeat error:', error);
      }
    }, 60000);

    // Also run initial analysis for all symbols
    this.analyzeAllSymbols();
  }

  async stop(options?: { preserveDbState?: boolean }): Promise<void> {
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

    // Update DB state unless this is a graceful shutdown (deploy/restart)
    // where we want to preserve isRunning=true so the bot auto-starts on the next deploy
    if (!options?.preserveDbState) {
      await this.updateBotState(false);
    } else {
      console.log('[Bot] Graceful shutdown — preserving DB running state for auto-restart');
    }

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

  /**
   * Check if trading is paused via the DB flag.
   * Caches the result for 30 seconds to avoid excessive DB reads.
   */
  async isTradingPaused(): Promise<{ isPaused: boolean; reason: string | null }> {
    const CACHE_TTL = 30_000; // 30 seconds
    if (Date.now() - this.pauseStateCache.checkedAt < CACHE_TTL) {
      return { isPaused: this.pauseStateCache.isPaused, reason: this.pauseStateCache.reason };
    }

    try {
      const state = await prisma.botPauseState.findUnique({ where: { id: 'singleton' } });
      const isPaused = state?.isPaused ?? false;
      const reason = state?.reason ?? null;
      this.pauseStateCache = { isPaused, reason, checkedAt: Date.now() };
      return { isPaused, reason };
    } catch (error) {
      console.error('[Bot] Error checking pause state:', error);
      return { isPaused: this.pauseStateCache.isPaused, reason: this.pauseStateCache.reason };
    }
  }

  /**
   * Set the bot pause state. Called by the analyst or API.
   */
  async setPauseState(isPaused: boolean, reason?: string, pausedBy?: string): Promise<void> {
    const now = new Date();
    await prisma.botPauseState.upsert({
      where: { id: 'singleton' },
      update: {
        isPaused,
        reason: isPaused ? (reason ?? null) : null,
        pausedBy: isPaused ? (pausedBy ?? null) : null,
        pausedAt: isPaused ? now : undefined,
        resumedAt: isPaused ? undefined : now,
      },
      create: {
        id: 'singleton',
        isPaused,
        reason: isPaused ? (reason ?? null) : null,
        pausedBy: isPaused ? (pausedBy ?? null) : null,
        pausedAt: isPaused ? now : null,
        resumedAt: isPaused ? null : now,
      },
    });

    // Invalidate cache immediately
    this.pauseStateCache = { isPaused, reason: isPaused ? (reason ?? null) : null, checkedAt: Date.now() };

    const action = isPaused ? 'PAUSED' : 'RESUMED';
    console.log(`[Bot] Trading ${action}${reason ? `: ${reason}` : ''} (by ${pausedBy ?? 'unknown'})`);

    // Send Telegram notification
    if (telegramNotifier.isEnabled()) {
      const message = isPaused
        ? `⏸️ <b>Trading Paused</b>\n\nReason: ${reason || 'No reason given'}\nBy: ${pausedBy || 'unknown'}\n\n<i>The bot is still running but will not open new trades.</i>`
        : `▶️ <b>Trading Resumed</b>\n\nBy: ${pausedBy || 'unknown'}\n\n<i>The bot will now open new trades again.</i>`;
      await telegramNotifier.sendMessage(message);
    }
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
      const elapsed = Date.now() - lastTime;
      if (elapsed < 30000) {
        console.log(`[Bot] Skipping ${symbol} analysis (${Math.round(elapsed / 1000)}s since last, need 30s)`);
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

      // Persist scan to DB (fire-and-forget)
      prisma.analysisScan.create({
        data: {
          symbol,
          currentPrice: context.currentPrice,
          htfBias: analysis.htf.bias,
          mtfBias: analysis.mtf.bias,
          ltfBias: analysis.ltf.bias,
          confluenceScore: analysis.confluenceScore,
          htfOBCount: analysis.htf.orderBlocks.length,
          mtfOBCount: analysis.mtf.orderBlocks.length,
          mtfFVGCount: analysis.mtf.fvgs.length,
          ltfFVGCount: analysis.ltf.fvgs.length,
          htfLiqZoneCount: analysis.htf.liquidityZones.length,
          mtfLiqZoneCount: analysis.mtf.liquidityZones.length,
          signalGenerated: !!signal,
          signalDirection: signal?.direction ?? null,
          signalStrategy: signal?.strategy ?? null,
          signalConfidence: signal?.confidence ?? null,
        },
      }).catch((err) => console.error('[Bot] Failed to persist analysis scan:', err));

      if (signal) {
        // Check if trading is paused before processing the signal
        const pauseState = await this.isTradingPaused();
        if (pauseState.isPaused) {
          console.log(`[Bot] Signal for ${symbol} suppressed (trading paused: ${pauseState.reason || 'no reason'})`);
        } else {
          console.log(`[Bot] Signal generated for ${symbol}: ${signal.direction} via ${signal.strategy}`);
          await this.processSignal(signal, price.bid, price.ask);
        }
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
      // Gate on autoTrading config — when disabled, skip signal processing
      // (position monitoring, BE, tiered TP, and Telegram trade execution still run)
      if (this.config.autoTrading === false) {
        console.log(`[Bot] Auto-trading disabled, skipping signal for ${signal.symbol} ${signal.direction} via ${signal.strategy}`);
        return;
      }

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

  /**
   * Get closed trades built directly from MetaAPI deals (authoritative source).
   * Groups deals by positionId, pairs entry/exit deals, and enriches with DB strategy data.
   * Returns trades matching the shape the TradeTable component expects.
   */
  async getClosedTradesFromDeals(limit: number = 50, offset: number = 0, symbolFilter?: string): Promise<{ trades: any[]; total: number }> {
    // Fetch ALL deals (includes balance operations) and trading deals separately
    const [allDeals, tradingDeals] = await Promise.all([
      metaApiClient.getAllDeals(),
      metaApiClient.getHistoricalDeals(),
    ]);

    // --- Build closed trades from trading deals ---
    // Group trading deals by positionId
    const positionDeals = new Map<string, any[]>();
    for (const deal of tradingDeals) {
      const posId = deal.positionId?.toString();
      if (!posId) continue;
      if (!positionDeals.has(posId)) positionDeals.set(posId, []);
      positionDeals.get(posId)!.push(deal);
    }

    const closedTrades: any[] = [];
    for (const [posId, pDeals] of positionDeals) {
      const entryDeal = pDeals.find((d: any) => d.entryType === 'DEAL_ENTRY_IN');
      const exitDeal = pDeals.find((d: any) => d.entryType === 'DEAL_ENTRY_OUT');
      if (!entryDeal || !exitDeal) continue; // Only include fully closed positions

      const direction = entryDeal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL';

      // Sum profit from all exit deals for this position (handles partial closes)
      const totalProfit = pDeals
        .filter((d: any) => d.entryType === 'DEAL_ENTRY_OUT')
        .reduce((sum: number, d: any) => sum + (d.profit || 0), 0);

      // Parse strategy from deal comment (bot sets "SMC ORDER_BLOCK" etc.)
      let strategy: StrategyType = 'EXTERNAL';
      if (entryDeal.comment) {
        const smcMatch = entryDeal.comment.match(/^SMC\s+(.+)$/);
        if (smcMatch) {
          const parsed = smcMatch[1] as StrategyType;
          const validStrategies: StrategyType[] = [
            'ORDER_BLOCK', 'LIQUIDITY_SWEEP', 'BOS', 'FBO_CLASSIC',
            'FBO_SWEEP', 'FBO_STRUCTURE', 'M1_TREND', 'EXTERNAL',
          ];
          if (validStrategies.includes(parsed)) strategy = parsed;
        }
      }

      closedTrades.push({
        id: `deal-${posId}`,
        symbol: entryDeal.symbol,
        direction,
        strategy,
        entryPrice: entryDeal.price,
        closePrice: exitDeal.price,
        stopLoss: entryDeal.stopLoss ?? null,
        takeProfit: entryDeal.takeProfit ?? null,
        lotSize: entryDeal.volume,
        openTime: new Date(entryDeal.time),
        closeTime: new Date(exitDeal.time),
        pnl: totalProfit,
        pnlPercent: null as number | null,
        status: 'CLOSED',
        mt5PositionId: posId,
        mt5OrderId: entryDeal.orderId ?? null,
        riskAmount: 0,
        riskRewardRatio: 0,
        notes: entryDeal.comment ?? null,
      });
    }

    // Enrich with DB data (strategy, riskAmount, riskRewardRatio, pnlPercent)
    try {
      const positionIds = closedTrades.map((t) => t.mt5PositionId).filter(Boolean);
      if (positionIds.length > 0) {
        const dbTrades = await prisma.trade.findMany({
          where: { mt5PositionId: { in: positionIds } },
        });
        const dbByPosId = new Map<string, any>();
        for (const t of dbTrades) {
          if (t.mt5PositionId) dbByPosId.set(t.mt5PositionId, t);
        }
        for (const trade of closedTrades) {
          const dbTrade = dbByPosId.get(trade.mt5PositionId);
          if (dbTrade) {
            trade.id = dbTrade.id;
            trade.strategy = dbTrade.strategy;
            trade.riskAmount = dbTrade.riskAmount || 0;
            trade.riskRewardRatio = dbTrade.riskRewardRatio || 0;
            trade.pnlPercent = dbTrade.pnlPercent ?? null;
            trade.stopLoss = dbTrade.stopLoss ?? trade.stopLoss;
            trade.takeProfit = dbTrade.takeProfit ?? trade.takeProfit;
          }
        }
      }
    } catch (dbError) {
      console.error('[Bot] Error enriching deals with DB data:', dbError);
    }

    // --- Build rows for deposits/withdrawals from balance deals ---
    for (const deal of allDeals) {
      if (deal.type !== 'DEAL_TYPE_BALANCE') continue;
      const amount = deal.profit || 0;
      if (amount === 0) continue;

      const isDeposit = amount > 0;
      closedTrades.push({
        id: `bal-${deal.id || deal.time}`,
        symbol: isDeposit ? 'DEPOSIT' : 'WITHDRAWAL',
        direction: isDeposit ? 'BUY' : 'SELL',
        strategy: isDeposit ? 'DEPOSIT' : 'WITHDRAWAL',
        entryPrice: null,
        closePrice: null,
        stopLoss: null,
        takeProfit: null,
        lotSize: null,
        openTime: new Date(deal.time),
        closeTime: new Date(deal.time),
        pnl: amount,
        pnlPercent: null,
        status: 'CLOSED',
        mt5PositionId: null,
        mt5OrderId: null,
        riskAmount: 0,
        riskRewardRatio: 0,
        notes: deal.comment ?? null,
      });
    }

    // Apply symbol filter before sorting/pagination
    // Balance ops (DEPOSIT/WITHDRAWAL) are excluded when a symbol filter is active
    const filtered = symbolFilter
      ? closedTrades.filter((t) => t.symbol === symbolFilter)
      : closedTrades;

    // Sort by closeTime DESC
    filtered.sort((a, b) => b.closeTime.getTime() - a.closeTime.getTime());

    const total = filtered.length;
    const paged = filtered.slice(offset, offset + limit);

    return { trades: paged, total };
  }

  /**
   * Get account summary computed from MetaAPI deals
   * Returns deposits, withdrawals, swap, commission, trading profit
   */
  async getAccountSummary() {
    return metaApiClient.getAccountDealsSummary();
  }

  getStatus(): {
    isRunning: boolean;
    config: BotConfig;
    symbols: string[];
    autoTrading: boolean;
    telegramListener: { enabled: boolean; listening: boolean };
  } {
    return {
      isRunning: this.isRunning,
      config: this.config,
      symbols: this.config.symbols,
      autoTrading: this.config.autoTrading !== false,
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
