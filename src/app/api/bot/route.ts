import { NextRequest, NextResponse } from 'next/server';
import { tradingBot } from '@/services/bot';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Auto-start: triggered once when the first GET /api/bot request arrives
// (dashboard polls this on load). More reliable than instrumentation.ts.
let autoStartTriggered = false;

export async function GET() {
  try {
    // Auto-start bot on first status check — only if it was running before last shutdown
    // NOTE: Telegram listener auto-start is handled by server.mjs with a 15s delay
    // to avoid AUTH_KEY_DUPLICATED (old session needs time to release).
    if (!autoStartTriggered && process.env.BOT_AUTO_START !== 'false') {
      autoStartTriggered = true;
      const status = tradingBot.getStatus();
      if (!status.isRunning) {
        // Check DB to see if bot was running before the last graceful shutdown
        const dbState = await prisma.botState.findUnique({ where: { id: 'singleton' } }).catch(() => null);
        if (dbState?.isRunning) {
          console.log('[Auto-Start] Bot was previously running — starting automatically...');
          tradingBot.start().then(() => {
            console.log('[Auto-Start] Trading bot started successfully');
          }).catch((err) => {
            console.error('[Auto-Start] Failed to start trading bot:', err);
          });
        } else {
          console.log('[Auto-Start] Bot was not running before shutdown — skipping');
        }
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

      case 'graceful-stop':
        // Used by SIGTERM handler — stops the bot but preserves DB isRunning
        // so the bot auto-starts on the next deploy
        await tradingBot.stop({ preserveDbState: true });
        return NextResponse.json({ message: 'Bot stopped (graceful)', status: 'stopped' });

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
