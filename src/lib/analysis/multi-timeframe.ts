import { Candle, Timeframe, MultiTimeframeAnalysis, Bias, PremiumDiscountZone, CHoCHEvent, InducementLevel, LiquidityZone } from '../types';
import { analyzeMarketStructure, identifySwingPoints, calculatePremiumDiscount, detectCHOCH } from './market-structure';
import { identifyOrderBlocks, filterValidOrderBlocks } from './order-blocks';
import { identifyFVGs, filterUnfilledFVGs } from './fvg';
import { identifyLiquidityZones, filterUnsweptLiquidity, identifyInducement, detectLiquiditySweepReversal } from './liquidity';

/**
 * Multi-Timeframe Analysis for Smart Money Concepts
 * Combines analysis from HTF (Higher Timeframe), MTF (Medium Timeframe), and LTF (Lower Timeframe)
 */

export interface MTFData {
  htfCandles: Candle[];
  mtfCandles: Candle[];
  ltfCandles: Candle[];
}

/**
 * Performs complete multi-timeframe analysis
 */
export function performMTFAnalysis(
  data: MTFData,
  symbol: string,
  htfTimeframe: Timeframe,
  mtfTimeframe: Timeframe,
  ltfTimeframe: Timeframe
): MultiTimeframeAnalysis {
  // HTF Analysis (Bias determination)
  const htfSwingPoints = identifySwingPoints(data.htfCandles);
  const htfStructure = analyzeMarketStructure(data.htfCandles);
  const htfOrderBlocks = filterValidOrderBlocks(
    identifyOrderBlocks(data.htfCandles, symbol, htfTimeframe),
    data.htfCandles
  );
  const htfLiquidity = filterUnsweptLiquidity(
    identifyLiquidityZones(data.htfCandles, symbol, htfTimeframe, htfSwingPoints),
    data.htfCandles
  );

  // MTF Analysis (Structure and POIs)
  const mtfSwingPoints = identifySwingPoints(data.mtfCandles);
  const mtfStructure = analyzeMarketStructure(data.mtfCandles);
  const mtfOrderBlocks = filterValidOrderBlocks(
    identifyOrderBlocks(data.mtfCandles, symbol, mtfTimeframe),
    data.mtfCandles
  );
  const mtfFVGs = filterUnfilledFVGs(
    identifyFVGs(data.mtfCandles, symbol, mtfTimeframe),
    data.mtfCandles
  );
  const mtfLiquidity = filterUnsweptLiquidity(
    identifyLiquidityZones(data.mtfCandles, symbol, mtfTimeframe, mtfSwingPoints),
    data.mtfCandles
  );

  // LTF Analysis (Entry precision)
  const ltfStructure = analyzeMarketStructure(data.ltfCandles);
  const ltfFVGs = filterUnfilledFVGs(
    identifyFVGs(data.ltfCandles, symbol, ltfTimeframe),
    data.ltfCandles
  );

  // Calculate confluence score
  const confluenceScore = calculateConfluenceScore(
    htfStructure.bias,
    mtfStructure.bias,
    ltfStructure.bias,
    htfOrderBlocks.length,
    mtfOrderBlocks.length,
    mtfFVGs.length,
    htfLiquidity.length,
    mtfLiquidity.length
  );

  // SMC Enhancements

  // 1. Calculate Premium/Discount zones from HTF swing points
  let premiumDiscount: PremiumDiscountZone | undefined;
  const htfHighs = htfSwingPoints.filter((s) => s.type === 'HIGH');
  const htfLows = htfSwingPoints.filter((s) => s.type === 'LOW');
  if (htfHighs.length > 0 && htfLows.length > 0) {
    const recentHigh = htfHighs[htfHighs.length - 1];
    const recentLow = htfLows[htfLows.length - 1];
    premiumDiscount = calculatePremiumDiscount(recentHigh.price, recentLow.price);
  }

  // 2. Detect recent CHoCH events
  let recentCHoCH: CHoCHEvent | undefined;
  const chochResult = detectCHOCH(data.mtfCandles, mtfStructure);
  if (chochResult) {
    recentCHoCH = {
      type: chochResult.type,
      price: chochResult.price,
      time: chochResult.time,
    };
  }

  // 3. Identify inducement levels (minor liquidity before major zones)
  const inducements: InducementLevel[] = [];
  const allLiquidity = [...htfLiquidity, ...mtfLiquidity];
  for (const majorZone of allLiquidity.slice(0, 5)) { // Check top 5 major zones
    const inducement = identifyInducement(majorZone, data.mtfCandles, symbol, mtfTimeframe);
    if (inducement) {
      inducements.push({
        majorLiquidity: majorZone,
        inducementZone: inducement,
        isSwept: false,
      });
    }
  }

  // 4. Check for recent liquidity sweep reversals
  let recentLiquiditySweep: MultiTimeframeAnalysis['recentLiquiditySweep'] | undefined;
  for (const zone of mtfLiquidity) {
    const sweepResult = detectLiquiditySweepReversal(zone, data.mtfCandles, 5);
    if (sweepResult.isReversal && sweepResult.rejectionCandle) {
      recentLiquiditySweep = {
        zone,
        sweepTime: sweepResult.rejectionCandle.time,
        isReversal: true,
      };
      break; // Use the most recent sweep
    }
  }

  return {
    htf: {
      timeframe: htfTimeframe,
      bias: htfStructure.bias,
      structure: htfStructure,
      orderBlocks: htfOrderBlocks,
      liquidityZones: htfLiquidity,
    },
    mtf: {
      timeframe: mtfTimeframe,
      bias: mtfStructure.bias,
      structure: mtfStructure,
      orderBlocks: mtfOrderBlocks,
      fvgs: mtfFVGs,
      liquidityZones: mtfLiquidity,
    },
    ltf: {
      timeframe: ltfTimeframe,
      bias: ltfStructure.bias,
      structure: ltfStructure,
      fvgs: ltfFVGs,
    },
    confluenceScore,
    // SMC Enhancement data
    premiumDiscount,
    recentCHoCH,
    inducements,
    recentLiquiditySweep,
  };
}

/**
 * Calculates overall confluence score (0-100)
 * Higher score = more aligned signals across timeframes
 */
function calculateConfluenceScore(
  htfBias: Bias,
  mtfBias: Bias,
  ltfBias: Bias,
  htfOrderBlocks: number,
  mtfOrderBlocks: number,
  mtfFVGs: number,
  htfLiquidity: number,
  mtfLiquidity: number
): number {
  let score = 0;

  // Bias alignment (max 40 points)
  if (htfBias === mtfBias && htfBias !== 'NEUTRAL') {
    score += 20;
  }
  if (mtfBias === ltfBias && mtfBias !== 'NEUTRAL') {
    score += 15;
  }
  if (htfBias === ltfBias && htfBias !== 'NEUTRAL') {
    score += 5;
  }

  // Order blocks present (max 25 points)
  if (htfOrderBlocks > 0) score += 10;
  if (mtfOrderBlocks > 0) score += 15;

  // FVGs present (max 15 points)
  if (mtfFVGs > 0) score += 15;

  // Liquidity targets (max 20 points)
  if (htfLiquidity > 0) score += 10;
  if (mtfLiquidity > 0) score += 10;

  return Math.min(score, 100);
}

/**
 * Determines overall trading bias from MTF analysis
 */
export function getOverallBias(analysis: MultiTimeframeAnalysis): Bias {
  const { htf, mtf, ltf } = analysis;

  // If HTF and MTF agree, use that bias
  if (htf.bias === mtf.bias && htf.bias !== 'NEUTRAL') {
    return htf.bias;
  }

  // If HTF is clear but MTF is neutral, use HTF
  if (htf.bias !== 'NEUTRAL' && mtf.bias === 'NEUTRAL') {
    return htf.bias;
  }

  // If MTF and LTF agree and HTF is neutral
  if (mtf.bias === ltf.bias && mtf.bias !== 'NEUTRAL' && htf.bias === 'NEUTRAL') {
    return mtf.bias;
  }

  // Conflicting biases = stay neutral
  return 'NEUTRAL';
}

/**
 * Checks if current price is in a valid trading zone
 */
export function isPriceInPOI(
  currentPrice: number,
  analysis: MultiTimeframeAnalysis,
  direction: 'BUY' | 'SELL'
): boolean {
  const { mtf } = analysis;

  // Check MTF order blocks
  for (const ob of mtf.orderBlocks) {
    if (direction === 'BUY' && ob.type === 'BULLISH') {
      if (currentPrice >= ob.low && currentPrice <= ob.high) {
        return true;
      }
    }
    if (direction === 'SELL' && ob.type === 'BEARISH') {
      if (currentPrice >= ob.low && currentPrice <= ob.high) {
        return true;
      }
    }
  }

  // Check MTF FVGs
  for (const fvg of mtf.fvgs) {
    if (direction === 'BUY' && fvg.type === 'BULLISH') {
      if (currentPrice >= fvg.low && currentPrice <= fvg.high) {
        return true;
      }
    }
    if (direction === 'SELL' && fvg.type === 'BEARISH') {
      if (currentPrice >= fvg.low && currentPrice <= fvg.high) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Gets the nearest point of interest (POI) for trading
 */
export function getNearestPOI(
  currentPrice: number,
  analysis: MultiTimeframeAnalysis,
  direction: 'BUY' | 'SELL'
): { type: 'OB' | 'FVG'; price: number; zone: { high: number; low: number } } | null {
  const { mtf } = analysis;
  let nearestPOI: { type: 'OB' | 'FVG'; price: number; zone: { high: number; low: number } } | null = null;
  let minDistance = Infinity;

  // Check order blocks
  for (const ob of mtf.orderBlocks) {
    if (direction === 'BUY' && ob.type === 'BULLISH' && ob.high < currentPrice) {
      const distance = currentPrice - ob.high;
      if (distance < minDistance) {
        minDistance = distance;
        nearestPOI = {
          type: 'OB',
          price: (ob.high + ob.low) / 2,
          zone: { high: ob.high, low: ob.low },
        };
      }
    }
    if (direction === 'SELL' && ob.type === 'BEARISH' && ob.low > currentPrice) {
      const distance = ob.low - currentPrice;
      if (distance < minDistance) {
        minDistance = distance;
        nearestPOI = {
          type: 'OB',
          price: (ob.high + ob.low) / 2,
          zone: { high: ob.high, low: ob.low },
        };
      }
    }
  }

  // Check FVGs
  for (const fvg of mtf.fvgs) {
    if (direction === 'BUY' && fvg.type === 'BULLISH' && fvg.high < currentPrice) {
      const distance = currentPrice - fvg.high;
      if (distance < minDistance) {
        minDistance = distance;
        nearestPOI = {
          type: 'FVG',
          price: (fvg.high + fvg.low) / 2,
          zone: { high: fvg.high, low: fvg.low },
        };
      }
    }
    if (direction === 'SELL' && fvg.type === 'BEARISH' && fvg.low > currentPrice) {
      const distance = fvg.low - currentPrice;
      if (distance < minDistance) {
        minDistance = distance;
        nearestPOI = {
          type: 'FVG',
          price: (fvg.high + fvg.low) / 2,
          zone: { high: fvg.high, low: fvg.low },
        };
      }
    }
  }

  return nearestPOI;
}

/**
 * Gets take profit target based on liquidity
 */
export function getLiquidityTarget(
  currentPrice: number,
  analysis: MultiTimeframeAnalysis,
  direction: 'BUY' | 'SELL'
): number | null {
  const { htf, mtf } = analysis;

  // Combine liquidity zones from HTF and MTF
  const allLiquidity = [...htf.liquidityZones, ...mtf.liquidityZones];

  if (direction === 'BUY') {
    // Target the nearest liquidity above current price
    const targets = allLiquidity
      .filter((z) => z.type === 'HIGH' && z.price > currentPrice)
      .sort((a, b) => a.price - b.price);

    return targets.length > 0 ? targets[0].price : null;
  } else {
    // Target the nearest liquidity below current price
    const targets = allLiquidity
      .filter((z) => z.type === 'LOW' && z.price < currentPrice)
      .sort((a, b) => b.price - a.price);

    return targets.length > 0 ? targets[0].price : null;
  }
}

/**
 * Validates if a trade setup has good confluence
 */
export function validateTradeSetup(
  analysis: MultiTimeframeAnalysis,
  direction: 'BUY' | 'SELL',
  currentPrice: number,
  minConfluenceScore: number = 50
): { isValid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let isValid = true;

  // Check confluence score
  if (analysis.confluenceScore < minConfluenceScore) {
    isValid = false;
    reasons.push(`Confluence score too low: ${analysis.confluenceScore}/${minConfluenceScore}`);
  }

  // Check bias alignment
  const overallBias = getOverallBias(analysis);
  if (overallBias === 'NEUTRAL') {
    isValid = false;
    reasons.push('No clear directional bias');
  }

  if (direction === 'BUY' && overallBias === 'BEARISH') {
    isValid = false;
    reasons.push('Buy signal against bearish bias');
  }

  if (direction === 'SELL' && overallBias === 'BULLISH') {
    isValid = false;
    reasons.push('Sell signal against bullish bias');
  }

  // Check for POI
  if (!isPriceInPOI(currentPrice, analysis, direction)) {
    reasons.push('Price not at a valid Point of Interest');
    // This is a warning, not a disqualifier
  }

  // Check for liquidity target
  const target = getLiquidityTarget(currentPrice, analysis, direction);
  if (!target) {
    reasons.push('No clear liquidity target found');
  }

  return { isValid, reasons };
}
