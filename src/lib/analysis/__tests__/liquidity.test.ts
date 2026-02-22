import { describe, it, expect } from 'vitest';
import {
  checkLiquiditySweep,
  detectLiquiditySweepReversal,
  filterUnsweptLiquidity,
  getNearestLiquidityZone,
  getDistanceToLiquidity,
} from '../liquidity';
import { Candle, LiquidityZone, Timeframe } from '../../types';

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

describe('checkLiquiditySweep', () => {
  it('should detect sweep of buy-side liquidity (high)', () => {
    const zone: LiquidityZone = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'HIGH',
      price: 2050,
      candleTime: t(0),
      isSwept: false,
    };

    // Candle trades above the high
    const sweepCandle = makeCandle(t(10), 2045, 2055, 2040, 2048);
    expect(checkLiquiditySweep(zone, sweepCandle)).toBe(true);

    // Candle doesn't reach the high
    const noSweepCandle = makeCandle(t(10), 2045, 2049, 2040, 2048);
    expect(checkLiquiditySweep(zone, noSweepCandle)).toBe(false);
  });

  it('should detect sweep of sell-side liquidity (low)', () => {
    const zone: LiquidityZone = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'LOW',
      price: 2000,
      candleTime: t(0),
      isSwept: false,
    };

    // Candle trades below the low
    const sweepCandle = makeCandle(t(10), 2005, 2008, 1998, 2003);
    expect(checkLiquiditySweep(zone, sweepCandle)).toBe(true);

    // Candle doesn't reach the low
    const noSweepCandle = makeCandle(t(10), 2005, 2008, 2001, 2003);
    expect(checkLiquiditySweep(zone, noSweepCandle)).toBe(false);
  });
});

describe('detectLiquiditySweepReversal', () => {
  it('should detect reversal after sweep of buy-side liquidity', () => {
    const zone: LiquidityZone = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'HIGH',
      price: 2050,
      candleTime: t(0),
      isSwept: false,
    };

    // Sweep above high but close below = rejection
    const candles: Candle[] = [
      makeCandle(t(10), 2048, 2055, 2040, 2042), // swept above 2050 but closed below
    ];

    const result = detectLiquiditySweepReversal(zone, candles);
    expect(result.isReversal).toBe(true);
    expect(result.rejectionCandle).toBeDefined();
  });

  it('should detect reversal after sweep of sell-side liquidity', () => {
    const zone: LiquidityZone = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'LOW',
      price: 2000,
      candleTime: t(0),
      isSwept: false,
    };

    // Sweep below low but close above = rejection
    const candles: Candle[] = [
      makeCandle(t(10), 2002, 2008, 1997, 2005), // swept below 2000 but closed above
    ];

    const result = detectLiquiditySweepReversal(zone, candles);
    expect(result.isReversal).toBe(true);
  });

  it('should return no reversal when sweep continues', () => {
    const zone: LiquidityZone = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'HIGH',
      price: 2050,
      candleTime: t(0),
      isSwept: false,
    };

    // Breaks and stays above
    const candles: Candle[] = [
      makeCandle(t(10), 2048, 2060, 2047, 2058), // broke and stayed above
    ];

    const result = detectLiquiditySweepReversal(zone, candles);
    expect(result.isReversal).toBe(false);
  });

  it('should check multiple candles in lookback', () => {
    const zone: LiquidityZone = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'HIGH',
      price: 2050,
      candleTime: t(0),
      isSwept: false,
    };

    const candles: Candle[] = [
      makeCandle(t(8), 2040, 2045, 2035, 2042),
      makeCandle(t(9), 2042, 2048, 2040, 2046),
      makeCandle(t(10), 2046, 2055, 2040, 2042), // rejection candle
    ];

    const result = detectLiquiditySweepReversal(zone, candles, 3);
    expect(result.isReversal).toBe(true);
  });
});

describe('filterUnsweptLiquidity', () => {
  it('should filter out swept zones', () => {
    const zones: LiquidityZone[] = [
      {
        id: '1',
        symbol: 'XAUUSD',
        timeframe: 'H1',
        type: 'HIGH',
        price: 2050,
        candleTime: t(0),
        isSwept: false,
      },
    ];

    const candles: Candle[] = [
      makeCandle(t(0), 2040, 2045, 2035, 2042),
      makeCandle(t(1), 2042, 2055, 2040, 2048), // sweeps the 2050 high
    ];

    const unswept = filterUnsweptLiquidity(zones, candles);
    expect(unswept).toHaveLength(0);
  });

  it('should keep unswept zones', () => {
    const zones: LiquidityZone[] = [
      {
        id: '1',
        symbol: 'XAUUSD',
        timeframe: 'H1',
        type: 'HIGH',
        price: 2050,
        candleTime: t(0),
        isSwept: false,
      },
    ];

    const candles: Candle[] = [
      makeCandle(t(0), 2040, 2045, 2035, 2042),
      makeCandle(t(1), 2042, 2048, 2040, 2046), // doesn't reach 2050
    ];

    const unswept = filterUnsweptLiquidity(zones, candles);
    expect(unswept).toHaveLength(1);
  });
});

describe('getNearestLiquidityZone', () => {
  const zones: LiquidityZone[] = [
    {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'HIGH',
      price: 2050,
      candleTime: t(0),
      isSwept: false,
    },
    {
      id: '2',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'HIGH',
      price: 2080,
      candleTime: t(5),
      isSwept: false,
    },
    {
      id: '3',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'LOW',
      price: 2000,
      candleTime: t(3),
      isSwept: false,
    },
  ];

  it('should find nearest high zone', () => {
    const nearest = getNearestLiquidityZone(zones, 2040, 'HIGH');
    expect(nearest).toBeDefined();
    expect(nearest!.price).toBe(2050); // closest high to 2040
  });

  it('should find nearest low zone', () => {
    const nearest = getNearestLiquidityZone(zones, 2040, 'LOW');
    expect(nearest).toBeDefined();
    expect(nearest!.price).toBe(2000);
  });

  it('should exclude swept zones', () => {
    const sweptZones: LiquidityZone[] = [
      { ...zones[0], isSwept: true },
      zones[1],
    ];
    const nearest = getNearestLiquidityZone(sweptZones, 2040, 'HIGH');
    expect(nearest!.price).toBe(2080); // skipped swept zone
  });
});

describe('getDistanceToLiquidity', () => {
  it('should calculate distance and percentage', () => {
    const zone: LiquidityZone = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      type: 'HIGH',
      price: 2050,
      candleTime: t(0),
      isSwept: false,
    };

    const result = getDistanceToLiquidity(2000, zone);
    expect(result.distance).toBe(50);
    expect(result.distancePercent).toBe(2.5); // 50/2000 * 100
  });
});
