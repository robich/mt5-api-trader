/**
 * Strategy Profiles - Production-ready configurations from backtest optimization
 *
 * Based on .claude/backtest-insights.md results from Dec 15, 2025 - Jan 14, 2026
 * Updated Jan 2026 with iterative optimization findings:
 *
 * KEY FINDINGS:
 * 1. NoConf (no confirmation) strategies significantly outperform confirmation-based
 * 2. ATR multiplier is symbol-specific:
 *    - BTCUSD: ATR 0.8 (more sensitive)
 *    - XAUUSD: ATR 1.5 (stricter filtering)
 *    - XAGUSD: ATR 1.0-1.2 (standard)
 * 3. R:R 1.5-2.0 is optimal (higher R:R reduces win rate too much)
 * 4. Timeframe matters:
 *    - BTCUSD: M5 entries (H4/M30/M5)
 *    - Metals: M1 scalp entries (H1/M15/M1)
 *
 * Best performing strategies:
 * - BTCUSD: 68.8% win rate, PF 2.62 (ATR0.8|RR1.5)
 * - XAUUSD.s: 75.4% win rate, PF 3.07 (ATR1.5|RR2)
 * - XAGUSD.s: 66.1% win rate, PF 1.94 (OB65|RR2)
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
 * Pre-defined strategy profiles based on backtest results (Jan 2026 optimization)
 */
export const STRATEGY_PROFILES: Record<string, StrategyProfile> = {
  // === OPTIMAL SYMBOL-SPECIFIC STRATEGIES (from backtesting) ===

  // BTCUSD Optimal: ATR0.8 with RR1.5 - 68.8% win rate, PF 2.62
  'BTC_OPTIMAL': {
    name: 'BTC Optimal',
    description: 'ATR0.8|RR1.5|NoConf - Optimized for BTCUSD (68.8% WR, 2.62 PF)',
    riskTier: 'aggressive',
    strategy: 'ORDER_BLOCK',
    minOBScore: 70,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 1.5,
    riskPercent: 2,
    atrMultiplier: 0.8,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['BTCUSD'],
  },

  // XAUUSD Optimal: ATR1.5 with RR2 - 75.4% win rate, PF 3.07
  'XAU_OPTIMAL': {
    name: 'Gold Optimal',
    description: 'ATR1.5|RR2|NoConf - Optimized for XAUUSD (75.4% WR, 3.07 PF)',
    riskTier: 'aggressive',
    strategy: 'ORDER_BLOCK',
    minOBScore: 70,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 2,
    riskPercent: 2,
    atrMultiplier: 1.5,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['XAUUSD.s'],
  },

  // XAGUSD Optimal: OB65 with RR2 - 66.1% win rate, PF 1.94
  'XAG_OPTIMAL': {
    name: 'Silver Optimal',
    description: 'OB65|RR2|NoConf - Optimized for XAGUSD (66.1% WR, 1.94 PF)',
    riskTier: 'aggressive',
    strategy: 'ORDER_BLOCK',
    minOBScore: 65,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 2,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['XAGUSD.s'],
  },

  // === UNIVERSAL STRATEGIES (work across all symbols) ===
  'UNIVERSAL_NOCONF': {
    name: 'Universal NoConf',
    description: 'OB70|All|DD8%|NoConf|RR2 - Works across all symbols',
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
    recommendedSymbols: ['BTCUSD', 'XAUUSD.s', 'XAGUSD.s'],
  },

  'UNIVERSAL_RR15': {
    name: 'Universal RR1.5',
    description: 'OB70|All|DD8%|NoConf|RR1.5 - Higher win rate, smaller targets',
    riskTier: 'aggressive',
    strategy: 'ORDER_BLOCK',
    minOBScore: 70,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 1.5,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['BTCUSD', 'XAUUSD.s', 'XAGUSD.s'],
  },

  // === CONSERVATIVE/SAFE STRATEGIES (for prop firms) ===
  'SAFE_KZ': {
    name: 'Safe Kill Zones',
    description: 'OB70|KZ|DD6%|NoConf - Lower DD for prop firms',
    riskTier: 'conservative',
    strategy: 'ORDER_BLOCK',
    minOBScore: 70,
    useKillZones: true,
    killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
    maxDailyDrawdown: 6,
    confirmationType: 'none',
    riskReward: 2,
    riskPercent: 1,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 1,
    recommendedSymbols: ['XAUUSD.s', 'XAGUSD.s'],
  },

  'SAFE_STRICT': {
    name: 'Safe Strict',
    description: 'OB65|KZ|DD5%|NoConf - Very conservative for challenges',
    riskTier: 'conservative',
    strategy: 'ORDER_BLOCK',
    minOBScore: 65,
    useKillZones: true,
    killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
    maxDailyDrawdown: 5,
    confirmationType: 'none',
    riskReward: 2,
    riskPercent: 1,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 1,
    recommendedSymbols: ['XAUUSD.s', 'XAGUSD.s'],
  },

  // === LEGACY STRATEGIES (kept for backwards compatibility) ===
  'AGGRESSIVE_ENGULF': {
    name: 'Aggressive Engulfing (Legacy)',
    description: 'OB70|All|DD8%|Engulf - Use UNIVERSAL_NOCONF instead',
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

  'BALANCED_STRONG': {
    name: 'Balanced Strong (Legacy)',
    description: 'OB70|KZ|DD6%|Strong - Use SAFE_KZ instead',
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
};

/**
 * Symbol-specific recommended profiles based on backtest performance (Jan 2026)
 */
export const SYMBOL_RECOMMENDED_PROFILES: Record<string, string[]> = {
  'BTCUSD': ['BTC_OPTIMAL', 'UNIVERSAL_RR15', 'UNIVERSAL_NOCONF'],
  'XAUUSD.s': ['XAU_OPTIMAL', 'UNIVERSAL_NOCONF', 'SAFE_KZ'],
  'XAGUSD.s': ['XAG_OPTIMAL', 'UNIVERSAL_NOCONF', 'SAFE_KZ'],
};

/**
 * Symbol-specific optimal timeframe configurations (Jan 2026)
 * Based on backtesting different timeframe combinations
 */
export interface SymbolTimeframeConfig {
  htf: Timeframe;
  mtf: Timeframe;
  ltf: Timeframe;
  description: string;
}

export const SYMBOL_TIMEFRAMES: Record<string, SymbolTimeframeConfig> = {
  'BTCUSD': {
    htf: 'H4',
    mtf: 'M30',
    ltf: 'M5',
    description: 'M5 entries work best for BTC (H4/M30/M5)',
  },
  'XAUUSD.s': {
    htf: 'H1',
    mtf: 'M15',
    ltf: 'M1',
    description: 'M1 scalp entries work best for Gold (H1/M15/M1)',
  },
  'XAGUSD.s': {
    htf: 'H1',
    mtf: 'M15',
    ltf: 'M1',
    description: 'M1 scalp entries work best for Silver (H1/M15/M1)',
  },
};

/**
 * Default configurations per symbol based on backtest insights (Jan 2026)
 * KEY FINDING: NoConf (no confirmation) outperforms all confirmation types
 */
export const SYMBOL_DEFAULTS: Record<string, SymbolOverrides> = {
  'BTCUSD': {
    // BTCUSD: NoConf with ATR 0.8, RR 1.5 is optimal
    confirmationType: 'none',
    minOBScore: 70,
    maxDailyDrawdown: 8,
  },
  'XAUUSD.s': {
    // XAUUSD: NoConf with ATR 1.5, RR 2 is optimal
    confirmationType: 'none',
    minOBScore: 70,
    maxDailyDrawdown: 8,
  },
  'XAGUSD.s': {
    // XAGUSD: NoConf with OB65, RR 2 is optimal
    confirmationType: 'none',
    minOBScore: 65,
    maxDailyDrawdown: 8,
  },
};

/**
 * Default live strategy configuration
 *
 * IMPORTANT: liveTrading is FALSE by default - must be explicitly enabled
 * Updated Jan 2026: Uses UNIVERSAL_NOCONF as default (best overall performance)
 * Note: For optimal performance, use symbol-specific timeframes from SYMBOL_TIMEFRAMES
 */
export const DEFAULT_LIVE_CONFIG: LiveStrategyConfig = {
  profile: STRATEGY_PROFILES['UNIVERSAL_NOCONF'],
  symbols: [
    { symbol: 'XAUUSD.s', enabled: true, overrides: SYMBOL_DEFAULTS['XAUUSD.s'] },
    { symbol: 'BTCUSD', enabled: true, overrides: SYMBOL_DEFAULTS['BTCUSD'] },
    { symbol: 'XAGUSD.s', enabled: true, overrides: SYMBOL_DEFAULTS['XAGUSD.s'] },
  ],
  liveTrading: false, // Paper mode by default
  // Default timeframes - for optimal performance, use getSymbolTimeframes() per symbol
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
  atrMultiplier: number;
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
    atrMultiplier: profile.atrMultiplier,
  };
}

/**
 * Get optimal timeframes for a symbol based on backtest results
 * Falls back to config defaults if symbol not found
 */
export function getSymbolTimeframes(
  config: LiveStrategyConfig,
  symbol: string
): { htf: Timeframe; mtf: Timeframe; ltf: Timeframe } {
  const symbolTf = SYMBOL_TIMEFRAMES[symbol];
  if (symbolTf) {
    return { htf: symbolTf.htf, mtf: symbolTf.mtf, ltf: symbolTf.ltf };
  }
  // Fall back to config defaults
  return {
    htf: config.htfTimeframe,
    mtf: config.mtfTimeframe,
    ltf: config.ltfTimeframe,
  };
}

/**
 * Get optimal profile for a symbol based on backtest results
 */
export function getOptimalProfileForSymbol(symbol: string): StrategyProfile {
  // Symbol-specific optimal profiles from Jan 2026 backtesting
  const optimalProfiles: Record<string, string> = {
    'BTCUSD': 'BTC_OPTIMAL',
    'XAUUSD.s': 'XAU_OPTIMAL',
    'XAGUSD.s': 'XAG_OPTIMAL',
  };

  const profileKey = optimalProfiles[symbol];
  if (profileKey && STRATEGY_PROFILES[profileKey]) {
    return STRATEGY_PROFILES[profileKey];
  }
  // Fall back to universal profile
  return STRATEGY_PROFILES['UNIVERSAL_NOCONF'];
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
