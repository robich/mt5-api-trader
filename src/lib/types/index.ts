// Core trading types for the SMC Trading Bot

export type Direction = 'BUY' | 'SELL';
export type Bias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1';
export type StrategyType = 'ORDER_BLOCK' | 'LIQUIDITY_SWEEP' | 'BOS' | 'FBO_CLASSIC' | 'FBO_SWEEP' | 'FBO_STRUCTURE' | 'EXTERNAL';
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
  maxSlPips?: number;
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
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  symbols: ['XAUUSD.s', 'XAGUSD.s', 'BTCUSD', 'ETHUSD'],
  riskPercent: 2,
  htfTimeframe: 'H4',
  mtfTimeframe: 'H1',
  ltfTimeframe: 'M15',
  strategies: ['ORDER_BLOCK', 'LIQUIDITY_SWEEP', 'BOS', 'FBO_CLASSIC', 'FBO_SWEEP', 'FBO_STRUCTURE'],
  maxOpenTrades: 5,
  maxTradesPerSymbol: 1,
  // Default to balanced profile settings
  strategyProfile: 'BALANCED_STRONG',
  liveTrading: false, // Paper mode by default
  useKillZones: true,
  killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'],
  riskReward: 2,
  minOBScore: 70,
  confirmationType: 'strong',
  maxDailyDrawdown: 6,
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
