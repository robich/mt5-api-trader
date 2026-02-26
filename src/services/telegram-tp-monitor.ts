/**
 * Telegram TP Monitor Service
 *
 * Proactively monitors price levels and auto-partial-closes Telegram signal trades
 * at TP1/TP2/TP3 without waiting for follow-up channel messages.
 *
 * TP Close Schedule:
 *   TP1 → close 50%, move SL to breakeven
 *   TP2 → close 30%, move SL to TP1 level
 *   TP3 → close remaining 20% (full close)
 *
 * Coexists with reactive handler in telegram-trade-executor.ts:
 *   - Proactive fires first → sets tpXHit=true → reactive skips
 *   - Reactive fires first → calls markTPHitExternally() → monitor skips
 */

import { metaApiClient } from '@/lib/metaapi/client';
import { prisma } from '@/lib/db';
import { PositionUpdate } from '@/lib/metaapi/sync-listener';
import { telegramNotifier } from './telegram';

export interface TelegramTPState {
  positionId: string;
  tradeId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  originalVolume: number;
  tp1Price: number;
  tp2Price: number | null;
  tp3Price: number | null;
  tp1Percent: number;
  tp2Percent: number;
  tp3Percent: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
}

export interface TelegramTPNotes {
  telegramTPs: {
    tp1: number;
    tp2: number | null;
    tp3: number | null;
    tp1Percent: number;
    tp2Percent: number;
    tp3Percent: number;
    tp1Hit: boolean;
    tp2Hit: boolean;
    tp3Hit: boolean;
  };
}

class TelegramTPMonitor {
  private positionStates: Map<string, TelegramTPState> = new Map();

  /**
   * Register a new trade for proactive TP monitoring.
   * Called from telegram-trade-executor after opening a multi-TP trade.
   */
  initializePosition(
    positionId: string,
    tradeId: string,
    symbol: string,
    direction: 'BUY' | 'SELL',
    entryPrice: number,
    originalVolume: number,
    tp1Price: number,
    tp2Price: number | null,
    tp3Price: number | null,
  ): void {
    const state: TelegramTPState = {
      positionId,
      tradeId,
      symbol,
      direction,
      entryPrice,
      originalVolume,
      tp1Price,
      tp2Price,
      tp3Price,
      tp1Percent: 50,
      tp2Percent: 30,
      tp3Percent: 20,
      tp1Hit: false,
      tp2Hit: false,
      tp3Hit: false,
    };

    this.positionStates.set(positionId, state);

    console.log(
      `[TelegramTP] Initialized ${symbol} ${direction}: TP1=${tp1Price}` +
      (tp2Price ? ` TP2=${tp2Price}` : '') +
      (tp3Price ? ` TP3=${tp3Price}` : '') +
      ` (pos=${positionId})`
    );
  }

  /**
   * Check price vs TP levels and execute partial closes.
   * Called every position update from bot.ts handlePositionUpdate loop.
   */
  async checkAndExecuteTP(position: PositionUpdate): Promise<void> {
    const state = this.positionStates.get(position.id);
    if (!state) return;

    const currentPrice = position.currentPrice ?? position.openPrice;

    // Check TP3 first (remaining full close)
    if (state.tp3Price && state.tp1Hit && state.tp2Hit && !state.tp3Hit) {
      const hit = state.direction === 'BUY'
        ? currentPrice >= state.tp3Price
        : currentPrice <= state.tp3Price;
      if (hit) {
        await this.executeTP3(position, state);
        return;
      }
    }

    // Check TP2
    if (state.tp2Price && state.tp1Hit && !state.tp2Hit) {
      const hit = state.direction === 'BUY'
        ? currentPrice >= state.tp2Price
        : currentPrice <= state.tp2Price;
      if (hit) {
        await this.executeTP2(position, state);
        return;
      }
    }

    // Check TP1
    if (!state.tp1Hit) {
      const hit = state.direction === 'BUY'
        ? currentPrice >= state.tp1Price
        : currentPrice <= state.tp1Price;
      if (hit) {
        await this.executeTP1(position, state);
        return;
      }
    }
  }

  /**
   * Reconstruct state on restart from Trade.notes JSON.
   * Called during bot startup after position sync.
   */
  async initializeFromPositions(positions: PositionUpdate[]): Promise<void> {
    const positionIds = positions.map((p) => p.id);
    if (positionIds.length === 0) return;

    const trades = await prisma.trade.findMany({
      where: {
        mt5PositionId: { in: positionIds },
        status: 'OPEN',
        strategy: 'EXTERNAL',
        notes: { not: null },
      },
    });

    let restored = 0;
    for (const trade of trades) {
      if (!trade.notes || !trade.mt5PositionId) continue;

      try {
        const parsed = JSON.parse(trade.notes) as TelegramTPNotes;
        if (!parsed.telegramTPs) continue;

        const tps = parsed.telegramTPs;
        const pos = positions.find((p) => p.id === trade.mt5PositionId);
        if (!pos) continue;

        const state: TelegramTPState = {
          positionId: trade.mt5PositionId,
          tradeId: trade.id,
          symbol: trade.symbol,
          direction: trade.direction as 'BUY' | 'SELL',
          entryPrice: trade.entryPrice,
          originalVolume: trade.lotSize,
          tp1Price: tps.tp1,
          tp2Price: tps.tp2,
          tp3Price: tps.tp3,
          tp1Percent: tps.tp1Percent ?? 50,
          tp2Percent: tps.tp2Percent ?? 30,
          tp3Percent: tps.tp3Percent ?? 20,
          tp1Hit: tps.tp1Hit ?? false,
          tp2Hit: tps.tp2Hit ?? false,
          tp3Hit: tps.tp3Hit ?? false,
        };

        // Volume-ratio heuristic: detect already-hit TPs if notes flags are stale
        if (pos.volume < trade.lotSize) {
          const volumeRatio = pos.volume / trade.lotSize;
          const afterTP1Ratio = 1 - (state.tp1Percent / 100); // 0.50
          const afterTP2Ratio = afterTP1Ratio - (state.tp2Percent / 100); // 0.20

          if (volumeRatio <= afterTP2Ratio + 0.01) {
            state.tp1Hit = true;
            state.tp2Hit = true;
          } else if (volumeRatio <= afterTP1Ratio + 0.01) {
            state.tp1Hit = true;
          }
        }

        this.positionStates.set(trade.mt5PositionId, state);
        restored++;

        console.log(
          `[TelegramTP] Restored ${trade.symbol} pos=${trade.mt5PositionId}` +
          ` tp1Hit=${state.tp1Hit} tp2Hit=${state.tp2Hit} tp3Hit=${state.tp3Hit}`
        );
      } catch {
        // notes is not valid JSON or doesn't contain telegramTPs — skip
      }
    }

    if (restored > 0) {
      console.log(`[TelegramTP] Restored ${restored} positions from Trade.notes`);
    }
  }

  /**
   * Mark a TP level as hit externally (by the reactive close handler).
   * Prevents the proactive monitor from double-closing.
   */
  markTPHitExternally(positionId: string, tpLevel: 'TP1' | 'TP2' | 'TP3'): void {
    const state = this.positionStates.get(positionId);
    if (!state) return;

    if (tpLevel === 'TP1') state.tp1Hit = true;
    if (tpLevel === 'TP2') state.tp2Hit = true;
    if (tpLevel === 'TP3') state.tp3Hit = true;

    console.log(`[TelegramTP] ${tpLevel} marked hit externally for pos=${positionId}`);

    // Persist the updated flags
    this.persistState(state).catch((err) =>
      console.error(`[TelegramTP] Error persisting after external mark:`, err)
    );
  }

  /**
   * Get monitor state for a position (used by trade executor for cross-check).
   */
  getState(positionId: string): TelegramTPState | undefined {
    return this.positionStates.get(positionId);
  }

  /**
   * Clean up when position fully closes.
   */
  onPositionClosed(positionId: string): void {
    if (this.positionStates.has(positionId)) {
      console.log(`[TelegramTP] Cleaned up pos=${positionId}`);
      this.positionStates.delete(positionId);
    }
  }

  // ─── Private: TP execution ───────────────────────────────────────

  private async executeTP1(position: PositionUpdate, state: TelegramTPState): Promise<void> {
    const closeVolume = await this.computeCloseVolume(state, state.tp1Percent, position);
    if (closeVolume === null) return;

    try {
      console.log(`[TelegramTP] TP1 hit: ${state.symbol} closing ${closeVolume} lots (${state.tp1Percent}%)`);

      await metaApiClient.closePositionPartially(position.id, closeVolume);
      state.tp1Hit = true;

      // Move SL to breakeven
      const beSL = this.computeBreakevenSL(state);
      try {
        await metaApiClient.modifyPosition(position.id, beSL, undefined);
        await prisma.trade.update({
          where: { id: state.tradeId },
          data: { stopLoss: beSL },
        });
        console.log(`[TelegramTP] SL moved to BE: ${beSL}`);
      } catch (beErr) {
        console.warn(`[TelegramTP] Could not move SL to BE:`, beErr);
      }

      await this.persistState(state);
      await this.notify(state, 'TP1', closeVolume);
    } catch (error) {
      console.error(`[TelegramTP] Error executing TP1:`, error);
    }
  }

  private async executeTP2(position: PositionUpdate, state: TelegramTPState): Promise<void> {
    const closeVolume = await this.computeCloseVolume(state, state.tp2Percent, position);
    if (closeVolume === null) return;

    try {
      console.log(`[TelegramTP] TP2 hit: ${state.symbol} closing ${closeVolume} lots (${state.tp2Percent}%)`);

      await metaApiClient.closePositionPartially(position.id, closeVolume);
      state.tp2Hit = true;

      // Move SL to TP1 level
      try {
        await metaApiClient.modifyPosition(position.id, state.tp1Price, undefined);
        await prisma.trade.update({
          where: { id: state.tradeId },
          data: { stopLoss: state.tp1Price },
        });
        console.log(`[TelegramTP] SL moved to TP1 level: ${state.tp1Price}`);
      } catch (slErr) {
        console.warn(`[TelegramTP] Could not move SL to TP1:`, slErr);
      }

      await this.persistState(state);
      await this.notify(state, 'TP2', closeVolume);
    } catch (error) {
      console.error(`[TelegramTP] Error executing TP2:`, error);
    }
  }

  private async executeTP3(position: PositionUpdate, state: TelegramTPState): Promise<void> {
    try {
      console.log(`[TelegramTP] TP3 hit: ${state.symbol} fully closing remaining position`);

      await metaApiClient.closePosition(position.id);
      state.tp3Hit = true;

      await this.persistState(state);
      await this.notify(state, 'TP3', 0);

      // Clean up — position will be removed in next update cycle
      this.positionStates.delete(position.id);
    } catch (error) {
      console.error(`[TelegramTP] Error executing TP3:`, error);
    }
  }

  // ─── Private: helpers ────────────────────────────────────────────

  /**
   * Compute volume to close for a TP level.
   * Uses original lot size * percent, but clamps to remaining volume.
   * Returns null if volume is too small.
   */
  private async computeCloseVolume(
    state: TelegramTPState,
    percent: number,
    position: PositionUpdate,
  ): Promise<number | null> {
    const symbolInfo = await metaApiClient.getSymbolInfo(state.symbol);
    const rawVolume = state.originalVolume * (percent / 100);
    let volume = Math.round(rawVolume / symbolInfo.volumeStep) * symbolInfo.volumeStep;

    // Clamp to remaining
    const remaining = position.volume;
    if (volume > remaining) {
      volume = Math.round(remaining / symbolInfo.volumeStep) * symbolInfo.volumeStep;
    }

    if (volume < symbolInfo.minVolume) {
      console.log(`[TelegramTP] Close volume too small: ${volume} < ${symbolInfo.minVolume}`);
      return null;
    }

    return volume;
  }

  private computeBreakevenSL(state: TelegramTPState): number {
    const buffers: Record<string, number> = {
      'XAUUSD.s': 0.5,
      'XAGUSD.s': 0.05,
      'BTCUSD': 50,
      'ETHUSD': 3,
    };
    const buffer = buffers[state.symbol] ?? 0.0003;
    return state.direction === 'BUY'
      ? state.entryPrice + buffer
      : state.entryPrice - buffer;
  }

  /**
   * Persist tp hit flags to Trade.notes JSON.
   */
  private async persistState(state: TelegramTPState): Promise<void> {
    const notes: TelegramTPNotes = {
      telegramTPs: {
        tp1: state.tp1Price,
        tp2: state.tp2Price,
        tp3: state.tp3Price,
        tp1Percent: state.tp1Percent,
        tp2Percent: state.tp2Percent,
        tp3Percent: state.tp3Percent,
        tp1Hit: state.tp1Hit,
        tp2Hit: state.tp2Hit,
        tp3Hit: state.tp3Hit,
      },
    };

    await prisma.trade.update({
      where: { id: state.tradeId },
      data: { notes: JSON.stringify(notes) },
    });
  }

  private async notify(state: TelegramTPState, tpLevel: 'TP1' | 'TP2' | 'TP3', closedVolume: number): Promise<void> {
    if (!telegramNotifier.isEnabled()) return;

    const price = tpLevel === 'TP1' ? state.tp1Price
      : tpLevel === 'TP2' ? state.tp2Price
      : state.tp3Price;

    const action = tpLevel === 'TP3' ? 'Full close' : `Closed ${tpLevel === 'TP1' ? state.tp1Percent : state.tp2Percent}%`;
    const slInfo = tpLevel === 'TP1' ? 'SL → breakeven'
      : tpLevel === 'TP2' ? `SL → TP1 (${state.tp1Price})`
      : 'Position fully closed';

    await telegramNotifier.sendMessage(
      `📡 <b>PROACTIVE ${tpLevel} HIT</b>\n\n` +
      `${state.direction === 'BUY' ? '🟢' : '🔴'} <b>${state.symbol}</b>\n` +
      `${action} at ${price}\n` +
      `${slInfo}\n` +
      (closedVolume > 0 ? `Closed: ${closedVolume} lots\n` : '') +
      (tpLevel !== 'TP3' ? `Remaining position running` : '')
    );
  }
}

export const telegramTPMonitor = new TelegramTPMonitor();
