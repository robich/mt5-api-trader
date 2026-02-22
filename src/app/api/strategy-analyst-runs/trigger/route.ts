import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
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
