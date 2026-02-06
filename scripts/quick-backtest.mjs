#!/usr/bin/env node
/**
 * Quick CLI Backtest - Native ESM module (no TypeScript needed)
 *
 * Usage:
 *   node scripts/quick-backtest.mjs --symbol XAUUSD.s --strategy ORDER_BLOCK
 *   node scripts/quick-backtest.mjs --optimize --symbol XAUUSD.s
 *   node scripts/quick-backtest.mjs --compare-all --symbol XAUUSD.s
 */

import { config } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
config();

// Dynamic import for MetaAPI
let MetaApi;

// Cache directory for candle data
const CACHE_DIR = join(process.cwd(), '.cache', 'candles');

const API_TOKEN = process.env.META_API_TOKEN;
const ACCOUNT_ID = process.env.META_API_ACCOUNT_ID;

// Default symbols to test
const DEFAULT_SYMBOLS = ['XAUUSD.s', 'XAGUSD.s', 'BTCUSD', 'ETHUSD'];

// Timeframe presets for testing
const TIMEFRAME_PRESETS = {
  // Standard: H4 bias, H1 structure, M5 entries (original default was M1)
  standard: { htf: 'H4', mtf: 'H1', ltf: 'M5', name: 'Standard (H4/H1/M5)' },
  // Scalping: Lower timeframes for faster entries
  scalp: { htf: 'H1', mtf: 'M15', ltf: 'M1', name: 'Scalp (H1/M15/M1)' },
  // Ultra-scalp: Very low timeframes
  ultrascalp: { htf: 'M30', mtf: 'M5', ltf: 'M1', name: 'Ultra-Scalp (M30/M5/M1)' },
  // Swing: Higher timeframes for position trades
  swing: { htf: 'D1', mtf: 'H4', ltf: 'H1', name: 'Swing (D1/H4/H1)' },
  // Intraday: Medium timeframes
  intraday: { htf: 'H4', mtf: 'H1', ltf: 'M15', name: 'Intraday (H4/H1/M15)' },
  // M1 focus: Use M1 for entries with M15/H1 structure
  m1: { htf: 'H1', mtf: 'M15', ltf: 'M1', name: 'M1-Entry (H1/M15/M1)' },
  // M5 focus: Use M5 for entries
  m5: { htf: 'H4', mtf: 'M30', ltf: 'M5', name: 'M5-Entry (H4/M30/M5)' },
};

// Parse arguments
const args = process.argv.slice(2);
const options = {
  symbols: [...DEFAULT_SYMBOLS],
  strategy: 'ORDER_BLOCK',
  startDate: getDefaultStartDate(),
  endDate: getDefaultEndDate(),
  balance: 1000,
  risk: 2,
  optimize: false,
  compareAll: false,
  compareTimeframes: false,
  timeframe: 'standard',
  verbose: false,
  help: false,
  clearCache: false,
  debug: false,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--symbol':
    case '-s':
      // Single symbol overrides defaults
      options.symbols = [args[++i]];
      break;
    case '--symbols':
      // Multiple symbols comma-separated
      options.symbols = args[++i].split(',').map(s => s.trim());
      break;
    case '--strategy':
      options.strategy = args[++i];
      break;
    case '--start':
      options.startDate = args[++i];
      break;
    case '--end':
      options.endDate = args[++i];
      break;
    case '--balance':
    case '-b':
      options.balance = parseFloat(args[++i]);
      break;
    case '--risk':
    case '-r':
      options.risk = parseFloat(args[++i]);
      break;
    case '--optimize':
    case '-o':
      options.optimize = true;
      break;
    case '--compare-all':
    case '-c':
      options.compareAll = true;
      break;
    case '--verbose':
    case '-v':
      options.verbose = true;
      break;
    case '--help':
    case '-h':
      options.help = true;
      break;
    case '--clear-cache':
      options.clearCache = true;
      break;
    case '--debug':
    case '-d':
      options.debug = true;
      break;
    case '--timeframe':
    case '--tf':
      options.timeframe = args[++i];
      break;
    case '--compare-timeframes':
    case '-t':
      options.compareTimeframes = true;
      break;
  }
}

function getDefaultStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 30); // Default: last 30 days
  return date.toISOString().split('T')[0];
}

function getDefaultEndDate() {
  return new Date().toISOString().split('T')[0];
}

function printHelp() {
  console.log(`
Quick CLI Backtest - MT5 API Trader
===================================

Usage:
  node scripts/quick-backtest.mjs [options]

Options:
  --symbol, -s <symbol>     Single trading symbol
  --symbols <list>          Comma-separated symbols (default: XAUUSD.s,XAGUSD.s,BTCUSD)
  --strategy <name>         Strategy type (see below)
  --start <date>            Start date YYYY-MM-DD (default: 30 days ago)
  --end <date>              End date YYYY-MM-DD (default: today)
  --balance, -b <amount>    Initial balance (default: 1000)
  --risk, -r <percent>      Risk % per trade (default: 2)
  --optimize, -o            Run parameter optimization
  --compare-all, -c         Compare all strategy variations
  --compare-timeframes, -t  Compare all timeframe presets
  --timeframe, --tf <name>  Timeframe preset (see below)
  --clear-cache             Clear cached candle data and re-fetch
  --verbose, -v             Show detailed output
  --help, -h                Show this help

Strategies:
  ORDER_BLOCK       Order Block with quality scoring (default)
  FVG               Fair Value Gap (imbalance) entries
  LIQUIDITY_SWEEP   Enter after liquidity sweep reversal
  BOS               Break of Structure pullback entries
  OB_FVG            Order Block + FVG confluence (high probability)
  M1_TREND          M1-only trend following using EMAs (9/21/50)

Timeframe Presets:
  standard          H4/H1/M5  - Standard multi-timeframe (default)
  scalp             H1/M15/M1 - Scalping with M1 entries
  ultrascalp        M30/M5/M1 - Ultra-fast scalping
  swing             D1/H4/H1  - Swing trading
  intraday          H4/H1/M15 - Intraday positions
  m1                H1/M15/M1 - Focus on M1 entry timeframe
  m5                H4/M30/M5 - Focus on M5 entry timeframe

Examples:
  node scripts/quick-backtest.mjs                           # All default symbols
  node scripts/quick-backtest.mjs -s XAUUSD.s               # Single symbol
  node scripts/quick-backtest.mjs --symbols XAUUSD.s,BTCUSD # Multiple symbols
  node scripts/quick-backtest.mjs --compare-all             # Compare variations
  node scripts/quick-backtest.mjs --start 2024-06-01        # Custom date range
  node scripts/quick-backtest.mjs --tf m1 -s BTCUSD         # Test M1 timeframe
  node scripts/quick-backtest.mjs -t -s XAUUSD.s            # Compare all timeframes
`);
}

// Strategy variations to test - FINAL OPTIMIZED (Jan 2026)
// Based on iterative backtesting across BTCUSD, XAUUSD.s, XAGUSD.s
const VARIATIONS = [
  // === OTE STRATEGIES (Colleague's findings - Jan 2026) ===
  // OTE On with Fixed RR significantly outperforms OTE Off
  { name: 'OTE: OB70|KZ|RR2|DD15%', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 2, minOBScore: 70, useKillZones: true, maxDailyDD: 15, atrMult: 1.0, requireConfirmation: false },
  { name: 'OTE: OB65|KZ|RR2|DD15%', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 2, minOBScore: 65, useKillZones: true, maxDailyDD: 15, atrMult: 1.0, requireConfirmation: false },
  { name: 'OTE: OB70|KZ|RR2|DD8%', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 2, minOBScore: 70, useKillZones: true, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },
  { name: 'OTE: OB65|All|RR2|DD15%', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 2, minOBScore: 65, useKillZones: false, maxDailyDD: 15, atrMult: 1.0, requireConfirmation: false },
  { name: 'NO-OTE: OB70|KZ|RR2|DD15%', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: true, maxDailyDD: 15, atrMult: 1.0, requireConfirmation: false },
  { name: 'NO-OTE: OB65|KZ|RR2|DD15%', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 65, useKillZones: true, maxDailyDD: 15, atrMult: 1.0, requireConfirmation: false },
  // OTE with Breakeven
  { name: 'OTE+BE: OB70|KZ|RR2|BE1R', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 2, minOBScore: 70, useKillZones: true, maxDailyDD: 15, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 5 },
  { name: 'OTE+BE: OB65|KZ|RR2|BE1R', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 2, minOBScore: 65, useKillZones: true, maxDailyDD: 15, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 5 },

  // === RECOMMENDED STRATEGY (Maximum Profit with BE) ===
  // Breakeven at 1R with 5 pips buffer - proven best performer
  { name: 'RECOMMENDED: BE1R|5pips|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 5 },

  // === OPTIMAL STRATEGIES BY SYMBOL ===

  // BTCUSD OPTIMAL: ATR0.8 with RR1.5-2 (M5 timeframe)
  { name: 'BTC-OPTIMAL: ATR0.8|RR1.5', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 1.5, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 0.8, requireConfirmation: false },
  { name: 'BTC-OPTIMAL: ATR0.8|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 0.8, requireConfirmation: false },
  { name: 'BTC-OPTIMAL: OB75|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 75, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },

  // XAUUSD OPTIMAL: ATR1.5 dominates (Scalp timeframe H1/M15/M1)
  { name: 'XAU-OPTIMAL: ATR1.5|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.5, requireConfirmation: false },
  { name: 'XAU-OPTIMAL: ATR1.2|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.2, requireConfirmation: false },
  { name: 'XAU-OPTIMAL: ATR1.5|RR1.5', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 1.5, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.5, requireConfirmation: false },

  // XAGUSD OPTIMAL: OB65-70 with RR2-2.5 (Scalp timeframe)
  { name: 'XAG-OPTIMAL: OB65|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 65, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },
  { name: 'XAG-OPTIMAL: OB70|RR2.5', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2.5, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },
  { name: 'XAG-OPTIMAL: ATR1.2|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.2, requireConfirmation: false },

  // ETHUSD OPTIMAL: ATR1.5 with RR1.5-2 (Standard timeframe H4/H1/M5) - based on backtest Jan 2026
  { name: 'ETH-OPTIMAL: ATR1.5|RR1.5', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 1.5, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.5, requireConfirmation: false },
  { name: 'ETH-OPTIMAL: ATR1.5|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.5, requireConfirmation: false },
  { name: 'ETH-OPTIMAL: OB75|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 75, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },

  // === UNIVERSAL STRATEGIES (work across all symbols) ===
  { name: 'UNIVERSAL: OB70|All|DD8%|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },
  { name: 'UNIVERSAL: OB70|All|DD8%|RR1.5', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 1.5, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },
  { name: 'UNIVERSAL: OB70|All|DD8%|RR2.5', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2.5, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },

  // === CONSERVATIVE (lower DD for prop firm) ===
  { name: 'SAFE: OB70|KZ|DD6%|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: true, maxDailyDD: 6, atrMult: 1.0, requireConfirmation: false },
  { name: 'SAFE: OB65|KZ|DD5%|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 65, useKillZones: true, maxDailyDD: 5, atrMult: 1.0, requireConfirmation: false },

  // === WITH CONFIRMATION (lower risk, fewer trades) ===
  { name: 'CONFIRM: OB70|Engulf|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: true, confirmationType: 'engulf' },

  // === BREAKEVEN STRATEGIES (move SL to BE + buffer when profit reached) ===
  // BE at 0.5R - aggressive BE trigger
  { name: 'BE: 0.5R|RR2|2pips', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 0.5, beBufferPips: 2 },
  // BE at 1R - standard BE trigger
  { name: 'BE: 1R|RR2|2pips', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 2 },
  // BE at 1R with 5 pips buffer
  { name: 'BE: 1R|RR2|5pips', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 5 },
  // BE at 1.5R - conservative BE trigger
  { name: 'BE: 1.5R|RR2|2pips', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 1.5, beBufferPips: 2 },
  // BE at 0.75R with RR2.5 (more room to TP)
  { name: 'BE: 0.75R|RR2.5|3pips', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2.5, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 0.75, beBufferPips: 3 },

  // === OPPOSING SIGNAL EXIT (close when strong opposing signals appear) ===
  { name: 'OPPOSE: OB75|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableOpposingExit: true, minOpposingScore: 75 },
  { name: 'OPPOSE: OB80|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableOpposingExit: true, minOpposingScore: 80 },

  // === COMBO: Breakeven + Opposing Exit ===
  { name: 'COMBO: BE1R+OPPOSE75', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 2, enableOpposingExit: true, minOpposingScore: 75 },
  { name: 'COMBO: BE0.75R+OPPOSE80', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2.5, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 0.75, beBufferPips: 3, enableOpposingExit: true, minOpposingScore: 80 },

  // === SYMBOL-SPECIFIC with BE ===
  { name: 'BTC-BE: ATR0.8|BE1R|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 0.8, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 5 },
  { name: 'XAU-BE: ATR1.5|BE1R|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.5, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 2 },

  // === M1 TREND STRATEGIES (EMA-based trend following) ===
  { name: 'M1-TREND: RR2|DD8%', strategy: 'M1_TREND', requireOTE: false, fixedRR: 2, minOBScore: 50, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },
  { name: 'M1-TREND: RR1.5|DD8%', strategy: 'M1_TREND', requireOTE: false, fixedRR: 1.5, minOBScore: 50, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },
  { name: 'M1-TREND: RR2.5|DD8%', strategy: 'M1_TREND', requireOTE: false, fixedRR: 2.5, minOBScore: 50, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },
  { name: 'M1-TREND: RR2|KZ|DD8%', strategy: 'M1_TREND', requireOTE: false, fixedRR: 2, minOBScore: 50, useKillZones: true, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },
  { name: 'M1-TREND: RR2|DD6%', strategy: 'M1_TREND', requireOTE: false, fixedRR: 2, minOBScore: 50, useKillZones: false, maxDailyDD: 6, atrMult: 1.0, requireConfirmation: false },
  { name: 'M1-TREND: RR2|BE1R', strategy: 'M1_TREND', requireOTE: false, fixedRR: 2, minOBScore: 50, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 5 },
  { name: 'M1-TREND: RR3|DD8%', strategy: 'M1_TREND', requireOTE: false, fixedRR: 3, minOBScore: 50, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },

  // === TIERED TP STRATEGIES (TP1/TP2/TP3 with partial closes) ===
  // Standard tiered: 50% at 1R, 30% at 2R, 20% at 3R
  { name: 'TIERED: 50@1R|30@2R|20@3R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 3, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 50, tp2RR: 2.0, tp2Percent: 30, tp3RR: 3.0, tp3Percent: 20, moveSlOnTP1: true, beBufferPips: 3 },

  // Conservative tiered: 60% at 1R, 25% at 1.5R, 15% at 2R
  { name: 'TIERED: 60@1R|25@1.5R|15@2R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 60, tp2RR: 1.5, tp2Percent: 25, tp3RR: 2.0, tp3Percent: 15, moveSlOnTP1: true, beBufferPips: 3 },

  // Aggressive tiered: 40% at 1.5R, 35% at 2.5R, 25% at 4R
  { name: 'TIERED: 40@1.5R|35@2.5R|25@4R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 4, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.5, tp1Percent: 40, tp2RR: 2.5, tp2Percent: 35, tp3RR: 4.0, tp3Percent: 25, moveSlOnTP1: true, beBufferPips: 3 },

  // Quick lock: 70% at 0.5R, 20% at 1R, 10% at 2R (lock profits fast)
  { name: 'TIERED: 70@0.5R|20@1R|10@2R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 0.5, tp1Percent: 70, tp2RR: 1.0, tp2Percent: 20, tp3RR: 2.0, tp3Percent: 10, moveSlOnTP1: true, beBufferPips: 2 },

  // Balanced tiered: 33% at 1R, 33% at 2R, 34% at 3R (equal splits)
  { name: 'TIERED: 33@1R|33@2R|34@3R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 3, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 33, tp2RR: 2.0, tp2Percent: 33, tp3RR: 3.0, tp3Percent: 34, moveSlOnTP1: true, beBufferPips: 3 },

  // Runner focus: 25% at 1R, 25% at 2R, 50% at 4R (let winners run)
  { name: 'TIERED: 25@1R|25@2R|50@4R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 4, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 25, tp2RR: 2.0, tp2Percent: 25, tp3RR: 4.0, tp3Percent: 50, moveSlOnTP1: true, beBufferPips: 3 },

  // Tiered with Kill Zones
  { name: 'TIERED: 50@1R|30@2R|20@3R|KZ', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 3, minOBScore: 70, useKillZones: true, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 50, tp2RR: 2.0, tp2Percent: 30, tp3RR: 3.0, tp3Percent: 20, moveSlOnTP1: true, beBufferPips: 3 },

  // Tiered with OTE
  { name: 'TIERED: 50@1R|30@2R|20@3R|OTE', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 3, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 50, tp2RR: 2.0, tp2Percent: 30, tp3RR: 3.0, tp3Percent: 20, moveSlOnTP1: true, beBufferPips: 3 },

  // Symbol-specific tiered strategies
  { name: 'BTC-TIERED: 50@1R|30@2R|20@3R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 3, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 0.8, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 50, tp2RR: 2.0, tp2Percent: 30, tp3RR: 3.0, tp3Percent: 20, moveSlOnTP1: true, beBufferPips: 5 },
  { name: 'XAU-TIERED: 50@1R|30@2R|20@3R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 3, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.5, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 50, tp2RR: 2.0, tp2Percent: 30, tp3RR: 3.0, tp3Percent: 20, moveSlOnTP1: true, beBufferPips: 2 },

  // Tiered without moving SL (more aggressive)
  { name: 'TIERED-NOSL: 50@1R|30@2R|20@3R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 3, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 50, tp2RR: 2.0, tp2Percent: 30, tp3RR: 3.0, tp3Percent: 20, moveSlOnTP1: false },

  // Move SL to TP1 after TP2 (trail the SL)
  { name: 'TIERED-TRAIL: 50@1R|30@2R|20@3R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 3, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 50, tp2RR: 2.0, tp2Percent: 30, tp3RR: 3.0, tp3Percent: 20, moveSlOnTP1: true, moveSlOnTP2: true, beBufferPips: 3 },

  // === OPTIMIZED TIERED TP STRATEGIES (Based on backtest results) ===

  // High win-rate tiered: OTE + OB75 combo (best performer potential)
  { name: 'TIERED-OTE: OB75|50@1R|30@2R|20@3R', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 3, minOBScore: 75, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 50, tp2RR: 2.0, tp2Percent: 30, tp3RR: 3.0, tp3Percent: 20, moveSlOnTP1: true, beBufferPips: 5 },

  // Aggressive runner with OTE
  { name: 'TIERED-OTE: 30@1R|30@2R|40@4R', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 4, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 30, tp2RR: 2.0, tp2Percent: 30, tp3RR: 4.0, tp3Percent: 40, moveSlOnTP1: true, beBufferPips: 5 },

  // Quick secure with OTE (lock profits fast)
  { name: 'TIERED-OTE: 60@0.75R|25@1.5R|15@2.5R', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 2.5, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 0.75, tp1Percent: 60, tp2RR: 1.5, tp2Percent: 25, tp3RR: 2.5, tp3Percent: 15, moveSlOnTP1: true, beBufferPips: 3 },

  // Higher RR targets (big moves)
  { name: 'TIERED: 40@1.5R|30@3R|30@5R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 5, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.5, tp1Percent: 40, tp2RR: 3.0, tp2Percent: 30, tp3RR: 5.0, tp3Percent: 30, moveSlOnTP1: true, beBufferPips: 5 },

  // Scalp tiered (quick profits)
  { name: 'TIERED: 50@0.5R|30@1R|20@1.5R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 1.5, minOBScore: 65, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 0.5, tp1Percent: 50, tp2RR: 1.0, tp2Percent: 30, tp3RR: 1.5, tp3Percent: 20, moveSlOnTP1: true, beBufferPips: 2 },

  // Two-tier only (simpler management)
  { name: 'TIERED-2: 50@1R|50@2R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 50, tp2RR: 2.0, tp2Percent: 50, tp3RR: 3.0, tp3Percent: 0, moveSlOnTP1: true, beBufferPips: 3 },

  // OTE + Kill Zone combo (highest quality entries)
  { name: 'TIERED-OTE-KZ: 50@1R|30@2R|20@3R', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 3, minOBScore: 70, useKillZones: true, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 50, tp2RR: 2.0, tp2Percent: 30, tp3RR: 3.0, tp3Percent: 20, moveSlOnTP1: true, beBufferPips: 5 },

  // Swing tiered (bigger targets for position trades)
  { name: 'TIERED-SWING: 30@2R|35@3R|35@5R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 5, minOBScore: 75, useKillZones: false, maxDailyDD: 10, atrMult: 1.2, enableTieredTP: true, tp1RR: 2.0, tp1Percent: 30, tp2RR: 3.0, tp2Percent: 35, tp3RR: 5.0, tp3Percent: 35, moveSlOnTP1: true, beBufferPips: 5 },

  // Asymmetric tiered (heavy on first TP for consistency)
  { name: 'TIERED: 70@1R|20@2R|10@4R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 4, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 70, tp2RR: 2.0, tp2Percent: 20, tp3RR: 4.0, tp3Percent: 10, moveSlOnTP1: true, beBufferPips: 3 },

  // === NEW OPTIMIZED STRATEGIES (Jan 2026 Backtest Analysis) ===

  // M1-TREND optimized for metals (high RR with tighter DD)
  { name: 'M1-TREND-OPT: RR2.5|DD5%', strategy: 'M1_TREND', requireOTE: false, fixedRR: 2.5, minOBScore: 50, useKillZones: false, maxDailyDD: 5, atrMult: 1.0, requireConfirmation: false },
  { name: 'M1-TREND-OPT: RR3|DD5%', strategy: 'M1_TREND', requireOTE: false, fixedRR: 3, minOBScore: 50, useKillZones: false, maxDailyDD: 5, atrMult: 1.0, requireConfirmation: false },
  { name: 'M1-TREND-OPT: RR3.5|DD6%', strategy: 'M1_TREND', requireOTE: false, fixedRR: 3.5, minOBScore: 50, useKillZones: false, maxDailyDD: 6, atrMult: 1.0, requireConfirmation: false },
  { name: 'M1-TREND-OPT: RR4|DD8%', strategy: 'M1_TREND', requireOTE: false, fixedRR: 4, minOBScore: 50, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },

  // M1-TREND with breakeven (protect profits)
  { name: 'M1-TREND-BE: RR2.5|BE1R', strategy: 'M1_TREND', requireOTE: false, fixedRR: 2.5, minOBScore: 50, useKillZones: false, maxDailyDD: 6, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 3 },
  { name: 'M1-TREND-BE: RR3|BE1R', strategy: 'M1_TREND', requireOTE: false, fixedRR: 3, minOBScore: 50, useKillZones: false, maxDailyDD: 6, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 3 },
  { name: 'M1-TREND-BE: RR3|BE0.75R', strategy: 'M1_TREND', requireOTE: false, fixedRR: 3, minOBScore: 50, useKillZones: false, maxDailyDD: 6, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 0.75, beBufferPips: 2 },

  // M1-TREND with tiered TP (combine trend following with partial profits)
  { name: 'M1-TREND-TIERED: 40@1R|30@2R|30@3R', strategy: 'M1_TREND', requireOTE: false, fixedRR: 3, minOBScore: 50, useKillZones: false, maxDailyDD: 6, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 40, tp2RR: 2.0, tp2Percent: 30, tp3RR: 3.0, tp3Percent: 30, moveSlOnTP1: true, beBufferPips: 3 },
  { name: 'M1-TREND-TIERED: 30@1R|30@2R|40@4R', strategy: 'M1_TREND', requireOTE: false, fixedRR: 4, minOBScore: 50, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 30, tp2RR: 2.0, tp2Percent: 30, tp3RR: 4.0, tp3Percent: 40, moveSlOnTP1: true, beBufferPips: 3 },

  // Crypto-optimized: ATR1.5 with different RR
  { name: 'CRYPTO-OPT: ATR1.5|RR1.25', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 1.25, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.5, requireConfirmation: false },
  { name: 'CRYPTO-OPT: ATR1.5|RR1.75', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 1.75, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.5, requireConfirmation: false },
  { name: 'CRYPTO-OPT: ATR1.3|RR1.5', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 1.5, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.3, requireConfirmation: false },

  // Crypto with tiered TP + OTE (high quality entries with runners)
  { name: 'CRYPTO-TIERED: OTE|30@1R|30@2R|40@5R', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 5, minOBScore: 70, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 30, tp2RR: 2.0, tp2Percent: 30, tp3RR: 5.0, tp3Percent: 40, moveSlOnTP1: true, beBufferPips: 5 },
  { name: 'CRYPTO-TIERED: OTE|25@1R|25@2R|50@6R', strategy: 'ORDER_BLOCK', requireOTE: true, fixedRR: 6, minOBScore: 70, useKillZones: false, maxDailyDD: 10, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 25, tp2RR: 2.0, tp2Percent: 25, tp3RR: 6.0, tp3Percent: 50, moveSlOnTP1: true, beBufferPips: 5 },

  // Kill Zone focused (ETHUSD winner)
  { name: 'KZ-TIERED: 40@1R|30@2R|30@4R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 4, minOBScore: 70, useKillZones: true, maxDailyDD: 8, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 40, tp2RR: 2.0, tp2Percent: 30, tp3RR: 4.0, tp3Percent: 30, moveSlOnTP1: true, beBufferPips: 3 },
  { name: 'KZ-TIERED: 60@1R|25@2R|15@3R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 3, minOBScore: 65, useKillZones: true, maxDailyDD: 6, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 60, tp2RR: 2.0, tp2Percent: 25, tp3RR: 3.0, tp3Percent: 15, moveSlOnTP1: true, beBufferPips: 3 },

  // Combined: M1-TREND with Kill Zones (filter noisy periods)
  { name: 'M1-TREND-KZ: RR2.5|DD6%', strategy: 'M1_TREND', requireOTE: false, fixedRR: 2.5, minOBScore: 50, useKillZones: true, maxDailyDD: 6, atrMult: 1.0, requireConfirmation: false },
  { name: 'M1-TREND-KZ: RR3|DD6%', strategy: 'M1_TREND', requireOTE: false, fixedRR: 3, minOBScore: 50, useKillZones: true, maxDailyDD: 6, atrMult: 1.0, requireConfirmation: false },

  // Ultra-conservative: High OB score with tight DD
  { name: 'SAFE-OPT: OB80|RR2|DD4%', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 80, useKillZones: true, maxDailyDD: 4, atrMult: 1.0, requireConfirmation: false },
  { name: 'SAFE-OPT: OB75|RR2.5|DD5%', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2.5, minOBScore: 75, useKillZones: true, maxDailyDD: 5, atrMult: 1.0, requireConfirmation: false },

  // === EVERY OB IN TREND (Trade all Order Blocks aligned with trend) ===
  // No OB score filtering - trade every OB that matches trend direction
  { name: 'EVERY-OB: NoFilter|RR1.5', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 1.5, minOBScore: 0, useKillZones: false, maxDailyDD: 20, atrMult: 1.0, requireConfirmation: false },
  { name: 'EVERY-OB: NoFilter|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 0, useKillZones: false, maxDailyDD: 20, atrMult: 1.0, requireConfirmation: false },
  { name: 'EVERY-OB: NoFilter|RR2.5', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2.5, minOBScore: 0, useKillZones: false, maxDailyDD: 20, atrMult: 1.0, requireConfirmation: false },
  { name: 'EVERY-OB: NoFilter|RR3', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 3, minOBScore: 0, useKillZones: false, maxDailyDD: 20, atrMult: 1.0, requireConfirmation: false },

  // Every OB with different DD limits
  { name: 'EVERY-OB: NoFilter|RR2|DD8%', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 0, useKillZones: false, maxDailyDD: 8, atrMult: 1.0, requireConfirmation: false },
  { name: 'EVERY-OB: NoFilter|RR2|DD10%', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 0, useKillZones: false, maxDailyDD: 10, atrMult: 1.0, requireConfirmation: false },

  // Every OB with Kill Zones only (trade during high volatility)
  { name: 'EVERY-OB: NoFilter|KZ|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 0, useKillZones: true, maxDailyDD: 20, atrMult: 1.0, requireConfirmation: false },
  { name: 'EVERY-OB: NoFilter|KZ|RR2.5', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2.5, minOBScore: 0, useKillZones: true, maxDailyDD: 20, atrMult: 1.0, requireConfirmation: false },

  // Every OB with ATR multipliers (wider/tighter OB detection)
  { name: 'EVERY-OB: ATR1.5|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 0, useKillZones: false, maxDailyDD: 20, atrMult: 1.5, requireConfirmation: false },
  { name: 'EVERY-OB: ATR2.0|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 0, useKillZones: false, maxDailyDD: 20, atrMult: 2.0, requireConfirmation: false },
  { name: 'EVERY-OB: ATR0.8|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 0, useKillZones: false, maxDailyDD: 20, atrMult: 0.8, requireConfirmation: false },

  // Every OB with tiered TP
  { name: 'EVERY-OB-TIERED: 50@1R|30@2R|20@3R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 3, minOBScore: 0, useKillZones: false, maxDailyDD: 20, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 50, tp2RR: 2.0, tp2Percent: 30, tp3RR: 3.0, tp3Percent: 20, moveSlOnTP1: true, beBufferPips: 3 },
  { name: 'EVERY-OB-TIERED: 30@1R|30@2R|40@4R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 4, minOBScore: 0, useKillZones: false, maxDailyDD: 20, atrMult: 1.0, enableTieredTP: true, tp1RR: 1.0, tp1Percent: 30, tp2RR: 2.0, tp2Percent: 30, tp3RR: 4.0, tp3Percent: 40, moveSlOnTP1: true, beBufferPips: 3 },

  // Every OB with low score threshold (some quality filtering)
  { name: 'EVERY-OB: OB30|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 30, useKillZones: false, maxDailyDD: 20, atrMult: 1.0, requireConfirmation: false },
  { name: 'EVERY-OB: OB40|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 40, useKillZones: false, maxDailyDD: 20, atrMult: 1.0, requireConfirmation: false },
  { name: 'EVERY-OB: OB50|RR2', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 50, useKillZones: false, maxDailyDD: 20, atrMult: 1.0, requireConfirmation: false },

  // Every OB with breakeven (protect profits while trading aggressively)
  { name: 'EVERY-OB-BE: NoFilter|RR2|BE1R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 2, minOBScore: 0, useKillZones: false, maxDailyDD: 20, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 3 },
  { name: 'EVERY-OB-BE: NoFilter|RR3|BE1R', strategy: 'ORDER_BLOCK', requireOTE: false, fixedRR: 3, minOBScore: 0, useKillZones: false, maxDailyDD: 20, atrMult: 1.0, enableBreakeven: true, breakevenTriggerR: 1.0, beBufferPips: 3 },
];

// Symbol info for backtesting (including typical spreads)
// Wide stop losses are handled by position sizing (lot size reduced if SL is wider)
const SYMBOL_INFO = {
  'XAUUSD.s': { pipSize: 0.1, contractSize: 100, minVolume: 0.01, minSlPips: 15, typicalSpread: 0.25 },  // ~25 cents spread, $1.50 min SL
  'XAGUSD.s': { pipSize: 0.01, contractSize: 5000, minVolume: 0.01, minSlPips: 10, typicalSpread: 0.025 }, // ~2.5 cents spread, $0.10 min SL
  'BTCUSD': { pipSize: 1, contractSize: 1, minVolume: 0.01, minSlPips: 100, typicalSpread: 15 },  // ~$15 spread, $100 min SL
  'ETHUSD': { pipSize: 1, contractSize: 1, minVolume: 0.01, minSlPips: 20, typicalSpread: 2 },  // ~$2 spread, $20 min SL
};

// Kill Zone definitions (UTC)
const KILL_ZONES = {
  LONDON: { start: 7, end: 10 },      // London: 07:00-10:00 UTC
  NY_AM: { start: 12, end: 15 },      // NY AM: 12:00-15:00 UTC
  NY_PM: { start: 18, end: 20 },      // NY PM: 18:00-20:00 UTC
};

// Cooldown periods after session opens (5 min observation)
const COOLDOWNS = {
  ASIAN: { hour: 23, minute: 0 },     // Asian: 23:00 UTC
  LONDON: { hour: 8, minute: 0 },     // London: 08:00 UTC
  NY_CASH: { hour: 14, minute: 30 },  // NY Cash: 14:30 UTC
};

/**
 * SMC Backtest Engine
 * Implements multiple SMC strategies: Order Block, FVG, Liquidity Sweep, BOS
 */
class SMCBacktestEngine {
  constructor(config) {
    this.config = config;
    this.strategy = config.strategy || 'ORDER_BLOCK';
    this.balance = config.initialBalance;
    this.equity = config.initialBalance;
    this.peakEquity = config.initialBalance;
    this.trades = [];
    this.position = null;
    this.maxDrawdown = 0;
    this.dailyTracker = null;
    this.maxDailyDD = config.maxDailyDD || 15;
    this.minOBScore = config.minOBScore || 65;
    this.minFVGSize = config.minFVGSize || 1.0; // ATR multiplier
    this.atrMult = config.atrMult || 1.5; // ATR multiplier for OB detection
    this.requireConfirmation = config.requireConfirmation || false; // Wait for confirmation candle
    this.confirmationType = config.confirmationType || 'close'; // 'close' = candle close in direction, 'engulf' = engulfing pattern
    this.debugFilters = config.debugFilters || false; // Log filter rejections
    this.orderBlocks = [];
    this.fvgs = [];           // Fair Value Gaps
    this.swingPoints = [];    // Tracked swing highs/lows for liquidity
    this.lastBOS = null;      // Last Break of Structure
    this.pendingSignal = null; // Store signal waiting for confirmation

    // Breakeven settings
    this.enableBreakeven = config.enableBreakeven || false;
    this.breakevenTriggerR = config.breakevenTriggerR || 1.0; // Move to BE after 1R profit
    this.beBufferPips = config.beBufferPips || 2; // Lock in 2 pips profit at BE

    // Opposing signal exit settings
    this.enableOpposingExit = config.enableOpposingExit || false;
    this.minOpposingScore = config.minOpposingScore || 75; // High score for opposing signal

    // Tiered Take Profit settings (TP1, TP2, TP3)
    // Each tier has: RR level and percentage of position to close
    this.enableTieredTP = config.enableTieredTP || false;
    this.tp1RR = config.tp1RR || 1.0;    // First TP at 1R
    this.tp1Percent = config.tp1Percent || 50; // Close 50% at TP1
    this.tp2RR = config.tp2RR || 2.0;    // Second TP at 2R
    this.tp2Percent = config.tp2Percent || 30; // Close 30% at TP2
    this.tp3RR = config.tp3RR || 3.0;    // Final TP at 3R
    this.tp3Percent = config.tp3Percent || 20; // Close remaining 20% at TP3
    this.moveSlOnTP1 = config.moveSlOnTP1 !== false; // Move SL to BE after TP1 (default true)
    this.moveSlOnTP2 = config.moveSlOnTP2 || false; // Move SL to TP1 after TP2

    // Tracking stats
    this.beMovedCount = 0;
    this.opposingExitCount = 0;
    this.tp1Hits = 0;
    this.tp2Hits = 0;
    this.tp3Hits = 0;
  }

  async run(htfCandles, mtfCandles, ltfCandles) {
    this.reset();
    const symbolInfo = SYMBOL_INFO[this.config.symbol] || SYMBOL_INFO['XAUUSD.s'];

    // Need enough data for analysis
    if (ltfCandles.length < 100) return this.calculateMetrics();

    const totalCandles = ltfCandles.length - 100;
    let lastProgress = 0;

    for (let i = 100; i < ltfCandles.length; i++) {
      const currentCandle = ltfCandles[i];
      const currentTime = new Date(currentCandle.time);
      const currentPrice = currentCandle.close;

      // Progress indicator for large datasets (every 10%)
      const progress = Math.floor(((i - 100) / totalCandles) * 10);
      if (progress > lastProgress && totalCandles > 5000) {
        process.stdout.write('.');
        lastProgress = progress;
      }

      // Check position exit first
      if (this.position) {
        // Check breakeven first (move SL if profit threshold reached)
        this.checkBreakeven(currentCandle, symbolInfo);

        // Check for opposing signal exit (close if strong opposing signal)
        const recentMTF = this.getRecentMTF(mtfCandles, currentTime, 30);
        const recentHTF = this.getRecentHTF(htfCandles, currentTime, 20);
        const htfBias = this.determineHTFBias(recentHTF);
        const opposingExit = this.checkOpposingSignalExit(currentPrice, currentCandle, recentMTF, htfBias);
        if (opposingExit) {
          this.closePosition(opposingExit.price, currentTime, opposingExit.reason, symbolInfo);
          this.opposingExitCount++;
          continue;
        }

        // Check normal exit (SL/TP)
        const exitResult = this.checkExit(currentCandle);
        if (exitResult) {
          this.closePosition(exitResult.price, currentTime, exitResult.reason, symbolInfo);
        }
        continue; // Don't look for new entries while in position
      }

      // Daily drawdown check
      if (!this.checkDailyDD(currentTime)) continue;

      // Kill zone filter
      if (this.config.useKillZones && !this.isInKillZone(currentTime)) continue;

      // Cooldown check (5 min after session opens)
      if (this.config.useKillZones && this.isInCooldown(currentTime)) continue;

      // Get recent candles for analysis (60 candles for M1_TREND EMA50 + buffer)
      const ltfLookback = this.strategy === 'M1_TREND' ? 60 : 50;
      const recentLTF = ltfCandles.slice(Math.max(0, i - ltfLookback), i + 1);
      const recentMTF = this.getRecentMTF(mtfCandles, currentTime, 30);
      const recentHTF = this.getRecentHTF(htfCandles, currentTime, 20);

      // Determine HTF bias (not required for M1_TREND strategy)
      const htfBias = this.determineHTFBias(recentHTF);
      if (this.debugFilters && i === 100) {
        console.log(`  [DEBUG] First candle analysis:`);
        console.log(`    HTF candles available: ${recentHTF.length}`);
        console.log(`    HTF Bias: ${htfBias}`);
      }
      // Skip HTF bias check for M1_TREND (it determines trend internally from M1 EMAs)
      if (htfBias === 'NEUTRAL' && this.strategy !== 'M1_TREND') continue;

      // Calculate ATR for dynamic levels
      const atr = this.calculateATR(recentMTF);
      if (atr === 0) continue;

      // Update market structure based on strategy
      this.updateOrderBlocks(recentMTF, currentTime, this.config.symbol);
      this.updateFVGs(recentMTF, currentTime, atr);
      this.updateSwingPoints(recentMTF, currentTime);
      this.checkBOS(recentMTF, htfBias);

      if (this.debugFilters && i === 100) {
        const validOBs = this.orderBlocks.filter(ob => !ob.mitigated && !ob.used && ob.score >= this.minOBScore);
        console.log(`    Order Blocks found: ${this.orderBlocks.length}, Valid: ${validOBs.length}`);
        console.log(`    MinOB Score: ${this.minOBScore}`);
        validOBs.slice(0, 3).forEach(ob => {
          console.log(`      ${ob.type} OB: Score=${ob.score}, ${ob.low.toFixed(2)}-${ob.high.toFixed(2)}`);
        });
      }

      // Get signal based on strategy type
      // Check if we have a pending signal waiting for confirmation
      const prevCandle = recentLTF[recentLTF.length - 2];
      if (this.pendingSignal && prevCandle) {
        // Check if pending signal is still valid (SL not hit, not too old)
        const signalAge = currentTime - this.pendingSignal.time;
        const maxSignalAge = 60 * 60 * 1000 * 4; // 4 hours max wait for confirmation

        if (signalAge > maxSignalAge) {
          this.pendingSignal = null; // Signal expired
        } else if (this.checkConfirmation(currentCandle, prevCandle, this.pendingSignal.direction)) {
          // Confirmation received - execute the trade
          const signal = this.pendingSignal;
          this.pendingSignal = null;

          // Use current price for entry (after confirmation)
          const spread = this.getTypicalSpread(this.config.symbol, symbolInfo);
          let entryPrice = currentPrice;

          if (signal.direction === 'BUY') {
            entryPrice = currentPrice + spread / 2;
          } else {
            entryPrice = currentPrice - spread / 2;
          }

          // Recalculate SL distance with new entry
          const slDistance = Math.abs(entryPrice - signal.sl);
          const slPips = slDistance / symbolInfo.pipSize;

          // Calculate position size
          const riskAmount = this.balance * (this.config.risk / 100);
          const rawLotSize = Math.round(riskAmount / (slDistance * symbolInfo.contractSize) * 100) / 100;

          // Only open if SL can be properly sized (raw lot >= minVolume)
          if (rawLotSize >= symbolInfo.minVolume && slPips >= symbolInfo.minSlPips) {
            const lotSize = rawLotSize;

            const intendedRR = this.config.fixedRR;
            let adjustedTP;
            if (signal.direction === 'BUY') {
              adjustedTP = entryPrice + (slDistance * intendedRR);
            } else {
              adjustedTP = entryPrice - (slDistance * intendedRR);
            }

            // Open position with tiered TP support
            const position = {
              direction: signal.direction,
              entry: entryPrice,
              sl: signal.sl,
              originalSl: signal.sl,
              tp: adjustedTP,
              lotSize,
              originalLotSize: lotSize,
              entryTime: currentTime,
              strategyType: this.strategy,
            };

            // Add tiered TP levels if enabled
            if (this.enableTieredTP) {
              if (signal.direction === 'BUY') {
                position.tp1 = entryPrice + (slDistance * this.tp1RR);
                position.tp2 = entryPrice + (slDistance * this.tp2RR);
                position.tp3 = entryPrice + (slDistance * this.tp3RR);
              } else {
                position.tp1 = entryPrice - (slDistance * this.tp1RR);
                position.tp2 = entryPrice - (slDistance * this.tp2RR);
                position.tp3 = entryPrice - (slDistance * this.tp3RR);
              }
              position.tp1Hit = false;
              position.tp2Hit = false;
              position.tp3Hit = false;
              position.partialPnl = 0;
            }

            this.position = position;
          }
          continue;
        }
        // No confirmation yet, keep waiting but also look for new signals
      }

      let signal = null;

      switch (this.strategy) {
        case 'ORDER_BLOCK':
          signal = this.getOrderBlockSignal(currentPrice, currentCandle, recentLTF, htfBias, symbolInfo);
          break;
        case 'FVG':
          signal = this.getFVGSignal(currentPrice, currentCandle, recentLTF, htfBias, atr, symbolInfo);
          break;
        case 'LIQUIDITY_SWEEP':
          signal = this.getLiquiditySweepSignal(currentPrice, currentCandle, recentLTF, htfBias, atr, symbolInfo);
          break;
        case 'BOS':
          signal = this.getBOSSignal(currentPrice, currentCandle, recentLTF, htfBias, atr, symbolInfo);
          break;
        case 'OB_FVG':
          signal = this.getOBFVGConfluenceSignal(currentPrice, currentCandle, recentLTF, htfBias, atr, symbolInfo);
          break;
        case 'M1_TREND':
          signal = this.getM1TrendSignal(currentPrice, currentCandle, recentLTF, symbolInfo);
          break;
        default:
          signal = this.getOrderBlockSignal(currentPrice, currentCandle, recentLTF, htfBias, symbolInfo);
      }

      if (this.debugFilters && i === 100) {
        console.log(`    Signal generated: ${signal ? 'YES' : 'NO'}`);
      }
      if (!signal) continue;

      // OTE Filter (if enabled)
      if (this.config.requireOTE) {
        const isInOTE = this.checkOTEZone(currentPrice, recentLTF, htfBias);
        if (!isInOTE) continue;
      }

      // If confirmation is required, store signal and wait
      if (this.requireConfirmation) {
        this.pendingSignal = {
          ...signal,
          time: currentTime,
        };
        continue;
      }

      // No confirmation required - enter immediately
      const spread = this.getTypicalSpread(this.config.symbol, symbolInfo);
      let entryPrice = signal.entry;

      // BUY enters at ASK (higher), SELL enters at BID (lower)
      if (signal.direction === 'BUY') {
        entryPrice = signal.entry + spread / 2;
      } else {
        entryPrice = signal.entry - spread / 2;
      }

      // Recalculate SL distance with spread-adjusted entry
      const slDistance = Math.abs(entryPrice - signal.sl);
      const slPips = slDistance / symbolInfo.pipSize;
      if (slPips < symbolInfo.minSlPips) {
        if (this.debugFilters) console.log(`  [FILTER] minSL: ${slPips.toFixed(1)} < ${symbolInfo.minSlPips} pips`);
        continue;
      }

      // Calculate position size with spread-adjusted entry
      const riskAmount = this.balance * (this.config.risk / 100);
      const rawLotSize = Math.round(riskAmount / (slDistance * symbolInfo.contractSize) * 100) / 100;

      // Skip if SL is too wide to size properly (would exceed intended risk)
      if (rawLotSize < symbolInfo.minVolume) {
        if (this.debugFilters) console.log(`  [FILTER] SL too wide: lot ${rawLotSize.toFixed(3)} < min ${symbolInfo.minVolume}`);
        continue;
      }
      const lotSize = rawLotSize;

      // Adjust TP to maintain the intended R:R ratio
      const intendedRR = this.config.fixedRR;
      let adjustedTP;
      if (signal.direction === 'BUY') {
        adjustedTP = entryPrice + (slDistance * intendedRR);
      } else {
        adjustedTP = entryPrice - (slDistance * intendedRR);
      }

      // Open position with tiered TP support
      const position = {
        direction: signal.direction,
        entry: entryPrice,
        sl: signal.sl,
        originalSl: signal.sl,
        tp: adjustedTP,
        lotSize,
        originalLotSize: lotSize,
        entryTime: currentTime,
        strategyType: this.strategy,
      };

      // Add tiered TP levels if enabled
      if (this.enableTieredTP) {
        if (signal.direction === 'BUY') {
          position.tp1 = entryPrice + (slDistance * this.tp1RR);
          position.tp2 = entryPrice + (slDistance * this.tp2RR);
          position.tp3 = entryPrice + (slDistance * this.tp3RR);
        } else {
          position.tp1 = entryPrice - (slDistance * this.tp1RR);
          position.tp2 = entryPrice - (slDistance * this.tp2RR);
          position.tp3 = entryPrice - (slDistance * this.tp3RR);
        }
        position.tp1Hit = false;
        position.tp2Hit = false;
        position.tp3Hit = false;
        position.partialPnl = 0; // Track accumulated partial profits
      }

      this.position = position;
    }

    // Close any remaining position
    if (this.position && ltfCandles.length > 0) {
      const lastCandle = ltfCandles[ltfCandles.length - 1];
      this.closePosition(lastCandle.close, new Date(lastCandle.time), 'END', symbolInfo);
    }

    return this.calculateMetrics();
  }

  reset() {
    this.balance = this.config.initialBalance;
    this.equity = this.config.initialBalance;
    this.peakEquity = this.config.initialBalance;
    this.trades = [];
    this.position = null;
    this.maxDrawdown = 0;
    this.dailyTracker = null;
    this.orderBlocks = [];
    this.fvgs = [];
    this.swingPoints = [];
    this.lastBOS = null;
    this.pendingSignal = null;
    this.beMovedCount = 0;
    this.opposingExitCount = 0;
    this.tp1Hits = 0;
    this.tp2Hits = 0;
    this.tp3Hits = 0;
  }

  /**
   * Check if position should be moved to breakeven
   * @param {Object} candle - Current candle
   * @param {Object} symbolInfo - Symbol information
   * @returns {boolean} - Whether SL was moved to breakeven
   */
  checkBreakeven(candle, symbolInfo) {
    if (!this.enableBreakeven || !this.position || this.position.movedToBreakeven) {
      return false;
    }

    const pos = this.position;
    const riskDistance = Math.abs(pos.entry - (pos.originalSl || pos.sl));

    // Calculate current profit in terms of R
    let currentProfitR = 0;
    if (pos.direction === 'BUY') {
      currentProfitR = (candle.high - pos.entry) / riskDistance;
    } else {
      currentProfitR = (pos.entry - candle.low) / riskDistance;
    }

    // Check if profit threshold reached
    if (currentProfitR >= this.breakevenTriggerR) {
      // Calculate breakeven SL with buffer
      const bufferAmount = this.beBufferPips * symbolInfo.pipSize;

      if (pos.direction === 'BUY') {
        const newSL = pos.entry + bufferAmount;
        // Only move if new SL is better (higher for BUY)
        if (newSL > pos.sl) {
          pos.originalSl = pos.sl; // Store original SL
          pos.sl = newSL;
          pos.movedToBreakeven = true;
          this.beMovedCount++;
          return true;
        }
      } else {
        const newSL = pos.entry - bufferAmount;
        // Only move if new SL is better (lower for SELL)
        if (newSL < pos.sl) {
          pos.originalSl = pos.sl; // Store original SL
          pos.sl = newSL;
          pos.movedToBreakeven = true;
          this.beMovedCount++;
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check for strong opposing signals that suggest closing the trade
   * @param {number} currentPrice - Current price
   * @param {Object} currentCandle - Current candle
   * @param {Array} recentMTF - Recent MTF candles
   * @param {string} htfBias - Current HTF bias
   * @returns {Object|null} - Exit signal if opposing signal found
   */
  checkOpposingSignalExit(currentPrice, currentCandle, recentMTF, htfBias) {
    if (!this.enableOpposingExit || !this.position) {
      return null;
    }

    const pos = this.position;
    const opposingDirection = pos.direction === 'BUY' ? 'BEARISH' : 'BULLISH';

    // Check for strong order blocks in opposing direction
    const opposingOB = this.orderBlocks.find(ob =>
      ob.type === opposingDirection &&
      !ob.mitigated &&
      !ob.used &&
      ob.score >= this.minOpposingScore
    );

    if (!opposingOB) return null;

    // Check if price is at the opposing OB
    const isAtOpposingOB = this.isPriceAtOB(currentPrice, opposingOB);
    if (!isAtOpposingOB) return null;

    // Check for strong opposing candle pattern (momentum against our position)
    const body = Math.abs(currentCandle.close - currentCandle.open);
    const range = currentCandle.high - currentCandle.low;
    const isStrongOpposingCandle = body > range * 0.5;

    let shouldExit = false;
    if (pos.direction === 'BUY') {
      // For BUY, look for strong bearish candle at bearish OB
      shouldExit = this.isBearishCandle(currentCandle) && isStrongOpposingCandle;
    } else {
      // For SELL, look for strong bullish candle at bullish OB
      shouldExit = this.isBullishCandle(currentCandle) && isStrongOpposingCandle;
    }

    if (shouldExit) {
      opposingOB.used = true;
      return { price: currentPrice, reason: 'OPPOSING' };
    }

    return null;
  }

  /**
   * Check if current candle confirms the pending signal direction
   * Returns true if confirmation is valid
   */
  checkConfirmation(currentCandle, prevCandle, direction) {
    if (!this.requireConfirmation) return true;

    const body = Math.abs(currentCandle.close - currentCandle.open);
    const range = currentCandle.high - currentCandle.low;
    const minBodyRatio = 0.3; // Body must be at least 30% of range

    if (this.confirmationType === 'engulf') {
      // Engulfing pattern: current candle body engulfs previous candle body
      if (direction === 'BUY') {
        const prevBody = Math.abs(prevCandle.close - prevCandle.open);
        return this.isBullishCandle(currentCandle) &&
               body > prevBody &&
               currentCandle.close > Math.max(prevCandle.open, prevCandle.close) &&
               currentCandle.open < Math.min(prevCandle.open, prevCandle.close);
      } else {
        const prevBody = Math.abs(prevCandle.close - prevCandle.open);
        return this.isBearishCandle(currentCandle) &&
               body > prevBody &&
               currentCandle.close < Math.min(prevCandle.open, prevCandle.close) &&
               currentCandle.open > Math.max(prevCandle.open, prevCandle.close);
      }
    } else if (this.confirmationType === 'strong') {
      // Strong confirmation: candle closes in direction with good body
      if (direction === 'BUY') {
        return this.isBullishCandle(currentCandle) && body > range * 0.5;
      } else {
        return this.isBearishCandle(currentCandle) && body > range * 0.5;
      }
    } else {
      // Default 'close': simple candle close in direction
      if (direction === 'BUY') {
        return this.isBullishCandle(currentCandle) && body > range * minBodyRatio;
      } else {
        return this.isBearishCandle(currentCandle) && body > range * minBodyRatio;
      }
    }
  }

  /**
   * Determine HTF bias based on market structure
   */
  determineHTFBias(candles) {
    if (candles.length < 10) return 'NEUTRAL';

    // Find swing highs and lows
    const swings = this.findSwingPoints(candles);
    if (swings.length < 4) return 'NEUTRAL';

    // Check for HH/HL (bullish) or LH/LL (bearish)
    const recentSwings = swings.slice(-4);
    const highs = recentSwings.filter(s => s.type === 'HIGH').map(s => s.price);
    const lows = recentSwings.filter(s => s.type === 'LOW').map(s => s.price);

    if (highs.length >= 2 && lows.length >= 2) {
      const isHigherHighs = highs[highs.length - 1] > highs[highs.length - 2];
      const isHigherLows = lows[lows.length - 1] > lows[lows.length - 2];
      const isLowerHighs = highs[highs.length - 1] < highs[highs.length - 2];
      const isLowerLows = lows[lows.length - 1] < lows[lows.length - 2];

      if (isHigherHighs && isHigherLows) return 'BULLISH';
      if (isLowerHighs && isLowerLows) return 'BEARISH';
    }

    // Fallback: simple trend check
    const firstClose = candles[0].close;
    const lastClose = candles[candles.length - 1].close;
    const change = (lastClose - firstClose) / firstClose;

    if (change > 0.005) return 'BULLISH';
    if (change < -0.005) return 'BEARISH';
    return 'NEUTRAL';
  }

  /**
   * Find swing highs and lows
   */
  findSwingPoints(candles, lookback = 3) {
    const swings = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i];
      let isSwingHigh = true;
      let isSwingLow = true;

      for (let j = 1; j <= lookback; j++) {
        if (candles[i - j].high >= current.high || candles[i + j].high >= current.high) {
          isSwingHigh = false;
        }
        if (candles[i - j].low <= current.low || candles[i + j].low <= current.low) {
          isSwingLow = false;
        }
      }

      if (isSwingHigh) swings.push({ type: 'HIGH', price: current.high, time: current.time, index: i });
      if (isSwingLow) swings.push({ type: 'LOW', price: current.low, time: current.time, index: i });
    }
    return swings.sort((a, b) => new Date(a.time) - new Date(b.time));
  }

  /**
   * Update Order Blocks from MTF candles
   */
  updateOrderBlocks(candles, currentTime, symbol) {
    if (candles.length < 10) return;

    const atr = this.calculateATR(candles);
    if (atr === 0) return;

    // Remove old OBs (older than 50 candles worth of time)
    const maxAge = 50 * 60 * 60 * 1000; // ~50 hours for H1
    this.orderBlocks = this.orderBlocks.filter(ob =>
      currentTime - new Date(ob.time) < maxAge && !ob.mitigated && !ob.used
    );

    // Look for new Order Blocks
    for (let i = 3; i < candles.length - 2; i++) {
      const candle = candles[i];
      const nextCandle = candles[i + 1];
      const candleAfter = candles[i + 2];

      // Bullish OB: bearish candle followed by strong bullish move
      if (this.isBearishCandle(candle)) {
        const moveUp = Math.max(nextCandle.high, candleAfter.high) - candle.low;
        if (moveUp >= atr * this.atrMult) {
          const score = this.scoreOrderBlock(candle, candles.slice(0, i + 1), 'BULLISH', atr);
          if (score >= this.minOBScore) {
            const exists = this.orderBlocks.some(ob =>
              ob.type === 'BULLISH' && Math.abs(ob.low - candle.low) < atr * 0.5
            );
            if (!exists) {
              this.orderBlocks.push({
                type: 'BULLISH',
                high: candle.high,
                low: candle.low,
                time: candle.time,
                score,
                mitigated: false,
                used: false,
              });
            }
          }
        }
      }

      // Bearish OB: bullish candle followed by strong bearish move
      if (this.isBullishCandle(candle)) {
        const moveDown = candle.high - Math.min(nextCandle.low, candleAfter.low);
        if (moveDown >= atr * this.atrMult) {
          const score = this.scoreOrderBlock(candle, candles.slice(0, i + 1), 'BEARISH', atr);
          if (score >= this.minOBScore) {
            const exists = this.orderBlocks.some(ob =>
              ob.type === 'BEARISH' && Math.abs(ob.high - candle.high) < atr * 0.5
            );
            if (!exists) {
              this.orderBlocks.push({
                type: 'BEARISH',
                high: candle.high,
                low: candle.low,
                time: candle.time,
                score,
                mitigated: false,
                used: false,
              });
            }
          }
        }
      }
    }
  }

  /**
   * Score an Order Block (0-100)
   */
  scoreOrderBlock(obCandle, precedingCandles, type, atr) {
    let score = 50; // Base score

    const body = Math.abs(obCandle.close - obCandle.open);
    const range = obCandle.high - obCandle.low;

    // Strong body (engulfing-like): +15
    if (body > range * 0.6) score += 15;

    // Fresh (not previously touched): +10
    score += 10;

    // At swing point: +15
    const swings = this.findSwingPoints(precedingCandles.slice(-10));
    const isAtSwing = swings.some(s => {
      if (type === 'BULLISH' && s.type === 'LOW') {
        return Math.abs(s.price - obCandle.low) < atr * 0.5;
      }
      if (type === 'BEARISH' && s.type === 'HIGH') {
        return Math.abs(s.price - obCandle.high) < atr * 0.5;
      }
      return false;
    });
    if (isAtSwing) score += 15;

    // Strong imbalance/displacement after: +10
    score += 10;

    return Math.min(score, 100);
  }

  /**
   * Find valid Order Block for entry
   */
  findValidOrderBlock(currentPrice, bias) {
    const validType = bias === 'BULLISH' ? 'BULLISH' : 'BEARISH';

    const candidates = this.orderBlocks.filter(ob =>
      ob.type === validType &&
      !ob.mitigated &&
      !ob.used &&
      ob.score >= this.minOBScore
    );

    if (candidates.length === 0) return null;

    // Find OB that price is currently touching or near
    for (const ob of candidates) {
      const obRange = ob.high - ob.low;
      const tolerance = obRange * 1.0; // Allow 100% tolerance (price can be within OB or slightly beyond)

      if (validType === 'BULLISH') {
        // For bullish OB, price should be at or slightly below the OB zone
        if (currentPrice <= ob.high + tolerance && currentPrice >= ob.low - tolerance) {
          return ob;
        }
      } else {
        // For bearish OB, price should be at or slightly above the OB zone
        if (currentPrice >= ob.low - tolerance && currentPrice <= ob.high + tolerance) {
          return ob;
        }
      }
    }
    return null;
  }

  /**
   * Check if price is at Order Block
   */
  isPriceAtOB(price, ob) {
    const obRange = ob.high - ob.low;
    const tolerance = obRange * 0.5; // 50% tolerance

    if (ob.type === 'BULLISH') {
      return price >= ob.low - tolerance && price <= ob.high + tolerance;
    } else {
      return price >= ob.low - tolerance && price <= ob.high + tolerance;
    }
  }

  /**
   * Check OTE (Optimal Trade Entry) zone - Fibonacci 0.618-0.786
   */
  checkOTEZone(currentPrice, candles, bias) {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const swingHigh = Math.max(...highs);
    const swingLow = Math.min(...lows);
    const range = swingHigh - swingLow;

    if (range === 0) return false;

    // OTE zone: 0.618 - 0.786 retracement
    const fib618 = bias === 'BULLISH'
      ? swingHigh - range * 0.618
      : swingLow + range * 0.618;
    const fib786 = bias === 'BULLISH'
      ? swingHigh - range * 0.786
      : swingLow + range * 0.786;

    if (bias === 'BULLISH') {
      // For buys, price should be in lower OTE zone (discount)
      return currentPrice <= fib618 && currentPrice >= fib786;
    } else {
      // For sells, price should be in upper OTE zone (premium)
      return currentPrice >= fib618 && currentPrice <= fib786;
    }
  }

  /**
   * Quality-based entry check
   * Score ≥60: Simple touch entry (relaxed)
   * Score 50-59: Require rejection candle OR candle closing in OB direction
   */
  checkEntryQuality(ob, currentCandle, recentCandles) {
    if (ob.score >= 60) {
      // Good quality OB - simple touch is enough
      return true;
    }

    // Score 50-59: Need some confirmation
    const body = Math.abs(currentCandle.close - currentCandle.open);
    const range = currentCandle.high - currentCandle.low;

    if (ob.type === 'BULLISH') {
      // Look for bullish rejection (lower wick) OR bullish candle
      const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
      const isBullishCandle = currentCandle.close > currentCandle.open;
      return (lowerWick > body * 0.3) || isBullishCandle;
    } else {
      // Look for bearish rejection (upper wick) OR bearish candle
      const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
      const isBearishCandle = currentCandle.close < currentCandle.open;
      return (upperWick > body * 0.3) || isBearishCandle;
    }
  }

  /**
   * Calculate signal with entry, SL, TP
   */
  calculateSignal(ob, currentPrice, bias, symbolInfo) {
    const direction = bias === 'BULLISH' ? 'BUY' : 'SELL';
    const entry = currentPrice;

    let sl, tp;
    const obRange = ob.high - ob.low;
    const buffer = obRange * 0.2;

    if (direction === 'BUY') {
      sl = ob.low - buffer;
      const risk = entry - sl;
      tp = entry + (risk * this.config.fixedRR);
    } else {
      sl = ob.high + buffer;
      const risk = sl - entry;
      tp = entry - (risk * this.config.fixedRR);
    }

    return { direction, entry, sl, tp };
  }

  /**
   * Check if in kill zone
   */
  isInKillZone(time) {
    const hour = time.getUTCHours();
    return (
      (hour >= KILL_ZONES.LONDON.start && hour < KILL_ZONES.LONDON.end) ||
      (hour >= KILL_ZONES.NY_AM.start && hour < KILL_ZONES.NY_AM.end) ||
      (hour >= KILL_ZONES.NY_PM.start && hour < KILL_ZONES.NY_PM.end)
    );
  }

  /**
   * Check if in cooldown period (5 min after session opens)
   */
  isInCooldown(time) {
    const hour = time.getUTCHours();
    const minute = time.getUTCMinutes();

    for (const [name, cooldown] of Object.entries(COOLDOWNS)) {
      if (hour === cooldown.hour && minute >= cooldown.minute && minute < cooldown.minute + 5) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get recent MTF candles up to current time
   */
  getRecentMTF(candles, currentTime, count) {
    return candles.filter(c => new Date(c.time) <= currentTime).slice(-count);
  }

  /**
   * Get recent HTF candles up to current time
   */
  getRecentHTF(candles, currentTime, count) {
    return candles.filter(c => new Date(c.time) <= currentTime).slice(-count);
  }

  /**
   * Calculate ATR
   */
  calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return 0;

    let atrSum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const current = candles[i];
      const prev = candles[i - 1];
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - prev.close),
        Math.abs(current.low - prev.close)
      );
      atrSum += tr;
    }
    return atrSum / period;
  }

  isBullishCandle(candle) {
    return candle.close > candle.open;
  }

  isBearishCandle(candle) {
    return candle.close < candle.open;
  }

  /**
   * Get typical spread for symbol
   * Spread varies by time of day - wider during low liquidity
   */
  getTypicalSpread(symbol, symbolInfo) {
    const baseSpread = symbolInfo.typicalSpread || symbolInfo.pipSize * 2;

    // Could add time-of-day spread widening here if needed
    // For now, use base spread with small random variation (±20%)
    const variation = 0.8 + Math.random() * 0.4;
    return baseSpread * variation;
  }

  // ============================================
  // FVG (Fair Value Gap) Detection
  // ============================================
  updateFVGs(candles, currentTime, atr) {
    if (candles.length < 5) return;

    // Remove old/filled FVGs
    const maxAge = 48 * 60 * 60 * 1000; // 48 hours
    this.fvgs = this.fvgs.filter(fvg =>
      currentTime - new Date(fvg.time) < maxAge && !fvg.filled
    );

    // Look for new FVGs (3-candle pattern with gap)
    for (let i = 2; i < candles.length; i++) {
      const c1 = candles[i - 2]; // First candle
      const c2 = candles[i - 1]; // Middle candle (creates the gap)
      const c3 = candles[i];     // Third candle

      // Bullish FVG: Gap between c1.high and c3.low
      if (c3.low > c1.high) {
        const gapSize = c3.low - c1.high;
        if (gapSize >= atr * this.minFVGSize) {
          const exists = this.fvgs.some(fvg =>
            fvg.type === 'BULLISH' && Math.abs(fvg.top - c3.low) < atr * 0.3
          );
          if (!exists) {
            this.fvgs.push({
              type: 'BULLISH',
              top: c3.low,
              bottom: c1.high,
              time: c2.time,
              size: gapSize,
              filled: false,
            });
          }
        }
      }

      // Bearish FVG: Gap between c3.high and c1.low
      if (c3.high < c1.low) {
        const gapSize = c1.low - c3.high;
        if (gapSize >= atr * this.minFVGSize) {
          const exists = this.fvgs.some(fvg =>
            fvg.type === 'BEARISH' && Math.abs(fvg.bottom - c3.high) < atr * 0.3
          );
          if (!exists) {
            this.fvgs.push({
              type: 'BEARISH',
              top: c1.low,
              bottom: c3.high,
              time: c2.time,
              size: gapSize,
              filled: false,
            });
          }
        }
      }
    }
  }

  // ============================================
  // Swing Point Tracking (for Liquidity)
  // ============================================
  updateSwingPoints(candles, currentTime) {
    if (candles.length < 10) return;

    // Keep only recent swing points
    const maxAge = 72 * 60 * 60 * 1000; // 72 hours
    this.swingPoints = this.swingPoints.filter(sp =>
      currentTime - new Date(sp.time) < maxAge && !sp.swept
    );

    const swings = this.findSwingPoints(candles, 3);
    for (const swing of swings) {
      const exists = this.swingPoints.some(sp =>
        sp.type === swing.type && Math.abs(sp.price - swing.price) < (candles[0].high - candles[0].low) * 0.5
      );
      if (!exists) {
        this.swingPoints.push({
          ...swing,
          swept: false,
        });
      }
    }
  }

  // ============================================
  // Break of Structure (BOS) Detection
  // ============================================
  checkBOS(candles, htfBias) {
    if (candles.length < 5) return;

    const swings = this.findSwingPoints(candles.slice(-15), 2);
    if (swings.length < 2) return;

    const lastCandle = candles[candles.length - 1];
    const recentHighs = swings.filter(s => s.type === 'HIGH').slice(-2);
    const recentLows = swings.filter(s => s.type === 'LOW').slice(-2);

    // Bullish BOS: Price breaks above recent swing high
    if (htfBias === 'BULLISH' && recentHighs.length > 0) {
      const lastSwingHigh = recentHighs[recentHighs.length - 1];
      if (lastCandle.close > lastSwingHigh.price && (!this.lastBOS || this.lastBOS.type !== 'BULLISH')) {
        this.lastBOS = {
          type: 'BULLISH',
          level: lastSwingHigh.price,
          time: lastCandle.time,
          confirmed: true,
        };
      }
    }

    // Bearish BOS: Price breaks below recent swing low
    if (htfBias === 'BEARISH' && recentLows.length > 0) {
      const lastSwingLow = recentLows[recentLows.length - 1];
      if (lastCandle.close < lastSwingLow.price && (!this.lastBOS || this.lastBOS.type !== 'BEARISH')) {
        this.lastBOS = {
          type: 'BEARISH',
          level: lastSwingLow.price,
          time: lastCandle.time,
          confirmed: true,
        };
      }
    }
  }

  // ============================================
  // Strategy Signal Generators
  // ============================================

  /**
   * ORDER_BLOCK Strategy
   */
  getOrderBlockSignal(currentPrice, currentCandle, recentLTF, htfBias, symbolInfo) {
    const validOB = this.findValidOrderBlock(currentPrice, htfBias);
    if (!validOB) return null;

    if (!this.isPriceAtOB(currentPrice, validOB)) return null;

    const entryAllowed = this.checkEntryQuality(validOB, currentCandle, recentLTF);
    if (!entryAllowed) return null;

    const signal = this.calculateSignal(validOB, currentPrice, htfBias, symbolInfo);
    validOB.used = true;
    return signal;
  }

  /**
   * FVG (Fair Value Gap) Strategy
   * Enter when price retraces into an unfilled FVG
   */
  getFVGSignal(currentPrice, currentCandle, recentLTF, htfBias, atr, symbolInfo) {
    const validType = htfBias === 'BULLISH' ? 'BULLISH' : 'BEARISH';

    // Find unfilled FVG that price is entering
    const validFVG = this.fvgs.find(fvg => {
      if (fvg.type !== validType || fvg.filled) return false;

      if (fvg.type === 'BULLISH') {
        // Price should be entering the gap from above (retracing down into it)
        return currentPrice <= fvg.top && currentPrice >= fvg.bottom;
      } else {
        // Price should be entering the gap from below (retracing up into it)
        return currentPrice >= fvg.bottom && currentPrice <= fvg.top;
      }
    });

    if (!validFVG) return null;

    // Look for rejection candle
    const body = Math.abs(currentCandle.close - currentCandle.open);
    const range = currentCandle.high - currentCandle.low;
    let hasRejection = false;

    if (validFVG.type === 'BULLISH') {
      const lowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
      hasRejection = lowerWick > body * 0.5 && this.isBullishCandle(currentCandle);
    } else {
      const upperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
      hasRejection = upperWick > body * 0.5 && this.isBearishCandle(currentCandle);
    }

    if (!hasRejection) return null;

    const direction = htfBias === 'BULLISH' ? 'BUY' : 'SELL';
    const entry = currentPrice;
    let sl, tp;

    if (direction === 'BUY') {
      sl = validFVG.bottom - atr * 0.5;
      const risk = entry - sl;
      tp = entry + (risk * this.config.fixedRR);
    } else {
      sl = validFVG.top + atr * 0.5;
      const risk = sl - entry;
      tp = entry - (risk * this.config.fixedRR);
    }

    validFVG.filled = true;
    return { direction, entry, sl, tp };
  }

  /**
   * LIQUIDITY_SWEEP Strategy
   * Enter after price sweeps a swing high/low and reverses
   */
  getLiquiditySweepSignal(currentPrice, currentCandle, recentLTF, htfBias, atr, symbolInfo) {
    // Look for recent liquidity sweep
    const prevCandle = recentLTF[recentLTF.length - 2];
    if (!prevCandle) return null;

    let sweptPoint = null;
    let sweepType = null;

    // Check for sweep of swing lows (bullish setup)
    if (htfBias === 'BULLISH') {
      for (const sp of this.swingPoints) {
        if (sp.type === 'LOW' && !sp.swept) {
          // Sweep: wick below the low, then close back above
          if (prevCandle.low < sp.price && prevCandle.close > sp.price) {
            sweptPoint = sp;
            sweepType = 'BULLISH';
            break;
          }
        }
      }
    }

    // Check for sweep of swing highs (bearish setup)
    if (htfBias === 'BEARISH') {
      for (const sp of this.swingPoints) {
        if (sp.type === 'HIGH' && !sp.swept) {
          // Sweep: wick above the high, then close back below
          if (prevCandle.high > sp.price && prevCandle.close < sp.price) {
            sweptPoint = sp;
            sweepType = 'BEARISH';
            break;
          }
        }
      }
    }

    if (!sweptPoint) return null;

    // Confirm with current candle continuation
    const body = Math.abs(currentCandle.close - currentCandle.open);
    let confirmed = false;

    if (sweepType === 'BULLISH') {
      confirmed = this.isBullishCandle(currentCandle) && body > atr * 0.3;
    } else {
      confirmed = this.isBearishCandle(currentCandle) && body > atr * 0.3;
    }

    if (!confirmed) return null;

    const direction = sweepType === 'BULLISH' ? 'BUY' : 'SELL';
    const entry = currentPrice;
    let sl, tp;

    if (direction === 'BUY') {
      sl = sweptPoint.price - atr * 0.5;
      const risk = entry - sl;
      tp = entry + (risk * this.config.fixedRR);
    } else {
      sl = sweptPoint.price + atr * 0.5;
      const risk = sl - entry;
      tp = entry - (risk * this.config.fixedRR);
    }

    sweptPoint.swept = true;
    return { direction, entry, sl, tp };
  }

  /**
   * BOS (Break of Structure) Strategy
   * Enter on pullback after a confirmed BOS
   */
  getBOSSignal(currentPrice, currentCandle, recentLTF, htfBias, atr, symbolInfo) {
    if (!this.lastBOS || !this.lastBOS.confirmed) return null;

    // BOS must align with HTF bias
    if (this.lastBOS.type !== htfBias) return null;

    // Check for pullback to BOS level
    const tolerance = atr * 0.5;
    let isPullback = false;

    if (this.lastBOS.type === 'BULLISH') {
      // Price should have pulled back to near the BOS level
      isPullback = currentPrice <= this.lastBOS.level + tolerance &&
                   currentPrice >= this.lastBOS.level - atr;
    } else {
      isPullback = currentPrice >= this.lastBOS.level - tolerance &&
                   currentPrice <= this.lastBOS.level + atr;
    }

    if (!isPullback) return null;

    // Look for rejection/continuation candle
    const body = Math.abs(currentCandle.close - currentCandle.open);
    let hasEntry = false;

    if (this.lastBOS.type === 'BULLISH') {
      hasEntry = this.isBullishCandle(currentCandle) && body > atr * 0.2;
    } else {
      hasEntry = this.isBearishCandle(currentCandle) && body > atr * 0.2;
    }

    if (!hasEntry) return null;

    const direction = this.lastBOS.type === 'BULLISH' ? 'BUY' : 'SELL';
    const entry = currentPrice;
    let sl, tp;

    if (direction === 'BUY') {
      sl = this.lastBOS.level - atr;
      const risk = entry - sl;
      tp = entry + (risk * this.config.fixedRR);
    } else {
      sl = this.lastBOS.level + atr;
      const risk = sl - entry;
      tp = entry - (risk * this.config.fixedRR);
    }

    // Reset BOS after use
    this.lastBOS.confirmed = false;
    return { direction, entry, sl, tp };
  }

  /**
   * OB_FVG Confluence Strategy
   * Only enter when OB and FVG overlap (high probability)
   */
  getOBFVGConfluenceSignal(currentPrice, currentCandle, recentLTF, htfBias, atr, symbolInfo) {
    const validOB = this.findValidOrderBlock(currentPrice, htfBias);
    if (!validOB) return null;

    // Check if there's an FVG that overlaps with the OB
    const validType = htfBias === 'BULLISH' ? 'BULLISH' : 'BEARISH';
    const overlappingFVG = this.fvgs.find(fvg => {
      if (fvg.type !== validType || fvg.filled) return false;

      // Check for overlap between OB range and FVG range
      const obTop = validOB.high;
      const obBottom = validOB.low;
      const fvgTop = fvg.top;
      const fvgBottom = fvg.bottom;

      return obTop >= fvgBottom && obBottom <= fvgTop;
    });

    if (!overlappingFVG) return null;

    // Price must be at both OB and FVG
    if (!this.isPriceAtOB(currentPrice, validOB)) return null;

    const direction = htfBias === 'BULLISH' ? 'BUY' : 'SELL';
    const entry = currentPrice;
    let sl, tp;

    // Use the tighter of OB or FVG for SL
    if (direction === 'BUY') {
      sl = Math.max(validOB.low, overlappingFVG.bottom) - atr * 0.3;
      const risk = entry - sl;
      tp = entry + (risk * this.config.fixedRR);
    } else {
      sl = Math.min(validOB.high, overlappingFVG.top) + atr * 0.3;
      const risk = sl - entry;
      tp = entry - (risk * this.config.fixedRR);
    }

    validOB.used = true;
    overlappingFVG.filled = true;
    return { direction, entry, sl, tp };
  }

  /**
   * M1 Trend Strategy
   * Pure trend-following using EMAs on M1 timeframe only.
   * Ignores HTF bias - determines trend direction from M1 EMAs.
   *
   * Entry Logic:
   * 1. Determine trend using EMA crossover (fast EMA vs slow EMA)
   * 2. Enter on pullbacks to fast EMA when momentum resumes
   * 3. Confirmation: current candle closes in trend direction after pullback
   */
  getM1TrendSignal(currentPrice, currentCandle, recentLTF, symbolInfo) {
    // Need enough candles for EMA calculation
    if (recentLTF.length < 55) return null;

    const closes = recentLTF.map(c => c.close);

    // Calculate EMAs
    const ema9 = this.calculateEMA(closes, 9);
    const ema21 = this.calculateEMA(closes, 21);
    const ema50 = this.calculateEMA(closes, 50);

    // Calculate previous EMAs (for crossover detection)
    const prevCloses = closes.slice(0, -1);
    const prevEma9 = this.calculateEMA(prevCloses, 9);
    const prevEma21 = this.calculateEMA(prevCloses, 21);

    // Determine trend direction
    // BULLISH: EMA9 > EMA21 > EMA50 AND price > EMA50
    // BEARISH: EMA9 < EMA21 < EMA50 AND price < EMA50
    const isBullishAlignment = ema9 > ema21 && ema21 > ema50;
    const isBearishAlignment = ema9 < ema21 && ema21 < ema50;

    // Check for recent crossover (momentum signal)
    const bullishCrossover = prevEma9 <= prevEma21 && ema9 > ema21;
    const bearishCrossover = prevEma9 >= prevEma21 && ema9 < ema21;

    // Price position relative to slow EMA
    const priceAboveEma50 = currentPrice > ema50;
    const priceBelowEma50 = currentPrice < ema50;

    let trend = 'NEUTRAL';
    if ((isBullishAlignment || bullishCrossover) && priceAboveEma50) {
      trend = 'BULLISH';
    } else if ((isBearishAlignment || bearishCrossover) && priceBelowEma50) {
      trend = 'BEARISH';
    }

    if (trend === 'NEUTRAL') return null;

    // Check for pullback entry
    const lastCandle = currentCandle;
    const prevCandle = recentLTF[recentLTF.length - 2];
    if (!prevCandle) return null;

    // Pullback tolerance: 0.05% of price
    const pullbackTolerance = currentPrice * 0.0005;

    if (trend === 'BULLISH') {
      // Bullish entry conditions:
      // 1. Price pulled back to near EMA9
      // 2. Previous candle was bearish or touched EMA9
      // 3. Current candle shows bullish momentum
      const pullbackToEma = Math.abs(currentPrice - ema9) < pullbackTolerance ||
                            (lastCandle.low <= ema9 * 1.001 && currentPrice > ema9);

      const wasPullback = prevCandle.close < prevCandle.open ||
                          prevCandle.low <= ema9 * 1.002;

      const hasMomentum = lastCandle.close > lastCandle.open &&
                          lastCandle.close > ema9;

      if (!pullbackToEma && !wasPullback) return null;
      if (!hasMomentum) return null;

      // Find swing low for stop loss (last 10 candles)
      const lookbackCandles = recentLTF.slice(-10);
      const swingLow = Math.min(...lookbackCandles.map(c => c.low));
      if (swingLow >= currentPrice) return null;

      // Add buffer to stop loss (10% of risk)
      const slBuffer = (currentPrice - swingLow) * 0.1;
      const sl = swingLow - slBuffer;
      const entry = currentPrice;
      const risk = entry - sl;
      const tp = entry + (risk * this.config.fixedRR);

      return { direction: 'BUY', entry, sl, tp };

    } else {
      // Bearish entry conditions
      const pullbackToEma = Math.abs(currentPrice - ema9) < pullbackTolerance ||
                            (lastCandle.high >= ema9 * 0.999 && currentPrice < ema9);

      const wasPullback = prevCandle.close > prevCandle.open ||
                          prevCandle.high >= ema9 * 0.998;

      const hasMomentum = lastCandle.close < lastCandle.open &&
                          lastCandle.close < ema9;

      if (!pullbackToEma && !wasPullback) return null;
      if (!hasMomentum) return null;

      // Find swing high for stop loss
      const lookbackCandles = recentLTF.slice(-10);
      const swingHigh = Math.max(...lookbackCandles.map(c => c.high));
      if (swingHigh <= currentPrice) return null;

      // Add buffer to stop loss
      const slBuffer = (swingHigh - currentPrice) * 0.1;
      const sl = swingHigh + slBuffer;
      const entry = currentPrice;
      const risk = sl - entry;
      const tp = entry - (risk * this.config.fixedRR);

      return { direction: 'SELL', entry, sl, tp };
    }
  }

  /**
   * Calculate Exponential Moving Average
   */
  calculateEMA(values, period) {
    if (values.length < period) {
      return values[values.length - 1];
    }

    const multiplier = 2 / (period + 1);

    // Start with SMA for the first 'period' values
    let ema = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;

    // Calculate EMA for remaining values
    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Check exit with realistic intra-candle price simulation
   * Supports tiered TP (TP1, TP2, TP3) with partial closes
   *
   * OHLC Sequence Heuristic:
   * - Bullish candle (close > open): O -> L -> H -> C (dip then rally)
   * - Bearish candle (close < open): O -> H -> L -> C (rally then dip)
   * - Doji (close ≈ open): Use wick sizes to determine sequence
   *
   * This handles the critical case where both SL and TP are within
   * the candle's range - we simulate which would be hit first.
   */
  checkExit(candle) {
    if (!this.position) return null;
    const pos = this.position;

    // Handle tiered TP if enabled
    if (this.enableTieredTP) {
      return this.checkTieredExit(candle);
    }

    const slHit = pos.direction === 'BUY'
      ? candle.low <= pos.sl
      : candle.high >= pos.sl;

    const tpHit = pos.direction === 'BUY'
      ? candle.high >= pos.tp
      : candle.low <= pos.tp;

    // Neither hit
    if (!slHit && !tpHit) return null;

    // Only one hit - straightforward
    if (slHit && !tpHit) return { price: pos.sl, reason: 'SL' };
    if (tpHit && !slHit) return { price: pos.tp, reason: 'TP' };

    // BOTH hit within this candle - need to determine sequence
    // Simulate intra-candle price path using OHLC
    const pricePath = this.simulatePricePath(candle);

    for (const price of pricePath) {
      if (pos.direction === 'BUY') {
        if (price <= pos.sl) {
          // SL hit - apply slippage (unfavorable)
          const slippage = this.getSlippage(pos.sl, 'SL');
          return { price: pos.sl - slippage, reason: 'SL' };
        }
        if (price >= pos.tp) {
          // TP hit - minimal slippage on limit orders
          return { price: pos.tp, reason: 'TP' };
        }
      } else {
        if (price >= pos.sl) {
          // SL hit - apply slippage (unfavorable)
          const slippage = this.getSlippage(pos.sl, 'SL');
          return { price: pos.sl + slippage, reason: 'SL' };
        }
        if (price <= pos.tp) {
          // TP hit - minimal slippage on limit orders
          return { price: pos.tp, reason: 'TP' };
        }
      }
    }

    // Fallback (shouldn't reach here)
    return { price: pos.sl, reason: 'SL' };
  }

  /**
   * Check tiered TP exits (TP1, TP2, TP3 with partial closes)
   * Returns exit result or null, handles partial closes internally
   */
  checkTieredExit(candle) {
    const pos = this.position;
    const symbolInfo = SYMBOL_INFO[this.config.symbol] || SYMBOL_INFO['XAUUSD.s'];

    // Check SL first (full close)
    const slHit = pos.direction === 'BUY'
      ? candle.low <= pos.sl
      : candle.high >= pos.sl;

    // Check each TP level
    const tp1Hit = !pos.tp1Hit && (pos.direction === 'BUY'
      ? candle.high >= pos.tp1
      : candle.low <= pos.tp1);

    const tp2Hit = !pos.tp2Hit && pos.tp1Hit && (pos.direction === 'BUY'
      ? candle.high >= pos.tp2
      : candle.low <= pos.tp2);

    const tp3Hit = !pos.tp3Hit && pos.tp2Hit && (pos.direction === 'BUY'
      ? candle.high >= pos.tp3
      : candle.low <= pos.tp3);

    // Simulate price path to determine order of hits
    const pricePath = this.simulatePricePath(candle);

    for (const price of pricePath) {
      // Check SL
      if (pos.direction === 'BUY' && price <= pos.sl) {
        return { price: pos.sl, reason: 'SL', isFull: true };
      }
      if (pos.direction === 'SELL' && price >= pos.sl) {
        return { price: pos.sl, reason: 'SL', isFull: true };
      }

      // Check TP1
      if (!pos.tp1Hit) {
        if ((pos.direction === 'BUY' && price >= pos.tp1) ||
            (pos.direction === 'SELL' && price <= pos.tp1)) {
          // Partial close at TP1
          const closePercent = this.tp1Percent / 100;
          const closeLots = pos.originalLotSize * closePercent;
          const pnl = this.calculatePartialPnl(pos.entry, pos.tp1, closeLots, pos.direction, symbolInfo);

          pos.partialPnl += pnl;
          pos.lotSize = pos.originalLotSize * (1 - closePercent);
          pos.tp1Hit = true;
          this.tp1Hits++;

          // Move SL to breakeven after TP1 if enabled
          if (this.moveSlOnTP1) {
            const bufferAmount = this.beBufferPips * symbolInfo.pipSize;
            if (pos.direction === 'BUY') {
              pos.sl = pos.entry + bufferAmount;
            } else {
              pos.sl = pos.entry - bufferAmount;
            }
            pos.movedToBreakeven = true;
          }

          // Continue checking for more TPs in same candle
          continue;
        }
      }

      // Check TP2
      if (pos.tp1Hit && !pos.tp2Hit) {
        if ((pos.direction === 'BUY' && price >= pos.tp2) ||
            (pos.direction === 'SELL' && price <= pos.tp2)) {
          // Partial close at TP2
          const closePercent = this.tp2Percent / (100 - this.tp1Percent);
          const closeLots = pos.lotSize * closePercent;
          const pnl = this.calculatePartialPnl(pos.entry, pos.tp2, closeLots, pos.direction, symbolInfo);

          pos.partialPnl += pnl;
          pos.lotSize -= closeLots;
          pos.tp2Hit = true;
          this.tp2Hits++;

          // Optionally move SL to TP1 level after TP2
          if (this.moveSlOnTP2) {
            pos.sl = pos.tp1;
          }

          continue;
        }
      }

      // Check TP3 (final close)
      if (pos.tp2Hit && !pos.tp3Hit) {
        if ((pos.direction === 'BUY' && price >= pos.tp3) ||
            (pos.direction === 'SELL' && price <= pos.tp3)) {
          pos.tp3Hit = true;
          this.tp3Hits++;
          return { price: pos.tp3, reason: 'TP3', isFull: true };
        }
      }
    }

    // No exit this candle
    return null;
  }

  /**
   * Calculate P&L for partial close
   */
  calculatePartialPnl(entry, exitPrice, lotSize, direction, symbolInfo) {
    if (direction === 'BUY') {
      return (exitPrice - entry) * lotSize * symbolInfo.contractSize;
    } else {
      return (entry - exitPrice) * lotSize * symbolInfo.contractSize;
    }
  }

  /**
   * Simulate slippage on stop orders
   * SL orders are market orders when triggered, so they can slip
   */
  getSlippage(price, orderType) {
    if (orderType === 'TP') {
      return 0; // TP is a limit order, minimal slippage
    }
    // SL slippage: typically 0-2 pips, occasionally more during volatility
    const symbolInfo = SYMBOL_INFO[this.config.symbol] || SYMBOL_INFO['XAUUSD.s'];
    const maxSlippage = symbolInfo.pipSize * 2;
    return Math.random() * maxSlippage;
  }

  /**
   * Simulate realistic intra-candle price path
   * Returns array of prices in likely chronological order
   */
  simulatePricePath(candle) {
    const { open, high, low, close } = candle;
    const isBullish = close > open;
    const isBearish = close < open;

    // Calculate wick sizes
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;
    const body = Math.abs(close - open);

    // Generate intermediate price points for more accuracy
    const midHigh = (Math.max(open, close) + high) / 2;
    const midLow = (Math.min(open, close) + low) / 2;

    if (isBullish) {
      // Bullish: O -> dip to L -> rally to H -> settle at C
      if (lowerWick > upperWick) {
        // Strong lower wick: went down first, then up
        return [open, midLow, low, midLow, open, midHigh, high, midHigh, close];
      } else {
        // Small lower wick: slight dip then strong rally
        return [open, low, midLow, open, midHigh, high, close];
      }
    } else if (isBearish) {
      // Bearish: O -> rally to H -> drop to L -> settle at C
      if (upperWick > lowerWick) {
        // Strong upper wick: went up first, then down
        return [open, midHigh, high, midHigh, open, midLow, low, midLow, close];
      } else {
        // Small upper wick: slight rally then strong drop
        return [open, high, midHigh, open, midLow, low, close];
      }
    } else {
      // Doji: use wick dominance
      if (upperWick > lowerWick) {
        return [open, high, low, close];
      } else {
        return [open, low, high, close];
      }
    }
  }

  closePosition(exitPrice, exitTime, reason, symbolInfo) {
    if (!this.position) return;

    // Calculate remaining P&L for current position size
    let remainingPnl;
    if (this.position.direction === 'BUY') {
      remainingPnl = (exitPrice - this.position.entry) * this.position.lotSize * symbolInfo.contractSize;
    } else {
      remainingPnl = (this.position.entry - exitPrice) * this.position.lotSize * symbolInfo.contractSize;
    }

    // Add partial profits from tiered TP if applicable
    const partialPnl = this.position.partialPnl || 0;
    const totalPnl = remainingPnl + partialPnl;

    this.balance += totalPnl;
    this.equity = this.balance;

    if (this.equity > this.peakEquity) this.peakEquity = this.equity;
    const dd = ((this.peakEquity - this.equity) / this.peakEquity) * 100;
    if (dd > this.maxDrawdown) this.maxDrawdown = dd;

    // Determine exit reason for tiered TP
    let finalReason = reason;
    if (this.enableTieredTP) {
      if (this.position.tp3Hit) {
        finalReason = 'TP3';
      } else if (this.position.tp2Hit && reason === 'SL') {
        finalReason = 'SL_AFTER_TP2';
      } else if (this.position.tp1Hit && reason === 'SL') {
        finalReason = 'SL_AFTER_TP1';
      }
    }

    this.trades.push({
      direction: this.position.direction,
      entry: this.position.entry,
      exit: exitPrice,
      sl: this.position.sl,
      originalSl: this.position.originalSl,
      tp: this.position.tp,
      pnl: totalPnl,
      partialPnl,
      remainingPnl,
      isWinner: totalPnl > 0,
      reason: finalReason,
      obScore: this.position.obScore,
      movedToBreakeven: this.position.movedToBreakeven || false,
      // Tiered TP info
      tp1Hit: this.position.tp1Hit || false,
      tp2Hit: this.position.tp2Hit || false,
      tp3Hit: this.position.tp3Hit || false,
    });

    this.position = null;
  }

  checkDailyDD(currentTime) {
    const dateStr = currentTime.toISOString().split('T')[0];
    if (!this.dailyTracker || this.dailyTracker.date !== dateStr) {
      this.dailyTracker = { date: dateStr, start: this.balance, locked: false };
    }
    if (this.dailyTracker.locked) return false;

    const dailyDD = ((this.dailyTracker.start - this.balance) / this.dailyTracker.start) * 100;
    if (dailyDD >= this.maxDailyDD) {
      this.dailyTracker.locked = true;
      return false;
    }
    return true;
  }

  calculateMetrics() {
    const winning = this.trades.filter(t => t.isWinner);
    const losing = this.trades.filter(t => !t.isWinner);
    const totalPnl = this.trades.reduce((s, t) => s + t.pnl, 0);

    const grossProfit = winning.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losing.reduce((s, t) => s + t.pnl, 0));
    const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Count exit reasons
    const slExits = this.trades.filter(t => t.reason === 'SL').length;
    const tpExits = this.trades.filter(t => t.reason === 'TP').length;
    const opposingExits = this.trades.filter(t => t.reason === 'OPPOSING').length;
    const beHits = this.trades.filter(t => t.movedToBreakeven && t.reason === 'SL').length;

    // Tiered TP metrics
    const tp1Exits = this.trades.filter(t => t.tp1Hit).length;
    const tp2Exits = this.trades.filter(t => t.tp2Hit).length;
    const tp3Exits = this.trades.filter(t => t.tp3Hit).length;
    const slAfterTp1 = this.trades.filter(t => t.reason === 'SL_AFTER_TP1').length;
    const slAfterTp2 = this.trades.filter(t => t.reason === 'SL_AFTER_TP2').length;

    return {
      totalTrades: this.trades.length,
      winningTrades: winning.length,
      losingTrades: losing.length,
      winRate: this.trades.length > 0 ? (winning.length / this.trades.length) * 100 : 0,
      profitFactor: isFinite(pf) ? pf : 0,
      maxDrawdown: this.maxDrawdown,
      totalPnl,
      totalPnlPercent: (totalPnl / this.config.initialBalance) * 100,
      finalBalance: this.balance,
      // Existing metrics
      beMovedCount: this.beMovedCount,
      beHits, // Trades that were moved to BE and then hit SL
      opposingExits,
      slExits,
      tpExits,
      // Tiered TP metrics
      tp1Hits: this.tp1Hits,
      tp2Hits: this.tp2Hits,
      tp3Hits: this.tp3Hits,
      tp1Exits,
      tp2Exits,
      tp3Exits,
      slAfterTp1,
      slAfterTp2,
    };
  }
}

/**
 * File-based candle cache for faster backtests
 */
function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function clearCache() {
  if (existsSync(CACHE_DIR)) {
    const files = readdirSync(CACHE_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        unlinkSync(join(CACHE_DIR, file));
      }
    }
    console.log(`Cleared ${files.length} cached files.`);
  }
}

function getCacheKey(symbol, timeframe, startDate, endDate) {
  const start = startDate.toISOString().split('T')[0];
  const end = endDate.toISOString().split('T')[0];
  return `${symbol}_${timeframe}_${start}_${end}.json`;
}

// Expected candles per day for each timeframe (approximate, for forex ~5 days/week)
const CANDLES_PER_DAY = {
  M1: 1440,   // 24 * 60
  M5: 288,    // 24 * 12
  M15: 96,    // 24 * 4
  M30: 48,    // 24 * 2
  H1: 24,
  H4: 6,
  D1: 1,
};

function getCachedCandles(symbol, timeframe, startDate, endDate) {
  ensureCacheDir();
  const cacheFile = join(CACHE_DIR, getCacheKey(symbol, timeframe, startDate, endDate));

  if (existsSync(cacheFile)) {
    try {
      const data = JSON.parse(readFileSync(cacheFile, 'utf-8'));
      // Convert time strings back to Date objects
      const candles = data.map(c => ({ ...c, time: new Date(c.time) }));

      // Validate cache has enough candles for the date range
      const days = (endDate - startDate) / (1000 * 60 * 60 * 24);
      const expectedMin = days * (CANDLES_PER_DAY[timeframe] || 24) * 0.5; // 50% threshold (weekends, holidays)

      if (candles.length < expectedMin) {
        console.log(`  [Cache] ${timeframe}: Cache has ${candles.length} candles, expected ~${Math.round(expectedMin)}+. Re-fetching...`);
        return null; // Cache is incomplete, re-fetch
      }

      return candles;
    } catch (e) {
      return null;
    }
  }
  return null;
}

function saveCandlesToCache(candles, symbol, timeframe, startDate, endDate) {
  ensureCacheDir();
  const cacheFile = join(CACHE_DIR, getCacheKey(symbol, timeframe, startDate, endDate));

  try {
    // Convert Date objects to ISO strings for JSON serialization
    const data = candles.map(c => ({ ...c, time: c.time.toISOString() }));
    writeFileSync(cacheFile, JSON.stringify(data));
  } catch (e) {
    console.warn(`Warning: Could not save cache: ${e.message}`);
  }
}

async function fetchCandles(account, symbol, timeframe, startDate, endDate) {
  // Check cache first
  const cached = getCachedCandles(symbol, timeframe, startDate, endDate);
  if (cached && cached.length > 0) {
    console.log(`  [Cache] ${timeframe}: ${cached.length} candles from cache`);
    return cached;
  }

  const tfMap = { M1: '1m', M5: '5m', M15: '15m', M30: '30m', H1: '1h', H4: '4h', D1: '1d' };
  const tf = tfMap[timeframe] || '1h';
  const candles = [];

  // Calculate expected candles for progress display
  const days = (endDate - startDate) / (1000 * 60 * 60 * 24);
  const expectedCandles = Math.round(days * (CANDLES_PER_DAY[timeframe] || 24) * 0.7);
  let batchCount = 0;
  const maxBatches = Math.ceil(expectedCandles / 1000) + 10;

  // MetaAPI returns candles BACKWARDS from startTime, so we start from endDate and work back
  let currentEnd = new Date(endDate);
  const tfMinutes = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 };
  const candleDurationMs = (tfMinutes[timeframe] || 60) * 60 * 1000;

  process.stdout.write(`  [API] ${timeframe}: Fetching...`);

  while (currentEnd > startDate && batchCount < maxBatches) {
    try {
      const batch = await account.getHistoricalCandles(symbol, tf, currentEnd, 1000);
      if (!batch || batch.length === 0) break;

      const mapped = batch
        .map(c => ({
          time: new Date(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.tickVolume || 0,
        }))
        .filter(c => c.time >= startDate && c.time <= endDate);

      // Add to beginning since we're fetching backwards
      candles.unshift(...mapped);
      batchCount++;

      // Progress indicator
      if (batchCount % 5 === 0) {
        process.stdout.write(`\r  [API] ${timeframe}: Fetching... ${candles.length} candles (batch ${batchCount})`);
      }

      if (batch.length < 1000) break;

      // Find the earliest candle time and go further back
      const earliestTime = new Date(Math.min(...batch.map(c => new Date(c.time).getTime())));
      if (earliestTime >= currentEnd) break; // No progress, stop

      currentEnd = new Date(earliestTime.getTime() - candleDurationMs);

      // Rate limit: 200ms between requests
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      if (e.message && (e.message.includes('rate limit') || e.message.includes('throttl'))) {
        console.log(`\n  [API] Rate limited, waiting 5 seconds...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      console.error(`\n  [API] Error fetching candles: ${e.message}`);
      break;
    }
  }

  // Sort candles by time (oldest first) in case of any order issues
  candles.sort((a, b) => a.time - b.time);

  // Remove duplicates (same timestamp)
  const uniqueCandles = [];
  let lastTime = null;
  for (const c of candles) {
    if (!lastTime || c.time.getTime() !== lastTime.getTime()) {
      uniqueCandles.push(c);
      lastTime = c.time;
    }
  }

  // Clear progress line and show final count
  process.stdout.write(`\r  [API] ${timeframe}: ${uniqueCandles.length} candles fetched and cached        \n`);

  // Save to cache for future runs
  if (uniqueCandles.length > 0) {
    saveCandlesToCache(uniqueCandles, symbol, timeframe, startDate, endDate);
  }

  return uniqueCandles;
}

function printTable(results, periodInfo = null) {
  const sorted = [...results].sort((a, b) => b.totalPnl - a.totalPnl);

  // Check if any results have BE, opposing exit, or tiered TP data
  const hasBEData = sorted.some(r => r.beMovedCount > 0 || r.beHits > 0);
  const hasOpposingData = sorted.some(r => r.opposingExits > 0);
  const hasTieredData = sorted.some(r => r.tp1Hits > 0 || r.tp2Hits > 0 || r.tp3Hits > 0);

  const lineWidth = hasTieredData ? 160 : (hasBEData || hasOpposingData ? 130 : 100);

  console.log('\n' + '='.repeat(lineWidth));
  console.log('BACKTEST COMPARISON RESULTS');
  if (periodInfo) {
    console.log(`Period: ${periodInfo.startDate} to ${periodInfo.endDate} (${periodInfo.days} days)`);
  }
  console.log('='.repeat(lineWidth));

  let header = 'Strategy'.padEnd(30) +
    'Trades'.padStart(8) +
    'Win%'.padStart(8) +
    'PF'.padStart(8) +
    'PnL $'.padStart(12) +
    'MaxDD%'.padStart(10) +
    'Final $'.padStart(12);

  if (hasBEData) {
    header += 'BE Mvd'.padStart(8) + 'BE Hit'.padStart(8);
  }
  if (hasOpposingData) {
    header += 'OppEx'.padStart(8);
  }
  if (hasTieredData) {
    header += 'TP1'.padStart(6) + 'TP2'.padStart(6) + 'TP3'.padStart(6) + 'SL@TP1'.padStart(8);
  }

  console.log(header);
  console.log('-'.repeat(lineWidth));

  for (const r of sorted) {
    const color = r.totalPnl >= 0 ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    let row = r.name.substring(0, 29).padEnd(30) +
      r.totalTrades.toString().padStart(8) +
      r.winRate.toFixed(1).padStart(8) +
      r.profitFactor.toFixed(2).padStart(8) +
      `${color}${r.totalPnl.toFixed(0)}${reset}`.padStart(22) +
      r.maxDrawdown.toFixed(1).padStart(10) +
      r.finalBalance.toFixed(0).padStart(12);

    if (hasBEData) {
      row += (r.beMovedCount || 0).toString().padStart(8) +
             (r.beHits || 0).toString().padStart(8);
    }
    if (hasOpposingData) {
      row += (r.opposingExits || 0).toString().padStart(8);
    }
    if (hasTieredData) {
      row += (r.tp1Hits || 0).toString().padStart(6) +
             (r.tp2Hits || 0).toString().padStart(6) +
             (r.tp3Hits || 0).toString().padStart(6) +
             (r.slAfterTp1 || 0).toString().padStart(8);
    }

    console.log(row);
  }

  console.log('='.repeat(lineWidth));

  if (sorted.length > 0) {
    const winner = sorted[0];
    console.log(`\n${'*'.repeat(60)}`);
    console.log(`  WINNING STRATEGY: "${winner.name}"`);
    console.log(`  Win Rate: ${winner.winRate.toFixed(1)}% | PF: ${winner.profitFactor.toFixed(2)} | PnL: $${winner.totalPnl.toFixed(2)}`);
    if (winner.beMovedCount > 0) {
      console.log(`  BE Moved: ${winner.beMovedCount} trades | BE Hits: ${winner.beHits || 0}`);
    }
    if (winner.opposingExits > 0) {
      console.log(`  Opposing Exits: ${winner.opposingExits}`);
    }
    if (winner.tp1Hits > 0) {
      console.log(`  Tiered TP: TP1=${winner.tp1Hits} | TP2=${winner.tp2Hits || 0} | TP3=${winner.tp3Hits || 0} | SL after TP1=${winner.slAfterTp1 || 0}`);
    }
    console.log(`${'*'.repeat(60)}\n`);
  }
}

async function main() {
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.clearCache) {
    clearCache();
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║           QUICK CLI BACKTEST - MT5 API TRADER              ║
╠════════════════════════════════════════════════════════════╣
║  Symbols:   ${options.symbols.join(', ').padEnd(46)}║
║  Period:    ${options.startDate} to ${options.endDate}                  ║
║  Balance:   $${options.balance.toString().padEnd(45)}║
║  Risk:      ${options.risk}% per trade                                 ║
╚════════════════════════════════════════════════════════════╝
`);

  if (!API_TOKEN || !ACCOUNT_ID) {
    console.error('Error: META_API_TOKEN and META_API_ACCOUNT_ID must be set in .env');
    process.exit(1);
  }

  try {
    // Import MetaAPI (use Node.js specific build to avoid 'window is not defined')
    console.log('Connecting to MetaAPI...');
    const metaModule = await import('metaapi.cloud-sdk/node');

    // Handle different export structures
    MetaApi = metaModule.default;
    if (MetaApi && typeof MetaApi === 'object' && MetaApi.default) {
      MetaApi = MetaApi.default;
    }
    if (typeof MetaApi !== 'function' && MetaApi && MetaApi.MetaApi) {
      MetaApi = MetaApi.MetaApi;
    }
    if (typeof MetaApi !== 'function') {
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      MetaApi = require('metaapi.cloud-sdk');
      if (MetaApi.default) MetaApi = MetaApi.default;
    }

    const api = new MetaApi(API_TOKEN);
    const account = await api.metatraderAccountApi.getAccount(ACCOUNT_ID);

    if (account.state !== 'DEPLOYED') {
      await account.deploy();
    }
    await account.waitConnected();
    console.log('Connected.\n');

    const startDate = new Date(options.startDate);
    const endDate = new Date(options.endDate);
    const periodDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
    const periodInfo = {
      startDate: options.startDate,
      endDate: options.endDate,
      days: periodDays,
    };

    const allResults = [];

    // Determine which timeframe presets to test
    const timeframesToTest = options.compareTimeframes
      ? Object.entries(TIMEFRAME_PRESETS)
      : [[options.timeframe, TIMEFRAME_PRESETS[options.timeframe] || TIMEFRAME_PRESETS.standard]];

    // Loop through all symbols
    for (const symbol of options.symbols) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`  ${symbol}`);
      console.log(`${'─'.repeat(60)}`);

      // If comparing timeframes, we need to fetch all possible timeframes first
      const candleCache = {};
      const allTimeframesNeeded = new Set();

      for (const [, tfPreset] of timeframesToTest) {
        allTimeframesNeeded.add(tfPreset.htf);
        allTimeframesNeeded.add(tfPreset.mtf);
        allTimeframesNeeded.add(tfPreset.ltf);
      }

      console.log('Fetching data...');
      for (const tf of allTimeframesNeeded) {
        candleCache[tf] = await fetchCandles(account, symbol, tf, startDate, endDate);
      }

      // Show data summary
      const dataSummary = Array.from(allTimeframesNeeded).map(tf => `${tf}=${candleCache[tf]?.length || 0}`).join(', ');
      console.log(`  Data: ${dataSummary} candles`);

      if (options.compareTimeframes) {
        // Compare all timeframe presets
        console.log(`\nTesting ${timeframesToTest.length} timeframe configurations...\n`);

        const symbolResults = [];
        for (const [tfName, tfPreset] of timeframesToTest) {
          const htfCandles = candleCache[tfPreset.htf] || [];
          const mtfCandles = candleCache[tfPreset.mtf] || [];
          const ltfCandles = candleCache[tfPreset.ltf] || [];

          if (ltfCandles.length < 100) {
            console.log(`  [${tfPreset.name}] Skipping: Insufficient LTF data (${ltfCandles.length} candles)`);
            continue;
          }

          process.stdout.write(`  ${tfPreset.name.padEnd(28)}  `);

          // Use aggressive settings for timeframe comparison
          const config = {
            symbol,
            strategy: 'ORDER_BLOCK',
            initialBalance: options.balance,
            risk: options.risk,
            requireOTE: false,
            fixedRR: 2,
            minOBScore: 70,
            minFVGSize: 1.0,
            useKillZones: false,
            maxDailyDD: 8,
            atrMult: 1.0,
            requireConfirmation: true,
            confirmationType: 'engulf',
          };

          const engine = new SMCBacktestEngine(config);
          const metrics = await engine.run(htfCandles, mtfCandles, ltfCandles);

          symbolResults.push({ name: tfPreset.name, symbol, timeframe: tfName, ...metrics });
          allResults.push({ name: `${symbol} | ${tfPreset.name}`, symbol, timeframe: tfName, ...metrics });
          console.log(`${metrics.totalTrades.toString().padStart(4)} trades | ${metrics.winRate.toFixed(0).padStart(3)}% | PF ${metrics.profitFactor.toFixed(2)} | $${metrics.totalPnl.toFixed(0)}`);
        }

        printTable(symbolResults, periodInfo);

      } else if (options.optimize || options.compareAll) {
        // Use the selected timeframe preset
        const tfPreset = TIMEFRAME_PRESETS[options.timeframe] || TIMEFRAME_PRESETS.standard;
        const htfCandles = candleCache[tfPreset.htf] || [];
        const mtfCandles = candleCache[tfPreset.mtf] || [];
        const ltfCandles = candleCache[tfPreset.ltf] || [];

        if (ltfCandles.length < 100) {
          console.log(`Skipping: Insufficient data (${ltfCandles.length} candles)`);
          continue;
        }

        console.log(`Using timeframe: ${tfPreset.name}`);
        console.log(`Testing ${VARIATIONS.length} variations...\n`);

        const symbolResults = [];
        for (let i = 0; i < VARIATIONS.length; i++) {
          const v = VARIATIONS[i];
          process.stdout.write(`  [${i + 1}/${VARIATIONS.length}] ${v.name.substring(0, 30).padEnd(30)}  `);

          const config = {
            symbol,
            strategy: v.strategy || 'ORDER_BLOCK',
            initialBalance: options.balance,
            risk: options.risk,
            requireOTE: v.requireOTE,
            fixedRR: v.fixedRR,
            minOBScore: v.minOBScore || 65,
            minFVGSize: v.minFVGSize || 1.0,
            useKillZones: v.useKillZones,
            maxDailyDD: v.maxDailyDD || 15,
            atrMult: v.atrMult || 1.0,
            requireConfirmation: v.requireConfirmation || false,
            confirmationType: v.confirmationType || 'close',
            // Breakeven settings
            enableBreakeven: v.enableBreakeven || false,
            breakevenTriggerR: v.breakevenTriggerR || 1.0,
            beBufferPips: v.beBufferPips || 2,
            // Opposing signal exit settings
            enableOpposingExit: v.enableOpposingExit || false,
            minOpposingScore: v.minOpposingScore || 75,
          };

          const engine = new SMCBacktestEngine(config);
          const metrics = await engine.run(htfCandles, mtfCandles, ltfCandles);

          symbolResults.push({ name: v.name, symbol, ...metrics });
          allResults.push({ name: `${symbol} | ${v.name}`, symbol, ...metrics });
          console.log(`${metrics.totalTrades.toString().padStart(3)} trades | ${metrics.winRate.toFixed(0).padStart(3)}% | $${metrics.totalPnl.toFixed(0)}`);
        }

        printTable(symbolResults, periodInfo);

      } else {
        // Single strategy run with selected timeframe
        const tfPreset = TIMEFRAME_PRESETS[options.timeframe] || TIMEFRAME_PRESETS.standard;
        const htfCandles = candleCache[tfPreset.htf] || [];
        const mtfCandles = candleCache[tfPreset.mtf] || [];
        const ltfCandles = candleCache[tfPreset.ltf] || [];

        if (ltfCandles.length < 100) {
          console.log(`Skipping: Insufficient data (${ltfCandles.length} candles)`);
          continue;
        }

        const config = {
          symbol,
          strategy: options.strategy || 'ORDER_BLOCK',
          initialBalance: options.balance,
          risk: options.risk,
          requireOTE: false,
          fixedRR: 2,
          minOBScore: 70,
          minFVGSize: 1.0,
          useKillZones: false,
          maxDailyDD: 8,
          atrMult: 1.0,
          // Breakeven settings (maximum profit)
          enableBreakeven: true,
          breakevenTriggerR: 1.0,  // Move SL to BE at 1R profit
          beBufferPips: 5,         // Lock in 5 pips profit
          debugFilters: options.debug,
        };

        const engine = new SMCBacktestEngine(config);
        const metrics = await engine.run(htfCandles, mtfCandles, ltfCandles);

        allResults.push({ name: symbol, symbol, ...metrics });

        console.log(`  Timeframe: ${tfPreset.name}`);
        console.log(`  Period:    ${periodInfo.startDate} to ${periodInfo.endDate} (${periodInfo.days} days)`);
        console.log(`  Trades:    ${metrics.totalTrades}`);
        console.log(`  Win Rate:  ${metrics.winRate.toFixed(1)}%`);
        console.log(`  PnL:       $${metrics.totalPnl.toFixed(2)} (${metrics.totalPnlPercent.toFixed(1)}%)`);
        console.log(`  Max DD:    ${metrics.maxDrawdown.toFixed(1)}%`);
      }
    }

    // Print combined summary for multiple symbols
    if (options.symbols.length > 1 && allResults.length > 0) {
      console.log(`\n${'═'.repeat(60)}`);
      console.log('  COMBINED SUMMARY');
      console.log(`  Period: ${periodInfo.startDate} to ${periodInfo.endDate} (${periodInfo.days} days)`);
      console.log(`${'═'.repeat(60)}`);

      const totalTrades = allResults.reduce((s, r) => s + r.totalTrades, 0);
      const totalWins = allResults.reduce((s, r) => s + r.winningTrades, 0);
      const totalPnl = allResults.reduce((s, r) => s + r.totalPnl, 0);
      const avgWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

      console.log(`  Total Trades:  ${totalTrades}`);
      console.log(`  Overall Win%:  ${avgWinRate.toFixed(1)}%`);
      console.log(`  Total PnL:     $${totalPnl.toFixed(2)}`);

      if (options.optimize || options.compareAll) {
        const best = [...allResults].sort((a, b) => b.totalPnl - a.totalPnl)[0];
        if (best) {
          console.log(`\n  Best: "${best.name}"`);
          console.log(`        $${best.totalPnl.toFixed(2)} | ${best.winRate.toFixed(1)}% win rate`);
        }
      }
      console.log(`${'═'.repeat(60)}\n`);
    }

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
