/**
 * Telegram Trade Executor Service
 * Orchestrates: listener -> analyzer -> trade execution
 * Processes analyzed signals and executes trades with 2% risk.
 */

import { prisma } from '@/lib/db';
import { metaApiClient } from '@/lib/metaapi/client';
import { calculatePositionSize } from '@/lib/risk/position-sizing';
import { tradeManager } from '@/lib/risk/trade-manager';
import { telegramSignalAnalyzer, SignalAnalysis, SignalCategory } from './telegram-signal-analyzer';
import { telegramNotifier } from './telegram';
import { Trade, StrategyType } from '@/lib/types';

// Default SL distances (in price units) when signal doesn't include SL
const DEFAULT_SL_DISTANCES: Record<string, number> = {
  'XAUUSD.s': 5,    // $5 = ~50 pips for gold
  'XAGUSD.s': 0.5,  // $0.50 = ~50 pips for silver
  'BTCUSD': 500,     // $500 for BTC
  'ETHUSD': 30,      // $30 for ETH
  'EURUSD': 0.005,   // 50 pips
  'GBPUSD': 0.005,   // 50 pips
};

class TelegramTradeExecutor {
  private enabled = false;

  initialize(): void {
    this.enabled = true;
    console.log('[TradeExecutor] Service initialized');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Process a single message through the full pipeline:
   * analyze -> persist -> route by category -> execute if applicable
   */
  async processMessage(msg: {
    id: number;
    text: string;
    senderName: string | null;
    hasMedia: boolean;
    date: Date;
  }): Promise<SignalAnalysis> {
    console.log(`[TradeExecutor] Processing message #${msg.id}`);

    // Find the persisted message
    const dbMessage = await prisma.telegramChannelMessage.findFirst({
      where: { telegramMsgId: msg.id },
      orderBy: { receivedAt: 'desc' },
    });

    if (!dbMessage) {
      console.error(`[TradeExecutor] Message #${msg.id} not found in DB`);
      return { category: 'OTHER', symbol: null, direction: null, entryPrice: null, stopLoss: null, takeProfit: null, confidence: 0, reasoning: 'Message not found in DB', linkedSignalId: null, closePercent: null };
    }

    // Check if this message was already processed (has a terminal analysis status).
    // This prevents re-analysis + re-execution on restart / reconnect / polling.
    const existingAnalysis = await prisma.telegramSignalAnalysis.findUnique({
      where: { messageId: dbMessage.id },
    });
    if (existingAnalysis && existingAnalysis.executionStatus !== 'PENDING') {
      console.log(`[TradeExecutor] Message #${msg.id} already processed (${existingAnalysis.executionStatus}), skipping`);
      return {
        category: existingAnalysis.category as SignalCategory,
        symbol: existingAnalysis.symbol,
        direction: existingAnalysis.direction as 'BUY' | 'SELL' | null,
        entryPrice: existingAnalysis.entryPrice,
        stopLoss: existingAnalysis.stopLoss,
        takeProfit: existingAnalysis.takeProfit,
        confidence: existingAnalysis.confidence ?? 0,
        reasoning: existingAnalysis.reasoning ?? '',
        linkedSignalId: existingAnalysis.linkedSignalId,
        closePercent: null,
      };
    }

    // Skip execution if the message is too old (>2 min)
    const messageAgeMs = Date.now() - msg.date.getTime();
    const MAX_SIGNAL_AGE_MS = 120_000;
    if (messageAgeMs > MAX_SIGNAL_AGE_MS) {
      console.log(`[TradeExecutor] Message #${msg.id} is ${(messageAgeMs / 1000).toFixed(0)}s old, skipping analysis`);
      // Persist as skipped so we don't re-process on next poll
      if (!existingAnalysis) {
        await prisma.telegramSignalAnalysis.create({
          data: {
            messageId: dbMessage.id,
            category: 'OTHER',
            executionStatus: 'SKIPPED',
            executionError: `Message too old: ${(messageAgeMs / 1000).toFixed(0)}s`,
          },
        });
      }
      return { category: 'OTHER', symbol: null, direction: null, entryPrice: null, stopLoss: null, takeProfit: null, confidence: 0, reasoning: `Message too old (${(messageAgeMs / 1000).toFixed(0)}s)`, linkedSignalId: null, closePercent: null };
    }

    // Analyze with Claude
    const analysis = await telegramSignalAnalyzer.analyzeMessage(msg.text, dbMessage.id);
    console.log(`[TradeExecutor] Analysis result: ${analysis.category} (confidence: ${analysis.confidence})`);

    // Persist analysis (upsert to handle duplicate messages)
    const analysisData = {
      category: analysis.category,
      symbol: analysis.symbol,
      direction: analysis.direction,
      entryPrice: analysis.entryPrice,
      stopLoss: analysis.stopLoss,
      takeProfit: analysis.takeProfit,
      confidence: analysis.confidence,
      reasoning: analysis.reasoning,
      linkedSignalId: analysis.linkedSignalId,
      executionStatus: 'PENDING',
    };
    const dbAnalysis = await prisma.telegramSignalAnalysis.upsert({
      where: { messageId: dbMessage.id },
      create: { messageId: dbMessage.id, ...analysisData },
      update: analysisData,
    });

    // Route by category
    try {
      switch (analysis.category) {
        case 'SIGNAL':
          await this.executeSignal(dbAnalysis.id, analysis);
          break;
        case 'TP_UPDATE':
          await this.handleTPUpdate(dbAnalysis.id, analysis);
          break;
        case 'SL_UPDATE':
          await this.handleSLUpdate(dbAnalysis.id, analysis);
          break;
        case 'CLOSE_SIGNAL':
          await this.handleCloseSignal(dbAnalysis.id, analysis);
          break;
        case 'MOVE_TO_BE':
          await this.handleMoveToBreakeven(dbAnalysis.id, analysis);
          break;
        default:
          await this.markSkipped(dbAnalysis.id, 'Not a trading signal');
          break;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[TradeExecutor] Error executing ${analysis.category}:`, errMsg);
      await this.markFailed(dbAnalysis.id, errMsg);
    }

    return analysis;
  }

  /**
   * Process a test message (not from a real channel)
   */
  async processTestMessage(text: string, simulate: boolean = true): Promise<{
    analysis: SignalAnalysis;
    messageId: string;
    executionStatus: string;
  }> {
    // Create a test message in DB
    // Use a random ID that fits in INT4 (max ~2.1 billion). Real Telegram msg IDs are small sequential ints.
    const testMsgId = Math.floor(Math.random() * 2_000_000_000);
    const dbMessage = await prisma.telegramChannelMessage.create({
      data: {
        telegramMsgId: testMsgId,
        channelId: 'TEST',
        text,
        senderName: 'Test User',
        hasMedia: false,
        receivedAt: new Date(),
      },
    });

    // Analyze with Claude
    const analysis = await telegramSignalAnalyzer.analyzeMessage(text, dbMessage.id);

    // Persist analysis (upsert to handle duplicate messages)
    const testAnalysisData = {
      category: analysis.category,
      symbol: analysis.symbol,
      direction: analysis.direction,
      entryPrice: analysis.entryPrice,
      stopLoss: analysis.stopLoss,
      takeProfit: analysis.takeProfit,
      confidence: analysis.confidence,
      reasoning: analysis.reasoning,
      linkedSignalId: analysis.linkedSignalId,
      executionStatus: simulate ? 'SKIPPED' : 'PENDING',
    };
    const dbAnalysis = await prisma.telegramSignalAnalysis.upsert({
      where: { messageId: dbMessage.id },
      create: { messageId: dbMessage.id, ...testAnalysisData },
      update: testAnalysisData,
    });

    if (!simulate && analysis.category === 'SIGNAL') {
      try {
        await this.executeSignal(dbAnalysis.id, analysis);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        await this.markFailed(dbAnalysis.id, errMsg);
      }
    } else if (simulate) {
      // Mark as skipped with reason
      await prisma.telegramSignalAnalysis.update({
        where: { id: dbAnalysis.id },
        data: {
          executionStatus: 'SKIPPED',
          executionError: 'Test simulation - no trade executed',
        },
      });
    }

    const final = await prisma.telegramSignalAnalysis.findUnique({
      where: { id: dbAnalysis.id },
    });

    return {
      analysis,
      messageId: dbMessage.id,
      executionStatus: final?.executionStatus || 'SKIPPED',
    };
  }

  /**
   * Execute a SIGNAL: calculate position size with 2% risk, place market order
   */
  private async executeSignal(analysisId: string, analysis: SignalAnalysis): Promise<void> {
    if (!analysis.symbol || !analysis.direction) {
      await this.markSkipped(analysisId, 'Missing symbol or direction');
      return;
    }

    try {
      // Get account info and symbol info
      const accountInfo = await metaApiClient.getAccountInfo();
      const symbolInfo = await metaApiClient.getSymbolInfo(analysis.symbol);
      const price = await metaApiClient.getCurrentPrice(analysis.symbol);

      const currentPrice = analysis.direction === 'BUY' ? price.ask : price.bid;
      const entryPrice = analysis.entryPrice || currentPrice;

      // Determine stop loss
      let stopLoss = analysis.stopLoss;
      if (!stopLoss) {
        const defaultDist = DEFAULT_SL_DISTANCES[analysis.symbol] || 0.005;
        stopLoss = analysis.direction === 'BUY'
          ? entryPrice - defaultDist
          : entryPrice + defaultDist;
        console.log(`[TradeExecutor] Using default SL distance for ${analysis.symbol}: ${defaultDist}`);
      }

      // Calculate position size with 10% risk
      const positionInfo = calculatePositionSize(
        accountInfo.balance,
        10, // 10% risk
        entryPrice,
        stopLoss,
        symbolInfo
      );

      // Reject if SL is too wide
      if (positionInfo.wasClampedToMin) {
        await this.markSkipped(analysisId, `SL too wide: lot clamped to minimum`);
        return;
      }

      console.log(`[TradeExecutor] Placing order: ${analysis.direction} ${analysis.symbol} ${positionInfo.lotSize} lots, SL: ${stopLoss}, TP: ${analysis.takeProfit || 'none'}`);

      // Execute the trade
      const orderResult = await metaApiClient.placeMarketOrder(
        analysis.symbol,
        analysis.direction,
        positionInfo.lotSize,
        stopLoss,
        analysis.takeProfit || undefined,
        `TG_KASPER ${analysis.direction}`
      );

      // Record the trade
      const trade: Omit<Trade, 'id'> = {
        symbol: analysis.symbol,
        direction: analysis.direction,
        strategy: 'EXTERNAL' as StrategyType,
        entryPrice: analysis.direction === 'BUY' ? price.ask : price.bid,
        stopLoss,
        takeProfit: analysis.takeProfit || 0,
        lotSize: positionInfo.lotSize,
        openTime: new Date(),
        status: 'OPEN',
        mt5OrderId: orderResult.orderId,
        mt5PositionId: orderResult.positionId,
        riskAmount: positionInfo.riskAmount,
        riskRewardRatio: analysis.takeProfit
          ? Math.abs(analysis.takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss)
          : 0,
      };

      const recorded = await tradeManager.recordTrade(trade);

      // Update analysis with execution status
      await prisma.telegramSignalAnalysis.update({
        where: { id: analysisId },
        data: {
          executionStatus: 'EXECUTED',
          tradeId: recorded.id,
        },
      });

      // Update listener state counters
      await prisma.telegramListenerState.update({
        where: { id: 'singleton' },
        data: {
          totalSignals: { increment: 1 },
          totalExecuted: { increment: 1 },
        },
      });

      // Notify via Telegram bot
      if (telegramNotifier.isEnabled()) {
        await telegramNotifier.sendMessage(
          `📡 <b>TELEGRAM SIGNAL EXECUTED</b>\n\n` +
          `${analysis.direction === 'BUY' ? '🟢 LONG' : '🔴 SHORT'} <b>${analysis.symbol}</b>\n` +
          `Entry: ${trade.entryPrice}\n` +
          `SL: ${stopLoss}\n` +
          `TP: ${analysis.takeProfit || 'None'}\n` +
          `Size: ${positionInfo.lotSize} lots\n` +
          `Risk: $${positionInfo.riskAmount.toFixed(2)} (10%)`
        );
      }

      console.log(`[TradeExecutor] Trade executed: ${recorded.id}`);
    } catch (error) {
      throw error; // Re-throw to be caught by processMessage
    }
  }

  /**
   * Handle TP_UPDATE: modify the take-profit of a linked trade.
   * Falls back to most recent open EXTERNAL trade if linkedSignalId is missing.
   */
  private async handleTPUpdate(analysisId: string, analysis: SignalAnalysis): Promise<void> {
    if (!analysis.takeProfit) {
      await this.markSkipped(analysisId, 'Missing takeProfit value for TP update');
      return;
    }

    const trade = await this.findOpenTrade(analysis);

    if (!trade) {
      await this.markSkipped(analysisId, 'No open EXTERNAL trade found for TP update');
      return;
    }

    await metaApiClient.modifyPosition(trade.mt5PositionId, trade.stopLoss, analysis.takeProfit);

    await prisma.trade.update({
      where: { id: trade.id },
      data: { takeProfit: analysis.takeProfit },
    });

    await prisma.telegramSignalAnalysis.update({
      where: { id: analysisId },
      data: {
        executionStatus: 'EXECUTED',
        tradeId: trade.id,
      },
    });

    console.log(`[TradeExecutor] TP updated to ${analysis.takeProfit} for trade ${trade.id}`);
  }

  /**
   * Handle SL_UPDATE: modify the stop-loss of a linked trade.
   * Falls back to most recent open EXTERNAL trade if linkedSignalId is missing.
   */
  private async handleSLUpdate(analysisId: string, analysis: SignalAnalysis): Promise<void> {
    if (!analysis.stopLoss) {
      await this.markSkipped(analysisId, 'Missing stopLoss value for SL update');
      return;
    }

    const trade = await this.findOpenTrade(analysis);

    if (!trade) {
      await this.markSkipped(analysisId, 'No open EXTERNAL trade found for SL update');
      return;
    }

    await metaApiClient.modifyPosition(trade.mt5PositionId, analysis.stopLoss, trade.takeProfit);

    await prisma.trade.update({
      where: { id: trade.id },
      data: { stopLoss: analysis.stopLoss },
    });

    await prisma.telegramSignalAnalysis.update({
      where: { id: analysisId },
      data: {
        executionStatus: 'EXECUTED',
        tradeId: trade.id,
      },
    });

    console.log(`[TradeExecutor] SL updated to ${analysis.stopLoss} for trade ${trade.id}`);
  }

  /**
   * Handle CLOSE_SIGNAL: close the linked trade (full or partial).
   * If closePercent < 100, performs a partial close and moves SL to breakeven.
   * Falls back to most recent open EXTERNAL trade if linkedSignalId is missing.
   */
  private async handleCloseSignal(analysisId: string, analysis: SignalAnalysis): Promise<void> {
    const trade = await this.findOpenTrade(analysis);

    if (!trade) {
      await this.markSkipped(analysisId, 'No open EXTERNAL trade found to close');
      return;
    }

    const closePercent = analysis.closePercent ?? 100;

    if (closePercent < 100) {
      // Partial close
      const closeVolume = trade.lotSize * (closePercent / 100);
      const symbolInfo = await metaApiClient.getSymbolInfo(trade.symbol);
      const roundedVolume = Math.round(closeVolume / symbolInfo.volumeStep) * symbolInfo.volumeStep;

      if (roundedVolume < symbolInfo.minVolume) {
        await this.markSkipped(analysisId, `Partial close volume too small: ${roundedVolume} < ${symbolInfo.minVolume}`);
        return;
      }

      await metaApiClient.closePositionPartially(trade.mt5PositionId, roundedVolume);
      console.log(`[TradeExecutor] Partial close ${closePercent}% (${roundedVolume} lots) for trade ${trade.id}`);

      // After partial close, move SL to breakeven to protect remaining position
      const beSL = this.computeBreakevenSL(trade.entryPrice, trade.symbol, trade.direction);
      await metaApiClient.modifyPosition(trade.mt5PositionId, beSL, trade.takeProfit);
      await prisma.trade.update({
        where: { id: trade.id },
        data: { stopLoss: beSL },
      });
      console.log(`[TradeExecutor] SL moved to breakeven (${beSL}) after partial close`);
    } else {
      // Full close
      await metaApiClient.closePosition(trade.mt5PositionId);
      console.log(`[TradeExecutor] Position fully closed for trade ${trade.id}`);
    }

    await prisma.telegramSignalAnalysis.update({
      where: { id: analysisId },
      data: {
        executionStatus: 'EXECUTED',
        tradeId: trade.id,
      },
    });
  }

  /**
   * Handle MOVE_TO_BE: move stop-loss to breakeven (entry price + small buffer).
   */
  private async handleMoveToBreakeven(analysisId: string, analysis: SignalAnalysis): Promise<void> {
    const trade = await this.findOpenTrade(analysis);

    if (!trade) {
      await this.markSkipped(analysisId, 'No open EXTERNAL trade found for move to BE');
      return;
    }

    const beSL = this.computeBreakevenSL(trade.entryPrice, trade.symbol, trade.direction);

    await metaApiClient.modifyPosition(trade.mt5PositionId, beSL, trade.takeProfit);
    await prisma.trade.update({
      where: { id: trade.id },
      data: { stopLoss: beSL },
    });

    await prisma.telegramSignalAnalysis.update({
      where: { id: analysisId },
      data: {
        executionStatus: 'EXECUTED',
        tradeId: trade.id,
      },
    });

    console.log(`[TradeExecutor] SL moved to breakeven (${beSL}) for trade ${trade.id}`);
  }

  /**
   * Compute breakeven SL = entry +/- small buffer (direction-aware).
   * Buffer covers spread so we don't get stopped out at exact entry.
   */
  private computeBreakevenSL(entryPrice: number, symbol: string, direction: string): number {
    const buffers: Record<string, number> = {
      'XAUUSD.s': 0.5,
      'XAGUSD.s': 0.05,
      'BTCUSD': 50,
      'ETHUSD': 3,
    };
    const buffer = buffers[symbol] ?? 0.0003; // forex default

    return direction === 'BUY'
      ? entryPrice + buffer
      : entryPrice - buffer;
  }

  /**
   * Find the open trade for a management message (CLOSE/TP_UPDATE/SL_UPDATE).
   * Resolution order:
   *  1. linkedSignalId from LLM analysis (if valid and has an open trade)
   *  2. Most recent open EXTERNAL trade matching the symbol (if symbol provided)
   *  3. Most recent open EXTERNAL trade (any symbol)
   */
  private async findOpenTrade(analysis: SignalAnalysis): Promise<{ id: string; mt5PositionId: string; stopLoss: number; takeProfit: number; symbol: string; entryPrice: number; lotSize: number; direction: string } | null> {
    // 1. Try linkedSignalId
    if (analysis.linkedSignalId) {
      const linkedSignal = await prisma.telegramSignalAnalysis.findUnique({
        where: { id: analysis.linkedSignalId },
      });
      if (linkedSignal?.tradeId) {
        const trade = await prisma.trade.findUnique({
          where: { id: linkedSignal.tradeId },
        });
        if (trade?.mt5PositionId && trade.status === 'OPEN') {
          console.log(`[TradeExecutor] Linked trade found: ${trade.id} (${trade.symbol})`);
          return { id: trade.id, mt5PositionId: trade.mt5PositionId, stopLoss: trade.stopLoss, takeProfit: trade.takeProfit, symbol: trade.symbol, entryPrice: trade.entryPrice, lotSize: trade.lotSize, direction: trade.direction };
        }
      }
    }

    // 2. Most recent open EXTERNAL trade for the symbol
    if (analysis.symbol) {
      const trade = await prisma.trade.findFirst({
        where: { status: 'OPEN', strategy: 'EXTERNAL', symbol: analysis.symbol, mt5PositionId: { not: null } },
        orderBy: { openTime: 'desc' },
      });
      if (trade?.mt5PositionId) {
        console.log(`[TradeExecutor] Found open trade by symbol ${analysis.symbol}: ${trade.id}`);
        return { id: trade.id, mt5PositionId: trade.mt5PositionId, stopLoss: trade.stopLoss, takeProfit: trade.takeProfit, symbol: trade.symbol, entryPrice: trade.entryPrice, lotSize: trade.lotSize, direction: trade.direction };
      }
    }

    // 3. Most recent open EXTERNAL trade (any symbol)
    const trade = await prisma.trade.findFirst({
      where: { status: 'OPEN', strategy: 'EXTERNAL', mt5PositionId: { not: null } },
      orderBy: { openTime: 'desc' },
    });
    if (trade?.mt5PositionId) {
      console.log(`[TradeExecutor] Found most recent open EXTERNAL trade: ${trade.id} (${trade.symbol})`);
      return { id: trade.id, mt5PositionId: trade.mt5PositionId, stopLoss: trade.stopLoss, takeProfit: trade.takeProfit, symbol: trade.symbol, entryPrice: trade.entryPrice, lotSize: trade.lotSize, direction: trade.direction };
    }

    return null;
  }

  private async markSkipped(analysisId: string, reason: string): Promise<void> {
    await prisma.telegramSignalAnalysis.update({
      where: { id: analysisId },
      data: {
        executionStatus: 'SKIPPED',
        executionError: reason,
      },
    });
    console.log(`[TradeExecutor] Skipped: ${reason}`);
  }

  private async markFailed(analysisId: string, error: string): Promise<void> {
    await prisma.telegramSignalAnalysis.update({
      where: { id: analysisId },
      data: {
        executionStatus: 'FAILED',
        executionError: error,
      },
    });
    console.log(`[TradeExecutor] Failed: ${error}`);
  }
}

export const telegramTradeExecutor = new TelegramTradeExecutor();
