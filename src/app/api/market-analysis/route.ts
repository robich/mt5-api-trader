/**
 * Market Analysis API Endpoints
 * GET: Fetch analysis history
 * POST: Manually trigger a new analysis
 */

import { NextRequest, NextResponse } from 'next/server';
import { marketAnalysisService } from '@/services/market-analysis';
import { analysisScheduler } from '@/services/analysis-scheduler';

// Mark as dynamic to prevent static generation
export const dynamic = 'force-dynamic';

/**
 * GET /api/market-analysis
 * Fetch market analysis history
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '10');

    const analyses = await marketAnalysisService.getRecentAnalyses(limit);

    return NextResponse.json({
      success: true,
      count: analyses.length,
      analyses: analyses.map((a: any) => ({
        id: a.id,
        analysisDate: a.analysisDate,
        weekStartDate: a.weekStartDate,
        weekEndDate: a.weekEndDate,
        tradeRecommendation: a.tradeRecommendation,
        recommendedSymbols: a.recommendedSymbols ? JSON.parse(a.recommendedSymbols) : null,
        confidence: a.confidence,
        likelyOutcome: a.likelyOutcome,
        reasoning: a.reasoning,
        sentToTelegram: a.sentToTelegram,
        telegramSentAt: a.telegramSentAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching market analyses:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch market analyses',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/market-analysis
 * Manually trigger a new market analysis
 */
export async function POST() {
  try {
    console.log('Manual market analysis triggered via API');

    const result = await analysisScheduler.runManualAnalysis();

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message,
        analysisId: result.analysisId,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.message,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Error triggering market analysis:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to trigger market analysis',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
