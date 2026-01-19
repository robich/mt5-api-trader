import { prisma } from '../db';
import { Direction, Signal, Trade, Position, StrategyType, KillZoneType } from '../types';
import { isInKillZone, KILL_ZONES } from '../analysis/kill-zones';

/**
 * Trade Manager
 * Handles trade execution logic, prevents contradictory trades,
 * and manages position lifecycle.
 *
 * Enhanced with backtest-optimized parameters:
 * - Drawdown limits (12-hour rolling window, symbol-specific)
 * - Kill zone filtering
 * - Confirmation candle tracking
 */

export interface TradeManagerConfig {
  maxOpenTrades: number;
  maxTradesPerSymbol: number;
  allowContraryTrades: boolean;
  maxDailyLossPercent?: number;
}

/**
 * Drawdown tracking per symbol (12-hour rolling window)
 */
export interface DailyDrawdownState {
  lockTime: number | null; // Timestamp when locked (null if not locked)
  startBalance: number;
  currentLoss: number;
  isLocked: boolean;
  lockReason?: string;
}

const DEFAULT_CONFIG: TradeManagerConfig = {
  maxOpenTrades: 5,
  maxTradesPerSymbol: 1,
  allowContraryTrades: false,
  maxDailyLossPercent: 5,
};

export class TradeManager {
  private config: TradeManagerConfig;
  private dailyDrawdown: Map<string, DailyDrawdownState> = new Map(); // symbol -> state
  private globalDrawdown: DailyDrawdownState | null = null;

  constructor(config: Partial<TradeManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update config dynamically (for profile changes)
   */
  updateConfig(config: Partial<TradeManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Reset drawdown tracking for a symbol
   */
  resetDailyDrawdown(symbol: string, startBalance: number): void {
    this.dailyDrawdown.set(symbol, {
      lockTime: null,
      startBalance,
      currentLoss: 0,
      isLocked: false,
    });
  }

  /**
   * Reset global drawdown
   */
  resetGlobalDrawdown(startBalance: number): void {
    this.globalDrawdown = {
      lockTime: null,
      startBalance,
      currentLoss: 0,
      isLocked: false,
    };
  }

  /**
   * Record a loss and check if DD limit is hit (12-hour rolling window)
   */
  recordLoss(symbol: string, lossAmount: number, maxDailyDD: number): boolean {
    const now = Date.now();
    const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
    let state = this.dailyDrawdown.get(symbol);

    // Check if existing lock has expired (12 hours passed)
    if (state?.isLocked && state.lockTime) {
      if (now - state.lockTime >= TWELVE_HOURS_MS) {
        // Lock expired, reset state
        state = {
          lockTime: null,
          startBalance: state.startBalance,
          currentLoss: 0,
          isLocked: false,
        };
        this.dailyDrawdown.set(symbol, state);
      }
    }

    // Initialize if no state
    if (!state) {
      state = {
        lockTime: null,
        startBalance: 0, // Will be set properly when balance is available
        currentLoss: 0,
        isLocked: false,
      };
      this.dailyDrawdown.set(symbol, state);
    }

    state.currentLoss += lossAmount;

    // Check against limit
    if (state.startBalance > 0) {
      const ddPercent = (state.currentLoss / state.startBalance) * 100;
      if (ddPercent >= maxDailyDD) {
        state.isLocked = true;
        state.lockTime = now;
        state.lockReason = `DD limit ${maxDailyDD}% reached (${ddPercent.toFixed(2)}%) - locked for 12h`;
        return false;
      }
    }

    return true;
  }

  /**
   * Check if symbol is locked due to DD (12-hour rolling window)
   */
  isSymbolLocked(symbol: string): { locked: boolean; reason?: string } {
    const now = Date.now();
    const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
    const state = this.dailyDrawdown.get(symbol);

    if (!state) {
      return { locked: false };
    }

    // Check if lock has expired (12 hours passed)
    if (state.isLocked && state.lockTime) {
      if (now - state.lockTime >= TWELVE_HOURS_MS) {
        // Lock expired, clear it
        state.isLocked = false;
        state.lockTime = null;
        state.lockReason = undefined;
        state.currentLoss = 0;
        return { locked: false };
      }
    }

    return {
      locked: state.isLocked,
      reason: state.lockReason,
    };
  }

  /**
   * Check if current time is in allowed kill zones
   */
  isInAllowedKillZone(killZones: KillZoneType[]): boolean {
    if (killZones.length === 0) return true; // No filter
    return isInKillZone(new Date(), killZones);
  }

  /**
   * Get daily drawdown status for all symbols
   */
  getDailyDrawdownStatus(): Map<string, DailyDrawdownState> {
    return new Map(this.dailyDrawdown);
  }

  /**
   * Check if a new trade can be opened
   */
  async canOpenTrade(
    symbol: string,
    direction: Direction,
    openPositions: Position[]
  ): Promise<{ canOpen: boolean; reason?: string }> {
    // Check max open trades
    if (openPositions.length >= this.config.maxOpenTrades) {
      return {
        canOpen: false,
        reason: `Maximum open trades reached (${this.config.maxOpenTrades})`,
      };
    }

    // Check max trades per symbol
    const symbolPositions = openPositions.filter((p) => p.symbol === symbol);
    if (symbolPositions.length >= this.config.maxTradesPerSymbol) {
      return {
        canOpen: false,
        reason: `Maximum trades for ${symbol} reached (${this.config.maxTradesPerSymbol})`,
      };
    }

    // Check for contradictory trades
    if (!this.config.allowContraryTrades) {
      const hasContrary = symbolPositions.some((p) => p.type !== direction);
      if (hasContrary) {
        return {
          canOpen: false,
          reason: `Contradictory ${direction} trade on ${symbol} - already have opposite position`,
        };
      }
    }

    // Check loss limit (12-hour rolling window)
    if (this.config.maxDailyLossPercent) {
      const lossLimitOk = await this.checkDailyLossLimit();
      if (!lossLimitOk) {
        return {
          canOpen: false,
          reason: `Loss limit reached in last 12h (${this.config.maxDailyLossPercent}%)`,
        };
      }
    }

    // Check symbol-specific daily DD lock
    const symbolLock = this.isSymbolLocked(symbol);
    if (symbolLock.locked) {
      return {
        canOpen: false,
        reason: symbolLock.reason || `${symbol} locked due to daily drawdown`,
      };
    }

    return { canOpen: true };
  }

  /**
   * Enhanced trade open check with kill zones and profile settings
   */
  async canOpenTradeWithProfile(
    symbol: string,
    direction: Direction,
    openPositions: Position[],
    options: {
      useKillZones: boolean;
      killZones: KillZoneType[];
      maxDailyDrawdown: number;
    }
  ): Promise<{ canOpen: boolean; reason?: string }> {
    // First do basic checks
    const basicCheck = await this.canOpenTrade(symbol, direction, openPositions);
    if (!basicCheck.canOpen) {
      return basicCheck;
    }

    // Kill zone filter
    if (options.useKillZones && options.killZones.length > 0) {
      if (!this.isInAllowedKillZone(options.killZones)) {
        return {
          canOpen: false,
          reason: 'Outside allowed kill zones',
        };
      }
    }

    // Symbol-specific daily DD check
    const symbolLock = this.isSymbolLocked(symbol);
    if (symbolLock.locked) {
      return {
        canOpen: false,
        reason: symbolLock.reason,
      };
    }

    return { canOpen: true };
  }

  /**
   * Check if loss limit has been reached (12-hour rolling window)
   */
  private async checkDailyLossLimit(): Promise<boolean> {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

    const recentTrades = await prisma.trade.findMany({
      where: {
        closeTime: {
          gte: twelveHoursAgo,
        },
        status: 'CLOSED',
      },
    });

    const totalLoss = recentTrades
      .filter((t) => t.pnlPercent && t.pnlPercent < 0)
      .reduce((sum, t) => sum + Math.abs(t.pnlPercent || 0), 0);

    return totalLoss < (this.config.maxDailyLossPercent || 100);
  }

  /**
   * Record a new trade in the database
   */
  async recordTrade(trade: Omit<Trade, 'id'>): Promise<Trade> {
    const created = await prisma.trade.create({
      data: {
        symbol: trade.symbol,
        direction: trade.direction,
        strategy: trade.strategy,
        entryPrice: trade.entryPrice,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        lotSize: trade.lotSize,
        openTime: trade.openTime,
        status: trade.status,
        mt5OrderId: trade.mt5OrderId,
        mt5PositionId: trade.mt5PositionId,
        riskAmount: trade.riskAmount,
        riskRewardRatio: trade.riskRewardRatio,
        signalId: trade.signalId,
      },
    });

    return created as Trade;
  }

  /**
   * Update trade when closed
   */
  async closeTrade(
    tradeId: string,
    closePrice: number,
    closeTime: Date
  ): Promise<Trade> {
    const trade = await prisma.trade.findUnique({ where: { id: tradeId } });

    if (!trade) {
      throw new Error(`Trade ${tradeId} not found`);
    }

    // Calculate P&L
    let pnl: number;
    if (trade.direction === 'BUY') {
      pnl = (closePrice - trade.entryPrice) * trade.lotSize;
    } else {
      pnl = (trade.entryPrice - closePrice) * trade.lotSize;
    }

    const pnlPercent = (pnl / trade.riskAmount) * 100;

    const updated = await prisma.trade.update({
      where: { id: tradeId },
      data: {
        closePrice,
        closeTime,
        pnl,
        pnlPercent,
        status: 'CLOSED',
      },
    });

    return updated as Trade;
  }

  /**
   * Record a new signal
   */
  async recordSignal(signal: Signal): Promise<void> {
    await prisma.signal.create({
      data: {
        id: signal.id,
        symbol: signal.symbol,
        direction: signal.direction,
        strategy: signal.strategy,
        timeframe: signal.timeframe,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        confidence: signal.confidence,
        status: signal.status,
        reason: signal.reason,
        htfBias: signal.htfBias,
        mtfStructure: signal.mtfStructure,
        createdAt: signal.createdAt,
        expiresAt: signal.expiresAt,
      },
    });
  }

  /**
   * Update signal status
   */
  async updateSignalStatus(
    signalId: string,
    status: 'TAKEN' | 'REJECTED' | 'EXPIRED',
    reason?: string
  ): Promise<void> {
    await prisma.signal.update({
      where: { id: signalId },
      data: {
        status,
        reason: reason || undefined,
      },
    });
  }

  /**
   * Get open trades for a symbol
   */
  async getOpenTradesForSymbol(symbol: string): Promise<Trade[]> {
    const trades = await prisma.trade.findMany({
      where: {
        symbol,
        status: 'OPEN',
      },
    });

    return trades as Trade[];
  }

  /**
   * Get all open trades
   */
  async getAllOpenTrades(): Promise<Trade[]> {
    const trades = await prisma.trade.findMany({
      where: {
        status: 'OPEN',
      },
    });

    return trades as Trade[];
  }

  /**
   * Get recent signals
   */
  async getRecentSignals(limit: number = 20): Promise<Signal[]> {
    const signals = await prisma.signal.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return signals as unknown as Signal[];
  }

  /**
   * Get trading statistics
   */
  async getStatistics(days: number = 30): Promise<{
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnl: number;
    averageWin: number;
    averageLoss: number;
    profitFactor: number;
    byStrategy: Record<string, { trades: number; winRate: number; pnl: number }>;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const trades = await prisma.trade.findMany({
      where: {
        closeTime: { gte: startDate },
        status: 'CLOSED',
      },
    });

    const winningTrades = trades.filter((t) => (t.pnl || 0) > 0);
    const losingTrades = trades.filter((t) => (t.pnl || 0) < 0);

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / winningTrades.length
      : 0;

    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / losingTrades.length)
      : 0;

    const grossProfit = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));

    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Group by strategy
    const byStrategy: Record<string, { trades: number; winRate: number; pnl: number }> = {};

    for (const strategy of ['ORDER_BLOCK', 'LIQUIDITY_SWEEP', 'BOS'] as StrategyType[]) {
      const strategyTrades = trades.filter((t) => t.strategy === strategy);
      const strategyWins = strategyTrades.filter((t) => (t.pnl || 0) > 0);
      const strategyPnl = strategyTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

      byStrategy[strategy] = {
        trades: strategyTrades.length,
        winRate: strategyTrades.length > 0 ? (strategyWins.length / strategyTrades.length) * 100 : 0,
        pnl: strategyPnl,
      };
    }

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
      totalPnl,
      averageWin: avgWin,
      averageLoss: avgLoss,
      profitFactor,
      byStrategy,
    };
  }

  /**
   * Expire old pending signals
   */
  async expireOldSignals(): Promise<number> {
    const result = await prisma.signal.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    return result.count;
  }

  /**
   * Sync open trades with broker positions
   * - Imports MT5 positions that don't exist in DB (opened externally)
   * - Marks DB trades as closed if they no longer exist on broker
   */
  async syncWithBrokerPositions(brokerPositions: Position[]): Promise<{
    imported: number;
    closed: number;
  }> {
    const dbOpenTrades = await this.getAllOpenTrades();
    let imported = 0;
    let closed = 0;

    // 1. Check for DB trades that no longer exist on broker (closed externally)
    for (const dbTrade of dbOpenTrades) {
      const brokerPosition = brokerPositions.find(
        (p) => p.id === dbTrade.mt5PositionId
      );

      if (!brokerPosition) {
        // Position was closed externally
        // We don't have the exact close price, so mark as closed without PnL
        // This happens when positions are closed manually or by SL/TP on the broker side
        await prisma.trade.update({
          where: { id: dbTrade.id },
          data: {
            status: 'CLOSED',
            closeTime: new Date(),
            notes: 'Closed externally - price unknown',
          },
        });
        console.log(`[TradeManager] Trade ${dbTrade.id} closed externally (no price available)`);
        closed++;
      }
    }

    // 2. Import broker positions that don't exist in DB
    for (const brokerPosition of brokerPositions) {
      const existingTrade = dbOpenTrades.find(
        (t) => t.mt5PositionId === brokerPosition.id
      );

      if (!existingTrade) {
        // This position doesn't exist in DB - import it
        await this.importExternalPosition(brokerPosition);
        imported++;
      }
    }

    return { imported, closed };
  }

  /**
   * Import an external MT5 position into the database
   * Used for positions opened manually or by other systems
   * Parses strategy from comment if opened by the bot (format: "SMC STRATEGY_NAME")
   */
  async importExternalPosition(position: Position): Promise<Trade> {
    const direction = position.type as Direction;

    // Calculate risk amount estimate (use 2% of a typical $1000 account as default)
    // This is just for display purposes since we don't know the original risk
    const estimatedRiskAmount = 20;

    // Use SL/TP from position, or default to 0 if not set
    const stopLoss = position.stopLoss ?? 0;
    const takeProfit = position.takeProfit ?? 0;

    // Calculate R:R if SL and TP are available
    let riskRewardRatio = 0;
    if (stopLoss > 0 && takeProfit > 0) {
      const riskPips = Math.abs(position.openPrice - stopLoss);
      const rewardPips = Math.abs(takeProfit - position.openPrice);
      riskRewardRatio = riskPips > 0 ? rewardPips / riskPips : 0;
    }

    // Parse strategy from comment if it's a bot-opened trade
    // Bot uses format: "SMC STRATEGY_NAME" (e.g., "SMC ORDER_BLOCK")
    let strategy: StrategyType | 'EXTERNAL' = 'EXTERNAL';
    let notes = 'Imported from MT5 - position opened externally';

    if (position.comment?.startsWith('SMC ')) {
      const parsedStrategy = position.comment.substring(4).trim();
      // Validate it's a known strategy
      const validStrategies: StrategyType[] = ['ORDER_BLOCK', 'LIQUIDITY_SWEEP', 'BOS', 'FBO_CLASSIC', 'FBO_SWEEP', 'FBO_STRUCTURE'];
      if (validStrategies.includes(parsedStrategy as StrategyType)) {
        strategy = parsedStrategy as StrategyType;
        notes = `Imported from MT5 - bot trade (${strategy})`;
      }
    }

    const trade = await prisma.trade.create({
      data: {
        symbol: position.symbol,
        direction,
        strategy,
        entryPrice: position.openPrice,
        stopLoss,
        takeProfit,
        lotSize: position.volume,
        openTime: position.openTime,
        status: 'OPEN',
        mt5PositionId: position.id,
        riskAmount: estimatedRiskAmount,
        riskRewardRatio,
        notes,
      },
    });

    console.log(`[TradeManager] Imported position: ${position.symbol} ${direction} @ ${position.openPrice} (ID: ${position.id}, Strategy: ${strategy})`);

    return trade as Trade;
  }

  /**
   * Sync historical trades (closed deals) from MT5 to the database
   * This ensures all past trades are known in the local DB
   *
   * Deal format from MetaAPI historyStorage:
   * - type: "DEAL_TYPE_BUY" or "DEAL_TYPE_SELL"
   * - entryType: "DEAL_ENTRY_IN" (open) or "DEAL_ENTRY_OUT" (close)
   * - positionId: Position ID string
   * - symbol, volume, price, profit, stopLoss, takeProfit, comment, time
   *
   * @param deals - Array of historical deals from MT5
   * @returns Number of trades imported
   */
  async syncHistoricalTrades(deals: any[]): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    // Group deals by position ID to handle partial closes and entry/exit pairs
    const dealsByPosition = new Map<string, any[]>();
    for (const deal of deals) {
      const positionId = deal.positionId?.toString();
      if (!positionId) continue;

      if (!dealsByPosition.has(positionId)) {
        dealsByPosition.set(positionId, []);
      }
      dealsByPosition.get(positionId)!.push(deal);
    }

    console.log(`[TradeManager] Processing ${dealsByPosition.size} positions from ${deals.length} deals`);

    // Process each position's deals
    for (const [positionId, positionDeals] of dealsByPosition) {
      try {
        // Check if this trade already exists in DB
        const existingTrade = await prisma.trade.findFirst({
          where: { mt5PositionId: positionId },
        });

        if (existingTrade) {
          // Trade already exists, but check if it needs closing
          if (existingTrade.status === 'OPEN') {
            // Look for exit deal
            const exitDeal = positionDeals.find(
              (d: any) => d.entryType === 'DEAL_ENTRY_OUT'
            );
            if (exitDeal) {
              await prisma.trade.update({
                where: { id: existingTrade.id },
                data: {
                  status: 'CLOSED',
                  closePrice: exitDeal.price,
                  closeTime: new Date(exitDeal.time),
                  pnl: exitDeal.profit || 0,
                  pnlPercent: existingTrade.riskAmount > 0
                    ? ((exitDeal.profit || 0) / existingTrade.riskAmount) * 100
                    : 0,
                },
              });
              console.log(`[TradeManager] Synced close for existing trade ${positionId}`);
            }
          }
          skipped++;
          continue;
        }

        // Find entry deal (DEAL_ENTRY_IN)
        const entryDeal = positionDeals.find(
          (d: any) => d.entryType === 'DEAL_ENTRY_IN'
        );

        // Find exit deal (DEAL_ENTRY_OUT)
        const exitDeal = positionDeals.find(
          (d: any) => d.entryType === 'DEAL_ENTRY_OUT'
        );

        if (!entryDeal) {
          // No entry deal found, skip this position
          skipped++;
          continue;
        }

        // Determine direction from deal type
        const isBuy = entryDeal.type === 'DEAL_TYPE_BUY';
        const direction: Direction = isBuy ? 'BUY' : 'SELL';

        // Parse strategy from comment
        let strategy: StrategyType | 'EXTERNAL' = 'EXTERNAL';
        let notes = 'Synced from MT5 history';
        const comment = entryDeal.comment || entryDeal.brokerComment || '';

        if (comment.startsWith('SMC ')) {
          const parsedStrategy = comment.substring(4).trim();
          const validStrategies: StrategyType[] = ['ORDER_BLOCK', 'LIQUIDITY_SWEEP', 'BOS', 'FBO_CLASSIC', 'FBO_SWEEP', 'FBO_STRUCTURE'];
          if (validStrategies.includes(parsedStrategy as StrategyType)) {
            strategy = parsedStrategy as StrategyType;
            notes = `Synced from MT5 history - bot trade (${strategy})`;
          }
        }

        // Calculate total profit from exit deal (entry deals have profit=0)
        const totalProfit = exitDeal?.profit || 0;
        const totalVolume = entryDeal.volume || 0;

        // Get SL/TP from entry deal if available
        const stopLoss = entryDeal.stopLoss || 0;
        const takeProfit = entryDeal.takeProfit || 0;

        // Calculate R:R if SL and TP are available
        let riskRewardRatio = 0;
        if (stopLoss > 0 && takeProfit > 0) {
          const riskPips = Math.abs(entryDeal.price - stopLoss);
          const rewardPips = Math.abs(takeProfit - entryDeal.price);
          riskRewardRatio = riskPips > 0 ? rewardPips / riskPips : 0;
        }

        // Estimate risk amount (2% of typical balance)
        const estimatedRiskAmount = 20;

        // Determine if trade is open or closed
        const isClosed = !!exitDeal;
        const status = isClosed ? 'CLOSED' : 'OPEN';

        // Create trade record
        await prisma.trade.create({
          data: {
            symbol: entryDeal.symbol,
            direction,
            strategy,
            entryPrice: entryDeal.price,
            stopLoss,
            takeProfit,
            lotSize: totalVolume,
            openTime: new Date(entryDeal.time),
            closeTime: isClosed ? new Date(exitDeal.time) : null,
            closePrice: isClosed ? exitDeal.price : null,
            pnl: isClosed ? totalProfit : null,
            pnlPercent: isClosed && estimatedRiskAmount > 0 ? (totalProfit / estimatedRiskAmount) * 100 : null,
            status,
            mt5PositionId: positionId,
            riskAmount: estimatedRiskAmount,
            riskRewardRatio,
            notes,
          },
        });

        console.log(`[TradeManager] Imported historical trade: ${entryDeal.symbol} ${direction} @ ${entryDeal.price} (Position: ${positionId}, Status: ${status})`);
        imported++;

      } catch (error) {
        console.error(`[TradeManager] Error importing position ${positionId}:`, error);
        skipped++;
      }
    }

    return { imported, skipped };
  }

  /**
   * Update open trades with current prices from broker
   * Call this periodically to keep track of unrealized PnL
   */
  async updateTradesFromPositions(brokerPositions: Position[]): Promise<void> {
    const dbOpenTrades = await this.getAllOpenTrades();

    for (const dbTrade of dbOpenTrades) {
      const brokerPosition = brokerPositions.find(
        (p) => p.id === dbTrade.mt5PositionId
      );

      if (brokerPosition) {
        // Position still open - we could update unrealized PnL here if needed
        // For now, just log
        console.log(`[TradeManager] Trade ${dbTrade.symbol} ${dbTrade.direction}: Current P&L $${brokerPosition.profit?.toFixed(2) || 'N/A'}`);
      }
    }
  }

  /**
   * Close a trade with data from the broker (when we receive close notification)
   */
  async closeTradeFromBroker(
    mt5PositionId: string,
    closePrice: number,
    profit: number,
    closeTime: Date = new Date()
  ): Promise<Trade | null> {
    const trade = await prisma.trade.findFirst({
      where: {
        mt5PositionId,
        status: 'OPEN',
      },
    });

    if (!trade) {
      console.log(`[TradeManager] No open trade found for MT5 position ${mt5PositionId}`);
      return null;
    }

    const pnlPercent = trade.riskAmount > 0 ? (profit / trade.riskAmount) * 100 : 0;

    const updated = await prisma.trade.update({
      where: { id: trade.id },
      data: {
        closePrice,
        closeTime,
        pnl: profit,
        pnlPercent,
        status: 'CLOSED',
      },
    });

    console.log(`[TradeManager] Trade ${trade.id} closed: ${trade.symbol} ${trade.direction} @ ${closePrice}, PnL: $${profit.toFixed(2)}`);

    // Record loss for daily DD tracking if negative
    if (profit < 0) {
      this.recordLoss(trade.symbol, Math.abs(profit), this.config.maxDailyLossPercent || 5);
    }

    return updated as Trade;
  }
}

export const tradeManager = new TradeManager();
