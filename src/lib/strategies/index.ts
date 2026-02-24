import { BaseStrategy, type StrategyContext, type StrategySignal } from './base';
import { OrderBlockStrategy, orderBlockStrategy } from './order-block';
import { LiquiditySweepStrategy, liquiditySweepStrategy } from './liquidity-sweep';
import { BOSStrategy, bosStrategy } from './bos';
import { FBOClassicStrategy, fboClassicStrategy } from './fbo-classic';
import { FBOSweepStrategy, fboSweepStrategy } from './fbo-sweep';
import { FBOStructureStrategy, fboStructureStrategy } from './fbo-structure';
import { M1TrendStrategy, m1TrendStrategy } from './m1-trend';
import { JudasSwingStrategy, judasSwingStrategy } from './judas-swing';
import { FVGEntryStrategy, fvgEntryStrategy } from './fvg-entry';
import { BreakerBlockStrategy, breakerBlockStrategy } from './breaker-block';
import { PDHPDLSweepStrategy, pdhPdlSweepStrategy } from './pdh-pdl-sweep';
import { StrategyType, Signal } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { buildSignal } from './base';

export { BaseStrategy } from './base';
export type { StrategyContext, StrategySignal } from './base';
export { OrderBlockStrategy, orderBlockStrategy } from './order-block';
export { LiquiditySweepStrategy, liquiditySweepStrategy } from './liquidity-sweep';
export { BOSStrategy, bosStrategy } from './bos';
export { FBOClassicStrategy, fboClassicStrategy } from './fbo-classic';
export { FBOSweepStrategy, fboSweepStrategy } from './fbo-sweep';
export { FBOStructureStrategy, fboStructureStrategy } from './fbo-structure';
export { M1TrendStrategy, m1TrendStrategy } from './m1-trend';
export { JudasSwingStrategy, judasSwingStrategy } from './judas-swing';
export { FVGEntryStrategy, fvgEntryStrategy } from './fvg-entry';
export { BreakerBlockStrategy, breakerBlockStrategy } from './breaker-block';
export { PDHPDLSweepStrategy, pdhPdlSweepStrategy } from './pdh-pdl-sweep';

// Strategy profiles - backtest-optimized configurations (Jan 2026 optimization)
export {
  STRATEGY_PROFILES,
  SYMBOL_RECOMMENDED_PROFILES,
  SYMBOL_DEFAULTS,
  SYMBOL_TIMEFRAMES,
  DEFAULT_LIVE_CONFIG,
  getSymbolConfig,
  getSymbolTimeframes,
  getOptimalProfileForSymbol,
  getProfilesByTier,
  getRecommendedProfile,
  validateProfile,
} from './strategy-profiles';
export type {
  StrategyProfile,
  LiveStrategyConfig,
  SymbolOverrides,
  ConfirmationType,
  RiskTier,
  SymbolTimeframeConfig,
} from './strategy-profiles';

// Strategy registry
export const strategies = new Map<StrategyType, BaseStrategy>([
  ['ORDER_BLOCK', orderBlockStrategy],
  ['LIQUIDITY_SWEEP', liquiditySweepStrategy],
  ['BOS', bosStrategy],
  ['FBO_CLASSIC', fboClassicStrategy],
  ['FBO_SWEEP', fboSweepStrategy],
  ['FBO_STRUCTURE', fboStructureStrategy],
  ['M1_TREND', m1TrendStrategy],
  ['JUDAS_SWING', judasSwingStrategy],
  ['FVG_ENTRY', fvgEntryStrategy],
  ['BREAKER_BLOCK', breakerBlockStrategy],
  ['PDH_PDL_SWEEP', pdhPdlSweepStrategy],
]);

/**
 * Get strategy by name
 */
export function getStrategy(name: StrategyType): BaseStrategy | undefined {
  return strategies.get(name);
}

/**
 * Run all strategies and return the best signal
 */
export function runAllStrategies(
  context: StrategyContext,
  enabledStrategies: StrategyType[] = ['ORDER_BLOCK', 'LIQUIDITY_SWEEP', 'BOS']
): Signal | null {
  let bestSignal: { signal: StrategySignal; strategy: StrategyType } | null = null;

  for (const strategyName of enabledStrategies) {
    const strategy = strategies.get(strategyName);
    if (!strategy) continue;

    try {
      const signal = strategy.analyze(context);

      if (signal) {
        // Keep track of the signal with highest confidence
        if (!bestSignal || signal.confidence > bestSignal.signal.confidence) {
          bestSignal = { signal, strategy: strategyName };
        }
      }
    } catch (error) {
      console.error(`Error running strategy ${strategyName}:`, error);
    }
  }

  if (!bestSignal) {
    return null;
  }

  // Build full signal object
  return buildSignal(
    uuidv4(),
    context.symbol,
    bestSignal.strategy,
    bestSignal.signal,
    context.analysis.ltf.timeframe,
    context.analysis.htf.bias,
    context.analysis.mtf.structure.lastStructure
  );
}

/**
 * Run specific strategy
 */
export function runStrategy(
  strategyName: StrategyType,
  context: StrategyContext
): Signal | null {
  const strategy = strategies.get(strategyName);
  if (!strategy) {
    throw new Error(`Unknown strategy: ${strategyName}`);
  }

  const signal = strategy.analyze(context);
  if (!signal) {
    return null;
  }

  return buildSignal(
    uuidv4(),
    context.symbol,
    strategyName,
    signal,
    context.analysis.ltf.timeframe,
    context.analysis.htf.bias,
    context.analysis.mtf.structure.lastStructure
  );
}

/**
 * Get all signals from all strategies (not just the best)
 */
export function getAllSignals(
  context: StrategyContext,
  enabledStrategies: StrategyType[] = ['ORDER_BLOCK', 'LIQUIDITY_SWEEP', 'BOS']
): Signal[] {
  const signals: Signal[] = [];

  for (const strategyName of enabledStrategies) {
    const strategy = strategies.get(strategyName);
    if (!strategy) continue;

    try {
      const signal = strategy.analyze(context);

      if (signal) {
        signals.push(
          buildSignal(
            uuidv4(),
            context.symbol,
            strategyName,
            signal,
            context.analysis.ltf.timeframe,
            context.analysis.htf.bias,
            context.analysis.mtf.structure.lastStructure
          )
        );
      }
    } catch (error) {
      console.error(`Error running strategy ${strategyName}:`, error);
    }
  }

  // Sort by confidence
  return signals.sort((a, b) => b.confidence - a.confidence);
}
