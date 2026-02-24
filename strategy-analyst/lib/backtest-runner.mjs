import { execSync } from 'child_process';
import { join } from 'path';

const SYMBOLS = (process.env.BACKTEST_SYMBOLS || 'BTCUSD,XAUUSD.s,XAGUSD.s').split(',');
const BACKTEST_DAYS = parseInt(process.env.BACKTEST_DAYS || '14');

// Limit backtest variations for low-memory environments (0 = all variations)
const BACKTEST_TOP_N = parseInt(process.env.BACKTEST_TOP_N || '30');

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
          timeout: 300_000, // 5 min per symbol (reduced from 10 — fewer variations)
          env: { ...process.env, NODE_ENV: 'production' },
          maxBuffer: 5 * 1024 * 1024, // 5MB (reduced from 10MB — fewer variations = less output)
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
 * Format: "StrategyName          Trades  Win%    PF      PnL $    MaxDD%   Final $"
 */
function parseTableRow(line) {
  // Strip ANSI color codes
  const clean = line.replace(/\x1b\[\d+m/g, '');

  // Strategy name is first 30 chars, then numeric columns
  const name = clean.substring(0, 30).trim();
  if (!name) return null;

  const rest = clean.substring(30).trim();
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
 * Format backtest results as a concise summary string for Claude context.
 */
export function formatResultsForPrompt(results) {
  const lines = [];
  for (const [symbol, data] of Object.entries(results)) {
    if (data.error) {
      lines.push(`${symbol}: ERROR - ${data.error}`);
      continue;
    }
    lines.push(`\n### ${symbol}`);
    if (data.summary) {
      lines.push(`Best: ${data.summary.bestStrategy} | PnL: $${data.summary.bestPnl.toFixed(0)} | WR: ${data.summary.bestWinRate.toFixed(1)}%`);
    }
    // Top 5 strategies
    const top = data.strategies.slice(0, 5);
    for (const s of top) {
      lines.push(`  ${s.name}: ${s.totalTrades} trades, ${s.winRate.toFixed(1)}% WR, PF ${s.profitFactor.toFixed(2)}, $${s.totalPnl.toFixed(0)}, DD ${s.maxDrawdown.toFixed(1)}%`);
    }
  }
  return lines.join('\n');
}
