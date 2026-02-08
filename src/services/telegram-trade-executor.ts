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
      return { category: 'OTHER', symbol: null, direction: null, entryPrice: null, stopLoss: null, takeProfit: null, confidence: 0, reasoning: 'Message not found in DB', linkedSignalId: null };
    }

    // Analyze with Claude
    const analysis = await telegramSignalAnalyzer.analyzeMessage(msg.text, dbMessage.id);
    console.log(`[TradeExecutor] Analysis result: ${analysis.category} (confidence: ${analysis.confidence})`);

    // Persist analysis
    const dbAnalysis = await prisma.telegramSignalAnalysis.create({
      data: {
        messageId: dbMessage.id,
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
      },
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

    // Persist analysis
    const dbAnalysis = await prisma.telegramSignalAnalysis.create({
      data: {
        messageId: dbMessage.id,
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
      },
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

      // Calculate position size with 5% risk
      const positionInfo = calculatePositionSize(
        accountInfo.balance,
        5, // 5% risk
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
          `Risk: $${positionInfo.riskAmount.toFixed(2)} (5%)`
        );
      }

      console.log(`[TradeExecutor] Trade executed: ${recorded.id}`);
    } catch (error) {
      throw error; // Re-throw to be caught by processMessage
    }
  }

  /**
   * Handle TP_UPDATE: modify the take-profit of a linked trade
   */
  private async handleTPUpdate(analysisId: string, analysis: SignalAnalysis): Promise<void> {
    if (!analysis.linkedSignalId || !analysis.takeProfit) {
      await this.markSkipped(analysisId, 'Missing linkedSignalId or takeProfit for TP update');
      return;
    }

    // Find the linked signal's trade
    const linkedSignal = await prisma.telegramSignalAnalysis.findUnique({
      where: { id: analysis.linkedSignalId },
    });

    if (!linkedSignal?.tradeId) {
      await this.markSkipped(analysisId, 'Linked signal has no trade');
      return;
    }

    const trade = await prisma.trade.findUnique({
      where: { id: linkedSignal.tradeId },
    });

    if (!trade?.mt5PositionId || trade.status !== 'OPEN') {
      await this.markSkipped(analysisId, 'Trade not found or not open');
      return;
    }

    // Modify position TP
    await metaApiClient.modifyPosition(trade.mt5PositionId, trade.stopLoss, analysis.takeProfit);

    // Update trade in DB
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
   * Handle SL_UPDATE: modify the stop-loss of a linked trade
   */
  private async handleSLUpdate(analysisId: string, analysis: SignalAnalysis): Promise<void> {
    if (!analysis.linkedSignalId || !analysis.stopLoss) {
      await this.markSkipped(analysisId, 'Missing linkedSignalId or stopLoss for SL update');
      return;
    }

    const linkedSignal = await prisma.telegramSignalAnalysis.findUnique({
      where: { id: analysis.linkedSignalId },
    });

    if (!linkedSignal?.tradeId) {
      await this.markSkipped(analysisId, 'Linked signal has no trade');
      return;
    }

    const trade = await prisma.trade.findUnique({
      where: { id: linkedSignal.tradeId },
    });

    if (!trade?.mt5PositionId || trade.status !== 'OPEN') {
      await this.markSkipped(analysisId, 'Trade not found or not open');
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
   * Handle CLOSE_SIGNAL: close the linked trade
   */
  private async handleCloseSignal(analysisId: string, analysis: SignalAnalysis): Promise<void> {
    if (!analysis.linkedSignalId) {
      await this.markSkipped(analysisId, 'Missing linkedSignalId for close signal');
      return;
    }

    const linkedSignal = await prisma.telegramSignalAnalysis.findUnique({
      where: { id: analysis.linkedSignalId },
    });

    if (!linkedSignal?.tradeId) {
      await this.markSkipped(analysisId, 'Linked signal has no trade');
      return;
    }

    const trade = await prisma.trade.findUnique({
      where: { id: linkedSignal.tradeId },
    });

    if (!trade?.mt5PositionId || trade.status !== 'OPEN') {
      await this.markSkipped(analysisId, 'Trade not found or not open');
      return;
    }

    await metaApiClient.closePosition(trade.mt5PositionId);

    await prisma.telegramSignalAnalysis.update({
      where: { id: analysisId },
      data: {
        executionStatus: 'EXECUTED',
        tradeId: trade.id,
      },
    });

    console.log(`[TradeExecutor] Position closed for trade ${trade.id}`);
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
