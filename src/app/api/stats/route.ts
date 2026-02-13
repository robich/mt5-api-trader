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
    let balanceSummary: BalanceSummary | null = null;

    if (botStatus.isRunning) {
      try {
        const summary = await tradingBot.getAccountSummary();
        balanceSummary = {
          totalDeposits: summary.deposits,
          totalWithdrawals: summary.withdrawals,
          netDeposits: summary.deposits - summary.withdrawals,
          totalSwap: summary.totalSwap,
          totalCommission: summary.totalCommission,
          tradingProfit: summary.tradingProfit,
          operations: summary.operations,
          dealTimeline: summary.dealTimeline,
        };
      } catch (error) {
        console.error('Error fetching account summary from bot:', error);
      }
    }

    // Build equity curve from closed trades
    const equityCurve = await buildEquityCurveFromTrades(days, currentAccountInfo, balanceSummary);

    // Get daily P&L
    const dailyPnl = await getDailyPnL(days);

    // Strip dealTimeline from response (internal data, not needed by frontend)
    const { dealTimeline: _, ...balanceSummaryForClient } = balanceSummary || {} as any;

    return NextResponse.json({
      stats,
      equityCurve,
      dailyPnl,
      balanceSummary: balanceSummary ? balanceSummaryForClient : null,
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
  tradingProfit?: number;
  operations: Array<{ type: string; amount: number; time: Date; comment: string | null }>;
  dealTimeline?: Array<{
    timestamp: Date;
    balanceChange: number;
    event?: 'deposit' | 'withdrawal';
    amount?: number;
    symbol?: string;
  }>;
}

/**
 * Build equity curve from deal timeline (when bot is running) or DB trades (offline fallback)
 * Always starts at 0 before the first deposit — the graph shows cumulative account growth
 */
async function buildEquityCurveFromTrades(
  days: number,
  currentAccountInfo: { balance: number; equity: number } | null,
  balanceSummary: BalanceSummary | null
) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // When bot is running, use the complete deal timeline from MetaAPI
  // This is authoritative — every balance change comes from deals
  if (balanceSummary?.dealTimeline && balanceSummary.dealTimeline.length > 0) {
    return buildEquityCurveFromDealTimeline(startDate, balanceSummary.dealTimeline, currentAccountInfo);
  }

  // Offline fallback: use DB trades (may have incomplete PnL)
  return buildEquityCurveFromDB(startDate, currentAccountInfo, balanceSummary);
}

/**
 * Build equity curve from MetaAPI deal timeline (authoritative, complete)
 * Every deal's balance change = profit + swap + commission
 * Starting point is always 0 (before any deposits)
 */
function buildEquityCurveFromDealTimeline(
  startDate: Date,
  dealTimeline: NonNullable<BalanceSummary['dealTimeline']>,
  currentAccountInfo: { balance: number; equity: number } | null
) {
  const equityCurve: Array<{
    timestamp: Date;
    equity: number;
    balance: number;
    event?: 'deposit' | 'withdrawal';
    amount?: number;
  }> = [];

  // Accumulate balance from all deals before the display period
  // Starting from 0 (before any deposits)
  let balanceBeforePeriod = 0;
  for (const evt of dealTimeline) {
    const ts = new Date(evt.timestamp);
    if (ts >= startDate) break;
    balanceBeforePeriod += evt.balanceChange;
  }

  // Add starting point
  equityCurve.push({
    timestamp: startDate,
    equity: balanceBeforePeriod,
    balance: balanceBeforePeriod,
  });

  // Add point for each deal event in the display period
  let runningBalance = balanceBeforePeriod;
  for (const evt of dealTimeline) {
    const ts = new Date(evt.timestamp);
    if (ts < startDate) continue;

    runningBalance += evt.balanceChange;
    equityCurve.push({
      timestamp: ts,
      equity: runningBalance,
      balance: runningBalance,
      event: evt.event,
      amount: evt.amount,
    });
  }

  // Add current balance as final point if it differs (accounts for open trades)
  if (currentAccountInfo) {
    const lastPoint = equityCurve[equityCurve.length - 1];
    if (Math.abs(lastPoint.balance - currentAccountInfo.balance) > 0.01) {
      equityCurve.push({
        timestamp: new Date(),
        equity: currentAccountInfo.balance,
        balance: currentAccountInfo.balance,
      });
    }
  }

  return equityCurve;
}

/**
 * Offline fallback: build equity curve from DB trades
 * Less accurate — trades with null PnL are excluded
 */
async function buildEquityCurveFromDB(
  startDate: Date,
  currentAccountInfo: { balance: number; equity: number } | null,
  balanceSummary: BalanceSummary | null
) {
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
      timeline.push({ timestamp: trade.closeTime, pnl: trade.pnl || 0 });
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

  timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Compute starting balance: current - total of all events
  const totalFromTimeline = timeline.reduce((sum, evt) => sum + evt.pnl, 0);
  const currentBalance = currentAccountInfo?.balance || 0;
  const startingBalance = currentBalance - totalFromTimeline;

  const equityCurve: Array<{
    timestamp: Date;
    equity: number;
    balance: number;
    event?: 'deposit' | 'withdrawal';
    amount?: number;
  }> = [];

  let balanceBeforePeriod = startingBalance;
  for (const evt of timeline) {
    if (evt.timestamp >= startDate) break;
    balanceBeforePeriod += evt.pnl;
  }

  equityCurve.push({
    timestamp: startDate,
    equity: balanceBeforePeriod,
    balance: balanceBeforePeriod,
  });

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

  if (currentAccountInfo) {
    const lastPoint = equityCurve[equityCurve.length - 1];
    if (Math.abs(lastPoint.balance - currentAccountInfo.balance) > 0.01) {
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
