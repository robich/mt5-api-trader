import { NextResponse } from 'next/server';
import { tradingBot } from '@/services/bot';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get bot status
    const botStatus = tradingBot.getStatus();

    // Get bot state from DB for startedAt
    const botState = await prisma.botState.findUnique({
      where: { id: 'singleton' },
    });

    let accountInfo = null;
    let positions: any[] = [];

    // Get live data if bot is running (streaming connection)
    if (botStatus.isRunning) {
      try {
        accountInfo = await tradingBot.getAccountInfo();
        positions = await tradingBot.getPositions();
      } catch (error) {
        console.error('Error fetching account info from bot:', error);
      }
    }

    // Get latest account snapshot from DB as fallback
    const latestSnapshot = await prisma.accountSnapshot.findFirst({
      orderBy: { timestamp: 'desc' },
    });

    // Get today's stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayTrades = await prisma.trade.findMany({
      where: {
        OR: [
          { openTime: { gte: todayStart } },
          { closeTime: { gte: todayStart } },
        ],
      },
    });

    const todayPnl = todayTrades
      .filter((t) => t.status === 'CLOSED' && t.pnl)
      .reduce((sum, t) => sum + (t.pnl || 0), 0);

    let openTrades = await prisma.trade.count({
      where: { status: 'OPEN' },
    });

    // Use MetaAPI positions count if DB has none but broker has positions
    if (openTrades === 0 && positions.length > 0) {
      openTrades = positions.length;
    }

    return NextResponse.json({
      account: accountInfo || {
        balance: latestSnapshot?.balance || 0,
        equity: latestSnapshot?.equity || 0,
        margin: latestSnapshot?.margin || 0,
        freeMargin: latestSnapshot?.freeMargin || 0,
        leverage: 100,
        currency: 'USD',
      },
      positions,
      botStatus: {
        isRunning: botStatus.isRunning,
        symbols: botStatus.symbols,
        startedAt: botState?.startedAt,
      },
      stats: {
        todayPnl,
        openTrades,
        todayTrades: todayTrades.length,
      },
    });
  } catch (error) {
    console.error('Account API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch account info' },
      { status: 500 }
    );
  }
}
