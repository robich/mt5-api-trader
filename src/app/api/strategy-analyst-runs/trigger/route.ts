import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Triggers older than this are considered stale (e.g. killed by a redeployment)
const STALE_TRIGGER_MINUTES = 30;

/**
 * Expire any PENDING/RUNNING triggers that are older than STALE_TRIGGER_MINUTES.
 * This handles the case where the analyst process was killed mid-run (e.g. by a
 * deployment) and the trigger record was never updated to COMPLETED/FAILED.
 */
async function expireStaleTriggers(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_TRIGGER_MINUTES * 60 * 1000);
  const { count } = await prisma.strategyAnalystTrigger.updateMany({
    where: {
      status: { in: ['PENDING', 'RUNNING'] },
      requestedAt: { lt: cutoff },
    },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      result: JSON.stringify({ success: false, reason: 'expired-stale-trigger' }),
    },
  });
  if (count > 0) {
    console.log(`[trigger] Expired ${count} stale trigger(s) older than ${STALE_TRIGGER_MINUTES}m`);
  }
  return count;
}

export async function POST() {
  try {
    // Clean up any stale triggers that got stuck from a previous deployment
    await expireStaleTriggers();

    // Check if there's already a PENDING or RUNNING trigger
    const existing = await prisma.strategyAnalystTrigger.findFirst({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { requestedAt: 'desc' },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Analysis is already pending or running' },
        { status: 409 }
      );
    }

    // Create a new trigger request
    const trigger = await prisma.strategyAnalystTrigger.create({
      data: { status: 'PENDING' },
    });

    return NextResponse.json(
      { success: true, message: 'Analysis triggered', triggerId: trigger.id },
      { status: 202 }
    );
  } catch (error) {
    console.error('Error triggering strategy analyst:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create trigger' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Clean up any stale triggers so the UI doesn't show a perpetual spinner
    await expireStaleTriggers();

    // Check for any active trigger (PENDING or RUNNING)
    const active = await prisma.strategyAnalystTrigger.findFirst({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { requestedAt: 'desc' },
    });

    // Get the last completed/failed trigger
    const last = await prisma.strategyAnalystTrigger.findFirst({
      where: { status: { in: ['COMPLETED', 'FAILED'] } },
      orderBy: { requestedAt: 'desc' },
    });

    return NextResponse.json({
      isRunning: !!active,
      activeStatus: active?.status ?? null,
      lastTrigger: last ? {
        status: last.status,
        requestedAt: last.requestedAt,
        completedAt: last.completedAt,
        result: last.result,
      } : null,
    });
  } catch (error) {
    console.error('Error fetching analyst trigger status:', error);
    return NextResponse.json(
      { isRunning: false, activeStatus: null, lastTrigger: null },
      { status: 200 }
    );
  }
}
