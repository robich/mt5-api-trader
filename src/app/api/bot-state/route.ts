import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Returns the persisted bot state from DB.
 * Used by server.mjs auto-start to check if bot was running before shutdown.
 */
export async function GET() {
  try {
    const botState = await prisma.botState.findUnique({
      where: { id: 'singleton' },
    });

    return NextResponse.json({
      wasRunning: botState?.isRunning ?? false,
      startedAt: botState?.startedAt ?? null,
      lastHeartbeat: botState?.lastHeartbeat ?? null,
    });
  } catch (error) {
    console.error('Bot state API error:', error);
    return NextResponse.json({ wasRunning: false });
  }
}
