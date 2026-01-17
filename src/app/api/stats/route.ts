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

    // Build equity curve from closed trades (more accurate than sparse snapshots)
    const equityCurve = await buildEquityCurveFromTrades(days, currentAccountInfo);

    // Get daily P&L
    const dailyPnl = await getDailyPnL(days);

    return NextResponse.json({
      stats,
      equityCurve,
      dailyPnl,
    });
  } catch (error) {
    console.error('Stats API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    );
  }
}

/**
 * Build equity curve from closed trades
 * Calculates cumulative P&L over time based on actual trade results
 */
async function buildEquityCurveFromTrades(
  days: number,
  currentAccountInfo: { balance: number; equity: number } | null
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

  if (closedTrades.length === 0) {
    // No trades - just return current balance as single point if available
    if (currentAccountInfo) {
      return [{
        timestamp: new Date(),
        equity: currentAccountInfo.balance,
        balance: currentAccountInfo.balance,
      }];
    }
    return [];
  }

  // Calculate total P&L from ALL closed trades (to derive starting balance)
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Starting balance = current balance - total P&L from all trades
  const currentBalance = currentAccountInfo?.balance || 0;
  const startingBalance = currentBalance - totalPnl;

  // Build equity curve points
  const equityCurve: Array<{ timestamp: Date; equity: number; balance: number }> = [];

  // Find P&L accumulated before the display period
  const pnlBeforePeriod = closedTrades
    .filter(t => t.closeTime && t.closeTime < startDate)
    .reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Add starting point at beginning of period
  const balanceAtPeriodStart = startingBalance + pnlBeforePeriod;
  equityCurve.push({
    timestamp: startDate,
    equity: balanceAtPeriodStart,
    balance: balanceAtPeriodStart,
  });

  // Add point for each trade in the period
  let runningBalance = balanceAtPeriodStart;
  for (const trade of closedTrades) {
    if (!trade.closeTime || trade.closeTime < startDate) continue;

    runningBalance += trade.pnl || 0;
    equityCurve.push({
      timestamp: trade.closeTime,
      equity: runningBalance,
      balance: runningBalance,
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
