import { NextRequest } from 'next/server';
import { metaApiClient } from '@/lib/metaapi/client';
import { runBacktest, BacktestProgress } from '@/lib/backtest/engine';
import { BacktestConfig, StrategyType, Timeframe } from '@/lib/types';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    strategy,
    symbol,
    startDate,
    endDate,
    initialBalance = 10000,
    riskPercent = 2,
    useTickData = false,
    // SMC Enhancement options
    useKillZones = false,
    killZones,
    requireLiquiditySweep = false,
    requirePremiumDiscount = false,
  } = body;

  // Validate inputs
  if (!strategy || !symbol || !startDate || !endDate) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Phase 1: Connecting
        sendEvent('progress', {
          phase: 'connecting',
          progress: 0,
          message: 'Connecting to MetaAPI...',
        });

        // Use connectAccountOnly for backtesting - doesn't use streaming subscriptions
        await metaApiClient.connectAccountOnly();

        // Phase 2: Fetching data
        sendEvent('progress', {
          phase: 'fetching',
          progress: 5,
          message: 'Fetching historical data...',
        });

        const start = new Date(startDate);
        const end = new Date(endDate);

        // Fetch H4 candles
        sendEvent('progress', {
          phase: 'fetching',
          progress: 10,
          message: 'Fetching H4 candles...',
        });
        const htfCandles = await metaApiClient.getHistoricalCandles(symbol, 'H4' as Timeframe, start, end);

        // Fetch H1 candles
        sendEvent('progress', {
          phase: 'fetching',
          progress: 20,
          message: 'Fetching H1 candles...',
        });
        const mtfCandles = await metaApiClient.getHistoricalCandles(symbol, 'H1' as Timeframe, start, end);

        // Fetch M15 candles
        sendEvent('progress', {
          phase: 'fetching',
          progress: 30,
          message: 'Fetching M15 candles...',
        });
        const ltfCandles = await metaApiClient.getHistoricalCandles(symbol, 'M15' as Timeframe, start, end);

        sendEvent('progress', {
          phase: 'fetching',
          progress: 40,
          message: `Fetched: H4: ${htfCandles.length}, H1: ${mtfCandles.length}, M15: ${ltfCandles.length} candles`,
        });

        if (htfCandles.length < 50 || mtfCandles.length < 100 || ltfCandles.length < 100) {
          sendEvent('error', { error: 'Insufficient historical data for the selected period' });
          controller.close();
          return;
        }

        // Fetch tick data if requested
        let ticks: any[] = [];
        if (useTickData) {
          sendEvent('progress', {
            phase: 'fetching',
            progress: 45,
            message: 'Fetching tick data (this may take a while)...',
          });
          ticks = await metaApiClient.getAllHistoricalTicks(symbol, start, end);
          sendEvent('progress', {
            phase: 'fetching',
            progress: 50,
            message: `Fetched ${ticks.length} ticks`,
          });
        }

        // Phase 3: Running backtest
        const config: BacktestConfig = {
          strategy: strategy as StrategyType,
          symbol,
          startDate: start,
          endDate: end,
          initialBalance,
          riskPercent,
          useTickData,
          // SMC Enhancement options
          useKillZones,
          killZones,
          requireLiquiditySweep,
          requirePremiumDiscount,
        };

        // Progress callback for backtest engine
        const onProgress = (progress: BacktestProgress) => {
          sendEvent('progress', {
            phase: progress.phase,
            progress: 50 + Math.round(progress.progress * 0.45), // Scale to 50-95%
            message: progress.phase === 'analyzing'
              ? `Analyzing ${progress.currentDate?.toLocaleDateString() || ''}...`
              : progress.phase === 'complete'
              ? 'Finalizing results...'
              : 'Initializing backtest...',
            candlesProcessed: progress.candlesProcessed,
            totalCandles: progress.totalCandles,
            currentDate: progress.currentDate,
            // KPIs
            tradesExecuted: progress.tradesExecuted,
            winningTrades: progress.winningTrades,
            losingTrades: progress.losingTrades,
            currentBalance: progress.currentBalance,
            totalPnl: progress.totalPnl,
            winRate: progress.winRate,
            profitFactor: progress.profitFactor,
            maxDrawdown: progress.maxDrawdown,
            lastTradeDirection: progress.lastTradeDirection,
            lastTradeResult: progress.lastTradeResult,
          });
        };

        const result = await runBacktest(config, htfCandles, mtfCandles, ltfCandles, ticks, onProgress);

        // Phase 4: Saving to database
        sendEvent('progress', {
          phase: 'saving',
          progress: 95,
          message: 'Saving results to database...',
        });

        const savedResult = await prisma.backtestResult.create({
          data: {
            strategy,
            symbol,
            startDate: start,
            endDate: end,
            initialBalance,
            finalBalance: result.metrics.finalBalance,
            totalTrades: result.metrics.totalTrades,
            winningTrades: result.metrics.winningTrades,
            losingTrades: result.metrics.losingTrades,
            winRate: result.metrics.winRate,
            profitFactor: result.metrics.profitFactor,
            maxDrawdown: result.metrics.maxDrawdown,
            maxDrawdownPct: result.metrics.maxDrawdownPercent,
            sharpeRatio: result.metrics.sharpeRatio,
            averageWin: result.metrics.averageWin,
            averageLoss: result.metrics.averageLoss,
            averageRR: result.metrics.averageRR,
            totalPnl: result.metrics.totalPnl,
            totalPnlPct: result.metrics.totalPnlPercent,
            trades: {
              create: result.trades.map((t) => ({
                symbol: t.symbol,
                direction: t.direction,
                entryPrice: t.entryPrice,
                exitPrice: t.exitPrice,
                stopLoss: t.stopLoss,
                takeProfit: t.takeProfit,
                lotSize: t.lotSize,
                entryTime: t.entryTime,
                exitTime: t.exitTime,
                pnl: t.pnl,
                pnlPercent: t.pnlPercent,
                isWinner: t.isWinner,
                exitReason: t.exitReason,
              })),
            },
          },
          include: {
            trades: true,
          },
        });

        // Send complete event with full results
        sendEvent('complete', {
          result: savedResult,
          equityCurve: result.equityCurve,
          drawdownCurve: result.drawdownCurve,
        });

      } catch (error) {
        console.error('Backtest stream error:', error);
        sendEvent('error', { error: `Backtest failed: ${error}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
