import { BaseStrategy, StrategySignal, StrategyContext } from './base';
import { StrategyType, FairValueGap, Candle } from '../types';
import { getOverallBias, getLiquidityTarget } from '../analysis/multi-timeframe';
import { isPriceInDiscount, isPriceInPremium } from '../analysis/market-structure';

/**
 * FVG Entry Strategy (Standalone Fair Value Gap Fill)
 *
 * Institutional concept: Fair Value Gaps represent imbalances in price delivery
 * where one side (buyers or sellers) dominated aggressively. Price has a natural
 * tendency to return to these gaps to "rebalance" - filling the gap before
 * continuing in the original direction.
 *
 * This differs from using FVG as mere confluence (which ORDER_BLOCK already does).
 * Here, the FVG itself IS the entry trigger.
 *
 * Entry Logic:
 * 1. Identify significant MTF FVGs (gaps created by displacement candles)
 * 2. Wait for price to retrace INTO the FVG zone (gap fill)
 * 3. Enter when price shows rejection inside the FVG (respects the gap)
 * 4. FVG must align with HTF bias direction
 *
 * Quality Filters:
 * - FVG size must be meaningful (>0.3% of price for BTC, >0.1% for Gold)
 * - The displacement candle that created the FVG should be strong (large body)
 * - FVG should be "fresh" (not previously tested)
 *
 * Stop Loss: Beyond the full FVG zone (opposite side of the gap)
 * Take Profit: Origin of the displacement move, or next liquidity target
 *
 * Best for: XAUUSD.s, BTCUSD (high-volatility = larger, cleaner FVGs)
 */
export class FVGEntryStrategy extends BaseStrategy {
  readonly name: StrategyType = 'FVG_ENTRY';
  readonly description = 'Standalone FVG Fill Entry Strategy';

  // Minimum FVG size as percentage of price
  private readonly MIN_FVG_SIZE_PCT = 0.0005; // 0.05% minimum gap size

  analyze(context: StrategyContext): StrategySignal | null {
    const { analysis, currentPrice, bid, ask, ltfCandles, mtfCandles } = context;

    if (mtfCandles.length < 20 || ltfCandles.length < 10) {
      return null;
    }

    // Get overall bias - only trade FVGs in bias direction
    const bias = getOverallBias(analysis);
    if (bias === 'NEUTRAL') {
      return null;
    }

    // Get unfilled FVGs from MTF analysis
    const mtfFVGs = analysis.mtf.fvgs;
    if (mtfFVGs.length === 0) {
      return null;
    }

    // Filter for significant FVGs in the bias direction
    const qualityFVGs = this.filterQualityFVGs(mtfFVGs, bias, currentPrice, mtfCandles);

    if (qualityFVGs.length === 0) {
      return null;
    }

    // Check if price is currently filling any quality FVG
    for (const fvg of qualityFVGs) {
      const signal = this.checkFVGFillEntry(context, fvg, bias);
      if (signal && this.validateSignal(signal)) {
        return signal;
      }
    }

    return null;
  }

  /**
   * Filter FVGs for quality: size, freshness, and direction alignment
   */
  private filterQualityFVGs(
    fvgs: FairValueGap[],
    bias: 'BULLISH' | 'BEARISH',
    currentPrice: number,
    mtfCandles: Candle[]
  ): FairValueGap[] {
    const minGapSize = currentPrice * this.MIN_FVG_SIZE_PCT;

    return fvgs.filter(fvg => {
      // Direction alignment
      if (bias === 'BULLISH' && fvg.type !== 'BULLISH') return false;
      if (bias === 'BEARISH' && fvg.type !== 'BEARISH') return false;

      // Size filter
      const gapSize = Math.abs(fvg.high - fvg.low);
      if (gapSize < minGapSize) return false;

      // Not already filled
      if (fvg.isFilled) return false;

      // Price must be near or approaching the FVG (within 2x gap size)
      const distanceToFVG = fvg.type === 'BULLISH'
        ? currentPrice - fvg.high  // For bullish FVG, price should be above or at the gap
        : fvg.low - currentPrice;  // For bearish FVG, price should be below or at the gap

      // We want price to be approaching or inside the FVG
      // For bullish FVG: price retracing down into the gap
      // For bearish FVG: price retracing up into the gap
      if (fvg.type === 'BULLISH') {
        // Price should be at or below the FVG high (retracing into it)
        if (currentPrice > fvg.high + gapSize) return false;
        // Price shouldn't be too far below the FVG
        if (currentPrice < fvg.low - gapSize) return false;
      } else {
        // Price should be at or above the FVG low (retracing into it)
        if (currentPrice < fvg.low - gapSize) return false;
        // Price shouldn't be too far above the FVG
        if (currentPrice > fvg.high + gapSize) return false;
      }

      return true;
    }).sort((a, b) => {
      // Sort by proximity to current price (nearest first)
      const distA = Math.abs(currentPrice - (a.high + a.low) / 2);
      const distB = Math.abs(currentPrice - (b.high + b.low) / 2);
      return distA - distB;
    }).slice(0, 3); // Top 3 nearest FVGs
  }

  /**
   * Check if price is filling an FVG and generating an entry signal
   */
  private checkFVGFillEntry(
    context: StrategyContext,
    fvg: FairValueGap,
    bias: 'BULLISH' | 'BEARISH'
  ): StrategySignal | null {
    const { analysis, currentPrice, bid, ask, ltfCandles } = context;

    const gapSize = fvg.high - fvg.low;
    const gapMid = (fvg.high + fvg.low) / 2;

    if (bias === 'BULLISH') {
      return this.checkBullishFVGFill(context, fvg, gapSize, gapMid);
    } else {
      return this.checkBearishFVGFill(context, fvg, gapSize, gapMid);
    }
  }

  /**
   * Bullish FVG fill entry: price retraces down into a bullish FVG, then bounces
   */
  private checkBullishFVGFill(
    context: StrategyContext,
    fvg: FairValueGap,
    gapSize: number,
    gapMid: number
  ): StrategySignal | null {
    const { analysis, currentPrice, bid, ltfCandles } = context;

    // Price must be inside or just touched the FVG zone
    // Accept entry from the FVG high (conservative) to the FVG low (deep fill)
    const isInsideFVG = currentPrice >= fvg.low && currentPrice <= fvg.high;
    const isNearFVG = currentPrice >= fvg.low - gapSize * 0.2 && currentPrice <= fvg.high;

    if (!isInsideFVG && !isNearFVG) {
      return null;
    }

    // Check for rejection / bullish reaction on LTF
    const recentCandles = ltfCandles.slice(-3);
    const lastCandle = recentCandles[recentCandles.length - 1];

    // Bullish rejection: candle dipped into FVG and closed bullish
    const isBullishReaction = lastCandle.close > lastCandle.open;
    const touchedFVG = lastCandle.low <= fvg.high;

    if (!isBullishReaction || !touchedFVG) {
      return null;
    }

    const entryPrice = bid;

    // Stop loss below the FVG with buffer
    const stopLoss = fvg.low - gapSize * 0.3;

    // Take profit: liquidity target or displacement origin
    let takeProfit = getLiquidityTarget(currentPrice, analysis, 'BUY');

    if (!takeProfit) {
      // Default: 2.5R target
      const risk = entryPrice - stopLoss;
      takeProfit = entryPrice + risk * 2.5;
    }

    // Confidence calculation
    let confidence = 0.55;
    const reasons: string[] = [`Bullish FVG fill at ${fvg.low.toFixed(2)}-${fvg.high.toFixed(2)}`];

    // Deep into FVG (better fill = higher probability)
    if (currentPrice <= gapMid) {
      confidence += 0.1;
      reasons.push('Deep fill');
    }

    // HTF alignment
    if (analysis.htf.bias === 'BULLISH') {
      confidence += 0.1;
      reasons.push('HTF bullish');
    }

    // OB confluence (FVG overlaps with OB = institutional confluence)
    const hasOBConfluence = analysis.mtf.orderBlocks.some(
      ob => ob.type === 'BULLISH' && ob.high >= fvg.low && ob.low <= fvg.high
    );
    if (hasOBConfluence) {
      confidence += 0.15;
      reasons.push('OB+FVG confluence');
    }

    // Premium/Discount zone
    if (analysis.premiumDiscount) {
      const { premium, discount } = analysis.premiumDiscount;
      if (isPriceInDiscount(currentPrice, premium.high, discount.low)) {
        confidence += 0.1;
        reasons.push('Discount zone');
      }
    }

    // LTF structure confirmation
    if (analysis.ltf.structure.lastStructure === 'HH' ||
        analysis.ltf.structure.lastStructure === 'HL') {
      confidence += 0.05;
      reasons.push('LTF bullish');
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
   * Bearish FVG fill entry: price retraces up into a bearish FVG, then drops
   */
  private checkBearishFVGFill(
    context: StrategyContext,
    fvg: FairValueGap,
    gapSize: number,
    gapMid: number
  ): StrategySignal | null {
    const { analysis, currentPrice, ask, ltfCandles } = context;

    const isInsideFVG = currentPrice >= fvg.low && currentPrice <= fvg.high;
    const isNearFVG = currentPrice >= fvg.low && currentPrice <= fvg.high + gapSize * 0.2;

    if (!isInsideFVG && !isNearFVG) {
      return null;
    }

    const recentCandles = ltfCandles.slice(-3);
    const lastCandle = recentCandles[recentCandles.length - 1];

    const isBearishReaction = lastCandle.close < lastCandle.open;
    const touchedFVG = lastCandle.high >= fvg.low;

    if (!isBearishReaction || !touchedFVG) {
      return null;
    }

    const entryPrice = ask;
    const stopLoss = fvg.high + gapSize * 0.3;

    let takeProfit = getLiquidityTarget(currentPrice, analysis, 'SELL');

    if (!takeProfit) {
      const risk = stopLoss - entryPrice;
      takeProfit = entryPrice - risk * 2.5;
    }

    let confidence = 0.55;
    const reasons: string[] = [`Bearish FVG fill at ${fvg.low.toFixed(2)}-${fvg.high.toFixed(2)}`];

    if (currentPrice >= gapMid) {
      confidence += 0.1;
      reasons.push('Deep fill');
    }

    if (analysis.htf.bias === 'BEARISH') {
      confidence += 0.1;
      reasons.push('HTF bearish');
    }

    const hasOBConfluence = analysis.mtf.orderBlocks.some(
      ob => ob.type === 'BEARISH' && ob.high >= fvg.low && ob.low <= fvg.high
    );
    if (hasOBConfluence) {
      confidence += 0.15;
      reasons.push('OB+FVG confluence');
    }

    if (analysis.premiumDiscount) {
      const { premium, discount } = analysis.premiumDiscount;
      if (isPriceInPremium(currentPrice, premium.high, discount.low)) {
        confidence += 0.1;
        reasons.push('Premium zone');
      }
    }

    if (analysis.ltf.structure.lastStructure === 'LL' ||
        analysis.ltf.structure.lastStructure === 'LH') {
      confidence += 0.05;
      reasons.push('LTF bearish');
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

export const fvgEntryStrategy = new FVGEntryStrategy();
