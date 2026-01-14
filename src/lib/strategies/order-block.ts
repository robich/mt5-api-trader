import { BaseStrategy, StrategySignal, StrategyContext } from './base';
import { StrategyType, Direction, OrderBlock, FairValueGap } from '../types';
import { isPriceAtOrderBlock, getNearestOrderBlock } from '../analysis/order-blocks';
import { getNearestFVG, isPriceInFVG } from '../analysis/fvg';
import { getOverallBias, getLiquidityTarget } from '../analysis/multi-timeframe';
import { findNearestSwingHigh, findNearestSwingLow, isPriceInDiscount, isPriceInPremium } from '../analysis/market-structure';

/**
 * Order Block + Fair Value Gap Strategy
 *
 * Entry Logic:
 * 1. HTF bias must be clear (bullish/bearish)
 * 2. Price retraces to MTF Order Block
 * 3. FVG confluence with the Order Block (extra confirmation)
 * 4. Entry on LTF when price enters the OB zone
 *
 * Stop Loss: Below/above the Order Block
 * Take Profit: Next liquidity zone or swing high/low
 */
export class OrderBlockStrategy extends BaseStrategy {
  readonly name: StrategyType = 'ORDER_BLOCK';
  readonly description = 'Order Block + FVG Confluence Strategy';

  // Debug counter (static to persist across calls)
  private static debugLogCount = 0;

  analyze(context: StrategyContext): StrategySignal | null {
    const { symbol, currentPrice, bid, ask, analysis, mtfCandles, ltfCandles } = context;

    // Get overall bias from MTF analysis
    const bias = getOverallBias(analysis);

    // Debug logging (only first 5 calls to avoid spam)
    if (OrderBlockStrategy.debugLogCount < 5) {
      console.log(`[OB Strategy Debug #${OrderBlockStrategy.debugLogCount + 1}] Bias: ${bias}, HTF: ${analysis.htf.bias}, MTF: ${analysis.mtf.bias}`);
      console.log(`[OB Strategy Debug] MTF OBs: ${analysis.mtf.orderBlocks.length}, Price: ${currentPrice}`);
      if (analysis.mtf.orderBlocks.length > 0) {
        const ob = analysis.mtf.orderBlocks[0];
        console.log(`[OB Strategy Debug] First OB: ${ob.type} @ ${ob.low}-${ob.high}`);
      }
      OrderBlockStrategy.debugLogCount++;
    }

    if (bias === 'NEUTRAL') {
      return null; // No clear direction
    }

    const direction: Direction = bias === 'BULLISH' ? 'BUY' : 'SELL';
    const entryPrice = this.getEntryPrice(direction, bid, ask);

    // Look for Order Block entry
    const signal = direction === 'BUY'
      ? this.analyzeBullishSetup(context, entryPrice)
      : this.analyzeBearishSetup(context, entryPrice);

    if (signal && this.validateSignal(signal)) {
      return signal;
    }

    return null;
  }

  private analyzeBullishSetup(
    context: StrategyContext,
    entryPrice: number
  ): StrategySignal | null {
    const { analysis, currentPrice } = context;

    // Find nearest bullish Order Block below current price
    const mtfOrderBlocks = analysis.mtf.orderBlocks.filter((ob) => ob.type === 'BULLISH');

    if (mtfOrderBlocks.length === 0) {
      return null;
    }

    // Check if price is at or near an Order Block
    let activeOB: OrderBlock | undefined;
    let hasFVGConfluence = false;

    for (const ob of mtfOrderBlocks) {
      // Check if price is in or near the OB zone (with generous tolerance for retest entries)
      const obRange = ob.high - ob.low;
      const tolerance = Math.max(obRange * 0.5, obRange); // At least 50% tolerance, or full OB range
      if (currentPrice >= ob.low - tolerance && currentPrice <= ob.high + tolerance) {
        activeOB = ob;

        // Check for FVG confluence
        const mtfFVGs = analysis.mtf.fvgs.filter((fvg) => fvg.type === 'BULLISH');
        for (const fvg of mtfFVGs) {
          // FVG overlaps with OB
          if (fvg.low <= ob.high && fvg.high >= ob.low) {
            hasFVGConfluence = true;
            break;
          }
        }

        break;
      }
    }

    if (!activeOB) {
      // Price is not at an Order Block - but still allow entry if we have recent OBs and price structure is good
      // This allows entries when price is moving away from an OB (momentum entry)
      if (mtfOrderBlocks.length > 0 && analysis.mtf.structure.lastBOS?.type === 'BOS') {
        activeOB = mtfOrderBlocks[0]; // Use most recent OB
      } else {
        return null;
      }
    }

    // Calculate stop loss (below OB with buffer)
    const stopLoss = activeOB.low - (activeOB.high - activeOB.low) * 0.2;

    // Calculate take profit (target liquidity or swing high)
    let takeProfit = getLiquidityTarget(currentPrice, analysis, 'BUY');

    if (!takeProfit) {
      // Fallback: use nearest swing high
      const swingHigh = findNearestSwingHigh(analysis.mtf.structure.swingPoints, currentPrice);
      if (swingHigh) {
        takeProfit = swingHigh.price;
      } else {
        // Use 2:1 RR as default
        const risk = entryPrice - stopLoss;
        takeProfit = entryPrice + risk * 2;
      }
    }

    // Calculate confidence
    let confidence = 0.5;
    const reasons: string[] = [`Bullish OB at ${activeOB.low.toFixed(2)}-${activeOB.high.toFixed(2)}`];

    // Higher TF alignment
    if (analysis.htf.bias === 'BULLISH') confidence += 0.15;

    // FVG confluence
    if (hasFVGConfluence) {
      confidence += 0.15;
      reasons.push('FVG confluence');
    }

    // MTF structure bullish
    if (analysis.mtf.structure.lastStructure === 'HH' ||
        analysis.mtf.structure.lastStructure === 'HL') {
      confidence += 0.1;
    }

    // BOS occurred
    if (analysis.mtf.structure.lastBOS?.type === 'BOS') confidence += 0.1;

    // SMC Enhancement: Premium/Discount zone check
    if (analysis.premiumDiscount) {
      const { premium, discount } = analysis.premiumDiscount;
      if (isPriceInDiscount(currentPrice, premium.high, discount.low)) {
        confidence += 0.1;
        reasons.push('Discount zone');
      }
    }

    // SMC Enhancement: CHoCH confirmation
    if (analysis.recentCHoCH?.type === 'BULLISH') {
      confidence += 0.1;
      reasons.push('CHoCH confirmed');
    }

    // SMC Enhancement: Liquidity sweep reversal
    if (analysis.recentLiquiditySweep?.isReversal &&
        analysis.recentLiquiditySweep.zone.type === 'LOW') {
      confidence += 0.15;
      reasons.push('Liquidity sweep');
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

  private analyzeBearishSetup(
    context: StrategyContext,
    entryPrice: number
  ): StrategySignal | null {
    const { analysis, currentPrice } = context;

    // Find nearest bearish Order Block above current price
    const mtfOrderBlocks = analysis.mtf.orderBlocks.filter((ob) => ob.type === 'BEARISH');

    if (mtfOrderBlocks.length === 0) {
      return null;
    }

    // Check if price is at or near an Order Block
    let activeOB: OrderBlock | undefined;
    let hasFVGConfluence = false;

    for (const ob of mtfOrderBlocks) {
      // Check if price is in or near the OB zone (with generous tolerance for retest entries)
      const obRange = ob.high - ob.low;
      const tolerance = Math.max(obRange * 0.5, obRange); // At least 50% tolerance, or full OB range
      if (currentPrice >= ob.low - tolerance && currentPrice <= ob.high + tolerance) {
        activeOB = ob;

        // Check for FVG confluence
        const mtfFVGs = analysis.mtf.fvgs.filter((fvg) => fvg.type === 'BEARISH');
        for (const fvg of mtfFVGs) {
          // FVG overlaps with OB
          if (fvg.low <= ob.high && fvg.high >= ob.low) {
            hasFVGConfluence = true;
            break;
          }
        }

        break;
      }
    }

    if (!activeOB) {
      // Price is not at an Order Block - but still allow entry if we have recent OBs and price structure is good
      // This allows entries when price is moving away from an OB (momentum entry)
      if (mtfOrderBlocks.length > 0 && analysis.mtf.structure.lastBOS?.type === 'BOS') {
        activeOB = mtfOrderBlocks[0]; // Use most recent OB
      } else {
        return null;
      }
    }

    // Calculate stop loss (above OB with buffer)
    const stopLoss = activeOB.high + (activeOB.high - activeOB.low) * 0.2;

    // Calculate take profit (target liquidity or swing low)
    let takeProfit = getLiquidityTarget(currentPrice, analysis, 'SELL');

    if (!takeProfit) {
      // Fallback: use nearest swing low
      const swingLow = findNearestSwingLow(analysis.mtf.structure.swingPoints, currentPrice);
      if (swingLow) {
        takeProfit = swingLow.price;
      } else {
        // Use 2:1 RR as default
        const risk = stopLoss - entryPrice;
        takeProfit = entryPrice - risk * 2;
      }
    }

    // Calculate confidence
    let confidence = 0.5;
    const reasons: string[] = [`Bearish OB at ${activeOB.low.toFixed(2)}-${activeOB.high.toFixed(2)}`];

    // Higher TF alignment
    if (analysis.htf.bias === 'BEARISH') confidence += 0.15;

    // FVG confluence
    if (hasFVGConfluence) {
      confidence += 0.15;
      reasons.push('FVG confluence');
    }

    // MTF structure bearish
    if (analysis.mtf.structure.lastStructure === 'LL' ||
        analysis.mtf.structure.lastStructure === 'LH') {
      confidence += 0.1;
    }

    // BOS occurred
    if (analysis.mtf.structure.lastBOS?.type === 'BOS') confidence += 0.1;

    // SMC Enhancement: Premium/Discount zone check
    if (analysis.premiumDiscount) {
      const { premium, discount } = analysis.premiumDiscount;
      if (isPriceInPremium(currentPrice, premium.high, discount.low)) {
        confidence += 0.1;
        reasons.push('Premium zone');
      }
    }

    // SMC Enhancement: CHoCH confirmation
    if (analysis.recentCHoCH?.type === 'BEARISH') {
      confidence += 0.1;
      reasons.push('CHoCH confirmed');
    }

    // SMC Enhancement: Liquidity sweep reversal
    if (analysis.recentLiquiditySweep?.isReversal &&
        analysis.recentLiquiditySweep.zone.type === 'HIGH') {
      confidence += 0.15;
      reasons.push('Liquidity sweep');
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

export const orderBlockStrategy = new OrderBlockStrategy();
