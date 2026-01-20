#!/usr/bin/env node
import 'dotenv/config';
import MetaApi from 'metaapi.cloud-sdk';

const META_API_TOKEN = process.env.META_API_TOKEN;
const ACCOUNT_ID = process.env.META_API_ACCOUNT_ID;

const SYMBOL = 'XAUUSD.s';
const START_DATE = '2026-01-13';
const END_DATE = '2026-01-17';

async function main() {
  console.log('Connecting to MetaAPI...');
  const api = new MetaApi(META_API_TOKEN);
  const account = await api.metatraderAccountApi.getAccount(ACCOUNT_ID);
  await account.waitConnected();
  const conn = account.getRPCConnection();
  await conn.connect();
  await conn.waitSynchronized();
  console.log('Connected.\n');

  // Fetch candles
  const startDate = new Date(START_DATE);
  const endDate = new Date(END_DATE);

  console.log(`Fetching H4 candles for ${SYMBOL}...`);
  const h4Candles = await conn.getHistoricalCandles(SYMBOL, 'H4', startDate, endDate);
  console.log(`  H4: ${h4Candles.length} candles`);

  console.log(`Fetching H1 candles for ${SYMBOL}...`);
  const h1Candles = await conn.getHistoricalCandles(SYMBOL, '1h', startDate, endDate);
  console.log(`  H1: ${h1Candles.length} candles`);

  console.log(`Fetching M5 candles for ${SYMBOL}...`);
  const m5Candles = await conn.getHistoricalCandles(SYMBOL, '5m', startDate, endDate);
  console.log(`  M5: ${m5Candles.length} candles`);

  console.log('\n=== DEBUG: HTF BIAS ANALYSIS ===');

  // Find swing points in H4
  const swings = findSwingPoints(h4Candles, 3);
  console.log(`\nSwing Points in H4 (${swings.length} found):`);
  swings.slice(-8).forEach(s => {
    console.log(`  ${s.type}: ${s.price.toFixed(2)} at ${s.time}`);
  });

  // Determine bias
  const htfBias = determineHTFBias(h4Candles);
  console.log(`\nHTF Bias: ${htfBias}`);

  console.log('\n=== DEBUG: ORDER BLOCK DETECTION ===');

  // Calculate ATR
  const atr = calculateATR(h1Candles);
  console.log(`\nH1 ATR: ${atr.toFixed(2)}`);

  // Detect order blocks in H1
  const orderBlocks = detectOrderBlocks(h1Candles, atr);
  console.log(`\nOrder Blocks found (${orderBlocks.length}):`);
  orderBlocks.slice(-10).forEach(ob => {
    console.log(`  ${ob.type} OB: Score=${ob.score}, Range=${ob.low.toFixed(2)}-${ob.high.toFixed(2)}, Mitigated=${ob.mitigated}`);
  });

  // Check valid OBs (score >= 65, not mitigated)
  const validOBs = orderBlocks.filter(ob => !ob.mitigated && ob.score >= 65);
  console.log(`\nValid OBs (score >= 65, not mitigated): ${validOBs.length}`);
  validOBs.forEach(ob => {
    console.log(`  ${ob.type} OB: Score=${ob.score}, Range=${ob.low.toFixed(2)}-${ob.high.toFixed(2)}`);
  });

  // Current price from last M5 candle
  const currentPrice = m5Candles[m5Candles.length - 1].close;
  console.log(`\nCurrent Price: ${currentPrice.toFixed(2)}`);

  // Check if any valid OB is near current price
  console.log('\n=== DEBUG: PRICE AT ORDER BLOCK CHECK ===');
  const matchingBias = htfBias === 'BULLISH' ? 'BULLISH' : 'BEARISH';
  const biasMatchedOBs = validOBs.filter(ob => ob.type === matchingBias);
  console.log(`\nOBs matching HTF bias (${matchingBias}): ${biasMatchedOBs.length}`);

  biasMatchedOBs.forEach(ob => {
    const obRange = ob.high - ob.low;
    const tolerance = obRange * 1.0;
    const isNearOB = currentPrice >= ob.low - tolerance && currentPrice <= ob.high + tolerance;
    console.log(`  OB ${ob.low.toFixed(2)}-${ob.high.toFixed(2)}: Price at OB? ${isNearOB}`);
    if (!isNearOB) {
      console.log(`    Distance from OB: ${(currentPrice - ob.high).toFixed(2)} (current: ${currentPrice.toFixed(2)}, OB high: ${ob.high.toFixed(2)})`);
    }
  });

  // Print price range during the period
  console.log('\n=== DEBUG: PRICE RANGE DURING PERIOD ===');
  const allPrices = m5Candles.map(c => c.close);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  console.log(`Price range: ${minPrice.toFixed(2)} - ${maxPrice.toFixed(2)}`);

  await conn.close();
  console.log('\nDone.');
}

function findSwingPoints(candles, lookback = 3) {
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

function determineHTFBias(candles) {
  if (candles.length < 10) {
    console.log(`  [BIAS] Insufficient candles: ${candles.length} < 10`);
    return 'NEUTRAL';
  }

  const swings = findSwingPoints(candles);
  if (swings.length < 4) {
    console.log(`  [BIAS] Insufficient swing points: ${swings.length} < 4`);
    return 'NEUTRAL';
  }

  const recentSwings = swings.slice(-4);
  const highs = recentSwings.filter(s => s.type === 'HIGH').map(s => s.price);
  const lows = recentSwings.filter(s => s.type === 'LOW').map(s => s.price);

  console.log(`  [BIAS] Recent swing highs: ${highs.map(h => h.toFixed(2)).join(', ')}`);
  console.log(`  [BIAS] Recent swing lows: ${lows.map(l => l.toFixed(2)).join(', ')}`);

  if (highs.length >= 2 && lows.length >= 2) {
    const isHigherHighs = highs[highs.length - 1] > highs[highs.length - 2];
    const isHigherLows = lows[lows.length - 1] > lows[lows.length - 2];
    const isLowerHighs = highs[highs.length - 1] < highs[highs.length - 2];
    const isLowerLows = lows[lows.length - 1] < lows[lows.length - 2];

    console.log(`  [BIAS] HH=${isHigherHighs}, HL=${isHigherLows}, LH=${isLowerHighs}, LL=${isLowerLows}`);

    if (isHigherHighs && isHigherLows) return 'BULLISH';
    if (isLowerHighs && isLowerLows) return 'BEARISH';
  }

  // Fallback
  const firstClose = candles[0].close;
  const lastClose = candles[candles.length - 1].close;
  const change = (lastClose - firstClose) / firstClose;
  console.log(`  [BIAS] Fallback change: ${(change * 100).toFixed(2)}%`);

  if (change > 0.005) return 'BULLISH';
  if (change < -0.005) return 'BEARISH';
  return 'NEUTRAL';
}

function calculateATR(candles, period = 14) {
  if (candles.length < period) return 0;

  let atrSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tr = candles[i].high - candles[i].low;
    atrSum += tr;
  }
  return atrSum / period;
}

function detectOrderBlocks(candles, atr) {
  const orderBlocks = [];
  if (candles.length < 10) return orderBlocks;

  for (let i = 3; i < candles.length - 2; i++) {
    const candle = candles[i];
    const nextCandle = candles[i + 1];
    const candleAfter = candles[i + 2];

    const body = Math.abs(candle.close - candle.open);
    const nextBody = Math.abs(nextCandle.close - nextCandle.open);

    // Bullish OB: bearish candle followed by strong bullish move
    const isBearish = candle.close < candle.open;
    const isNextBullish = nextCandle.close > nextCandle.open;
    const isImpulsive = nextBody > atr * 0.5 || candleAfter.close > nextCandle.close;

    if (isBearish && isNextBullish && isImpulsive) {
      let score = 50;
      if (nextBody > atr * 1.0) score += 15;
      if (nextBody > atr * 1.5) score += 10;
      if (candleAfter.close > nextCandle.close) score += 10;
      if (body < nextBody * 0.5) score += 5;

      orderBlocks.push({
        type: 'BULLISH',
        high: candle.high,
        low: candle.low,
        time: candle.time,
        score: Math.min(score, 100),
        mitigated: false,
        used: false
      });
    }

    // Bearish OB: bullish candle followed by strong bearish move
    const isBullish = candle.close > candle.open;
    const isNextBearish = nextCandle.close < nextCandle.open;
    const isBearishImpulsive = nextBody > atr * 0.5 || candleAfter.close < nextCandle.close;

    if (isBullish && isNextBearish && isBearishImpulsive) {
      let score = 50;
      if (nextBody > atr * 1.0) score += 15;
      if (nextBody > atr * 1.5) score += 10;
      if (candleAfter.close < nextCandle.close) score += 10;
      if (body < nextBody * 0.5) score += 5;

      orderBlocks.push({
        type: 'BEARISH',
        high: candle.high,
        low: candle.low,
        time: candle.time,
        score: Math.min(score, 100),
        mitigated: false,
        used: false
      });
    }
  }

  // Mark mitigated OBs
  const lastPrice = candles[candles.length - 1].close;
  for (const ob of orderBlocks) {
    if (ob.type === 'BULLISH' && lastPrice < ob.low) {
      ob.mitigated = true;
    } else if (ob.type === 'BEARISH' && lastPrice > ob.high) {
      ob.mitigated = true;
    }
  }

  return orderBlocks;
}

main().catch(console.error);
