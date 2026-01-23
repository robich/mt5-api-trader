#!/usr/bin/env node
/**
 * Update Bot Configuration to Optimal Settings
 * Based on Jan 2026 backtest optimization results
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Optimal configuration from backtest insights
const OPTIMAL_CONFIG = {
  // Symbols with performance-based settings
  symbols: [
    "BTCUSD",      // Best performer: 64.3% WR, PF 2.62
    "XAUUSD.s",    // Strong: 71.4% WR, PF 2.28
    "XAGUSD.s",    // Conservative: OB75, low frequency
    // ETHUSD DISABLED - poor performance
  ],

  // Risk management
  riskPercent: 2,
  maxOpenTrades: 3,
  maxTradesPerSymbol: 1,

  // Timeframes (will use symbol-specific in code)
  htfTimeframe: "H4",
  mtfTimeframe: "H1",
  ltfTimeframe: "M15",

  // Strategy selection - ORDER_BLOCK ONLY (best performer)
  strategies: [
    "ORDER_BLOCK"
    // All other strategies disabled per optimization
  ],

  // Strategy profile
  strategyProfile: "UNIVERSAL_NOCONF",

  // CRITICAL: NoConf outperforms confirmation-based by 20%+
  confirmationType: "none",

  // Order Block settings
  minOBScore: 70,

  // Risk management - INCREASED to 8% per backtest insights
  maxDailyDrawdown: 8,  // Changed from 6%

  // Risk:Reward
  riskReward: 2,

  // Kill Zones - DISABLED for aggressive strategy
  useKillZones: false,
  killZones: [],

  // Trading mode
  liveTrading: false,  // Keep paper trading for safety

  // Breakeven protection
  breakeven: {
    enabled: true,
    triggerR: 1.0,
    bufferPips: 5
  },

  // Symbol-specific overrides (applied in code)
  symbolOverrides: {
    "BTCUSD": {
      atrMultiplier: 1.5,
      riskReward: 2,
    },
    "XAUUSD.s": {
      atrMultiplier: 1.0,
      riskReward: 2,
    },
    "XAGUSD.s": {
      minOBScore: 75,  // Higher threshold for silver
      atrMultiplier: 1.0,
      riskReward: 2,
    }
  }
};

async function main() {
  console.log('Updating bot configuration to optimal settings...\n');

  const botState = await prisma.botState.findUnique({
    where: { id: 'singleton' }
  });

  if (!botState) {
    console.error('Bot state not found!');
    process.exit(1);
  }

  // Parse current config
  const currentConfig = botState.config ? JSON.parse(botState.config) : {};

  console.log('CURRENT CONFIG:');
  console.log('- Profile:', currentConfig.strategyProfile || 'N/A');
  console.log('- Confirmation:', currentConfig.confirmationType || 'N/A');
  console.log('- Daily DD:', currentConfig.maxDailyDrawdown + '%');
  console.log('- Kill Zones:', currentConfig.useKillZones ? 'ENABLED' : 'DISABLED');
  console.log('- Strategies:', currentConfig.strategies?.length || 0);
  console.log('- Symbols:', currentConfig.symbols?.join(', ') || 'N/A');

  console.log('\n' + '='.repeat(60));
  console.log('OPTIMAL CONFIG:');
  console.log('- Profile:', OPTIMAL_CONFIG.strategyProfile);
  console.log('- Confirmation:', OPTIMAL_CONFIG.confirmationType, '(NoConf strategy)');
  console.log('- Daily DD:', OPTIMAL_CONFIG.maxDailyDrawdown + '%', '(increased from 6%)');
  console.log('- Kill Zones:', OPTIMAL_CONFIG.useKillZones ? 'ENABLED' : 'DISABLED');
  console.log('- Strategies:', OPTIMAL_CONFIG.strategies.length, '(ORDER_BLOCK only)');
  console.log('- Symbols:', OPTIMAL_CONFIG.symbols.join(', '), '(ETHUSD removed)');
  console.log('='.repeat(60) + '\n');

  // Update configuration
  await prisma.botState.update({
    where: { id: 'singleton' },
    data: {
      config: JSON.stringify(OPTIMAL_CONFIG),
      activeSymbols: OPTIMAL_CONFIG.symbols.join(','),
    }
  });

  console.log('✅ Configuration updated successfully!');
  console.log('\n⚠️  IMPORTANT: Restart the bot for changes to take effect:');
  console.log('   Stop the bot (Ctrl+C) and run: npm run start:bot\n');

  // Show expected improvements
  console.log('📊 Expected Performance (based on 20-day backtest):');
  console.log('   BTCUSD:   64.3% WR, PF 2.62, +$386');
  console.log('   XAUUSD.s: 71.4% WR, PF 2.28, +$51');
  console.log('   XAGUSD.s: High quality signals (low frequency)');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
