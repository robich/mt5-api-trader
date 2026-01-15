import {
  Candle,
  Tick,
  Timeframe,
  Direction,
  StrategyType,
  BacktestConfig,
  BacktestMetrics,
  BacktestTrade,
  KillZoneType,
  MultiTimeframeAnalysis,
} from '../types';
import { performMTFAnalysis, MTFData } from '../analysis/multi-timeframe';
import { runStrategy, StrategyContext } from '../strategies';
import { calculatePositionSize, calculateRiskReward } from '../risk/position-sizing';
import { isInKillZone, getKillZoneBonus, isHighProbabilityTime, shouldAvoidTrading } from '../analysis/kill-zones';
import { v4 as uuidv4 } from 'uuid';

/**
 * Backtesting Engine
 * Simulates strategy performance on historical data
 * Supports both candle-based and tick-based simulation for accuracy
 */

export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: { date: Date; equity: number }[];
  drawdownCurve: { date: Date; drawdown: number }[];
}

export interface BacktestProgress {
  phase: 'initializing' | 'analyzing' | 'complete';
  progress: number; // 0-100
  currentDate?: Date;
  candlesProcessed: number;
  totalCandles: number;
  // Live KPIs
  tradesExecuted: number;
  winningTrades: number;
  losingTrades: number;
  currentBalance: number;
  totalPnl: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  lastTradeDirection?: 'BUY' | 'SELL';
  lastTradeResult?: 'WIN' | 'LOSS';
}

export type ProgressCallback = (progress: BacktestProgress) => void;

interface SimulatedPosition {
  id: string;
  direction: Direction;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  entryTime: Date;
}

// Daily tracking for max daily drawdown
interface DailyTracker {
  date: string; // YYYY-MM-DD
  startingBalance: number;
  lowestBalance: number;
  isLocked: boolean; // True if daily drawdown limit hit
}

// Default symbol info for backtesting (will be updated with real data in production)
const DEFAULT_SYMBOL_INFO = {
  'XAUUSD.s': { pipSize: 0.1, contractSize: 100, minVolume: 0.01, maxVolume: 100, volumeStep: 0.01, tickSize: 0.01, tickValue: 1 },
  'XAGUSD.s': { pipSize: 0.01, contractSize: 5000, minVolume: 0.01, maxVolume: 100, volumeStep: 0.01, tickSize: 0.001, tickValue: 1 },
  BTCUSD: { pipSize: 1, contractSize: 1, minVolume: 0.01, maxVolume: 10, volumeStep: 0.01, tickSize: 0.01, tickValue: 1 },
  ETHUSD: { pipSize: 1, contractSize: 1, minVolume: 0.01, maxVolume: 100, volumeStep: 0.01, tickSize: 0.1, tickValue: 1 },
};

export class BacktestEngine {
  private config: BacktestConfig;
  private balance: number;
  private equity: number;
  private openPosition: SimulatedPosition | null = null;
  private trades: BacktestTrade[] = [];
  private equityCurve: { date: Date; equity: number }[] = [];
  private peakEquity: number;
  private onProgress?: ProgressCallback;
  private grossProfit: number = 0;
  private grossLoss: number = 0;
  private maxDrawdownValue: number = 0;

  // Daily drawdown tracking
  private dailyTracker: DailyTracker | null = null;
  private maxDailyDrawdownPercent: number = 6; // 6% max daily drawdown
  private daysLockedOut: number = 0; // Count of days where trading was stopped due to drawdown

  constructor(config: BacktestConfig, onProgress?: ProgressCallback) {
    this.config = config;
    this.balance = config.initialBalance;
    this.equity = config.initialBalance;
    this.peakEquity = config.initialBalance;
    this.onProgress = onProgress;

    // Allow config to override max daily drawdown
    if (config.maxDailyDrawdownPercent) {
      this.maxDailyDrawdownPercent = config.maxDailyDrawdownPercent;
    }
  }

  /**
   * Check if price is in the OTE (Optimal Trade Entry) zone
   * OTE zone is typically the 0.618-0.786 Fibonacci retracement level
   */
  private checkOTEZone(direction: Direction, currentPrice: number, analysis: MultiTimeframeAnalysis): boolean {
    if (!analysis.premiumDiscount) {
      return true; // No premium/discount data, allow entry
    }

    const { premium, discount, fib618, fib786 } = analysis.premiumDiscount;
    const oteThreshold = this.config.oteThreshold || 0.618;

    if (direction === 'BUY') {
      // For buys, price should be in discount zone (near fib 0.618-0.786 retracement)
      // OTE zone is between fib618 and fib786 from the swing low
      const oteHigh = fib618;
      const oteLow = fib786;
      return currentPrice <= oteHigh && currentPrice >= Math.min(oteLow, discount.low);
    } else {
      // For sells, price should be in premium zone
      const oteLow = fib618;
      const oteHigh = fib786;
      return currentPrice >= oteLow && currentPrice <= Math.max(oteHigh, premium.high);
    }
  }

  /**
   * Check and update daily drawdown tracking
   * Returns true if trading is allowed, false if daily limit hit
   */
  private checkDailyDrawdown(currentTime: Date): boolean {
    const dateStr = currentTime.toISOString().split('T')[0]; // YYYY-MM-DD

    // New day - reset tracker
    if (!this.dailyTracker || this.dailyTracker.date !== dateStr) {
      this.dailyTracker = {
        date: dateStr,
        startingBalance: this.balance,
        lowestBalance: this.balance,
        isLocked: false,
      };
    }

    // If already locked for today, don't allow new trades
    if (this.dailyTracker.isLocked) {
      return false;
    }

    // Update lowest balance
    if (this.balance < this.dailyTracker.lowestBalance) {
      this.dailyTracker.lowestBalance = this.balance;
    }

    // Check if daily drawdown limit is hit
    const dailyDrawdownPercent =
      ((this.dailyTracker.startingBalance - this.balance) / this.dailyTracker.startingBalance) * 100;

    if (dailyDrawdownPercent >= this.maxDailyDrawdownPercent) {
      this.dailyTracker.isLocked = true;
      this.daysLockedOut++;
      console.log(`[Backtest] Daily drawdown limit hit (${dailyDrawdownPercent.toFixed(2)}%) on ${dateStr}. Trading paused for the day.`);
      return false;
    }

    return true;
  }

  private emitProgress(
    phase: BacktestProgress['phase'],
    candlesProcessed: number,
    totalCandles: number,
    currentDate?: Date,
    lastTrade?: BacktestTrade
  ): void {
    if (!this.onProgress) return;

    const winningTrades = this.trades.filter((t) => t.isWinner).length;
    const losingTrades = this.trades.filter((t) => !t.isWinner).length;
    const winRate = this.trades.length > 0 ? (winningTrades / this.trades.length) * 100 : 0;
    const profitFactor = this.grossLoss > 0 ? this.grossProfit / this.grossLoss : this.grossProfit > 0 ? Infinity : 0;

    this.onProgress({
      phase,
      progress: totalCandles > 0 ? Math.round((candlesProcessed / totalCandles) * 100) : 0,
      currentDate,
      candlesProcessed,
      totalCandles,
      tradesExecuted: this.trades.length,
      winningTrades,
      losingTrades,
      currentBalance: this.balance,
      totalPnl: this.balance - this.config.initialBalance,
      winRate,
      profitFactor: isFinite(profitFactor) ? profitFactor : 0,
      maxDrawdown: this.maxDrawdownValue,
      lastTradeDirection: lastTrade?.direction,
      lastTradeResult: lastTrade ? (lastTrade.isWinner ? 'WIN' : 'LOSS') : undefined,
    });
  }

  /**
   * Run backtest on candle data
   */
  async runCandleBacktest(
    htfCandles: Candle[],
    mtfCandles: Candle[],
    ltfCandles: Candle[]
  ): Promise<BacktestResult> {
    this.reset();

    const symbol = this.config.symbol;
    const symbolInfo = DEFAULT_SYMBOL_INFO[symbol as keyof typeof DEFAULT_SYMBOL_INFO] || DEFAULT_SYMBOL_INFO['XAUUSD.s'];
    const totalCandles = ltfCandles.length - 100;
    let lastProgressUpdate = 0;

    // Debug counters
    const debugStats = {
      totalIterations: 0,
      skippedKillZone: 0,
      skippedInsufficientData: 0,
      skippedNeutralBias: 0,
      skippedNoOrderBlocks: 0,
      skippedPriceNotAtOB: 0,
      signalsGenerated: 0,
    };

    console.log(`[Backtest Debug] Starting backtest for ${symbol}, strategy: ${this.config.strategy}`);
    console.log(`[Backtest Debug] Candles: HTF=${htfCandles.length}, MTF=${mtfCandles.length}, LTF=${ltfCandles.length}`);

    // Emit initial progress
    this.emitProgress('initializing', 0, totalCandles);

    // Create candle index maps for faster lookup
    const htfByTime = new Map<number, number>();
    htfCandles.forEach((c, i) => htfByTime.set(c.time.getTime(), i));

    const mtfByTime = new Map<number, number>();
    mtfCandles.forEach((c, i) => mtfByTime.set(c.time.getTime(), i));

    // Iterate through LTF candles (entry timeframe)
    for (let i = 100; i < ltfCandles.length; i++) {
      const currentLTFCandle = ltfCandles[i];
      const currentTime = currentLTFCandle.time;
      const candlesProcessed = i - 100;
      debugStats.totalIterations++;

      // Emit progress every 2% or when a trade closes
      const currentProgress = Math.floor((candlesProcessed / totalCandles) * 50);
      if (currentProgress > lastProgressUpdate) {
        lastProgressUpdate = currentProgress;
        this.emitProgress('analyzing', candlesProcessed, totalCandles, currentTime);
        // Small yield to allow event loop to process
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // Update equity curve
      this.updateEquityCurve(currentTime, currentLTFCandle.close);

      // Check if open position should be closed
      if (this.openPosition) {
        const exitResult = this.checkPositionExit(currentLTFCandle);
        if (exitResult) {
          const lastTrade = this.closePosition(
            exitResult.price,
            currentTime,
            exitResult.reason,
            symbolInfo.contractSize
          );
          // Emit progress immediately after trade closes
          this.emitProgress('analyzing', candlesProcessed, totalCandles, currentTime, lastTrade);
        }
        continue; // Don't look for new entries while in a position
      }

      // Daily drawdown check - skip new entries if daily limit hit
      if (!this.checkDailyDrawdown(currentTime)) {
        continue; // Skip - daily drawdown limit reached
      }

      // Kill zone filter: Skip if outside trading hours
      if (this.config.useKillZones) {
        const killZones = this.config.killZones || ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'];
        if (!isInKillZone(currentTime, killZones as KillZoneType[])) {
          debugStats.skippedKillZone++;
          continue; // Skip - not in kill zone
        }
      }

      // Get historical data up to current candle
      const htfSlice = htfCandles.filter((c) => c.time <= currentTime).slice(-100);
      const mtfSlice = mtfCandles.filter((c) => c.time <= currentTime).slice(-200);
      const ltfSlice = ltfCandles.slice(Math.max(0, i - 100), i + 1);

      if (htfSlice.length < 50 || mtfSlice.length < 100 || ltfSlice.length < 50) {
        debugStats.skippedInsufficientData++;
        continue;
      }

      // Perform MTF analysis
      const analysis = performMTFAnalysis(
        { htfCandles: htfSlice, mtfCandles: mtfSlice, ltfCandles: ltfSlice },
        symbol,
        this.config.strategy === 'ORDER_BLOCK' ? 'H4' : 'H4',
        'H1',
        'M15'
      );

      // Debug: Log first analysis result
      if (debugStats.totalIterations === 1) {
        console.log(`[Backtest Debug] First analysis - HTF bias: ${analysis.htf.bias}, MTF bias: ${analysis.mtf.bias}, LTF bias: ${analysis.ltf.bias}`);
        console.log(`[Backtest Debug] MTF Order Blocks: ${analysis.mtf.orderBlocks.length} (Bullish: ${analysis.mtf.orderBlocks.filter(ob => ob.type === 'BULLISH').length}, Bearish: ${analysis.mtf.orderBlocks.filter(ob => ob.type === 'BEARISH').length})`);
        console.log(`[Backtest Debug] Current price: ${currentLTFCandle.close}`);
      }

      // SMC Enhancement filters
      // Check for liquidity sweep requirement
      if (this.config.requireLiquiditySweep && !analysis.recentLiquiditySweep?.isReversal) {
        continue; // Skip - no recent liquidity sweep
      }

      // Check for premium/discount zone requirement
      if (this.config.requirePremiumDiscount && analysis.premiumDiscount) {
        const { premium, discount, equilibrium } = analysis.premiumDiscount;
        const currentPrice = currentLTFCandle.close;
        // Must be in discount (below equilibrium) for potential buys or premium (above) for sells
        const inTradingZone = currentPrice < equilibrium || currentPrice > equilibrium;
        if (!inTradingZone) {
          continue; // Skip - price at equilibrium, not optimal
        }
      }

      // Create strategy context
      const context: StrategyContext = {
        symbol,
        currentPrice: currentLTFCandle.close,
        bid: currentLTFCandle.close,
        ask: currentLTFCandle.close + symbolInfo.pipSize,
        analysis,
        htfCandles: htfSlice,
        mtfCandles: mtfSlice,
        ltfCandles: ltfSlice,
      };

      // Run strategy
      const signal = runStrategy(this.config.strategy, context);

      if (signal) {
        debugStats.signalsGenerated++;

        // OTE (Optimal Trade Entry) filter
        if (this.config.requireOTE) {
          const isInOTE = this.checkOTEZone(signal.direction, currentLTFCandle.close, analysis);
          if (!isInOTE) {
            continue; // Skip - not in OTE zone
          }
        }

        // Apply kill zone confidence bonus
        if (this.config.useKillZones) {
          const bonus = getKillZoneBonus(currentTime);
          signal.confidence = Math.min(signal.confidence + bonus, 1);
        }

        // Apply fixed RR if configured
        let adjustedTakeProfit = signal.takeProfit;
        if (this.config.rrMode === 'fixed' && this.config.fixedRR) {
          const risk = Math.abs(signal.entryPrice - signal.stopLoss);
          if (signal.direction === 'BUY') {
            adjustedTakeProfit = signal.entryPrice + (risk * this.config.fixedRR);
          } else {
            adjustedTakeProfit = signal.entryPrice - (risk * this.config.fixedRR);
          }
        }

        // Apply max stop loss limit
        if (this.config.maxSlPips) {
          const slPips = Math.abs(signal.entryPrice - signal.stopLoss) / symbolInfo.pipSize;
          if (slPips > this.config.maxSlPips) {
            continue; // Skip - stop loss too wide
          }
        }

        // Calculate position size
        const positionInfo = calculatePositionSize(
          this.balance,
          this.config.riskPercent,
          signal.entryPrice,
          signal.stopLoss,
          {
            symbol,
            description: '',
            digits: 2,
            pipSize: symbolInfo.pipSize,
            contractSize: symbolInfo.contractSize,
            minVolume: symbolInfo.minVolume,
            maxVolume: symbolInfo.maxVolume,
            volumeStep: symbolInfo.volumeStep,
            tickSize: symbolInfo.tickSize,
            tickValue: symbolInfo.tickValue,
          }
        );

        // Open position
        this.openPosition = {
          id: uuidv4(),
          direction: signal.direction,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: adjustedTakeProfit,
          lotSize: positionInfo.lotSize,
          entryTime: currentTime,
        };
      }
    }

    // Close any remaining position at end
    if (this.openPosition) {
      const lastCandle = ltfCandles[ltfCandles.length - 1];
      this.closePosition(
        lastCandle.close,
        lastCandle.time,
        'SIGNAL',
        symbolInfo.contractSize
      );
    }

    // Log debug stats
    console.log(`[Backtest Debug] === BACKTEST SUMMARY ===`);
    console.log(`[Backtest Debug] Total iterations: ${debugStats.totalIterations}`);
    console.log(`[Backtest Debug] Skipped (kill zone): ${debugStats.skippedKillZone}`);
    console.log(`[Backtest Debug] Skipped (insufficient data): ${debugStats.skippedInsufficientData}`);
    console.log(`[Backtest Debug] Signals generated: ${debugStats.signalsGenerated}`);
    console.log(`[Backtest Debug] Trades executed: ${this.trades.length}`);
    console.log(`[Backtest Debug] Days locked out (${this.maxDailyDrawdownPercent}% daily DD limit): ${this.daysLockedOut}`);

    // Calculate metrics
    const metrics = this.calculateMetrics();

    // Emit complete
    this.emitProgress('complete', totalCandles, totalCandles);

    return {
      id: uuidv4(),
      config: this.config,
      metrics,
      trades: this.trades,
      equityCurve: this.equityCurve,
      drawdownCurve: this.calculateDrawdownCurve(),
    };
  }

  /**
   * Run backtest with tick data for more accurate fills
   */
  async runTickBacktest(
    htfCandles: Candle[],
    mtfCandles: Candle[],
    ltfCandles: Candle[],
    ticks: Tick[]
  ): Promise<BacktestResult> {
    this.reset();

    const symbol = this.config.symbol;
    const symbolInfo = DEFAULT_SYMBOL_INFO[symbol as keyof typeof DEFAULT_SYMBOL_INFO] || DEFAULT_SYMBOL_INFO['XAUUSD.s'];

    // Group ticks by candle periods
    let ltfIndex = 0;
    let lastAnalysisTime = 0;
    let lastSignalCheck = 0;

    for (const tick of ticks) {
      const tickTime = tick.time.getTime();

      // Update equity with current tick price
      if (this.openPosition) {
        // Check stop loss / take profit
        const exitResult = this.checkPositionExitTick(tick);
        if (exitResult) {
          this.closePosition(
            exitResult.price,
            tick.time,
            exitResult.reason,
            symbolInfo.contractSize
          );
        }
      }

      // Only check for new signals every 5 seconds (to avoid over-trading)
      if (tickTime - lastSignalCheck < 5000) {
        continue;
      }
      lastSignalCheck = tickTime;

      // Don't look for entries while in position
      if (this.openPosition) {
        continue;
      }

      // Update LTF candle index
      while (ltfIndex < ltfCandles.length - 1 &&
             ltfCandles[ltfIndex + 1].time.getTime() <= tickTime) {
        ltfIndex++;
      }

      // Only run analysis every minute
      if (tickTime - lastAnalysisTime < 60000) {
        continue;
      }
      lastAnalysisTime = tickTime;

      // Get historical data
      const currentTime = new Date(tickTime);
      const htfSlice = htfCandles.filter((c) => c.time <= currentTime).slice(-100);
      const mtfSlice = mtfCandles.filter((c) => c.time <= currentTime).slice(-200);
      const ltfSlice = ltfCandles.slice(Math.max(0, ltfIndex - 100), ltfIndex + 1);

      if (htfSlice.length < 50 || mtfSlice.length < 100 || ltfSlice.length < 50) {
        continue;
      }

      // Perform analysis
      const analysis = performMTFAnalysis(
        { htfCandles: htfSlice, mtfCandles: mtfSlice, ltfCandles: ltfSlice },
        symbol,
        'H4',
        'H1',
        'M15'
      );

      const context: StrategyContext = {
        symbol,
        currentPrice: (tick.bid + tick.ask) / 2,
        bid: tick.bid,
        ask: tick.ask,
        analysis,
        htfCandles: htfSlice,
        mtfCandles: mtfSlice,
        ltfCandles: ltfSlice,
      };

      const signal = runStrategy(this.config.strategy, context);

      if (signal) {
        const positionInfo = calculatePositionSize(
          this.balance,
          this.config.riskPercent,
          signal.direction === 'BUY' ? tick.ask : tick.bid,
          signal.stopLoss,
          {
            symbol,
            description: '',
            digits: 2,
            pipSize: symbolInfo.pipSize,
            contractSize: symbolInfo.contractSize,
            minVolume: symbolInfo.minVolume,
            maxVolume: symbolInfo.maxVolume,
            volumeStep: symbolInfo.volumeStep,
            tickSize: symbolInfo.tickSize,
            tickValue: symbolInfo.tickValue,
          }
        );

        this.openPosition = {
          id: uuidv4(),
          direction: signal.direction,
          entryPrice: signal.direction === 'BUY' ? tick.ask : tick.bid,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          lotSize: positionInfo.lotSize,
          entryTime: tick.time,
        };
      }

      // Update equity curve every minute
      this.updateEquityCurve(currentTime, (tick.bid + tick.ask) / 2);
    }

    // Close remaining position
    if (this.openPosition && ticks.length > 0) {
      const lastTick = ticks[ticks.length - 1];
      this.closePosition(
        this.openPosition.direction === 'BUY' ? lastTick.bid : lastTick.ask,
        lastTick.time,
        'SIGNAL',
        symbolInfo.contractSize
      );
    }

    const metrics = this.calculateMetrics();

    return {
      id: uuidv4(),
      config: this.config,
      metrics,
      trades: this.trades,
      equityCurve: this.equityCurve,
      drawdownCurve: this.calculateDrawdownCurve(),
    };
  }

  private reset(): void {
    this.balance = this.config.initialBalance;
    this.equity = this.config.initialBalance;
    this.peakEquity = this.config.initialBalance;
    this.openPosition = null;
    this.trades = [];
    this.equityCurve = [];
    this.grossProfit = 0;
    this.grossLoss = 0;
    this.maxDrawdownValue = 0;
    this.dailyTracker = null;
    this.daysLockedOut = 0;
  }

  private checkPositionExit(candle: Candle): { price: number; reason: 'TP' | 'SL' } | null {
    if (!this.openPosition) return null;

    const pos = this.openPosition;

    if (pos.direction === 'BUY') {
      // Check stop loss
      if (candle.low <= pos.stopLoss) {
        return { price: pos.stopLoss, reason: 'SL' };
      }
      // Check take profit
      if (candle.high >= pos.takeProfit) {
        return { price: pos.takeProfit, reason: 'TP' };
      }
    } else {
      // Check stop loss
      if (candle.high >= pos.stopLoss) {
        return { price: pos.stopLoss, reason: 'SL' };
      }
      // Check take profit
      if (candle.low <= pos.takeProfit) {
        return { price: pos.takeProfit, reason: 'TP' };
      }
    }

    return null;
  }

  private checkPositionExitTick(tick: Tick): { price: number; reason: 'TP' | 'SL' } | null {
    if (!this.openPosition) return null;

    const pos = this.openPosition;

    if (pos.direction === 'BUY') {
      // Check stop loss (exit at bid)
      if (tick.bid <= pos.stopLoss) {
        return { price: pos.stopLoss, reason: 'SL' };
      }
      // Check take profit (exit at bid)
      if (tick.bid >= pos.takeProfit) {
        return { price: pos.takeProfit, reason: 'TP' };
      }
    } else {
      // Check stop loss (exit at ask)
      if (tick.ask >= pos.stopLoss) {
        return { price: pos.stopLoss, reason: 'SL' };
      }
      // Check take profit (exit at ask)
      if (tick.ask <= pos.takeProfit) {
        return { price: pos.takeProfit, reason: 'TP' };
      }
    }

    return null;
  }

  private closePosition(
    exitPrice: number,
    exitTime: Date,
    reason: 'TP' | 'SL' | 'SIGNAL',
    contractSize: number
  ): BacktestTrade | undefined {
    if (!this.openPosition) return undefined;

    const pos = this.openPosition;

    // Calculate P&L
    let pnl: number;
    if (pos.direction === 'BUY') {
      pnl = (exitPrice - pos.entryPrice) * pos.lotSize * contractSize;
    } else {
      pnl = (pos.entryPrice - exitPrice) * pos.lotSize * contractSize;
    }

    const pnlPercent = (pnl / this.balance) * 100;

    // Track gross profit/loss
    if (pnl > 0) {
      this.grossProfit += pnl;
    } else {
      this.grossLoss += Math.abs(pnl);
    }

    // Update balance
    this.balance += pnl;
    this.equity = this.balance;

    // Track peak equity and max drawdown
    if (this.equity > this.peakEquity) {
      this.peakEquity = this.equity;
    }
    const currentDrawdown = ((this.peakEquity - this.equity) / this.peakEquity) * 100;
    if (currentDrawdown > this.maxDrawdownValue) {
      this.maxDrawdownValue = currentDrawdown;
    }

    // Record trade
    const trade: BacktestTrade = {
      symbol: this.config.symbol,
      direction: pos.direction,
      entryPrice: pos.entryPrice,
      exitPrice,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      lotSize: pos.lotSize,
      entryTime: pos.entryTime,
      exitTime,
      pnl,
      pnlPercent,
      isWinner: pnl > 0,
      exitReason: reason,
    };
    this.trades.push(trade);

    this.openPosition = null;
    return trade;
  }

  private updateEquityCurve(date: Date, currentPrice: number): void {
    let currentEquity = this.balance;

    if (this.openPosition) {
      const pos = this.openPosition;
      const symbolInfo = DEFAULT_SYMBOL_INFO[this.config.symbol as keyof typeof DEFAULT_SYMBOL_INFO] || DEFAULT_SYMBOL_INFO['XAUUSD.s'];

      let floatingPnL: number;
      if (pos.direction === 'BUY') {
        floatingPnL = (currentPrice - pos.entryPrice) * pos.lotSize * symbolInfo.contractSize;
      } else {
        floatingPnL = (pos.entryPrice - currentPrice) * pos.lotSize * symbolInfo.contractSize;
      }

      currentEquity += floatingPnL;
    }

    this.equity = currentEquity;

    // Only add to curve every hour to keep data manageable
    const lastEntry = this.equityCurve[this.equityCurve.length - 1];
    if (!lastEntry || date.getTime() - lastEntry.date.getTime() >= 3600000) {
      this.equityCurve.push({ date, equity: currentEquity });
    }
  }

  private calculateDrawdownCurve(): { date: Date; drawdown: number }[] {
    const drawdownCurve: { date: Date; drawdown: number }[] = [];
    let peak = this.config.initialBalance;

    for (const point of this.equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }

      const drawdown = peak > 0 ? ((peak - point.equity) / peak) * 100 : 0;
      drawdownCurve.push({ date: point.date, drawdown });
    }

    return drawdownCurve;
  }

  private calculateMetrics(): BacktestMetrics {
    const winningTrades = this.trades.filter((t) => t.isWinner);
    const losingTrades = this.trades.filter((t) => !t.isWinner);

    const totalPnl = this.trades.reduce((sum, t) => sum + t.pnl, 0);
    const totalPnlPercent = (totalPnl / this.config.initialBalance) * 100;

    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
      : 0;

    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length)
      : 0;

    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Calculate max drawdown
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    let peak = this.config.initialBalance;

    for (const point of this.equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const dd = peak - point.equity;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;

      if (dd > maxDrawdown) maxDrawdown = dd;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    }

    // Calculate Sharpe Ratio (simplified)
    const returns = this.trades.map((t) => t.pnlPercent);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
      : 0;
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

    // Average R:R
    const avgRR = this.trades.length > 0
      ? this.trades.reduce((sum, t) => {
          const rr = calculateRiskReward(
            t.direction,
            t.entryPrice,
            t.stopLoss,
            t.takeProfit
          );
          return sum + rr;
        }, 0) / this.trades.length
      : 0;

    return {
      totalTrades: this.trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: this.trades.length > 0 ? (winningTrades.length / this.trades.length) * 100 : 0,
      profitFactor: isFinite(profitFactor) ? profitFactor : 0,
      maxDrawdown,
      maxDrawdownPercent: maxDrawdownPct,
      sharpeRatio: isFinite(sharpeRatio) ? sharpeRatio : 0,
      averageWin: avgWin,
      averageLoss: avgLoss,
      averageRR: avgRR,
      totalPnl,
      totalPnlPercent,
      finalBalance: this.balance,
    };
  }
}

/**
 * Helper to create a backtest engine and run it
 */
export async function runBacktest(
  config: BacktestConfig,
  htfCandles: Candle[],
  mtfCandles: Candle[],
  ltfCandles: Candle[],
  ticks?: Tick[],
  onProgress?: ProgressCallback
): Promise<BacktestResult> {
  const engine = new BacktestEngine(config, onProgress);

  if (ticks && ticks.length > 0 && config.useTickData) {
    return engine.runTickBacktest(htfCandles, mtfCandles, ltfCandles, ticks);
  }

  return engine.runCandleBacktest(htfCandles, mtfCandles, ltfCandles);
}
