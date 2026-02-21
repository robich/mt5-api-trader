import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/strategy-switches
 *
 * Fetch strategy switch history with optional filters
 *
 * Query params:
 * - limit: Max results (default 50, max 200)
 * - offset: Pagination offset
 * - symbol: Filter by symbol
 * - source: Filter by source (manual, analyst, daily-reopt, api)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const symbol = searchParams.get('symbol');
    const source = searchParams.get('source');

    const where: Record<string, string> = {};
    if (symbol) where.symbol = symbol;
    if (source) where.source = source;

    const [switches, total] = await Promise.all([
      prisma.strategySwitch.findMany({
        where,
        orderBy: { switchedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.strategySwitch.count({ where }),
    ]);

    return NextResponse.json({ switches, total });
  } catch (error) {
    console.error('Error fetching strategy switches:', error);
    return NextResponse.json(
      { error: 'Failed to fetch strategy switches' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/strategy-switches
 *
 * Log a strategy switch manually or from external sources
 *
 * Body:
 * - symbol: (optional) Symbol this switch applies to
 * - previousProfile: Previous profile ID
 * - newProfile: New profile ID
 * - reason: Why the switch was made
 * - source: 'manual' | 'analyst' | 'daily-reopt' | 'api'
 * - backtest: (optional) { pnl, winRate, profitFactor, trades, maxDD, days, start, end }
 * - previous: (optional) { pnl, winRate, profitFactor }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      symbol,
      previousProfile,
      newProfile,
      reason,
      source = 'manual',
      backtest,
      previous,
    } = body;

    if (!previousProfile || !newProfile || !reason) {
      return NextResponse.json(
        { error: 'previousProfile, newProfile, and reason are required' },
        { status: 400 }
      );
    }

    const switchRecord = await prisma.strategySwitch.create({
      data: {
        symbol: symbol || null,
        previousProfile,
        newProfile,
        reason,
        source,
        backtestPnl: backtest?.pnl ?? null,
        backtestWinRate: backtest?.winRate ?? null,
        backtestPF: backtest?.profitFactor ?? null,
        backtestTrades: backtest?.trades ?? null,
        backtestMaxDD: backtest?.maxDD ?? null,
        backtestDays: backtest?.days ?? null,
        backtestStart: backtest?.start ? new Date(backtest.start) : null,
        backtestEnd: backtest?.end ? new Date(backtest.end) : null,
        previousPnl: previous?.pnl ?? null,
        previousWinRate: previous?.winRate ?? null,
        previousPF: previous?.profitFactor ?? null,
      },
    });

    console.log('[Strategy Switch] Logged:', {
      from: previousProfile,
      to: newProfile,
      symbol,
      source,
      reason: reason.substring(0, 100),
    });

    return NextResponse.json({ success: true, switch: switchRecord });
  } catch (error) {
    console.error('Error logging strategy switch:', error);
    return NextResponse.json(
      { error: 'Failed to log strategy switch' },
      { status: 500 }
    );
  }
}
