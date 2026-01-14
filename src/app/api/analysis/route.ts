import { NextResponse } from 'next/server';
import { analysisStore } from '@/services/analysis-store';

export async function GET() {
  try {
    const results = analysisStore.getAll();
    return NextResponse.json({ analysis: results });
  } catch (error) {
    console.error('Error fetching analysis:', error);
    return NextResponse.json({ error: 'Failed to fetch analysis' }, { status: 500 });
  }
}
