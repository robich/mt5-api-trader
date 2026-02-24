/**
 * Structure-Based Trailing Stop Manager
 *
 * Institutional concept: Instead of using fixed breakeven or fixed trailing stops,
 * institutional traders trail their stop loss to the last confirmed swing point
 * (swing low for longs, swing high for shorts). This preserves capital during
 * trending moves while avoiding premature stops from normal retracements.
 *
 * How it works:
 * 1. After initial breakeven is hit (via BreakevenManager), this takes over
 * 2. As new swing points form on the LTF, move SL to the last swing low (longs)
 *    or last swing high (shorts) with a small buffer
 * 3. Only move SL in the favorable direction (never widen the stop)
 *
 * Configuration:
 * - enabled: Whether structure trailing is active
 * - activationR: Minimum R profit before trailing starts (e.g., 1.0R)
 * - bufferPips: Buffer below/above the swing point
 * - minSwingAge: Minimum candles since swing point to confirm it's valid
 *
 * This is designed for the backtest engine. The live implementation would need
 * async MetaAPI calls similar to BreakevenManager.
 */

import { Candle, Direction, SwingPoint } from '../types';
import { identifySwingPoints } from '../analysis/market-structure';

/**
 * Configuration for structure-based trailing stop
 */
export interface StructureTrailingConfig {
  /** Whether structure trailing is enabled */
  enabled: boolean;
  /** Minimum R profit before trailing starts (e.g., 1.0 = after 1R profit) */
  activationR: number;
  /** Buffer in pips below/above the swing point */
  bufferPips: number;
  /** Minimum candles after swing point to confirm it */
  minSwingAge: number;
}

/**
 * Default configuration profiles
 */
export const STRUCTURE_TRAILING_PROFILES: Record<string, StructureTrailingConfig> = {
  /** Aggressive: trail early and tight */
  'TIGHT': {
    enabled: true,
    activationR: 0.75,
    bufferPips: 3,
    minSwingAge: 2,
  },
  /** Balanced: standard trailing */
  'BALANCED': {
    enabled: true,
    activationR: 1.0,
    bufferPips: 5,
    minSwingAge: 3,
  },
  /** Wide: give more room for volatile instruments */
  'WIDE': {
    enabled: true,
    activationR: 1.5,
    bufferPips: 10,
    minSwingAge: 5,
  },
  /** Disabled */
  'DISABLED': {
    enabled: false,
    activationR: 1.0,
    bufferPips: 5,
    minSwingAge: 3,
  },
};

/**
 * Result from a structure trailing check
 */
export interface StructureTrailingResult {
  shouldMove: boolean;
  newStopLoss?: number;
  reason?: string;
  swingPoint?: SwingPoint;
}

/**
 * Calculate the structure-based trailing stop for a position
 *
 * @param direction - Trade direction (BUY/SELL)
 * @param entryPrice - Original entry price
 * @param currentStopLoss - Current stop loss level
 * @param currentPrice - Current market price
 * @param originalRisk - Original risk distance (entry - SL for longs)
 * @param recentCandles - Recent LTF candles for swing point detection
 * @param config - Trailing stop configuration
 * @param pipSize - Pip size for the symbol
 * @returns StructureTrailingResult with new SL if applicable
 */
export function calculateStructureTrailingStop(
  direction: Direction,
  entryPrice: number,
  currentStopLoss: number,
  currentPrice: number,
  originalRisk: number,
  recentCandles: Candle[],
  config: StructureTrailingConfig,
  pipSize: number
): StructureTrailingResult {
  if (!config.enabled) {
    return { shouldMove: false, reason: 'Structure trailing disabled' };
  }

  if (recentCandles.length < 10) {
    return { shouldMove: false, reason: 'Insufficient candles for swing detection' };
  }

  // Calculate current R profit
  let currentR: number;
  if (direction === 'BUY') {
    currentR = (currentPrice - entryPrice) / originalRisk;
  } else {
    currentR = (entryPrice - currentPrice) / originalRisk;
  }

  // Check activation threshold
  if (currentR < config.activationR) {
    return {
      shouldMove: false,
      reason: `Current R (${currentR.toFixed(2)}) < activation (${config.activationR})`,
    };
  }

  // Identify swing points from recent candles
  const swingPoints = identifySwingPoints(recentCandles);

  if (direction === 'BUY') {
    return trailLongPosition(
      swingPoints,
      currentStopLoss,
      entryPrice,
      currentPrice,
      config,
      pipSize,
      recentCandles.length
    );
  } else {
    return trailShortPosition(
      swingPoints,
      currentStopLoss,
      entryPrice,
      currentPrice,
      config,
      pipSize,
      recentCandles.length
    );
  }
}

/**
 * Trail stop loss for a long position to the last confirmed swing low
 */
function trailLongPosition(
  swingPoints: SwingPoint[],
  currentStopLoss: number,
  entryPrice: number,
  currentPrice: number,
  config: StructureTrailingConfig,
  pipSize: number,
  totalCandles: number
): StructureTrailingResult {
  // Get recent swing lows (for longs, we trail to swing lows)
  const swingLows = swingPoints
    .filter(sp => sp.type === 'LOW')
    .filter(sp => {
      // Must be confirmed (enough candles after it)
      const candlesAfter = totalCandles - sp.index;
      return candlesAfter >= config.minSwingAge;
    })
    .filter(sp => {
      // Must be above entry (we only trail in profit direction)
      return sp.price > entryPrice;
    })
    .filter(sp => {
      // Must be below current price (valid swing low)
      return sp.price < currentPrice;
    })
    .sort((a, b) => b.price - a.price); // Highest swing low first (tightest trail)

  if (swingLows.length === 0) {
    return { shouldMove: false, reason: 'No valid swing lows above entry for trailing' };
  }

  // Use the highest confirmed swing low (tightest trailing stop)
  const bestSwingLow = swingLows[0];
  const buffer = config.bufferPips * pipSize;
  const newStopLoss = bestSwingLow.price - buffer;

  // Only move if better than current SL (higher for longs)
  if (newStopLoss <= currentStopLoss) {
    return {
      shouldMove: false,
      reason: `Swing low SL (${newStopLoss.toFixed(2)}) not better than current (${currentStopLoss.toFixed(2)})`,
    };
  }

  return {
    shouldMove: true,
    newStopLoss,
    reason: `Trail to swing low at ${bestSwingLow.price.toFixed(2)} - ${buffer.toFixed(2)} buffer`,
    swingPoint: bestSwingLow,
  };
}

/**
 * Trail stop loss for a short position to the last confirmed swing high
 */
function trailShortPosition(
  swingPoints: SwingPoint[],
  currentStopLoss: number,
  entryPrice: number,
  currentPrice: number,
  config: StructureTrailingConfig,
  pipSize: number,
  totalCandles: number
): StructureTrailingResult {
  // Get recent swing highs (for shorts, we trail to swing highs)
  const swingHighs = swingPoints
    .filter(sp => sp.type === 'HIGH')
    .filter(sp => {
      const candlesAfter = totalCandles - sp.index;
      return candlesAfter >= config.minSwingAge;
    })
    .filter(sp => {
      // Must be below entry (we only trail in profit direction)
      return sp.price < entryPrice;
    })
    .filter(sp => {
      // Must be above current price (valid swing high)
      return sp.price > currentPrice;
    })
    .sort((a, b) => a.price - b.price); // Lowest swing high first (tightest trail)

  if (swingHighs.length === 0) {
    return { shouldMove: false, reason: 'No valid swing highs below entry for trailing' };
  }

  const bestSwingHigh = swingHighs[0];
  const buffer = config.bufferPips * pipSize;
  const newStopLoss = bestSwingHigh.price + buffer;

  // Only move if better than current SL (lower for shorts)
  if (newStopLoss >= currentStopLoss) {
    return {
      shouldMove: false,
      reason: `Swing high SL (${newStopLoss.toFixed(2)}) not better than current (${currentStopLoss.toFixed(2)})`,
    };
  }

  return {
    shouldMove: true,
    newStopLoss,
    reason: `Trail to swing high at ${bestSwingHigh.price.toFixed(2)} + ${buffer.toFixed(2)} buffer`,
    swingPoint: bestSwingHigh,
  };
}
