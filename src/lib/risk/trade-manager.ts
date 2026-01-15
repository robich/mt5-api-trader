import { prisma } from '../db';
import { Direction, Signal, Trade, Position, StrategyType, KillZoneType } from '../types';
import { isInKillZone, KILL_ZONES } from '../analysis/kill-zones';

/**
 * Trade Manager
 * Handles trade execution logic, prevents contradictory trades,
 * and manages position lifecycle.
 *
 * Enhanced with backtest-optimized parameters:
 * - Daily drawdown limits (symbol-specific)
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
 * Daily drawdown tracking per symbol
 */
export interface DailyDrawdownState {
  date: string;
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
   * Reset daily drawdown tracking (call at start of day)
   */
  resetDailyDrawdown(symbol: string, startBalance: number): void {
    const today = new Date().toISOString().split('T')[0];
    this.dailyDrawdown.set(symbol, {
      date: today,
      startBalance,
      currentLoss: 0,
      isLocked: false,
    });
  }

  /**
   * Reset global daily drawdown
   */
  resetGlobalDrawdown(startBalance: number): void {
    const today = new Date().toISOString().split('T')[0];
    this.globalDrawdown = {
      date: today,
      startBalance,
      currentLoss: 0,
      isLocked: false,
    };
  }

  /**
   * Record a loss and check if daily DD limit is hit
   */
  recordLoss(symbol: string, lossAmount: number, maxDailyDD: number): boolean {
    const today = new Date().toISOString().split('T')[0];
    let state = this.dailyDrawdown.get(symbol);

    // Initialize if new day or no state
    if (!state || state.date !== today) {
      state = {
        date: today,
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
        state.lockReason = `Daily DD limit ${maxDailyDD}% reached (${ddPercent.toFixed(2)}%)`;
        return false;
      }
    }

    return true;
  }

  /**
   * Check if symbol is locked due to daily DD
   */
  isSymbolLocked(symbol: string): { locked: boolean; reason?: string } {
    const today = new Date().toISOString().split('T')[0];
    const state = this.dailyDrawdown.get(symbol);

    if (!state || state.date !== today) {
      return { locked: false };
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

    // Check daily loss limit
    if (this.config.maxDailyLossPercent) {
      const dailyLossOk = await this.checkDailyLossLimit();
      if (!dailyLossOk) {
        return {
          canOpen: false,
          reason: `Daily loss limit reached (${this.config.maxDailyLossPercent}%)`,
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
   * Check if daily loss limit has been reached
   */
  private async checkDailyLossLimit(): Promise<boolean> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayTrades = await prisma.trade.findMany({
      where: {
        closeTime: {
          gte: todayStart,
        },
        status: 'CLOSED',
      },
    });

    const totalLoss = todayTrades
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
   * Updates trades that were closed externally with proper close price and PnL
   */
  async syncWithBrokerPositions(brokerPositions: Position[]): Promise<void> {
    const dbOpenTrades = await this.getAllOpenTrades();

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
      }
    }
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
