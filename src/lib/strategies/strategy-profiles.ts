/**
 * Strategy Profiles - Production-ready configurations from backtest optimization
 *
 * Based on .claude/backtest-insights.md results from Nov 13, 2025 - Jan 13, 2026
 *
 * Best performing strategies:
 * - BTCUSD: 81-82% win rate, PF 3.50-3.60
 * - XAUUSD.s: 73-75% win rate, PF 2.60-3.60
 * - XAGUSD.s: 76-77% win rate, PF 2.70
 */

import { StrategyType, Timeframe, KillZoneType } from '../types';

/**
 * Confirmation candle types for Order Block entries
 *
 * - 'none': Enter immediately when OB is touched (highest frequency)
 * - 'close': Wait for candle to close in trade direction (30%+ body)
 * - 'strong': Wait for strong candle (50%+ body of range)
 * - 'engulf': Wait for engulfing pattern (best for BTCUSD)
 */
export type ConfirmationType = 'none' | 'close' | 'strong' | 'engulf';

/**
 * Strategy profile risk tier
 */
export type RiskTier = 'aggressive' | 'balanced' | 'conservative';

/**
 * Strategy profile configuration
 */
export interface StrategyProfile {
  /** Profile name for display */
  name: string;
  /** Short description */
  description: string;
  /** Risk tier classification */
  riskTier: RiskTier;
  /** Primary strategy to use */
  strategy: StrategyType;
  /** Minimum Order Block score (0-100) */
  minOBScore: number;
  /** Whether to use kill zones filter */
  useKillZones: boolean;
  /** Which kill zones to trade in (if useKillZones is true) */
  killZones: KillZoneType[];
  /** Maximum daily drawdown percentage before stopping trades */
  maxDailyDrawdown: number;
  /** Confirmation candle type */
  confirmationType: ConfirmationType;
  /** Fixed risk:reward ratio */
  riskReward: number;
  /** Risk percentage per trade */
  riskPercent: number;
  /** ATR multiplier for OB detection */
  atrMultiplier: number;
  /** Maximum concurrent trades */
  maxConcurrentTrades: number;
  /** Recommended symbols for this profile */
  recommendedSymbols: string[];
}

/**
 * Symbol-specific overrides for strategy profiles
 */
export interface SymbolOverrides {
  /** Override risk percent for this symbol */
  riskPercent?: number;
  /** Override max daily drawdown for this symbol */
  maxDailyDrawdown?: number;
  /** Override confirmation type for this symbol */
  confirmationType?: ConfirmationType;
  /** Override min OB score for this symbol */
  minOBScore?: number;
}

/**
 * Live trading configuration combining profile + symbol settings
 */
export interface LiveStrategyConfig {
  /** Selected strategy profile */
  profile: StrategyProfile;
  /** Symbols to trade with optional overrides */
  symbols: {
    symbol: string;
    enabled: boolean;
    overrides?: SymbolOverrides;
  }[];
  /** Whether live trading is enabled (false = paper mode) */
  liveTrading: boolean;
  /** HTF timeframe for bias */
  htfTimeframe: Timeframe;
  /** MTF timeframe for OB detection */
  mtfTimeframe: Timeframe;
  /** LTF timeframe for entry */
  ltfTimeframe: Timeframe;
}

/**
 * Pre-defined strategy profiles based on backtest results
 */
export const STRATEGY_PROFILES: Record<string, StrategyProfile> = {
  // === AGGRESSIVE STRATEGIES ===
  'AGGRESSIVE_ENGULF': {
    name: 'Aggressive Engulfing',
    description: 'OB70|All|DD8%|Engulf - High profit, moderate risk',
    riskTier: 'aggressive',
    strategy: 'ORDER_BLOCK',
    minOBScore: 70,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'engulf',
    riskReward: 2,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['BTCUSD', 'XAUUSD.s'],
  },
  'AGGRESSIVE_NOCONF': {
    name: 'Aggressive No Confirmation',
    description: 'OB70|All|DD8%|NoConf - Fastest entries',
    riskTier: 'aggressive',
    strategy: 'ORDER_BLOCK',
    minOBScore: 70,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 2,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['BTCUSD'],
  },

  // === BALANCED STRATEGIES ===
  'BALANCED_STRONG': {
    name: 'Balanced Strong',
    description: 'OB70|KZ|DD6%|Strong - Good profit with controlled risk',
    riskTier: 'balanced',
    strategy: 'ORDER_BLOCK',
    minOBScore: 70,
    useKillZones: true,
    killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
    maxDailyDrawdown: 6,
    confirmationType: 'strong',
    riskReward: 2,
    riskPercent: 1.5,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 2,
    recommendedSymbols: ['XAUUSD.s', 'XAGUSD.s'],
  },
  'BALANCED_CLOSE': {
    name: 'Balanced Close',
    description: 'OB65|KZ|DD6%|Close - Relaxed OB score, simple confirmation',
    riskTier: 'balanced',
    strategy: 'ORDER_BLOCK',
    minOBScore: 65,
    useKillZones: true,
    killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
    maxDailyDrawdown: 6,
    confirmationType: 'close',
    riskReward: 2,
    riskPercent: 1.5,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 2,
    recommendedSymbols: ['XAUUSD.s', 'BTCUSD'],
  },

  // === CONSERVATIVE STRATEGIES (Prop Firm) ===
  'CONSERVATIVE_STRONG': {
    name: 'Conservative Strong',
    description: 'OB70|KZ|DD5%|Strong - Lower DD, steady gains',
    riskTier: 'conservative',
    strategy: 'ORDER_BLOCK',
    minOBScore: 70,
    useKillZones: true,
    killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
    maxDailyDrawdown: 5,
    confirmationType: 'strong',
    riskReward: 2,
    riskPercent: 1,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 1,
    recommendedSymbols: ['XAUUSD.s', 'XAGUSD.s'],
  },
  'CONSERVATIVE_ENGULF': {
    name: 'Conservative Engulfing',
    description: 'OB75|KZ|DD5%|Engulf - Highest quality setups only',
    riskTier: 'conservative',
    strategy: 'ORDER_BLOCK',
    minOBScore: 75,
    useKillZones: true,
    killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
    maxDailyDrawdown: 5,
    confirmationType: 'engulf',
    riskReward: 2,
    riskPercent: 1,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 1,
    recommendedSymbols: ['BTCUSD', 'XAUUSD.s'],
  },

  // === EXTENDED RR STRATEGIES ===
  'BALANCED_25RR': {
    name: 'Balanced 2.5:1 RR',
    description: 'OB70|KZ|DD6%|2.5:1|Strong - Extended profit target',
    riskTier: 'balanced',
    strategy: 'ORDER_BLOCK',
    minOBScore: 70,
    useKillZones: true,
    killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
    maxDailyDrawdown: 6,
    confirmationType: 'strong',
    riskReward: 2.5,
    riskPercent: 1.5,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 2,
    recommendedSymbols: ['XAUUSD.s'],
  },
  'AGGRESSIVE_3RR': {
    name: 'Aggressive 3:1 RR',
    description: 'OB65|KZ|DD8%|3:1|Engulf - Large profit targets',
    riskTier: 'aggressive',
    strategy: 'ORDER_BLOCK',
    minOBScore: 65,
    useKillZones: true,
    killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
    maxDailyDrawdown: 8,
    confirmationType: 'engulf',
    riskReward: 3,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 2,
    recommendedSymbols: ['BTCUSD'],
  },
};

/**
 * Symbol-specific recommended profiles based on backtest performance
 */
export const SYMBOL_RECOMMENDED_PROFILES: Record<string, string[]> = {
  'BTCUSD': ['AGGRESSIVE_ENGULF', 'AGGRESSIVE_NOCONF', 'AGGRESSIVE_3RR'],
  'XAUUSD.s': ['BALANCED_STRONG', 'AGGRESSIVE_ENGULF', 'BALANCED_25RR'],
  'XAGUSD.s': ['BALANCED_STRONG', 'CONSERVATIVE_STRONG', 'BALANCED_CLOSE'],
};

/**
 * Default configurations per symbol based on backtest insights
 */
export const SYMBOL_DEFAULTS: Record<string, SymbolOverrides> = {
  'BTCUSD': {
    // BTCUSD performs best with engulfing confirmation
    confirmationType: 'engulf',
    minOBScore: 70,
    maxDailyDrawdown: 8,
  },
  'XAUUSD.s': {
    // XAUUSD works well with strong confirmation or engulfing
    confirmationType: 'strong',
    minOBScore: 70,
    maxDailyDrawdown: 6,
  },
  'XAGUSD.s': {
    // Silver has lower trade volume, use strong confirmation
    confirmationType: 'strong',
    minOBScore: 70,
    maxDailyDrawdown: 6,
  },
};

/**
 * Default live strategy configuration
 *
 * IMPORTANT: liveTrading is FALSE by default - must be explicitly enabled
 */
export const DEFAULT_LIVE_CONFIG: LiveStrategyConfig = {
  profile: STRATEGY_PROFILES['BALANCED_STRONG'],
  symbols: [
    { symbol: 'XAUUSD.s', enabled: true, overrides: SYMBOL_DEFAULTS['XAUUSD.s'] },
    { symbol: 'BTCUSD', enabled: true, overrides: SYMBOL_DEFAULTS['BTCUSD'] },
    { symbol: 'XAGUSD.s', enabled: true, overrides: SYMBOL_DEFAULTS['XAGUSD.s'] },
  ],
  liveTrading: false, // Paper mode by default
  htfTimeframe: 'H4',
  mtfTimeframe: 'H1',
  ltfTimeframe: 'M15',
};

/**
 * Get effective configuration for a symbol by merging profile with overrides
 */
export function getSymbolConfig(
  config: LiveStrategyConfig,
  symbol: string
): {
  enabled: boolean;
  minOBScore: number;
  confirmationType: ConfirmationType;
  maxDailyDrawdown: number;
  riskPercent: number;
  riskReward: number;
  useKillZones: boolean;
  killZones: KillZoneType[];
} {
  const symbolConfig = config.symbols.find(s => s.symbol === symbol);
  const profile = config.profile;
  const overrides = symbolConfig?.overrides || {};

  return {
    enabled: symbolConfig?.enabled ?? false,
    minOBScore: overrides.minOBScore ?? profile.minOBScore,
    confirmationType: overrides.confirmationType ?? profile.confirmationType,
    maxDailyDrawdown: overrides.maxDailyDrawdown ?? profile.maxDailyDrawdown,
    riskPercent: overrides.riskPercent ?? profile.riskPercent,
    riskReward: profile.riskReward,
    useKillZones: profile.useKillZones,
    killZones: profile.killZones,
  };
}

/**
 * Validate a strategy profile configuration
 */
export function validateProfile(profile: StrategyProfile): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (profile.minOBScore < 50 || profile.minOBScore > 100) {
    errors.push('minOBScore must be between 50 and 100');
  }

  if (profile.maxDailyDrawdown < 1 || profile.maxDailyDrawdown > 20) {
    errors.push('maxDailyDrawdown must be between 1% and 20%');
  }

  if (profile.riskReward < 1 || profile.riskReward > 5) {
    errors.push('riskReward must be between 1 and 5');
  }

  if (profile.riskPercent < 0.1 || profile.riskPercent > 5) {
    errors.push('riskPercent must be between 0.1% and 5%');
  }

  if (profile.maxConcurrentTrades < 1 || profile.maxConcurrentTrades > 10) {
    errors.push('maxConcurrentTrades must be between 1 and 10');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get profile by risk tier
 */
export function getProfilesByTier(tier: RiskTier): StrategyProfile[] {
  return Object.values(STRATEGY_PROFILES).filter(p => p.riskTier === tier);
}

/**
 * Get recommended profile for a symbol
 */
export function getRecommendedProfile(symbol: string): StrategyProfile {
  const recommended = SYMBOL_RECOMMENDED_PROFILES[symbol];
  if (recommended && recommended.length > 0) {
    return STRATEGY_PROFILES[recommended[0]];
  }
  return STRATEGY_PROFILES['BALANCED_STRONG'];
}
