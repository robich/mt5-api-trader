import { BaseStrategy, StrategySignal, StrategyContext } from './base';
import { StrategyType, Candle } from '../types';
import { getOverallBias, getLiquidityTarget } from '../analysis/multi-timeframe';
import { isPriceInDiscount, isPriceInPremium } from '../analysis/market-structure';

/**
 * Previous Day High/Low Sweep Strategy (PDH/PDL)
 *
 * Institutional concept: The previous day's high (PDH) and low (PDL) are among
 * the most significant liquidity levels on any instrument. Retail traders place
 * stops above PDH and below PDL, and pending orders (breakout entries) sit at
 * these levels. Smart money routinely sweeps PDH/PDL to fill orders before
 * reversing.
 *
 * This is one of the highest-probability setups for intraday institutional trading.
 *
 * Entry Logic:
 * 1. Calculate PDH and PDL from previous day candles
 * 2. Detect when price sweeps PDH or PDL (breaks above/below by wick)
 * 3. Wait for reversal confirmation (rejection candle, structure shift)
 * 4. Enter in the reversal direction
 *
 * Additional filters:
 * - Prefer sweeps during London or NY session (kill zones)
 * - The sweep should be a "clean" sweep (wick above PDH, body closes below)
 * - Higher probability when aligned with HTF bias
 *
 * Stop Loss: Beyond the sweep extreme
 * Take Profit: Opposite daily level (PDL for PDH sweep, PDH for PDL sweep)
 *
 * Best for: XAUUSD.s (Gold has very clean daily level sweeps), BTCUSD
 */
export class PDHPDLSweepStrategy extends BaseStrategy {
  readonly name: StrategyType = 'PDH_PDL_SWEEP';
  readonly description = 'Previous Day High/Low Sweep Reversal Strategy';

  analyze(context: StrategyContext): StrategySignal | null {
    const { ltfCandles, htfCandles, mtfCandles } = context;

    if (ltfCandles.length < 50 || htfCandles.length < 10) {
      return null;
    }

    const currentCandle = ltfCandles[ltfCandles.length - 1];
    const currentTime = currentCandle.time;

    // Only trade during London or NY sessions (08:00-20:00 UTC)
    const currentHour = currentTime.getUTCHours();
    if (currentHour < 7 || currentHour > 20) {
      return null;
    }

    // Calculate PDH and PDL
    const pdLevels = this.getPreviousDayLevels(htfCandles, ltfCandles, currentTime);
    if (!pdLevels) {
      return null;
    }

    const recentCandles = ltfCandles.slice(-10);

    // Check for PDH sweep (price went above PDH then reversed)
    const pdhSweepSignal = this.detectPDHSweep(context, pdLevels, recentCandles);
    if (pdhSweepSignal && this.validateSignal(pdhSweepSignal)) {
      return pdhSweepSignal;
    }

    // Check for PDL sweep (price went below PDL then reversed)
    const pdlSweepSignal = this.detectPDLSweep(context, pdLevels, recentCandles);
    if (pdlSweepSignal && this.validateSignal(pdlSweepSignal)) {
      return pdlSweepSignal;
    }

    return null;
  }

  /**
   * Calculate Previous Day High, Low, and Close
   */
  private getPreviousDayLevels(
    htfCandles: Candle[],
    ltfCandles: Candle[],
    currentTime: Date
  ): { pdh: number; pdl: number; pdc: number; range: number } | null {
    // Get today's date
    const today = new Date(currentTime);
    today.setUTCHours(0, 0, 0, 0);

    // Try to use D1 candles from HTF if available
    const d1Candles = htfCandles.filter(c => {
      const cDate = new Date(c.time);
      cDate.setUTCHours(0, 0, 0, 0);
      return cDate.getTime() < today.getTime();
    });

    if (d1Candles.length > 0) {
      // Use the most recent complete daily candle
      const lastDailyCandle = d1Candles[d1Candles.length - 1];
      return {
        pdh: lastDailyCandle.high,
        pdl: lastDailyCandle.low,
        pdc: lastDailyCandle.close,
        range: lastDailyCandle.high - lastDailyCandle.low,
      };
    }

    // Fallback: build PDH/PDL from LTF candles for the previous calendar day
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const yesterdayCandles = ltfCandles.filter(c => {
      const cDate = new Date(c.time);
      cDate.setUTCHours(0, 0, 0, 0);
      return cDate.getTime() === yesterday.getTime();
    });

    if (yesterdayCandles.length < 10) {
      return null;
    }

    const pdh = Math.max(...yesterdayCandles.map(c => c.high));
    const pdl = Math.min(...yesterdayCandles.map(c => c.low));
    const pdc = yesterdayCandles[yesterdayCandles.length - 1].close;

    return { pdh, pdl, pdc, range: pdh - pdl };
  }

  /**
   * Detect PDH sweep and bearish reversal
   * (Price went above PDH, got rejected, now selling)
   */
  private detectPDHSweep(
    context: StrategyContext,
    pdLevels: { pdh: number; pdl: number; pdc: number; range: number },
    recentCandles: Candle[]
  ): StrategySignal | null {
    const { analysis, currentPrice, ask } = context;
    const { pdh, pdl, range } = pdLevels;

    // Find if any recent candle swept the PDH
    let sweepCandle: Candle | null = null;
    let sweepHigh = 0;

    for (const candle of recentCandles) {
      // Sweep = wick above PDH but body closes back below (or very near)
      const wentAbove = candle.high > pdh;
      const bodyBelow = candle.close <= pdh + range * 0.05; // Allow 5% buffer

      if (wentAbove && bodyBelow) {
        if (candle.high > sweepHigh) {
          sweepHigh = candle.high;
          sweepCandle = candle;
        }
      }
    }

    if (!sweepCandle) {
      return null;
    }

    // Current price must be below PDH (reversal in progress)
    if (currentPrice > pdh) {
      return null;
    }

    // Check for bearish reversal confirmation
    const lastCandle = recentCandles[recentCandles.length - 1];
    const isBearishCandle = lastCandle.close < lastCandle.open;
    const belowPDH = lastCandle.close < pdh;

    if (!isBearishCandle || !belowPDH) {
      return null;
    }

    // LTF bearish structure confirmation
    const hasLTFConfirmation =
      analysis.ltf.bias === 'BEARISH' ||
      analysis.ltf.structure.lastStructure === 'LL' ||
      analysis.ltf.structure.lastStructure === 'LH' ||
      analysis.recentCHoCH?.type === 'BEARISH';

    // Rejection wick from sweep candle
    const hasRejectionWick = sweepCandle.high - Math.max(sweepCandle.open, sweepCandle.close) >
                             Math.abs(sweepCandle.close - sweepCandle.open) * 0.5;

    if (!hasLTFConfirmation && !hasRejectionWick) {
      return null;
    }

    // Entry
    const entryPrice = ask;
    const stopLoss = sweepHigh + range * 0.05; // Above the sweep high

    // Take profit: PDL (opposite daily level) or liquidity target
    let takeProfit = pdl;
    const liquidityTarget = getLiquidityTarget(currentPrice, analysis, 'SELL');
    if (liquidityTarget && liquidityTarget < pdl) {
      takeProfit = liquidityTarget;
    }

    // Ensure minimum RR
    const risk = stopLoss - entryPrice;
    const minTP = entryPrice - risk * 2.0;
    if (takeProfit > minTP) {
      takeProfit = minTP;
    }

    let confidence = 0.6;
    const reasons: string[] = [`PDH sweep at ${pdh.toFixed(2)}`];

    // HTF bearish alignment
    if (analysis.htf.bias === 'BEARISH') {
      confidence += 0.1;
      reasons.push('HTF bearish');
    }

    // LTF confirmation
    if (hasLTFConfirmation) {
      confidence += 0.1;
      reasons.push('LTF bearish shift');
    }

    // Strong rejection wick
    if (hasRejectionWick) {
      confidence += 0.1;
      reasons.push('Rejection wick');
    }

    // OB confluence near PDH
    const hasOBConfluence = analysis.mtf.orderBlocks.some(
      ob => ob.type === 'BEARISH' && currentPrice <= ob.high && currentPrice >= ob.low * 0.98
    );
    if (hasOBConfluence) {
      confidence += 0.1;
      reasons.push('OB confluence');
    }

    // Premium zone (sweeping PDH is inherently premium)
    if (analysis.premiumDiscount) {
      const { premium, discount } = analysis.premiumDiscount;
      if (isPriceInPremium(currentPrice, premium.high, discount.low)) {
        confidence += 0.05;
        reasons.push('Premium zone');
      }
    }

    // Previous day close position (if PDC is below midpoint, bearish bias for sweep)
    if (pdLevels.pdc < (pdh + pdl) / 2) {
      confidence += 0.05;
      reasons.push('PDC bearish');
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

  /**
   * Detect PDL sweep and bullish reversal
   * (Price went below PDL, got rejected, now buying)
   */
  private detectPDLSweep(
    context: StrategyContext,
    pdLevels: { pdh: number; pdl: number; pdc: number; range: number },
    recentCandles: Candle[]
  ): StrategySignal | null {
    const { analysis, currentPrice, bid } = context;
    const { pdh, pdl, range } = pdLevels;

    let sweepCandle: Candle | null = null;
    let sweepLow = Infinity;

    for (const candle of recentCandles) {
      const wentBelow = candle.low < pdl;
      const bodyAbove = candle.close >= pdl - range * 0.05;

      if (wentBelow && bodyAbove) {
        if (candle.low < sweepLow) {
          sweepLow = candle.low;
          sweepCandle = candle;
        }
      }
    }

    if (!sweepCandle) {
      return null;
    }

    if (currentPrice < pdl) {
      return null;
    }

    const lastCandle = recentCandles[recentCandles.length - 1];
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const abovePDL = lastCandle.close > pdl;

    if (!isBullishCandle || !abovePDL) {
      return null;
    }

    const hasLTFConfirmation =
      analysis.ltf.bias === 'BULLISH' ||
      analysis.ltf.structure.lastStructure === 'HH' ||
      analysis.ltf.structure.lastStructure === 'HL' ||
      analysis.recentCHoCH?.type === 'BULLISH';

    const hasRejectionWick = Math.min(sweepCandle.open, sweepCandle.close) - sweepCandle.low >
                             Math.abs(sweepCandle.close - sweepCandle.open) * 0.5;

    if (!hasLTFConfirmation && !hasRejectionWick) {
      return null;
    }

    const entryPrice = bid;
    const stopLoss = sweepLow - range * 0.05;

    let takeProfit = pdh;
    const liquidityTarget = getLiquidityTarget(currentPrice, analysis, 'BUY');
    if (liquidityTarget && liquidityTarget > pdh) {
      takeProfit = liquidityTarget;
    }

    const risk = entryPrice - stopLoss;
    const minTP = entryPrice + risk * 2.0;
    if (takeProfit < minTP) {
      takeProfit = minTP;
    }

    let confidence = 0.6;
    const reasons: string[] = [`PDL sweep at ${pdl.toFixed(2)}`];

    if (analysis.htf.bias === 'BULLISH') {
      confidence += 0.1;
      reasons.push('HTF bullish');
    }

    if (hasLTFConfirmation) {
      confidence += 0.1;
      reasons.push('LTF bullish shift');
    }

    if (hasRejectionWick) {
      confidence += 0.1;
      reasons.push('Rejection wick');
    }

    const hasOBConfluence = analysis.mtf.orderBlocks.some(
      ob => ob.type === 'BULLISH' && currentPrice >= ob.low && currentPrice <= ob.high * 1.02
    );
    if (hasOBConfluence) {
      confidence += 0.1;
      reasons.push('OB confluence');
    }

    if (analysis.premiumDiscount) {
      const { premium, discount } = analysis.premiumDiscount;
      if (isPriceInDiscount(currentPrice, premium.high, discount.low)) {
        confidence += 0.05;
        reasons.push('Discount zone');
      }
    }

    if (pdLevels.pdc > (pdh + pdl) / 2) {
      confidence += 0.05;
      reasons.push('PDC bullish');
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
}

export const pdhPdlSweepStrategy = new PDHPDLSweepStrategy();
