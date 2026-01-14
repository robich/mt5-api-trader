import { NextRequest, NextResponse } from 'next/server';
import { metaApiClient } from '@/lib/metaapi/client';
import { Timeframe } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const timeframe = searchParams.get('timeframe') as Timeframe;
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  if (!symbol || !timeframe || !startDate || !endDate) {
    return NextResponse.json(
      { error: 'Missing required parameters: symbol, timeframe, startDate, endDate' },
      { status: 400 }
    );
  }

  // Validate timeframe
  const validTimeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];
  if (!validTimeframes.includes(timeframe)) {
    return NextResponse.json(
      { error: `Invalid timeframe. Valid options: ${validTimeframes.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    await metaApiClient.connectAccountOnly();

    const start = new Date(startDate);
    const end = new Date(endDate);

    const candles = await metaApiClient.getHistoricalCandles(symbol, timeframe, start, end);

    return NextResponse.json({
      symbol,
      timeframe,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      count: candles.length,
      candles: candles.map((c) => ({
        time: c.time.toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
    });
  } catch (error: any) {
    console.error('Error fetching candles:', error);
    return NextResponse.json(
      { error: `Failed to fetch candles: ${error.message}` },
      { status: 500 }
    );
  }
}
