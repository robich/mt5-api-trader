import { BaseStrategy, StrategySignal, StrategyContext } from './base';
import { StrategyType } from '../types';
import { getOverallBias, getLiquidityTarget } from '../analysis/multi-timeframe';
import { isPriceInDiscount, isPriceInPremium } from '../analysis/market-structure';

/**
 * Classic Fake Breakout (FBO) Strategy
 *
 * Entry Logic:
 * 1. Identify key S/R levels from HTF/MTF swing points
 * 2. Detect when price breaks the level (wick or close beyond)
 * 3. Wait for reversal candle that closes back inside the range
 * 4. Enter in the direction of the reversal
 *
 * This strategy capitalizes on failed breakouts where retail traders
 * get trapped on the wrong side of the market.
 *
 * Stop Loss: Beyond the fake breakout extreme (the wick high/low)
 * Take Profit: Opposite S/R level or 2:1 RR minimum
 */
export class FBOClassicStrategy extends BaseStrategy {
  readonly name: StrategyType = 'FBO_CLASSIC';
  readonly description = 'Classic Fake Breakout Reversal Strategy';

  analyze(context: StrategyContext): StrategySignal | null {
    const { analysis, ltfCandles } = context;

    // Need at least 5 candles to detect pattern
    if (ltfCandles.length < 5) {
      return null;
    }

    // Get recent candles for pattern detection
    const recentCandles = ltfCandles.slice(-5);

    // Get S/R levels from MTF swing points
    const mtfSwings = analysis.mtf.structure.swingPoints;
    const resistanceLevels = mtfSwings
      .filter((s) => s.type === 'HIGH')
      .map((s) => s.price)
      .slice(-5);
    const supportLevels = mtfSwings
      .filter((s) => s.type === 'LOW')
      .map((s) => s.price)
      .slice(-5);

    // Try bullish FBO (false breakdown below support)
    const bullishSignal = this.detectBullishFBO(context, supportLevels, recentCandles);
    if (bullishSignal && this.validateSignal(bullishSignal)) {
      return bullishSignal;
    }

    // Try bearish FBO (false breakout above resistance)
    const bearishSignal = this.detectBearishFBO(context, resistanceLevels, recentCandles);
    if (bearishSignal && this.validateSignal(bearishSignal)) {
      return bearishSignal;
    }

    return null;
  }

  private detectBullishFBO(
    context: StrategyContext,
    supportLevels: number[],
    recentCandles: typeof context.ltfCandles
  ): StrategySignal | null {
    const { analysis, currentPrice, bid } = context;

    // Only look for bullish FBO when bias is not strongly bearish
    const bias = getOverallBias(analysis);
    if (bias === 'BEARISH' && analysis.htf.bias === 'BEARISH') {
      return null;
    }

    // Look for breakdown below support followed by reversal
    for (const support of supportLevels) {
      // Check if recent candles show breakdown + reversal pattern
      for (let i = 0; i < recentCandles.length - 1; i++) {
        const breakdownCandle = recentCandles[i];
        const reversalCandle = recentCandles[i + 1];

        // Breakdown: candle breaks below support (wick or close)
        const hasBreakdown = breakdownCandle.low < support;

        // Reversal: next candle closes back above support
        const hasReversal = reversalCandle.close > support;

        // Also check that breakdown candle didn't close too far below
        const notTooDeep = breakdownCandle.close > support * 0.995; // Within 0.5%

        if (hasBreakdown && hasReversal && notTooDeep) {
          // Entry at current price
          const entryPrice = bid;

          // Stop loss below the fake breakdown low with buffer
          const stopLoss = breakdownCandle.low - (Math.abs(breakdownCandle.high - breakdownCandle.low) * 0.5);

          // Take profit at resistance or 2:1 RR
          let takeProfit = getLiquidityTarget(currentPrice, analysis, 'BUY');

          if (!takeProfit) {
            // Find nearest resistance
            const nearestResistance = supportLevels
              .filter((r) => r > currentPrice)
              .sort((a, b) => a - b)[0];

            if (nearestResistance) {
              takeProfit = nearestResistance;
            } else {
              // Default 2:1 RR
              takeProfit = entryPrice + (entryPrice - stopLoss) * 2;
            }
          }

          // Calculate confidence
          let confidence = 0.55;
          const reasons: string[] = [`FBO below support ${support.toFixed(2)}`];

          // HTF bullish alignment
          if (analysis.htf.bias === 'BULLISH') {
            confidence += 0.15;
            reasons.push('HTF bullish');
          }

          // Strong rejection wick
          const lowerWick = Math.min(breakdownCandle.open, breakdownCandle.close) - breakdownCandle.low;
          const bodySize = Math.abs(breakdownCandle.close - breakdownCandle.open);
          if (lowerWick > bodySize * 1.5) {
            confidence += 0.1;
            reasons.push('Strong rejection');
          }

          // Bullish reversal candle
          if (reversalCandle.close > reversalCandle.open) {
            confidence += 0.05;
            reasons.push('Bullish reversal');
          }

          // OB/FVG confluence
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
    }

    return null;
  }

  private detectBearishFBO(
    context: StrategyContext,
    resistanceLevels: number[],
    recentCandles: typeof context.ltfCandles
  ): StrategySignal | null {
    const { analysis, currentPrice, ask } = context;

    // Only look for bearish FBO when bias is not strongly bullish
    const bias = getOverallBias(analysis);
    if (bias === 'BULLISH' && analysis.htf.bias === 'BULLISH') {
      return null;
    }

    // Look for breakout above resistance followed by reversal
    for (const resistance of resistanceLevels) {
      // Check if recent candles show breakout + reversal pattern
      for (let i = 0; i < recentCandles.length - 1; i++) {
        const breakoutCandle = recentCandles[i];
        const reversalCandle = recentCandles[i + 1];

        // Breakout: candle breaks above resistance (wick or close)
        const hasBreakout = breakoutCandle.high > resistance;

        // Reversal: next candle closes back below resistance
        const hasReversal = reversalCandle.close < resistance;

        // Also check that breakout candle didn't close too far above
        const notTooDeep = breakoutCandle.close < resistance * 1.005; // Within 0.5%

        if (hasBreakout && hasReversal && notTooDeep) {
          // Entry at current price
          const entryPrice = ask;

          // Stop loss above the fake breakout high with buffer
          const stopLoss = breakoutCandle.high + (Math.abs(breakoutCandle.high - breakoutCandle.low) * 0.5);

          // Take profit at support or 2:1 RR
          let takeProfit = getLiquidityTarget(currentPrice, analysis, 'SELL');

          if (!takeProfit) {
            // Find nearest support
            const nearestSupport = resistanceLevels
              .filter((s) => s < currentPrice)
              .sort((a, b) => b - a)[0];

            if (nearestSupport) {
              takeProfit = nearestSupport;
            } else {
              // Default 2:1 RR
              takeProfit = entryPrice - (stopLoss - entryPrice) * 2;
            }
          }

          // Calculate confidence
          let confidence = 0.55;
          const reasons: string[] = [`FBO above resistance ${resistance.toFixed(2)}`];

          // HTF bearish alignment
          if (analysis.htf.bias === 'BEARISH') {
            confidence += 0.15;
            reasons.push('HTF bearish');
          }

          // Strong rejection wick
          const upperWick = breakoutCandle.high - Math.max(breakoutCandle.open, breakoutCandle.close);
          const bodySize = Math.abs(breakoutCandle.close - breakoutCandle.open);
          if (upperWick > bodySize * 1.5) {
            confidence += 0.1;
            reasons.push('Strong rejection');
          }

          // Bearish reversal candle
          if (reversalCandle.close < reversalCandle.open) {
            confidence += 0.05;
            reasons.push('Bearish reversal');
          }

          // OB/FVG confluence
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
    }

    return null;
  }
}

export const fboClassicStrategy = new FBOClassicStrategy();
