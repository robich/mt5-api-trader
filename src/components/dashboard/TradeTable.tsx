'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Trade {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  strategy: string;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lotSize: number | null;
  openTime: string;
  closeTime?: string | null;
  closePrice?: number | null;
  pnl?: number | null;
  pnlPercent?: number | null;
  status: string;
  currentPnl?: number | null;
  currentPrice?: number | null;
}

interface TradeTableProps {
  trades: Trade[];
  type: 'open' | 'closed';
  currency?: string;
}

// Strategy descriptions and parameters
const STRATEGY_INFO: Record<string, {
  name: string;
  description: string;
  parameters: { name: string; value: string; description: string }[];
  howItWorks: string[];
}> = {
  ORDER_BLOCK: {
    name: 'Order Block',
    description: 'Identifies institutional order blocks - areas where large players have placed significant orders, creating strong support/resistance zones.',
    parameters: [
      { name: 'Min OB Score', value: '70', description: 'Minimum quality score (0-100) for order block validation' },
      { name: 'ATR Multiplier', value: '1.0-1.5', description: 'Multiplier for ATR-based OB size filtering' },
      { name: 'Confirmation', value: 'None', description: 'Entry on touch (NoConf performs best)' },
      { name: 'Risk:Reward', value: '1.5-2.0', description: 'Fixed R:R ratio for take profit' },
    ],
    howItWorks: [
      '1. Identifies the last bearish candle before a bullish move (bullish OB) or vice versa',
      '2. Validates OB with volume, size, and structural criteria',
      '3. Waits for price to return to OB zone',
      '4. Enters when price touches the OB (50% level)',
      '5. SL below/above OB, TP at fixed R:R ratio',
    ],
  },
  LIQUIDITY_SWEEP: {
    name: 'Liquidity Sweep',
    description: 'Detects false breakouts where price sweeps liquidity (stop losses) at swing highs/lows before reversing.',
    parameters: [
      { name: 'Sweep Threshold', value: '0.1%', description: 'Minimum price extension beyond swing point' },
      { name: 'Reversal Candles', value: '1-3', description: 'Number of candles to confirm reversal' },
      { name: 'Risk:Reward', value: '2.0', description: 'Fixed R:R ratio for take profit' },
    ],
    howItWorks: [
      '1. Identifies swing highs/lows (liquidity pools)',
      '2. Waits for price to break beyond the swing point',
      '3. Confirms the sweep with rejection/reversal candle',
      '4. Enters in the reversal direction',
      '5. SL beyond the sweep wick, TP at previous structure',
    ],
  },
  BOS: {
    name: 'Break of Structure',
    description: 'Trades break of market structure - when price breaks a significant swing high/low indicating trend continuation or reversal.',
    parameters: [
      { name: 'Structure Lookback', value: '20 candles', description: 'Period to identify swing points' },
      { name: 'Confirmation', value: 'Close', description: 'Requires candle close beyond structure' },
      { name: 'Risk:Reward', value: '2.0', description: 'Fixed R:R ratio for take profit' },
    ],
    howItWorks: [
      '1. Maps market structure (higher highs/lows or lower highs/lows)',
      '2. Identifies key structural levels',
      '3. Waits for price to break and close beyond structure',
      '4. Enters on pullback to broken structure',
      '5. SL at the swing that created the BOS',
    ],
  },
  FBO_CLASSIC: {
    name: 'Failed Breakout Classic',
    description: 'Trades failed breakouts at horizontal support/resistance levels when price fails to hold beyond key levels.',
    parameters: [
      { name: 'Level Touches', value: '2+', description: 'Minimum touches to validate S/R level' },
      { name: 'Breakout Threshold', value: '0.05%', description: 'Minimum break beyond level' },
      { name: 'Risk:Reward', value: '2.0', description: 'Fixed R:R ratio for take profit' },
    ],
    howItWorks: [
      '1. Identifies horizontal support/resistance with multiple touches',
      '2. Waits for price to break the level',
      '3. Confirms failure with rejection back inside range',
      '4. Enters in the reversal direction',
      '5. SL beyond the failed breakout, TP at opposite S/R',
    ],
  },
  FBO_SWEEP: {
    name: 'Failed Breakout Sweep',
    description: 'Combines failed breakout with liquidity sweep concept - trades when price sweeps a level and fails.',
    parameters: [
      { name: 'Sweep Distance', value: 'ATR-based', description: 'How far price must sweep beyond level' },
      { name: 'Reversal Speed', value: '1-3 candles', description: 'Quick reversal required' },
      { name: 'Risk:Reward', value: '2.0', description: 'Fixed R:R ratio for take profit' },
    ],
    howItWorks: [
      '1. Identifies liquidity zones (clusters of swing points)',
      '2. Waits for aggressive sweep through the zone',
      '3. Confirms with strong rejection candle',
      '4. Enters on the sweep reversal',
      '5. SL beyond sweep high/low, TP at origin of move',
    ],
  },
  FBO_STRUCTURE: {
    name: 'Failed Breakout Structure',
    description: 'Trades failed breaks of market structure - when BOS fails and price returns, indicating trapped traders.',
    parameters: [
      { name: 'Structure Break', value: 'Candle close', description: 'Initial BOS confirmation' },
      { name: 'Failure Window', value: '5 candles', description: 'Time for failure to occur' },
      { name: 'Risk:Reward', value: '2.0', description: 'Fixed R:R ratio for take profit' },
    ],
    howItWorks: [
      '1. Identifies a break of structure (BOS)',
      '2. Monitors for failure to continue in BOS direction',
      '3. Confirms failure with return inside previous structure',
      '4. Enters against the failed BOS',
      '5. SL at the failed BOS extreme, TP at key structure',
    ],
  },
  EXTERNAL: {
    name: 'Telegram Signal',
    description: 'Trade executed from a Telegram signal channel. Analyzed by AI and automatically placed with risk management.',
    parameters: [
      { name: 'Source', value: 'Telegram', description: 'Signal received from Telegram channel' },
      { name: 'Analysis', value: 'AI', description: 'Signal analyzed and validated by AI before execution' },
      { name: 'Execution', value: 'Auto', description: 'Automatically executed with position sizing and SL/TP' },
    ],
    howItWorks: [
      '1. Signal received from Telegram trading channel',
      '2. AI analyzes signal quality, direction, and levels',
      '3. Risk management calculates position size',
      '4. Trade executed on MT5 with SL/TP',
      '5. Monitored with tiered TP and breakeven management',
    ],
  },
};

// Whether a strategy is a Telegram/external signal trade
const isTelegramTrade = (strategy: string) => strategy === 'EXTERNAL';

// Small icon for trade source (inline SVG to avoid extra dependencies)
function TradeSourceIcon({ strategy }: { strategy: string }) {
  if (isTelegramTrade(strategy)) {
    // Signal/antenna icon for Telegram trades
    return (
      <svg className="h-3 w-3 text-indigo-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12 L7 2" /><path d="M7 2 L12 12" /><path d="M12 12 L17 2" /><path d="M17 2 L22 12" /><line x1="12" y1="12" x2="12" y2="22" />
      </svg>
    );
  }
  // Bot/cog icon for automated SMC trades
  return (
    <svg className="h-3 w-3 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="3" /><line x1="12" y1="8" x2="12" y2="11" /><line x1="8" y1="16" x2="8" y2="16.01" /><line x1="16" y1="16" x2="16" y2="16.01" />
    </svg>
  );
}

// Strategy badge with source-specific styling
function StrategyBadge({ strategy, onClick }: { strategy: string; onClick: () => void }) {
  const telegram = isTelegramTrade(strategy);
  const label = telegram ? 'Telegram Signal' : strategy.replace(/_/g, ' ');

  return (
    <div className="flex items-center gap-1">
      <TradeSourceIcon strategy={strategy} />
      <Badge
        variant={telegram ? 'default' : 'outline'}
        className={`text-xs cursor-pointer hover:bg-accent ${
          telegram ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : ''
        }`}
        onClick={onClick}
      >
        {label}
      </Badge>
    </div>
  );
}

export function TradeTable({ trades, type, currency = 'USD' }: TradeTableProps) {
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);

  const formatPnl = (value: number | null | undefined) => {
    if (value == null) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPrice = (price: number | null | undefined, symbol: string) => {
    if (price == null) return '-';
    const decimals = symbol.includes('JPY') ? 3 : symbol.includes('XAU') ? 2 : symbol.includes('BTC') ? 2 : 5;
    return price.toFixed(decimals);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (openTime: string, closeTime?: string | null) => {
    const start = new Date(openTime).getTime();
    const end = closeTime ? new Date(closeTime).getTime() : Date.now();
    const diffMs = end - start;

    if (diffMs < 0) return '-';

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m`;
    }
    return `${seconds}s`;
  };

  const calculatePips = (trade: Trade, isOpen: boolean) => {
    const entryPrice = trade.entryPrice;

    if (entryPrice == null) return null;

    // For open trades, use currentPrice if available
    if (isOpen) {
      if (trade.currentPrice != null) {
        const pipMultiplier = getPipMultiplier(trade.symbol);
        const diff = trade.direction === 'BUY'
          ? (trade.currentPrice - entryPrice)
          : (entryPrice - trade.currentPrice);
        return diff * pipMultiplier;
      }
      // Fallback: estimate pips from PnL if available
      if (trade.currentPnl != null && trade.lotSize != null && trade.lotSize > 0) {
        const pipValue = getPipValue(trade.symbol, trade.lotSize);
        if (pipValue > 0) {
          return trade.currentPnl / pipValue;
        }
      }
      return null;
    }

    // For closed trades, calculate actual pips from entry to exit
    if (trade.closePrice != null) {
      const pipMultiplier = getPipMultiplier(trade.symbol);
      const diff = trade.direction === 'BUY'
        ? (trade.closePrice - entryPrice)
        : (entryPrice - trade.closePrice);
      return diff * pipMultiplier;
    }

    return null;
  };

  const getPipMultiplier = (symbol: string) => {
    if (symbol.includes('JPY')) return 100; // 2 decimal places
    if (symbol.includes('XAU')) return 10; // Gold: 1 pip = 0.1
    if (symbol.includes('XAG')) return 100; // Silver: 1 pip = 0.01
    if (symbol.includes('BTC') || symbol.includes('ETH')) return 1; // BTC/ETH: 1 pip = 1.0
    return 10000; // Standard forex: 4 decimal places
  };

  const getPipValue = (symbol: string, lotSize: number) => {
    // Approximate pip value per standard lot
    if (symbol.includes('XAU')) return lotSize * 10; // Gold ~$10 per pip per lot
    if (symbol.includes('XAG')) return lotSize * 50; // Silver ~$50 per pip per lot
    if (symbol.includes('BTC') || symbol.includes('ETH')) return lotSize * 1; // BTC/ETH varies significantly
    return lotSize * 10; // Standard forex ~$10 per pip per standard lot
  };

  const formatPips = (pips: number | null) => {
    if (pips == null) return '-';
    const sign = pips >= 0 ? '+' : '';
    return `${sign}${pips.toFixed(1)}`;
  };

  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No {type} trades
      </div>
    );
  }

  return (
    <>
      {/* Mobile card layout */}
      <div className="md:hidden">
        <ScrollArea className="h-[400px]">
          <div className="space-y-3 p-1">
            {trades.map((trade) => {
              const pnlValue = type === 'open' ? trade.currentPnl : trade.pnl;
              const pips = calculatePips(trade, type === 'open');
              const exitPrice = type === 'open' ? trade.currentPrice : trade.closePrice;

              return (
                <div key={trade.id} className="border rounded-lg p-3 space-y-2">
                  {/* Row 1: Symbol + Direction + P&L */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{trade.symbol}</span>
                      <Badge
                        variant={trade.direction === 'BUY' ? 'default' : 'destructive'}
                        className="text-xs"
                      >
                        {trade.direction}
                      </Badge>
                    </div>
                    <span
                      className={`font-bold text-sm ${
                        (pnlValue || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {formatPnl(pnlValue)}
                    </span>
                  </div>

                  {/* Row 2: Entry → Exit/Current, Pips */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono">
                      {formatPrice(trade.entryPrice, trade.symbol)}
                      {' → '}
                      {exitPrice != null ? formatPrice(exitPrice, trade.symbol) : '-'}
                    </span>
                    <span
                      className={`font-mono ${
                        (pips || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {formatPips(pips)} pips
                    </span>
                  </div>

                  {/* Row 3: Strategy, Lot, Duration */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <StrategyBadge
                        strategy={trade.strategy}
                        onClick={() => setSelectedStrategy(trade.strategy)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {trade.lotSize ?? '-'} lot
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(trade.openTime, type === 'closed' ? trade.closeTime : null)}
                    </span>
                  </div>

                  {/* Expandable SL/TP */}
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer hover:text-foreground">SL / TP</summary>
                    <div className="flex gap-4 mt-1 pl-1">
                      <span>SL: <span className="font-mono text-red-600">{formatPrice(trade.stopLoss, trade.symbol)}</span></span>
                      <span>TP: <span className="font-mono text-green-600">{formatPrice(trade.takeProfit, trade.symbol)}</span></span>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>

          {/* Total unrealized P&L card for open trades (mobile) */}
          {type === 'open' && trades.some((t) => t.currentPnl != null) && (
            <div className="border-t-2 mt-3 pt-3 px-1 flex items-center justify-between">
              <span className="text-sm font-semibold">Total Unrealized P&L</span>
              <div className="text-right">
                <span className="text-xs text-muted-foreground mr-2 font-mono">
                  {formatPips(trades.reduce((sum, t) => sum + (calculatePips(t, true) || 0), 0))} pips
                </span>
                <span
                  className={`font-bold text-sm ${
                    trades.reduce((sum, t) => sum + (t.currentPnl || 0), 0) >= 0
                      ? 'text-green-600'
                      : 'text-red-600'
                  }`}
                >
                  {formatPnl(trades.reduce((sum, t) => sum + (t.currentPnl || 0), 0))}
                </span>
              </div>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Desktop table layout */}
      <ScrollArea className="h-[400px] hidden md:block">
        <div className="min-w-max">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Strategy</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">SL</TableHead>
              <TableHead className="text-right">TP</TableHead>
              <TableHead className="text-right">Size</TableHead>
              {type === 'open' && (
                <TableHead className="text-right">Current</TableHead>
              )}
              <TableHead>{type === 'open' ? 'Opened' : 'Closed'}</TableHead>
              <TableHead>Duration</TableHead>
              {type === 'closed' && (
                <TableHead className="text-right">Exit</TableHead>
              )}
              <TableHead className="text-right">Pips</TableHead>
              <TableHead className="text-right">P&L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((trade) => (
              <TableRow key={trade.id}>
                <TableCell className="font-medium">{trade.symbol}</TableCell>
                <TableCell>
                  <Badge
                    variant={trade.direction === 'BUY' ? 'default' : 'destructive'}
                  >
                    {trade.direction}
                  </Badge>
                </TableCell>
                <TableCell>
                  <StrategyBadge
                    strategy={trade.strategy}
                    onClick={() => setSelectedStrategy(trade.strategy)}
                  />
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatPrice(trade.entryPrice, trade.symbol)}
                </TableCell>
                <TableCell className="text-right font-mono text-red-600">
                  {formatPrice(trade.stopLoss, trade.symbol)}
                </TableCell>
                <TableCell className="text-right font-mono text-green-600">
                  {formatPrice(trade.takeProfit, trade.symbol)}
                </TableCell>
                <TableCell className="text-right">{trade.lotSize ?? '-'}</TableCell>
                {type === 'open' && (
                  <TableCell className="text-right font-mono">
                    {trade.currentPrice != null
                      ? formatPrice(trade.currentPrice, trade.symbol)
                      : '-'}
                  </TableCell>
                )}
                <TableCell>
                  {formatDate(type === 'open' ? trade.openTime : trade.closeTime || trade.openTime)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDuration(trade.openTime, type === 'closed' ? trade.closeTime : null)}
                </TableCell>
                {type === 'closed' && (
                  <TableCell className="text-right font-mono">
                    {trade.closePrice ? formatPrice(trade.closePrice, trade.symbol) : '-'}
                  </TableCell>
                )}
                <TableCell
                  className={`text-right font-mono ${
                    (calculatePips(trade, type === 'open') || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {formatPips(calculatePips(trade, type === 'open'))}
                </TableCell>
                <TableCell
                  className={`text-right font-bold ${
                    ((type === 'open' ? trade.currentPnl : trade.pnl) || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {type === 'open'
                    ? formatPnl(trade.currentPnl)
                    : formatPnl(trade.pnl)}
                </TableCell>
              </TableRow>
            ))}
            {/* Total unrealized P&L row for open trades */}
            {type === 'open' && trades.some((t) => t.currentPnl != null) && (
              <TableRow className="border-t-2">
                <TableCell colSpan={7} className="text-right font-semibold text-sm">
                  Total Unrealized P&L
                </TableCell>
                {/* Current column */}
                <TableCell />
                {/* Opened column */}
                <TableCell />
                {/* Duration column */}
                <TableCell />
                {/* Pips column */}
                <TableCell className="text-right font-mono font-semibold">
                  {(() => {
                    const totalPips = trades.reduce((sum, t) => {
                      const pips = calculatePips(t, true);
                      return sum + (pips || 0);
                    }, 0);
                    return formatPips(totalPips);
                  })()}
                </TableCell>
                <TableCell
                  className={`text-right font-bold ${
                    trades.reduce((sum, t) => sum + (t.currentPnl || 0), 0) >= 0
                      ? 'text-green-600'
                      : 'text-red-600'
                  }`}
                >
                  {formatPnl(trades.reduce((sum, t) => sum + (t.currentPnl || 0), 0))}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Strategy Info Dialog */}
      <Dialog open={selectedStrategy !== null} onOpenChange={(open) => !open && setSelectedStrategy(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedStrategy && STRATEGY_INFO[selectedStrategy]?.name || selectedStrategy?.replace(/_/g, ' ')}
            </DialogTitle>
            <DialogDescription>
              {selectedStrategy && STRATEGY_INFO[selectedStrategy]?.description || 'Strategy information not available.'}
            </DialogDescription>
          </DialogHeader>

          {selectedStrategy && STRATEGY_INFO[selectedStrategy] && (
            <div className="space-y-4">
              {/* Parameters */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Parameters</h4>
                <div className="space-y-2">
                  {STRATEGY_INFO[selectedStrategy].parameters.map((param, idx) => (
                    <div key={idx} className="flex justify-between items-start text-sm">
                      <div>
                        <span className="font-medium">{param.name}</span>
                        <p className="text-xs text-muted-foreground">{param.description}</p>
                      </div>
                      <span className="text-primary font-mono ml-2">{param.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* How It Works */}
              <div>
                <h4 className="text-sm font-semibold mb-2">How It Works</h4>
                <ol className="space-y-1 text-sm text-muted-foreground">
                  {STRATEGY_INFO[selectedStrategy].howItWorks.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
