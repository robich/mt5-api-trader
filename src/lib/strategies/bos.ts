import { BaseStrategy, StrategySignal, StrategyContext } from './base';
import { StrategyType, Direction } from '../types';
import { detectBOS, isPriceInDiscount, isPriceInPremium, calculatePremiumDiscount } from '../analysis/market-structure';
import { getOverallBias, getLiquidityTarget } from '../analysis/multi-timeframe';

/**
 * Break of Structure (BOS) Strategy
 *
 * Entry Logic:
 * 1. Wait for Break of Structure on MTF (price breaks previous swing high/low)
 * 2. After BOS, wait for pullback to discount zone (buys) or premium zone (sells)
 * 3. Enter when price reaches the 50-78.6% Fibonacci retracement
 * 4. Confirm with LTF structure shift in the direction of BOS
 *
 * This is a trend-continuation strategy that enters after confirmation
 * of a new structure break.
 *
 * Stop Loss: Below/above the swing point that caused the BOS
 * Take Profit: Next structure level or 1.618 Fibonacci extension
 */
export class BOSStrategy extends BaseStrategy {
  readonly name: StrategyType = 'BOS';
  readonly description = 'Break of Structure Continuation Strategy';

  analyze(context: StrategyContext): StrategySignal | null {
    const { symbol, currentPrice, bid, ask, analysis, mtfCandles, ltfCandles } = context;

    // Check for BOS in MTF
    const mtfBOS = analysis.mtf.structure.lastBOS;

    if (!mtfBOS) {
      return null; // No recent BOS
    }

    // Get swing points for Fibonacci calculation
    const swingPoints = analysis.mtf.structure.swingPoints;
    const highs = swingPoints.filter((s) => s.type === 'HIGH').slice(-3);
    const lows = swingPoints.filter((s) => s.type === 'LOW').slice(-3);

    if (highs.length < 2 || lows.length < 2) {
      return null;
    }

    const lastHigh = highs[highs.length - 1];
    const lastLow = lows[lows.length - 1];
    const prevHigh = highs[highs.length - 2];
    const prevLow = lows[lows.length - 2];

    // Determine if we should look for buy or sell setup
    const bullishSignal = this.analyzeBullishBOS(
      context,
      lastHigh,
      lastLow,
      prevLow,
      bid
    );

    if (bullishSignal && this.validateSignal(bullishSignal)) {
      return bullishSignal;
    }

    const bearishSignal = this.analyzeBearishBOS(
      context,
      lastHigh,
      lastLow,
      prevHigh,
      ask
    );

    if (bearishSignal && this.validateSignal(bearishSignal)) {
      return bearishSignal;
    }

    return null;
  }

  private analyzeBullishBOS(
    context: StrategyContext,
    lastHigh: { price: number; time: Date },
    lastLow: { price: number; time: Date },
    prevLow: { price: number; time: Date },
    bid: number
  ): StrategySignal | null {
    const { analysis, currentPrice } = context;

    // For bullish BOS: price should have broken above previous high
    // Now we wait for pullback to discount zone
    const bias = getOverallBias(analysis);

    // Must have bullish bias or recent BOS
    if (bias !== 'BULLISH' && analysis.mtf.structure.lastStructure !== 'BOS') {
      return null;
    }

    // Check if HTF supports bullish direction
    if (analysis.htf.bias === 'BEARISH') {
      return null;
    }

    // Calculate Fibonacci zones from the impulse move
    const swingLow = Math.min(lastLow.price, prevLow.price);
    const swingHigh = lastHigh.price;

    const zones = calculatePremiumDiscount(swingHigh, swingLow);

    // Check if price is in discount zone (50-78.6% retracement)
    const isInDiscount = currentPrice <= zones.equilibrium && currentPrice >= zones.fib786;

    // Also check if price is near FVG or OB in discount zone
    const hasConfluence = analysis.mtf.fvgs.some(
      (fvg) =>
        fvg.type === 'BULLISH' &&
        fvg.high >= zones.fib786 &&
        fvg.low <= zones.equilibrium
    ) || analysis.mtf.orderBlocks.some(
      (ob) =>
        ob.type === 'BULLISH' &&
        ob.high >= zones.fib786 &&
        ob.low <= zones.equilibrium
    );

    if (!isInDiscount && !hasConfluence) {
      return null; // Not in optimal entry zone
    }

    // Check LTF for bullish shift (additional confirmation)
    const ltfBullish = analysis.ltf.bias === 'BULLISH' ||
      analysis.ltf.structure.lastStructure === 'HH' ||
      analysis.ltf.structure.lastStructure === 'HL';

    if (!ltfBullish && !hasConfluence) {
      return null; // No LTF confirmation
    }

    // Entry price
    const entryPrice = bid;

    // Stop loss below the swing low with buffer
    const stopLoss = swingLow - (swingHigh - swingLow) * 0.1;

    // Take profit at previous high or liquidity target
    let takeProfit = getLiquidityTarget(currentPrice, analysis, 'BUY');

    if (!takeProfit || takeProfit <= swingHigh) {
      // Use 1.618 Fibonacci extension
      const range = swingHigh - swingLow;
      takeProfit = swingHigh + range * 0.618;
    }

    // Calculate confidence
    let confidence = 0.5;
    const reasons: string[] = ['Bullish BOS pullback'];

    // Price in optimal discount zone
    if (isInDiscount) {
      confidence += 0.15;
      reasons.push('Discount zone');
    }

    // HTF alignment
    if (analysis.htf.bias === 'BULLISH') confidence += 0.1;

    // Confluence with OB/FVG
    if (hasConfluence) {
      confidence += 0.15;
      reasons.push('OB/FVG confluence');
    }

    // LTF structure shift
    if (ltfBullish) {
      confidence += 0.1;
      reasons.push('LTF shift');
    }

    // SMC Enhancement: CHoCH confirmation
    if (analysis.recentCHoCH?.type === 'BULLISH') {
      confidence += 0.1;
      reasons.push('CHoCH confirmed');
    }

    // SMC Enhancement: Liquidity sweep
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

  private analyzeBearishBOS(
    context: StrategyContext,
    lastHigh: { price: number; time: Date },
    lastLow: { price: number; time: Date },
    prevHigh: { price: number; time: Date },
    ask: number
  ): StrategySignal | null {
    const { analysis, currentPrice } = context;

    // For bearish BOS: price should have broken below previous low
    // Now we wait for pullback to premium zone
    const bias = getOverallBias(analysis);

    // Must have bearish bias or recent BOS
    if (bias !== 'BEARISH' && analysis.mtf.structure.lastStructure !== 'BOS') {
      return null;
    }

    // Check if HTF supports bearish direction
    if (analysis.htf.bias === 'BULLISH') {
      return null;
    }

    // Calculate Fibonacci zones from the impulse move
    const swingHigh = Math.max(lastHigh.price, prevHigh.price);
    const swingLow = lastLow.price;

    const zones = calculatePremiumDiscount(swingHigh, swingLow);

    // Check if price is in premium zone (50-78.6% retracement)
    const isInPremium = currentPrice >= zones.equilibrium && currentPrice <= zones.fib786;

    // Also check if price is near FVG or OB in premium zone
    const hasConfluence = analysis.mtf.fvgs.some(
      (fvg) =>
        fvg.type === 'BEARISH' &&
        fvg.low <= zones.fib786 &&
        fvg.high >= zones.equilibrium
    ) || analysis.mtf.orderBlocks.some(
      (ob) =>
        ob.type === 'BEARISH' &&
        ob.low <= zones.fib786 &&
        ob.high >= zones.equilibrium
    );

    if (!isInPremium && !hasConfluence) {
      return null; // Not in optimal entry zone
    }

    // Check LTF for bearish shift (additional confirmation)
    const ltfBearish = analysis.ltf.bias === 'BEARISH' ||
      analysis.ltf.structure.lastStructure === 'LL' ||
      analysis.ltf.structure.lastStructure === 'LH';

    if (!ltfBearish && !hasConfluence) {
      return null; // No LTF confirmation
    }

    // Entry price
    const entryPrice = ask;

    // Stop loss above the swing high with buffer
    const stopLoss = swingHigh + (swingHigh - swingLow) * 0.1;

    // Take profit at previous low or liquidity target
    let takeProfit = getLiquidityTarget(currentPrice, analysis, 'SELL');

    if (!takeProfit || takeProfit >= swingLow) {
      // Use 1.618 Fibonacci extension
      const range = swingHigh - swingLow;
      takeProfit = swingLow - range * 0.618;
    }

    // Calculate confidence
    let confidence = 0.5;
    const reasons: string[] = ['Bearish BOS pullback'];

    // Price in optimal premium zone
    if (isInPremium) {
      confidence += 0.15;
      reasons.push('Premium zone');
    }

    // HTF alignment
    if (analysis.htf.bias === 'BEARISH') confidence += 0.1;

    // Confluence with OB/FVG
    if (hasConfluence) {
      confidence += 0.15;
      reasons.push('OB/FVG confluence');
    }

    // LTF structure shift
    if (ltfBearish) {
      confidence += 0.1;
      reasons.push('LTF shift');
    }

    // SMC Enhancement: CHoCH confirmation
    if (analysis.recentCHoCH?.type === 'BEARISH') {
      confidence += 0.1;
      reasons.push('CHoCH confirmed');
    }

    // SMC Enhancement: Liquidity sweep
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

export const bosStrategy = new BOSStrategy();
