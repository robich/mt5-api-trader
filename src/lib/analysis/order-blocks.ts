import { Candle, OrderBlock, Timeframe, SwingPoint } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Order Block Analysis for Smart Money Concepts
 * Identifies bullish and bearish order blocks (institutional candles)
 */

const MIN_MOVE_MULTIPLIER = 0.8; // Minimum move required after OB (ATR multiplier) - lowered from 1.5 for better detection

/**
 * Calculates Average True Range for volatility measurement
 */
function calculateATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) {
    return 0;
  }

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

/**
 * Checks if a candle is bullish
 */
function isBullishCandle(candle: Candle): boolean {
  return candle.close > candle.open;
}

/**
 * Checks if a candle is bearish
 */
function isBearishCandle(candle: Candle): boolean {
  return candle.close < candle.open;
}

/**
 * Gets the body size of a candle
 */
function getCandleBody(candle: Candle): number {
  return Math.abs(candle.close - candle.open);
}

/**
 * Gets the range (wick to wick) of a candle
 */
function getCandleRange(candle: Candle): number {
  return candle.high - candle.low;
}

/**
 * Identifies bullish order blocks
 * A bullish OB is the last bearish candle before a significant bullish move
 */
export function identifyBullishOrderBlocks(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  lookback: number = 50
): OrderBlock[] {
  const orderBlocks: OrderBlock[] = [];
  const atr = calculateATR(candles);

  if (atr === 0 || candles.length < lookback) {
    return orderBlocks;
  }

  const minMove = atr * MIN_MOVE_MULTIPLIER;

  // Look for bearish candles followed by significant bullish move
  for (let i = Math.max(0, candles.length - lookback); i < candles.length - 3; i++) {
    const potentialOB = candles[i];

    // Must be a bearish candle
    if (!isBearishCandle(potentialOB)) continue;

    // Check for significant bullish move after
    let moveHigh = potentialOB.high;
    let foundSignificantMove = false;

    for (let j = i + 1; j < Math.min(i + 10, candles.length); j++) {
      moveHigh = Math.max(moveHigh, candles[j].high);

      // Check if move from OB low is significant
      if (moveHigh - potentialOB.low >= minMove) {
        foundSignificantMove = true;
        break;
      }
    }

    if (foundSignificantMove) {
      // Verify the candle after OB is bullish (impulsive move)
      // Relaxed: just needs to be bullish OR have significant wick rejection
      const nextCandle = candles[i + 1];
      const isImpulsive = isBullishCandle(nextCandle) && getCandleBody(nextCandle) > getCandleBody(potentialOB) * 0.3;
      const hasWickRejection = nextCandle.close > potentialOB.high; // Price closed above OB

      if (isImpulsive || hasWickRejection) {
        orderBlocks.push({
          id: uuidv4(),
          symbol,
          timeframe,
          type: 'BULLISH',
          high: potentialOB.high,
          low: potentialOB.low,
          open: potentialOB.open,
          close: potentialOB.close,
          candleTime: potentialOB.time,
          isValid: true,
        });
      }
    }
  }

  return orderBlocks;
}

/**
 * Identifies bearish order blocks
 * A bearish OB is the last bullish candle before a significant bearish move
 */
export function identifyBearishOrderBlocks(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  lookback: number = 50
): OrderBlock[] {
  const orderBlocks: OrderBlock[] = [];
  const atr = calculateATR(candles);

  if (atr === 0 || candles.length < lookback) {
    return orderBlocks;
  }

  const minMove = atr * MIN_MOVE_MULTIPLIER;

  // Look for bullish candles followed by significant bearish move
  for (let i = Math.max(0, candles.length - lookback); i < candles.length - 3; i++) {
    const potentialOB = candles[i];

    // Must be a bullish candle
    if (!isBullishCandle(potentialOB)) continue;

    // Check for significant bearish move after
    let moveLow = potentialOB.low;
    let foundSignificantMove = false;

    for (let j = i + 1; j < Math.min(i + 10, candles.length); j++) {
      moveLow = Math.min(moveLow, candles[j].low);

      // Check if move from OB high is significant
      if (potentialOB.high - moveLow >= minMove) {
        foundSignificantMove = true;
        break;
      }
    }

    if (foundSignificantMove) {
      // Verify the candle after OB is bearish (impulsive move)
      // Relaxed: just needs to be bearish OR have significant wick rejection
      const nextCandle = candles[i + 1];
      const isImpulsive = isBearishCandle(nextCandle) && getCandleBody(nextCandle) > getCandleBody(potentialOB) * 0.3;
      const hasWickRejection = nextCandle.close < potentialOB.low; // Price closed below OB

      if (isImpulsive || hasWickRejection) {
        orderBlocks.push({
          id: uuidv4(),
          symbol,
          timeframe,
          type: 'BEARISH',
          high: potentialOB.high,
          low: potentialOB.low,
          open: potentialOB.open,
          close: potentialOB.close,
          candleTime: potentialOB.time,
          isValid: true,
        });
      }
    }
  }

  return orderBlocks;
}

/**
 * Identifies all order blocks (both bullish and bearish)
 */
export function identifyOrderBlocks(
  candles: Candle[],
  symbol: string,
  timeframe: Timeframe,
  lookback: number = 50
): OrderBlock[] {
  const bullishOBs = identifyBullishOrderBlocks(candles, symbol, timeframe, lookback);
  const bearishOBs = identifyBearishOrderBlocks(candles, symbol, timeframe, lookback);

  // Combine and sort by time
  return [...bullishOBs, ...bearishOBs].sort(
    (a, b) => a.candleTime.getTime() - b.candleTime.getTime()
  );
}

/**
 * Checks if an order block has been mitigated (price has returned to it)
 */
export function checkOrderBlockMitigation(
  orderBlock: OrderBlock,
  currentCandle: Candle
): boolean {
  if (orderBlock.type === 'BULLISH') {
    // Bullish OB is mitigated when price trades into the OB zone
    return currentCandle.low <= orderBlock.high && currentCandle.low >= orderBlock.low;
  } else {
    // Bearish OB is mitigated when price trades into the OB zone
    return currentCandle.high >= orderBlock.low && currentCandle.high <= orderBlock.high;
  }
}

/**
 * Checks if price is currently at an order block
 */
export function isPriceAtOrderBlock(
  price: number,
  orderBlock: OrderBlock,
  tolerance: number = 0
): boolean {
  const adjustedHigh = orderBlock.high + tolerance;
  const adjustedLow = orderBlock.low - tolerance;

  return price >= adjustedLow && price <= adjustedHigh;
}

/**
 * Filters order blocks to only valid (unmitigated) ones
 * Keep the most recent N order blocks even if they seem mitigated (for retest entries)
 */
export function filterValidOrderBlocks(
  orderBlocks: OrderBlock[],
  candles: Candle[],
  keepRecentCount: number = 5 // Keep at least the N most recent OBs of each type
): OrderBlock[] {
  // Sort by time descending to get most recent first
  const sortedOBs = [...orderBlocks].sort(
    (a, b) => b.candleTime.getTime() - a.candleTime.getTime()
  );

  const validOBs: OrderBlock[] = [];
  let bullishCount = 0;
  let bearishCount = 0;

  for (const ob of sortedOBs) {
    // Always keep the most recent N OBs of each type (for potential retests)
    if (ob.type === 'BULLISH' && bullishCount < keepRecentCount) {
      validOBs.push(ob);
      bullishCount++;
      continue;
    }
    if (ob.type === 'BEARISH' && bearishCount < keepRecentCount) {
      validOBs.push(ob);
      bearishCount++;
      continue;
    }

    // For older OBs, check if they're mitigated
    const obIndex = candles.findIndex(
      (c) => c.time.getTime() === ob.candleTime.getTime()
    );

    if (obIndex === -1) {
      if (ob.isValid) validOBs.push(ob);
      continue;
    }

    let isMitigated = false;
    for (let i = obIndex + 1; i < candles.length; i++) {
      if (checkOrderBlockMitigation(ob, candles[i])) {
        isMitigated = true;
        break;
      }
    }

    if (!isMitigated) {
      validOBs.push(ob);
    }
  }

  return validOBs;
}

/**
 * Gets the nearest valid order block for potential entry
 */
export function getNearestOrderBlock(
  orderBlocks: OrderBlock[],
  currentPrice: number,
  type: 'BULLISH' | 'BEARISH'
): OrderBlock | undefined {
  const filtered = orderBlocks
    .filter((ob) => ob.type === type && ob.isValid)
    .sort((a, b) => {
      if (type === 'BULLISH') {
        // For longs, find OB below current price
        return Math.abs(currentPrice - a.high) - Math.abs(currentPrice - b.high);
      } else {
        // For shorts, find OB above current price
        return Math.abs(a.low - currentPrice) - Math.abs(b.low - currentPrice);
      }
    });

  if (type === 'BULLISH') {
    return filtered.find((ob) => ob.high < currentPrice);
  } else {
    return filtered.find((ob) => ob.low > currentPrice);
  }
}

/**
 * Enhanced Order Block identification using swing points
 */
export function identifyOrderBlocksWithSwings(
  candles: Candle[],
  swingPoints: SwingPoint[],
  symbol: string,
  timeframe: Timeframe
): OrderBlock[] {
  const orderBlocks: OrderBlock[] = [];
  const atr = calculateATR(candles);

  // Find OBs at swing points (more reliable)
  for (const swing of swingPoints) {
    const swingIndex = swing.index;

    if (swingIndex < 1 || swingIndex >= candles.length - 1) continue;

    const swingCandle = candles[swingIndex];
    const prevCandle = candles[swingIndex - 1];

    if (swing.type === 'LOW') {
      // Bullish OB: Look for the bearish candle before the swing low
      if (isBearishCandle(prevCandle)) {
        orderBlocks.push({
          id: uuidv4(),
          symbol,
          timeframe,
          type: 'BULLISH',
          high: prevCandle.high,
          low: prevCandle.low,
          open: prevCandle.open,
          close: prevCandle.close,
          candleTime: prevCandle.time,
          isValid: true,
        });
      }
    } else {
      // Bearish OB: Look for the bullish candle before the swing high
      if (isBullishCandle(prevCandle)) {
        orderBlocks.push({
          id: uuidv4(),
          symbol,
          timeframe,
          type: 'BEARISH',
          high: prevCandle.high,
          low: prevCandle.low,
          open: prevCandle.open,
          close: prevCandle.close,
          candleTime: prevCandle.time,
          isValid: true,
        });
      }
    }
  }

  return orderBlocks;
}
