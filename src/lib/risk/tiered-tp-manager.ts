/**
 * Tiered Take-Profit Manager
 *
 * Manages partial position closes at multiple take-profit levels (TP1, TP2, TP3).
 * Based on backtest-optimized strategy "TIERED-OTE: 30@1R|30@2R|40@4R".
 *
 * Features:
 * - Tracks which TP levels have been hit for each position
 * - Executes partial closes using MetaAPI closePositionPartially()
 * - Moves SL to breakeven after TP1, and to TP1 level after TP2
 * - Handles position volume tracking after partial closes
 * - Sends Telegram notifications for each TP hit
 */

import { metaApiClient } from '../metaapi/client';
import { prisma } from '../db';
import { TieredTPConfig, Direction, TIERED_TP_PROFILES } from '../types';
import { PositionUpdate } from '../metaapi/sync-listener';
import { telegramNotifier } from '../../services/telegram';

/**
 * Tracked state for a position with tiered TP
 */
interface TieredTPState {
  positionId: string;
  symbol: string;
  direction: Direction;
  entryPrice: number;
  originalStopLoss: number;
  originalVolume: number;
  currentVolume: number;
  riskInPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  tp1PnL: number;
  tp2PnL: number;
}

/**
 * Result from tiered TP check
 */
export interface TieredTPResult {
  tpHit: 'TP1' | 'TP2' | 'TP3' | null;
  partialClose: boolean;
  closedVolume?: number;
  closedPnL?: number;
  newStopLoss?: number;
  reason?: string;
}

export class TieredTPManager {
  private config: TieredTPConfig;
  private positionStates: Map<string, TieredTPState> = new Map();

  constructor(config: TieredTPConfig) {
    this.config = config;
  }

  /**
   * Update configuration (for profile changes)
   */
  updateConfig(config: TieredTPConfig): void {
    this.config = config;
    console.log(`[TieredTP] Config updated: enabled=${config.enabled}, TP1=${config.tp1.percent}%@${config.tp1.rr}R, TP2=${config.tp2.percent}%@${config.tp2.rr}R, TP3=${config.tp3.percent}%@${config.tp3.rr}R`);
  }

  /**
   * Check if tiered TP is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get a predefined profile by name
   */
  static getProfile(name: string): TieredTPConfig {
    return TIERED_TP_PROFILES[name] || TIERED_TP_PROFILES['DISABLED'];
  }

  /**
   * Initialize tracking for a new position
   * Called when a trade is opened
   */
  async initializePosition(
    positionId: string,
    symbol: string,
    direction: Direction,
    entryPrice: number,
    stopLoss: number,
    volume: number
  ): Promise<void> {
    if (!this.config.enabled) return;

    const riskInPrice = Math.abs(entryPrice - stopLoss);

    // Calculate TP levels based on R multiples
    let tp1Price: number, tp2Price: number, tp3Price: number;
    if (direction === 'BUY') {
      tp1Price = entryPrice + (riskInPrice * this.config.tp1.rr);
      tp2Price = entryPrice + (riskInPrice * this.config.tp2.rr);
      tp3Price = entryPrice + (riskInPrice * this.config.tp3.rr);
    } else {
      tp1Price = entryPrice - (riskInPrice * this.config.tp1.rr);
      tp2Price = entryPrice - (riskInPrice * this.config.tp2.rr);
      tp3Price = entryPrice - (riskInPrice * this.config.tp3.rr);
    }

    const state: TieredTPState = {
      positionId,
      symbol,
      direction,
      entryPrice,
      originalStopLoss: stopLoss,
      originalVolume: volume,
      currentVolume: volume,
      riskInPrice,
      tp1Price,
      tp2Price,
      tp3Price,
      tp1Hit: false,
      tp2Hit: false,
      tp3Hit: false,
      tp1PnL: 0,
      tp2PnL: 0,
    };

    this.positionStates.set(positionId, state);

    console.log(`[TieredTP] Initialized ${symbol} ${direction}: TP1=${tp1Price.toFixed(2)} (${this.config.tp1.percent}%), TP2=${tp2Price.toFixed(2)} (${this.config.tp2.percent}%), TP3=${tp3Price.toFixed(2)} (${this.config.tp3.percent}%)`);
  }

  /**
   * Initialize from existing positions on bot startup
   */
  async initializeFromPositions(positions: PositionUpdate[]): Promise<void> {
    if (!this.config.enabled) return;

    console.log(`[TieredTP] Initializing with ${positions.length} positions`);

    for (const pos of positions) {
      // Try to get original trade info from DB
      try {
        const trade = await prisma.trade.findFirst({
          where: {
            mt5PositionId: pos.id,
            status: 'OPEN',
          },
        });

        if (trade && trade.stopLoss > 0) {
          const direction: Direction = trade.direction as Direction;
          await this.initializePosition(
            pos.id,
            pos.symbol,
            direction,
            trade.entryPrice,
            trade.stopLoss,
            pos.volume
          );

          // Check if any TP levels have already been hit based on current volume vs original
          const state = this.positionStates.get(pos.id);
          if (state && pos.volume < trade.lotSize) {
            // Position has been partially closed - determine which TPs hit
            const volumeRatio = pos.volume / trade.lotSize;
            const tp1VolumeRatio = 1 - (this.config.tp1.percent / 100);
            const tp2VolumeRatio = tp1VolumeRatio - (this.config.tp2.percent / 100);

            if (volumeRatio <= tp2VolumeRatio) {
              state.tp1Hit = true;
              state.tp2Hit = true;
              console.log(`[TieredTP] Position ${pos.id} already past TP2`);
            } else if (volumeRatio <= tp1VolumeRatio) {
              state.tp1Hit = true;
              console.log(`[TieredTP] Position ${pos.id} already past TP1`);
            }

            state.currentVolume = pos.volume;
          }
        }
      } catch (error) {
        console.warn(`[TieredTP] Error initializing position ${pos.id}:`, error);
      }
    }
  }

  /**
   * Check if any TP level has been reached and execute partial close
   */
  async checkAndExecuteTieredTP(position: PositionUpdate): Promise<TieredTPResult> {
    if (!this.config.enabled) {
      return { tpHit: null, partialClose: false };
    }

    const state = this.positionStates.get(position.id);
    if (!state) {
      // Position not tracked (might be external trade)
      return { tpHit: null, partialClose: false, reason: 'Position not tracked' };
    }

    const currentPrice = position.currentPrice || position.openPrice;

    // Check TP3 first (final close)
    if (state.tp1Hit && state.tp2Hit && !state.tp3Hit) {
      const tp3Reached = state.direction === 'BUY'
        ? currentPrice >= state.tp3Price
        : currentPrice <= state.tp3Price;

      if (tp3Reached) {
        return await this.executeTP3Close(position, state);
      }
    }

    // Check TP2
    if (state.tp1Hit && !state.tp2Hit) {
      const tp2Reached = state.direction === 'BUY'
        ? currentPrice >= state.tp2Price
        : currentPrice <= state.tp2Price;

      if (tp2Reached) {
        return await this.executeTP2Close(position, state);
      }
    }

    // Check TP1
    if (!state.tp1Hit) {
      const tp1Reached = state.direction === 'BUY'
        ? currentPrice >= state.tp1Price
        : currentPrice <= state.tp1Price;

      if (tp1Reached) {
        return await this.executeTP1Close(position, state);
      }
    }

    return { tpHit: null, partialClose: false };
  }

  /**
   * Execute TP1 partial close
   */
  private async executeTP1Close(position: PositionUpdate, state: TieredTPState): Promise<TieredTPResult> {
    const closeVolume = state.originalVolume * (this.config.tp1.percent / 100);
    const symbolInfo = await metaApiClient.getSymbolInfo(state.symbol);

    // Round to volume step
    const roundedVolume = Math.round(closeVolume / symbolInfo.volumeStep) * symbolInfo.volumeStep;

    if (roundedVolume < symbolInfo.minVolume) {
      console.log(`[TieredTP] TP1 volume too small: ${roundedVolume} < ${symbolInfo.minVolume}`);
      return { tpHit: null, partialClose: false, reason: 'Volume too small for partial close' };
    }

    try {
      console.log(`[TieredTP] Executing TP1 partial close: ${state.symbol} ${roundedVolume} lots at ${state.tp1Price}`);

      // Execute partial close
      await metaApiClient.closePositionPartially(position.id, roundedVolume);

      // Calculate P&L for this partial close
      const pnl = this.calculatePartialPnL(state.entryPrice, state.tp1Price, roundedVolume, state.direction, symbolInfo);

      state.tp1Hit = true;
      state.tp1PnL = pnl;
      state.currentVolume -= roundedVolume;

      // Move SL to breakeven if configured
      let newStopLoss: number | undefined;
      if (this.config.moveSlOnTP1) {
        const bufferInPrice = this.config.beBufferPips * symbolInfo.pipSize;
        newStopLoss = state.direction === 'BUY'
          ? state.entryPrice + bufferInPrice
          : state.entryPrice - bufferInPrice;

        await metaApiClient.modifyPosition(position.id, newStopLoss, undefined);
        console.log(`[TieredTP] Moved SL to breakeven: ${newStopLoss}`);
      }

      // Send Telegram notification
      await this.notifyTPHit(state, 'TP1', roundedVolume, pnl, state.currentVolume);

      console.log(`[TieredTP] TP1 hit: ${state.symbol} closed ${roundedVolume} lots, P&L: $${pnl.toFixed(2)}, remaining: ${state.currentVolume} lots`);

      return {
        tpHit: 'TP1',
        partialClose: true,
        closedVolume: roundedVolume,
        closedPnL: pnl,
        newStopLoss,
        reason: `TP1 hit at ${this.config.tp1.rr}R`,
      };

    } catch (error) {
      console.error(`[TieredTP] Error executing TP1:`, error);
      return { tpHit: null, partialClose: false, reason: `TP1 error: ${error}` };
    }
  }

  /**
   * Execute TP2 partial close
   */
  private async executeTP2Close(position: PositionUpdate, state: TieredTPState): Promise<TieredTPResult> {
    // Calculate volume for TP2 (percentage of original, not remaining)
    const closeVolume = state.originalVolume * (this.config.tp2.percent / 100);
    const symbolInfo = await metaApiClient.getSymbolInfo(state.symbol);

    const roundedVolume = Math.round(closeVolume / symbolInfo.volumeStep) * symbolInfo.volumeStep;

    if (roundedVolume < symbolInfo.minVolume) {
      console.log(`[TieredTP] TP2 volume too small: ${roundedVolume} < ${symbolInfo.minVolume}`);
      return { tpHit: null, partialClose: false, reason: 'Volume too small for partial close' };
    }

    try {
      console.log(`[TieredTP] Executing TP2 partial close: ${state.symbol} ${roundedVolume} lots at ${state.tp2Price}`);

      await metaApiClient.closePositionPartially(position.id, roundedVolume);

      const pnl = this.calculatePartialPnL(state.entryPrice, state.tp2Price, roundedVolume, state.direction, symbolInfo);

      state.tp2Hit = true;
      state.tp2PnL = pnl;
      state.currentVolume -= roundedVolume;

      // Move SL to TP1 level if configured
      let newStopLoss: number | undefined;
      if (this.config.moveSlOnTP2) {
        newStopLoss = state.tp1Price;
        await metaApiClient.modifyPosition(position.id, newStopLoss, undefined);
        console.log(`[TieredTP] Moved SL to TP1 level: ${newStopLoss}`);
      }

      await this.notifyTPHit(state, 'TP2', roundedVolume, pnl, state.currentVolume);

      console.log(`[TieredTP] TP2 hit: ${state.symbol} closed ${roundedVolume} lots, P&L: $${pnl.toFixed(2)}, remaining: ${state.currentVolume} lots`);

      return {
        tpHit: 'TP2',
        partialClose: true,
        closedVolume: roundedVolume,
        closedPnL: pnl,
        newStopLoss,
        reason: `TP2 hit at ${this.config.tp2.rr}R`,
      };

    } catch (error) {
      console.error(`[TieredTP] Error executing TP2:`, error);
      return { tpHit: null, partialClose: false, reason: `TP2 error: ${error}` };
    }
  }

  /**
   * Execute TP3 full close (remaining position)
   */
  private async executeTP3Close(position: PositionUpdate, state: TieredTPState): Promise<TieredTPResult> {
    try {
      console.log(`[TieredTP] Executing TP3 full close: ${state.symbol} ${state.currentVolume} lots at ${state.tp3Price}`);

      // Close entire remaining position
      await metaApiClient.closePosition(position.id);

      const symbolInfo = await metaApiClient.getSymbolInfo(state.symbol);
      const pnl = this.calculatePartialPnL(state.entryPrice, state.tp3Price, state.currentVolume, state.direction, symbolInfo);

      state.tp3Hit = true;

      const totalPnL = state.tp1PnL + state.tp2PnL + pnl;
      await this.notifyTPHit(state, 'TP3', state.currentVolume, pnl, 0, totalPnL);

      console.log(`[TieredTP] TP3 hit: ${state.symbol} closed ${state.currentVolume} lots, P&L: $${pnl.toFixed(2)}, Total: $${totalPnL.toFixed(2)}`);

      // Clean up state
      this.positionStates.delete(position.id);

      return {
        tpHit: 'TP3',
        partialClose: false, // Full close
        closedVolume: state.currentVolume,
        closedPnL: pnl,
        reason: `TP3 hit at ${this.config.tp3.rr}R - Full close`,
      };

    } catch (error) {
      console.error(`[TieredTP] Error executing TP3:`, error);
      return { tpHit: null, partialClose: false, reason: `TP3 error: ${error}` };
    }
  }

  /**
   * Calculate P&L for partial close
   */
  private calculatePartialPnL(
    entryPrice: number,
    exitPrice: number,
    volume: number,
    direction: Direction,
    symbolInfo: { contractSize: number }
  ): number {
    if (direction === 'BUY') {
      return (exitPrice - entryPrice) * volume * symbolInfo.contractSize;
    } else {
      return (entryPrice - exitPrice) * volume * symbolInfo.contractSize;
    }
  }

  /**
   * Send Telegram notification for TP hit
   */
  private async notifyTPHit(
    state: TieredTPState,
    tpLevel: 'TP1' | 'TP2' | 'TP3',
    closedVolume: number,
    pnl: number,
    remainingVolume: number,
    totalPnL?: number
  ): Promise<void> {
    if (!telegramNotifier.isEnabled()) return;

    const rrValue = tpLevel === 'TP1' ? this.config.tp1.rr
      : tpLevel === 'TP2' ? this.config.tp2.rr
      : this.config.tp3.rr;

    let message = `\n*${tpLevel} HIT* | ${state.symbol}\n`;
    message += `Direction: ${state.direction}\n`;
    message += `Closed: ${closedVolume} lots at ${rrValue}R\n`;
    message += `P&L: $${pnl.toFixed(2)}\n`;

    if (remainingVolume > 0) {
      message += `Remaining: ${remainingVolume.toFixed(2)} lots\n`;
    }

    if (totalPnL !== undefined) {
      message += `*Total P&L: $${totalPnL.toFixed(2)}*\n`;
    }

    await telegramNotifier.sendMessage(message);
  }

  /**
   * Clean up when position closes
   */
  onPositionClosed(positionId: string): void {
    const state = this.positionStates.get(positionId);
    if (state) {
      console.log(`[TieredTP] Cleaned up tracking for closed position ${positionId}`);
      this.positionStates.delete(positionId);
    }
  }

  /**
   * Get state for a position (for debugging/UI)
   */
  getPositionState(positionId: string): TieredTPState | undefined {
    return this.positionStates.get(positionId);
  }

  /**
   * Get summary status
   */
  getStatus(): {
    enabled: boolean;
    trackedPositions: number;
    config: TieredTPConfig;
  } {
    return {
      enabled: this.config.enabled,
      trackedPositions: this.positionStates.size,
      config: this.config,
    };
  }
}

// Default instance (will be properly initialized by bot)
export const tieredTPManager = new TieredTPManager(TIERED_TP_PROFILES['DISABLED']);
