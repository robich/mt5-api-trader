import { NextRequest, NextResponse } from 'next/server';
import { tradingBot } from '@/services/bot';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bot/pause — returns current pause state
 */
export async function GET() {
  try {
    const state = await prisma.botPauseState.findUnique({
      where: { id: 'singleton' },
    });

    return NextResponse.json({
      isPaused: state?.isPaused ?? false,
      reason: state?.reason ?? null,
      pausedBy: state?.pausedBy ?? null,
      pausedAt: state?.pausedAt ?? null,
      resumedAt: state?.resumedAt ?? null,
    });
  } catch (error) {
    console.error('Error fetching pause state:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pause state' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bot/pause — pause or resume trading
 * Body: { action: 'pause' | 'resume', reason?: string, pausedBy?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, reason, pausedBy } = body;

    if (action !== 'pause' && action !== 'resume') {
      return NextResponse.json(
        { error: 'Invalid action. Use "pause" or "resume".' },
        { status: 400 }
      );
    }

    const isPaused = action === 'pause';
    await tradingBot.setPauseState(isPaused, reason, pausedBy || 'api');

    return NextResponse.json({
      success: true,
      isPaused,
      message: isPaused
        ? `Trading paused: ${reason || 'No reason given'}`
        : 'Trading resumed',
    });
  } catch (error) {
    console.error('Error setting pause state:', error);
    return NextResponse.json(
      { error: 'Failed to set pause state' },
      { status: 500 }
    );
  }
}
