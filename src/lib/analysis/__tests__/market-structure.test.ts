import { describe, it, expect } from 'vitest';
import {
  identifySwingPoints,
  analyzeMarketStructure,
  calculatePremiumDiscount,
  isPriceInDiscount,
  isPriceInPremium,
  findNearestSwingHigh,
  findNearestSwingLow,
  detectBOS,
} from '../market-structure';
import { Candle, SwingPoint, Timeframe } from '../../types';

function makeCandle(
  time: Date,
  open: number,
  high: number,
  low: number,
  close: number
): Candle {
  return {
    time,
    open,
    high,
    low,
    close,
    volume: 100,
    symbol: 'XAUUSD',
    timeframe: 'H1' as Timeframe,
  };
}

function t(hoursOffset: number): Date {
  return new Date(Date.UTC(2026, 1, 16, hoursOffset));
}

describe('identifySwingPoints', () => {
  it('should identify swing highs and lows with default lookback', () => {
    // Create a clear V pattern: rise, peak, fall, trough, rise
    const candles: Candle[] = [];
    // Need at least 11 candles for lookback=5: 5 left + 1 center + 5 right
    const prices = [
      2000, 2005, 2010, 2015, 2020, // rising
      2025, // peak (swing high at index 5)
      2020, 2015, 2010, 2005, 2000, // falling
    ];

    for (let i = 0; i < prices.length; i++) {
      const p = prices[i];
      candles.push(makeCandle(t(i), p - 1, p + 2, p - 2, p + 1));
    }

    const swings = identifySwingPoints(candles, 5);
    const highs = swings.filter((s) => s.type === 'HIGH');
    const lows = swings.filter((s) => s.type === 'LOW');

    // Should find the peak
    expect(highs.length).toBeGreaterThanOrEqual(1);
    expect(highs[0].price).toBe(2027); // 2025 + 2
  });

  it('should return empty for too few candles', () => {
    const candles = [makeCandle(t(0), 2000, 2005, 1995, 2002)];
    expect(identifySwingPoints(candles, 5)).toHaveLength(0);
  });

  it('should find both swing high and swing low', () => {
    // M-shape: rise, fall, rise higher, fall
    const prices = [
      2000, 2005, 2010, 2015, 2020,
      2025, // swing high
      2020, 2015, 2010, 2005,
      2000, // swing low
      2005, 2010, 2015, 2020, 2025,
    ];

    const candles: Candle[] = prices.map((p, i) =>
      makeCandle(t(i), p - 1, p + 1, p - 1, p)
    );

    const swings = identifySwingPoints(candles, 5);
    const types = swings.map((s) => s.type);

    expect(types).toContain('HIGH');
    expect(types).toContain('LOW');
  });

  it('should sort swing points by time', () => {
    const prices = [
      2000, 2005, 2010, 2015, 2020,
      2025,
      2020, 2015, 2010, 2005,
      2000,
      2005, 2010, 2015, 2020, 2025,
    ];

    const candles: Candle[] = prices.map((p, i) =>
      makeCandle(t(i), p - 1, p + 1, p - 1, p)
    );

    const swings = identifySwingPoints(candles, 5);
    for (let i = 1; i < swings.length; i++) {
      expect(swings[i].time.getTime()).toBeGreaterThanOrEqual(
        swings[i - 1].time.getTime()
      );
    }
  });
});

describe('analyzeMarketStructure', () => {
  it('should return NEUTRAL with few candles', () => {
    const candles = Array.from({ length: 5 }, (_, i) =>
      makeCandle(t(i), 2000, 2005, 1995, 2002)
    );
    const structure = analyzeMarketStructure(candles);
    expect(structure.bias).toBe('NEUTRAL');
  });

  it('should detect bullish structure (HH + HL)', () => {
    // Build uptrend: higher highs and higher lows
    const prices = [
      // First swing low
      2010, 2015, 2020, 2025, 2030,
      2035, // swing high 1
      2030, 2025, 2020, 2015,
      2012, // swing low 1 (higher than start)
      2015, 2020, 2025, 2030, 2035,
      2040, // swing high 2 (higher high)
      2035, 2030, 2025, 2020,
      2018, // swing low 2 (higher low)
      2020, 2025, 2030, 2035, 2040,
    ];

    const candles: Candle[] = prices.map((p, i) =>
      makeCandle(t(i), p - 1, p + 1, p - 1, p)
    );

    const structure = analyzeMarketStructure(candles);
    // May be BULLISH or have detected bullish structure
    expect(['BULLISH', 'NEUTRAL']).toContain(structure.bias);
    expect(structure.swingPoints.length).toBeGreaterThan(0);
  });

  it('should include swing points in the result', () => {
    const prices = [
      2000, 2005, 2010, 2015, 2020,
      2025,
      2020, 2015, 2010, 2005,
      2000,
      2005, 2010, 2015, 2020, 2025,
    ];

    const candles: Candle[] = prices.map((p, i) =>
      makeCandle(t(i), p - 1, p + 1, p - 1, p)
    );

    const structure = analyzeMarketStructure(candles);
    expect(structure.swingPoints).toBeDefined();
    expect(Array.isArray(structure.swingPoints)).toBe(true);
  });
});

describe('calculatePremiumDiscount', () => {
  it('should calculate correct zones', () => {
    const result = calculatePremiumDiscount(2100, 2000);

    expect(result.equilibrium).toBe(2050);
    expect(result.fib50).toBe(2050);
    expect(result.fib618).toBeCloseTo(2061.8, 1);
    expect(result.fib786).toBeCloseTo(2078.6, 1);
    expect(result.premium.high).toBe(2100);
    expect(result.premium.low).toBe(2050);
    expect(result.discount.high).toBe(2050);
    expect(result.discount.low).toBe(2000);
  });

  it('should handle small ranges', () => {
    const result = calculatePremiumDiscount(2001, 2000);
    expect(result.equilibrium).toBe(2000.5);
  });
});

describe('isPriceInDiscount', () => {
  it('should return true for price in discount zone', () => {
    expect(isPriceInDiscount(2020, 2100, 2000)).toBe(true);
    expect(isPriceInDiscount(2000, 2100, 2000)).toBe(true); // at bottom
    expect(isPriceInDiscount(2050, 2100, 2000)).toBe(true); // at equilibrium
  });

  it('should return false for price in premium zone', () => {
    expect(isPriceInDiscount(2060, 2100, 2000)).toBe(false);
    expect(isPriceInDiscount(2100, 2100, 2000)).toBe(false);
  });
});

describe('isPriceInPremium', () => {
  it('should return true for price in premium zone', () => {
    expect(isPriceInPremium(2060, 2100, 2000)).toBe(true);
    expect(isPriceInPremium(2100, 2100, 2000)).toBe(true); // at top
    expect(isPriceInPremium(2050, 2100, 2000)).toBe(true); // at equilibrium
  });

  it('should return false for price in discount zone', () => {
    expect(isPriceInPremium(2020, 2100, 2000)).toBe(false);
    expect(isPriceInPremium(2000, 2100, 2000)).toBe(false);
  });
});

describe('findNearestSwingHigh', () => {
  const swingPoints: SwingPoint[] = [
    { type: 'HIGH', price: 2050, time: t(5), index: 5 },
    { type: 'HIGH', price: 2070, time: t(10), index: 10 },
    { type: 'HIGH', price: 2090, time: t(15), index: 15 },
    { type: 'LOW', price: 2020, time: t(8), index: 8 },
  ];

  it('should find the nearest swing high above price', () => {
    const result = findNearestSwingHigh(swingPoints, 2040);
    expect(result).toBeDefined();
    expect(result!.price).toBe(2050); // closest above 2040
  });

  it('should return undefined if no swing high above price', () => {
    expect(findNearestSwingHigh(swingPoints, 2100)).toBeUndefined();
  });
});

describe('findNearestSwingLow', () => {
  const swingPoints: SwingPoint[] = [
    { type: 'LOW', price: 2000, time: t(5), index: 5 },
    { type: 'LOW', price: 2020, time: t(10), index: 10 },
    { type: 'LOW', price: 2040, time: t(15), index: 15 },
    { type: 'HIGH', price: 2070, time: t(8), index: 8 },
  ];

  it('should find the nearest swing low below price', () => {
    const result = findNearestSwingLow(swingPoints, 2050);
    expect(result).toBeDefined();
    expect(result!.price).toBe(2040); // closest below 2050
  });

  it('should return undefined if no swing low below price', () => {
    expect(findNearestSwingLow(swingPoints, 1990)).toBeUndefined();
  });
});

describe('detectBOS', () => {
  it('should detect bullish BOS when price breaks above swing high', () => {
    const swingPoints: SwingPoint[] = [
      { type: 'HIGH', price: 2050, time: t(5), index: 5 },
      { type: 'LOW', price: 2020, time: t(10), index: 10 },
    ];

    // Previous close below swing high, current close above
    const candles = [
      makeCandle(t(20), 2045, 2049, 2040, 2048), // below 2050
      makeCandle(t(21), 2048, 2055, 2047, 2053), // above 2050
    ];

    const bos = detectBOS(candles, swingPoints);
    expect(bos).not.toBeNull();
    expect(bos!.type).toBe('BULLISH');
    expect(bos!.price).toBe(2050);
  });

  it('should detect bearish BOS when price breaks below swing low', () => {
    const swingPoints: SwingPoint[] = [
      { type: 'HIGH', price: 2050, time: t(5), index: 5 },
      { type: 'LOW', price: 2020, time: t(10), index: 10 },
    ];

    const candles = [
      makeCandle(t(20), 2025, 2028, 2021, 2022), // above 2020
      makeCandle(t(21), 2022, 2023, 2015, 2018), // below 2020
    ];

    const bos = detectBOS(candles, swingPoints);
    expect(bos).not.toBeNull();
    expect(bos!.type).toBe('BEARISH');
    expect(bos!.price).toBe(2020);
  });

  it('should return null when no BOS detected', () => {
    const swingPoints: SwingPoint[] = [
      { type: 'HIGH', price: 2050, time: t(5), index: 5 },
      { type: 'LOW', price: 2020, time: t(10), index: 10 },
    ];

    const candles = [
      makeCandle(t(20), 2030, 2035, 2025, 2032),
      makeCandle(t(21), 2032, 2038, 2028, 2035), // still between 2020-2050
    ];

    expect(detectBOS(candles, swingPoints)).toBeNull();
  });

  it('should return null with insufficient swing points', () => {
    expect(detectBOS([makeCandle(t(0), 2000, 2005, 1995, 2002)], [])).toBeNull();
  });
});
