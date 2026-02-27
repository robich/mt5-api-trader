import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Returns the persisted bot and telegram listener state from DB.
 * Used by server.mjs auto-start to check what was running before shutdown.
 */
export async function GET() {
  try {
    const [botState, listenerState] = await Promise.all([
      prisma.botState.findUnique({ where: { id: 'singleton' } }),
      prisma.telegramListenerState.findUnique({ where: { id: 'singleton' } }),
    ]);

    return NextResponse.json({
      wasRunning: botState?.isRunning ?? false,
      startedAt: botState?.startedAt ?? null,
      lastHeartbeat: botState?.lastHeartbeat ?? null,
      telegramWasListening: listenerState?.isListening ?? false,
    });
  } catch (error) {
    console.error('Bot state API error:', error);
    return NextResponse.json({ wasRunning: false, telegramWasListening: false });
  }
}
