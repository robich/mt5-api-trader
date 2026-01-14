import { BaseStrategy, StrategySignal, StrategyContext } from './base';
import { StrategyType, SwingPoint } from '../types';
import { getOverallBias, getLiquidityTarget } from '../analysis/multi-timeframe';
import { isPriceInDiscount, isPriceInPremium } from '../analysis/market-structure';

/**
 * FBO Structure (Failed BOS) Strategy
 *
 * Entry Logic:
 * 1. Detect BOS attempt (price breaks swing point)
 * 2. Wait for failure (price fails to continue, reverses)
 * 3. Confirm with LTF structure shift in opposite direction
 * 4. Enter when price reclaims the broken level
 *
 * This strategy capitalizes on failed structure breaks where
 * the market traps breakout traders before reversing.
 *
 * Stop Loss: Beyond the failed BOS attempt
 * Take Profit: Previous swing point in trade direction
 */
export class FBOStructureStrategy extends BaseStrategy {
  readonly name: StrategyType = 'FBO_STRUCTURE';
  readonly description = 'Failed Break of Structure Strategy';

  analyze(context: StrategyContext): StrategySignal | null {
    const { analysis, ltfCandles, mtfCandles } = context;

    // Need sufficient swing points for analysis
    const mtfSwings = analysis.mtf.structure.swingPoints;
    if (mtfSwings.length < 4) {
      return null;
    }

    const highs = mtfSwings.filter((s) => s.type === 'HIGH').slice(-4);
    const lows = mtfSwings.filter((s) => s.type === 'LOW').slice(-4);

    if (highs.length < 2 || lows.length < 2) {
      return null;
    }

    // Try bullish failed BOS (bearish BOS that failed)
    const bullishSignal = this.detectBullishFailedBOS(context, highs, lows);
    if (bullishSignal && this.validateSignal(bullishSignal)) {
      return bullishSignal;
    }

    // Try bearish failed BOS (bullish BOS that failed)
    const bearishSignal = this.detectBearishFailedBOS(context, highs, lows);
    if (bearishSignal && this.validateSignal(bearishSignal)) {
      return bearishSignal;
    }

    return null;
  }

  private detectBullishFailedBOS(
    context: StrategyContext,
    highs: SwingPoint[],
    lows: SwingPoint[]
  ): StrategySignal | null {
    const { analysis, currentPrice, bid, ltfCandles, mtfCandles } = context;

    // Look for failed bearish BOS:
    // 1. Price broke below a swing low (bearish BOS attempt)
    // 2. But then reversed and reclaimed the level (failure)

    const lastLow = lows[lows.length - 1];
    const prevLow = lows.length > 1 ? lows[lows.length - 2] : null;

    if (!prevLow) return null;

    // Check if there was a break below the previous low
    const recentCandles = ltfCandles.slice(-10);
    let brokeBelow = false;
    let lowestPoint = Infinity;
    let breakCandle: typeof ltfCandles[0] | null = null;

    for (const candle of recentCandles) {
      if (candle.low < prevLow.price) {
        brokeBelow = true;
        if (candle.low < lowestPoint) {
          lowestPoint = candle.low;
          breakCandle = candle;
        }
      }
    }

    if (!brokeBelow || !breakCandle) return null;

    // Check if price has reclaimed above the level (BOS failed)
    const currentCandle = ltfCandles[ltfCandles.length - 1];
    const reclaimed = currentCandle.close > prevLow.price;

    if (!reclaimed) return null;

    // Additional confirmation: LTF bullish structure shift
    const ltfBullishShift =
      analysis.ltf.bias === 'BULLISH' ||
      analysis.ltf.structure.lastStructure === 'HH' ||
      analysis.ltf.structure.lastStructure === 'HL' ||
      analysis.recentCHoCH?.type === 'BULLISH';

    // Entry at current price
    const entryPrice = bid;

    // Stop loss below the failed BOS low
    const stopLoss = lowestPoint - (Math.abs(breakCandle.high - breakCandle.low) * 0.3);

    // Take profit at previous high or liquidity target
    let takeProfit = getLiquidityTarget(currentPrice, analysis, 'BUY');

    if (!takeProfit) {
      // Target the last high
      const lastHigh = highs[highs.length - 1];
      takeProfit = lastHigh.price;
    }

    // Ensure minimum 1.5:1 RR
    const minTP = entryPrice + (entryPrice - stopLoss) * 1.5;
    if (takeProfit < minTP) {
      takeProfit = minTP;
    }

    // Calculate confidence
    let confidence = 0.5;
    const reasons: string[] = [`Failed bearish BOS at ${prevLow.price.toFixed(2)}`];

    // LTF confirmation
    if (ltfBullishShift) {
      confidence += 0.15;
      reasons.push('LTF bullish shift');
    }

    // HTF alignment
    if (analysis.htf.bias === 'BULLISH') {
      confidence += 0.1;
      reasons.push('HTF bullish');
    } else if (analysis.htf.bias === 'NEUTRAL') {
      confidence += 0.05;
    }

    // Strong reclaim (current candle closed well above the level)
    const reclaimStrength = (currentCandle.close - prevLow.price) / Math.abs(currentCandle.high - currentCandle.low);
    if (reclaimStrength > 0.5) {
      confidence += 0.1;
      reasons.push('Strong reclaim');
    }

    // Bullish engulfing pattern on reclaim
    if (currentCandle.close > currentCandle.open &&
        currentCandle.close > breakCandle.high) {
      confidence += 0.1;
      reasons.push('Bullish engulfing');
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
        confidence += 0.05;
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

  private detectBearishFailedBOS(
    context: StrategyContext,
    highs: SwingPoint[],
    lows: SwingPoint[]
  ): StrategySignal | null {
    const { analysis, currentPrice, ask, ltfCandles, mtfCandles } = context;

    // Look for failed bullish BOS:
    // 1. Price broke above a swing high (bullish BOS attempt)
    // 2. But then reversed and reclaimed the level (failure)

    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs.length > 1 ? highs[highs.length - 2] : null;

    if (!prevHigh) return null;

    // Check if there was a break above the previous high
    const recentCandles = ltfCandles.slice(-10);
    let brokeAbove = false;
    let highestPoint = -Infinity;
    let breakCandle: typeof ltfCandles[0] | null = null;

    for (const candle of recentCandles) {
      if (candle.high > prevHigh.price) {
        brokeAbove = true;
        if (candle.high > highestPoint) {
          highestPoint = candle.high;
          breakCandle = candle;
        }
      }
    }

    if (!brokeAbove || !breakCandle) return null;

    // Check if price has reclaimed below the level (BOS failed)
    const currentCandle = ltfCandles[ltfCandles.length - 1];
    const reclaimed = currentCandle.close < prevHigh.price;

    if (!reclaimed) return null;

    // Additional confirmation: LTF bearish structure shift
    const ltfBearishShift =
      analysis.ltf.bias === 'BEARISH' ||
      analysis.ltf.structure.lastStructure === 'LL' ||
      analysis.ltf.structure.lastStructure === 'LH' ||
      analysis.recentCHoCH?.type === 'BEARISH';

    // Entry at current price
    const entryPrice = ask;

    // Stop loss above the failed BOS high
    const stopLoss = highestPoint + (Math.abs(breakCandle.high - breakCandle.low) * 0.3);

    // Take profit at previous low or liquidity target
    let takeProfit = getLiquidityTarget(currentPrice, analysis, 'SELL');

    if (!takeProfit) {
      // Target the last low
      const lastLow = lows[lows.length - 1];
      takeProfit = lastLow.price;
    }

    // Ensure minimum 1.5:1 RR
    const minTP = entryPrice - (stopLoss - entryPrice) * 1.5;
    if (takeProfit > minTP) {
      takeProfit = minTP;
    }

    // Calculate confidence
    let confidence = 0.5;
    const reasons: string[] = [`Failed bullish BOS at ${prevHigh.price.toFixed(2)}`];

    // LTF confirmation
    if (ltfBearishShift) {
      confidence += 0.15;
      reasons.push('LTF bearish shift');
    }

    // HTF alignment
    if (analysis.htf.bias === 'BEARISH') {
      confidence += 0.1;
      reasons.push('HTF bearish');
    } else if (analysis.htf.bias === 'NEUTRAL') {
      confidence += 0.05;
    }

    // Strong reclaim (current candle closed well below the level)
    const reclaimStrength = (prevHigh.price - currentCandle.close) / Math.abs(currentCandle.high - currentCandle.low);
    if (reclaimStrength > 0.5) {
      confidence += 0.1;
      reasons.push('Strong reclaim');
    }

    // Bearish engulfing pattern on reclaim
    if (currentCandle.close < currentCandle.open &&
        currentCandle.close < breakCandle.low) {
      confidence += 0.1;
      reasons.push('Bearish engulfing');
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
        confidence += 0.05;
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

export const fboStructureStrategy = new FBOStructureStrategy();
