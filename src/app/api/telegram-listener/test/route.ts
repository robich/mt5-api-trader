import { NextRequest, NextResponse } from 'next/server';
import { telegramSignalAnalyzer } from '@/services/telegram-signal-analyzer';
import { telegramTradeExecutor } from '@/services/telegram-trade-executor';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, simulate = true } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Missing "text" field in request body' },
        { status: 400 }
      );
    }

    // Initialize analyzer if not yet done
    telegramSignalAnalyzer.initialize();
    telegramTradeExecutor.initialize();

    // Process through full pipeline
    const result = await telegramTradeExecutor.processTestMessage(text, simulate);

    return NextResponse.json({
      success: true,
      simulate,
      analysis: result.analysis,
      messageId: result.messageId,
      executionStatus: result.executionStatus,
    });
  } catch (error) {
    console.error('[API] Telegram test POST error:', error);
    return NextResponse.json(
      { error: `Failed to analyze test message: ${error}` },
      { status: 500 }
    );
  }
}
