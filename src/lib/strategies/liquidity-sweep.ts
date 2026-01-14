import { BaseStrategy, StrategySignal, StrategyContext } from './base';
import { StrategyType, Direction, LiquidityZone } from '../types';
import {
  detectLiquiditySweepReversal,
  getNearestLiquidityZone,
  filterUnsweptLiquidity,
} from '../analysis/liquidity';
import { getOverallBias, getLiquidityTarget } from '../analysis/multi-timeframe';
import { findNearestSwingHigh, findNearestSwingLow, isPriceInDiscount, isPriceInPremium } from '../analysis/market-structure';

/**
 * Liquidity Sweep Strategy
 *
 * Entry Logic:
 * 1. Identify liquidity pools (swing highs/lows with multiple touches)
 * 2. Wait for price to sweep (take out) the liquidity
 * 3. Look for rejection candle (wick through, body closes back)
 * 4. Enter in the opposite direction of the sweep
 *
 * This strategy capitalizes on "stop hunts" - when smart money sweeps
 * retail stop losses before moving in the intended direction.
 *
 * Stop Loss: Beyond the sweep high/low
 * Take Profit: Opposite liquidity zone
 */
export class LiquiditySweepStrategy extends BaseStrategy {
  readonly name: StrategyType = 'LIQUIDITY_SWEEP';
  readonly description = 'Liquidity Sweep Reversal Strategy';

  analyze(context: StrategyContext): StrategySignal | null {
    const { symbol, currentPrice, bid, ask, analysis, mtfCandles, ltfCandles } = context;

    // Look for liquidity sweep on LTF
    const bullishSignal = this.detectBullishLiquiditySweep(context, bid);
    if (bullishSignal && this.validateSignal(bullishSignal)) {
      return bullishSignal;
    }

    const bearishSignal = this.detectBearishLiquiditySweep(context, ask);
    if (bearishSignal && this.validateSignal(bearishSignal)) {
      return bearishSignal;
    }

    return null;
  }

  private detectBullishLiquiditySweep(
    context: StrategyContext,
    bid: number
  ): StrategySignal | null {
    const { analysis, ltfCandles, currentPrice } = context;

    // Only look for bullish sweeps when bias is bullish or neutral
    const bias = getOverallBias(analysis);
    if (bias === 'BEARISH') {
      return null;
    }

    // Get sell-side liquidity zones (swing lows)
    const sellSideLiquidity = [...analysis.mtf.liquidityZones, ...analysis.htf.liquidityZones]
      .filter((z) => z.type === 'LOW' && !z.isSwept);

    if (sellSideLiquidity.length === 0) {
      return null;
    }

    // Check recent candles for liquidity sweep
    const recentCandles = ltfCandles.slice(-10);

    for (const zone of sellSideLiquidity) {
      // Check if liquidity was swept (price went below zone) and rejected
      const sweepReversal = detectLiquiditySweepReversal(zone, recentCandles);

      if (sweepReversal.isReversal && sweepReversal.rejectionCandle) {
        const rejectionCandle = sweepReversal.rejectionCandle;

        // Entry at current price (after rejection)
        const entryPrice = bid;

        // Stop loss below the sweep low
        const stopLoss = rejectionCandle.low - (rejectionCandle.high - rejectionCandle.low) * 0.5;

        // Take profit at buy-side liquidity
        let takeProfit = getLiquidityTarget(currentPrice, analysis, 'BUY');

        if (!takeProfit) {
          // Fallback to swing high
          const swingHigh = findNearestSwingHigh(analysis.mtf.structure.swingPoints, currentPrice);
          if (swingHigh) {
            takeProfit = swingHigh.price;
          } else {
            // 2:1 RR
            takeProfit = entryPrice + (entryPrice - stopLoss) * 2;
          }
        }

        // Calculate confidence
        let confidence = 0.55;
        const reasons: string[] = [`Liquidity sweep below ${zone.price.toFixed(2)}`];

        // HTF bullish alignment
        if (analysis.htf.bias === 'BULLISH') confidence += 0.15;

        // Strong rejection (long lower wick)
        const wickSize = rejectionCandle.close - rejectionCandle.low;
        const bodySize = Math.abs(rejectionCandle.close - rejectionCandle.open);
        if (wickSize > bodySize * 1.5) {
          confidence += 0.1;
          reasons.push('Strong rejection');
        }

        // Multiple liquidity levels swept
        const sweptLevels = sellSideLiquidity.filter(
          (z) => rejectionCandle.low < z.price
        ).length;
        if (sweptLevels > 1) {
          confidence += 0.1;
          reasons.push(`${sweptLevels} levels swept`);
        }

        // Near HTF Order Block
        const nearOB = analysis.htf.orderBlocks.find(
          (ob) => ob.type === 'BULLISH' && currentPrice >= ob.low && currentPrice <= ob.high * 1.02
        );
        if (nearOB) {
          confidence += 0.1;
          reasons.push('OB confluence');
        }

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

  private detectBearishLiquiditySweep(
    context: StrategyContext,
    ask: number
  ): StrategySignal | null {
    const { analysis, ltfCandles, currentPrice } = context;

    // Only look for bearish sweeps when bias is bearish or neutral
    const bias = getOverallBias(analysis);
    if (bias === 'BULLISH') {
      return null;
    }

    // Get buy-side liquidity zones (swing highs)
    const buySideLiquidity = [...analysis.mtf.liquidityZones, ...analysis.htf.liquidityZones]
      .filter((z) => z.type === 'HIGH' && !z.isSwept);

    if (buySideLiquidity.length === 0) {
      return null;
    }

    // Check recent candles for liquidity sweep
    const recentCandles = ltfCandles.slice(-10);

    for (const zone of buySideLiquidity) {
      // Check if liquidity was swept (price went above zone) and rejected
      const sweepReversal = detectLiquiditySweepReversal(zone, recentCandles);

      if (sweepReversal.isReversal && sweepReversal.rejectionCandle) {
        const rejectionCandle = sweepReversal.rejectionCandle;

        // Entry at current price (after rejection)
        const entryPrice = ask;

        // Stop loss above the sweep high
        const stopLoss = rejectionCandle.high + (rejectionCandle.high - rejectionCandle.low) * 0.5;

        // Take profit at sell-side liquidity
        let takeProfit = getLiquidityTarget(currentPrice, analysis, 'SELL');

        if (!takeProfit) {
          // Fallback to swing low
          const swingLow = findNearestSwingLow(analysis.mtf.structure.swingPoints, currentPrice);
          if (swingLow) {
            takeProfit = swingLow.price;
          } else {
            // 2:1 RR
            takeProfit = entryPrice - (stopLoss - entryPrice) * 2;
          }
        }

        // Calculate confidence
        let confidence = 0.55;
        const reasons: string[] = [`Liquidity sweep above ${zone.price.toFixed(2)}`];

        // HTF bearish alignment
        if (analysis.htf.bias === 'BEARISH') confidence += 0.15;

        // Strong rejection (long upper wick)
        const wickSize = rejectionCandle.high - rejectionCandle.close;
        const bodySize = Math.abs(rejectionCandle.close - rejectionCandle.open);
        if (wickSize > bodySize * 1.5) {
          confidence += 0.1;
          reasons.push('Strong rejection');
        }

        // Multiple liquidity levels swept
        const sweptLevels = buySideLiquidity.filter(
          (z) => rejectionCandle.high > z.price
        ).length;
        if (sweptLevels > 1) {
          confidence += 0.1;
          reasons.push(`${sweptLevels} levels swept`);
        }

        // Near HTF Order Block
        const nearOB = analysis.htf.orderBlocks.find(
          (ob) => ob.type === 'BEARISH' && currentPrice <= ob.high && currentPrice >= ob.low * 0.98
        );
        if (nearOB) {
          confidence += 0.1;
          reasons.push('OB confluence');
        }

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

export const liquiditySweepStrategy = new LiquiditySweepStrategy();
