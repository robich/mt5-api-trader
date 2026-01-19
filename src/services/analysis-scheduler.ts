/**
 * Market Analysis Scheduler
 * Runs daily market analysis and sends notifications
 */

import * as cron from 'node-cron';
import { marketAnalysisService } from './market-analysis';
import { telegramNotifier } from './telegram';
import { format } from 'date-fns';

class AnalysisScheduler {
  private task: cron.ScheduledTask | null = null;
  private isRunning = false;

  /**
   * Start the scheduler
   * Default: Runs daily at 9:00 AM UTC
   * Can be customized via ANALYSIS_SCHEDULE environment variable
   */
  start(): void {
    // Get schedule from env or use default (9 AM UTC daily)
    const schedule = process.env.ANALYSIS_SCHEDULE || '0 9 * * *';

    console.log('[AnalysisScheduler] Starting scheduler...');
    console.log('[AnalysisScheduler] Schedule:', schedule);

    // Validate cron expression
    if (!cron.validate(schedule)) {
      console.error('[AnalysisScheduler] Invalid cron schedule:', schedule);
      return;
    }

    // Initialize services
    marketAnalysisService.initialize();
    telegramNotifier.initialize();

    // Create scheduled task
    this.task = cron.schedule(schedule, async () => {
      await this.runScheduledAnalysis();
    });

    this.isRunning = true;
    console.log('[AnalysisScheduler] Scheduler started successfully');
    console.log('[AnalysisScheduler] Next analysis will run according to schedule:', schedule);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      this.isRunning = false;
      console.log('[AnalysisScheduler] Scheduler stopped');
    }
  }

  /**
   * Check if scheduler is running
   */
  isSchedulerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Run the scheduled analysis
   */
  private async runScheduledAnalysis(): Promise<void> {
    console.log('[AnalysisScheduler] Running scheduled market analysis...');

    try {
      // Run the analysis
      const result = await marketAnalysisService.runDailyAnalysis();

      if (!result) {
        console.log('[AnalysisScheduler] No analysis result (service may be disabled)');
        return;
      }

      // Get the saved analysis from database
      const latestAnalysis = await marketAnalysisService.getLatestAnalysis();

      if (!latestAnalysis) {
        console.error('[AnalysisScheduler] Analysis completed but not found in database');
        return;
      }

      // Send telegram notification
      await this.sendNotification(latestAnalysis);

      console.log('[AnalysisScheduler] Scheduled analysis completed successfully');
    } catch (error) {
      console.error('[AnalysisScheduler] Error in scheduled analysis:', error);
    }
  }

  /**
   * Manually trigger an analysis (for testing or on-demand)
   */
  async runManualAnalysis(): Promise<{ success: boolean; message: string; analysisId?: string }> {
    console.log('[AnalysisScheduler] Running manual market analysis...');

    try {
      // Initialize services if not already done
      if (!marketAnalysisService.isEnabled()) {
        marketAnalysisService.initialize();
      }
      if (!telegramNotifier.isEnabled()) {
        telegramNotifier.initialize();
      }

      // Run the analysis
      const result = await marketAnalysisService.runDailyAnalysis();

      if (!result) {
        return {
          success: false,
          message: 'Analysis service is not enabled. Please set ANTHROPIC_API_KEY in .env',
        };
      }

      // Get the saved analysis from database
      const latestAnalysis = await marketAnalysisService.getLatestAnalysis();

      if (!latestAnalysis) {
        return {
          success: false,
          message: 'Analysis completed but not found in database',
        };
      }

      // Send telegram notification
      await this.sendNotification(latestAnalysis);

      return {
        success: true,
        message: 'Market analysis completed and notification sent',
        analysisId: latestAnalysis.id,
      };
    } catch (error) {
      console.error('[AnalysisScheduler] Error in manual analysis:', error);
      return {
        success: false,
        message: `Error running analysis: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Send telegram notification for an analysis
   */
  private async sendNotification(analysis: any): Promise<void> {
    try {
      // Format symbols if present
      let symbols: string[] | undefined;
      if (analysis.recommendedSymbols) {
        try {
          symbols = JSON.parse(analysis.recommendedSymbols);
        } catch (e) {
          console.error('[AnalysisScheduler] Error parsing symbols:', e);
        }
      }

      // Send notification
      await telegramNotifier.notifyMarketAnalysis({
        weekStartDate: format(analysis.weekStartDate, 'MMM d'),
        weekEndDate: format(analysis.weekEndDate, 'MMM d, yyyy'),
        likelyOutcome: analysis.likelyOutcome,
        tradeRecommendation: analysis.tradeRecommendation,
        recommendedSymbols: symbols,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
      });

      // Mark as sent
      await marketAnalysisService.markAsSentToTelegram(analysis.id);

      console.log('[AnalysisScheduler] Notification sent successfully');
    } catch (error) {
      console.error('[AnalysisScheduler] Error sending notification:', error);
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      schedule: process.env.ANALYSIS_SCHEDULE || '0 9 * * * (9 AM UTC daily)',
      marketAnalysisEnabled: marketAnalysisService.isEnabled(),
      telegramEnabled: telegramNotifier.isEnabled(),
    };
  }
}

export const analysisScheduler = new AnalysisScheduler();
