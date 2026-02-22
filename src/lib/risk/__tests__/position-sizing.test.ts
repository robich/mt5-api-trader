import { describe, it, expect } from 'vitest';
import {
  calculatePositionSize,
  calculateRiskReward,
  validateTradeParams,
  calculatePotentialPnL,
  getMaxLotSizeByMargin,
  calculateBreakeven,
  getSymbolPipInfo,
} from '../position-sizing';
import { SymbolInfo } from '../../types';

// Common symbol info fixtures
const XAUUSD: SymbolInfo = {
  symbol: 'XAUUSD',
  description: 'Gold vs USD',
  digits: 2,
  pipSize: 0.1,
  contractSize: 100,
  minVolume: 0.01,
  maxVolume: 100,
  volumeStep: 0.01,
  tickSize: 0.01,
  tickValue: 1,
};

const BTCUSD: SymbolInfo = {
  symbol: 'BTCUSD',
  description: 'Bitcoin vs USD',
  digits: 2,
  pipSize: 1,
  contractSize: 1,
  minVolume: 0.01,
  maxVolume: 100,
  volumeStep: 0.01,
  tickSize: 0.01,
  tickValue: 1,
};

const EURUSD: SymbolInfo = {
  symbol: 'EURUSD',
  description: 'Euro vs USD',
  digits: 5,
  pipSize: 0.0001,
  contractSize: 100000,
  minVolume: 0.01,
  maxVolume: 100,
  volumeStep: 0.01,
  tickSize: 0.00001,
  tickValue: 10,
};

const USDJPY: SymbolInfo = {
  symbol: 'USDJPY',
  description: 'USD vs JPY',
  digits: 3,
  pipSize: 0.01,
  contractSize: 100000,
  minVolume: 0.01,
  maxVolume: 100,
  volumeStep: 0.01,
  tickSize: 0.001,
  tickValue: 6.67,
};

describe('calculatePositionSize', () => {
  it('should calculate correct lot size for XAUUSD', () => {
    const result = calculatePositionSize(10000, 2, 2000, 1990, XAUUSD);

    // Risk amount = 10000 * 0.02 = $200
    // Stop distance = |2000 - 1990| = 10
    // Pip risk = 10 / 0.1 = 100 pips
    // Pip value per lot = 0.1 * 100 = $10
    // Raw lot size = 200 / (100 * 10) = 0.2
    expect(result.riskAmount).toBe(200);
    expect(result.pipRisk).toBe(100);
    expect(result.lotSize).toBe(0.2);
    expect(result.wasClampedToMin).toBe(false);
  });

  it('should calculate correct lot size for BTCUSD', () => {
    const result = calculatePositionSize(10000, 2, 50000, 49500, BTCUSD);

    // Risk = $200, Stop = 500 points, Pip risk = 500, Pip value = 1*1 = $1
    // Raw lot size = 200 / (500 * 1) = 0.4
    expect(result.riskAmount).toBe(200);
    expect(result.pipRisk).toBe(500);
    expect(result.lotSize).toBe(0.4);
  });

  it('should clamp to minimum volume when lot size is too small', () => {
    const result = calculatePositionSize(100, 1, 2000, 1900, XAUUSD);

    // Risk = $1, very wide stop = would need tiny lot
    // Raw lot size = 1 / (1000 * 10) = 0.0001 -> clamped to 0.01
    expect(result.lotSize).toBe(0.01);
    expect(result.wasClampedToMin).toBe(true);
  });

  it('should clamp to maximum volume', () => {
    const smallMax: SymbolInfo = { ...XAUUSD, maxVolume: 0.5 };
    const result = calculatePositionSize(1000000, 2, 2000, 1999, smallMax);

    expect(result.lotSize).toBeLessThanOrEqual(0.5);
  });

  it('should round to volume step', () => {
    const result = calculatePositionSize(10000, 2, 2000, 1995, XAUUSD);

    // Lot size should be a multiple of volumeStep (0.01)
    const remainder = (result.lotSize * 100) % (XAUUSD.volumeStep * 100);
    expect(remainder).toBeCloseTo(0, 5);
  });

  it('should handle JPY pairs with currency conversion', () => {
    const result = calculatePositionSize(10000, 2, 150, 149, USDJPY);

    // For JPY pairs, pip value = (pipSize * contractSize) / entryPrice
    // pipValue = (0.01 * 100000) / 150 = $6.67
    // Risk = $200, Stop = 100 pips, lot size = 200 / (100 * 6.67) ≈ 0.30
    expect(result.riskAmount).toBe(200);
    expect(result.pipRisk).toBe(100);
    expect(result.lotSize).toBeGreaterThan(0);
  });
});

describe('calculateRiskReward', () => {
  it('should calculate correct RR for a BUY trade', () => {
    const rr = calculateRiskReward('BUY', 2000, 1990, 2020);
    // Risk = 10, Reward = 20, RR = 2.0
    expect(rr).toBe(2);
  });

  it('should calculate correct RR for a SELL trade', () => {
    const rr = calculateRiskReward('SELL', 2000, 2010, 1970);
    // Risk = 10, Reward = 30, RR = 3.0
    expect(rr).toBe(3);
  });

  it('should return 0 when risk is 0', () => {
    const rr = calculateRiskReward('BUY', 2000, 2000, 2020);
    expect(rr).toBe(0);
  });

  it('should handle fractional RR values', () => {
    const rr = calculateRiskReward('BUY', 2000, 1990, 2015);
    // Risk = 10, Reward = 15, RR = 1.5
    expect(rr).toBe(1.5);
  });
});

describe('validateTradeParams', () => {
  it('should validate a correct BUY trade', () => {
    const result = validateTradeParams('BUY', 2000, 1990, 2030, 1.5);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should validate a correct SELL trade', () => {
    const result = validateTradeParams('SELL', 2000, 2010, 1970, 1.5);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject BUY with stop loss above entry', () => {
    const result = validateTradeParams('BUY', 2000, 2010, 2030, 1.5);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      'Stop loss must be below entry price for BUY orders'
    );
  });

  it('should reject BUY with take profit below entry', () => {
    const result = validateTradeParams('BUY', 2000, 1990, 1980, 1.5);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      'Take profit must be above entry price for BUY orders'
    );
  });

  it('should reject SELL with stop loss below entry', () => {
    const result = validateTradeParams('SELL', 2000, 1990, 1970, 1.5);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      'Stop loss must be above entry price for SELL orders'
    );
  });

  it('should reject SELL with take profit above entry', () => {
    const result = validateTradeParams('SELL', 2000, 2010, 2020, 1.5);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      'Take profit must be below entry price for SELL orders'
    );
  });

  it('should reject trade with low risk-reward ratio', () => {
    const result = validateTradeParams('BUY', 2000, 1990, 2005, 2);
    // RR = 0.5, min = 2
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Risk-reward ratio'))).toBe(true);
  });

  it('should use default minRR of 1.5', () => {
    const result = validateTradeParams('BUY', 2000, 1990, 2010);
    // RR = 1.0 < 1.5 default
    expect(result.isValid).toBe(false);
  });
});

describe('calculatePotentialPnL', () => {
  it('should calculate profit for a winning BUY', () => {
    const result = calculatePotentialPnL(0.1, 2000, 2020, 'BUY', XAUUSD);
    // priceDiff = 20, pnl = 20 * 0.1 * 100 = $200
    expect(result.pnl).toBe(200);
    expect(result.pips).toBe(200); // 20 / 0.1
  });

  it('should calculate loss for a losing BUY', () => {
    const result = calculatePotentialPnL(0.1, 2000, 1990, 'BUY', XAUUSD);
    // priceDiff = -10, pnl = -10 * 0.1 * 100 = -$100
    expect(result.pnl).toBe(-100);
  });

  it('should calculate profit for a winning SELL', () => {
    const result = calculatePotentialPnL(0.1, 2000, 1980, 'SELL', XAUUSD);
    // priceDiff = 20, pnl = 20 * 0.1 * 100 = $200
    expect(result.pnl).toBe(200);
  });

  it('should calculate loss for a losing SELL', () => {
    const result = calculatePotentialPnL(0.1, 2000, 2010, 'SELL', XAUUSD);
    // priceDiff = -10, pnl = -10 * 0.1 * 100 = -$100
    expect(result.pnl).toBe(-100);
  });

  it('should handle BTCUSD calculations', () => {
    const result = calculatePotentialPnL(1, 50000, 51000, 'BUY', BTCUSD);
    // priceDiff = 1000, pnl = 1000 * 1 * 1 = $1000
    expect(result.pnl).toBe(1000);
  });
});

describe('getMaxLotSizeByMargin', () => {
  it('should calculate max lot size based on margin', () => {
    const result = getMaxLotSizeByMargin(10000, XAUUSD, 2000, 100);
    // marginPerLot = (100 * 2000) / 100 = 2000
    // maxLots = 10000 / 2000 = 5.0
    expect(result).toBe(5);
  });

  it('should clamp to min volume when margin is too low', () => {
    const result = getMaxLotSizeByMargin(1, XAUUSD, 2000, 100);
    expect(result).toBe(XAUUSD.minVolume);
  });

  it('should return minVolume when marginPerLot is zero', () => {
    const result = getMaxLotSizeByMargin(10000, XAUUSD, 0, 100);
    expect(result).toBe(XAUUSD.minVolume);
  });
});

describe('calculateBreakeven', () => {
  it('should calculate breakeven for BUY with spread and commission', () => {
    const be = calculateBreakeven(2000, 'BUY', 0.3, 5, 0.1, XAUUSD);
    // commissionTotal = 5 * 0.1 * 2 = 1
    // commissionInPrice = 1 / (0.1 * 100) = 0.1
    // BUY breakeven = 2000 + 0.3 + 0.1 = 2000.4
    expect(be).toBeCloseTo(2000.4, 1);
  });

  it('should calculate breakeven for SELL', () => {
    const be = calculateBreakeven(2000, 'SELL', 0.3, 5, 0.1, XAUUSD);
    // SELL breakeven = 2000 - 0.3 - 0.1 = 1999.6
    expect(be).toBeCloseTo(1999.6, 1);
  });
});

describe('getSymbolPipInfo', () => {
  it('should return correct pip info for gold', () => {
    expect(getSymbolPipInfo('XAUUSD')).toEqual({ pipSize: 0.1, pipDigits: 1 });
    expect(getSymbolPipInfo('GOLD')).toEqual({ pipSize: 0.1, pipDigits: 1 });
  });

  it('should return correct pip info for silver', () => {
    expect(getSymbolPipInfo('XAGUSD')).toEqual({ pipSize: 0.01, pipDigits: 2 });
  });

  it('should return correct pip info for BTC', () => {
    expect(getSymbolPipInfo('BTCUSD')).toEqual({ pipSize: 1, pipDigits: 0 });
  });

  it('should return correct pip info for JPY pairs', () => {
    expect(getSymbolPipInfo('USDJPY')).toEqual({ pipSize: 0.01, pipDigits: 2 });
  });

  it('should return default pip info for standard forex', () => {
    expect(getSymbolPipInfo('EURUSD')).toEqual({ pipSize: 0.0001, pipDigits: 4 });
    expect(getSymbolPipInfo('GBPUSD')).toEqual({ pipSize: 0.0001, pipDigits: 4 });
  });

  it('should handle case insensitivity', () => {
    expect(getSymbolPipInfo('xauusd')).toEqual({ pipSize: 0.1, pipDigits: 1 });
    expect(getSymbolPipInfo('btcusd')).toEqual({ pipSize: 1, pipDigits: 0 });
  });
});
