'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { KPICards } from '@/components/dashboard/KPICards';
import { TradeTable } from '@/components/dashboard/TradeTable';
import { SignalsList } from '@/components/dashboard/SignalsList';
import { TradingViewChart } from '@/components/dashboard/TradingViewChart';
import { BotControls } from '@/components/dashboard/BotControls';
import { AnalysisPanel } from '@/components/dashboard/AnalysisPanel';
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

export default function Dashboard() {
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [openTrades, setOpenTrades] = useState<TradesData | null>(null);
  const [closedTrades, setClosedTrades] = useState<TradesData | null>(null);
  const [signals, setSignals] = useState<SignalsData | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState('XAUUSD');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [accountRes, openRes, closedRes, signalsRes, statsRes, analysisRes] = await Promise.all([
        fetch('/api/account'),
        fetch('/api/trades?status=OPEN'),
        fetch('/api/trades?status=CLOSED&limit=20'),
        fetch('/api/signals?limit=20'),
        fetch('/api/stats?days=30'),
        fetch('/api/analysis'),
      ]);

      if (!accountRes.ok) throw new Error('Failed to fetch account data');

      const [account, open, closed, sigs, statistics, analysis] = await Promise.all([
        accountRes.json(),
        openRes.json(),
        closedRes.json(),
        signalsRes.json(),
        statsRes.json(),
        analysisRes.json(),
      ]);

      setAccountData(account);
      setOpenTrades(open);
      setClosedTrades(closed);
      setSignals(sigs);
      setStats(statistics);
      setAnalysisData(analysis);
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
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">SMC Trading Bot</h1>
            <p className="text-muted-foreground">Smart Money Concept Automated Trading</p>
          </div>
          <div className="text-sm text-muted-foreground text-right">
            <div>v{process.env.NEXT_PUBLIC_VERSION || '0.0.0'}</div>
            <div className="text-xs">Built: {process.env.NEXT_PUBLIC_BUILD_TIME || 'dev'}</div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-500 p-4 rounded-lg">
            {error}
          </div>
        )}

        {/* KPI Cards */}
        <KPICards
          balance={accountData?.account.balance || 0}
          equity={accountData?.account.equity || 0}
          todayPnl={accountData?.stats.todayPnl || 0}
          openTrades={accountData?.stats.openTrades || 0}
          winRate={stats?.stats.winRate || 0}
          totalTrades={stats?.stats.totalTrades || 0}
          currency={accountData?.account.currency || 'USD'}
        />

        {/* Overall P&L Chart */}
        <EquityCurveChart
          equityCurve={stats?.equityCurve || []}
          currency={accountData?.account.currency || 'USD'}
        />

        {/* Main Content Grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Chart + Controls */}
          <div className="lg:col-span-2 space-y-6">
            {/* Symbol Selector + Bot Controls */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Chart Symbol</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    {['XAUUSD', 'XAGUSD.s', 'BTCUSD'].map((symbol) => (
                      <Button
                        key={symbol}
                        variant={selectedSymbol === symbol ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelectedSymbol(symbol)}
                      >
                        {symbol}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <BotControls
                isRunning={accountData?.botStatus.isRunning || false}
                symbols={accountData?.botStatus.symbols || ['XAUUSD.s', 'XAGUSD.s', 'BTCUSD', 'ETHUSD']}
                startedAt={accountData?.botStatus.startedAt || null}
                onStart={handleStartBot}
                onStop={handleStopBot}
                onRefresh={fetchData}
              />
            </div>

            {/* TradingView Chart */}
            <Card className="overflow-visible">
              <CardContent className="p-0 h-[500px] overflow-visible">
                <TradingViewChart
                  symbol={selectedSymbol}
                  trades={(() => {
                    // Normalize symbol for comparison (remove .s suffix, case insensitive)
                    const normalizeSymbol = (s: string) => s.replace(/\.s$/i, '').toUpperCase();
                    const selectedNorm = normalizeSymbol(selectedSymbol);

                    const matchingTrades = [
                      ...(openTrades?.trades.filter((t: any) => normalizeSymbol(t.symbol) === selectedNorm) || []),
                      ...(closedTrades?.trades.filter((t: any) => normalizeSymbol(t.symbol) === selectedNorm) || []),
                    ];

                    console.log('[Page] Selected symbol:', selectedSymbol, '-> normalized:', selectedNorm);
                    console.log('[Page] Open trades symbols:', openTrades?.trades?.map((t: any) => t.symbol));
                    console.log('[Page] Closed trades symbols:', closedTrades?.trades?.map((t: any) => t.symbol));
                    console.log('[Page] Matching trades:', matchingTrades.length);

                    return matchingTrades;
                  })()}
                  currency={accountData?.account.currency || 'USD'}
                />
              </CardContent>
            </Card>

            {/* Trades Tabs */}
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
                <CardContent>
                  <TabsContent value="open" className="mt-0">
                    <TradeTable
                      trades={(() => {
                        // Deduplicate by mt5PositionId (prefer) or trade id
                        const seenPositionIds = new Set<string>();
                        const seenTradeIds = new Set<string>();
                        return (openTrades?.trades || [])
                          .filter((trade: any) => {
                            // First check mt5PositionId for duplicates
                            if (trade.mt5PositionId) {
                              if (seenPositionIds.has(trade.mt5PositionId)) return false;
                              seenPositionIds.add(trade.mt5PositionId);
                            }
                            // Also check trade id
                            if (seenTradeIds.has(trade.id)) return false;
                            seenTradeIds.add(trade.id);
                            return true;
                          })
                          .map((trade: any) => {
                            // Match trade with live position by mt5PositionId
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
          <div className="space-y-6">
            {/* Market Analysis */}
            <AnalysisPanel analysisResults={analysisData?.analysis || []} />

            <Card>
              <CardHeader>
                <CardTitle>Recent Signals</CardTitle>
              </CardHeader>
              <CardContent>
                <SignalsList signals={signals?.signals || []} />
              </CardContent>
            </Card>

            {/* Stats Card */}
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
