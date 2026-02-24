import { NextRequest, NextResponse } from 'next/server';
import { tradingBot } from '@/services/bot';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Auto-start: triggered once when the first GET /api/bot request arrives
// (dashboard polls this on load). More reliable than instrumentation.ts.
let autoStartTriggered = false;

export async function GET() {
  try {
    // Auto-start bot on first status check if enabled
    if (!autoStartTriggered && process.env.BOT_AUTO_START !== 'false') {
      autoStartTriggered = true;
      const status = tradingBot.getStatus();
      if (!status.isRunning) {
        console.log('[Auto-Start] Bot not running — starting automatically...');
        // Fire-and-forget so the status response isn't delayed
        tradingBot.start().then(() => {
          console.log('[Auto-Start] Trading bot started successfully');
        }).catch((err) => {
          console.error('[Auto-Start] Failed to start trading bot:', err);
        });
      }
    }

    const status = tradingBot.getStatus();

    const [botState, pauseState] = await Promise.all([
      prisma.botState.findUnique({ where: { id: 'singleton' } }),
      prisma.botPauseState.findUnique({ where: { id: 'singleton' } }),
    ]);

    return NextResponse.json({
      ...status,
      startedAt: botState?.startedAt,
      lastHeartbeat: botState?.lastHeartbeat,
      tradingPaused: pauseState?.isPaused ?? false,
      tradingPausedReason: pauseState?.reason ?? null,
      tradingPausedBy: pauseState?.pausedBy ?? null,
      tradingPausedAt: pauseState?.pausedAt ?? null,
    });
  } catch (error) {
    console.error('Bot status API error:', error);
    return NextResponse.json(
      { error: 'Failed to get bot status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, config } = body;

    switch (action) {
      case 'start':
        await tradingBot.start();
        return NextResponse.json({ message: 'Bot started', status: 'running' });

      case 'stop':
        await tradingBot.stop();
        return NextResponse.json({ message: 'Bot stopped', status: 'stopped' });

      case 'updateConfig':
        if (config) {
          tradingBot.updateConfig(config);
        }
        return NextResponse.json({
          message: 'Config updated',
          config: tradingBot.getStatus().config,
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Bot action API error:', error);
    return NextResponse.json(
      { error: `Failed to execute action: ${error}` },
      { status: 500 }
    );
  }
}
