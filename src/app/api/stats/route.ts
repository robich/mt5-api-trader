import { NextRequest, NextResponse } from 'next/server';
import { tradeManager } from '@/lib/risk/trade-manager';
import { tradingBot } from '@/services/bot';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '30');

    // Get trading statistics
    const stats = await tradeManager.getStatistics(days);

    // Get current account info if bot is running
    let currentAccountInfo = null;
    const botStatus = tradingBot.getStatus();

    if (botStatus.isRunning) {
      try {
        currentAccountInfo = await tradingBot.getAccountInfo();
      } catch (error) {
        console.error('Error fetching current account info from bot:', error);
      }
    }

    // If no live data, get latest snapshot from DB
    if (!currentAccountInfo) {
      const latestSnapshot = await prisma.accountSnapshot.findFirst({
        orderBy: { timestamp: 'desc' },
      });
      if (latestSnapshot) {
        currentAccountInfo = {
          balance: latestSnapshot.balance,
          equity: latestSnapshot.equity,
        };
      }
    }

    // Get balance summary from MetaAPI deals (only when bot is running)
    let balanceSummary: {
      totalDeposits: number;
      totalWithdrawals: number;
      netDeposits: number;
      totalSwap: number;
      totalCommission: number;
      operations: Array<{ type: string; amount: number; time: Date; comment: string | null }>;
    } | null = null;

    if (botStatus.isRunning) {
      try {
        const summary = await tradingBot.getAccountSummary();
        balanceSummary = {
          totalDeposits: summary.deposits,
          totalWithdrawals: summary.withdrawals,
          netDeposits: summary.deposits - summary.withdrawals,
          totalSwap: summary.totalSwap,
          totalCommission: summary.totalCommission,
          operations: summary.operations,
        };
      } catch (error) {
        console.error('Error fetching account summary from bot:', error);
      }
    }

    // Build equity curve from closed trades
    const equityCurve = await buildEquityCurveFromTrades(days, currentAccountInfo, balanceSummary);

    // Get daily P&L
    const dailyPnl = await getDailyPnL(days);

    return NextResponse.json({
      stats,
      equityCurve,
      dailyPnl,
      balanceSummary,
    });
  } catch (error) {
    console.error('Stats API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    );
  }
}

interface BalanceSummary {
  totalDeposits: number;
  totalWithdrawals: number;
  netDeposits: number;
  totalSwap: number;
  totalCommission: number;
  operations: Array<{ type: string; amount: number; time: Date; comment: string | null }>;
}

/**
 * Build equity curve from closed trades and balance operations
 * Correctly accounts for deposits/withdrawals when computing starting balance
 */
async function buildEquityCurveFromTrades(
  days: number,
  currentAccountInfo: { balance: number; equity: number } | null,
  balanceSummary: BalanceSummary | null
) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get all closed trades with P&L, ordered by close time
  const closedTrades = await prisma.trade.findMany({
    where: {
      status: 'CLOSED',
      closeTime: { not: null },
      pnl: { not: null },
    },
    orderBy: { closeTime: 'asc' },
    select: {
      closeTime: true,
      pnl: true,
    },
  });

  // Net deposits from deal summary (or 0 if bot offline)
  const netDeposits = balanceSummary?.netDeposits || 0;
  const operations = balanceSummary?.operations || [];

  if (closedTrades.length === 0 && operations.length === 0) {
    if (currentAccountInfo) {
      return [{
        timestamp: new Date(),
        equity: currentAccountInfo.balance,
        balance: currentAccountInfo.balance,
      }];
    }
    return [];
  }

  // Calculate total P&L from ALL closed trades
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Starting balance = current balance - total P&L - net deposits/withdrawals
  const currentBalance = currentAccountInfo?.balance || 0;
  const startingBalance = currentBalance - totalPnl - netDeposits;

  // Merge trades and balance operations into a single timeline
  type TimelineEvent = {
    timestamp: Date;
    pnl: number;
    event?: 'deposit' | 'withdrawal';
    amount?: number;
  };

  const timeline: TimelineEvent[] = [];

  for (const trade of closedTrades) {
    if (trade.closeTime) {
      timeline.push({
        timestamp: trade.closeTime,
        pnl: trade.pnl || 0,
      });
    }
  }

  for (const op of operations) {
    timeline.push({
      timestamp: new Date(op.time),
      pnl: op.type === 'deposit' ? op.amount : -op.amount,
      event: op.type as 'deposit' | 'withdrawal',
      amount: op.amount,
    });
  }

  // Sort by timestamp
  timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Build equity curve points
  const equityCurve: Array<{
    timestamp: Date;
    equity: number;
    balance: number;
    event?: 'deposit' | 'withdrawal';
    amount?: number;
  }> = [];

  // Accumulate everything before the display period
  let balanceBeforePeriod = startingBalance;
  for (const evt of timeline) {
    if (evt.timestamp >= startDate) break;
    balanceBeforePeriod += evt.pnl;
  }

  // Add starting point
  equityCurve.push({
    timestamp: startDate,
    equity: balanceBeforePeriod,
    balance: balanceBeforePeriod,
  });

  // Add point for each event in the period
  let runningBalance = balanceBeforePeriod;
  for (const evt of timeline) {
    if (evt.timestamp < startDate) continue;

    runningBalance += evt.pnl;
    equityCurve.push({
      timestamp: evt.timestamp,
      equity: runningBalance,
      balance: runningBalance,
      event: evt.event,
      amount: evt.amount,
    });
  }

  // Add current balance as final point
  if (currentAccountInfo) {
    const lastPoint = equityCurve[equityCurve.length - 1];
    if (lastPoint.balance !== currentAccountInfo.balance) {
      equityCurve.push({
        timestamp: new Date(),
        equity: currentAccountInfo.balance,
        balance: currentAccountInfo.balance,
      });
    }
  }

  return equityCurve;
}

async function getDailyPnL(days: number) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const trades = await prisma.trade.findMany({
    where: {
      closeTime: { gte: startDate },
      status: 'CLOSED',
    },
    orderBy: { closeTime: 'asc' },
  });

  // Group by day
  const dailyMap = new Map<string, number>();

  for (const trade of trades) {
    if (trade.closeTime && trade.pnl) {
      const day = trade.closeTime.toISOString().split('T')[0];
      dailyMap.set(day, (dailyMap.get(day) || 0) + trade.pnl);
    }
  }

  return Array.from(dailyMap.entries()).map(([date, pnl]) => ({
    date,
    pnl,
  }));
}
