import { NextRequest, NextResponse } from 'next/server';
import { metaApiClient } from '@/lib/metaapi/client';
import { Timeframe } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Map our timeframes to Binance intervals
const BINANCE_INTERVALS: Record<string, string> = {
  M1: '1m', M5: '5m', M15: '15m', M30: '30m',
  H1: '1h', H4: '4h', D1: '1d', W1: '1w',
};

// Map symbols to Binance pairs
const BINANCE_SYMBOLS: Record<string, string> = {
  BTCUSD: 'BTCUSDT',
  ETHUSD: 'ETHUSDT',
};

interface CandleResponse {
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  count: number;
  source: string;
  candles: { time: string; open: number; high: number; low: number; close: number; volume: number }[];
}

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

  const validTimeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];
  if (!validTimeframes.includes(timeframe)) {
    return NextResponse.json(
      { error: `Invalid timeframe. Valid options: ${validTimeframes.join(', ')}` },
      { status: 400 }
    );
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  // 1. Try MetaAPI first
  try {
    await metaApiClient.connectAccountOnly();
    const candles = await metaApiClient.getHistoricalCandles(symbol, timeframe, start, end);

    if (candles.length > 0) {
      return NextResponse.json({
        symbol, timeframe,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        count: candles.length,
        source: 'metaapi',
        candles: candles.map((c) => ({
          time: c.time.toISOString(),
          open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
        })),
      } satisfies CandleResponse);
    }
  } catch (error: any) {
    console.warn('[Candles] MetaAPI failed, trying fallback:', error.message);
  }

  // 2. Fallback: Binance for crypto symbols
  const normalizedSymbol = symbol.replace(/\.s$/i, '').toUpperCase();
  const binancePair = BINANCE_SYMBOLS[normalizedSymbol];

  if (binancePair) {
    try {
      const candles = await fetchBinanceCandles(binancePair, timeframe, start, end);
      if (candles.length > 0) {
        return NextResponse.json({
          symbol, timeframe,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          count: candles.length,
          source: 'binance',
          candles,
        } satisfies CandleResponse);
      }
    } catch (error: any) {
      console.warn('[Candles] Binance fallback failed:', error.message);
    }
  }

  // 3. No data available
  return NextResponse.json({
    symbol, timeframe,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    count: 0,
    source: 'none',
    candles: [],
  } satisfies CandleResponse);
}

async function fetchBinanceCandles(
  binanceSymbol: string,
  timeframe: Timeframe,
  start: Date,
  end: Date,
): Promise<{ time: string; open: number; high: number; low: number; close: number; volume: number }[]> {
  const interval = BINANCE_INTERVALS[timeframe];
  if (!interval) return [];

  const allCandles: { time: string; open: number; high: number; low: number; close: number; volume: number }[] = [];
  let currentStartMs = start.getTime();
  const endMs = end.getTime();

  // Binance returns max 1000 candles per request, paginate if needed
  while (currentStartMs < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&startTime=${currentStartMs}&endTime=${endMs}&limit=1000`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data: any[][] = await response.json();
    if (!data || data.length === 0) break;

    for (const kline of data) {
      // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
      const openTime = kline[0] as number;
      if (openTime > endMs) break;

      allCandles.push({
        time: new Date(openTime).toISOString(),
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
      });
    }

    // Move to next batch
    const lastOpenTime = data[data.length - 1][0] as number;
    if (lastOpenTime <= currentStartMs) break; // stuck
    currentStartMs = lastOpenTime + 1;

    if (data.length < 1000) break; // last page

    // Rate limit courtesy
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  console.log(`[Candles] Binance returned ${allCandles.length} candles for ${binanceSymbol} ${timeframe}`);
  return allCandles;
}
