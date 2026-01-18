import { NextResponse } from 'next/server';
import { telegramNotifier } from '@/services/telegram';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // Ensure telegram is initialized
    if (!telegramNotifier.isEnabled()) {
      telegramNotifier.initialize();
    }

    const result = await telegramNotifier.sendTestMessage();

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message,
        configured: true,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          message: result.message,
          configured: telegramNotifier.isEnabled(),
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Telegram test API error:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Failed to send test message: ${error}`,
        configured: telegramNotifier.isEnabled(),
      },
      { status: 500 }
    );
  }
}
