'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import Link from 'next/link';
import { ArrowLeft, Play, Download, TrendingUp, TrendingDown, Activity, BarChart3, Eye } from 'lucide-react';
import { BacktestTradeChart } from '@/components/dashboard/BacktestTradeChart';
import { Separator } from '@/components/ui/separator';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';

interface BacktestResult {
  id: string;
  strategy: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialBalance: number;
  finalBalance: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  averageWin: number;
  averageLoss: number;
  averageRR: number;
  totalPnl: number;
  totalPnlPct: number;
  trades: any[];
}

interface BacktestProgressData {
  phase: string;
  progress: number;
  message: string;
  candlesProcessed?: number;
  totalCandles?: number;
  currentDate?: string;
  tradesExecuted?: number;
  winningTrades?: number;
  losingTrades?: number;
  currentBalance?: number;
  totalPnl?: number;
  winRate?: number;
  profitFactor?: number;
  maxDrawdown?: number;
  lastTradeDirection?: 'BUY' | 'SELL';
  lastTradeResult?: 'WIN' | 'LOSS';
}

const DEFAULT_SYMBOLS = ['XAUUSD', 'BTCUSD', 'XAGUSD.s'];

// Estimation constants
const CANDLES_PER_DAY_H1 = 24;
const CANDLES_PER_DAY_TICK = 1440; // ~1 per minute average
const PROCESSING_RATE_CANDLES_PER_SEC = 500;
const PROCESSING_RATE_TICKS_PER_SEC = 100;
const API_COST_PER_1000_CANDLES = 0.001; // Estimated MetaAPI cost

const AVAILABLE_STRATEGIES = [
  { value: 'ORDER_BLOCK', label: 'Order Block + FVG' },
  { value: 'LIQUIDITY_SWEEP', label: 'Liquidity Sweep' },
  { value: 'BOS', label: 'Break of Structure' },
  { value: 'FBO_CLASSIC', label: 'FBO Classic' },
  { value: 'FBO_SWEEP', label: 'FBO Sweep' },
  { value: 'FBO_STRUCTURE', label: 'FBO Structure' },
];

// Helper to format numbers with apostrophe separator (e.g., 7'900.04)
const formatNumber = (num: number, decimals = 2) => {
  const fixed = num.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return decPart ? `${formatted}.${decPart}` : formatted;
};

// Format currency in EUR
const formatEUR = (num: number, decimals = 2) => `${formatNumber(num, decimals)} €`;

export default function BacktestPage() {
  const [isRunning, setIsRunning] = useState(false);
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>(['ORDER_BLOCK']);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [loadingSymbols, setLoadingSymbols] = useState(true);
  const [currentSymbolIndex, setCurrentSymbolIndex] = useState(0);
  const [currentStrategyIndex, setCurrentStrategyIndex] = useState(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [lastDays, setLastDays] = useState('10');
  const [initialBalance, setInitialBalance] = useState('10000');
  const [riskPercent, setRiskPercent] = useState('2');
  const [useTickData, setUseTickData] = useState(false);
  // SMC Enhancement options
  const [useKillZones, setUseKillZones] = useState(false);
  const [requireLiquiditySweep, setRequireLiquiditySweep] = useState(false);
  const [requirePremiumDiscount, setRequirePremiumDiscount] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [equityCurve, setEquityCurve] = useState<any[]>([]);
  const [drawdownCurve, setDrawdownCurve] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pastResults, setPastResults] = useState<BacktestResult[]>([]);
  const [progress, setProgress] = useState<BacktestProgressData | null>(null);

  // Calculate estimation based on parameters
  const estimation = useMemo(() => {
    if (!startDate || !endDate || selectedSymbols.length === 0 || selectedStrategies.length === 0) {
      return null;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    if (days <= 0) return null;

    const candlesPerDay = useTickData ? CANDLES_PER_DAY_TICK : CANDLES_PER_DAY_H1;
    const processingRate = useTickData ? PROCESSING_RATE_TICKS_PER_SEC : PROCESSING_RATE_CANDLES_PER_SEC;

    // Account for both strategies and symbols
    const totalCombinations = selectedStrategies.length * selectedSymbols.length;
    const totalCandles = days * candlesPerDay * totalCombinations;
    const estimatedSeconds = totalCandles / processingRate;
    const estimatedCost = (totalCandles / 1000) * API_COST_PER_1000_CANDLES;

    // Format time
    let timeStr: string;
    if (estimatedSeconds < 60) {
      timeStr = `~${Math.ceil(estimatedSeconds)}s`;
    } else if (estimatedSeconds < 3600) {
      const mins = Math.ceil(estimatedSeconds / 60);
      timeStr = `~${mins}min`;
    } else {
      const hours = Math.floor(estimatedSeconds / 3600);
      const mins = Math.ceil((estimatedSeconds % 3600) / 60);
      timeStr = `~${hours}h ${mins}min`;
    }

    return {
      days,
      totalCandles,
      totalCombinations,
      timeStr,
      estimatedCost: estimatedCost.toFixed(4),
    };
  }, [startDate, endDate, selectedSymbols.length, selectedStrategies.length, useTickData]);

  // Update dates based on lastDays
  const updateDatesFromDays = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setEndDate(end.toISOString().split('T')[0]);
    setStartDate(start.toISOString().split('T')[0]);
  };

  // Handle lastDays change
  const handleLastDaysChange = (value: string) => {
    setLastDays(value);
    const days = parseInt(value, 10);
    if (!isNaN(days) && days > 0) {
      updateDatesFromDays(days);
    }
  };

  // Handle manual date change - update lastDays to reflect the range
  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    if (value && endDate) {
      const start = new Date(value);
      const end = new Date(endDate);
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if (days > 0) {
        setLastDays(days.toString());
      }
    }
  };

  const handleEndDateChange = (value: string) => {
    setEndDate(value);
    if (startDate && value) {
      const start = new Date(startDate);
      const end = new Date(value);
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if (days > 0) {
        setLastDays(days.toString());
      }
    }
  };

  // Fetch available symbols and set default dates
  useEffect(() => {
    // Set default dates based on lastDays
    updateDatesFromDays(parseInt(lastDays, 10) || 10);

    // Fetch past results
    fetchPastResults();

    // Fetch available symbols from broker
    fetchSymbols();
  }, []);

  const fetchSymbols = async () => {
    setLoadingSymbols(true);
    try {
      const res = await fetch('/api/symbols');
      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }
      const data = await res.json();
      if (data.symbols && data.symbols.length > 0) {
        // Sort symbols so defaults appear at the top
        const sortedSymbols = [...data.symbols].sort((a: string, b: string) => {
          const aUpper = a.toUpperCase();
          const bUpper = b.toUpperCase();
          const aIsDefault = DEFAULT_SYMBOLS.some(d => aUpper.includes(d));
          const bIsDefault = DEFAULT_SYMBOLS.some(d => bUpper.includes(d));
          if (aIsDefault && !bIsDefault) return -1;
          if (!aIsDefault && bIsDefault) return 1;
          // Sort defaults in the order: XAUUSD, BTCUSD, XAGUSD
          if (aIsDefault && bIsDefault) {
            const aIndex = DEFAULT_SYMBOLS.findIndex(d => aUpper.includes(d));
            const bIndex = DEFAULT_SYMBOLS.findIndex(d => bUpper.includes(d));
            return aIndex - bIndex;
          }
          return a.localeCompare(b);
        });
        setAvailableSymbols(sortedSymbols);
        // Auto-select default symbols
        const matchedSymbols: string[] = [];
        for (const defaultSym of DEFAULT_SYMBOLS) {
          // First try exact match
          let match = sortedSymbols.find((s: string) =>
            s.toUpperCase() === defaultSym
          );
          // If no exact match, try .s suffix (preferred for trading)
          if (!match) {
            match = sortedSymbols.find((s: string) =>
              s.toUpperCase() === `${defaultSym}.S`
            );
          }
          // If no .s match, try any partial match (e.g., XAUUSDm contains XAUUSD)
          if (!match) {
            match = sortedSymbols.find((s: string) =>
              s.toUpperCase().includes(defaultSym)
            );
          }
          // If still no match, try alternative names for metals
          if (!match) {
            match = sortedSymbols.find((s: string) =>
              (defaultSym === 'XAUUSD' && s.toUpperCase().includes('GOLD')) ||
              (defaultSym === 'XAGUSD' && s.toUpperCase().includes('SILVER'))
            );
          }
          if (match && !matchedSymbols.includes(match)) {
            matchedSymbols.push(match);
          }
        }
        setSelectedSymbols(matchedSymbols.length > 0 ? matchedSymbols : sortedSymbols.slice(0, 3));
      } else {
        throw new Error('No symbols returned from API');
      }
    } catch (err) {
      console.error('Error fetching symbols:', err);
      // Fallback to common symbols so the button is not permanently disabled
      const fallbackSymbols = ['XAUUSD', 'BTCUSD', 'XAGUSD.s', 'EURUSD'];
      setAvailableSymbols(fallbackSymbols);
      setSelectedSymbols(fallbackSymbols.slice(0, 3));
    } finally {
      setLoadingSymbols(false);
    }
  };

  const toggleSymbol = (sym: string) => {
    setSelectedSymbols((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
    );
  };

  const toggleStrategy = (strat: string) => {
    setSelectedStrategies((prev) =>
      prev.includes(strat) ? prev.filter((s) => s !== strat) : [...prev, strat]
    );
  };

  const fetchPastResults = async () => {
    try {
      const res = await fetch('/api/backtest?limit=50');
      if (res.ok) {
        const data = await res.json();
        setPastResults(data.results);
      }
    } catch (err) {
      console.error('Error fetching past results:', err);
    }
  };

  const runBacktestForSymbolAndStrategy = async (
    symbol: string,
    strategy: string,
    combinationIndex: number,
    totalCombinations: number
  ): Promise<boolean> => {
    try {
      const response = await fetch('/api/backtest/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy,
          symbol,
          startDate,
          endDate,
          initialBalance: parseFloat(initialBalance),
          riskPercent: parseFloat(riskPercent),
          useTickData,
          // SMC Enhancement options
          useKillZones,
          killZones: useKillZones ? ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'] : undefined,
          requireLiquiditySweep,
          requirePremiumDiscount,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Backtest failed');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (eventType === 'progress') {
              // Adjust progress to account for multiple combinations
              const baseProgress = (combinationIndex / totalCombinations) * 100;
              const combinationProgress = (data.progress / 100) * (100 / totalCombinations);
              const strategyLabel = AVAILABLE_STRATEGIES.find(s => s.value === strategy)?.label || strategy;
              setProgress({
                phase: data.phase,
                progress: Math.round(baseProgress + combinationProgress),
                message: `[${strategyLabel} - ${symbol}] ${data.message}`,
                candlesProcessed: data.candlesProcessed,
                totalCandles: data.totalCandles,
                currentDate: data.currentDate,
                // Trading KPIs
                tradesExecuted: data.tradesExecuted ?? 0,
                winningTrades: data.winningTrades ?? 0,
                losingTrades: data.losingTrades ?? 0,
                currentBalance: data.currentBalance,
                totalPnl: data.totalPnl ?? 0,
                winRate: data.winRate ?? 0,
                profitFactor: data.profitFactor ?? 0,
                maxDrawdown: data.maxDrawdown ?? 0,
                lastTradeDirection: data.lastTradeDirection,
                lastTradeResult: data.lastTradeResult,
              });
            } else if (eventType === 'complete') {
              setResult(data.result);
              setEquityCurve(
                data.equityCurve.map((p: any) => ({
                  date: new Date(p.date).toLocaleDateString(),
                  equity: p.equity,
                }))
              );
              setDrawdownCurve(
                data.drawdownCurve.map((p: any) => ({
                  date: new Date(p.date).toLocaleDateString(),
                  drawdown: p.drawdown,
                }))
              );
              // Refresh past results table immediately when a backtest completes
              fetchPastResults();
            } else if (eventType === 'error') {
              throw new Error(data.error);
            }
          }
        }
      }
      return true;
    } catch (err: any) {
      console.error(`Backtest failed for ${symbol}:`, err.message);
      return false;
    }
  };

  const runBacktest = async () => {
    if (selectedSymbols.length === 0) {
      setError('Please select at least one symbol');
      return;
    }

    if (selectedStrategies.length === 0) {
      setError('Please select at least one strategy');
      return;
    }

    setIsRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    setCurrentSymbolIndex(0);
    setCurrentStrategyIndex(0);

    let successCount = 0;
    const failedCombinations: string[] = [];

    // Create all combinations of strategies and symbols
    const totalCombinations = selectedStrategies.length * selectedSymbols.length;
    let combinationIndex = 0;

    for (let strategyIdx = 0; strategyIdx < selectedStrategies.length; strategyIdx++) {
      const strategy = selectedStrategies[strategyIdx];
      setCurrentStrategyIndex(strategyIdx);

      for (let symbolIdx = 0; symbolIdx < selectedSymbols.length; symbolIdx++) {
        const symbol = selectedSymbols[symbolIdx];
        setCurrentSymbolIndex(symbolIdx);

        const success = await runBacktestForSymbolAndStrategy(
          symbol,
          strategy,
          combinationIndex,
          totalCombinations
        );

        if (success) {
          successCount++;
        } else {
          const strategyLabel = AVAILABLE_STRATEGIES.find(s => s.value === strategy)?.label || strategy;
          failedCombinations.push(`${strategyLabel} - ${symbol}`);
        }

        combinationIndex++;
      }
    }

    setProgress(null);
    fetchPastResults();

    if (failedCombinations.length > 0) {
      setError(`Backtest failed for: ${failedCombinations.join(', ')}`);
    }

    setIsRunning(false);
  };

  const exportCSV = () => {
    if (!result) return;

    const headers = [
      'Entry Time',
      'Exit Time',
      'Symbol',
      'Direction',
      'Entry Price',
      'Exit Price',
      'SL',
      'TP',
      'Lot Size',
      'P&L',
      'P&L %',
      'Exit Reason',
    ];

    const rows = result.trades.map((t) => [
      t.entryTime,
      t.exitTime,
      t.symbol,
      t.direction,
      t.entryPrice,
      t.exitPrice,
      t.stopLoss,
      t.takeProfit,
      t.lotSize,
      t.pnl,
      t.pnlPercent,
      t.exitReason,
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest_${result.strategy}_${result.symbol}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // Select a past backtest result to view its details
  const selectPastResult = (pastResult: BacktestResult) => {
    // Generate equity curve from trades
    const sortedTrades = [...pastResult.trades].sort(
      (a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime()
    );

    let runningBalance = pastResult.initialBalance;
    const equityPoints: { date: string; equity: number }[] = [
      { date: new Date(pastResult.startDate).toLocaleDateString(), equity: pastResult.initialBalance }
    ];

    sortedTrades.forEach((trade) => {
      runningBalance += trade.pnl;
      equityPoints.push({
        date: new Date(trade.exitTime).toLocaleDateString(),
        equity: runningBalance,
      });
    });

    // Generate drawdown curve
    let peak = pastResult.initialBalance;
    const drawdownPoints = equityPoints.map((point) => {
      if (point.equity > peak) peak = point.equity;
      const drawdown = peak > 0 ? ((peak - point.equity) / peak) * 100 : 0;
      return { date: point.date, drawdown };
    });

    setResult(pastResult);
    setEquityCurve(equityPoints);
    setDrawdownCurve(drawdownPoints);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Strategy Backtesting</h1>
            <p className="text-muted-foreground">
              Test SMC strategies on historical data
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-500 p-4 rounded-lg">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Configuration Panel */}
          <Card>
            <CardHeader>
              <CardTitle>Backtest Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Strategies ({selectedStrategies.length} selected)</Label>
                <div className="border rounded-md p-3 space-y-2">
                  {AVAILABLE_STRATEGIES.map((s) => (
                    <div key={s.value} className="flex items-center space-x-2">
                      <Checkbox
                        id={`strat-${s.value}`}
                        checked={selectedStrategies.includes(s.value)}
                        onCheckedChange={() => toggleStrategy(s.value)}
                      />
                      <Label htmlFor={`strat-${s.value}`} className="text-sm font-normal cursor-pointer">
                        {s.label}
                      </Label>
                    </div>
                  ))}
                </div>
                {selectedStrategies.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedStrategies.map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">
                        {AVAILABLE_STRATEGIES.find(strat => strat.value === s)?.label || s}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Symbols ({selectedSymbols.length} selected)</Label>
                {loadingSymbols ? (
                  <div className="text-sm text-muted-foreground">Loading symbols...</div>
                ) : (
                  <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-2">
                    {availableSymbols.map((s) => (
                      <div key={s} className="flex items-center space-x-2">
                        <Checkbox
                          id={`sym-${s}`}
                          checked={selectedSymbols.includes(s)}
                          onCheckedChange={() => toggleSymbol(s)}
                        />
                        <Label htmlFor={`sym-${s}`} className="text-sm font-normal cursor-pointer">
                          {s}
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
                {selectedSymbols.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedSymbols.map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="lastDays">Last N Days</Label>
                <Input
                  id="lastDays"
                  type="number"
                  min="1"
                  max="365"
                  value={lastDays}
                  onChange={(e) => handleLastDaysChange(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startDate">Start Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate">End Date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => handleEndDateChange(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="balance">Initial Balance</Label>
                  <Input
                    id="balance"
                    type="number"
                    value={initialBalance}
                    onChange={(e) => setInitialBalance(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="risk">Risk %</Label>
                  <Input
                    id="risk"
                    type="number"
                    step="0.5"
                    value={riskPercent}
                    onChange={(e) => setRiskPercent(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="tickData"
                  checked={useTickData}
                  onCheckedChange={(checked) => setUseTickData(checked === true)}
                />
                <Label htmlFor="tickData" className="text-sm">
                  Use tick data (slower, more accurate)
                </Label>
              </div>

              {/* SMC Enhancement Options */}
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs text-muted-foreground">SMC Filters</Label>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="killZones"
                    checked={useKillZones}
                    onCheckedChange={(checked) => setUseKillZones(checked === true)}
                  />
                  <Label htmlFor="killZones" className="text-sm">
                    Kill zones only (London/NY)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="liquiditySweep"
                    checked={requireLiquiditySweep}
                    onCheckedChange={(checked) => setRequireLiquiditySweep(checked === true)}
                  />
                  <Label htmlFor="liquiditySweep" className="text-sm">
                    Require liquidity sweep
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="premiumDiscount"
                    checked={requirePremiumDiscount}
                    onCheckedChange={(checked) => setRequirePremiumDiscount(checked === true)}
                  />
                  <Label htmlFor="premiumDiscount" className="text-sm">
                    Require premium/discount zone
                  </Label>
                </div>
              </div>

              {estimation && (
                <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Estimation</div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Duration:</span>{' '}
                      <span className="font-medium">{estimation.days} days</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Time:</span>{' '}
                      <span className="font-medium">{estimation.timeStr}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Backtests:</span>{' '}
                      <span className="font-medium">{estimation.totalCombinations} runs</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Candles:</span>{' '}
                      <span className="font-medium">{estimation.totalCandles.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cost:</span>{' '}
                      <span className="font-medium">${estimation.estimatedCost}</span>
                    </div>
                  </div>
                </div>
              )}

              <Button
                onClick={runBacktest}
                disabled={isRunning || selectedSymbols.length === 0 || selectedStrategies.length === 0 || loadingSymbols}
                className="w-full"
              >
                {isRunning ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Running Backtest...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Run Backtest
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Results Panel */}
          <div className="lg:col-span-2 space-y-6">
            {result ? (
              <>
                {/* Metrics Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold">
                        {result.totalTrades}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Total Trades
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold text-green-600">
                        {result.winRate.toFixed(1)}%
                      </div>
                      <p className="text-xs text-muted-foreground">Win Rate</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div
                        className={`text-2xl font-bold ${
                          result.totalPnl === 0 ? 'text-muted-foreground' : result.totalPnl > 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {formatEUR(result.totalPnl)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Total P&L
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="text-2xl font-bold">
                        {result.profitFactor.toFixed(2)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Profit Factor
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Detailed Metrics */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Backtest Results</CardTitle>
                    <Button variant="outline" size="sm" onClick={exportCSV}>
                      <Download className="mr-2 h-4 w-4" />
                      Export CSV
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Strategy:</span>
                        <div className="font-semibold">
                          {result.strategy.replace('_', ' ')}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Symbol:</span>
                        <div className="font-semibold">{result.symbol}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Initial Balance:
                        </span>
                        <div className="font-semibold">
                          {formatEUR(result.initialBalance)}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Final Balance:
                        </span>
                        <div className="font-semibold">
                          {formatEUR(result.finalBalance)}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Winning Trades:
                        </span>
                        <div className="font-semibold text-green-600">
                          {result.winningTrades}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Losing Trades:
                        </span>
                        <div className="font-semibold text-red-600">
                          {result.losingTrades}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Max Drawdown:
                        </span>
                        <div className="font-semibold text-red-600">
                          {result.maxDrawdownPct.toFixed(2)}%
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Sharpe Ratio:
                        </span>
                        <div className="font-semibold">
                          {result.sharpeRatio.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Avg Win:</span>
                        <div className="font-semibold text-green-600">
                          {formatEUR(result.averageWin)}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Avg Loss:</span>
                        <div className="font-semibold text-red-600">
                          {formatEUR(result.averageLoss)}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Avg R:R:</span>
                        <div className="font-semibold">
                          {result.averageRR.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Return:
                        </span>
                        <div
                          className={`font-semibold ${
                            result.totalPnlPct >= 0
                              ? 'text-green-600'
                              : 'text-red-600'
                          }`}
                        >
                          {result.totalPnlPct >= 0 ? '+' : ''}
                          {result.totalPnlPct.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Charts */}
                <Tabs defaultValue="chart">
                  <TabsList>
                    <TabsTrigger value="chart">
                      <BarChart3 className="h-4 w-4 mr-2" />
                      Trade Chart
                    </TabsTrigger>
                    <TabsTrigger value="equity">Equity Curve</TabsTrigger>
                    <TabsTrigger value="drawdown">Drawdown</TabsTrigger>
                    <TabsTrigger value="trades">Trade List</TabsTrigger>
                  </TabsList>

                  <TabsContent value="chart">
                    <Card>
                      <CardContent className="pt-6">
                        <BacktestTradeChart
                          trades={result.trades}
                          equityCurve={equityCurve}
                          symbol={result.symbol}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="equity">
                    <Card>
                      <CardContent className="pt-6">
                        <div className="h-[300px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={equityCurve}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis
                                dataKey="date"
                                tick={{ fontSize: 12 }}
                                interval="preserveStartEnd"
                              />
                              <YAxis tick={{ fontSize: 12 }} />
                              <Tooltip />
                              <Area
                                type="monotone"
                                dataKey="equity"
                                stroke="#22c55e"
                                fill="#22c55e"
                                fillOpacity={0.3}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="drawdown">
                    <Card>
                      <CardContent className="pt-6">
                        <div className="h-[300px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={drawdownCurve}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis
                                dataKey="date"
                                tick={{ fontSize: 12 }}
                                interval="preserveStartEnd"
                              />
                              <YAxis tick={{ fontSize: 12 }} />
                              <Tooltip />
                              <Area
                                type="monotone"
                                dataKey="drawdown"
                                stroke="#ef4444"
                                fill="#ef4444"
                                fillOpacity={0.3}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="trades">
                    <Card>
                      <CardContent className="pt-6">
                        <ScrollArea className="h-[500px]">
                          {(() => {
                            // Group trades by day
                            type TradeType = (typeof result.trades)[number];
                            const tradesByDay = result.trades.reduce<Record<string, TradeType[]>>((acc, trade) => {
                              const date = new Date(trade.entryTime).toLocaleDateString('en-US', {
                                weekday: 'short',
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              });
                              if (!acc[date]) acc[date] = [];
                              acc[date].push(trade);
                              return acc;
                            }, {});

                            return Object.entries(tradesByDay).map(([day, dayTrades]) => {
                              const dayPnl = dayTrades.reduce((sum: number, t) => sum + t.pnl, 0);
                              const dayWins = dayTrades.filter(t => t.pnl >= 0).length;
                              const dayLosses = dayTrades.length - dayWins;

                              return (
                                <div key={day} className="mb-6">
                                  <div className="flex items-center justify-between mb-2 pb-2 border-b">
                                    <div className="flex items-center gap-3">
                                      <span className="font-semibold text-sm">{day}</span>
                                      <Badge variant="outline" className="text-xs">
                                        {dayTrades.length} trade{dayTrades.length !== 1 ? 's' : ''}
                                      </Badge>
                                      <span className="text-xs text-muted-foreground">
                                        <span className="text-green-600">{dayWins}W</span>
                                        {' / '}
                                        <span className="text-red-600">{dayLosses}L</span>
                                      </span>
                                    </div>
                                    <span className={`font-bold text-sm ${dayPnl === 0 ? 'text-muted-foreground' : dayPnl > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {dayPnl > 0 ? '+' : ''}{formatEUR(dayPnl)}
                                    </span>
                                  </div>
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="w-[140px]">Entry Time</TableHead>
                                        <TableHead className="w-[140px]">Exit Time</TableHead>
                                        <TableHead>Direction</TableHead>
                                        <TableHead className="text-right">Entry</TableHead>
                                        <TableHead className="text-right">Exit</TableHead>
                                        <TableHead className="text-right">P&L</TableHead>
                                        <TableHead>Reason</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {dayTrades.map((trade, i) => (
                                        <TableRow key={i}>
                                          <TableCell className="text-xs font-mono">
                                            {new Date(trade.entryTime).toLocaleTimeString('en-US', {
                                              hour: '2-digit',
                                              minute: '2-digit',
                                              hour12: false,
                                            })}
                                          </TableCell>
                                          <TableCell className="text-xs font-mono">
                                            {new Date(trade.exitTime).toLocaleTimeString('en-US', {
                                              hour: '2-digit',
                                              minute: '2-digit',
                                              hour12: false,
                                            })}
                                          </TableCell>
                                          <TableCell>
                                            <Badge
                                              variant={trade.direction === 'BUY' ? 'default' : 'destructive'}
                                            >
                                              {trade.direction}
                                            </Badge>
                                          </TableCell>
                                          <TableCell className="text-right font-mono text-xs">
                                            {formatNumber(trade.entryPrice)}
                                          </TableCell>
                                          <TableCell className="text-right font-mono text-xs">
                                            {formatNumber(trade.exitPrice)}
                                          </TableCell>
                                          <TableCell
                                            className={`text-right font-bold ${
                                              trade.pnl === 0 ? 'text-muted-foreground' : trade.pnl > 0 ? 'text-green-600' : 'text-red-600'
                                            }`}
                                          >
                                            {formatEUR(trade.pnl)}
                                          </TableCell>
                                          <TableCell>
                                            <Badge
                                              variant={trade.exitReason === 'TP' ? 'default' : 'destructive'}
                                            >
                                              {trade.exitReason}
                                            </Badge>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              );
                            });
                          })()}
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </>
            ) : progress ? (
              /* Live Progress Panel */
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 animate-pulse text-blue-500" />
                    Backtest in Progress
                    <span className="text-sm font-normal text-muted-foreground ml-2">
                      ({currentStrategyIndex * selectedSymbols.length + currentSymbolIndex + 1}/{selectedStrategies.length * selectedSymbols.length} runs)
                    </span>
                  </CardTitle>
                  {selectedStrategies.length > 1 && (
                    <div className="mt-2">
                      <div className="text-xs text-muted-foreground mb-1">Strategies:</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedStrategies.map((s, i) => (
                          <Badge
                            key={s}
                            variant={i < currentStrategyIndex ? 'default' : i === currentStrategyIndex ? 'secondary' : 'outline'}
                            className={i === currentStrategyIndex ? 'animate-pulse' : ''}
                          >
                            {i < currentStrategyIndex ? '✓ ' : ''}{AVAILABLE_STRATEGIES.find(strat => strat.value === s)?.label || s}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedSymbols.length > 1 && (
                    <div className="mt-2">
                      <div className="text-xs text-muted-foreground mb-1">Symbols:</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedSymbols.map((s, i) => (
                          <Badge
                            key={s}
                            variant={
                              currentStrategyIndex > 0 || i < currentSymbolIndex
                                ? 'default'
                                : i === currentSymbolIndex
                                ? 'secondary'
                                : 'outline'
                            }
                            className={currentStrategyIndex === selectedStrategies.length - 1 && i === currentSymbolIndex ? 'animate-pulse' : ''}
                          >
                            {(currentStrategyIndex > 0 && currentStrategyIndex < selectedStrategies.length - 1) ||
                             (currentStrategyIndex === selectedStrategies.length - 1 && i < currentSymbolIndex) ? '✓ ' : ''}{s}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{progress.message}</span>
                      <span className="font-medium">{progress.progress}%</span>
                    </div>
                    <div className="h-3 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300 ease-out"
                        style={{ width: `${progress.progress}%` }}
                      />
                    </div>
                    {progress.candlesProcessed !== undefined && progress.totalCandles !== undefined && (
                      <p className="text-xs text-muted-foreground">
                        Processed {progress.candlesProcessed.toLocaleString()} / {progress.totalCandles.toLocaleString()} candles
                      </p>
                    )}
                  </div>

                  {/* Live KPIs - show during analyzing phase or when we have trade data */}
                  {(progress.phase === 'analyzing' || progress.tradesExecuted !== undefined) && (
                    <>
                      <Separator />
                      <div>
                        <h4 className="font-semibold mb-4 flex items-center gap-2">
                          Live Trading KPIs
                          {progress.tradesExecuted === 0 && (
                            <span className="text-xs font-normal text-muted-foreground ml-2">
                              (waiting for first trade...)
                            </span>
                          )}
                          {progress.lastTradeResult && (
                            <Badge
                              variant={progress.lastTradeResult === 'WIN' ? 'default' : 'destructive'}
                              className="ml-2"
                            >
                              Last: {progress.lastTradeDirection} {progress.lastTradeResult}
                            </Badge>
                          )}
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="bg-secondary/50 rounded-lg p-3">
                            <div className="text-2xl font-bold">{progress.tradesExecuted}</div>
                            <p className="text-xs text-muted-foreground">Trades</p>
                          </div>
                          <div className="bg-secondary/50 rounded-lg p-3">
                            <div className="text-2xl font-bold flex items-center gap-1">
                              <span className="text-green-600">{progress.winningTrades}</span>
                              <span className="text-muted-foreground">/</span>
                              <span className="text-red-600">{progress.losingTrades}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">W / L</p>
                          </div>
                          <div className="bg-secondary/50 rounded-lg p-3">
                            <div className={`text-2xl font-bold ${progress.tradesExecuted === 0 ? 'text-muted-foreground' : (progress.winRate || 0) >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                              {(progress.winRate || 0).toFixed(1)}%
                            </div>
                            <p className="text-xs text-muted-foreground">Win Rate</p>
                          </div>
                          <div className="bg-secondary/50 rounded-lg p-3">
                            <div className={`text-2xl font-bold ${progress.tradesExecuted === 0 ? 'text-muted-foreground' : (progress.profitFactor || 0) >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                              {(progress.profitFactor || 0).toFixed(2)}
                            </div>
                            <p className="text-xs text-muted-foreground">Profit Factor</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                          <div className="bg-secondary/50 rounded-lg p-3">
                            <div className="text-xl font-bold">
                              {formatEUR(progress.currentBalance || 0)}
                            </div>
                            <p className="text-xs text-muted-foreground">Balance</p>
                          </div>
                          <div className="bg-secondary/50 rounded-lg p-3">
                            <div className={`text-xl font-bold flex items-center gap-1 ${(progress.totalPnl || 0) === 0 ? 'text-muted-foreground' : (progress.totalPnl || 0) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {(progress.totalPnl || 0) > 0 ? <TrendingUp className="h-4 w-4" /> : (progress.totalPnl || 0) < 0 ? <TrendingDown className="h-4 w-4" /> : null}
                              {(progress.totalPnl || 0) >= 0 ? '+' : ''}{formatEUR(progress.totalPnl || 0)}
                            </div>
                            <p className="text-xs text-muted-foreground">Total P&L</p>
                          </div>
                          <div className="bg-secondary/50 rounded-lg p-3">
                            <div className={`text-xl font-bold ${(progress.maxDrawdown || 0) === 0 ? 'text-muted-foreground' : 'text-red-600'}`}>
                              {(progress.maxDrawdown || 0).toFixed(2)}%
                            </div>
                            <p className="text-xs text-muted-foreground">Max Drawdown</p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Configure your backtest parameters and click "Run Backtest" to
                  see results.
                </CardContent>
              </Card>
            )}

            {/* Past Results */}
            {pastResults.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Recent Backtests</CardTitle>
                  <p className="text-sm text-muted-foreground">Click a row to view full results</p>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead>Strategy</TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Trades</TableHead>
                        <TableHead className="text-right">Win Rate</TableHead>
                        <TableHead className="text-right">Drawdown</TableHead>
                        <TableHead className="text-right">P&L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pastResults.map((res) => {
                        const startDate = new Date(res.startDate);
                        const endDate = new Date(res.endDate);
                        const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                        return (
                          <TableRow
                            key={res.id}
                            className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                              result?.id === res.id ? 'bg-muted' : ''
                            }`}
                            onClick={() => selectPastResult(res)}
                          >
                            <TableCell>
                              <Eye className={`h-4 w-4 ${result?.id === res.id ? 'text-primary' : 'text-muted-foreground'}`} />
                            </TableCell>
                            <TableCell>{res.strategy.replace('_', ' ')}</TableCell>
                            <TableCell>{res.symbol}</TableCell>
                            <TableCell className="text-xs">
                              <div>{startDate.toLocaleDateString()} - {endDate.toLocaleDateString()}</div>
                              <div className="text-muted-foreground">{days} days</div>
                            </TableCell>
                            <TableCell className="text-right">
                              {res.totalTrades}
                            </TableCell>
                            <TableCell className="text-right">
                              {res.winRate.toFixed(1)}%
                            </TableCell>
                            <TableCell className={`text-right ${(res.maxDrawdownPct || 0) === 0 ? 'text-muted-foreground' : 'text-red-600'}`}>
                              {(res.maxDrawdownPct || 0).toFixed(1)}%
                            </TableCell>
                            <TableCell
                              className={`text-right font-bold ${
                                res.totalPnl === 0
                                  ? 'text-muted-foreground'
                                  : res.totalPnl > 0
                                  ? 'text-green-600'
                                  : 'text-red-600'
                              }`}
                            >
                              {formatEUR(res.totalPnl)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
