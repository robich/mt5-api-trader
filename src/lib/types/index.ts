// Core trading types for the SMC Trading Bot

export type Direction = 'BUY' | 'SELL';
export type Bias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1';
export type StrategyType = 'ORDER_BLOCK' | 'LIQUIDITY_SWEEP' | 'BOS' | 'FBO_CLASSIC' | 'FBO_SWEEP' | 'FBO_STRUCTURE' | 'M1_TREND' | 'EXTERNAL';
export type SignalStatus = 'PENDING' | 'TAKEN' | 'REJECTED' | 'EXPIRED';
export type TradeStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';
export type StructureType = 'HH' | 'HL' | 'LH' | 'LL' | 'BOS' | 'CHOCH';

export interface Candle {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
  timeframe: Timeframe;
}

export interface Tick {
  time: Date;
  bid: number;
  ask: number;
  symbol: string;
}

export interface OrderBlock {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  type: 'BULLISH' | 'BEARISH';
  high: number;
  low: number;
  open: number;
  close: number;
  candleTime: Date;
  isValid: boolean;
  mitigatedAt?: Date;
}

export interface FairValueGap {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  type: 'BULLISH' | 'BEARISH';
  high: number;
  low: number;
  gapTime: Date;
  isFilled: boolean;
  filledAt?: Date;
}

export interface LiquidityZone {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  type: 'HIGH' | 'LOW';
  price: number;
  candleTime: Date;
  isSwept: boolean;
  sweptAt?: Date;
}

export interface SwingPoint {
  type: 'HIGH' | 'LOW';
  price: number;
  time: Date;
  index: number;
}

export interface MarketStructure {
  bias: Bias;
  lastStructure: StructureType;
  swingPoints: SwingPoint[];
  lastBOS?: {
    type: StructureType;
    price: number;
    time: Date;
  };
  lastCHOCH?: {
    type: StructureType;
    price: number;
    time: Date;
  };
}

export interface Signal {
  id: string;
  symbol: string;
  direction: Direction;
  strategy: StrategyType;
  timeframe: Timeframe;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  status: SignalStatus;
  reason?: string;
  htfBias: Bias;
  mtfStructure: string;
  createdAt: Date;
  expiresAt?: Date;
}

export interface Trade {
  id: string;
  signalId?: string;
  symbol: string;
  direction: Direction;
  strategy: StrategyType;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  openTime: Date;
  closeTime?: Date;
  closePrice?: number;
  pnl?: number;
  pnlPercent?: number;
  status: TradeStatus;
  mt5OrderId?: string;
  mt5PositionId?: string;
  riskAmount: number;
  riskRewardRatio: number;
  notes?: string;
}

export interface AccountInfo {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel?: number;
  leverage: number;
  currency: string;
}

export interface Position {
  id: string;
  symbol: string;
  type: Direction;
  volume: number;
  openPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  profit: number;
  swap: number;
  openTime: Date;
  comment?: string;
}

export interface SymbolInfo {
  symbol: string;
  description: string;
  digits: number;
  pipSize: number;
  contractSize: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  tickSize: number;
  tickValue: number;
  /** Minimum stop loss distance in pips - signals with smaller SL are rejected */
  minSlPips?: number;
}

// Kill zone and session types for SMC trading
export type KillZoneType = 'LONDON_OPEN' | 'NY_OPEN' | 'LONDON_NY_OVERLAP' | 'ASIAN';
export type Session = 'ASIAN' | 'LONDON' | 'NEW_YORK' | 'OVERLAP' | 'OFF_HOURS';

// Premium/Discount zone data
export interface PremiumDiscountZone {
  premium: { high: number; low: number };
  discount: { high: number; low: number };
  equilibrium: number;
  fib50: number;
  fib618: number;
  fib786: number;
}

// CHoCH event
export interface CHoCHEvent {
  type: 'BULLISH' | 'BEARISH';
  price: number;
  time: Date;
}

// Inducement level (minor liquidity before major)
export interface InducementLevel {
  majorLiquidity: LiquidityZone;
  inducementZone: LiquidityZone;
  isSwept: boolean;
}

export interface BacktestConfig {
  strategy: StrategyType;
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialBalance: number;
  riskPercent: number;
  useTickData: boolean;
  // SMC Enhancement options
  useKillZones?: boolean;
  killZones?: KillZoneType[];
  requireLiquiditySweep?: boolean;
  requirePremiumDiscount?: boolean;
  // OTE (Optimal Trade Entry) settings
  requireOTE?: boolean;
  oteThreshold?: number; // Fib level (0.618, 0.705, 0.786)
  // Entry quality tiers
  minOBScore?: number;
  relaxedScoreThreshold?: number; // Score above which simple touch entry is allowed
  // Risk/Reward modes
  rrMode?: 'fixed' | 'atr_trailing' | 'structure';
  fixedRR?: number;
  atrMultiplier?: number;
  // Position management
  maxConcurrentTrades?: number;
  maxDrawdownPercent?: number;
  maxDailyDrawdownPercent?: number;
  // Session filters
  tradingSessions?: string[];
  useCooldowns?: boolean;
}

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  averageWin: number;
  averageLoss: number;
  averageRR: number;
  totalPnl: number;
  totalPnlPercent: number;
  finalBalance: number;
}

export interface BacktestTrade {
  symbol: string;
  direction: Direction;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  entryTime: Date;
  exitTime: Date;
  pnl: number;
  pnlPercent: number;
  isWinner: boolean;
  exitReason: 'TP' | 'SL' | 'SIGNAL';
}

export interface MultiTimeframeAnalysis {
  htf: {
    timeframe: Timeframe;
    bias: Bias;
    structure: MarketStructure;
    orderBlocks: OrderBlock[];
    liquidityZones: LiquidityZone[];
  };
  mtf: {
    timeframe: Timeframe;
    bias: Bias;
    structure: MarketStructure;
    orderBlocks: OrderBlock[];
    fvgs: FairValueGap[];
    liquidityZones: LiquidityZone[];
  };
  ltf: {
    timeframe: Timeframe;
    bias: Bias;
    structure: MarketStructure;
    fvgs: FairValueGap[];
  };
  confluenceScore: number;
  // SMC Enhancement data
  premiumDiscount?: PremiumDiscountZone;
  recentCHoCH?: CHoCHEvent;
  inducements?: InducementLevel[];
  recentLiquiditySweep?: {
    zone: LiquidityZone;
    sweepTime: Date;
    isReversal: boolean;
  };
}

/**
 * Confirmation candle types for Order Block entries
 */
export type ConfirmationType = 'none' | 'close' | 'strong' | 'engulf';

/**
 * Symbol-specific strategy settings
 */
export interface SymbolStrategySettings {
  /** Symbol name */
  symbol: string;
  /** Whether trading is enabled for this symbol */
  enabled: boolean;
  /** Risk percentage per trade (overrides profile) */
  riskPercent?: number;
  /** Maximum daily drawdown percentage */
  maxDailyDrawdown?: number;
  /** Minimum Order Block score for entry */
  minOBScore?: number;
  /** Confirmation type for entries */
  confirmationType?: ConfirmationType;
}

/**
 * Breakeven configuration for automatic SL management
 */
export interface BreakevenConfig {
  /** Whether breakeven management is enabled */
  enabled: boolean;
  /** Move SL at this R multiple (e.g., 1.0 = 1R profit) */
  triggerR: number;
  /** Lock in this many pips of profit above entry */
  bufferPips: number;
}

/**
 * Tiered take-profit configuration
 * Based on backtest optimization: "TIERED-OTE: 30@1R|30@2R|40@4R"
 * Allows partial position closes at multiple TP levels
 */
export interface TieredTPConfig {
  /** Whether tiered TP is enabled */
  enabled: boolean;
  /** TP1: First partial take-profit level */
  tp1: {
    /** R multiple for TP1 (e.g., 1.0 = 1R) */
    rr: number;
    /** Percentage of position to close at TP1 (e.g., 30 = 30%) */
    percent: number;
  };
  /** TP2: Second partial take-profit level */
  tp2: {
    /** R multiple for TP2 (e.g., 2.0 = 2R) */
    rr: number;
    /** Percentage of position to close at TP2 (e.g., 30 = 30%) */
    percent: number;
  };
  /** TP3: Final take-profit level (remaining position) */
  tp3: {
    /** R multiple for TP3 (e.g., 4.0 = 4R) */
    rr: number;
    /** Percentage of position to close at TP3 (remaining, e.g., 40 = 40%) */
    percent: number;
  };
  /** Whether to move SL to breakeven after TP1 hit */
  moveSlOnTP1: boolean;
  /** Buffer pips for breakeven after TP1 */
  beBufferPips: number;
  /** Whether to move SL to TP1 level after TP2 hit */
  moveSlOnTP2: boolean;
}

/**
 * Predefined tiered TP profiles based on backtest results
 */
export const TIERED_TP_PROFILES: Record<string, TieredTPConfig> = {
  /** Best performer on BTCUSD: aggressive runner */
  'RUNNER': {
    enabled: true,
    tp1: { rr: 1.0, percent: 30 },
    tp2: { rr: 2.0, percent: 30 },
    tp3: { rr: 4.0, percent: 40 },
    moveSlOnTP1: true,
    beBufferPips: 5,
    moveSlOnTP2: true,
  },
  /** Conservative: lock profits fast */
  'CONSERVATIVE': {
    enabled: true,
    tp1: { rr: 0.75, percent: 60 },
    tp2: { rr: 1.5, percent: 25 },
    tp3: { rr: 2.5, percent: 15 },
    moveSlOnTP1: true,
    beBufferPips: 3,
    moveSlOnTP2: false,
  },
  /** Balanced: 50/30/20 split */
  'BALANCED': {
    enabled: true,
    tp1: { rr: 1.0, percent: 50 },
    tp2: { rr: 2.0, percent: 30 },
    tp3: { rr: 3.0, percent: 20 },
    moveSlOnTP1: true,
    beBufferPips: 5,
    moveSlOnTP2: false,
  },
  /** Scalp quick: fast partials at low R (best for XAGUSD.s Feb 2026) */
  'SCALP_QUICK': {
    enabled: true,
    tp1: { rr: 0.5, percent: 50 },
    tp2: { rr: 1.0, percent: 30 },
    tp3: { rr: 1.5, percent: 20 },
    moveSlOnTP1: true,
    beBufferPips: 3,
    moveSlOnTP2: false,
  },
  /** Simple 2-tier: 50/50 */
  'SIMPLE_2TIER': {
    enabled: true,
    tp1: { rr: 1.0, percent: 50 },
    tp2: { rr: 2.0, percent: 50 },
    tp3: { rr: 2.0, percent: 0 }, // Not used
    moveSlOnTP1: true,
    beBufferPips: 3,
    moveSlOnTP2: false,
  },
  /** Disabled (single TP mode) */
  'DISABLED': {
    enabled: false,
    tp1: { rr: 2.0, percent: 100 },
    tp2: { rr: 2.0, percent: 0 },
    tp3: { rr: 2.0, percent: 0 },
    moveSlOnTP1: false,
    beBufferPips: 0,
    moveSlOnTP2: false,
  },
};

export interface BotConfig {
  symbols: string[];
  riskPercent: number;
  htfTimeframe: Timeframe;
  mtfTimeframe: Timeframe;
  ltfTimeframe: Timeframe;
  strategies: StrategyType[];
  maxOpenTrades: number;
  maxTradesPerSymbol: number;
  tradingHours?: {
    start: number;
    end: number;
  };
  /** Selected strategy profile name */
  strategyProfile?: string;
  /** Whether live trading is enabled (false = paper mode) */
  liveTrading?: boolean;
  /** Use kill zones filter */
  useKillZones?: boolean;
  /** Allowed kill zones if filter is enabled */
  killZones?: KillZoneType[];
  /** Fixed risk:reward ratio */
  riskReward?: number;
  /** Minimum Order Block score */
  minOBScore?: number;
  /** Confirmation type for entries */
  confirmationType?: ConfirmationType;
  /** Maximum daily drawdown percentage */
  maxDailyDrawdown?: number;
  /** Per-symbol settings */
  symbolSettings?: SymbolStrategySettings[];
  /** Breakeven configuration */
  breakeven?: BreakevenConfig;
  /** Tiered take-profit configuration */
  tieredTP?: TieredTPConfig;
  /** Whether automated SMC signal analysis and execution is enabled (default: true).
   *  When false, the bot still runs for position monitoring, BE, tiered TP, and Telegram trade execution. */
  autoTrading?: boolean;
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  symbols: ['XAUUSD.s', 'XAGUSD.s', 'BTCUSD', 'ETHUSD'],
  riskPercent: 0.5,
  htfTimeframe: 'H1',
  mtfTimeframe: 'M15',
  ltfTimeframe: 'M1',
  strategies: ['ORDER_BLOCK', 'LIQUIDITY_SWEEP', 'BOS', 'FBO_CLASSIC', 'FBO_SWEEP', 'FBO_STRUCTURE', 'M1_TREND'],
  maxOpenTrades: 5,
  maxTradesPerSymbol: 1,
  // Updated Feb 2026: align with backtest-optimal profiles
  strategyProfile: 'BTC_OPTIMAL',
  liveTrading: false, // Paper mode by default
  useKillZones: false, // All-session outperforms KZ in backtests
  killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
  riskReward: 2,
  minOBScore: 70,
  confirmationType: 'none', // NoConf dominates across all symbols
  maxDailyDrawdown: 8,
  // Breakeven: Move SL to entry + 5 pips when position reaches 1R profit
  breakeven: {
    enabled: false, // Disabled when using tiered TP (tiered TP handles BE)
    triggerR: 1.0,
    bufferPips: 5,
  },
  // Tiered TP: RUNNER profile (optimal for BTCUSD based on Jan 2026 backtests)
  // 30% at 1R, 30% at 2R, 40% at 4R with SL management
  tieredTP: {
    enabled: true,
    tp1: { rr: 1.0, percent: 30 },
    tp2: { rr: 2.0, percent: 30 },
    tp3: { rr: 4.0, percent: 40 },
    moveSlOnTP1: true,
    beBufferPips: 5,
    moveSlOnTP2: true,
  },
  autoTrading: true,
};

// MetaAPI timeframe mapping
export const TIMEFRAME_MAP: Record<Timeframe, string> = {
  M1: '1m',
  M5: '5m',
  M15: '15m',
  M30: '30m',
  H1: '1h',
  H4: '4h',
  D1: '1d',
  W1: '1w',
};

// Reverse mapping
export const TIMEFRAME_REVERSE_MAP: Record<string, Timeframe> = {
  '1m': 'M1',
  '5m': 'M5',
  '15m': 'M15',
  '30m': 'M30',
  '1h': 'H1',
  '4h': 'H4',
  '1d': 'D1',
  '1w': 'W1',
};

// Timeframe in minutes for calculations
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440,
  W1: 10080,
};
