import { BaseStrategy, StrategySignal, StrategyContext } from './base';
import { StrategyType, OrderBlock, Candle } from '../types';
import { getOverallBias, getLiquidityTarget } from '../analysis/multi-timeframe';
import { isPriceInDiscount, isPriceInPremium, findNearestSwingHigh, findNearestSwingLow } from '../analysis/market-structure';

/**
 * Breaker Block Strategy
 *
 * Institutional concept: When an Order Block gets "mitigated" (price closes through it
 * decisively), the OB doesn't just disappear - it flips polarity and becomes a
 * "Breaker Block." A bullish OB that gets broken becomes bearish resistance, and
 * vice versa.
 *
 * This is a pure order flow concept: the institutions that placed orders at the OB
 * are now trapped. When price returns to test the breaker, those trapped traders
 * exit, creating a strong reaction in the new direction.
 *
 * Entry Logic:
 * 1. Identify a valid Order Block on MTF
 * 2. Detect when price fully mitigates it (closes through the OB zone)
 * 3. Wait for price to retrace back to the mitigated OB zone (now a breaker)
 * 4. Enter on the retest with confirmation (rejection candle)
 *
 * Key difference from FBO_STRUCTURE:
 * - FBO_STRUCTURE looks for failed BOS at swing points
 * - BREAKER_BLOCK specifically targets mitigated Order Blocks (a more precise zone)
 *
 * Stop Loss: Beyond the breaker block zone
 * Take Profit: Next liquidity target or structure level
 *
 * Best for: All instruments, especially during trending conditions
 */
export class BreakerBlockStrategy extends BaseStrategy {
  readonly name: StrategyType = 'BREAKER_BLOCK';
  readonly description = 'Mitigated Order Block Polarity Flip Strategy';

  analyze(context: StrategyContext): StrategySignal | null {
    const { analysis, currentPrice, mtfCandles, ltfCandles } = context;

    if (mtfCandles.length < 30 || ltfCandles.length < 10) {
      return null;
    }

    // Identify breaker blocks (mitigated OBs)
    const breakerBlocks = this.identifyBreakerBlocks(
      analysis.mtf.orderBlocks,
      mtfCandles,
      currentPrice
    );

    if (breakerBlocks.length === 0) {
      return null;
    }

    // Check if price is retesting any breaker block
    for (const breaker of breakerBlocks) {
      const signal = breaker.newDirection === 'BUY'
        ? this.checkBullishBreakerRetest(context, breaker)
        : this.checkBearishBreakerRetest(context, breaker);

      if (signal && this.validateSignal(signal)) {
        return signal;
      }
    }

    return null;
  }

  /**
   * Identify breaker blocks from mitigated Order Blocks
   * A breaker block is an OB that has been fully broken through (mitigated)
   */
  private identifyBreakerBlocks(
    orderBlocks: OrderBlock[],
    candles: Candle[],
    currentPrice: number
  ): BreakerBlock[] {
    const breakerBlocks: BreakerBlock[] = [];

    for (const ob of orderBlocks) {
      // Check if this OB has been mitigated (price closed through it)
      if (!ob.mitigatedAt) {
        // Check manually: did price close through this OB?
        const obTime = ob.candleTime.getTime();
        const postOBCandles = candles.filter(c => c.time.getTime() > obTime);

        let mitigated = false;
        let mitigationCandle: Candle | null = null;

        for (const candle of postOBCandles) {
          if (ob.type === 'BULLISH') {
            // Bullish OB mitigated when price closes below the OB low
            if (candle.close < ob.low) {
              mitigated = true;
              mitigationCandle = candle;
              break;
            }
          } else {
            // Bearish OB mitigated when price closes above the OB high
            if (candle.close > ob.high) {
              mitigated = true;
              mitigationCandle = candle;
              break;
            }
          }
        }

        if (!mitigated || !mitigationCandle) {
          continue;
        }

        // Check if price has moved away from the breaker and is now returning
        // (we need the retest, not the initial break)
        const postMitigationCandles = candles.filter(
          c => c.time.getTime() > mitigationCandle!.time.getTime()
        );

        if (postMitigationCandles.length < 2) {
          continue; // Need price to move away first
        }

        // The breaker block zone is the original OB zone, but with flipped polarity
        const newDirection: 'BUY' | 'SELL' = ob.type === 'BULLISH' ? 'SELL' : 'BUY';

        // For BUY breaker: old bearish OB was broken above, now acts as support
        // For SELL breaker: old bullish OB was broken below, now acts as resistance
        const breakerZone: BreakerBlock = {
          high: ob.high,
          low: ob.low,
          originalOB: ob,
          newDirection,
          mitigationTime: mitigationCandle.time,
          strength: this.calculateBreakerStrength(ob, mitigationCandle, postMitigationCandles),
        };

        // Only include breakers that price is currently near
        const zoneSize = ob.high - ob.low;
        const tolerance = zoneSize * 1.5;

        if (newDirection === 'BUY') {
          // Price should be approaching from above (retracing down to support)
          if (currentPrice >= ob.low - tolerance && currentPrice <= ob.high + tolerance) {
            breakerBlocks.push(breakerZone);
          }
        } else {
          // Price should be approaching from below (retracing up to resistance)
          if (currentPrice >= ob.low - tolerance && currentPrice <= ob.high + tolerance) {
            breakerBlocks.push(breakerZone);
          }
        }
      }
    }

    // Sort by strength (strongest first)
    return breakerBlocks.sort((a, b) => b.strength - a.strength).slice(0, 3);
  }

  /**
   * Calculate how strong a breaker block is likely to be
   */
  private calculateBreakerStrength(
    originalOB: OrderBlock,
    mitigationCandle: Candle,
    postMitigationCandles: Candle[]
  ): number {
    let strength = 0.5;

    // Stronger mitigation (larger displacement candle) = stronger breaker
    const mitigationBodySize = Math.abs(mitigationCandle.close - mitigationCandle.open);
    const obSize = originalOB.high - originalOB.low;
    if (mitigationBodySize > obSize * 1.5) {
      strength += 0.2; // Strong displacement through the OB
    } else if (mitigationBodySize > obSize) {
      strength += 0.1;
    }

    // Price moved far away from breaker = stronger when it returns
    if (postMitigationCandles.length > 5) {
      strength += 0.1;
    }

    // Fresh breaker (not tested many times) = stronger
    let retestCount = 0;
    for (const candle of postMitigationCandles) {
      if (candle.low <= originalOB.high && candle.high >= originalOB.low) {
        retestCount++;
      }
    }
    if (retestCount <= 1) {
      strength += 0.15; // Fresh breaker
    } else if (retestCount > 3) {
      strength -= 0.2; // Too many retests, weakened
    }

    return Math.max(0, Math.min(1, strength));
  }

  /**
   * Check bullish breaker retest (old bearish OB flipped to support)
   */
  private checkBullishBreakerRetest(
    context: StrategyContext,
    breaker: BreakerBlock
  ): StrategySignal | null {
    const { analysis, currentPrice, bid, ltfCandles } = context;

    // Price should be at or inside the breaker zone
    const isAtBreaker = currentPrice >= breaker.low && currentPrice <= breaker.high;
    const isNearBreaker = currentPrice >= breaker.low - (breaker.high - breaker.low) * 0.3 &&
                          currentPrice <= breaker.high;

    if (!isAtBreaker && !isNearBreaker) {
      return null;
    }

    // Check for bullish rejection on LTF
    const recentCandles = ltfCandles.slice(-3);
    const lastCandle = recentCandles[recentCandles.length - 1];

    const isBullishReaction = lastCandle.close > lastCandle.open;
    const touchedBreaker = lastCandle.low <= breaker.high;

    if (!isBullishReaction || !touchedBreaker) {
      return null;
    }

    const entryPrice = bid;
    const breakerSize = breaker.high - breaker.low;
    const stopLoss = breaker.low - breakerSize * 0.3;

    let takeProfit = getLiquidityTarget(currentPrice, analysis, 'BUY');
    if (!takeProfit) {
      const swingHigh = findNearestSwingHigh(analysis.mtf.structure.swingPoints, currentPrice);
      if (swingHigh) {
        takeProfit = swingHigh.price;
      } else {
        takeProfit = entryPrice + (entryPrice - stopLoss) * 2.5;
      }
    }

    const risk = entryPrice - stopLoss;
    const minTP = entryPrice + risk * 2.0;
    if (takeProfit < minTP) {
      takeProfit = minTP;
    }

    let confidence = 0.55;
    const reasons: string[] = [`Bullish Breaker at ${breaker.low.toFixed(2)}-${breaker.high.toFixed(2)}`];

    // Breaker strength
    if (breaker.strength > 0.7) {
      confidence += 0.1;
      reasons.push('Strong breaker');
    }

    // HTF alignment
    if (analysis.htf.bias === 'BULLISH') {
      confidence += 0.1;
      reasons.push('HTF bullish');
    }

    // FVG confluence inside breaker zone
    const hasFVGConfluence = analysis.mtf.fvgs.some(
      fvg => fvg.type === 'BULLISH' && fvg.high >= breaker.low && fvg.low <= breaker.high
    );
    if (hasFVGConfluence) {
      confidence += 0.1;
      reasons.push('FVG confluence');
    }

    // Premium/Discount zone
    if (analysis.premiumDiscount) {
      const { premium, discount } = analysis.premiumDiscount;
      if (isPriceInDiscount(currentPrice, premium.high, discount.low)) {
        confidence += 0.1;
        reasons.push('Discount zone');
      }
    }

    // LTF structure shift
    if (analysis.ltf.structure.lastStructure === 'HH' ||
        analysis.ltf.structure.lastStructure === 'HL') {
      confidence += 0.05;
      reasons.push('LTF bullish');
    }

    // Liquidity sweep before retest
    if (analysis.recentLiquiditySweep?.isReversal &&
        analysis.recentLiquiditySweep.zone.type === 'LOW') {
      confidence += 0.1;
      reasons.push('Liquidity swept');
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
   * Check bearish breaker retest (old bullish OB flipped to resistance)
   */
  private checkBearishBreakerRetest(
    context: StrategyContext,
    breaker: BreakerBlock
  ): StrategySignal | null {
    const { analysis, currentPrice, ask, ltfCandles } = context;

    const isAtBreaker = currentPrice >= breaker.low && currentPrice <= breaker.high;
    const isNearBreaker = currentPrice >= breaker.low &&
                          currentPrice <= breaker.high + (breaker.high - breaker.low) * 0.3;

    if (!isAtBreaker && !isNearBreaker) {
      return null;
    }

    const recentCandles = ltfCandles.slice(-3);
    const lastCandle = recentCandles[recentCandles.length - 1];

    const isBearishReaction = lastCandle.close < lastCandle.open;
    const touchedBreaker = lastCandle.high >= breaker.low;

    if (!isBearishReaction || !touchedBreaker) {
      return null;
    }

    const entryPrice = ask;
    const breakerSize = breaker.high - breaker.low;
    const stopLoss = breaker.high + breakerSize * 0.3;

    let takeProfit = getLiquidityTarget(currentPrice, analysis, 'SELL');
    if (!takeProfit) {
      const swingLow = findNearestSwingLow(analysis.mtf.structure.swingPoints, currentPrice);
      if (swingLow) {
        takeProfit = swingLow.price;
      } else {
        takeProfit = entryPrice - (stopLoss - entryPrice) * 2.5;
      }
    }

    const risk = stopLoss - entryPrice;
    const minTP = entryPrice - risk * 2.0;
    if (takeProfit > minTP) {
      takeProfit = minTP;
    }

    let confidence = 0.55;
    const reasons: string[] = [`Bearish Breaker at ${breaker.low.toFixed(2)}-${breaker.high.toFixed(2)}`];

    if (breaker.strength > 0.7) {
      confidence += 0.1;
      reasons.push('Strong breaker');
    }

    if (analysis.htf.bias === 'BEARISH') {
      confidence += 0.1;
      reasons.push('HTF bearish');
    }

    const hasFVGConfluence = analysis.mtf.fvgs.some(
      fvg => fvg.type === 'BEARISH' && fvg.high >= breaker.low && fvg.low <= breaker.high
    );
    if (hasFVGConfluence) {
      confidence += 0.1;
      reasons.push('FVG confluence');
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

    if (analysis.recentLiquiditySweep?.isReversal &&
        analysis.recentLiquiditySweep.zone.type === 'HIGH') {
      confidence += 0.1;
      reasons.push('Liquidity swept');
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

/**
 * Internal type for breaker block tracking
 */
interface BreakerBlock {
  high: number;
  low: number;
  originalOB: OrderBlock;
  newDirection: 'BUY' | 'SELL';
  mitigationTime: Date;
  strength: number; // 0-1 how strong the breaker is
}

export const breakerBlockStrategy = new BreakerBlockStrategy();
