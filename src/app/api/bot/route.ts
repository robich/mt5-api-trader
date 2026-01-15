import { NextRequest, NextResponse } from 'next/server';
import { tradingBot } from '@/services/bot';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = tradingBot.getStatus();

    const botState = await prisma.botState.findUnique({
      where: { id: 'singleton' },
    });

    return NextResponse.json({
      ...status,
      startedAt: botState?.startedAt,
      lastHeartbeat: botState?.lastHeartbeat,
    });
  } catch (error) {
    console.error('Bot status API error:', error);
    return NextResponse.json(
      { error: 'Failed to get bot status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, config } = body;

    switch (action) {
      case 'start':
        await tradingBot.start();
        return NextResponse.json({ message: 'Bot started', status: 'running' });

      case 'stop':
        await tradingBot.stop();
        return NextResponse.json({ message: 'Bot stopped', status: 'stopped' });

      case 'updateConfig':
        if (config) {
          tradingBot.updateConfig(config);
        }
        return NextResponse.json({
          message: 'Config updated',
          config: tradingBot.getStatus().config,
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Bot action API error:', error);
    return NextResponse.json(
      { error: `Failed to execute action: ${error}` },
      { status: 500 }
    );
  }
}
