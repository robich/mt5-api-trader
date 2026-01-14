import {
  Candle,
  SwingPoint,
  MarketStructure,
  Bias,
  StructureType,
} from '../types';

/**
 * Market Structure Analysis for Smart Money Concepts
 * Identifies swing highs/lows, BOS (Break of Structure), and CHoCH (Change of Character)
 */

const SWING_LOOKBACK = 5; // Number of candles to look left/right for swing identification

/**
 * Identifies swing highs and lows in the price data
 */
export function identifySwingPoints(
  candles: Candle[],
  lookback: number = SWING_LOOKBACK
): SwingPoint[] {
  const swingPoints: SwingPoint[] = [];

  if (candles.length < lookback * 2 + 1) {
    return swingPoints;
  }

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];

    // Check for swing high
    let isSwingHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && candles[j].high >= current.high) {
        isSwingHigh = false;
        break;
      }
    }

    if (isSwingHigh) {
      swingPoints.push({
        type: 'HIGH',
        price: current.high,
        time: current.time,
        index: i,
      });
    }

    // Check for swing low
    let isSwingLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && candles[j].low <= current.low) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      swingPoints.push({
        type: 'LOW',
        price: current.low,
        time: current.time,
        index: i,
      });
    }
  }

  // Sort by time
  return swingPoints.sort((a, b) => a.time.getTime() - b.time.getTime());
}

/**
 * Analyzes market structure to determine trend and key levels
 */
export function analyzeMarketStructure(candles: Candle[]): MarketStructure {
  const swingPoints = identifySwingPoints(candles);

  if (swingPoints.length < 4) {
    return {
      bias: 'NEUTRAL',
      lastStructure: 'HL', // Default
      swingPoints,
    };
  }

  // Get the last 4 significant swing points to determine structure
  const recentSwings = swingPoints.slice(-8);
  const highs = recentSwings.filter((s) => s.type === 'HIGH');
  const lows = recentSwings.filter((s) => s.type === 'LOW');

  let bias: Bias = 'NEUTRAL';
  let lastStructure: StructureType = 'HL';
  let lastBOS: MarketStructure['lastBOS'] | undefined;
  let lastCHOCH: MarketStructure['lastCHOCH'] | undefined;

  if (highs.length >= 2 && lows.length >= 2) {
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];

    // Determine structure type
    const isHigherHigh = lastHigh.price > prevHigh.price;
    const isHigherLow = lastLow.price > prevLow.price;
    const isLowerLow = lastLow.price < prevLow.price;
    const isLowerHigh = lastHigh.price < prevHigh.price;

    // Bullish structure: HH + HL
    if (isHigherHigh && isHigherLow) {
      bias = 'BULLISH';
      lastStructure = 'HH';
    }
    // Bearish structure: LH + LL
    else if (isLowerHigh && isLowerLow) {
      bias = 'BEARISH';
      lastStructure = 'LL';
    }
    // Potential reversal patterns
    else if (isHigherHigh && isLowerLow) {
      // Could be BOS from bearish to bullish
      bias = 'BULLISH';
      lastStructure = 'BOS';
      lastBOS = {
        type: 'BOS',
        price: lastHigh.price,
        time: lastHigh.time,
      };
    } else if (isLowerLow && isHigherHigh) {
      // CHoCH - Change of Character
      bias = 'NEUTRAL';
      lastStructure = 'CHOCH';
      lastCHOCH = {
        type: 'CHOCH',
        price: lastLow.price,
        time: lastLow.time,
      };
    }

    // Detect Break of Structure
    const currentPrice = candles[candles.length - 1].close;

    // Bullish BOS: price breaks above recent swing high in downtrend
    if (bias === 'BEARISH' && currentPrice > prevHigh.price) {
      lastBOS = {
        type: 'BOS',
        price: prevHigh.price,
        time: candles[candles.length - 1].time,
      };
      bias = 'BULLISH';
      lastStructure = 'BOS';
    }

    // Bearish BOS: price breaks below recent swing low in uptrend
    if (bias === 'BULLISH' && currentPrice < prevLow.price) {
      lastBOS = {
        type: 'BOS',
        price: prevLow.price,
        time: candles[candles.length - 1].time,
      };
      bias = 'BEARISH';
      lastStructure = 'BOS';
    }
  }

  return {
    bias,
    lastStructure,
    swingPoints,
    lastBOS,
    lastCHOCH,
  };
}

/**
 * Finds the most recent swing high above a price level
 */
export function findNearestSwingHigh(
  swingPoints: SwingPoint[],
  abovePrice: number
): SwingPoint | undefined {
  const highs = swingPoints
    .filter((s) => s.type === 'HIGH' && s.price > abovePrice)
    .sort((a, b) => a.price - b.price);
  return highs[0];
}

/**
 * Finds the most recent swing low below a price level
 */
export function findNearestSwingLow(
  swingPoints: SwingPoint[],
  belowPrice: number
): SwingPoint | undefined {
  const lows = swingPoints
    .filter((s) => s.type === 'LOW' && s.price < belowPrice)
    .sort((a, b) => b.price - a.price);
  return lows[0];
}

/**
 * Calculates the premium and discount zones (Fibonacci levels)
 */
export function calculatePremiumDiscount(
  swingHigh: number,
  swingLow: number
): {
  premium: { high: number; low: number };
  discount: { high: number; low: number };
  equilibrium: number;
  fib50: number;
  fib618: number;
  fib786: number;
} {
  const range = swingHigh - swingLow;
  const equilibrium = swingLow + range * 0.5;
  const fib618 = swingLow + range * 0.618;
  const fib786 = swingLow + range * 0.786;

  return {
    premium: {
      high: swingHigh,
      low: equilibrium,
    },
    discount: {
      high: equilibrium,
      low: swingLow,
    },
    equilibrium,
    fib50: equilibrium,
    fib618,
    fib786,
  };
}

/**
 * Checks if price is in discount zone (for buys)
 */
export function isPriceInDiscount(
  price: number,
  swingHigh: number,
  swingLow: number
): boolean {
  const zones = calculatePremiumDiscount(swingHigh, swingLow);
  return price >= zones.discount.low && price <= zones.discount.high;
}

/**
 * Checks if price is in premium zone (for sells)
 */
export function isPriceInPremium(
  price: number,
  swingHigh: number,
  swingLow: number
): boolean {
  const zones = calculatePremiumDiscount(swingHigh, swingLow);
  return price >= zones.premium.low && price <= zones.premium.high;
}

/**
 * Detects Break of Structure (BOS)
 */
export function detectBOS(
  candles: Candle[],
  swingPoints: SwingPoint[]
): { type: 'BULLISH' | 'BEARISH'; price: number; time: Date } | null {
  if (swingPoints.length < 2) return null;

  const currentCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];

  // Get recent swing points
  const recentHighs = swingPoints
    .filter((s) => s.type === 'HIGH')
    .slice(-3);
  const recentLows = swingPoints
    .filter((s) => s.type === 'LOW')
    .slice(-3);

  // Bullish BOS: Current close breaks above recent swing high
  for (const high of recentHighs) {
    if (prevCandle.close <= high.price && currentCandle.close > high.price) {
      return {
        type: 'BULLISH',
        price: high.price,
        time: currentCandle.time,
      };
    }
  }

  // Bearish BOS: Current close breaks below recent swing low
  for (const low of recentLows) {
    if (prevCandle.close >= low.price && currentCandle.close < low.price) {
      return {
        type: 'BEARISH',
        price: low.price,
        time: currentCandle.time,
      };
    }
  }

  return null;
}

/**
 * Detects Change of Character (CHoCH) - trend reversal signal
 */
export function detectCHOCH(
  candles: Candle[],
  structure: MarketStructure
): { type: 'BULLISH' | 'BEARISH'; price: number; time: Date } | null {
  if (structure.swingPoints.length < 4) return null;

  const currentCandle = candles[candles.length - 1];
  const highs = structure.swingPoints.filter((s) => s.type === 'HIGH');
  const lows = structure.swingPoints.filter((s) => s.type === 'LOW');

  if (highs.length < 2 || lows.length < 2) return null;

  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];

  // Bullish CHoCH in a bearish trend: price breaks above most recent lower high
  if (structure.bias === 'BEARISH') {
    if (currentCandle.close > lastHigh.price) {
      return {
        type: 'BULLISH',
        price: lastHigh.price,
        time: currentCandle.time,
      };
    }
  }

  // Bearish CHoCH in a bullish trend: price breaks below most recent higher low
  if (structure.bias === 'BULLISH') {
    if (currentCandle.close < lastLow.price) {
      return {
        type: 'BEARISH',
        price: lastLow.price,
        time: currentCandle.time,
      };
    }
  }

  return null;
}
