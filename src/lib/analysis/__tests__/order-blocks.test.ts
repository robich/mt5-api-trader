import { describe, it, expect } from 'vitest';
import {
  identifyBullishOrderBlocks,
  identifyBearishOrderBlocks,
  identifyOrderBlocks,
  checkOrderBlockMitigation,
  isPriceAtOrderBlock,
  getNearestOrderBlock,
} from '../order-blocks';
import { Candle, OrderBlock, Timeframe } from '../../types';

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

// Build a candle sequence that has enough data for ATR calculation (need 15+ candles)
// and includes a pattern for OB identification
function buildCandlesWithBullishOB(): Candle[] {
  const candles: Candle[] = [];

  // Generate 20 baseline candles with some range for ATR
  for (let i = 0; i < 20; i++) {
    const base = 2000 + i * 2;
    candles.push(
      makeCandle(t(i), base, base + 5, base - 5, base + 1)
    );
  }

  // Add bearish candle (potential bullish OB) at index 20
  candles.push(makeCandle(t(20), 2042, 2044, 2035, 2036)); // bearish: close < open

  // Add strong bullish impulse candle at index 21 (close above OB)
  candles.push(makeCandle(t(21), 2037, 2060, 2036, 2058)); // strong bullish move

  // Add continuation candles to make move significant
  candles.push(makeCandle(t(22), 2058, 2070, 2055, 2068));
  candles.push(makeCandle(t(23), 2068, 2080, 2065, 2078));
  candles.push(makeCandle(t(24), 2078, 2090, 2075, 2088));

  return candles;
}

function buildCandlesWithBearishOB(): Candle[] {
  const candles: Candle[] = [];

  // Generate 20 baseline candles
  for (let i = 0; i < 20; i++) {
    const base = 2100 - i * 2;
    candles.push(
      makeCandle(t(i), base, base + 5, base - 5, base - 1)
    );
  }

  // Add bullish candle (potential bearish OB) at index 20
  candles.push(makeCandle(t(20), 2058, 2065, 2056, 2064)); // bullish: close > open

  // Add strong bearish impulse candle at index 21 (close below OB)
  candles.push(makeCandle(t(21), 2063, 2064, 2040, 2042)); // strong bearish move

  // Add continuation
  candles.push(makeCandle(t(22), 2042, 2044, 2030, 2032));
  candles.push(makeCandle(t(23), 2032, 2034, 2020, 2022));
  candles.push(makeCandle(t(24), 2022, 2024, 2010, 2012));

  return candles;
}

describe('identifyBullishOrderBlocks', () => {
  it('should identify bullish OB (bearish candle before bullish move)', () => {
    const candles = buildCandlesWithBullishOB();
    const obs = identifyBullishOrderBlocks(candles, 'XAUUSD', 'H1', 25);

    // Should find the bearish candle at index 20
    const found = obs.some(
      (ob) => ob.type === 'BULLISH' && ob.high === 2044 && ob.low === 2035
    );
    expect(found).toBe(true);
  });

  it('should return empty when not enough candles', () => {
    const candles = [makeCandle(t(0), 2000, 2005, 1995, 2002)];
    expect(
      identifyBullishOrderBlocks(candles, 'XAUUSD', 'H1', 50)
    ).toHaveLength(0);
  });

  it('should set correct properties on identified OBs', () => {
    const candles = buildCandlesWithBullishOB();
    const obs = identifyBullishOrderBlocks(candles, 'XAUUSD', 'H1', 25);

    if (obs.length > 0) {
      const ob = obs[0];
      expect(ob.symbol).toBe('XAUUSD');
      expect(ob.timeframe).toBe('H1');
      expect(ob.type).toBe('BULLISH');
      expect(ob.isValid).toBe(true);
      expect(ob.id).toBeDefined();
    }
  });
});

describe('identifyBearishOrderBlocks', () => {
  it('should identify bearish OB (bullish candle before bearish move)', () => {
    const candles = buildCandlesWithBearishOB();
    const obs = identifyBearishOrderBlocks(candles, 'XAUUSD', 'H1', 25);

    const found = obs.some(
      (ob) => ob.type === 'BEARISH' && ob.high === 2065 && ob.low === 2056
    );
    expect(found).toBe(true);
  });
});

describe('identifyOrderBlocks', () => {
  it('should find both bullish and bearish OBs', () => {
    // Create a sequence with both patterns
    const candles: Candle[] = [];

    // Baseline
    for (let i = 0; i < 20; i++) {
      candles.push(makeCandle(t(i), 2050, 2055, 2045, 2051));
    }

    // Bullish OB pattern
    candles.push(makeCandle(t(20), 2052, 2054, 2045, 2046)); // bearish
    candles.push(makeCandle(t(21), 2047, 2070, 2046, 2068)); // strong bullish
    candles.push(makeCandle(t(22), 2068, 2080, 2065, 2078));
    candles.push(makeCandle(t(23), 2078, 2090, 2075, 2088));
    candles.push(makeCandle(t(24), 2088, 2100, 2085, 2098));

    const obs = identifyOrderBlocks(candles, 'XAUUSD', 'H1', 25);
    expect(obs.length).toBeGreaterThan(0);
  });

  it('should sort OBs by time', () => {
    const candles = buildCandlesWithBullishOB();
    const obs = identifyOrderBlocks(candles, 'XAUUSD', 'H1', 25);

    for (let i = 1; i < obs.length; i++) {
      expect(obs[i].candleTime.getTime()).toBeGreaterThanOrEqual(
        obs[i - 1].candleTime.getTime()
      );
    }
  });
});

describe('checkOrderBlockMitigation', () => {
  it('should detect bullish OB mitigation when price trades into zone', () => {
    const ob: OrderBlock = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'BULLISH',
      high: 2044,
      low: 2035,
      open: 2042,
      close: 2036,
      candleTime: t(20),
      isValid: true,
    };

    // Price trades into the OB zone (low is between OB low and high)
    const mitigatingCandle = makeCandle(t(30), 2050, 2052, 2040, 2048);
    expect(checkOrderBlockMitigation(ob, mitigatingCandle)).toBe(true);

    // Price doesn't reach the OB
    const nonMitigatingCandle = makeCandle(t(30), 2050, 2052, 2046, 2048);
    expect(checkOrderBlockMitigation(ob, nonMitigatingCandle)).toBe(false);
  });

  it('should detect bearish OB mitigation when price trades into zone', () => {
    const ob: OrderBlock = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'BEARISH',
      high: 2065,
      low: 2056,
      open: 2058,
      close: 2064,
      candleTime: t(20),
      isValid: true,
    };

    // Price trades into the OB zone (high is between OB low and high)
    const mitigatingCandle = makeCandle(t(30), 2050, 2060, 2048, 2055);
    expect(checkOrderBlockMitigation(ob, mitigatingCandle)).toBe(true);

    // Price doesn't reach the OB
    const nonMitigatingCandle = makeCandle(t(30), 2050, 2054, 2048, 2052);
    expect(checkOrderBlockMitigation(ob, nonMitigatingCandle)).toBe(false);
  });
});

describe('isPriceAtOrderBlock', () => {
  const ob: OrderBlock = {
    id: '1',
    symbol: 'XAUUSD',
    timeframe: 'H1',
    type: 'BULLISH',
    high: 2044,
    low: 2035,
    open: 2042,
    close: 2036,
    candleTime: t(20),
    isValid: true,
  };

  it('should return true when price is within OB zone', () => {
    expect(isPriceAtOrderBlock(2040, ob)).toBe(true);
    expect(isPriceAtOrderBlock(2035, ob)).toBe(true); // at low
    expect(isPriceAtOrderBlock(2044, ob)).toBe(true); // at high
  });

  it('should return false when price is outside OB zone', () => {
    expect(isPriceAtOrderBlock(2034, ob)).toBe(false);
    expect(isPriceAtOrderBlock(2045, ob)).toBe(false);
  });

  it('should respect tolerance parameter', () => {
    expect(isPriceAtOrderBlock(2034, ob, 2)).toBe(true); // within 2 pip tolerance
    expect(isPriceAtOrderBlock(2032, ob, 2)).toBe(false);
  });
});

describe('getNearestOrderBlock', () => {
  const obs: OrderBlock[] = [
    {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'BULLISH',
      high: 1990,
      low: 1985,
      open: 1989,
      close: 1986,
      candleTime: t(10),
      isValid: true,
    },
    {
      id: '2',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'BULLISH',
      high: 1995,
      low: 1992,
      open: 1994,
      close: 1993,
      candleTime: t(15),
      isValid: true,
    },
  ];

  it('should find nearest bullish OB below price', () => {
    const nearest = getNearestOrderBlock(obs, 2000, 'BULLISH');
    expect(nearest).toBeDefined();
    expect(nearest!.id).toBe('2'); // 1995 is closest to 2000
  });

  it('should return undefined if no OB below price', () => {
    expect(getNearestOrderBlock(obs, 1980, 'BULLISH')).toBeUndefined();
  });

  it('should filter by type', () => {
    expect(getNearestOrderBlock(obs, 2000, 'BEARISH')).toBeUndefined();
  });
});
