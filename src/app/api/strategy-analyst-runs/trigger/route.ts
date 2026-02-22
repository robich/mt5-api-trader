import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ANALYST_URL = process.env.ANALYST_TRIGGER_URL || 'http://strategy-analyst:3002';

export async function POST() {
  try {
    const res = await fetch(`${ANALYST_URL}/trigger`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: any) {
    console.error('Error triggering strategy analyst:', error);
    const message = error?.cause?.code === 'ECONNREFUSED'
      ? 'Strategy analyst service is not running'
      : 'Failed to reach strategy analyst service';
    return NextResponse.json(
      { success: false, error: message },
      { status: 503 }
    );
  }
}

export async function GET() {
  try {
    const res = await fetch(`${ANALYST_URL}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error fetching analyst status:', error);
    return NextResponse.json(
      { isRunning: false, lastTrigger: null, serviceAvailable: false },
      { status: 200 }
    );
  }
}
