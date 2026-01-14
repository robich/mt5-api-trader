import { BaseStrategy, StrategySignal, StrategyContext } from './base';
import { StrategyType, LiquidityZone } from '../types';
import { identifyEqualHighs, identifyEqualLows, detectLiquiditySweepReversal } from '../analysis/liquidity';
import { getOverallBias, getLiquidityTarget } from '../analysis/multi-timeframe';
import { isPriceInDiscount, isPriceInPremium } from '../analysis/market-structure';

/**
 * FBO Sweep & Reverse Strategy
 *
 * Entry Logic:
 * 1. Identify consolidation ranges (equal highs/lows)
 * 2. Wait for price to break out of the range (sweep liquidity)
 * 3. Look for immediate reversal (within 1-2 candles)
 * 4. Confirm with strong rejection candle (long wick, body closes inside range)
 * 5. Enter on the reversal direction
 *
 * This strategy targets stop hunts around range boundaries where
 * liquidity pools from retail traders accumulate.
 *
 * Stop Loss: Beyond the sweep high/low with small buffer
 * Take Profit: Opposite side of the range, then extend to next liquidity
 */
export class FBOSweepStrategy extends BaseStrategy {
  readonly name: StrategyType = 'FBO_SWEEP';
  readonly description = 'Fake Breakout Sweep & Reverse Strategy';

  analyze(context: StrategyContext): StrategySignal | null {
    const { symbol, analysis, ltfCandles, mtfCandles } = context;

    // Need sufficient candles for range detection
    if (ltfCandles.length < 20 || mtfCandles.length < 30) {
      return null;
    }

    // Identify equal highs (buy-side liquidity above range)
    const equalHighs = identifyEqualHighs(
      mtfCandles,
      symbol,
      analysis.mtf.timeframe,
      50, // lookback
      2   // minimum touches
    );

    // Identify equal lows (sell-side liquidity below range)
    const equalLows = identifyEqualLows(
      mtfCandles,
      symbol,
      analysis.mtf.timeframe,
      50,
      2
    );

    // Try bullish sweep reversal (sweep below equal lows)
    const bullishSignal = this.detectBullishSweepReversal(context, equalLows);
    if (bullishSignal && this.validateSignal(bullishSignal)) {
      return bullishSignal;
    }

    // Try bearish sweep reversal (sweep above equal highs)
    const bearishSignal = this.detectBearishSweepReversal(context, equalHighs);
    if (bearishSignal && this.validateSignal(bearishSignal)) {
      return bearishSignal;
    }

    return null;
  }

  private detectBullishSweepReversal(
    context: StrategyContext,
    equalLows: LiquidityZone[]
  ): StrategySignal | null {
    const { analysis, currentPrice, bid, ltfCandles } = context;

    // Only look when bias supports long direction
    const bias = getOverallBias(analysis);
    if (bias === 'BEARISH' && analysis.htf.bias === 'BEARISH') {
      return null;
    }

    const recentCandles = ltfCandles.slice(-5);

    for (const zone of equalLows) {
      // Check for sweep and reversal
      const sweepResult = detectLiquiditySweepReversal(zone, recentCandles, 3);

      if (sweepResult.isReversal && sweepResult.rejectionCandle) {
        const rejectionCandle = sweepResult.rejectionCandle;

        // Calculate range for targets
        // Find the nearest equal high for the range top
        const rangeTop = Math.max(
          ...analysis.mtf.structure.swingPoints
            .filter((s) => s.type === 'HIGH' && s.time > zone.candleTime)
            .slice(-3)
            .map((s) => s.price),
          currentPrice * 1.01 // Fallback
        );

        // Entry at current price
        const entryPrice = bid;

        // Stop loss below the sweep low with buffer
        const stopLoss = rejectionCandle.low - (Math.abs(rejectionCandle.high - rejectionCandle.low) * 0.3);

        // Take profit at range top first, then extend
        let takeProfit = rangeTop;

        // Try to extend to next liquidity
        const extendedTarget = getLiquidityTarget(currentPrice, analysis, 'BUY');
        if (extendedTarget && extendedTarget > rangeTop) {
          takeProfit = extendedTarget;
        }

        // Ensure minimum 1.5:1 RR
        const minTP = entryPrice + (entryPrice - stopLoss) * 1.5;
        if (takeProfit < minTP) {
          takeProfit = minTP;
        }

        // Calculate confidence
        let confidence = 0.55;
        const reasons: string[] = [`Sweep below ${zone.price.toFixed(2)}`];

        // HTF bullish alignment
        if (analysis.htf.bias === 'BULLISH') {
          confidence += 0.15;
          reasons.push('HTF bullish');
        }

        // Strong rejection wick
        const lowerWick = Math.min(rejectionCandle.open, rejectionCandle.close) - rejectionCandle.low;
        const bodySize = Math.abs(rejectionCandle.close - rejectionCandle.open);
        if (lowerWick > bodySize * 1.5) {
          confidence += 0.1;
          reasons.push('Strong rejection');
        }

        // Bullish close (close > open)
        if (rejectionCandle.close > rejectionCandle.open) {
          confidence += 0.05;
          reasons.push('Bullish close');
        }

        // Equal lows (multiple levels swept)
        if (equalLows.filter((z) => rejectionCandle.low < z.price).length > 1) {
          confidence += 0.1;
          reasons.push('Multi-level sweep');
        }

        // OB confluence
        const hasOBConfluence = analysis.mtf.orderBlocks.some(
          (ob) => ob.type === 'BULLISH' && currentPrice >= ob.low && currentPrice <= ob.high * 1.02
        );
        if (hasOBConfluence) {
          confidence += 0.1;
          reasons.push('OB confluence');
        }

        // Premium/Discount zone
        if (analysis.premiumDiscount) {
          const { premium, discount } = analysis.premiumDiscount;
          if (isPriceInDiscount(currentPrice, premium.high, discount.low)) {
            confidence += 0.1;
            reasons.push('Discount zone');
          }
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
    }

    return null;
  }

  private detectBearishSweepReversal(
    context: StrategyContext,
    equalHighs: LiquidityZone[]
  ): StrategySignal | null {
    const { analysis, currentPrice, ask, ltfCandles } = context;

    // Only look when bias supports short direction
    const bias = getOverallBias(analysis);
    if (bias === 'BULLISH' && analysis.htf.bias === 'BULLISH') {
      return null;
    }

    const recentCandles = ltfCandles.slice(-5);

    for (const zone of equalHighs) {
      // Check for sweep and reversal
      const sweepResult = detectLiquiditySweepReversal(zone, recentCandles, 3);

      if (sweepResult.isReversal && sweepResult.rejectionCandle) {
        const rejectionCandle = sweepResult.rejectionCandle;

        // Calculate range for targets
        // Find the nearest equal low for the range bottom
        const rangeBottom = Math.min(
          ...analysis.mtf.structure.swingPoints
            .filter((s) => s.type === 'LOW' && s.time > zone.candleTime)
            .slice(-3)
            .map((s) => s.price),
          currentPrice * 0.99 // Fallback
        );

        // Entry at current price
        const entryPrice = ask;

        // Stop loss above the sweep high with buffer
        const stopLoss = rejectionCandle.high + (Math.abs(rejectionCandle.high - rejectionCandle.low) * 0.3);

        // Take profit at range bottom first, then extend
        let takeProfit = rangeBottom;

        // Try to extend to next liquidity
        const extendedTarget = getLiquidityTarget(currentPrice, analysis, 'SELL');
        if (extendedTarget && extendedTarget < rangeBottom) {
          takeProfit = extendedTarget;
        }

        // Ensure minimum 1.5:1 RR
        const minTP = entryPrice - (stopLoss - entryPrice) * 1.5;
        if (takeProfit > minTP) {
          takeProfit = minTP;
        }

        // Calculate confidence
        let confidence = 0.55;
        const reasons: string[] = [`Sweep above ${zone.price.toFixed(2)}`];

        // HTF bearish alignment
        if (analysis.htf.bias === 'BEARISH') {
          confidence += 0.15;
          reasons.push('HTF bearish');
        }

        // Strong rejection wick
        const upperWick = rejectionCandle.high - Math.max(rejectionCandle.open, rejectionCandle.close);
        const bodySize = Math.abs(rejectionCandle.close - rejectionCandle.open);
        if (upperWick > bodySize * 1.5) {
          confidence += 0.1;
          reasons.push('Strong rejection');
        }

        // Bearish close (close < open)
        if (rejectionCandle.close < rejectionCandle.open) {
          confidence += 0.05;
          reasons.push('Bearish close');
        }

        // Equal highs (multiple levels swept)
        if (equalHighs.filter((z) => rejectionCandle.high > z.price).length > 1) {
          confidence += 0.1;
          reasons.push('Multi-level sweep');
        }

        // OB confluence
        const hasOBConfluence = analysis.mtf.orderBlocks.some(
          (ob) => ob.type === 'BEARISH' && currentPrice <= ob.high && currentPrice >= ob.low * 0.98
        );
        if (hasOBConfluence) {
          confidence += 0.1;
          reasons.push('OB confluence');
        }

        // Premium/Discount zone
        if (analysis.premiumDiscount) {
          const { premium, discount } = analysis.premiumDiscount;
          if (isPriceInPremium(currentPrice, premium.high, discount.low)) {
            confidence += 0.1;
            reasons.push('Premium zone');
          }
        }

        // CHoCH confirmation
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

    return null;
  }
}

export const fboSweepStrategy = new FBOSweepStrategy();
