import { describe, it, expect } from 'vitest';
import {
  isBullishCandle,
  isBearishCandle,
  getCandleBody,
  getCandleRange,
  getBodyRatio,
  hasCloseConfirmation,
  hasStrongConfirmation,
  hasEngulfingConfirmation,
  checkConfirmation,
  getLowerWick,
  getUpperWick,
  hasRejectionWick,
  hasLowScoreEntry,
  isConfirmationExpired,
  isStopLossHit,
  createPendingConfirmation,
} from '../confirmation';
import { Candle, Timeframe } from '../../types';

function makeCandle(
  open: number,
  high: number,
  low: number,
  close: number
): Candle {
  return {
    time: new Date(),
    open,
    high,
    low,
    close,
    volume: 100,
    symbol: 'XAUUSD',
    timeframe: 'M15' as Timeframe,
  };
}

describe('candle type detection', () => {
  it('should detect bullish candle', () => {
    expect(isBullishCandle(makeCandle(2000, 2010, 1998, 2008))).toBe(true);
    expect(isBullishCandle(makeCandle(2008, 2010, 1998, 2000))).toBe(false);
  });

  it('should detect bearish candle', () => {
    expect(isBearishCandle(makeCandle(2008, 2010, 1998, 2000))).toBe(true);
    expect(isBearishCandle(makeCandle(2000, 2010, 1998, 2008))).toBe(false);
  });

  it('should handle doji (open == close) as neither', () => {
    const doji = makeCandle(2000, 2005, 1995, 2000);
    expect(isBullishCandle(doji)).toBe(false);
    expect(isBearishCandle(doji)).toBe(false);
  });
});

describe('candle measurements', () => {
  it('should calculate body size', () => {
    expect(getCandleBody(makeCandle(2000, 2010, 1990, 2008))).toBe(8);
    expect(getCandleBody(makeCandle(2008, 2010, 1990, 2000))).toBe(8);
  });

  it('should calculate range', () => {
    expect(getCandleRange(makeCandle(2000, 2010, 1990, 2008))).toBe(20);
  });

  it('should calculate body ratio', () => {
    // body=8, range=20, ratio=0.4
    expect(getBodyRatio(makeCandle(2000, 2010, 1990, 2008))).toBeCloseTo(0.4, 2);
  });

  it('should return 0 body ratio for zero-range candle', () => {
    expect(getBodyRatio(makeCandle(2000, 2000, 2000, 2000))).toBe(0);
  });

  it('should calculate lower wick', () => {
    // Bullish: lower wick = min(open, close) - low = 2000 - 1990 = 10
    expect(getLowerWick(makeCandle(2000, 2010, 1990, 2008))).toBe(10);
    // Bearish: lower wick = min(open, close) - low = 2000 - 1990 = 10
    expect(getLowerWick(makeCandle(2008, 2010, 1990, 2000))).toBe(10);
  });

  it('should calculate upper wick', () => {
    // Bullish: upper wick = high - max(open, close) = 2010 - 2008 = 2
    expect(getUpperWick(makeCandle(2000, 2010, 1990, 2008))).toBe(2);
    // Bearish: upper wick = high - max(open, close) = 2010 - 2008 = 2
    expect(getUpperWick(makeCandle(2008, 2010, 1990, 2000))).toBe(2);
  });
});

describe('hasCloseConfirmation', () => {
  it('should confirm bullish candle with 30%+ body for BUY', () => {
    // body=8, range=20, ratio=0.4 > 0.3
    const candle = makeCandle(2000, 2010, 1990, 2008);
    expect(hasCloseConfirmation(candle, 'BUY')).toBe(true);
  });

  it('should reject bearish candle for BUY direction', () => {
    const candle = makeCandle(2008, 2010, 1990, 2000);
    expect(hasCloseConfirmation(candle, 'BUY')).toBe(false);
  });

  it('should confirm bearish candle with 30%+ body for SELL', () => {
    // body=8, range=20, ratio=0.4 > 0.3
    const candle = makeCandle(2008, 2010, 1990, 2000);
    expect(hasCloseConfirmation(candle, 'SELL')).toBe(true);
  });

  it('should reject candle with too small body', () => {
    // body=1, range=20, ratio=0.05 < 0.3
    const candle = makeCandle(2000, 2010, 1990, 2001);
    expect(hasCloseConfirmation(candle, 'BUY')).toBe(false);
  });
});

describe('hasStrongConfirmation', () => {
  it('should confirm candle with 50%+ body ratio', () => {
    // body=12, range=20, ratio=0.6 > 0.5
    const candle = makeCandle(1994, 2010, 1990, 2006);
    expect(hasStrongConfirmation(candle, 'BUY')).toBe(true);
  });

  it('should reject candle with body ratio below 50%', () => {
    // body=8, range=20, ratio=0.4 < 0.5
    const candle = makeCandle(2000, 2010, 1990, 2008);
    expect(hasStrongConfirmation(candle, 'BUY')).toBe(false);
  });
});

describe('hasEngulfingConfirmation', () => {
  it('should detect bullish engulfing', () => {
    const prev = makeCandle(2005, 2008, 1998, 2002); // bearish, body=3
    const curr = makeCandle(2001, 2012, 1997, 2010); // bullish, body=9, engulfs

    expect(hasEngulfingConfirmation(curr, prev, 'BUY')).toBe(true);
  });

  it('should detect bearish engulfing', () => {
    const prev = makeCandle(2002, 2008, 1998, 2005); // bullish, body=3
    const curr = makeCandle(2006, 2010, 1995, 2001); // bearish, body=5, engulfs

    expect(hasEngulfingConfirmation(curr, prev, 'SELL')).toBe(true);
  });

  it('should reject non-engulfing pattern', () => {
    const prev = makeCandle(2000, 2010, 1990, 2008); // big bullish body=8
    const curr = makeCandle(2007, 2010, 2002, 2003); // small bearish body=4

    expect(hasEngulfingConfirmation(curr, prev, 'SELL')).toBe(false);
  });
});

describe('checkConfirmation', () => {
  it('should always return true for "none" type', () => {
    const candle = makeCandle(2000, 2005, 1995, 2002);
    expect(checkConfirmation('none', candle, null, 'BUY')).toBe(true);
  });

  it('should delegate to hasCloseConfirmation for "close" type', () => {
    const bullish = makeCandle(2000, 2010, 1990, 2008);
    expect(checkConfirmation('close', bullish, null, 'BUY')).toBe(true);

    const bearish = makeCandle(2008, 2010, 1990, 2000);
    expect(checkConfirmation('close', bearish, null, 'BUY')).toBe(false);
  });

  it('should delegate to hasStrongConfirmation for "strong" type', () => {
    const strongBull = makeCandle(1994, 2010, 1990, 2006);
    expect(checkConfirmation('strong', strongBull, null, 'BUY')).toBe(true);
  });

  it('should delegate to hasEngulfingConfirmation for "engulf" type', () => {
    const prev = makeCandle(2005, 2008, 1998, 2002);
    const curr = makeCandle(2001, 2012, 1997, 2010);
    expect(checkConfirmation('engulf', curr, prev, 'BUY')).toBe(true);
  });

  it('should return false for "engulf" without prev candle', () => {
    const curr = makeCandle(2001, 2012, 1997, 2010);
    expect(checkConfirmation('engulf', curr, null, 'BUY')).toBe(false);
  });
});

describe('hasRejectionWick', () => {
  it('should detect lower wick rejection for BUY', () => {
    // Lower wick = 2000 - 1990 = 10, body = |2005 - 2004| = 1
    // wick (10) > body * 0.3 (0.3) ✓
    const candle = makeCandle(2004, 2006, 1990, 2005);
    expect(hasRejectionWick(candle, 'BUY')).toBe(true);
  });

  it('should detect upper wick rejection for SELL', () => {
    // Upper wick = 2010 - max(2005, 2006) = 4, body = 1
    // wick (4) > body * 0.3 (0.3) ✓
    const candle = makeCandle(2006, 2010, 2003, 2005);
    expect(hasRejectionWick(candle, 'SELL')).toBe(true);
  });
});

describe('hasLowScoreEntry', () => {
  it('should accept bullish candle for BUY', () => {
    expect(hasLowScoreEntry(makeCandle(2000, 2010, 1990, 2008), 'BUY')).toBe(true);
  });

  it('should accept rejection wick for BUY', () => {
    // Bearish candle but with lower wick rejection
    const candle = makeCandle(2004, 2006, 1990, 2003);
    expect(hasLowScoreEntry(candle, 'BUY')).toBe(true);
  });

  it('should accept bearish candle for SELL', () => {
    expect(hasLowScoreEntry(makeCandle(2008, 2010, 1990, 2000), 'SELL')).toBe(true);
  });
});

describe('pending confirmation utilities', () => {
  it('should create pending confirmation with expiry', () => {
    const pending = createPendingConfirmation(
      'sig-1',
      'XAUUSD',
      'BUY',
      'close',
      2000,
      1990
    );

    expect(pending.signalId).toBe('sig-1');
    expect(pending.symbol).toBe('XAUUSD');
    expect(pending.direction).toBe('BUY');
    expect(pending.expiresAt.getTime()).toBeGreaterThan(pending.createdAt.getTime());
  });

  it('should detect expired confirmation', () => {
    const pending = createPendingConfirmation(
      'sig-1',
      'XAUUSD',
      'BUY',
      'close',
      2000,
      1990
    );
    // Force expiry to the past
    pending.expiresAt = new Date(Date.now() - 1000);
    expect(isConfirmationExpired(pending)).toBe(true);
  });

  it('should detect non-expired confirmation', () => {
    const pending = createPendingConfirmation(
      'sig-1',
      'XAUUSD',
      'BUY',
      'close',
      2000,
      1990
    );
    expect(isConfirmationExpired(pending)).toBe(false);
  });

  it('should detect SL hit for BUY', () => {
    const pending = createPendingConfirmation(
      'sig-1',
      'XAUUSD',
      'BUY',
      'close',
      2000,
      1990
    );
    expect(isStopLossHit(pending, 1985)).toBe(true);
    expect(isStopLossHit(pending, 1995)).toBe(false);
  });

  it('should detect SL hit for SELL', () => {
    const pending = createPendingConfirmation(
      'sig-1',
      'XAUUSD',
      'SELL',
      'close',
      2000,
      2010
    );
    expect(isStopLossHit(pending, 2015)).toBe(true);
    expect(isStopLossHit(pending, 2005)).toBe(false);
  });
});
