import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { tradingBot } from '@/services/bot';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const symbol = searchParams.get('symbol');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (symbol) {
      where.symbol = symbol;
    }

    const [trades, total] = await Promise.all([
      prisma.trade.findMany({
        where,
        orderBy: { openTime: 'desc' },
        take: limit,
        skip: offset,
        include: {
          signal: true,
        },
      }),
      prisma.trade.count({ where }),
    ]);

    // For open trades, fetch current P&L from broker positions
    let enrichedTrades = trades;
    if (status === 'OPEN') {
      try {
        const botStatus = tradingBot.getStatus();
        if (botStatus.isRunning) {
          const positions = await tradingBot.getPositions();

          enrichedTrades = trades.map((trade) => {
            // Match by mt5PositionId
            const position = positions.find((p) => p.id === trade.mt5PositionId);
            if (position) {
              return {
                ...trade,
                currentPnl: position.profit || 0,
                currentPrice: position.currentPrice || trade.entryPrice,
              };
            }
            return trade;
          });
        }
      } catch (error) {
        console.error('Error fetching positions for P&L:', error);
        // Continue with trades without current P&L
      }
    }

    return NextResponse.json({
      trades: enrichedTrades,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Trades API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trades' },
      { status: 500 }
    );
  }
}
