import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const [runs, total] = await Promise.all([
      prisma.strategyAnalystRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.strategyAnalystRun.count(),
    ]);

    return NextResponse.json({ runs, total });
  } catch (error) {
    console.error('Error fetching strategy analyst runs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch strategy analyst runs' },
      { status: 500 }
    );
  }
}
