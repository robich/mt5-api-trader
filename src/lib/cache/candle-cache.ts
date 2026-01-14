import { prisma } from '../db';
import { Candle, Timeframe, TIMEFRAME_MINUTES } from '../types';

interface DateRange {
  start: Date;
  end: Date;
}

interface CacheStats {
  totalCandles: number;
  cacheHits: number;
  cacheMisses: number;
  fetchedFromApi: number;
}

class CandleCache {
  private stats: CacheStats = {
    totalCandles: 0,
    cacheHits: 0,
    cacheMisses: 0,
    fetchedFromApi: 0,
  };

  /**
   * Get historical candles, checking cache first and only fetching missing data from API
   */
  async getHistoricalCandles(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date,
    fetchFromApi: (symbol: string, timeframe: Timeframe, start: Date, end: Date) => Promise<Candle[]>
  ): Promise<Candle[]> {
    // First, get all cached candles for this range
    const cachedCandles = await this.getCachedCandles(symbol, timeframe, startDate, endDate);

    // Find gaps in the cached data
    const missingRanges = this.findMissingRanges(
      cachedCandles,
      startDate,
      endDate,
      timeframe
    );

    if (missingRanges.length === 0) {
      // All data is cached
      this.stats.cacheHits++;
      console.log(`[Cache] Full cache hit for ${symbol} ${timeframe}: ${cachedCandles.length} candles`);
      return cachedCandles;
    }

    this.stats.cacheMisses++;
    console.log(`[Cache] Partial cache miss for ${symbol} ${timeframe}: ${missingRanges.length} ranges to fetch`);

    // Fetch missing ranges from API
    const newCandles: Candle[] = [];
    for (const range of missingRanges) {
      console.log(`[Cache] Fetching ${symbol} ${timeframe} from ${range.start.toISOString()} to ${range.end.toISOString()}`);
      const fetched = await fetchFromApi(symbol, timeframe, range.start, range.end);
      if (fetched.length > 0) {
        newCandles.push(...fetched);
        this.stats.fetchedFromApi += fetched.length;
      }
    }

    // Store newly fetched candles in cache
    if (newCandles.length > 0) {
      await this.storeCandles(newCandles, symbol, timeframe);
    }

    // Merge cached and new candles, sort by time
    const allCandles = [...cachedCandles, ...newCandles];
    allCandles.sort((a, b) => a.time.getTime() - b.time.getTime());

    // Remove duplicates (in case of overlap)
    const uniqueCandles = this.removeDuplicates(allCandles);

    this.stats.totalCandles = uniqueCandles.length;
    return uniqueCandles;
  }

  /**
   * Query cached candles from the database
   */
  async getCachedCandles(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<Candle[]> {
    const cached = await prisma.cachedCandle.findMany({
      where: {
        symbol,
        timeframe,
        time: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { time: 'asc' },
    });

    return cached.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      symbol: c.symbol,
      timeframe: c.timeframe as Timeframe,
    }));
  }

  /**
   * Store candles in the cache (upsert to handle duplicates)
   */
  async storeCandles(
    candles: Candle[],
    symbol: string,
    timeframe: Timeframe
  ): Promise<void> {
    if (candles.length === 0) return;

    console.log(`[Cache] Storing ${candles.length} candles for ${symbol} ${timeframe}`);

    // Use transactions for better performance
    const batchSize = 500;
    for (let i = 0; i < candles.length; i += batchSize) {
      const batch = candles.slice(i, i + batchSize);

      await prisma.$transaction(
        batch.map((candle) =>
          prisma.cachedCandle.upsert({
            where: {
              symbol_timeframe_time: {
                symbol,
                timeframe,
                time: candle.time,
              },
            },
            update: {
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
              fetchedAt: new Date(),
            },
            create: {
              symbol,
              timeframe,
              time: candle.time,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            },
          })
        )
      );
    }
  }

  /**
   * Find gaps in the cached data that need to be fetched from API
   */
  findMissingRanges(
    candles: Candle[],
    startDate: Date,
    endDate: Date,
    timeframe: Timeframe
  ): DateRange[] {
    if (candles.length === 0) {
      return [{ start: startDate, end: endDate }];
    }

    const missingRanges: DateRange[] = [];
    const intervalMs = TIMEFRAME_MINUTES[timeframe] * 60 * 1000;
    const tolerance = intervalMs * 1.5; // Allow some tolerance for gaps

    // Check if there's a gap at the beginning
    const firstCandleTime = candles[0].time.getTime();
    if (firstCandleTime - startDate.getTime() > tolerance) {
      missingRanges.push({
        start: startDate,
        end: new Date(firstCandleTime - intervalMs),
      });
    }

    // Check for gaps in the middle
    for (let i = 1; i < candles.length; i++) {
      const prevTime = candles[i - 1].time.getTime();
      const currTime = candles[i].time.getTime();
      const gap = currTime - prevTime;

      // If gap is larger than expected (accounting for weekends/market closures)
      // We use 3x interval as threshold to avoid flagging normal weekend gaps
      if (gap > intervalMs * 3) {
        missingRanges.push({
          start: new Date(prevTime + intervalMs),
          end: new Date(currTime - intervalMs),
        });
      }
    }

    // Check if there's a gap at the end
    const lastCandleTime = candles[candles.length - 1].time.getTime();
    if (endDate.getTime() - lastCandleTime > tolerance) {
      missingRanges.push({
        start: new Date(lastCandleTime + intervalMs),
        end: endDate,
      });
    }

    return missingRanges;
  }

  /**
   * Remove duplicate candles (same time)
   */
  private removeDuplicates(candles: Candle[]): Candle[] {
    const seen = new Set<string>();
    return candles.filter((c) => {
      const key = c.time.getTime().toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      totalCandles: 0,
      cacheHits: 0,
      cacheMisses: 0,
      fetchedFromApi: 0,
    };
  }

  /**
   * Clear cached candles for a specific symbol/timeframe
   */
  async clearCache(symbol?: string, timeframe?: Timeframe): Promise<number> {
    const where: any = {};
    if (symbol) where.symbol = symbol;
    if (timeframe) where.timeframe = timeframe;

    const result = await prisma.cachedCandle.deleteMany({ where });
    console.log(`[Cache] Cleared ${result.count} cached candles`);
    return result.count;
  }

  /**
   * Get cache info (count by symbol/timeframe)
   */
  async getCacheInfo(): Promise<{
    total: number;
    bySymbol: Record<string, number>;
    byTimeframe: Record<string, number>;
  }> {
    const total = await prisma.cachedCandle.count();

    const bySymbolRaw = await prisma.cachedCandle.groupBy({
      by: ['symbol'],
      _count: { symbol: true },
    });

    const byTimeframeRaw = await prisma.cachedCandle.groupBy({
      by: ['timeframe'],
      _count: { timeframe: true },
    });

    const bySymbol: Record<string, number> = {};
    bySymbolRaw.forEach((r) => {
      bySymbol[r.symbol] = r._count.symbol;
    });

    const byTimeframe: Record<string, number> = {};
    byTimeframeRaw.forEach((r) => {
      byTimeframe[r.timeframe] = r._count.timeframe;
    });

    return { total, bySymbol, byTimeframe };
  }

  /**
   * Get the date range of cached data for a symbol/timeframe
   */
  async getCachedRange(
    symbol: string,
    timeframe: Timeframe
  ): Promise<{ oldest: Date | null; newest: Date | null }> {
    const oldest = await prisma.cachedCandle.findFirst({
      where: { symbol, timeframe },
      orderBy: { time: 'asc' },
      select: { time: true },
    });

    const newest = await prisma.cachedCandle.findFirst({
      where: { symbol, timeframe },
      orderBy: { time: 'desc' },
      select: { time: true },
    });

    return {
      oldest: oldest?.time || null,
      newest: newest?.time || null,
    };
  }
}

// Export singleton instance
export const candleCache = new CandleCache();
export default candleCache;
