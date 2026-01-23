#!/usr/bin/env node
/**
 * Run backtests for the exact configurations we implemented
 * Jan 3-23, 2026 (20 days)
 */

import { execSync } from 'child_process';

const START_DATE = '2026-01-03';
const END_DATE = '2026-01-23';

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  OPTIMAL STRATEGY BACKTEST - 20 Days (Jan 3-23, 2026)   ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// Test each symbol with its optimal configuration
const tests = [
  {
    symbol: 'BTCUSD',
    description: 'ATR1.5|RR2 (H4/M30/M5)',
    timeframe: 'm5',
  },
  {
    symbol: 'XAUUSD.s',
    description: 'ATR1.0|RR2|BE (H1/M15/M1)',
    timeframe: 'scalp',
  },
  {
    symbol: 'XAGUSD.s',
    description: 'OB75|RR2 (H1/M15/M1)',
    timeframe: 'scalp',
  }
];

for (const test of tests) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${test.symbol}: ${test.description}`);
  console.log('═'.repeat(60));

  try {
    const cmd = `node scripts/quick-backtest.mjs --symbol ${test.symbol} --start ${START_DATE} --end ${END_DATE} --tf ${test.timeframe}`;

    const result = execSync(cmd, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Extract key metrics from output
    const lines = result.split('\n');
    let inResults = false;

    for (const line of lines) {
      if (line.includes('Period:') || line.includes('Trades:') ||
          line.includes('Win Rate:') || line.includes('PnL:') ||
          line.includes('Max DD:') || line.includes('Profit Factor:')) {
        console.log('  ' + line.trim());
        inResults = true;
      }
    }

    if (!inResults) {
      console.log('  [Running...]');
    }

  } catch (error) {
    console.error(`  Error running backtest: ${error.message}`);
  }
}

console.log('\n' + '═'.repeat(60));
console.log('  BACKTEST COMPLETE');
console.log('═'.repeat(60) + '\n');
