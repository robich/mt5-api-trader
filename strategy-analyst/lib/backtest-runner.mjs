import { execSync } from 'child_process';
import { join } from 'path';

const SYMBOLS = (process.env.BACKTEST_SYMBOLS || 'BTCUSD,XAUUSD.s,XAGUSD.s').split(',');
const BACKTEST_DAYS = parseInt(process.env.BACKTEST_DAYS || '7');

// Run all strategy variations (0 = all). Previously limited to 30 for low-memory envs.
const BACKTEST_TOP_N = parseInt(process.env.BACKTEST_TOP_N || '0');

// Memory limit for backtest subprocess (must fit alongside parent in container RAM)
const BACKTEST_MAX_MEMORY = process.env.BACKTEST_MAX_MEMORY || '256';

/**
 * Run backtests for all configured symbols and return structured results.
 * @param {string} repoDir - Path to the cloned repository
 * @returns {Object} Results keyed by symbol
 */
export async function runBacktests(repoDir) {
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - BACKTEST_DAYS * 86400000).toISOString().split('T')[0];

  const backtestScript = join(repoDir, 'scripts', 'quick-backtest.mjs');
  const results = {};

  const topFlag = BACKTEST_TOP_N > 0 ? ` --top ${BACKTEST_TOP_N}` : '';

  for (const symbol of SYMBOLS) {
    console.log(`[backtest] Running ${symbol} (${startDate} to ${endDate}, top ${BACKTEST_TOP_N || 'all'} variations)...`);
    try {
      const output = execSync(
        `node --max-old-space-size=${BACKTEST_MAX_MEMORY} "${backtestScript}" --compare-all --tf scalp --symbol ${symbol} --start ${startDate} --end ${endDate}${topFlag}`,
        {
          cwd: repoDir,
          encoding: 'utf-8',
          timeout: 600_000, // 10 min per symbol (all 141 variations)
          env: { ...process.env, NODE_ENV: 'production' },
          maxBuffer: 10 * 1024 * 1024, // 10MB (all variations produce more output)
        }
      );
      results[symbol] = parseBacktestOutput(output, symbol);
    } catch (err) {
      console.error(`[backtest] ${symbol} failed:`, err.message?.substring(0, 300));
      // Include stderr/stdout from the failed command if available
      if (err.stdout) {
        results[symbol] = parseBacktestOutput(err.stdout, symbol);
      } else {
        results[symbol] = { error: err.message, strategies: [] };
      }
    }
  }

  return results;
}

/**
 * Parse the console table output from quick-backtest.mjs.
 * Extracts strategy names and metrics from the table format.
 */
function parseBacktestOutput(output, symbol) {
  const lines = output.split('\n');
  const strategies = [];
  let inTable = false;
  let headerFound = false;

  for (const line of lines) {
    // Detect the header line (contains "Strategy" and "Trades")
    if (line.includes('Strategy') && line.includes('Trades') && line.includes('Win%')) {
      headerFound = true;
      continue;
    }

    // Separator after header
    if (headerFound && line.startsWith('-')) {
      inTable = true;
      continue;
    }

    // End of table
    if (inTable && line.startsWith('=')) {
      inTable = false;
      continue;
    }

    // Parse table rows
    if (inTable && line.trim()) {
      const parsed = parseTableRow(line);
      if (parsed) strategies.push(parsed);
    }
  }

  // Extract winner info
  let winner = null;
  const winnerMatch = output.match(/WINNING STRATEGY: "([^"]+)"/);
  if (winnerMatch) {
    winner = winnerMatch[1];
  }

  // Compute summary
  const summary = strategies.length > 0 ? {
    bestStrategy: winner || strategies[0]?.name,
    bestPnl: Math.max(...strategies.map(s => s.totalPnl)),
    bestWinRate: Math.max(...strategies.map(s => s.winRate)),
    avgPnl: strategies.reduce((s, r) => s + r.totalPnl, 0) / strategies.length,
    avgWinRate: strategies.reduce((s, r) => s + r.winRate, 0) / strategies.length,
    totalStrategies: strategies.length,
  } : null;

  return { symbol, strategies, summary, raw: output };
}

/**
 * Parse a single row of the backtest comparison table.
 * Format: "StrategyName                                Trades  Win%    PF      PnL $    MaxDD%   Final $"
 * Name column is 44 chars wide (increased from 30 to show full strategy names).
 */
function parseTableRow(line) {
  // Strip ANSI color codes
  const clean = line.replace(/\x1b\[\d+m/g, '');

  // Strategy name is first 44 chars, then numeric columns
  const nameColWidth = 44;
  const name = clean.substring(0, nameColWidth).trim();
  if (!name) return null;

  const rest = clean.substring(nameColWidth).trim();
  // Split by whitespace
  const parts = rest.split(/\s+/).filter(Boolean);

  if (parts.length < 5) return null;

  return {
    name,
    totalTrades: parseInt(parts[0]) || 0,
    winRate: parseFloat(parts[1]) || 0,
    profitFactor: parseFloat(parts[2]) || 0,
    totalPnl: parseFloat(parts[3]) || 0,
    maxDrawdown: parseFloat(parts[4]) || 0,
    finalBalance: parseFloat(parts[5]) || 0,
  };
}

/**
 * Compare baseline vs validation backtest results.
 * Returns a comparison object with pass/fail gate checks.
 */
export function compareResults(baseline, validation, gates) {
  const comparison = {};

  for (const symbol of Object.keys(baseline)) {
    if (!validation[symbol] || baseline[symbol].error || validation[symbol].error) {
      comparison[symbol] = { passed: false, reason: 'Missing or errored results' };
      continue;
    }

    const base = baseline[symbol].summary;
    const val = validation[symbol].summary;

    if (!base || !val) {
      comparison[symbol] = { passed: false, reason: 'No summary data' };
      continue;
    }

    const checks = [];

    // PnL decrease check
    if (base.bestPnl > 0) {
      const pnlDecrease = ((base.bestPnl - val.bestPnl) / base.bestPnl) * 100;
      if (pnlDecrease > gates.maxPnlDecreasePercent) {
        checks.push(`PnL decreased ${pnlDecrease.toFixed(1)}% (max ${gates.maxPnlDecreasePercent}%)`);
      }
    }

    // Win rate decrease check
    const wrDecrease = base.bestWinRate - val.bestWinRate;
    if (wrDecrease > gates.maxWinRateDecrease) {
      checks.push(`Win rate decreased ${wrDecrease.toFixed(1)}pp (max ${gates.maxWinRateDecrease}pp)`);
    }

    // Profit factor check
    if (val.bestPnl > 0) {
      const bestValStrategy = validation[symbol].strategies.reduce((a, b) =>
        a.totalPnl > b.totalPnl ? a : b
      );
      if (bestValStrategy.profitFactor < gates.minProfitFactor) {
        checks.push(`Profit factor ${bestValStrategy.profitFactor.toFixed(2)} below minimum ${gates.minProfitFactor}`);
      }
    }

    comparison[symbol] = {
      passed: checks.length === 0,
      failures: checks,
      baseline: base,
      validation: val,
    };
  }

  const allPassed = Object.values(comparison).every(c => c.passed);
  return { allPassed, details: comparison };
}

/**
 * Format backtest results as a full summary string for Claude context.
 * Shows baseline (currently deployed) vs best strategy, plus ALL evaluated strategies.
 */
export function formatResultsForPrompt(results) {
  const lines = [];
  for (const [symbol, data] of Object.entries(results)) {
    if (data.error) {
      lines.push(`${symbol}: ERROR - ${data.error}`);
      continue;
    }
    lines.push(`\n### ${symbol} (${data.strategies.length} strategies evaluated)`);

    if (data.summary) {
      lines.push(`🏆 BEST: ${data.summary.bestStrategy} | PnL: $${data.summary.bestPnl.toFixed(0)} | WR: ${data.summary.bestWinRate.toFixed(1)}%`);
      lines.push(`📊 AVG across all: PnL $${data.summary.avgPnl.toFixed(0)} | WR: ${data.summary.avgWinRate.toFixed(1)}%`);
    }

    // Show ALL strategies sorted by PnL (they come pre-sorted from backtest)
    lines.push('');
    lines.push(`  ${'Strategy'.padEnd(32)} Trades  Win%    PF    PnL $   MaxDD%`);
    lines.push(`  ${'-'.repeat(32)} ${'-'.repeat(6)}  ${'-'.repeat(5)}  ${'-'.repeat(5)} ${'-'.repeat(7)} ${'-'.repeat(6)}`);
    for (const s of data.strategies) {
      const pnlStr = s.totalPnl >= 0 ? `+${s.totalPnl.toFixed(0)}` : s.totalPnl.toFixed(0);
      lines.push(`  ${s.name.padEnd(32)} ${String(s.totalTrades).padStart(6)}  ${s.winRate.toFixed(1).padStart(5)}  ${s.profitFactor.toFixed(2).padStart(5)} ${pnlStr.padStart(7)} ${s.maxDrawdown.toFixed(1).padStart(6)}%`);
    }

    // Profitable vs unprofitable count
    const profitable = data.strategies.filter(s => s.totalPnl > 0).length;
    const unprofitable = data.strategies.length - profitable;
    lines.push(`\n  Summary: ${profitable} profitable, ${unprofitable} unprofitable`);
  }
  return lines.join('\n');
}
