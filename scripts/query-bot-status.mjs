import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get bot state
  const botState = await prisma.botState.findUnique({ where: { id: 'singleton' } });
  console.log('\n=== BOT STATE ===');
  console.log('Running:', botState?.isRunning);
  console.log('Started:', botState?.startedAt);
  console.log('Last Heartbeat:', botState?.lastHeartbeat);
  console.log('Active Symbols:', botState?.activeSymbols);
  if (botState?.config) {
    const config = JSON.parse(botState.config);
    console.log('Risk per trade:', config.riskPercent + '%');
    console.log('Strategies enabled:', config.strategies);
  }

  // Get recent signals (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const signals = await prisma.signal.findMany({
    where: {
      createdAt: {
        gte: sevenDaysAgo
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 30
  });

  console.log('\n=== RECENT SIGNALS (Last 7 days) ===');
  console.log('Total signals:', signals.length);
  if (signals.length > 0) {
    for (const sig of signals) {
      const time = sig.createdAt.toISOString().split('T');
      console.log(`${time[0]} ${time[1].substring(0,8)} | ${sig.symbol} ${sig.direction} | ${sig.strategy} | Status: ${sig.status}${sig.reason ? ' - ' + sig.reason : ''}`);
    }
  } else {
    console.log('No signals generated in the last 7 days!');
  }

  // Get signal status breakdown
  const statusCounts = {};
  for (const sig of signals) {
    statusCounts[sig.status] = (statusCounts[sig.status] || 0) + 1;
  }
  console.log('\nSignal status breakdown:', statusCounts);

  // Get recent trades
  const trades = await prisma.trade.findMany({
    where: {
      openTime: {
        gte: sevenDaysAgo
      }
    },
    orderBy: { openTime: 'desc' },
    take: 10
  });

  console.log('\n=== RECENT TRADES (Last 7 days) ===');
  console.log('Total trades:', trades.length);
  for (const trade of trades) {
    const time = trade.openTime.toISOString().split('T');
    const pnl = trade.pnl ? `$${trade.pnl.toFixed(2)}` : 'Open';
    console.log(`${time[0]} ${time[1].substring(0,8)} | ${trade.symbol} ${trade.direction} | Status: ${trade.status} | P&L: ${pnl}`);
  }

  // Get ALL signals to see if bot has EVER generated signals
  const allSignals = await prisma.signal.count();
  console.log('\n=== HISTORICAL DATA ===');
  console.log('Total signals ever generated:', allSignals);

  const allTrades = await prisma.trade.count();
  console.log('Total trades ever executed:', allTrades);

  // Get most recent signal
  const mostRecent = await prisma.signal.findFirst({
    orderBy: { createdAt: 'desc' }
  });
  if (mostRecent) {
    console.log('Most recent signal:', mostRecent.createdAt.toISOString(), mostRecent.symbol, mostRecent.status);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
