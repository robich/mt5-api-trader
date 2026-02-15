import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // Delete all trade-related data
    // Order matters due to foreign key constraints
    await prisma.$transaction([
      // Delete trades (has foreign key to signals)
      prisma.trade.deleteMany({}),
      // Delete signals
      prisma.signal.deleteMany({}),
      // Delete backtest trades
      prisma.backtestTrade.deleteMany({}),
      // Delete backtest results
      prisma.backtestResult.deleteMany({}),
      // Delete SMC analysis data
      prisma.orderBlock.deleteMany({}),
      prisma.fairValueGap.deleteMany({}),
      prisma.liquidityZone.deleteMany({}),
      // Delete cached candles
      prisma.cachedCandle.deleteMany({}),
      // Delete account snapshots
      prisma.accountSnapshot.deleteMany({}),
      // Delete daily drawdown tracking
      prisma.dailyDrawdown.deleteMany({}),
      // Delete analysis scan history
      prisma.analysisScan.deleteMany({}),
      // Delete strategy analyst runs
      prisma.strategyAnalystRun.deleteMany({}),
    ]);

    console.log('Database reset completed successfully');

    return NextResponse.json({
      message: 'Database reset successfully',
      deletedTables: [
        'trades',
        'signals',
        'backtestTrades',
        'backtestResults',
        'orderBlocks',
        'fairValueGaps',
        'liquidityZones',
        'cachedCandles',
        'accountSnapshots',
        'dailyDrawdown',
        'analysisScans',
        'strategyAnalystRuns',
      ],
    });
  } catch (error) {
    console.error('Database reset API error:', error);
    return NextResponse.json(
      { error: `Failed to reset database: ${error}` },
      { status: 500 }
    );
  }
}
