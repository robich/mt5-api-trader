/**
 * Confirmation Candle Analysis
 *
 * Implements confirmation candle patterns for SMC entry validation.
 * Based on backtest optimization results from .claude/backtest-insights.md
 *
 * Confirmation types:
 * - 'none': Immediate entry on OB touch
 * - 'close': Candle closes in trade direction with 30%+ body
 * - 'strong': Strong candle with 50%+ body of range
 * - 'engulf': Engulfing pattern (current body engulfs previous)
 */

import { Candle, Direction } from '../types';
import { ConfirmationType } from '../strategies/strategy-profiles';

/**
 * Check if a candle is bullish
 */
export function isBullishCandle(candle: Candle): boolean {
  return candle.close > candle.open;
}

/**
 * Check if a candle is bearish
 */
export function isBearishCandle(candle: Candle): boolean {
  return candle.close < candle.open;
}

/**
 * Calculate candle body size
 */
export function getCandleBody(candle: Candle): number {
  return Math.abs(candle.close - candle.open);
}

/**
 * Calculate candle range (high - low)
 */
export function getCandleRange(candle: Candle): number {
  return candle.high - candle.low;
}

/**
 * Calculate body ratio (body / range)
 */
export function getBodyRatio(candle: Candle): number {
  const range = getCandleRange(candle);
  if (range === 0) return 0;
  return getCandleBody(candle) / range;
}

/**
 * Check if candle has a close confirmation
 * - Candle closes in the trade direction
 * - Body must be at least 30% of the range
 */
export function hasCloseConfirmation(candle: Candle, direction: Direction): boolean {
  const bodyRatio = getBodyRatio(candle);
  const minBodyRatio = 0.3;

  if (direction === 'BUY') {
    return isBullishCandle(candle) && bodyRatio >= minBodyRatio;
  } else {
    return isBearishCandle(candle) && bodyRatio >= minBodyRatio;
  }
}

/**
 * Check if candle has a strong confirmation
 * - Candle closes in the trade direction
 * - Body must be at least 50% of the range
 */
export function hasStrongConfirmation(candle: Candle, direction: Direction): boolean {
  const bodyRatio = getBodyRatio(candle);
  const minBodyRatio = 0.5;

  if (direction === 'BUY') {
    return isBullishCandle(candle) && bodyRatio >= minBodyRatio;
  } else {
    return isBearishCandle(candle) && bodyRatio >= minBodyRatio;
  }
}

/**
 * Check if current candle engulfs the previous candle
 * - Current candle body completely engulfs previous candle body
 * - Current candle is in the trade direction
 */
export function hasEngulfingConfirmation(
  currentCandle: Candle,
  prevCandle: Candle,
  direction: Direction
): boolean {
  const currentBody = getCandleBody(currentCandle);
  const prevBody = getCandleBody(prevCandle);

  if (direction === 'BUY') {
    // Bullish engulfing: current is bullish and engulfs previous
    return (
      isBullishCandle(currentCandle) &&
      currentBody > prevBody &&
      currentCandle.close > Math.max(prevCandle.open, prevCandle.close) &&
      currentCandle.open < Math.min(prevCandle.open, prevCandle.close)
    );
  } else {
    // Bearish engulfing: current is bearish and engulfs previous
    return (
      isBearishCandle(currentCandle) &&
      currentBody > prevBody &&
      currentCandle.close < Math.min(prevCandle.open, prevCandle.close) &&
      currentCandle.open > Math.max(prevCandle.open, prevCandle.close)
    );
  }
}

/**
 * Check confirmation based on type
 */
export function checkConfirmation(
  confirmationType: ConfirmationType,
  currentCandle: Candle,
  prevCandle: Candle | null,
  direction: Direction
): boolean {
  switch (confirmationType) {
    case 'none':
      return true; // No confirmation needed

    case 'close':
      return hasCloseConfirmation(currentCandle, direction);

    case 'strong':
      return hasStrongConfirmation(currentCandle, direction);

    case 'engulf':
      if (!prevCandle) return false;
      return hasEngulfingConfirmation(currentCandle, prevCandle, direction);

    default:
      return true;
  }
}

/**
 * Confirmation status for pending signals
 */
export interface PendingConfirmation {
  /** Signal ID */
  signalId: string;
  /** Symbol */
  symbol: string;
  /** Trade direction */
  direction: Direction;
  /** Required confirmation type */
  confirmationType: ConfirmationType;
  /** Order Block entry price */
  obEntryPrice: number;
  /** Stop loss level */
  stopLoss: number;
  /** Original signal creation time */
  createdAt: Date;
  /** When to expire this pending signal */
  expiresAt: Date;
}

/**
 * Default expiration for pending confirmations (4 hours)
 */
export const CONFIRMATION_EXPIRY_MS = 4 * 60 * 60 * 1000;

/**
 * Create a pending confirmation entry
 */
export function createPendingConfirmation(
  signalId: string,
  symbol: string,
  direction: Direction,
  confirmationType: ConfirmationType,
  obEntryPrice: number,
  stopLoss: number
): PendingConfirmation {
  return {
    signalId,
    symbol,
    direction,
    confirmationType,
    obEntryPrice,
    stopLoss,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + CONFIRMATION_EXPIRY_MS),
  };
}

/**
 * Check if a pending confirmation has expired
 */
export function isConfirmationExpired(pending: PendingConfirmation): boolean {
  return new Date() > pending.expiresAt;
}

/**
 * Check if stop loss was hit while waiting for confirmation
 */
export function isStopLossHit(
  pending: PendingConfirmation,
  currentPrice: number
): boolean {
  if (pending.direction === 'BUY') {
    return currentPrice <= pending.stopLoss;
  } else {
    return currentPrice >= pending.stopLoss;
  }
}

/**
 * Get lower wick size
 */
export function getLowerWick(candle: Candle): number {
  return Math.min(candle.open, candle.close) - candle.low;
}

/**
 * Get upper wick size
 */
export function getUpperWick(candle: Candle): number {
  return candle.high - Math.max(candle.open, candle.close);
}

/**
 * Check for rejection candle (for lower quality OB scores)
 * - For BUY: look for lower wick rejection
 * - For SELL: look for upper wick rejection
 */
export function hasRejectionWick(candle: Candle, direction: Direction): boolean {
  const body = getCandleBody(candle);

  if (direction === 'BUY') {
    const lowerWick = getLowerWick(candle);
    return lowerWick > body * 0.3;
  } else {
    const upperWick = getUpperWick(candle);
    return upperWick > body * 0.3;
  }
}

/**
 * Enhanced entry check for lower quality OB scores (50-59)
 * Requires either:
 * - A directional candle (closing in trade direction)
 * - A rejection wick
 */
export function hasLowScoreEntry(candle: Candle, direction: Direction): boolean {
  if (direction === 'BUY') {
    return isBullishCandle(candle) || hasRejectionWick(candle, direction);
  } else {
    return isBearishCandle(candle) || hasRejectionWick(candle, direction);
  }
}
