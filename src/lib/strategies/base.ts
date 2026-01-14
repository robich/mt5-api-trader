import {
  Candle,
  Signal,
  StrategyType,
  Direction,
  Timeframe,
  Bias,
  MultiTimeframeAnalysis,
} from '../types';

/**
 * Base Strategy Interface for all SMC strategies
 */
export interface StrategySignal {
  direction: Direction;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reason: string;
}

export interface StrategyContext {
  symbol: string;
  currentPrice: number;
  bid: number;
  ask: number;
  analysis: MultiTimeframeAnalysis;
  htfCandles: Candle[];
  mtfCandles: Candle[];
  ltfCandles: Candle[];
}

export abstract class BaseStrategy {
  abstract readonly name: StrategyType;
  abstract readonly description: string;

  /**
   * Analyze market conditions and generate potential signal
   */
  abstract analyze(context: StrategyContext): StrategySignal | null;

  /**
   * Validates if the signal meets quality criteria
   */
  protected validateSignal(
    signal: StrategySignal,
    minRR: number = 1.5,
    minConfidence: number = 0.6
  ): boolean {
    // Check minimum risk-reward ratio
    const rr = this.calculateRiskReward(
      signal.direction,
      signal.entryPrice,
      signal.stopLoss,
      signal.takeProfit
    );

    if (rr < minRR) {
      return false;
    }

    // Check minimum confidence
    if (signal.confidence < minConfidence) {
      return false;
    }

    // Validate stop loss makes sense
    if (signal.direction === 'BUY') {
      if (signal.stopLoss >= signal.entryPrice) {
        return false;
      }
      if (signal.takeProfit <= signal.entryPrice) {
        return false;
      }
    } else {
      if (signal.stopLoss <= signal.entryPrice) {
        return false;
      }
      if (signal.takeProfit >= signal.entryPrice) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculate risk-reward ratio
   */
  protected calculateRiskReward(
    direction: Direction,
    entry: number,
    stopLoss: number,
    takeProfit: number
  ): number {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);

    if (risk === 0) return 0;

    return reward / risk;
  }

  /**
   * Get spread-adjusted entry price
   */
  protected getEntryPrice(direction: Direction, bid: number, ask: number): number {
    return direction === 'BUY' ? ask : bid;
  }

  /**
   * Add buffer to stop loss for safety
   */
  protected addStopLossBuffer(
    stopLoss: number,
    direction: Direction,
    bufferPips: number,
    pipSize: number
  ): number {
    const buffer = bufferPips * pipSize;

    if (direction === 'BUY') {
      return stopLoss - buffer;
    } else {
      return stopLoss + buffer;
    }
  }
}

/**
 * Signal builder helper
 */
export function buildSignal(
  id: string,
  symbol: string,
  strategy: StrategyType,
  signal: StrategySignal,
  timeframe: Timeframe,
  htfBias: Bias,
  mtfStructure: string
): Signal {
  return {
    id,
    symbol,
    direction: signal.direction,
    strategy,
    timeframe,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
    confidence: signal.confidence,
    status: 'PENDING',
    reason: signal.reason,
    htfBias,
    mtfStructure,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours expiry
  };
}
