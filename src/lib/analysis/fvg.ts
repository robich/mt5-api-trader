import { Candle, FairValueGap, Timeframe } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Fair Value Gap (FVG) Analysis for Smart Money Concepts
 * Also known as imbalances - areas where price moved too fast and left a gap
 */

const MIN_GAP_PERCENT = 0.1; // Minimum gap size as percentage of price

/**
 * Identifies bullish Fair Value Gaps (price gaps up)
 * A bullish FVG occurs when candle 3's low is higher than candle 1's high
 */
export function identifyBullishFVGs(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  lookback: number = 50
): FairValueGap[] {
  const fvgs: FairValueGap[] = [];

  if (candles.length < 3) {
    return fvgs;
  }

  const startIndex = Math.max(0, candles.length - lookback);

  for (let i = startIndex; i < candles.length - 2; i++) {
    const candle1 = candles[i]; // First candle
    const candle2 = candles[i + 1]; // Middle candle (impulse)
    const candle3 = candles[i + 2]; // Third candle

    // Bullish FVG: candle3.low > candle1.high
    // This creates a gap between candle1's high and candle3's low
    if (candle3.low > candle1.high) {
      const gapSize = candle3.low - candle1.high;
      const gapPercent = (gapSize / candle1.high) * 100;

      // Only include significant gaps
      if (gapPercent >= MIN_GAP_PERCENT) {
        fvgs.push({
          id: uuidv4(),
          symbol,
          timeframe,
          type: 'BULLISH',
          high: candle3.low, // Top of the gap
          low: candle1.high, // Bottom of the gap
          gapTime: candle2.time,
          isFilled: false,
        });
      }
    }
  }

  return fvgs;
}

/**
 * Identifies bearish Fair Value Gaps (price gaps down)
 * A bearish FVG occurs when candle 3's high is lower than candle 1's low
 */
export function identifyBearishFVGs(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  lookback: number = 50
): FairValueGap[] {
  const fvgs: FairValueGap[] = [];

  if (candles.length < 3) {
    return fvgs;
  }

  const startIndex = Math.max(0, candles.length - lookback);

  for (let i = startIndex; i < candles.length - 2; i++) {
    const candle1 = candles[i]; // First candle
    const candle2 = candles[i + 1]; // Middle candle (impulse)
    const candle3 = candles[i + 2]; // Third candle

    // Bearish FVG: candle3.high < candle1.low
    // This creates a gap between candle1's low and candle3's high
    if (candle3.high < candle1.low) {
      const gapSize = candle1.low - candle3.high;
      const gapPercent = (gapSize / candle1.low) * 100;

      // Only include significant gaps
      if (gapPercent >= MIN_GAP_PERCENT) {
        fvgs.push({
          id: uuidv4(),
          symbol,
          timeframe,
          type: 'BEARISH',
          high: candle1.low, // Top of the gap
          low: candle3.high, // Bottom of the gap
          gapTime: candle2.time,
          isFilled: false,
        });
      }
    }
  }

  return fvgs;
}

/**
 * Identifies all Fair Value Gaps (both bullish and bearish)
 */
export function identifyFVGs(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  lookback: number = 50
): FairValueGap[] {
  const bullishFVGs = identifyBullishFVGs(candles, symbol, timeframe, lookback);
  const bearishFVGs = identifyBearishFVGs(candles, symbol, timeframe, lookback);

  // Combine and sort by time
  return [...bullishFVGs, ...bearishFVGs].sort(
    (a, b) => a.gapTime.getTime() - b.gapTime.getTime()
  );
}

/**
 * Checks if an FVG has been filled (price has returned to fill the gap)
 */
export function checkFVGFilled(
  fvg: FairValueGap,
  candle: Candle
): boolean {
  if (fvg.type === 'BULLISH') {
    // Bullish FVG is filled when price drops into the gap
    // Full fill: price reaches the bottom of the gap
    return candle.low <= fvg.low;
  } else {
    // Bearish FVG is filled when price rises into the gap
    // Full fill: price reaches the top of the gap
    return candle.high >= fvg.high;
  }
}

/**
 * Checks if price is currently in an FVG zone
 */
export function isPriceInFVG(
  price: number,
  fvg: FairValueGap
): boolean {
  return price >= fvg.low && price <= fvg.high;
}

/**
 * Checks for partial FVG fill (50% or more)
 */
export function checkFVGPartiallyFilled(
  fvg: FairValueGap,
  candle: Candle,
  fillPercent: number = 0.5
): boolean {
  const gapSize = fvg.high - fvg.low;
  const fillLevel = gapSize * fillPercent;

  if (fvg.type === 'BULLISH') {
    // Check if price has filled at least fillPercent of the gap
    const fillTarget = fvg.high - fillLevel;
    return candle.low <= fillTarget;
  } else {
    // Check if price has filled at least fillPercent of the gap
    const fillTarget = fvg.low + fillLevel;
    return candle.high >= fillTarget;
  }
}

/**
 * Filters FVGs to only valid (unfilled) ones
 */
export function filterUnfilledFVGs(
  fvgs: FairValueGap[],
  candles: Candle[]
): FairValueGap[] {
  return fvgs.filter((fvg) => {
    // Find the index of the candle when the FVG was created
    const fvgIndex = candles.findIndex(
      (c) => c.time.getTime() === fvg.gapTime.getTime()
    );

    if (fvgIndex === -1) return !fvg.isFilled;

    // Check if any subsequent candle has filled the FVG
    for (let i = fvgIndex + 1; i < candles.length; i++) {
      if (checkFVGFilled(fvg, candles[i])) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Gets the nearest unfilled FVG for potential entry
 */
export function getNearestFVG(
  fvgs: FairValueGap[],
  currentPrice: number,
  type: 'BULLISH' | 'BEARISH'
): FairValueGap | undefined {
  const filtered = fvgs
    .filter((fvg) => fvg.type === type && !fvg.isFilled)
    .sort((a, b) => {
      if (type === 'BULLISH') {
        // For longs, find FVG below current price
        return Math.abs(currentPrice - a.high) - Math.abs(currentPrice - b.high);
      } else {
        // For shorts, find FVG above current price
        return Math.abs(a.low - currentPrice) - Math.abs(b.low - currentPrice);
      }
    });

  if (type === 'BULLISH') {
    return filtered.find((fvg) => fvg.high < currentPrice);
  } else {
    return filtered.find((fvg) => fvg.low > currentPrice);
  }
}

/**
 * Calculates the FVG midpoint (often used for entries)
 */
export function getFVGMidpoint(fvg: FairValueGap): number {
  return (fvg.high + fvg.low) / 2;
}

/**
 * Gets FVG with confluence to an Order Block
 */
export function findFVGWithOBConfluence(
  fvgs: FairValueGap[],
  orderBlocks: Array<{ high: number; low: number; type: string }>,
  tolerance: number = 0.001 // 0.1% tolerance
): FairValueGap[] {
  return fvgs.filter((fvg) => {
    return orderBlocks.some((ob) => {
      // Check if FVG overlaps with OB
      const fvgRange = { high: fvg.high, low: fvg.low };
      const obRange = { high: ob.high * (1 + tolerance), low: ob.low * (1 - tolerance) };

      // Check for overlap
      return (
        fvg.type === ob.type &&
        fvgRange.low <= obRange.high &&
        fvgRange.high >= obRange.low
      );
    });
  });
}

/**
 * Identifies FVGs with strong momentum (large impulse candle)
 */
export function identifyStrongFVGs(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  lookback: number = 50,
  momentumThreshold: number = 2.0 // Multiplier of average candle size
): FairValueGap[] {
  const fvgs = identifyFVGs(candles, symbol, timeframe, lookback);

  // Calculate average candle body size
  const bodies = candles.slice(-lookback).map((c) => Math.abs(c.close - c.open));
  const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length;

  // Filter FVGs where the impulse candle (middle candle) is significantly larger than average
  return fvgs.filter((fvg) => {
    const fvgIndex = candles.findIndex(
      (c) => c.time.getTime() === fvg.gapTime.getTime()
    );

    if (fvgIndex === -1) return true;

    const impulseCandle = candles[fvgIndex];
    const impulseBody = Math.abs(impulseCandle.close - impulseCandle.open);

    return impulseBody >= avgBody * momentumThreshold;
  });
}
