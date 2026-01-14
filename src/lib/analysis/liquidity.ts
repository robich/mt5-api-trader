import { Candle, LiquidityZone, Timeframe, SwingPoint } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { identifySwingPoints } from './market-structure';

/**
 * Liquidity Analysis for Smart Money Concepts
 * Identifies areas where stop losses and pending orders cluster (above highs, below lows)
 */

const EQUAL_LEVELS_TOLERANCE = 0.001; // 0.1% tolerance for identifying equal highs/lows

/**
 * Identifies liquidity zones from swing highs (buy-side liquidity)
 * Stop losses from short sellers sit above swing highs
 */
export function identifyBuySideLiquidity(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  swingPoints?: SwingPoint[]
): LiquidityZone[] {
  const zones: LiquidityZone[] = [];
  const swings = swingPoints || identifySwingPoints(candles);

  const highs = swings.filter((s) => s.type === 'HIGH');

  for (const high of highs) {
    zones.push({
      id: uuidv4(),
      symbol,
      timeframe,
      type: 'HIGH',
      price: high.price,
      candleTime: high.time,
      isSwept: false,
    });
  }

  return zones;
}

/**
 * Identifies liquidity zones from swing lows (sell-side liquidity)
 * Stop losses from long traders sit below swing lows
 */
export function identifySellSideLiquidity(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  swingPoints?: SwingPoint[]
): LiquidityZone[] {
  const zones: LiquidityZone[] = [];
  const swings = swingPoints || identifySwingPoints(candles);

  const lows = swings.filter((s) => s.type === 'LOW');

  for (const low of lows) {
    zones.push({
      id: uuidv4(),
      symbol,
      timeframe,
      type: 'LOW',
      price: low.price,
      candleTime: low.time,
      isSwept: false,
    });
  }

  return zones;
}

/**
 * Identifies all liquidity zones
 */
export function identifyLiquidityZones(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  swingPoints?: SwingPoint[]
): LiquidityZone[] {
  const buySide = identifyBuySideLiquidity(candles, symbol, timeframe, swingPoints);
  const sellSide = identifySellSideLiquidity(candles, symbol, timeframe, swingPoints);

  return [...buySide, ...sellSide].sort(
    (a, b) => a.candleTime.getTime() - b.candleTime.getTime()
  );
}

/**
 * Checks if a liquidity zone has been swept (stop hunt)
 */
export function checkLiquiditySweep(
  zone: LiquidityZone,
  candle: Candle
): boolean {
  if (zone.type === 'HIGH') {
    // Buy-side liquidity is swept when price trades above the high
    return candle.high > zone.price;
  } else {
    // Sell-side liquidity is swept when price trades below the low
    return candle.low < zone.price;
  }
}

/**
 * Checks for a liquidity sweep followed by rejection (stop hunt reversal)
 * This is a key SMC entry pattern
 */
export function detectLiquiditySweepReversal(
  zone: LiquidityZone,
  candles: Candle[],
  lookback: number = 3
): { isReversal: boolean; rejectionCandle?: Candle } {
  const recentCandles = candles.slice(-lookback);

  for (let i = 0; i < recentCandles.length; i++) {
    const candle = recentCandles[i];

    if (zone.type === 'HIGH') {
      // Check for sweep above high with close below
      if (candle.high > zone.price && candle.close < zone.price) {
        // Rejection candle - swept liquidity but closed below
        return { isReversal: true, rejectionCandle: candle };
      }
    } else {
      // Check for sweep below low with close above
      if (candle.low < zone.price && candle.close > zone.price) {
        // Rejection candle - swept liquidity but closed above
        return { isReversal: true, rejectionCandle: candle };
      }
    }
  }

  return { isReversal: false };
}

/**
 * Identifies equal highs (strong buy-side liquidity)
 * Equal highs have multiple touches at similar price levels
 */
export function identifyEqualHighs(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  lookback: number = 50,
  minTouches: number = 2
): LiquidityZone[] {
  const zones: LiquidityZone[] = [];
  const recentCandles = candles.slice(-lookback);

  // Group highs by price level
  const highLevels: Map<number, { count: number; times: Date[] }> = new Map();

  for (const candle of recentCandles) {
    // Round to tolerance level
    const roundedHigh = Math.round(candle.high / (candle.high * EQUAL_LEVELS_TOLERANCE)) * (candle.high * EQUAL_LEVELS_TOLERANCE);

    const existing = highLevels.get(roundedHigh);
    if (existing) {
      existing.count++;
      existing.times.push(candle.time);
    } else {
      highLevels.set(roundedHigh, { count: 1, times: [candle.time] });
    }
  }

  // Create zones for levels with multiple touches
  for (const [price, data] of highLevels) {
    if (data.count >= minTouches) {
      zones.push({
        id: uuidv4(),
        symbol,
        timeframe,
        type: 'HIGH',
        price,
        candleTime: data.times[data.times.length - 1],
        isSwept: false,
      });
    }
  }

  return zones;
}

/**
 * Identifies equal lows (strong sell-side liquidity)
 * Equal lows have multiple touches at similar price levels
 */
export function identifyEqualLows(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  lookback: number = 50,
  minTouches: number = 2
): LiquidityZone[] {
  const zones: LiquidityZone[] = [];
  const recentCandles = candles.slice(-lookback);

  // Group lows by price level
  const lowLevels: Map<number, { count: number; times: Date[] }> = new Map();

  for (const candle of recentCandles) {
    // Round to tolerance level
    const roundedLow = Math.round(candle.low / (candle.low * EQUAL_LEVELS_TOLERANCE)) * (candle.low * EQUAL_LEVELS_TOLERANCE);

    const existing = lowLevels.get(roundedLow);
    if (existing) {
      existing.count++;
      existing.times.push(candle.time);
    } else {
      lowLevels.set(roundedLow, { count: 1, times: [candle.time] });
    }
  }

  // Create zones for levels with multiple touches
  for (const [price, data] of lowLevels) {
    if (data.count >= minTouches) {
      zones.push({
        id: uuidv4(),
        symbol,
        timeframe,
        type: 'LOW',
        price,
        candleTime: data.times[data.times.length - 1],
        isSwept: false,
      });
    }
  }

  return zones;
}

/**
 * Filters liquidity zones to only unswept ones
 */
export function filterUnsweptLiquidity(
  zones: LiquidityZone[],
  candles: Candle[]
): LiquidityZone[] {
  return zones.filter((zone) => {
    const zoneIndex = candles.findIndex(
      (c) => c.time.getTime() === zone.candleTime.getTime()
    );

    if (zoneIndex === -1) return !zone.isSwept;

    // Check if any subsequent candle has swept the zone
    for (let i = zoneIndex + 1; i < candles.length; i++) {
      if (checkLiquiditySweep(zone, candles[i])) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Gets the nearest unswept liquidity zone
 */
export function getNearestLiquidityZone(
  zones: LiquidityZone[],
  currentPrice: number,
  type: 'HIGH' | 'LOW'
): LiquidityZone | undefined {
  const filtered = zones
    .filter((z) => z.type === type && !z.isSwept)
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));

  return filtered[0];
}

/**
 * Calculates distance to nearest liquidity
 */
export function getDistanceToLiquidity(
  currentPrice: number,
  zone: LiquidityZone
): { distance: number; distancePercent: number } {
  const distance = Math.abs(zone.price - currentPrice);
  const distancePercent = (distance / currentPrice) * 100;

  return { distance, distancePercent };
}

/**
 * Identifies inducement levels (minor liquidity to be swept before major liquidity)
 */
export function identifyInducement(
  majorLiquidity: LiquidityZone,
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe
): LiquidityZone | null {
  const zoneIndex = candles.findIndex(
    (c) => c.time.getTime() === majorLiquidity.candleTime.getTime()
  );

  if (zoneIndex === -1 || zoneIndex >= candles.length - 1) return null;

  // Look for minor swing point between the major liquidity and current price
  const subsequentCandles = candles.slice(zoneIndex + 1);

  if (majorLiquidity.type === 'HIGH') {
    // Look for a minor high below the major high
    let minorHigh = -Infinity;
    let minorTime: Date | null = null;

    for (const candle of subsequentCandles) {
      if (candle.high > minorHigh && candle.high < majorLiquidity.price) {
        minorHigh = candle.high;
        minorTime = candle.time;
      }
    }

    if (minorTime && minorHigh > -Infinity) {
      return {
        id: uuidv4(),
        symbol,
        timeframe,
        type: 'HIGH',
        price: minorHigh,
        candleTime: minorTime,
        isSwept: false,
      };
    }
  } else {
    // Look for a minor low above the major low
    let minorLow = Infinity;
    let minorTime: Date | null = null;

    for (const candle of subsequentCandles) {
      if (candle.low < minorLow && candle.low > majorLiquidity.price) {
        minorLow = candle.low;
        minorTime = candle.time;
      }
    }

    if (minorTime && minorLow < Infinity) {
      return {
        id: uuidv4(),
        symbol,
        timeframe,
        type: 'LOW',
        price: minorLow,
        candleTime: minorTime,
        isSwept: false,
      };
    }
  }

  return null;
}
