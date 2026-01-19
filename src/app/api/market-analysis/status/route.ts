/**
 * Market Analysis Scheduler Status API
 * GET: Get the current status of the analysis scheduler
 */

import { NextResponse } from 'next/server';
import { analysisScheduler } from '@/services/analysis-scheduler';
import { marketAnalysisService } from '@/services/market-analysis';

// Mark as dynamic to prevent static generation
export const dynamic = 'force-dynamic';

/**
 * GET /api/market-analysis/status
 * Get scheduler and service status
 */
export async function GET() {
  try {
    const schedulerStatus = analysisScheduler.getStatus();

    let latestAnalysis = null;
    try {
      latestAnalysis = await marketAnalysisService.getLatestAnalysis();
    } catch (dbError) {
      // Database might not be available during build time
      console.warn('[MarketAnalysis] Could not fetch latest analysis:', dbError);
    }

    return NextResponse.json({
      success: true,
      scheduler: schedulerStatus,
      latestAnalysis: latestAnalysis ? {
        id: latestAnalysis.id,
        analysisDate: latestAnalysis.analysisDate,
        weekStartDate: latestAnalysis.weekStartDate,
        weekEndDate: latestAnalysis.weekEndDate,
        tradeRecommendation: latestAnalysis.tradeRecommendation,
        confidence: latestAnalysis.confidence,
        sentToTelegram: latestAnalysis.sentToTelegram,
      } : null,
    });
  } catch (error) {
    console.error('Error fetching scheduler status:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch scheduler status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
