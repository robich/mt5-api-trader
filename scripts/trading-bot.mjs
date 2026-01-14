#!/usr/bin/env node
/**
 * MT5 Trading Bot - Live Trading Script
 *
 * This script runs continuously and executes trades based on the
 * optimized Order Block strategy from backtesting.
 *
 * Best Strategies (from backtest-insights.md):
 * - BTCUSD: OB70|All|DD8%|Engulf (81% WR, 3.52 PF)
 * - XAUUSD: OB70|All|DD8%|Engulf (74% WR, 2.65 PF)
 * - Conservative: OB70|KZ|DD6%|Strong (15% max DD)
 */

import 'dotenv/config';

// Configuration - adjust based on your risk profile
const CONFIG = {
  // Symbols to trade
  symbols: ['XAUUSD.s'],

  // Strategy parameters (from backtesting)
  strategy: {
    minOBScore: 70,          // Minimum Order Block score
    useKillZones: false,     // true for conservative, false for aggressive
    maxDailyDD: 8,           // Maximum daily drawdown %
    fixedRR: 2,              // Risk:Reward ratio
    requireConfirmation: true,
    confirmationType: 'engulf', // 'close', 'strong', or 'engulf'
  },

  // Risk management
  risk: {
    riskPerTrade: 1,         // % of balance per trade (1-2% recommended)
    maxOpenTrades: 3,        // Maximum concurrent positions
    maxTradesPerSymbol: 1,   // Max positions per symbol
  },

  // Timeframes
  timeframes: {
    htf: 'H4',  // Higher timeframe for bias
    mtf: 'H1',  // Medium timeframe for structure
    ltf: 'M1',  // Lower timeframe for entries
  },

  // Scan interval (milliseconds)
  scanInterval: 60000, // 1 minute
};

// Kill Zone hours (UTC)
const KILL_ZONES = {
  LONDON: { start: 7, end: 10 },
  NY_AM: { start: 12, end: 15 },
  NY_PM: { start: 19, end: 21 },
};

class TradingBot {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.isRunning = false;
    this.positions = new Map();
    this.dailyStats = {
      date: new Date().toISOString().split('T')[0],
      startBalance: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      pnl: 0,
    };
  }

  async initialize() {
    console.log('='.repeat(60));
    console.log('  MT5 TRADING BOT - STARTING');
    console.log('='.repeat(60));
    console.log(`  Symbols: ${this.config.symbols.join(', ')}`);
    console.log(`  Strategy: OB${this.config.strategy.minOBScore} | ${this.config.strategy.useKillZones ? 'KillZones' : 'AllSessions'} | DD${this.config.strategy.maxDailyDD}%`);
    console.log(`  Confirmation: ${this.config.strategy.confirmationType}`);
    console.log(`  Risk per trade: ${this.config.risk.riskPerTrade}%`);
    console.log('='.repeat(60));

    // Dynamic import MetaAPI client
    const { metaApiClient } = await import('../src/lib/metaapi/client.ts');
    this.client = metaApiClient;

    // Connect with streaming for live trading
    console.log('\nConnecting to MetaAPI...');
    await this.client.connect();
    console.log('Connected!\n');

    // Get initial account info
    const accountInfo = await this.client.getAccountInfo();
    this.dailyStats.startBalance = accountInfo.balance;
    console.log(`Account Balance: $${accountInfo.balance.toFixed(2)}`);
    console.log(`Account Equity: $${accountInfo.equity.toFixed(2)}`);
    console.log(`Free Margin: $${accountInfo.freeMargin.toFixed(2)}\n`);
  }

  isInKillZone() {
    if (!this.config.strategy.useKillZones) return true;

    const hour = new Date().getUTCHours();
    return (
      (hour >= KILL_ZONES.LONDON.start && hour < KILL_ZONES.LONDON.end) ||
      (hour >= KILL_ZONES.NY_AM.start && hour < KILL_ZONES.NY_AM.end) ||
      (hour >= KILL_ZONES.NY_PM.start && hour < KILL_ZONES.NY_PM.end)
    );
  }

  async checkDailyDrawdown() {
    const accountInfo = await this.client.getAccountInfo();
    const drawdownPercent = ((this.dailyStats.startBalance - accountInfo.equity) / this.dailyStats.startBalance) * 100;

    if (drawdownPercent >= this.config.strategy.maxDailyDD) {
      console.log(`\n[WARNING] Daily drawdown limit reached: ${drawdownPercent.toFixed(2)}% >= ${this.config.strategy.maxDailyDD}%`);
      return false;
    }
    return true;
  }

  async scanForSignals(symbol) {
    // This is a simplified version - you'd implement full SMC analysis here
    // using your existing analysis modules

    try {
      // Get historical candles for analysis
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days

      const htfCandles = await this.client.getHistoricalCandlesCached(
        symbol,
        this.config.timeframes.htf,
        startDate,
        endDate
      );

      const mtfCandles = await this.client.getHistoricalCandlesCached(
        symbol,
        this.config.timeframes.mtf,
        startDate,
        endDate
      );

      // Analyze and generate signals
      // ... (implement your SMC analysis here)

      return null; // Return signal if found, null otherwise
    } catch (error) {
      console.error(`Error scanning ${symbol}:`, error.message);
      return null;
    }
  }

  async executeSignal(signal) {
    try {
      const accountInfo = await this.client.getAccountInfo();
      const riskAmount = accountInfo.balance * (this.config.risk.riskPerTrade / 100);

      // Get symbol info for lot size calculation
      const symbolInfo = await this.client.getSymbolInfo(signal.symbol);

      // Calculate lot size
      const slDistance = Math.abs(signal.entry - signal.sl);
      const lotSize = Math.max(
        symbolInfo.minVolume,
        Math.round((riskAmount / (slDistance * symbolInfo.contractSize)) * 100) / 100
      );

      console.log(`\n[TRADE] Executing ${signal.direction} on ${signal.symbol}`);
      console.log(`  Entry: ${signal.entry}`);
      console.log(`  SL: ${signal.sl}`);
      console.log(`  TP: ${signal.tp}`);
      console.log(`  Lot Size: ${lotSize}`);
      console.log(`  Risk: $${riskAmount.toFixed(2)} (${this.config.risk.riskPerTrade}%)`);

      const result = await this.client.placeMarketOrder(
        signal.symbol,
        signal.direction,
        lotSize,
        signal.sl,
        signal.tp,
        `SMC_OB${this.config.strategy.minOBScore}`
      );

      console.log(`  Order ID: ${result.orderId}`);
      console.log(`  Position ID: ${result.positionId || 'pending'}`);

      this.dailyStats.trades++;

      return result;
    } catch (error) {
      console.error(`[ERROR] Failed to execute trade:`, error.message);
      return null;
    }
  }

  async run() {
    this.isRunning = true;
    console.log('\nBot is now running. Press Ctrl+C to stop.\n');

    while (this.isRunning) {
      try {
        // Reset daily stats if new day
        const today = new Date().toISOString().split('T')[0];
        if (today !== this.dailyStats.date) {
          const accountInfo = await this.client.getAccountInfo();
          this.dailyStats = {
            date: today,
            startBalance: accountInfo.balance,
            trades: 0,
            wins: 0,
            losses: 0,
            pnl: 0,
          };
          console.log(`\n[NEW DAY] ${today} - Balance: $${accountInfo.balance.toFixed(2)}`);
        }

        // Check if we can trade
        if (!this.isInKillZone()) {
          // Outside kill zones, skip
          await this.sleep(this.config.scanInterval);
          continue;
        }

        if (!(await this.checkDailyDrawdown())) {
          // Daily DD limit hit, wait until next day
          console.log('[PAUSED] Waiting for next trading day...');
          await this.sleep(60000 * 60); // Wait 1 hour
          continue;
        }

        // Check current positions
        const positions = await this.client.getPositions();
        if (positions.length >= this.config.risk.maxOpenTrades) {
          await this.sleep(this.config.scanInterval);
          continue;
        }

        // Scan each symbol
        for (const symbol of this.config.symbols) {
          const symbolPositions = positions.filter(p => p.symbol === symbol);
          if (symbolPositions.length >= this.config.risk.maxTradesPerSymbol) {
            continue;
          }

          const signal = await this.scanForSignals(symbol);
          if (signal) {
            await this.executeSignal(signal);
          }
        }

        // Log status periodically
        const accountInfo = await this.client.getAccountInfo();
        const time = new Date().toLocaleTimeString();
        process.stdout.write(`\r[${time}] Balance: $${accountInfo.balance.toFixed(2)} | Equity: $${accountInfo.equity.toFixed(2)} | Positions: ${positions.length}    `);

        await this.sleep(this.config.scanInterval);
      } catch (error) {
        console.error('\n[ERROR] Bot error:', error.message);
        await this.sleep(5000); // Wait 5 seconds on error
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async shutdown() {
    console.log('\n\nShutting down bot...');
    this.isRunning = false;

    if (this.client) {
      await this.client.disconnect();
    }

    console.log('Bot stopped.');
    process.exit(0);
  }
}

// Main entry point
async function main() {
  const bot = new TradingBot(CONFIG);

  // Handle shutdown signals
  process.on('SIGINT', () => bot.shutdown());
  process.on('SIGTERM', () => bot.shutdown());

  try {
    await bot.initialize();
    await bot.run();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
