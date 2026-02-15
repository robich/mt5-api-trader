import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol');
    const signalOnly = searchParams.get('signalOnly') === 'true';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: any = {};

    if (symbol) {
      where.symbol = symbol;
    }

    if (signalOnly) {
      where.signalGenerated = true;
    }

    const [scans, total] = await Promise.all([
      prisma.analysisScan.findMany({
        where,
        orderBy: { scannedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.analysisScan.count({ where }),
    ]);

    return NextResponse.json({ scans, total });
  } catch (error) {
    console.error('Analysis history API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analysis history' },
      { status: 500 }
    );
  }
}
