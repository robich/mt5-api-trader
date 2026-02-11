'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface EquitySnapshot {
  timestamp: string;
  equity: number;
  balance: number;
}

interface EquityCurveChartProps {
  equityCurve: EquitySnapshot[];
  currency?: string;
  totalTrades?: number;
}

export function EquityCurveChart({
  equityCurve,
  currency = 'USD',
  totalTrades = 0,
}: EquityCurveChartProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const chartData = useMemo(() => {
    if (!equityCurve || equityCurve.length === 0) return [];

    return equityCurve.map((snapshot) => ({
      timestamp: new Date(snapshot.timestamp).getTime(),
      equity: snapshot.equity,
      balance: snapshot.balance,
      date: new Date(snapshot.timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
    }));
  }, [equityCurve]);

  const { overallPnl, overallPnlPercent, startingCapital, currentCapital, minEquity, maxEquity } =
    useMemo(() => {
      if (chartData.length === 0) {
        return {
          overallPnl: 0,
          overallPnlPercent: 0,
          startingCapital: 0,
          currentCapital: 0,
          minEquity: 0,
          maxEquity: 0,
        };
      }

      const first = chartData[0];
      const last = chartData[chartData.length - 1];
      // Use consistent metrics: balance-to-balance for realized P&L
      const startingCapital = first.balance;
      const currentCapital = last.balance;
      const overallPnl = currentCapital - startingCapital;
      const overallPnlPercent =
        startingCapital > 0 ? (overallPnl / startingCapital) * 100 : 0;

      // For chart display, use balance values to show realized P&L curve
      const balances = chartData.map((d) => d.balance);
      const minEquity = Math.min(...balances);
      const maxEquity = Math.max(...balances);

      return {
        overallPnl,
        overallPnlPercent,
        startingCapital,
        currentCapital,
        minEquity,
        maxEquity,
      };
    }, [chartData]);

  const yAxisDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    const padding = (maxEquity - minEquity) * 0.1 || maxEquity * 0.05;
    return [Math.floor(minEquity - padding), Math.ceil(maxEquity + padding)];
  }, [chartData, minEquity, maxEquity]);

  const isProfitable = overallPnl >= 0;

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Overall P&L
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-[200px] text-muted-foreground">
            No equity data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            Overall P&L
            {isProfitable ? (
              <TrendingUp className="h-5 w-5 text-green-500" />
            ) : (
              <TrendingDown className="h-5 w-5 text-red-500" />
            )}
          </CardTitle>
          <div className="text-right">
            <div
              className={`text-2xl font-bold ${
                isProfitable ? 'text-green-500' : 'text-red-500'
              }`}
            >
              {overallPnl >= 0 ? '+' : ''}
              {formatCurrency(overallPnl)}
            </div>
            <div
              className={`text-sm ${
                isProfitable ? 'text-green-500' : 'text-red-500'
              }`}
            >
              {overallPnlPercent >= 0 ? '+' : ''}
              {overallPnlPercent.toFixed(2)}%
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between text-sm text-muted-foreground mb-4">
          <div>
            <span className="block text-xs">Starting</span>
            <span className="font-medium text-foreground">
              {formatCurrency(startingCapital)}
            </span>
          </div>
          <div className="text-center">
            <span className="block text-xs">Trades</span>
            <span className="font-medium text-foreground">
              {totalTrades}
            </span>
          </div>
          <div className="text-right">
            <span className="block text-xs">Current</span>
            <span className="font-medium text-foreground">
              {formatCurrency(currentCapital)}
            </span>
          </div>
        </div>

        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
            >
              <defs>
                <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={isProfitable ? '#22c55e' : '#ef4444'}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor={isProfitable ? '#22c55e' : '#ef4444'}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                opacity={0.5}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={yAxisDomain}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) =>
                  new Intl.NumberFormat('en-US', {
                    notation: 'compact',
                    compactDisplay: 'short',
                  }).format(value)
                }
                width={40}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
                formatter={(value, name) => {
                  const numValue = typeof value === 'number' ? value : 0;
                  return [
                    formatCurrency(numValue),
                    name === 'balance' ? 'Balance' : 'Equity',
                  ];
                }}
                labelFormatter={(label) => label}
              />
              <ReferenceLine
                y={startingCapital}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                strokeOpacity={0.5}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke={isProfitable ? '#22c55e' : '#ef4444'}
                strokeWidth={2}
                fill="url(#equityGradient)"
                dot={false}
                activeDot={{
                  r: 4,
                  stroke: isProfitable ? '#22c55e' : '#ef4444',
                  strokeWidth: 2,
                  fill: 'hsl(var(--background))',
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
