/**
 * Strategy Profiles - Production-ready configurations from backtest optimization
 *
 * Updated Feb 11, 2026 from 20-day backtest (Jan 22 - Feb 11, 2026)
 * 2 rounds of iteration testing 141 strategy variations per symbol
 *
 * KEY FINDINGS (Feb 2026):
 * 1. BTCUSD: Scalp (H1/M15/M1) is 10x better than M5 - ATR1.5|RR2 = 70.9% WR, PF 3.35
 * 2. XAUUSD.s: NoFilter OB + RR2.5 = 83.1% WR, PF 6.44 (massive)
 * 3. XAGUSD.s: Tiered 50@0.5R|30@1R|20@1.5R = 80.5% WR, PF 2.95
 * 4. Breakeven at 0.75R consistently improves risk-adjusted returns
 * 5. ATR2.0 filtering gives highest win rates (83-89%) but fewer trades
 *
 * OPTIMAL STRATEGIES (Feb 2026):
 * - BTCUSD: OB40 ATR1.5|RR2 (scalp) -> $2,071, 70.9% WR, PF 3.35
 * - XAUUSD.s: EVERY-OB NoFilter|RR2.5 -> $2,311, 83.1% WR, PF 6.44
 * - XAGUSD.s: TIERED 50@0.5R|30@1R|20@1.5R -> $3,066, 80.5% WR, PF 2.95
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
  // === OPTIMAL STRATEGIES (Feb 11, 2026 - 20-day backtest Jan 22 - Feb 11) ===

  // BTCUSD Optimal: OB40 ATR1.5|RR2 on Scalp (H1/M15/M1) - 70.9% WR, PF 3.35, $2,071
  'BTC_OPTIMAL': {
    name: 'BTC Optimal (Feb 2026)',
    description: 'ATR1.5|RR2|OB40|Scalp - 70.9% WR, PF 3.35, $2,071',
    riskTier: 'aggressive',
    strategy: 'ORDER_BLOCK',
    minOBScore: 40, // OB40 filter + ATR1.5 quality filtering
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 2.0,
    riskPercent: 2,
    atrMultiplier: 1.5,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['BTCUSD'],
    breakeven: { enabled: false, triggerR: 1.0, bufferPips: 5 },
  },

  // BTCUSD High Win Rate: ATR2.0-BE RR3|BE0.75R - 83.8% WR, PF 5.25, $1,650
  'BTC_HIGH_WR': {
    name: 'BTC High Win Rate (Feb 2026)',
    description: 'ATR2.0|RR3|BE0.75R|Scalp - 83.8% WR, PF 5.25, $1,650',
    riskTier: 'balanced',
    strategy: 'ORDER_BLOCK',
    minOBScore: 0,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 3.0,
    riskPercent: 2,
    atrMultiplier: 2.0,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['BTCUSD'],
    breakeven: { enabled: true, triggerR: 0.75, bufferPips: 5 },
  },

  // XAUUSD Optimal: EVERY-OB NoFilter|RR2.5 - 83.1% WR, PF 6.44, $2,311
  'XAU_OPTIMAL': {
    name: 'Gold Optimal (Feb 2026)',
    description: 'NoFilter|RR2.5|Scalp - 83.1% WR, PF 6.44, $2,311',
    riskTier: 'aggressive',
    strategy: 'ORDER_BLOCK',
    minOBScore: 0, // NoFilter - take every OB
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 20,
    confirmationType: 'none',
    riskReward: 2.5,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['XAUUSD.s'],
    breakeven: { enabled: false, triggerR: 1.0, bufferPips: 3 },
  },

  // XAUUSD Safe: BE 0.75R|RR3 - 84.9% WR, PF 7.72, $2,215, 3.9% MaxDD
  'XAU_SAFE': {
    name: 'Gold Safe (Feb 2026)',
    description: 'OB70|RR3|BE0.75R|Scalp - 84.9% WR, PF 7.72, 3.9% MaxDD',
    riskTier: 'balanced',
    strategy: 'ORDER_BLOCK',
    minOBScore: 70,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 3.0,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['XAUUSD.s'],
    breakeven: { enabled: true, triggerR: 0.75, bufferPips: 3 },
  },

  // XAGUSD Optimal: TIERED 50@0.5R|30@1R|20@1.5R - 80.5% WR, PF 2.95, $3,066
  'XAG_OPTIMAL': {
    name: 'Silver Optimal (Feb 2026)',
    description: 'TIERED 50@0.5R|30@1R|20@1.5R|Scalp - 80.5% WR, PF 2.95, $3,066',
    riskTier: 'aggressive',
    strategy: 'ORDER_BLOCK',
    minOBScore: 70,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 1.5, // Final TP at 1.5R
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['XAGUSD.s'],
    breakeven: { enabled: false, triggerR: 1.0, bufferPips: 3 },
    tieredTP: TIERED_TP_PROFILES['SCALP_QUICK'], // 50@0.5R|30@1R|20@1.5R
  },

  // ETHUSD: kept from Jan 2026 (not re-tested in Feb round)
  'ETH_OPTIMAL': {
    name: 'ETH Optimal (Jan 2026)',
    description: 'M1-TREND|KZ|RR2.5|DD6% - 41.7% WR, PF 1.76',
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

  // === LEGACY SYMBOL-SPECIFIC STRATEGIES (Jan 2026 - kept for reference) ===

  // Legacy BTC: ATR1.3 with RR1.5 (Jan 2026 optimal)
  'BTC_LEGACY': {
    name: 'BTC Legacy (Jan 2026)',
    description: 'ATR1.3|RR1.5|OB70 - Jan 2026 optimal (now use BTC_OPTIMAL)',
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
    breakeven: { enabled: false, triggerR: 1.0, bufferPips: 5 },
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

  // === NEW INSTITUTIONAL STRATEGIES (Feb 24, 2026) ===

  // Judas Swing / ICT Silver Bullet - Session open fake move reversal
  // Targets the fake move at London/NY open that sweeps Asian range before reversing
  'JUDAS_SWING_LONDON': {
    name: 'Judas Swing London (Feb 2026)',
    description: 'ICT Silver Bullet|London SB|RR2.5|Scalp - Session open reversal',
    riskTier: 'balanced',
    strategy: 'JUDAS_SWING',
    minOBScore: 0, // Uses session logic, not OB scoring
    useKillZones: false, // Strategy has its own time windows
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 2.5,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 2,
    recommendedSymbols: ['XAUUSD.s', 'BTCUSD'],
    breakeven: { enabled: true, triggerR: 0.75, bufferPips: 3 },
  },

  'JUDAS_SWING_NY': {
    name: 'Judas Swing NY (Feb 2026)',
    description: 'ICT Silver Bullet|NY AM SB|RR2.5|Scalp - NY session reversal',
    riskTier: 'balanced',
    strategy: 'JUDAS_SWING',
    minOBScore: 0,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 2.5,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 2,
    recommendedSymbols: ['XAUUSD.s', 'BTCUSD', 'XAGUSD.s'],
    breakeven: { enabled: true, triggerR: 0.75, bufferPips: 3 },
  },

  // FVG Entry - Standalone Fair Value Gap fill entries
  // Price returns to fill institutional imbalances with high probability
  'FVG_FILL_AGGRESSIVE': {
    name: 'FVG Fill Aggressive (Feb 2026)',
    description: 'FVG_ENTRY|NoFilter|RR2.5|Scalp - Trade every FVG fill in bias direction',
    riskTier: 'aggressive',
    strategy: 'FVG_ENTRY',
    minOBScore: 0,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 10,
    confirmationType: 'none',
    riskReward: 2.5,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 3,
    recommendedSymbols: ['XAUUSD.s', 'BTCUSD', 'XAGUSD.s'],
    breakeven: { enabled: false, triggerR: 1.0, bufferPips: 3 },
  },

  'FVG_FILL_SAFE': {
    name: 'FVG Fill Safe (Feb 2026)',
    description: 'FVG_ENTRY|KZ|RR3|BE0.75R - FVG fills during kill zones only',
    riskTier: 'conservative',
    strategy: 'FVG_ENTRY',
    minOBScore: 0,
    useKillZones: true,
    killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
    maxDailyDrawdown: 6,
    confirmationType: 'none',
    riskReward: 3.0,
    riskPercent: 1.5,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 2,
    recommendedSymbols: ['XAUUSD.s', 'XAGUSD.s'],
    breakeven: { enabled: true, triggerR: 0.75, bufferPips: 3 },
  },

  // Breaker Block - Mitigated OB polarity flip
  // When OBs get broken, they become powerful reversal zones
  'BREAKER_BLOCK_TREND': {
    name: 'Breaker Block Trend (Feb 2026)',
    description: 'BREAKER_BLOCK|RR2.5|BE0.75R|Scalp - Trend continuation via breakers',
    riskTier: 'balanced',
    strategy: 'BREAKER_BLOCK',
    minOBScore: 0,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 8,
    confirmationType: 'none',
    riskReward: 2.5,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 2,
    recommendedSymbols: ['XAUUSD.s', 'BTCUSD', 'XAGUSD.s'],
    breakeven: { enabled: true, triggerR: 0.75, bufferPips: 3 },
  },

  // PDH/PDL Sweep - Previous Day High/Low sweep reversal
  // Daily level sweeps are among the highest-probability institutional setups
  'PDH_PDL_AGGRESSIVE': {
    name: 'PDH/PDL Sweep Aggressive (Feb 2026)',
    description: 'PDH_PDL_SWEEP|RR2.5|BE0.75R|Scalp - Daily level sweep reversals',
    riskTier: 'aggressive',
    strategy: 'PDH_PDL_SWEEP',
    minOBScore: 0,
    useKillZones: false,
    killZones: [],
    maxDailyDrawdown: 10,
    confirmationType: 'none',
    riskReward: 2.5,
    riskPercent: 2,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 2,
    recommendedSymbols: ['XAUUSD.s', 'BTCUSD'],
    breakeven: { enabled: true, triggerR: 0.75, bufferPips: 3 },
  },

  'PDH_PDL_SAFE': {
    name: 'PDH/PDL Sweep Safe (Feb 2026)',
    description: 'PDH_PDL_SWEEP|KZ|RR3|BE0.75R|DD5% - PDH/PDL for prop firms',
    riskTier: 'conservative',
    strategy: 'PDH_PDL_SWEEP',
    minOBScore: 0,
    useKillZones: true,
    killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
    maxDailyDrawdown: 5,
    confirmationType: 'none',
    riskReward: 3.0,
    riskPercent: 1,
    atrMultiplier: 1.0,
    maxConcurrentTrades: 1,
    recommendedSymbols: ['XAUUSD.s', 'BTCUSD'],
    breakeven: { enabled: true, triggerR: 0.75, bufferPips: 3 },
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
 * Symbol-specific recommended profiles based on backtest performance (Feb 11, 2026)
 * All symbols now use ORDER_BLOCK on Scalp (H1/M15/M1) timeframe
 */
export const SYMBOL_RECOMMENDED_PROFILES: Record<string, string[]> = {
  'BTCUSD': ['BTC_OPTIMAL', 'BTC_HIGH_WR', 'JUDAS_SWING_NY', 'PDH_PDL_AGGRESSIVE', 'BREAKER_BLOCK_TREND', 'FVG_FILL_AGGRESSIVE', 'UNIVERSAL_NOCONF'],
  'XAUUSD.s': ['XAU_OPTIMAL', 'XAU_SAFE', 'JUDAS_SWING_LONDON', 'PDH_PDL_AGGRESSIVE', 'FVG_FILL_SAFE', 'BREAKER_BLOCK_TREND', 'UNIVERSAL_NOCONF'],
  'XAGUSD.s': ['XAG_OPTIMAL', 'JUDAS_SWING_NY', 'FVG_FILL_AGGRESSIVE', 'BREAKER_BLOCK_TREND', 'UNIVERSAL_NOCONF', 'SAFE_KZ'],
  'ETHUSD': ['ETH_OPTIMAL', 'FVG_FILL_SAFE', 'SAFE_KZ'],
};

/**
 * Symbol-specific optimal timeframe configurations (Feb 2026)
 * KEY: BTCUSD switched from M5 to Scalp - 10x improvement ($215 -> $2,071)
 */
export interface SymbolTimeframeConfig {
  htf: Timeframe;
  mtf: Timeframe;
  ltf: Timeframe;
  description: string;
}

export const SYMBOL_TIMEFRAMES: Record<string, SymbolTimeframeConfig> = {
  'BTCUSD': {
    htf: 'H1',
    mtf: 'M15',
    ltf: 'M1',
    description: 'Scalp (H1/M15/M1) - 10x better than M5 for BTC (Feb 2026)',
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
 * Default configurations per symbol based on backtest insights (Feb 11, 2026)
 * Updated with optimal strategies from 20-day backtest (Jan 22 - Feb 11, 2026)
 */
export const SYMBOL_DEFAULTS: Record<string, SymbolOverrides> = {
  'BTCUSD': {
    // BTCUSD: OB40 ATR1.5|RR2 (Scalp) - 70.9% WR, PF 3.35, +$2,071
    confirmationType: 'none',
    minOBScore: 40, // OB40 filter + ATR1.5 quality filtering
    maxDailyDrawdown: 8,
    useKillZones: false,
    riskReward: 2.0,
    atrMultiplier: 1.5,
  },
  'XAUUSD.s': {
    // XAUUSD: EVERY-OB NoFilter|RR2.5 - 83.1% WR, PF 6.44, +$2,311
    confirmationType: 'none',
    minOBScore: 0, // NoFilter OB
    maxDailyDrawdown: 20,
    useKillZones: false,
    riskReward: 2.5,
    atrMultiplier: 1.0,
  },
  'XAGUSD.s': {
    // XAGUSD: TIERED 50@0.5R|30@1R|20@1.5R - 80.5% WR, PF 2.95, +$3,066
    confirmationType: 'none',
    minOBScore: 70,
    maxDailyDrawdown: 8,
    useKillZones: false,
    riskReward: 1.5, // Final TP at 1.5R for tiered
    atrMultiplier: 1.0,
  },
  'ETHUSD': {
    // ETHUSD: M1-TREND-KZ RR2.5|DD6% - 41.7% WR, PF 1.76 (Jan 2026)
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
 * Updated Feb 2026: All symbols now use Scalp (H1/M15/M1) timeframe
 * Use symbol-specific profiles via getSymbolTimeframes() for best performance
 */
export const DEFAULT_LIVE_CONFIG: LiveStrategyConfig = {
  profile: STRATEGY_PROFILES['UNIVERSAL_NOCONF'],
  symbols: [
    { symbol: 'BTCUSD', enabled: true, overrides: SYMBOL_DEFAULTS['BTCUSD'] },     // OB40|ATR1.5|RR2
    { symbol: 'XAUUSD.s', enabled: true, overrides: SYMBOL_DEFAULTS['XAUUSD.s'] }, // NoFilter|RR2.5
    { symbol: 'XAGUSD.s', enabled: true, overrides: SYMBOL_DEFAULTS['XAGUSD.s'] }, // Tiered 50@0.5R|30@1R|20@1.5R
    { symbol: 'ETHUSD', enabled: false, overrides: SYMBOL_DEFAULTS['ETHUSD'] },    // DISABLED - not re-tested
  ],
  liveTrading: false, // Paper mode by default
  // Default timeframes - all symbols now use scalp
  htfTimeframe: 'H1',
  mtfTimeframe: 'M15',
  ltfTimeframe: 'M1',
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
  // Symbol-specific optimal profiles from Feb 2026 backtesting
  const optimalProfiles: Record<string, string> = {
    'BTCUSD': 'BTC_OPTIMAL',
    'XAUUSD.s': 'XAU_OPTIMAL',
    'XAGUSD.s': 'XAG_OPTIMAL',
    'ETHUSD': 'ETH_OPTIMAL',
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

  if (profile.minOBScore < 0 || profile.minOBScore > 100) {
    errors.push('minOBScore must be between 0 and 100');
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
