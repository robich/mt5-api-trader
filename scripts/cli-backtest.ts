#!/usr/bin/env npx ts-node
/**
 * CLI Backtesting Tool
 *
 * Run backtests from the command line with configurable parameters.
 * Tests different strategies and parameter combinations for optimization.
 *
 * Usage:
 *   npx ts-node scripts/cli-backtest.ts --symbol XAUUSD.s --strategy ORDER_BLOCK
 *   npx ts-node scripts/cli-backtest.ts --optimize --symbol XAUUSD.s
 *   npx ts-node scripts/cli-backtest.ts --compare-all --symbol XAUUSD.s
 */

import { config } from 'dotenv';
config(); // Load .env

import { BacktestEngine, BacktestResult } from '../src/lib/backtest/engine';
import { metaApiClient } from '../src/lib/metaapi/client';
import { BacktestConfig, StrategyType, Timeframe, KillZoneType } from '../src/lib/types';

// Extended backtest config with additional parameters
interface ExtendedBacktestConfig extends BacktestConfig {
  // OTE (Optimal Trade Entry) settings
  requireOTE?: boolean;
  oteThreshold?: number; // Fib level (0.618, 0.705, 0.786)

  // Entry quality tiers
  minOBScore?: number;
  relaxedScoreThreshold?: number; // Score above which simple touch entry is allowed

  // Risk/Reward modes
  rrMode?: 'fixed' | 'atr_trailing' | 'structure';
  fixedRR?: number;
  atrMultiplier?: number;

  // Position management
  maxSlPips?: number;
  maxConcurrentTrades?: number;
  maxDrawdownPercent?: number;
  maxDailyDrawdownPercent?: number;

  // Session filters
  tradingSessions?: string[];
  useCooldowns?: boolean;
}

interface BacktestVariation {
  name: string;
  config: Partial<ExtendedBacktestConfig>;
}

// Parse command line arguments
function parseArgs(): {
  symbol: string;
  strategy?: StrategyType;
  startDate: string;
  endDate: string;
  balance: number;
  risk: number;
  optimize: boolean;
  compareAll: boolean;
  verbose: boolean;
} {
  const args = process.argv.slice(2);
  const result: any = {
    symbol: 'XAUUSD.s',
    strategy: undefined,
    startDate: getDefaultStartDate(),
    endDate: getDefaultEndDate(),
    balance: 10000,
    risk: 2,
    optimize: false,
    compareAll: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--symbol':
      case '-s':
        result.symbol = args[++i];
        break;
      case '--strategy':
        result.strategy = args[++i] as StrategyType;
        break;
      case '--start':
        result.startDate = args[++i];
        break;
      case '--end':
        result.endDate = args[++i];
        break;
      case '--balance':
      case '-b':
        result.balance = parseFloat(args[++i]);
        break;
      case '--risk':
      case '-r':
        result.risk = parseFloat(args[++i]);
        break;
      case '--optimize':
      case '-o':
        result.optimize = true;
        break;
      case '--compare-all':
      case '-c':
        result.compareAll = true;
        break;
      case '--verbose':
      case '-v':
        result.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return result;
}

function getDefaultStartDate(): string {
  const date = new Date();
  date.setMonth(date.getMonth() - 3); // 3 months ago
  return date.toISOString().split('T')[0];
}

function getDefaultEndDate(): string {
  return new Date().toISOString().split('T')[0];
}

function printHelp(): void {
  console.log(`
CLI Backtest Tool - MT5 API Trader
==================================

Usage:
  npx ts-node scripts/cli-backtest.ts [options]

Options:
  --symbol, -s <symbol>     Trading symbol (default: XAUUSD.s)
  --strategy <name>         Strategy to test: ORDER_BLOCK, LIQUIDITY_SWEEP, BOS, FBO_CLASSIC, FBO_SWEEP, FBO_STRUCTURE
  --start <date>            Start date (YYYY-MM-DD, default: 3 months ago)
  --end <date>              End date (YYYY-MM-DD, default: today)
  --balance, -b <amount>    Initial balance (default: 10000)
  --risk, -r <percent>      Risk per trade % (default: 2)
  --optimize, -o            Run parameter optimization
  --compare-all, -c         Compare all strategy variations
  --verbose, -v             Show detailed output
  --help, -h                Show this help

Examples:
  # Basic backtest
  npx ts-node scripts/cli-backtest.ts --symbol XAUUSD.s --strategy ORDER_BLOCK

  # Optimize parameters
  npx ts-node scripts/cli-backtest.ts --optimize --symbol XAUUSD.s

  # Compare all variations
  npx ts-node scripts/cli-backtest.ts --compare-all --symbol XAUUSD.s --start 2024-01-01
`);
}

// Strategy variations based on the winning findings
const STRATEGY_VARIATIONS: BacktestVariation[] = [
  // OTE Filter comparisons
  {
    name: 'OTE On | Fixed 2:1 RR',
    config: {
      requireOTE: true,
      rrMode: 'fixed',
      fixedRR: 2,
      minOBScore: 65,
      useKillZones: true,
    },
  },
  {
    name: 'OTE Off | Fixed 2:1 RR',
    config: {
      requireOTE: false,
      rrMode: 'fixed',
      fixedRR: 2,
      minOBScore: 65,
      useKillZones: true,
    },
  },
  // RR Mode comparisons
  {
    name: 'Fixed 2:1 RR | OTE On',
    config: {
      requireOTE: true,
      rrMode: 'fixed',
      fixedRR: 2,
      minOBScore: 65,
      useKillZones: true,
    },
  },
  {
    name: 'Fixed 3:1 RR | OTE On',
    config: {
      requireOTE: true,
      rrMode: 'fixed',
      fixedRR: 3,
      minOBScore: 65,
      useKillZones: true,
    },
  },
  {
    name: 'ATR Trailing | OTE On',
    config: {
      requireOTE: true,
      rrMode: 'atr_trailing',
      atrMultiplier: 2,
      minOBScore: 65,
      useKillZones: true,
    },
  },
  // OB Score tier comparisons
  {
    name: 'Relaxed >=70 | OTE On | Fixed RR',
    config: {
      requireOTE: true,
      rrMode: 'fixed',
      fixedRR: 2,
      minOBScore: 70,
      relaxedScoreThreshold: 70,
      useKillZones: true,
    },
  },
  {
    name: 'Strict >=65 | OTE On | Fixed RR',
    config: {
      requireOTE: true,
      rrMode: 'fixed',
      fixedRR: 2,
      minOBScore: 65,
      relaxedScoreThreshold: 70,
      useKillZones: true,
    },
  },
  {
    name: 'Strict >=75 | OTE On | Fixed RR',
    config: {
      requireOTE: true,
      rrMode: 'fixed',
      fixedRR: 2,
      minOBScore: 75,
      relaxedScoreThreshold: 80,
      useKillZones: true,
    },
  },
  // Kill zone comparisons
  {
    name: 'All Sessions | OTE On',
    config: {
      requireOTE: true,
      rrMode: 'fixed',
      fixedRR: 2,
      minOBScore: 65,
      useKillZones: false,
    },
  },
  {
    name: 'London + NY Only | OTE On',
    config: {
      requireOTE: true,
      rrMode: 'fixed',
      fixedRR: 2,
      minOBScore: 65,
      useKillZones: true,
      killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'] as KillZoneType[],
    },
  },
  // Drawdown protection
  {
    name: '6% Daily DD Limit | OTE On',
    config: {
      requireOTE: true,
      rrMode: 'fixed',
      fixedRR: 2,
      minOBScore: 65,
      useKillZones: true,
      maxDailyDrawdownPercent: 6,
    },
  },
  {
    name: '4% Daily DD Limit | OTE On',
    config: {
      requireOTE: true,
      rrMode: 'fixed',
      fixedRR: 2,
      minOBScore: 65,
      useKillZones: true,
      maxDailyDrawdownPercent: 4,
    },
  },
];

// Results interface for comparison
interface BacktestSummary {
  name: string;
  trades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  totalPips: number;
  maxDrawdown: number;
  sharpeRatio: number;
  avgRR: number;
}

async function runSingleBacktest(
  symbol: string,
  strategy: StrategyType,
  startDate: Date,
  endDate: Date,
  balance: number,
  riskPercent: number,
  extendedConfig: Partial<ExtendedBacktestConfig> = {},
  verbose: boolean = false
): Promise<BacktestResult> {
  const config: BacktestConfig = {
    strategy,
    symbol,
    startDate,
    endDate,
    initialBalance: balance,
    riskPercent,
    useTickData: false,
    useKillZones: extendedConfig.useKillZones ?? true,
    killZones: extendedConfig.killZones,
    requireLiquiditySweep: extendedConfig.requireOTE ?? false,
    requirePremiumDiscount: extendedConfig.requireOTE ?? false,
  };

  // Add maxDailyDrawdownPercent if specified
  if (extendedConfig.maxDailyDrawdownPercent) {
    (config as any).maxDailyDrawdownPercent = extendedConfig.maxDailyDrawdownPercent;
  }

  // Create progress callback for verbose mode
  const onProgress = verbose
    ? (progress: any) => {
        if (progress.phase === 'analyzing' && progress.progress % 10 === 0) {
          process.stdout.write(`\rProgress: ${progress.progress}% | Trades: ${progress.tradesExecuted} | Win Rate: ${progress.winRate.toFixed(1)}%`);
        }
      }
    : undefined;

  const engine = new BacktestEngine(config, onProgress);

  // Fetch historical data
  if (verbose) console.log('Fetching historical data...');

  const [htfCandles, mtfCandles, ltfCandles] = await Promise.all([
    metaApiClient.getHistoricalCandles(symbol, 'H4' as Timeframe, startDate, endDate),
    metaApiClient.getHistoricalCandles(symbol, 'H1' as Timeframe, startDate, endDate),
    metaApiClient.getHistoricalCandles(symbol, 'M15' as Timeframe, startDate, endDate),
  ]);

  if (verbose) {
    console.log(`\nCandles fetched: H4=${htfCandles.length}, H1=${mtfCandles.length}, M15=${ltfCandles.length}`);
  }

  const result = await engine.runCandleBacktest(htfCandles, mtfCandles, ltfCandles);

  if (verbose) {
    console.log('\n');
  }

  return result;
}

function calculatePips(trades: any[], symbol: string): number {
  const pipSize = symbol.includes('JPY') ? 0.01 : symbol.includes('XAU') ? 0.1 : symbol.includes('BTC') ? 1 : 0.0001;

  return trades.reduce((total, trade) => {
    const pips = Math.abs(trade.exitPrice - trade.entryPrice) / pipSize;
    return total + (trade.isWinner ? pips : -pips);
  }, 0);
}

function formatSummary(result: BacktestResult, name: string): BacktestSummary {
  return {
    name,
    trades: result.metrics.totalTrades,
    winRate: result.metrics.winRate,
    profitFactor: result.metrics.profitFactor,
    totalPnl: result.metrics.totalPnl,
    totalPips: calculatePips(result.trades, result.config.symbol),
    maxDrawdown: result.metrics.maxDrawdownPercent,
    sharpeRatio: result.metrics.sharpeRatio,
    avgRR: result.metrics.averageRR,
  };
}

function printResultsTable(summaries: BacktestSummary[]): void {
  // Sort by total PnL descending
  const sorted = [...summaries].sort((a, b) => b.totalPnl - a.totalPnl);

  console.log('\n' + '='.repeat(120));
  console.log('BACKTEST COMPARISON RESULTS');
  console.log('='.repeat(120));

  // Header
  console.log(
    'Strategy'.padEnd(40) +
    'Trades'.padStart(8) +
    'Win%'.padStart(8) +
    'PF'.padStart(8) +
    'Pips'.padStart(10) +
    'PnL $'.padStart(12) +
    'MaxDD%'.padStart(8) +
    'Sharpe'.padStart(8) +
    'AvgRR'.padStart(8)
  );
  console.log('-'.repeat(120));

  // Rows
  for (const s of sorted) {
    const pnlColor = s.totalPnl >= 0 ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';

    console.log(
      s.name.substring(0, 39).padEnd(40) +
      s.trades.toString().padStart(8) +
      s.winRate.toFixed(1).padStart(8) +
      (isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'N/A').padStart(8) +
      s.totalPips.toFixed(0).padStart(10) +
      `${pnlColor}${s.totalPnl.toFixed(0)}${reset}`.padStart(22) +
      s.maxDrawdown.toFixed(1).padStart(8) +
      s.sharpeRatio.toFixed(2).padStart(8) +
      s.avgRR.toFixed(2).padStart(8)
    );
  }

  console.log('='.repeat(120));

  // Winner announcement
  if (sorted.length > 0) {
    const winner = sorted[0];
    console.log(`\n${'*'.repeat(50)}`);
    console.log(`  WINNING STRATEGY: "${winner.name}"`);
    console.log(`  Win Rate: ${winner.winRate.toFixed(1)}% | Profit Factor: ${winner.profitFactor.toFixed(2)} | Total PnL: $${winner.totalPnl.toFixed(2)}`);
    console.log(`${'*'.repeat(50)}\n`);
  }
}

function printKeyFindings(summaries: BacktestSummary[]): void {
  console.log('\n' + '='.repeat(60));
  console.log('KEY FINDINGS');
  console.log('='.repeat(60));

  // OTE Analysis
  const oteOn = summaries.filter(s => s.name.includes('OTE On'));
  const oteOff = summaries.filter(s => s.name.includes('OTE Off'));

  if (oteOn.length > 0 && oteOff.length > 0) {
    const avgWinRateOn = oteOn.reduce((sum, s) => sum + s.winRate, 0) / oteOn.length;
    const avgWinRateOff = oteOff.reduce((sum, s) => sum + s.winRate, 0) / oteOff.length;

    console.log('\nOTE Filter Impact:');
    console.log(`  OTE On:  ${avgWinRateOn.toFixed(1)}% avg win rate`);
    console.log(`  OTE Off: ${avgWinRateOff.toFixed(1)}% avg win rate`);
    console.log(`  Conclusion: OTE filter ${avgWinRateOn > avgWinRateOff ? 'IMPROVES' : 'REDUCES'} performance`);
  }

  // RR Mode Analysis
  const fixedRR = summaries.filter(s => s.name.includes('Fixed') && s.name.includes('RR'));
  const atrTrailing = summaries.filter(s => s.name.includes('ATR Trailing'));

  if (fixedRR.length > 0 && atrTrailing.length > 0) {
    const avgPipsFixed = fixedRR.reduce((sum, s) => sum + s.totalPips, 0) / fixedRR.length;
    const avgPipsATR = atrTrailing.reduce((sum, s) => sum + s.totalPips, 0) / atrTrailing.length;

    console.log('\nRR Mode Comparison:');
    console.log(`  Fixed RR:     ${avgPipsFixed.toFixed(0)} avg pips`);
    console.log(`  ATR Trailing: ${avgPipsATR.toFixed(0)} avg pips`);
    console.log(`  Conclusion: ${avgPipsFixed > avgPipsATR ? 'Fixed RR' : 'ATR Trailing'} is more profitable`);
  }

  // Session Analysis
  const allSessions = summaries.filter(s => s.name.includes('All Sessions'));
  const killZones = summaries.filter(s => s.name.includes('London + NY'));

  if (allSessions.length > 0 && killZones.length > 0) {
    const avgWRAll = allSessions[0].winRate;
    const avgWRKZ = killZones[0].winRate;

    console.log('\nSession Filter Impact:');
    console.log(`  All Sessions:    ${avgWRAll.toFixed(1)}% win rate`);
    console.log(`  Kill Zones Only: ${avgWRKZ.toFixed(1)}% win rate`);
    console.log(`  Conclusion: Kill Zone filter ${avgWRKZ > avgWRAll ? 'IMPROVES' : 'REDUCES'} quality`);
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

async function main(): Promise<void> {
  const args = parseArgs();

  console.log(`
╔════════════════════════════════════════════════════════════╗
║              CLI BACKTEST TOOL - MT5 API TRADER            ║
╠════════════════════════════════════════════════════════════╣
║  Symbol:    ${args.symbol.padEnd(46)}║
║  Period:    ${args.startDate} to ${args.endDate}                  ║
║  Balance:   $${args.balance.toString().padEnd(45)}║
║  Risk:      ${args.risk}% per trade                                 ║
╚════════════════════════════════════════════════════════════╝
`);

  try {
    // Connect to MetaAPI
    console.log('Connecting to MetaAPI...');
    await metaApiClient.connectAccountOnly();
    console.log('Connected successfully.\n');

    const startDate = new Date(args.startDate);
    const endDate = new Date(args.endDate);
    const summaries: BacktestSummary[] = [];

    if (args.compareAll || args.optimize) {
      // Run all strategy variations
      console.log(`Running ${STRATEGY_VARIATIONS.length} strategy variations...\n`);

      for (let i = 0; i < STRATEGY_VARIATIONS.length; i++) {
        const variation = STRATEGY_VARIATIONS[i];
        console.log(`[${i + 1}/${STRATEGY_VARIATIONS.length}] Testing: ${variation.name}`);

        try {
          const result = await runSingleBacktest(
            args.symbol,
            args.strategy || 'ORDER_BLOCK',
            startDate,
            endDate,
            args.balance,
            args.risk,
            variation.config,
            args.verbose
          );

          summaries.push(formatSummary(result, variation.name));

          console.log(`    Trades: ${result.metrics.totalTrades} | Win Rate: ${result.metrics.winRate.toFixed(1)}% | PnL: $${result.metrics.totalPnl.toFixed(2)}`);
        } catch (error: any) {
          console.log(`    Error: ${error.message}`);
        }

        // Small delay between backtests
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Print comparison table
      printResultsTable(summaries);

      // Print key findings
      if (args.compareAll) {
        printKeyFindings(summaries);
      }

    } else if (args.strategy) {
      // Run single strategy backtest
      console.log(`Running single backtest: ${args.strategy}\n`);

      const result = await runSingleBacktest(
        args.symbol,
        args.strategy,
        startDate,
        endDate,
        args.balance,
        args.risk,
        {},
        args.verbose
      );

      // Print detailed results
      console.log('\n' + '='.repeat(60));
      console.log('BACKTEST RESULTS');
      console.log('='.repeat(60));
      console.log(`Strategy:       ${result.config.strategy}`);
      console.log(`Symbol:         ${result.config.symbol}`);
      console.log(`Period:         ${startDate.toDateString()} - ${endDate.toDateString()}`);
      console.log('-'.repeat(60));
      console.log(`Total Trades:   ${result.metrics.totalTrades}`);
      console.log(`Winning:        ${result.metrics.winningTrades}`);
      console.log(`Losing:         ${result.metrics.losingTrades}`);
      console.log(`Win Rate:       ${result.metrics.winRate.toFixed(2)}%`);
      console.log(`Profit Factor:  ${result.metrics.profitFactor.toFixed(2)}`);
      console.log(`Average RR:     ${result.metrics.averageRR.toFixed(2)}`);
      console.log('-'.repeat(60));
      console.log(`Initial Balance: $${result.config.initialBalance.toFixed(2)}`);
      console.log(`Final Balance:   $${result.metrics.finalBalance.toFixed(2)}`);
      console.log(`Total PnL:       $${result.metrics.totalPnl.toFixed(2)} (${result.metrics.totalPnlPercent.toFixed(2)}%)`);
      console.log(`Max Drawdown:    ${result.metrics.maxDrawdownPercent.toFixed(2)}%`);
      console.log(`Sharpe Ratio:    ${result.metrics.sharpeRatio.toFixed(2)}`);
      console.log('='.repeat(60) + '\n');

      // Print recent trades
      if (args.verbose && result.trades.length > 0) {
        console.log('\nRecent Trades:');
        console.log('-'.repeat(80));
        const recentTrades = result.trades.slice(-10);
        for (const trade of recentTrades) {
          const emoji = trade.isWinner ? '✓' : '✗';
          console.log(
            `${emoji} ${trade.direction.padEnd(4)} | Entry: ${trade.entryPrice.toFixed(2)} | Exit: ${trade.exitPrice.toFixed(2)} | PnL: $${trade.pnl.toFixed(2)} | ${trade.exitReason}`
          );
        }
      }
    } else {
      // Default: run winning strategy configuration
      console.log('Running with optimal configuration...\n');

      const optimalConfig: Partial<ExtendedBacktestConfig> = {
        requireOTE: true,
        rrMode: 'fixed',
        fixedRR: 2,
        minOBScore: 70,
        relaxedScoreThreshold: 70,
        useKillZones: true,
        killZones: ['LONDON_OPEN', 'NY_OPEN', 'LONDON_NY_OVERLAP'] as KillZoneType[],
        maxDailyDrawdownPercent: 6,
      };

      const result = await runSingleBacktest(
        args.symbol,
        'ORDER_BLOCK',
        startDate,
        endDate,
        args.balance,
        args.risk,
        optimalConfig,
        true
      );

      summaries.push(formatSummary(result, 'Optimal Config'));
      printResultsTable(summaries);
    }

  } catch (error: any) {
    console.error('\nError:', error.message);
    if (args.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run main function
main().catch(console.error);
