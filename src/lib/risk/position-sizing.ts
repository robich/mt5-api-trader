import { AccountInfo, SymbolInfo, Direction } from '../types';

/**
 * Position Sizing Calculator
 * Implements the 2% risk rule and calculates appropriate lot sizes
 */

/**
 * Calculate position size based on risk percentage
 */
export function calculatePositionSize(
  accountBalance: number,
  riskPercent: number,
  entryPrice: number,
  stopLoss: number,
  symbolInfo: SymbolInfo
): {
  lotSize: number;
  riskAmount: number;
  pipRisk: number;
  pipValue: number;
} {
  // Calculate risk amount in account currency
  const riskAmount = accountBalance * (riskPercent / 100);

  // Calculate distance to stop loss in price units
  const stopDistance = Math.abs(entryPrice - stopLoss);

  // Convert to pips
  const pipRisk = stopDistance / symbolInfo.pipSize;

  // Calculate pip value for 1 standard lot
  // For most forex pairs: pip value = pip size * contract size
  // For commodities like gold: pip value varies
  let pipValuePerLot = symbolInfo.tickValue;

  // Adjust for contract size
  if (symbolInfo.symbol.includes('XAU') || symbolInfo.symbol.includes('GOLD')) {
    // Gold: pip value = tick size * contract size (usually 100 oz)
    pipValuePerLot = symbolInfo.tickSize * symbolInfo.contractSize;
  } else if (symbolInfo.symbol.includes('XAG') || symbolInfo.symbol.includes('SILVER')) {
    // Silver: similar calculation
    pipValuePerLot = symbolInfo.tickSize * symbolInfo.contractSize;
  } else if (symbolInfo.symbol.includes('BTC')) {
    // Bitcoin: usually 1 contract = 1 BTC
    pipValuePerLot = symbolInfo.tickSize * symbolInfo.contractSize;
  }

  // Calculate lot size
  // Risk Amount = Lot Size × Pip Risk × Pip Value
  // Lot Size = Risk Amount / (Pip Risk × Pip Value)
  const rawLotSize = riskAmount / (pipRisk * pipValuePerLot);

  // Round to volume step
  const lotSize = Math.floor(rawLotSize / symbolInfo.volumeStep) * symbolInfo.volumeStep;

  // Clamp to min/max volume
  const clampedLotSize = Math.max(
    symbolInfo.minVolume,
    Math.min(lotSize, symbolInfo.maxVolume)
  );

  return {
    lotSize: Number(clampedLotSize.toFixed(2)),
    riskAmount,
    pipRisk,
    pipValue: pipValuePerLot,
  };
}

/**
 * Calculate risk-reward ratio
 */
export function calculateRiskReward(
  direction: Direction,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number
): number {
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);

  if (risk === 0) return 0;

  return reward / risk;
}

/**
 * Validate trade parameters
 */
export function validateTradeParams(
  direction: Direction,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  minRR: number = 1.5
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate stop loss position
  if (direction === 'BUY') {
    if (stopLoss >= entryPrice) {
      errors.push('Stop loss must be below entry price for BUY orders');
    }
    if (takeProfit <= entryPrice) {
      errors.push('Take profit must be above entry price for BUY orders');
    }
  } else {
    if (stopLoss <= entryPrice) {
      errors.push('Stop loss must be above entry price for SELL orders');
    }
    if (takeProfit >= entryPrice) {
      errors.push('Take profit must be below entry price for SELL orders');
    }
  }

  // Validate risk-reward
  const rr = calculateRiskReward(direction, entryPrice, stopLoss, takeProfit);
  if (rr < minRR) {
    errors.push(`Risk-reward ratio (${rr.toFixed(2)}) is below minimum (${minRR})`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Calculate potential profit/loss
 */
export function calculatePotentialPnL(
  lotSize: number,
  entryPrice: number,
  exitPrice: number,
  direction: Direction,
  symbolInfo: SymbolInfo
): {
  pnl: number;
  pips: number;
  percentage: number;
} {
  let priceDiff: number;

  if (direction === 'BUY') {
    priceDiff = exitPrice - entryPrice;
  } else {
    priceDiff = entryPrice - exitPrice;
  }

  const pips = priceDiff / symbolInfo.pipSize;

  // Calculate P&L
  let pnl: number;
  if (symbolInfo.symbol.includes('XAU') || symbolInfo.symbol.includes('GOLD')) {
    pnl = priceDiff * lotSize * symbolInfo.contractSize;
  } else if (symbolInfo.symbol.includes('XAG') || symbolInfo.symbol.includes('SILVER')) {
    pnl = priceDiff * lotSize * symbolInfo.contractSize;
  } else if (symbolInfo.symbol.includes('BTC')) {
    pnl = priceDiff * lotSize * symbolInfo.contractSize;
  } else {
    pnl = priceDiff * lotSize * symbolInfo.contractSize;
  }

  // Calculate percentage (based on entry value)
  const entryValue = entryPrice * lotSize * symbolInfo.contractSize;
  const percentage = entryValue !== 0 ? (pnl / entryValue) * 100 : 0;

  return {
    pnl: Number(pnl.toFixed(2)),
    pips: Number(pips.toFixed(1)),
    percentage: Number(percentage.toFixed(2)),
  };
}

/**
 * Get maximum lot size allowed by margin
 */
export function getMaxLotSizeByMargin(
  freeMargin: number,
  symbolInfo: SymbolInfo,
  entryPrice: number,
  leverage: number
): number {
  // Margin required per lot = (Contract Size × Price) / Leverage
  const marginPerLot = (symbolInfo.contractSize * entryPrice) / leverage;

  if (marginPerLot === 0) return symbolInfo.minVolume;

  const maxLots = freeMargin / marginPerLot;

  // Round down to volume step and clamp
  const rounded = Math.floor(maxLots / symbolInfo.volumeStep) * symbolInfo.volumeStep;

  return Math.max(
    symbolInfo.minVolume,
    Math.min(rounded, symbolInfo.maxVolume)
  );
}

/**
 * Calculate breakeven price after considering spread and commissions
 */
export function calculateBreakeven(
  entryPrice: number,
  direction: Direction,
  spread: number,
  commissionPerLot: number,
  lotSize: number,
  symbolInfo: SymbolInfo
): number {
  // Commission cost in price units
  const totalCommission = commissionPerLot * lotSize * 2; // Entry + Exit
  const commissionInPrice = totalCommission / (lotSize * symbolInfo.contractSize);

  if (direction === 'BUY') {
    // Need to move up by spread + commission
    return entryPrice + spread + commissionInPrice;
  } else {
    // Need to move down by spread + commission
    return entryPrice - spread - commissionInPrice;
  }
}

/**
 * Symbol-specific pip calculations
 */
export function getSymbolPipInfo(symbol: string): {
  pipSize: number;
  pipDigits: number;
} {
  const upperSymbol = symbol.toUpperCase();

  if (upperSymbol.includes('XAU') || upperSymbol.includes('GOLD')) {
    return { pipSize: 0.1, pipDigits: 1 };
  }

  if (upperSymbol.includes('XAG') || upperSymbol.includes('SILVER')) {
    return { pipSize: 0.01, pipDigits: 2 };
  }

  if (upperSymbol.includes('BTC')) {
    return { pipSize: 1, pipDigits: 0 };
  }

  if (upperSymbol.includes('JPY')) {
    return { pipSize: 0.01, pipDigits: 2 };
  }

  // Default for most forex pairs
  return { pipSize: 0.0001, pipDigits: 4 };
}
