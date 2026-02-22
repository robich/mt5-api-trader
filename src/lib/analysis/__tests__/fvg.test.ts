import { describe, it, expect } from 'vitest';
import {
  identifyBullishFVGs,
  identifyBearishFVGs,
  identifyFVGs,
  checkFVGFilled,
  isPriceInFVG,
  checkFVGPartiallyFilled,
  getNearestFVG,
  getFVGMidpoint,
} from '../fvg';
import { Candle, FairValueGap, Timeframe } from '../../types';

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
    timeframe: 'M15' as Timeframe,
  };
}

function t(minutesOffset: number): Date {
  return new Date(Date.UTC(2026, 1, 16, 0, minutesOffset));
}

describe('identifyBullishFVGs', () => {
  it('should identify a bullish FVG when candle3.low > candle1.high', () => {
    const candles: Candle[] = [
      makeCandle(t(0), 2000, 2005, 1995, 2002),  // candle1: high=2005
      makeCandle(t(15), 2003, 2020, 2002, 2018),  // candle2: impulse up
      makeCandle(t(30), 2016, 2025, 2010, 2022),  // candle3: low=2010 > 2005 ✓
    ];

    const fvgs = identifyBullishFVGs(candles, 'XAUUSD', 'M15');
    expect(fvgs).toHaveLength(1);
    expect(fvgs[0].type).toBe('BULLISH');
    expect(fvgs[0].low).toBe(2005); // candle1.high
    expect(fvgs[0].high).toBe(2010); // candle3.low
  });

  it('should not identify FVG when gap is too small', () => {
    const candles: Candle[] = [
      makeCandle(t(0), 2000, 2005.00, 1995, 2002),
      makeCandle(t(15), 2003, 2008, 2002, 2007),
      makeCandle(t(30), 2006, 2010, 2005.01, 2009), // gap = 0.01, too small
    ];

    const fvgs = identifyBullishFVGs(candles, 'XAUUSD', 'M15');
    expect(fvgs).toHaveLength(0);
  });

  it('should return empty for less than 3 candles', () => {
    const candles: Candle[] = [
      makeCandle(t(0), 2000, 2005, 1995, 2002),
      makeCandle(t(15), 2003, 2020, 2002, 2018),
    ];

    expect(identifyBullishFVGs(candles, 'XAUUSD', 'M15')).toHaveLength(0);
  });

  it('should identify multiple FVGs', () => {
    const candles: Candle[] = [
      makeCandle(t(0), 2000, 2005, 1995, 2002),
      makeCandle(t(15), 2003, 2020, 2002, 2018),
      makeCandle(t(30), 2016, 2025, 2010, 2022), // FVG 1: gap 2005->2010
      makeCandle(t(45), 2022, 2027, 2020, 2025),
      makeCandle(t(60), 2025, 2045, 2024, 2043), // impulse
      makeCandle(t(75), 2040, 2050, 2032, 2048), // FVG 2: gap 2027->2032
    ];

    const fvgs = identifyBullishFVGs(candles, 'XAUUSD', 'M15');
    expect(fvgs).toHaveLength(2);
  });
});

describe('identifyBearishFVGs', () => {
  it('should identify a bearish FVG when candle3.high < candle1.low', () => {
    const candles: Candle[] = [
      makeCandle(t(0), 2020, 2025, 2015, 2018),  // candle1: low=2015
      makeCandle(t(15), 2017, 2018, 2000, 2002),  // candle2: impulse down
      makeCandle(t(30), 2003, 2010, 1998, 2005),  // candle3: high=2010 < 2015 ✓
    ];

    const fvgs = identifyBearishFVGs(candles, 'XAUUSD', 'M15');
    expect(fvgs).toHaveLength(1);
    expect(fvgs[0].type).toBe('BEARISH');
    expect(fvgs[0].high).toBe(2015); // candle1.low
    expect(fvgs[0].low).toBe(2010); // candle3.high
  });
});

describe('identifyFVGs', () => {
  it('should find both bullish and bearish FVGs', () => {
    // Create a scenario with one bullish and one bearish FVG
    const candles: Candle[] = [
      // Bearish FVG
      makeCandle(t(0), 2020, 2025, 2015, 2018),
      makeCandle(t(15), 2017, 2018, 2000, 2002),
      makeCandle(t(30), 2003, 2010, 1998, 2005),
      // Bullish FVG
      makeCandle(t(45), 1998, 2000, 1990, 1995),
      makeCandle(t(60), 1996, 2015, 1995, 2013),
      makeCandle(t(75), 2010, 2020, 2005, 2018), // low=2005 > 2000
    ];

    const fvgs = identifyFVGs(candles, 'XAUUSD', 'M15');
    const types = fvgs.map((f) => f.type);
    expect(types).toContain('BULLISH');
    expect(types).toContain('BEARISH');
  });

  it('should sort FVGs by time', () => {
    const candles: Candle[] = [
      makeCandle(t(0), 2020, 2025, 2015, 2018),
      makeCandle(t(15), 2017, 2018, 2000, 2002),
      makeCandle(t(30), 2003, 2010, 1998, 2005),
      makeCandle(t(45), 1998, 2000, 1990, 1995),
      makeCandle(t(60), 1996, 2015, 1995, 2013),
      makeCandle(t(75), 2010, 2020, 2005, 2018),
    ];

    const fvgs = identifyFVGs(candles, 'XAUUSD', 'M15');
    for (let i = 1; i < fvgs.length; i++) {
      expect(fvgs[i].gapTime.getTime()).toBeGreaterThanOrEqual(
        fvgs[i - 1].gapTime.getTime()
      );
    }
  });
});

describe('checkFVGFilled', () => {
  it('should detect bullish FVG fill when price drops to gap bottom', () => {
    const fvg: FairValueGap = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'M15',
      type: 'BULLISH',
      high: 2010,
      low: 2005,
      gapTime: t(15),
      isFilled: false,
    };

    const fillingCandle = makeCandle(t(60), 2008, 2009, 2004, 2006);
    expect(checkFVGFilled(fvg, fillingCandle)).toBe(true);

    const nonFillingCandle = makeCandle(t(60), 2008, 2009, 2006, 2007);
    expect(checkFVGFilled(fvg, nonFillingCandle)).toBe(false);
  });

  it('should detect bearish FVG fill when price rises to gap top', () => {
    const fvg: FairValueGap = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'M15',
      type: 'BEARISH',
      high: 2015,
      low: 2010,
      gapTime: t(15),
      isFilled: false,
    };

    const fillingCandle = makeCandle(t(60), 2012, 2016, 2011, 2014);
    expect(checkFVGFilled(fvg, fillingCandle)).toBe(true);

    const nonFillingCandle = makeCandle(t(60), 2012, 2014, 2011, 2013);
    expect(checkFVGFilled(fvg, nonFillingCandle)).toBe(false);
  });
});

describe('isPriceInFVG', () => {
  const fvg: FairValueGap = {
    id: '1',
    symbol: 'XAUUSD',
    timeframe: 'M15',
    type: 'BULLISH',
    high: 2010,
    low: 2005,
    gapTime: t(15),
    isFilled: false,
  };

  it('should return true when price is within the FVG', () => {
    expect(isPriceInFVG(2007, fvg)).toBe(true);
    expect(isPriceInFVG(2005, fvg)).toBe(true); // at low
    expect(isPriceInFVG(2010, fvg)).toBe(true); // at high
  });

  it('should return false when price is outside the FVG', () => {
    expect(isPriceInFVG(2004, fvg)).toBe(false);
    expect(isPriceInFVG(2011, fvg)).toBe(false);
  });
});

describe('checkFVGPartiallyFilled', () => {
  it('should detect 50% fill of bullish FVG', () => {
    const fvg: FairValueGap = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'M15',
      type: 'BULLISH',
      high: 2010,
      low: 2000,
      gapTime: t(15),
      isFilled: false,
    };

    // Gap = 10, 50% fill target = 2010 - 5 = 2005
    const filledCandle = makeCandle(t(60), 2008, 2009, 2004, 2006);
    expect(checkFVGPartiallyFilled(fvg, filledCandle, 0.5)).toBe(true);

    const notFilledCandle = makeCandle(t(60), 2008, 2009, 2006, 2007);
    expect(checkFVGPartiallyFilled(fvg, notFilledCandle, 0.5)).toBe(false);
  });

  it('should detect 50% fill of bearish FVG', () => {
    const fvg: FairValueGap = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'M15',
      type: 'BEARISH',
      high: 2010,
      low: 2000,
      gapTime: t(15),
      isFilled: false,
    };

    // Gap = 10, 50% fill target = 2000 + 5 = 2005
    const filledCandle = makeCandle(t(60), 2002, 2006, 2001, 2004);
    expect(checkFVGPartiallyFilled(fvg, filledCandle, 0.5)).toBe(true);
  });
});

describe('getNearestFVG', () => {
  const fvgs: FairValueGap[] = [
    {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'M15',
      type: 'BULLISH',
      high: 1990,
      low: 1985,
      gapTime: t(15),
      isFilled: false,
    },
    {
      id: '2',
      symbol: 'XAUUSD',
      timeframe: 'M15',
      type: 'BULLISH',
      high: 1995,
      low: 1992,
      gapTime: t(30),
      isFilled: false,
    },
  ];

  it('should find nearest bullish FVG below price', () => {
    const nearest = getNearestFVG(fvgs, 2000, 'BULLISH');
    expect(nearest).toBeDefined();
    expect(nearest!.id).toBe('2'); // 1995 is closest to 2000
  });

  it('should return undefined if no FVG below price', () => {
    const nearest = getNearestFVG(fvgs, 1980, 'BULLISH');
    expect(nearest).toBeUndefined();
  });
});

describe('getFVGMidpoint', () => {
  it('should calculate the midpoint of an FVG', () => {
    const fvg: FairValueGap = {
      id: '1',
      symbol: 'XAUUSD',
      timeframe: 'M15',
      type: 'BULLISH',
      high: 2010,
      low: 2000,
      gapTime: t(15),
      isFilled: false,
    };

    expect(getFVGMidpoint(fvg)).toBe(2005);
  });
});
