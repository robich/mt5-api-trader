import { BaseStrategy, StrategySignal, StrategyContext } from './base';
import { StrategyType, Candle, Direction } from '../types';
import { getOverallBias, getLiquidityTarget } from '../analysis/multi-timeframe';
import { isPriceInDiscount, isPriceInPremium } from '../analysis/market-structure';

/**
 * Judas Swing Strategy (ICT Silver Bullet / Session Open Reversal)
 *
 * Institutional concept: At the open of London and New York sessions, smart money
 * engineers a "Judas swing" - a fake move that sweeps liquidity from the Asian range
 * (or prior session) before reversing into the real move of the day.
 *
 * Entry Logic:
 * 1. Mark the Asian session range (00:00-07:00 UTC) high and low
 * 2. At London open (07:00-08:30 UTC) or NY open (12:00-13:30 UTC), detect the
 *    initial move that breaks the Asian range (the Judas swing)
 * 3. Wait for price to reverse (rejection candle / structure shift on LTF)
 * 4. Enter in the direction of the reversal
 *
 * ICT Silver Bullet windows:
 * - London: 10:00-11:00 UTC (after the Judas move at 07:00-09:00)
 * - NY AM:  14:00-15:00 UTC (after the Judas move at 12:00-13:30)
 * - NY PM:  19:00-20:00 UTC (afternoon reversal window)
 *
 * Stop Loss: Beyond the Judas swing extreme (the fake move high/low)
 * Take Profit: Opposite side of Asian range, or next liquidity target
 *
 * Best for: XAUUSD, BTCUSD (high-volatility instruments with clear session patterns)
 */
export class JudasSwingStrategy extends BaseStrategy {
  readonly name: StrategyType = 'JUDAS_SWING';
  readonly description = 'ICT Judas Swing / Silver Bullet Session Reversal';

  // Asian session: 00:00-07:00 UTC
  private readonly ASIAN_START = 0;
  private readonly ASIAN_END = 7;

  // Judas swing windows (when the fake move happens)
  private readonly LONDON_JUDAS_START = 7;
  private readonly LONDON_JUDAS_END = 9;
  private readonly NY_JUDAS_START = 12;
  private readonly NY_JUDAS_END = 14;

  // Silver bullet entry windows (when the reversal entry is taken)
  private readonly LONDON_SB_START = 9;
  private readonly LONDON_SB_END = 11;
  private readonly NY_AM_SB_START = 14;
  private readonly NY_AM_SB_END = 15;

  analyze(context: StrategyContext): StrategySignal | null {
    const { ltfCandles, mtfCandles } = context;

    if (ltfCandles.length < 50 || mtfCandles.length < 20) {
      return null;
    }

    const currentCandle = ltfCandles[ltfCandles.length - 1];
    const currentTime = currentCandle.time;
    const currentHour = currentTime.getUTCHours();

    // Only look for entries during silver bullet windows
    const isInLondonSB = currentHour >= this.LONDON_SB_START && currentHour < this.LONDON_SB_END;
    const isInNYSB = currentHour >= this.NY_AM_SB_START && currentHour < this.NY_AM_SB_END;

    if (!isInLondonSB && !isInNYSB) {
      return null;
    }

    // Build the Asian session range from LTF candles
    const asianRange = this.getAsianRange(ltfCandles, currentTime);
    if (!asianRange) {
      return null;
    }

    // Determine which Judas window we're following
    const judasStart = isInLondonSB ? this.LONDON_JUDAS_START : this.NY_JUDAS_START;
    const judasEnd = isInLondonSB ? this.LONDON_JUDAS_END : this.NY_JUDAS_END;

    // Get candles from the Judas swing window
    const judasCandles = this.getCandlesInWindow(ltfCandles, currentTime, judasStart, judasEnd);
    if (judasCandles.length < 3) {
      return null;
    }

    // Find the Judas swing extreme
    const judasHigh = Math.max(...judasCandles.map(c => c.high));
    const judasLow = Math.min(...judasCandles.map(c => c.low));

    // Determine if Judas swept above or below the Asian range
    const sweptAbove = judasHigh > asianRange.high;
    const sweptBelow = judasLow < asianRange.low;

    if (!sweptAbove && !sweptBelow) {
      return null; // No sweep of the Asian range = no Judas swing
    }

    // If swept both, use the HTF bias to determine which is the Judas
    const bias = getOverallBias(context.analysis);

    // Get recent candles for reversal detection
    const recentCandles = ltfCandles.slice(-5);
    const currentPrice = context.currentPrice;

    // Case 1: Swept above Asian high (Judas was bullish) -> look for bearish reversal
    if (sweptAbove && (!sweptBelow || bias === 'BEARISH' || bias === 'NEUTRAL')) {
      const signal = this.detectBearishReversal(
        context,
        asianRange,
        judasHigh,
        recentCandles
      );
      if (signal && this.validateSignal(signal)) {
        return signal;
      }
    }

    // Case 2: Swept below Asian low (Judas was bearish) -> look for bullish reversal
    if (sweptBelow && (!sweptAbove || bias === 'BULLISH' || bias === 'NEUTRAL')) {
      const signal = this.detectBullishReversal(
        context,
        asianRange,
        judasLow,
        recentCandles
      );
      if (signal && this.validateSignal(signal)) {
        return signal;
      }
    }

    return null;
  }

  /**
   * Build the Asian session range from candle data
   */
  private getAsianRange(
    candles: Candle[],
    currentTime: Date
  ): { high: number; low: number; midpoint: number } | null {
    // Get today's date
    const today = new Date(currentTime);
    today.setUTCHours(0, 0, 0, 0);

    // Filter candles from the Asian session (00:00-07:00 UTC today)
    const asianCandles = candles.filter(c => {
      const cTime = c.time;
      const cHour = cTime.getUTCHours();
      const cDate = new Date(cTime);
      cDate.setUTCHours(0, 0, 0, 0);
      return cDate.getTime() === today.getTime() &&
             cHour >= this.ASIAN_START &&
             cHour < this.ASIAN_END;
    });

    if (asianCandles.length < 5) {
      return null;
    }

    const high = Math.max(...asianCandles.map(c => c.high));
    const low = Math.min(...asianCandles.map(c => c.low));

    return {
      high,
      low,
      midpoint: (high + low) / 2,
    };
  }

  /**
   * Get candles within a specific hour window on the same day
   */
  private getCandlesInWindow(
    candles: Candle[],
    currentTime: Date,
    startHour: number,
    endHour: number
  ): Candle[] {
    const today = new Date(currentTime);
    today.setUTCHours(0, 0, 0, 0);

    return candles.filter(c => {
      const cTime = c.time;
      const cHour = cTime.getUTCHours();
      const cDate = new Date(cTime);
      cDate.setUTCHours(0, 0, 0, 0);
      return cDate.getTime() === today.getTime() &&
             cHour >= startHour &&
             cHour < endHour;
    });
  }

  /**
   * Detect bullish reversal after bearish Judas swing (swept below Asian low)
   */
  private detectBullishReversal(
    context: StrategyContext,
    asianRange: { high: number; low: number; midpoint: number },
    judasLow: number,
    recentCandles: Candle[]
  ): StrategySignal | null {
    const { analysis, currentPrice, bid } = context;

    // Price must have come back above the Asian low (reversal in progress)
    if (currentPrice < asianRange.low) {
      return null;
    }

    // Check for reversal confirmation on recent candles
    const lastCandle = recentCandles[recentCandles.length - 1];
    const prevCandle = recentCandles.length > 1 ? recentCandles[recentCandles.length - 2] : null;

    // Reversal conditions:
    // 1. Last candle is bullish (close > open)
    // 2. Price reclaimed the Asian low
    // 3. Strong rejection from the Judas low (wick or structure shift)
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const reclaimedAsianLow = lastCandle.close > asianRange.low;

    if (!isBullishCandle || !reclaimedAsianLow) {
      return null;
    }

    // Additional: check for rejection wick or LTF bullish structure
    const hasLTFBullishShift =
      analysis.ltf.bias === 'BULLISH' ||
      analysis.ltf.structure.lastStructure === 'HH' ||
      analysis.ltf.structure.lastStructure === 'HL';

    const hasRejectionWick = prevCandle
      ? (Math.min(prevCandle.open, prevCandle.close) - prevCandle.low) >
        Math.abs(prevCandle.close - prevCandle.open) * 0.8
      : false;

    if (!hasLTFBullishShift && !hasRejectionWick) {
      return null;
    }

    // Entry
    const entryPrice = bid;

    // Stop loss below the Judas swing low with buffer
    const asianRangeSize = asianRange.high - asianRange.low;
    const stopLoss = judasLow - asianRangeSize * 0.1;

    // Take profit: opposite side of Asian range, then extend to liquidity
    let takeProfit = asianRange.high;
    const liquidityTarget = getLiquidityTarget(currentPrice, analysis, 'BUY');
    if (liquidityTarget && liquidityTarget > asianRange.high) {
      takeProfit = liquidityTarget;
    }

    // Ensure minimum RR
    const risk = entryPrice - stopLoss;
    const minTP = entryPrice + risk * 2.0;
    if (takeProfit < minTP) {
      takeProfit = minTP;
    }

    // Confidence
    let confidence = 0.6;
    const reasons: string[] = ['Bullish Judas Swing reversal'];

    // HTF alignment
    if (analysis.htf.bias === 'BULLISH') {
      confidence += 0.1;
      reasons.push('HTF bullish');
    }

    // LTF structure shift
    if (hasLTFBullishShift) {
      confidence += 0.1;
      reasons.push('LTF bullish shift');
    }

    // Strong rejection wick
    if (hasRejectionWick) {
      confidence += 0.1;
      reasons.push('Rejection wick');
    }

    // Price in discount zone
    if (analysis.premiumDiscount) {
      const { premium, discount } = analysis.premiumDiscount;
      if (isPriceInDiscount(currentPrice, premium.high, discount.low)) {
        confidence += 0.05;
        reasons.push('Discount zone');
      }
    }

    // OB confluence near entry
    const hasOBConfluence = analysis.mtf.orderBlocks.some(
      ob => ob.type === 'BULLISH' && currentPrice >= ob.low && currentPrice <= ob.high * 1.02
    );
    if (hasOBConfluence) {
      confidence += 0.1;
      reasons.push('OB confluence');
    }

    // CHoCH confirmation
    if (analysis.recentCHoCH?.type === 'BULLISH') {
      confidence += 0.05;
      reasons.push('CHoCH');
    }

    const rr = this.calculateRiskReward('BUY', entryPrice, stopLoss, takeProfit);
    reasons.push(`RR: ${rr.toFixed(2)}`);

    return {
      direction: 'BUY',
      entryPrice,
      stopLoss,
      takeProfit,
      confidence: Math.min(confidence, 1),
      reason: reasons.join(' + '),
    };
  }

  /**
   * Detect bearish reversal after bullish Judas swing (swept above Asian high)
   */
  private detectBearishReversal(
    context: StrategyContext,
    asianRange: { high: number; low: number; midpoint: number },
    judasHigh: number,
    recentCandles: Candle[]
  ): StrategySignal | null {
    const { analysis, currentPrice, ask } = context;

    // Price must have come back below the Asian high (reversal in progress)
    if (currentPrice > asianRange.high) {
      return null;
    }

    // Check for reversal confirmation
    const lastCandle = recentCandles[recentCandles.length - 1];
    const prevCandle = recentCandles.length > 1 ? recentCandles[recentCandles.length - 2] : null;

    const isBearishCandle = lastCandle.close < lastCandle.open;
    const reclaimedAsianHigh = lastCandle.close < asianRange.high;

    if (!isBearishCandle || !reclaimedAsianHigh) {
      return null;
    }

    const hasLTFBearishShift =
      analysis.ltf.bias === 'BEARISH' ||
      analysis.ltf.structure.lastStructure === 'LL' ||
      analysis.ltf.structure.lastStructure === 'LH';

    const hasRejectionWick = prevCandle
      ? (prevCandle.high - Math.max(prevCandle.open, prevCandle.close)) >
        Math.abs(prevCandle.close - prevCandle.open) * 0.8
      : false;

    if (!hasLTFBearishShift && !hasRejectionWick) {
      return null;
    }

    const entryPrice = ask;
    const asianRangeSize = asianRange.high - asianRange.low;
    const stopLoss = judasHigh + asianRangeSize * 0.1;

    let takeProfit = asianRange.low;
    const liquidityTarget = getLiquidityTarget(currentPrice, analysis, 'SELL');
    if (liquidityTarget && liquidityTarget < asianRange.low) {
      takeProfit = liquidityTarget;
    }

    const risk = stopLoss - entryPrice;
    const minTP = entryPrice - risk * 2.0;
    if (takeProfit > minTP) {
      takeProfit = minTP;
    }

    let confidence = 0.6;
    const reasons: string[] = ['Bearish Judas Swing reversal'];

    if (analysis.htf.bias === 'BEARISH') {
      confidence += 0.1;
      reasons.push('HTF bearish');
    }

    if (hasLTFBearishShift) {
      confidence += 0.1;
      reasons.push('LTF bearish shift');
    }

    if (hasRejectionWick) {
      confidence += 0.1;
      reasons.push('Rejection wick');
    }

    if (analysis.premiumDiscount) {
      const { premium, discount } = analysis.premiumDiscount;
      if (isPriceInPremium(currentPrice, premium.high, discount.low)) {
        confidence += 0.05;
        reasons.push('Premium zone');
      }
    }

    const hasOBConfluence = analysis.mtf.orderBlocks.some(
      ob => ob.type === 'BEARISH' && currentPrice <= ob.high && currentPrice >= ob.low * 0.98
    );
    if (hasOBConfluence) {
      confidence += 0.1;
      reasons.push('OB confluence');
    }

    if (analysis.recentCHoCH?.type === 'BEARISH') {
      confidence += 0.05;
      reasons.push('CHoCH');
    }

    const rr = this.calculateRiskReward('SELL', entryPrice, stopLoss, takeProfit);
    reasons.push(`RR: ${rr.toFixed(2)}`);

    return {
      direction: 'SELL',
      entryPrice,
      stopLoss,
      takeProfit,
      confidence: Math.min(confidence, 1),
      reason: reasons.join(' + '),
    };
  }
}

export const judasSwingStrategy = new JudasSwingStrategy();
