/**
 * Breakeven Manager
 *
 * Automatically moves stop-loss to breakeven + buffer when position reaches target R profit.
 * Based on backtest-optimized strategy "BE: 1R|RR2|5pips".
 *
 * Features:
 * - Tracks positions that have been moved to breakeven (Set<string>)
 * - Caches risk info (original SL distance) for each position
 * - Cleans up tracking when positions close
 * - Handles external trades (uses current SL as fallback)
 */

import { metaApiClient } from '../metaapi/client';
import { prisma } from '../db';
import { BreakevenConfig, Direction } from '../types';
import { PositionUpdate } from '../metaapi/sync-listener';

/**
 * Risk info for a position, used to calculate 1R profit level
 */
interface PositionRiskInfo {
  entryPrice: number;
  originalStopLoss: number;
  direction: Direction;
  riskInPrice: number; // Absolute distance from entry to SL
}

/**
 * Result from breakeven check
 */
export interface BreakevenResult {
  moved: boolean;
  reason?: string;
  newStopLoss?: number;
}

export class BreakevenManager {
  private config: BreakevenConfig;
  private movedPositions: Set<string> = new Set(); // Position IDs already at breakeven
  private riskInfoCache: Map<string, PositionRiskInfo> = new Map(); // Position ID -> risk info

  constructor(config: BreakevenConfig) {
    this.config = config;
  }

  /**
   * Update configuration (for profile changes)
   */
  updateConfig(config: BreakevenConfig): void {
    this.config = config;
  }

  /**
   * Check if breakeven management is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Initialize from current positions on bot startup
   * Re-evaluates all positions to determine their breakeven status
   */
  async initializeFromPositions(positions: PositionUpdate[]): Promise<void> {
    console.log(`[Breakeven] Initializing with ${positions.length} positions`);

    for (const pos of positions) {
      // Try to get risk info from DB trade record
      await this.cacheRiskInfo(pos);

      // Check if position is already past breakeven level
      // If so, check if SL is already at/past breakeven
      const riskInfo = this.riskInfoCache.get(pos.id);
      if (riskInfo && pos.stopLoss) {
        const isAtBreakeven = this.isStopLossAtBreakeven(pos, riskInfo);
        if (isAtBreakeven) {
          this.movedPositions.add(pos.id);
          console.log(`[Breakeven] Position ${pos.id} (${pos.symbol}) already at breakeven`);
        }
      }
    }
  }

  /**
   * Check if a position should be moved to breakeven and execute if so
   */
  async checkAndMoveToBreakeven(position: PositionUpdate): Promise<BreakevenResult> {
    // Skip if disabled
    if (!this.config.enabled) {
      return { moved: false, reason: 'Breakeven disabled' };
    }

    // Skip if already moved
    if (this.movedPositions.has(position.id)) {
      return { moved: false, reason: 'Already at breakeven' };
    }

    // Skip if no stop loss set
    if (!position.stopLoss) {
      return { moved: false, reason: 'No stop loss set' };
    }

    // Get or cache risk info
    let riskInfo = this.riskInfoCache.get(position.id);
    if (!riskInfo) {
      const cached = await this.cacheRiskInfo(position);
      if (!cached) {
        return { moved: false, reason: 'Cannot determine original risk' };
      }
      riskInfo = cached;
    }

    // Calculate current profit in R
    const currentR = this.calculateCurrentR(position, riskInfo);

    // Check if we've reached the trigger level
    if (currentR < this.config.triggerR) {
      return { moved: false, reason: `Current R (${currentR.toFixed(2)}) < trigger (${this.config.triggerR})` };
    }

    // Calculate new stop loss (entry + buffer pips)
    const newStopLoss = await this.calculateBreakevenStopLoss(position, riskInfo);
    if (!newStopLoss) {
      return { moved: false, reason: 'Cannot calculate breakeven SL' };
    }

    // Verify the new SL is better than current (closer to current price for profit)
    if (!this.isNewSLBetter(position, riskInfo.direction, newStopLoss)) {
      // Already past breakeven or SL already better
      this.movedPositions.add(position.id);
      return { moved: false, reason: 'Current SL already at/past breakeven' };
    }

    // Execute the modification
    try {
      console.log(`[Breakeven] Moving ${position.symbol} (${position.id}) SL from ${position.stopLoss} to ${newStopLoss}`);

      await metaApiClient.modifyPosition(position.id, newStopLoss, position.takeProfit);

      // Mark as moved
      this.movedPositions.add(position.id);

      console.log(`[Breakeven] Moved ${position.symbol} to breakeven: SL=${newStopLoss}`);

      return {
        moved: true,
        newStopLoss,
        reason: `Reached ${currentR.toFixed(2)}R, SL moved to breakeven + ${this.config.bufferPips} pips`,
      };
    } catch (error) {
      console.error(`[Breakeven] Failed to modify position ${position.id}:`, error);
      // Don't mark as moved so we retry on next update
      return { moved: false, reason: `Modification failed: ${error}` };
    }
  }

  /**
   * Clean up tracking when a position closes
   */
  onPositionClosed(positionId: string): void {
    this.movedPositions.delete(positionId);
    this.riskInfoCache.delete(positionId);
    console.log(`[Breakeven] Cleaned up tracking for closed position ${positionId}`);
  }

  /**
   * Get current tracking status (for debugging)
   */
  getStatus(): { movedCount: number; cachedCount: number; config: BreakevenConfig } {
    return {
      movedCount: this.movedPositions.size,
      cachedCount: this.riskInfoCache.size,
      config: this.config,
    };
  }

  /**
   * Cache risk info for a position
   * Priority: DB Trade record -> Current SL
   */
  private async cacheRiskInfo(position: PositionUpdate): Promise<PositionRiskInfo | null> {
    const direction: Direction = position.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL';

    // Try to get from DB first (most accurate - has original SL)
    try {
      const trade = await prisma.trade.findFirst({
        where: {
          mt5PositionId: position.id,
          status: 'OPEN',
        },
      });

      if (trade && trade.stopLoss > 0) {
        const riskInPrice = Math.abs(trade.entryPrice - trade.stopLoss);
        const riskInfo: PositionRiskInfo = {
          entryPrice: trade.entryPrice,
          originalStopLoss: trade.stopLoss,
          direction: trade.direction as Direction,
          riskInPrice,
        };
        this.riskInfoCache.set(position.id, riskInfo);
        return riskInfo;
      }
    } catch (error) {
      console.warn(`[Breakeven] Error fetching trade from DB for ${position.id}:`, error);
    }

    // Fallback: Use current SL (for external trades)
    if (position.stopLoss) {
      console.warn(`[Breakeven] Using current SL as original for external trade ${position.id} (${position.symbol})`);
      const riskInPrice = Math.abs(position.openPrice - position.stopLoss);
      const riskInfo: PositionRiskInfo = {
        entryPrice: position.openPrice,
        originalStopLoss: position.stopLoss,
        direction,
        riskInPrice,
      };
      this.riskInfoCache.set(position.id, riskInfo);
      return riskInfo;
    }

    // No SL available
    console.warn(`[Breakeven] Cannot determine risk for position ${position.id} - no SL available`);
    return null;
  }

  /**
   * Calculate current profit in R multiples
   */
  private calculateCurrentR(position: PositionUpdate, riskInfo: PositionRiskInfo): number {
    if (riskInfo.riskInPrice === 0) return 0;

    const currentPrice = position.currentPrice || position.openPrice;
    let profitInPrice: number;

    if (riskInfo.direction === 'BUY') {
      profitInPrice = currentPrice - riskInfo.entryPrice;
    } else {
      profitInPrice = riskInfo.entryPrice - currentPrice;
    }

    return profitInPrice / riskInfo.riskInPrice;
  }

  /**
   * Calculate the breakeven stop loss level (entry + buffer pips in favor direction)
   */
  private async calculateBreakevenStopLoss(
    position: PositionUpdate,
    riskInfo: PositionRiskInfo
  ): Promise<number | null> {
    try {
      const symbolInfo = await metaApiClient.getSymbolInfo(position.symbol);
      const pipSize = symbolInfo.pipSize;
      const bufferInPrice = this.config.bufferPips * pipSize;

      let newSL: number;
      if (riskInfo.direction === 'BUY') {
        // For long, SL moves up to entry + buffer
        newSL = riskInfo.entryPrice + bufferInPrice;
      } else {
        // For short, SL moves down to entry - buffer
        newSL = riskInfo.entryPrice - bufferInPrice;
      }

      // Round to symbol's digit precision
      return parseFloat(newSL.toFixed(symbolInfo.digits));
    } catch (error) {
      console.error(`[Breakeven] Error calculating breakeven SL for ${position.symbol}:`, error);
      return null;
    }
  }

  /**
   * Check if the new SL is better (more profitable) than current SL
   */
  private isNewSLBetter(position: PositionUpdate, direction: Direction, newSL: number): boolean {
    if (!position.stopLoss) return true;

    if (direction === 'BUY') {
      // For long, higher SL is better (locks in more profit)
      return newSL > position.stopLoss;
    } else {
      // For short, lower SL is better
      return newSL < position.stopLoss;
    }
  }

  /**
   * Check if current SL is already at or past breakeven level
   */
  private isStopLossAtBreakeven(position: PositionUpdate, riskInfo: PositionRiskInfo): boolean {
    if (!position.stopLoss) return false;

    if (riskInfo.direction === 'BUY') {
      // For long, SL at or above entry is at breakeven
      return position.stopLoss >= riskInfo.entryPrice;
    } else {
      // For short, SL at or below entry is at breakeven
      return position.stopLoss <= riskInfo.entryPrice;
    }
  }
}

// Default disabled instance (will be properly initialized by bot)
export const breakevenManager = new BreakevenManager({
  enabled: false,
  triggerR: 1.0,
  bufferPips: 5,
});
