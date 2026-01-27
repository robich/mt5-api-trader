import { BaseStrategy, type StrategyContext, type StrategySignal } from './base';
import { Candle, StrategyType } from '../types';

/**
 * M1 Trend Strategy - EMA-based trend following
 *
 * Optimized for: XAUUSD.s, XAGUSD.s (metals perform best)
 *
 * Uses triple EMA alignment (9/21/50) to determine trend direction.
 * Enters on pullbacks to fast EMA with momentum confirmation.
 *
 * Backtest Results (Jan 2026):
 * - XAUUSD.s: RR2|DD6% -> $478, 51.9% WR, PF 2.56
 * - XAGUSD.s: Tiered 30@1R|30@2R|40@4R -> $869, 29.5% WR, PF 1.56
 */
export class M1TrendStrategy extends BaseStrategy {
  readonly name: StrategyType = 'M1_TREND';
  readonly description = 'EMA-based trend following on LTF with pullback entries';

  // EMA periods
  private readonly fastPeriod = 9;
  private readonly mediumPeriod = 21;
  private readonly slowPeriod = 50;

  // Minimum candles needed for EMA calculation
  private readonly minCandles = 55;

  /**
   * Calculate Exponential Moving Average
   */
  private calculateEMA(values: number[], period: number): number {
    if (values.length < period) {
      return values[values.length - 1];
    }

    const multiplier = 2 / (period + 1);

    // Start with SMA for the first 'period' values
    let ema = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;

    // Calculate EMA for remaining values
    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Determine trend direction based on EMA alignment
   */
  private determineTrend(
    ema9: number,
    ema21: number,
    ema50: number,
    prevEma9: number,
    prevEma21: number,
    currentPrice: number
  ): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
    // EMA alignment check
    const isBullishAlignment = ema9 > ema21 && ema21 > ema50;
    const isBearishAlignment = ema9 < ema21 && ema21 < ema50;

    // Check for recent crossover (momentum signal)
    const bullishCrossover = prevEma9 <= prevEma21 && ema9 > ema21;
    const bearishCrossover = prevEma9 >= prevEma21 && ema9 < ema21;

    // Price position relative to slow EMA
    const priceAboveEma50 = currentPrice > ema50;
    const priceBelowEma50 = currentPrice < ema50;

    if ((isBullishAlignment || bullishCrossover) && priceAboveEma50) {
      return 'BULLISH';
    } else if ((isBearishAlignment || bearishCrossover) && priceBelowEma50) {
      return 'BEARISH';
    }

    return 'NEUTRAL';
  }

  /**
   * Check for bullish pullback entry
   */
  private checkBullishEntry(
    currentPrice: number,
    currentCandle: Candle,
    prevCandle: Candle,
    ema9: number,
    pullbackTolerance: number
  ): boolean {
    // Pullback conditions:
    // 1. Price pulled back to near EMA9
    // 2. Previous candle was bearish or touched EMA9
    // 3. Current candle shows bullish momentum
    const pullbackToEma =
      Math.abs(currentPrice - ema9) < pullbackTolerance ||
      (currentCandle.low <= ema9 * 1.001 && currentPrice > ema9);

    const wasPullback =
      prevCandle.close < prevCandle.open || prevCandle.low <= ema9 * 1.002;

    const hasMomentum =
      currentCandle.close > currentCandle.open && currentCandle.close > ema9;

    return (pullbackToEma || wasPullback) && hasMomentum;
  }

  /**
   * Check for bearish pullback entry
   */
  private checkBearishEntry(
    currentPrice: number,
    currentCandle: Candle,
    prevCandle: Candle,
    ema9: number,
    pullbackTolerance: number
  ): boolean {
    const pullbackToEma =
      Math.abs(currentPrice - ema9) < pullbackTolerance ||
      (currentCandle.high >= ema9 * 0.999 && currentPrice < ema9);

    const wasPullback =
      prevCandle.close > prevCandle.open || prevCandle.high >= ema9 * 0.998;

    const hasMomentum =
      currentCandle.close < currentCandle.open && currentCandle.close < ema9;

    return (pullbackToEma || wasPullback) && hasMomentum;
  }

  /**
   * Find swing low from recent candles
   */
  private findSwingLow(candles: Candle[]): number {
    return Math.min(...candles.map((c) => c.low));
  }

  /**
   * Find swing high from recent candles
   */
  private findSwingHigh(candles: Candle[]): number {
    return Math.max(...candles.map((c) => c.high));
  }

  /**
   * Main analysis method
   */
  analyze(context: StrategyContext): StrategySignal | null {
    const { currentPrice, ltfCandles } = context;

    // Need enough candles for EMA calculation
    if (ltfCandles.length < this.minCandles) {
      return null;
    }

    const closes = ltfCandles.map((c) => c.close);

    // Calculate current EMAs
    const ema9 = this.calculateEMA(closes, this.fastPeriod);
    const ema21 = this.calculateEMA(closes, this.mediumPeriod);
    const ema50 = this.calculateEMA(closes, this.slowPeriod);

    // Calculate previous EMAs for crossover detection
    const prevCloses = closes.slice(0, -1);
    const prevEma9 = this.calculateEMA(prevCloses, this.fastPeriod);
    const prevEma21 = this.calculateEMA(prevCloses, this.mediumPeriod);

    // Determine trend
    const trend = this.determineTrend(
      ema9,
      ema21,
      ema50,
      prevEma9,
      prevEma21,
      currentPrice
    );

    if (trend === 'NEUTRAL') {
      return null;
    }

    // Get current and previous candles
    const currentCandle = ltfCandles[ltfCandles.length - 1];
    const prevCandle = ltfCandles[ltfCandles.length - 2];

    if (!prevCandle) {
      return null;
    }

    // Pullback tolerance: 0.05% of price
    const pullbackTolerance = currentPrice * 0.0005;

    // Lookback for swing points (10 candles)
    const lookbackCandles = ltfCandles.slice(-10);

    // Default RR - will be overridden by bot config
    const defaultRR = 2.0;

    if (trend === 'BULLISH') {
      // Check bullish entry conditions
      if (
        !this.checkBullishEntry(
          currentPrice,
          currentCandle,
          prevCandle,
          ema9,
          pullbackTolerance
        )
      ) {
        return null;
      }

      // Find swing low for stop loss
      const swingLow = this.findSwingLow(lookbackCandles);
      if (swingLow >= currentPrice) {
        return null;
      }

      // Add buffer to stop loss (10% of risk)
      const slBuffer = (currentPrice - swingLow) * 0.1;
      const stopLoss = swingLow - slBuffer;
      const entryPrice = currentPrice;
      const risk = entryPrice - stopLoss;
      const takeProfit = entryPrice + risk * defaultRR;

      // Calculate confidence based on trend strength
      let confidence = 0.6; // Base confidence

      // Boost confidence for strong EMA alignment
      const emaSpread = (ema9 - ema50) / ema50;
      if (emaSpread > 0.002) confidence += 0.1; // Strong bullish spread

      // Boost for recent crossover
      if (prevEma9 <= prevEma21 && ema9 > ema21) confidence += 0.1;

      // Boost for price well above EMA50
      if (currentPrice > ema50 * 1.005) confidence += 0.1;

      confidence = Math.min(confidence, 0.95);

      return {
        direction: 'BUY',
        entryPrice,
        stopLoss,
        takeProfit,
        confidence,
        reason: `M1 Trend: Bullish EMA alignment (${this.fastPeriod}/${this.mediumPeriod}/${this.slowPeriod}), pullback entry at ${ema9.toFixed(2)}`,
      };
    } else {
      // BEARISH trend
      if (
        !this.checkBearishEntry(
          currentPrice,
          currentCandle,
          prevCandle,
          ema9,
          pullbackTolerance
        )
      ) {
        return null;
      }

      // Find swing high for stop loss
      const swingHigh = this.findSwingHigh(lookbackCandles);
      if (swingHigh <= currentPrice) {
        return null;
      }

      // Add buffer to stop loss
      const slBuffer = (swingHigh - currentPrice) * 0.1;
      const stopLoss = swingHigh + slBuffer;
      const entryPrice = currentPrice;
      const risk = stopLoss - entryPrice;
      const takeProfit = entryPrice - risk * defaultRR;

      // Calculate confidence
      let confidence = 0.6;

      const emaSpread = (ema50 - ema9) / ema50;
      if (emaSpread > 0.002) confidence += 0.1;

      if (prevEma9 >= prevEma21 && ema9 < ema21) confidence += 0.1;

      if (currentPrice < ema50 * 0.995) confidence += 0.1;

      confidence = Math.min(confidence, 0.95);

      return {
        direction: 'SELL',
        entryPrice,
        stopLoss,
        takeProfit,
        confidence,
        reason: `M1 Trend: Bearish EMA alignment (${this.fastPeriod}/${this.mediumPeriod}/${this.slowPeriod}), pullback entry at ${ema9.toFixed(2)}`,
      };
    }
  }
}

// Export singleton instance
export const m1TrendStrategy = new M1TrendStrategy();
