/**
 * Strategy Profiles - Production-ready configurations from backtest optimization
 *
 * Based on comprehensive backtesting from Jan 5-26, 2026 (21 days)
 * Updated Jan 27, 2026 with new optimal strategies:
 *
 * KEY FINDINGS:
 * 1. BTCUSD: ATR-based OB with lower RR (1.3-1.5) dominates - 82.4% WR!
 * 2. XAUUSD/XAGUSD: M1-TREND EMA strategy significantly outperforms OB
 * 3. ETHUSD: Kill Zone filtering is essential for profitability
 * 4. Tiered TP (30@1R|30@2R|40@4R) produces highest profits on metals
 *
 * NEW OPTIMAL STRATEGIES (Jan 2026):
 * - BTCUSD: CRYPTO-OPT ATR1.3|RR1.5 -> $435, 82.4% WR, PF 6.79
 * - XAUUSD.s: M1-TREND RR2|DD6% -> $478, 51.9% WR, PF 2.56
 * - XAGUSD.s: M1-TREND-TIERED 30@1R|30@2R|40@4R -> $869, 29.5% WR, PF 1.56
 * - ETHUSD: M1-TREND-KZ RR2.5|DD6% -> $226, 41.7% WR, PF 1.76
 */

import { StrategyType, Timeframe, KillZoneType, BreakevenConfig, TieredTPConfig, TIERED_TP_PROFILES } from '../types';

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
  /** Breakeven configuration - moves SL to entry + buffer when target R is reached */
  breakeven?: BreakevenConfig;
  /** Tiered take-profit configuration for partial closes */
  tieredTP?: TieredTPConfig;
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
  /** Override kill zones setting for this symbol */
  useKillZones?: boolean;
  /** Override risk:reward ratio for this symbol */
  riskReward?: number;
  /** Override ATR multiplier for this symbol */
  atrMultiplier?: number;
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
  // === NEW OPTIMAL STRATEGIES (Jan 27, 2026 Backtests) ===

  // BTCUSD Optimal: CRYPTO-OPT ATR1.3|RR1.5 - 82.4% win rate, PF 6.79, $435 profit
  'BTC_OPTIMAL': {
    name: 'BTC Optimal (Jan 2026)',
    description: 'ATR1.3|RR1.5 - BEST for BTCUSD (82.4% WR, PF 6.79)',
    riskTier: 'aggressive',
    strategy: 'ORDER_BLOCK',
    minOBScore: 70,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 1.5,
    riskPercent: 2,
    atrMultiplier: 1.3,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['BTCUSD'],
    breakeven: { enabled: false, triggerR: 1.0, bufferPips: 5 }, // Disabled - tiered TP handles this
    tieredTP: TIERED_TP_PROFILES['RUNNER'], // 30@1R|30@2R|40@4R
  },

  // XAUUSD Optimal: M1-TREND RR2|DD6% - 51.9% win rate, PF 2.56, $478 profit
  'XAU_OPTIMAL': {
    name: 'Gold Optimal (M1 Trend)',
    description: 'M1-TREND|RR2|DD6% - BEST for Gold (51.9% WR, PF 2.56)',
    riskTier: 'aggressive',
    strategy: 'M1_TREND',
    minOBScore: 50, // Not used for M1_TREND
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 6,
    confirmationType: 'none',
    riskReward: 2.0,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['XAUUSD.s'],
    breakeven: { enabled: false, triggerR: 1.0, bufferPips: 3 },
  },

  // XAGUSD Optimal: M1-TREND-TIERED 30@1R|30@2R|40@4R - 29.5% win rate, PF 1.56, $869 profit
  'XAG_OPTIMAL': {
    name: 'Silver Optimal (M1 Trend Tiered)',
    description: 'M1-TREND-TIERED|30@1R|30@2R|40@4R - BEST for Silver ($869 profit!)',
    riskTier: 'aggressive',
    strategy: 'M1_TREND',
    minOBScore: 50,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 4.0, // Final TP at 4R
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['XAGUSD.s'],
    breakeven: { enabled: false, triggerR: 1.0, bufferPips: 3 },
    tieredTP: {
      enabled: true,
      tp1: { rr: 1.0, percent: 30 },
      tp2: { rr: 2.0, percent: 30 },
      tp3: { rr: 4.0, percent: 40 },
      moveSlOnTP1: true,
      beBufferPips: 3,
      moveSlOnTP2: true,
    },
  },

  // ETHUSD Optimal: M1-TREND-KZ RR2.5|DD6% - 41.7% win rate, PF 1.76, $226 profit
  'ETH_OPTIMAL': {
    name: 'ETH Optimal (M1 Trend KZ)',
    description: 'M1-TREND|KZ|RR2.5|DD6% - BEST for ETH (41.7% WR, PF 1.76)',
    riskTier: 'balanced',
    strategy: 'M1_TREND',
    minOBScore: 50,
    useKillZones: true,
    killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
    maxDailyDrawdown: 6,
    confirmationType: 'none',
    riskReward: 2.5,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['ETHUSD'],
    breakeven: { enabled: false, triggerR: 1.0, bufferPips: 3 },
  },

  // === LEGACY SYMBOL-SPECIFIC STRATEGIES (keep for backwards compatibility) ===

  // Legacy BTC: ATR0.8 with RR1.5
  'BTC_LEGACY': {
    name: 'BTC Legacy (ATR0.8)',
    description: 'ATR0.8|RR1.5|NoConf|BE1R - Previous optimal',
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
    breakeven: { enabled: true, triggerR: 1.0, bufferPips: 5 },
  },

  // === UNIVERSAL STRATEGIES (work across all symbols) ===
  'UNIVERSAL_NOCONF': {
    name: 'Universal NoConf',
    description: 'OB70|All|DD8%|NoConf|RR2|BE1R - Works across all symbols',
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
    breakeven: { enabled: true, triggerR: 1.0, bufferPips: 5 },
  },

  'UNIVERSAL_RR15': {
    name: 'Universal RR1.5',
    description: 'OB70|All|DD8%|NoConf|RR1.5|BE1R - Higher win rate, smaller targets',
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
    breakeven: { enabled: true, triggerR: 1.0, bufferPips: 5 },
  },

  // === CONSERVATIVE/SAFE STRATEGIES (for prop firms) ===
  'SAFE_KZ': {
    name: 'Safe Kill Zones',
    description: 'OB70|KZ|DD6%|NoConf|BE1R - Lower DD for prop firms',
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
    breakeven: { enabled: true, triggerR: 1.0, bufferPips: 5 },
  },

  'SAFE_STRICT': {
    name: 'Safe Strict',
    description: 'OB65|KZ|DD5%|NoConf|BE1R - Very conservative for challenges',
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
    breakeven: { enabled: true, triggerR: 1.0, bufferPips: 5 },
  },

  // === LEGACY STRATEGIES (kept for backwards compatibility) ===
  'AGGRESSIVE_ENGULF': {
    name: 'Aggressive Engulfing (Legacy)',
    description: 'OB70|All|DD8%|Engulf|BE1R - Use UNIVERSAL_NOCONF instead',
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
    breakeven: { enabled: true, triggerR: 1.0, bufferPips: 5 },
  },

  'BALANCED_STRONG': {
    name: 'Balanced Strong (Legacy)',
    description: 'OB70|KZ|DD6%|Strong|BE1R - Use SAFE_KZ instead',
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
    breakeven: { enabled: true, triggerR: 1.0, bufferPips: 5 },
  },
};

/**
 * Symbol-specific recommended profiles based on backtest performance (Jan 27, 2026)
 * Updated with new M1-TREND strategies that significantly outperform Order Block on metals
 */
export const SYMBOL_RECOMMENDED_PROFILES: Record<string, string[]> = {
  'BTCUSD': ['BTC_OPTIMAL', 'BTC_LEGACY', 'UNIVERSAL_RR15'],
  'XAUUSD.s': ['XAU_OPTIMAL', 'UNIVERSAL_NOCONF', 'SAFE_KZ'],
  'XAGUSD.s': ['XAG_OPTIMAL', 'UNIVERSAL_NOCONF', 'SAFE_KZ'],
  'ETHUSD': ['ETH_OPTIMAL', 'SAFE_KZ'],
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
  'ETHUSD': {
    htf: 'H4',
    mtf: 'H1',
    ltf: 'M5',
    description: 'M5 entries with ATR1.5 work best for ETH (H4/H1/M5)',
  },
};

/**
 * Symbol trading limits
 * minSlPips prevents entries with stop losses too close (easily stopped by spread/noise)
 * Wide stop losses are handled by position sizing (smaller lot if SL is wider)
 */
export const SYMBOL_TRADING_LIMITS: Record<string, { minSlPips: number; typicalSpread: number }> = {
  'XAUUSD.s': { minSlPips: 15, typicalSpread: 0.25 },   // ~$1.50 min SL, ~25 cents spread (6x)
  'XAGUSD.s': { minSlPips: 10, typicalSpread: 0.025 },  // ~$0.10 min SL, ~2.5 cents spread (4x)
  'BTCUSD': { minSlPips: 100, typicalSpread: 15 },      // ~$100 min SL, ~$15 spread (6-7x)
  'ETHUSD': { minSlPips: 20, typicalSpread: 2 },        // ~$20 min SL, ~$2 spread (10x)
};

/**
 * Default configurations per symbol based on backtest insights (Jan 27, 2026)
 * Updated with new optimal strategies from 21-day backtest (Jan 5-26, 2026)
 */
export const SYMBOL_DEFAULTS: Record<string, SymbolOverrides> = {
  'BTCUSD': {
    // BTCUSD: CRYPTO-OPT ATR1.3|RR1.5 - 82.4% WR, PF 6.79, +$435
    confirmationType: 'none',
    minOBScore: 70,
    maxDailyDrawdown: 8,
    useKillZones: false,
    riskReward: 1.5,
    atrMultiplier: 1.3,
  },
  'XAUUSD.s': {
    // XAUUSD: M1-TREND RR2|DD6% - 51.9% WR, PF 2.56, +$478
    confirmationType: 'none',
    minOBScore: 50, // Not used for M1_TREND
    maxDailyDrawdown: 6,
    useKillZones: false,
    riskReward: 2.0,
    atrMultiplier: 1.0,
  },
  'XAGUSD.s': {
    // XAGUSD: M1-TREND-TIERED 30@1R|30@2R|40@4R - 29.5% WR, PF 1.56, +$869
    confirmationType: 'none',
    minOBScore: 50,
    maxDailyDrawdown: 8,
    useKillZones: false,
    riskReward: 4.0, // Final TP at 4R for tiered
    atrMultiplier: 1.0,
  },
  'ETHUSD': {
    // ETHUSD: M1-TREND-KZ RR2.5|DD6% - 41.7% WR, PF 1.76, +$226
    confirmationType: 'none',
    minOBScore: 50,
    maxDailyDrawdown: 6,
    useKillZones: true,
    riskReward: 2.5,
    atrMultiplier: 1.0,
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
    { symbol: 'BTCUSD', enabled: true, overrides: SYMBOL_DEFAULTS['BTCUSD'] },    // KZ enabled, DD6%, RR2
    { symbol: 'XAUUSD.s', enabled: true, overrides: SYMBOL_DEFAULTS['XAUUSD.s'] }, // No KZ, RR2, BE at 1R
    { symbol: 'XAGUSD.s', enabled: true, overrides: SYMBOL_DEFAULTS['XAGUSD.s'] }, // Low activity expected
    { symbol: 'ETHUSD', enabled: false, overrides: SYMBOL_DEFAULTS['ETHUSD'] },    // DISABLED - poor performance
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
    riskReward: overrides.riskReward ?? profile.riskReward,
    useKillZones: overrides.useKillZones ?? profile.useKillZones,
    killZones: profile.killZones,
    atrMultiplier: overrides.atrMultiplier ?? profile.atrMultiplier,
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
