import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { metaApiClient } from '@/lib/metaapi/client';
import { runBacktest, BacktestResult } from '@/lib/backtest/engine';
import { BacktestConfig, StrategyType, Timeframe } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '10');

    const results = await prisma.backtestResult.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        trades: {
          take: 100,
        },
      },
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Backtest results API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backtest results' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      strategy,
      symbol,
      startDate,
      endDate,
      initialBalance = 10000,
      riskPercent = 2,
      useTickData = false,
    } = body;

    // Validate inputs
    if (!strategy || !symbol || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'Missing required fields: strategy, symbol, startDate, endDate' },
        { status: 400 }
      );
    }

    const validStrategies: StrategyType[] = ['ORDER_BLOCK', 'LIQUIDITY_SWEEP', 'BOS'];
    if (!validStrategies.includes(strategy)) {
      return NextResponse.json(
        { error: `Invalid strategy. Must be one of: ${validStrategies.join(', ')}` },
        { status: 400 }
      );
    }

    console.log(`Starting backtest: ${strategy} on ${symbol} from ${startDate} to ${endDate}`);

    // Use connectAccountOnly for backtesting - doesn't use streaming subscriptions
    await metaApiClient.connectAccountOnly();

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Fetch historical data
    console.log('Fetching historical data...');

    const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
      metaApiClient.getHistoricalCandles(symbol, 'H4' as Timeframe, start, end),
      metaApiClient.getHistoricalCandles(symbol, 'H1' as Timeframe, start, end),
      metaApiClient.getHistoricalCandles(symbol, 'M15' as Timeframe, start, end),
    ]);

    console.log(`Fetched: H4: ${htfCandles.length}, H1: ${mtfCandles.length}, M15: ${ltfCandles.length} candles`);

    if (htfCandles.length < 50 || mtfCandles.length < 100 || ltfCandles.length < 100) {
      return NextResponse.json(
        { error: 'Insufficient historical data for the selected period' },
        { status: 400 }
      );
    }

    // Fetch tick data if requested
    let ticks: any[] = [];
    if (useTickData) {
      console.log('Fetching tick data (this may take a while)...');
      ticks = await metaApiClient.getAllHistoricalTicks(symbol, start, end);
      console.log(`Fetched ${ticks.length} ticks`);
    }

    // Run backtest
    console.log('Running backtest...');

    const config: BacktestConfig = {
      strategy: strategy as StrategyType,
      symbol,
      startDate: start,
      endDate: end,
      initialBalance,
      riskPercent,
      useTickData,
    };

    const result = await runBacktest(config, htfCandles, mtfCandles, ltfCandles, ticks);

    console.log(`Backtest complete: ${result.trades.length} trades, Win rate: ${result.metrics.winRate.toFixed(2)}%`);

    // Save result to database
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

    return NextResponse.json({
      result: savedResult,
      equityCurve: result.equityCurve,
      drawdownCurve: result.drawdownCurve,
    });
  } catch (error) {
    console.error('Backtest API error:', error);
    return NextResponse.json(
      { error: `Backtest failed: ${error}` },
      { status: 500 }
    );
  }
}
