'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Calculator, Bot, Radio } from 'lucide-react';
import { KPICards } from '@/components/dashboard/KPICards';
import { TradeTable } from '@/components/dashboard/TradeTable';
import { SignalsList } from '@/components/dashboard/SignalsList';
import { TradingViewChart } from '@/components/dashboard/TradingViewChart';
import { BotControls } from '@/components/dashboard/BotControls';
import { AnalysisPanel } from '@/components/dashboard/AnalysisPanel';
import { MarketAnalysisPanel } from '@/components/dashboard/MarketAnalysisPanel';
import { TelegramSignalsPanel } from '@/components/dashboard/TelegramSignalsPanel';
import { EquityCurveChart } from '@/components/dashboard/EquityCurveChart';

interface AccountData {
  account: {
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    leverage: number;
    currency: string;
  };
  positions: any[];
  botStatus: {
    isRunning: boolean;
    symbols: string[];
    startedAt: string | null;
  };
  stats: {
    todayPnl: number;
    openTrades: number;
    todayTrades: number;
  };
}

interface TradesData {
  trades: any[];
  total: number;
}

interface SignalsData {
  signals: any[];
}

interface StatsData {
  stats: {
    winRate: number;
    totalTrades: number;
    profitFactor: number;
  };
  equityCurve: Array<{
    timestamp: string;
    equity: number;
    balance: number;
  }>;
  dailyPnl: Array<{
    date: string;
    pnl: number;
  }>;
}

interface AnalysisData {
  analysis: any[];
}

interface TelegramListenerStatus {
  isListening: boolean;
  startedAt: string | null;
}

function formatUptime(startedAt: string | null): string {
  if (!startedAt) return '';
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = now - start;
  if (diffMs < 0) return '';
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function ServiceStatus({ label, icon: Icon, isRunning, startedAt }: {
  label: string;
  icon: React.ElementType;
  isRunning: boolean;
  startedAt: string | null;
}) {
  const [uptime, setUptime] = useState(formatUptime(startedAt));

  useEffect(() => {
    if (!isRunning || !startedAt) { setUptime(''); return; }
    setUptime(formatUptime(startedAt));
    const interval = setInterval(() => setUptime(formatUptime(startedAt)), 1000);
    return () => clearInterval(interval);
  }, [isRunning, startedAt]);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border text-sm">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <div className={`h-2 w-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
      <span className={`font-medium ${isRunning ? 'text-green-500' : 'text-red-500'}`}>
        {isRunning ? 'Running' : 'Stopped'}
      </span>
      {isRunning && uptime && (
        <span className="text-xs text-muted-foreground">{uptime}</span>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [openTrades, setOpenTrades] = useState<TradesData | null>(null);
  const [closedTrades, setClosedTrades] = useState<TradesData | null>(null);
  const [signals, setSignals] = useState<SignalsData | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramListenerStatus | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState('XAUUSD.s');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [accountRes, openRes, closedRes, signalsRes, statsRes, analysisRes, telegramRes] = await Promise.all([
        fetch('/api/account'),
        fetch('/api/trades?status=OPEN'),
        fetch('/api/trades?status=CLOSED&limit=20'),
        fetch('/api/signals?limit=20'),
        fetch('/api/stats?days=30'),
        fetch('/api/analysis'),
        fetch('/api/telegram-listener?limit=0'),
      ]);

      if (!accountRes.ok) throw new Error('Failed to fetch account data');

      const [account, open, closed, sigs, statistics, analysis, telegram] = await Promise.all([
        accountRes.json(),
        openRes.json(),
        closedRes.json(),
        signalsRes.json(),
        statsRes.json(),
        analysisRes.json(),
        telegramRes.ok ? telegramRes.json() : null,
      ]);

      setAccountData(account);
      setOpenTrades(open);
      setClosedTrades(closed);
      setSignals(sigs);
      setStats(statistics);
      setAnalysisData(analysis);
      if (telegram?.listener) {
        setTelegramStatus(telegram.listener);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Refresh data every 30 seconds
    const interval = setInterval(fetchData, 30000);

    return () => clearInterval(interval);
  }, [fetchData]);

  const handleStartBot = async () => {
    try {
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });

      if (!res.ok) throw new Error('Failed to start bot');

      await fetchData();
    } catch (err) {
      console.error('Error starting bot:', err);
      setError('Failed to start bot. Please try again.');
    }
  };

  const handleStopBot = async () => {
    try {
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });

      if (!res.ok) throw new Error('Failed to stop bot');

      await fetchData();
    } catch (err) {
      console.error('Error stopping bot:', err);
      setError('Failed to stop bot. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background space-y-4 md:space-y-6 py-4 md:py-6">
      {/* Header */}
      <div className="px-4 md:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">SMC Trading Bot</h1>
            <p className="text-muted-foreground text-sm md:text-base">Smart Money Concept Automated Trading</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:gap-4">
            <ServiceStatus
              label="Bot"
              icon={Bot}
              isRunning={accountData?.botStatus.isRunning || false}
              startedAt={accountData?.botStatus.startedAt || null}
            />
            <ServiceStatus
              label="Signals"
              icon={Radio}
              isRunning={telegramStatus?.isListening || false}
              startedAt={telegramStatus?.startedAt || null}
            />
            <Link href="/calculator">
              <Button variant="outline" size="sm">
                <Calculator className="h-4 w-4 mr-2" />
                Calculator
              </Button>
            </Link>
            <div className="text-sm text-muted-foreground text-right hidden sm:block">
              <div>v{process.env.NEXT_PUBLIC_VERSION || '0.0.0'}</div>
              <div className="text-xs">Built: {process.env.NEXT_PUBLIC_BUILD_TIME || 'dev'}</div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-4 md:mx-6 bg-red-500/10 border border-red-500 text-red-500 p-4 rounded-lg">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="px-4 md:px-6">
        <KPICards
          balance={accountData?.account.balance || 0}
          equity={accountData?.account.equity || 0}
          todayPnl={accountData?.stats.todayPnl || 0}
          openTrades={accountData?.stats.openTrades || 0}
          winRate={stats?.stats.winRate || 0}
          totalTrades={stats?.stats.totalTrades || 0}
          currency={accountData?.account.currency || 'USD'}
        />
      </div>

      {/* Overall P&L Chart */}
      <div className="px-4 md:px-6">
        <EquityCurveChart
          equityCurve={stats?.equityCurve || []}
          currency={accountData?.account.currency || 'USD'}
          totalTrades={stats?.stats.totalTrades || 0}
        />
      </div>

      {/* Symbol Selector + Bot Controls */}
      <div className="px-4 md:px-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <div className="flex gap-2 overflow-x-auto">
            {['XAUUSD.s', 'XAGUSD.s', 'BTCUSD', 'ETHUSD'].map((symbol) => (
              <Button
                key={symbol}
                variant={selectedSymbol === symbol ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedSymbol(symbol)}
                className="shrink-0"
              >
                {symbol}
              </Button>
            ))}
          </div>
          <div className="sm:ml-auto">
            <BotControls
              isRunning={accountData?.botStatus.isRunning || false}
              symbols={accountData?.botStatus.symbols || ['XAUUSD.s', 'XAGUSD.s', 'BTCUSD', 'ETHUSD']}
              startedAt={accountData?.botStatus.startedAt || null}
              onStart={handleStartBot}
              onStop={handleStopBot}
              onRefresh={fetchData}
            />
          </div>
        </div>

        {/* TradingView Chart - Full Width */}
        <Card className="overflow-visible">
          <CardContent className="p-0 h-[400px] md:h-[600px] overflow-visible">
            <TradingViewChart
              symbol={selectedSymbol}
              trades={(() => {
                const normalizeSymbol = (s: string) => s.replace(/\.s$/i, '').toUpperCase();
                const selectedNorm = normalizeSymbol(selectedSymbol);
                return [
                  ...(openTrades?.trades.filter((t: any) => normalizeSymbol(t.symbol) === selectedNorm) || []),
                  ...(closedTrades?.trades.filter((t: any) => normalizeSymbol(t.symbol) === selectedNorm) || []),
                ];
              })()}
              currency={accountData?.account.currency || 'USD'}
            />
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="px-4 md:px-6">
        <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
          {/* Trades Tabs */}
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            <Card>
              <Tabs defaultValue="open">
                <CardHeader className="pb-0">
                  <div className="flex items-center justify-between">
                    <CardTitle>Trades</CardTitle>
                    <TabsList>
                      <TabsTrigger value="open">
                        Open ({openTrades?.trades.length || 0})
                      </TabsTrigger>
                      <TabsTrigger value="closed">
                        History ({(closedTrades?.trades || []).filter((t: any) => t.pnl != null).length})
                      </TabsTrigger>
                    </TabsList>
                  </div>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <TabsContent value="open" className="mt-0">
                    <TradeTable
                      trades={(() => {
                        const seenPositionIds = new Set<string>();
                        const seenTradeIds = new Set<string>();
                        return (openTrades?.trades || [])
                          .filter((trade: any) => {
                            if (trade.mt5PositionId) {
                              if (seenPositionIds.has(trade.mt5PositionId)) return false;
                              seenPositionIds.add(trade.mt5PositionId);
                            }
                            if (seenTradeIds.has(trade.id)) return false;
                            seenTradeIds.add(trade.id);
                            return true;
                          })
                          .map((trade: any) => {
                            const position = accountData?.positions?.find(
                              (pos: any) => pos.id === trade.mt5PositionId
                            );
                            return {
                              ...trade,
                              currentPnl: position?.profit ?? trade.currentPnl ?? null,
                              currentPrice: position?.currentPrice ?? trade.currentPrice ?? null,
                            };
                          });
                      })()}
                      type="open"
                      currency={accountData?.account.currency || 'USD'}
                    />
                  </TabsContent>
                  <TabsContent value="closed" className="mt-0">
                    <TradeTable
                      trades={(closedTrades?.trades || []).filter((trade: any) =>
                        trade.pnl != null
                      )}
                      type="closed"
                      currency={accountData?.account.currency || 'USD'}
                    />
                  </TabsContent>
                </CardContent>
              </Tabs>
            </Card>
          </div>

          {/* Signals & Analysis Panel */}
          <div className="space-y-4 md:space-y-6">
            <TelegramSignalsPanel />
            <MarketAnalysisPanel />
            <AnalysisPanel analysisResults={analysisData?.analysis || []} />

            <Card>
              <CardHeader>
                <CardTitle>Recent Signals</CardTitle>
              </CardHeader>
              <CardContent>
                <SignalsList signals={signals?.signals || []} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>30-Day Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Trades</span>
                    <span className="font-semibold">{stats?.stats.totalTrades || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Win Rate</span>
                    <span className="font-semibold">
                      {(stats?.stats.winRate || 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Profit Factor</span>
                    <span className="font-semibold">
                      {(stats?.stats.profitFactor || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
