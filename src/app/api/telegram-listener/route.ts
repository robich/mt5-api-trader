import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { telegramListener } from '@/services/telegram-listener';
import { telegramTradeExecutor } from '@/services/telegram-trade-executor';
import { telegramSignalAnalyzer } from '@/services/telegram-signal-analyzer';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');

    // Get listener state
    const state = await prisma.telegramListenerState.findUnique({
      where: { id: 'singleton' },
    });

    // Get recent messages with analysis
    const messages = await prisma.telegramChannelMessage.findMany({
      orderBy: { receivedAt: 'desc' },
      take: limit,
      include: {
        analysis: true,
      },
    });

    return NextResponse.json({
      listener: {
        isListening: state?.isListening ?? false,
        startedAt: state?.startedAt,
        lastMessageAt: state?.lastMessageAt,
        totalMessages: state?.totalMessages ?? 0,
        totalSignals: state?.totalSignals ?? 0,
        totalExecuted: state?.totalExecuted ?? 0,
        errorMessage: state?.errorMessage,
      },
      messages: messages.map((m) => ({
        id: m.id,
        telegramMsgId: m.telegramMsgId,
        channelId: m.channelId,
        text: m.text,
        senderName: m.senderName,
        hasMedia: m.hasMedia,
        receivedAt: m.receivedAt,
        analysis: m.analysis
          ? {
              id: m.analysis.id,
              category: m.analysis.category,
              symbol: m.analysis.symbol,
              direction: m.analysis.direction,
              entryPrice: m.analysis.entryPrice,
              stopLoss: m.analysis.stopLoss,
              takeProfit: m.analysis.takeProfit,
              confidence: m.analysis.confidence,
              reasoning: m.analysis.reasoning,
              executionStatus: m.analysis.executionStatus,
              executionError: m.analysis.executionError,
              tradeId: m.analysis.tradeId,
              linkedSignalId: m.analysis.linkedSignalId,
              createdAt: m.analysis.createdAt,
            }
          : null,
      })),
    });
  } catch (error) {
    console.error('[API] Telegram listener GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get telegram listener status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'start': {
        // Initialize services if needed
        telegramListener.initialize();
        telegramSignalAnalyzer.initialize();
        telegramTradeExecutor.initialize();

        await telegramListener.start({
          onMessage: async (msg) => {
            await telegramTradeExecutor.processMessage(msg);
          },
        });

        return NextResponse.json({
          message: 'Telegram listener started',
          isListening: true,
        });
      }

      case 'stop': {
        await telegramListener.stop();
        return NextResponse.json({
          message: 'Telegram listener stopped',
          isListening: false,
        });
      }

      case 'fetch-latest': {
        const count = body.count || 10;
        const process = body.process ?? false;

        telegramListener.initialize();

        const messages = await telegramListener.fetchLatest(count);

        // Optionally process through the signal pipeline
        if (process) {
          telegramSignalAnalyzer.initialize();
          telegramTradeExecutor.initialize();

          const results = [];
          for (const msg of messages) {
            const result = await telegramTradeExecutor.processMessage(msg);
            results.push({ message: msg, analysis: result });
          }

          return NextResponse.json({
            message: `Fetched and processed ${messages.length} messages`,
            results,
          });
        }

        return NextResponse.json({
          message: `Fetched ${messages.length} messages`,
          messages,
        });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use "start", "stop", or "fetch-latest".' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[API] Telegram listener POST error:', error);
    return NextResponse.json(
      { error: `Failed to execute action: ${error}` },
      { status: 500 }
    );
  }
}
