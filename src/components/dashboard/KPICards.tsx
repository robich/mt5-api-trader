'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  Target,
} from 'lucide-react';

interface KPICardsProps {
  balance: number;
  equity: number;
  todayPnl: number;
  openTrades: number;
  winRate?: number;
  totalTrades?: number;
  currency?: string;
}

export function KPICards({
  balance,
  equity,
  todayPnl,
  openTrades,
  winRate = 0,
  totalTrades = 0,
  currency = 'USD',
}: KPICardsProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const dailyReturn = balance > 0 ? (todayPnl / balance) * 100 : 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Balance</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(balance)}</div>
          <p className="text-xs text-muted-foreground">Account balance</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Equity</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(equity)}</div>
          <p className="text-xs text-muted-foreground">
            Including open positions
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Today's P&L</CardTitle>
          {todayPnl > 0 ? (
            <TrendingUp className="h-4 w-4 text-green-600" />
          ) : todayPnl < 0 ? (
            <TrendingDown className="h-4 w-4 text-red-600" />
          ) : (
            <Activity className="h-4 w-4 text-muted-foreground" />
          )}
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${
              todayPnl > 0 ? 'text-green-600' : todayPnl < 0 ? 'text-red-600' : 'text-muted-foreground'
            }`}
          >
            {formatCurrency(todayPnl)}
          </div>
          <p
            className={`text-xs ${
              dailyReturn > 0 ? 'text-green-600' : dailyReturn < 0 ? 'text-red-600' : 'text-muted-foreground'
            }`}
          >
            {formatPercent(dailyReturn)} today
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Open Trades</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{openTrades}</div>
          <p className="text-xs text-muted-foreground">
            {totalTrades > 0 && `${winRate.toFixed(1)}% win rate`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
