import { prisma } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    // Delete all records in dependency order (children first, then parents)
    await prisma.$transaction([
      // Delete all child records first
      prisma.backtestTrade.deleteMany(),
      prisma.accountSnapshot.deleteMany(),
      prisma.orderBlock.deleteMany(),
      prisma.fairValueGap.deleteMany(),
      prisma.liquidityZone.deleteMany(),
      prisma.dailyDrawdown.deleteMany(),

      // Delete parent records
      prisma.trade.deleteMany(),
      prisma.signal.deleteMany(),
      prisma.backtestResult.deleteMany(),
      prisma.cachedCandle.deleteMany(),

      // Reset strategy configs (optional - keeps configurations)
      // prisma.strategyConfig.deleteMany(),

      // Reset bot state (optional - keeps bot configuration)
      // prisma.botState.deleteMany(),
    ]);

    return NextResponse.json({
      success: true,
      message: 'Database reset successfully. All trades, signals, and historical data cleared.',
    });
  } catch (error) {
    console.error('Database reset error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to reset database',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
