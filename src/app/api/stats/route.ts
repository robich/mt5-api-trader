import { NextRequest, NextResponse } from 'next/server';
import { tradeManager } from '@/lib/risk/trade-manager';
import { tradingBot } from '@/services/bot';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '30');
    const source = (searchParams.get('source') || 'all') as 'all' | 'auto' | 'telegram';

    // Get trading statistics
    const stats = await tradeManager.getStatistics(days, source);

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
    const equityCurve = await buildEquityCurveFromTrades(days, currentAccountInfo, balanceSummary, source);

    // Get daily P&L
    const dailyPnl = await getDailyPnL(days, source);

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
  balanceSummary: BalanceSummary | null,
  source: 'all' | 'auto' | 'telegram' = 'all'
) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // When filtered by source, always use DB path (deal timeline has no strategy info)
  // When unfiltered and bot is running, use deal timeline (authoritative)
  if (source === 'all' && balanceSummary?.dealTimeline && balanceSummary.dealTimeline.length > 0) {
    return buildEquityCurveFromDealTimeline(startDate, balanceSummary.dealTimeline, currentAccountInfo);
  }

  // DB-based path: used for filtered views or offline fallback
  return buildEquityCurveFromDB(startDate, currentAccountInfo, balanceSummary, source);
}

/**
 * Build equity curve from MetaAPI deal timeline (authoritative, complete)
 * Shows trading P&L only — deposits and withdrawals are excluded from the curve
 * so the graph reflects actual trading performance, not capital flows.
 * Deposits/withdrawals are still marked as events for annotation purposes.
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

  // Accumulate trading P&L from all deals before the display period
  // Skip deposits/withdrawals — they are capital flows, not trading P&L
  let pnlBeforePeriod = 0;
  for (const evt of dealTimeline) {
    const ts = new Date(evt.timestamp);
    if (ts >= startDate) break;
    if (!evt.event) {
      pnlBeforePeriod += evt.balanceChange;
    }
  }

  // Add starting point
  equityCurve.push({
    timestamp: startDate,
    equity: pnlBeforePeriod,
    balance: pnlBeforePeriod,
  });

  // Add point for each deal event in the display period
  let runningPnl = pnlBeforePeriod;
  for (const evt of dealTimeline) {
    const ts = new Date(evt.timestamp);
    if (ts < startDate) continue;

    if (evt.event) {
      // Deposit/withdrawal — mark the event but don't change the P&L curve
      equityCurve.push({
        timestamp: ts,
        equity: runningPnl,
        balance: runningPnl,
        event: evt.event,
        amount: evt.amount,
      });
    } else {
      // Trading deal — update the P&L curve
      runningPnl += evt.balanceChange;
      equityCurve.push({
        timestamp: ts,
        equity: runningPnl,
        balance: runningPnl,
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
  balanceSummary: BalanceSummary | null,
  source: 'all' | 'auto' | 'telegram' = 'all'
) {
  const isFiltered = source !== 'all';
  const strategyFilter = source === 'auto'
    ? { strategy: { not: 'EXTERNAL' } }
    : source === 'telegram'
      ? { strategy: 'EXTERNAL' }
      : {};

  const closedTrades = await prisma.trade.findMany({
    where: {
      status: 'CLOSED',
      closeTime: { not: null },
      pnl: { not: null },
      ...strategyFilter,
    },
    orderBy: { closeTime: 'asc' },
    select: {
      closeTime: true,
      pnl: true,
    },
  });

  // When filtered, exclude deposits/withdrawals (account-level, not source-specific)
  const operations = isFiltered ? [] : (balanceSummary?.operations || []);

  if (closedTrades.length === 0 && operations.length === 0) {
    if (isFiltered) {
      return [{ timestamp: startDate, equity: 0, balance: 0 }];
    }
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

  // Deposits/withdrawals are annotated but don't affect the P&L curve
  for (const op of operations) {
    timeline.push({
      timestamp: new Date(op.time),
      pnl: 0, // Capital flows excluded from P&L
      event: op.type as 'deposit' | 'withdrawal',
      amount: op.amount,
    });
  }

  timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Start at 0 — curve shows cumulative trading P&L only
  const startingBalance = 0;

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

  // Note: no final account balance point — curve shows trading P&L only

  return equityCurve;
}

async function getDailyPnL(days: number, source: 'all' | 'auto' | 'telegram' = 'all') {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const strategyFilter = source === 'auto'
    ? { strategy: { not: 'EXTERNAL' } }
    : source === 'telegram'
      ? { strategy: 'EXTERNAL' }
      : {};

  const trades = await prisma.trade.findMany({
    where: {
      closeTime: { gte: startDate },
      status: 'CLOSED',
      ...strategyFilter,
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
