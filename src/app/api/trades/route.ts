import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { tradingBot } from '@/services/bot';
import { tradeManager } from '@/lib/risk/trade-manager';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const symbol = searchParams.get('symbol');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // When bot is running and requesting closed trades, use MetaAPI deals as source of truth
    if (status === 'CLOSED') {
      try {
        const botStatus = tradingBot.getStatus();
        if (botStatus.isRunning) {
          const result = await tradingBot.getClosedTradesFromDeals(limit, offset, symbol || undefined);
          return NextResponse.json({
            trades: result.trades,
            total: result.total,
            limit,
            offset,
          });
        }
      } catch (error) {
        console.error('Error fetching deals for closed trades, falling back to DB:', error);
        // Fall through to DB query below
      }
    }

    // DB path: used for OPEN trades, offline closed trades, or as fallback
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
        orderBy: status === 'CLOSED' ? { closeTime: 'desc' } : { openTime: 'desc' },
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

          // If DB has no open trades but MetaAPI has positions, sync them into DB
          if (trades.length === 0 && positions.length > 0) {
            console.log(`[Trades API] DB has 0 open trades but MetaAPI has ${positions.length} positions, syncing...`);
            await tradeManager.syncWithBrokerPositions(positions);

            // Re-query DB after sync
            const syncedTrades = await prisma.trade.findMany({
              where,
              orderBy: { openTime: 'desc' },
              take: limit,
              skip: offset,
              include: { signal: true },
            });
            enrichedTrades = syncedTrades.map((trade) => {
              const position = positions.find((p) => p.id === trade.mt5PositionId);
              if (position) {
                return { ...trade, currentPnl: (position.profit || 0) + (position.swap || 0), currentPrice: position.currentPrice || trade.entryPrice };
              }
              return trade;
            });

            return NextResponse.json({
              trades: enrichedTrades,
              total: enrichedTrades.length,
              limit,
              offset,
            });
          }

          enrichedTrades = trades.map((trade) => {
            // Match by mt5PositionId
            const position = positions.find((p) => p.id === trade.mt5PositionId);
            if (position) {
              return {
                ...trade,
                currentPnl: (position.profit || 0) + (position.swap || 0),
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

    // For closed trades from DB (offline), deduplicate by mt5PositionId
    if (status === 'CLOSED') {
      const seen = new Set<string>();
      enrichedTrades = enrichedTrades.filter((trade) => {
        if (!trade.mt5PositionId) return true; // Keep trades without positionId
        if (seen.has(trade.mt5PositionId)) return false;
        seen.add(trade.mt5PositionId);
        return true;
      });
    }

    return NextResponse.json({
      trades: enrichedTrades,
      total: status === 'CLOSED' ? enrichedTrades.length : total,
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
