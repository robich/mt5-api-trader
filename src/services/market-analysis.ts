/**
 * Market Analysis Service
 * Uses Claude Opus 4.5 to analyze weekly market news and provide trading recommendations
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/db';
import { addDays, startOfWeek, endOfWeek, format } from 'date-fns';

interface MarketAnalysisResult {
  marketNews: string;
  analysis: string;
  likelyOutcome: string;
  tradeRecommendation: 'RECOMMENDED' | 'NOT_RECOMMENDED' | 'NEUTRAL';
  recommendedSymbols?: string[];
  confidence?: number;
  reasoning?: string;
}

class MarketAnalysisService {
  private anthropic: Anthropic | null = null;
  private enabled = false;
  private readonly symbols = ['XAUUSD', 'XAGUSD', 'BTCUSD', 'EURUSD', 'GBPUSD'];

  initialize(): void {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

    console.log('[MarketAnalysis] Initializing...', {
      hasApiKey: !!apiKey,
    });

    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.enabled = true;
      console.log('[MarketAnalysis] Service enabled');
    } else {
      console.log('[MarketAnalysis] Service disabled (missing ANTHROPIC_API_KEY)');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Run the daily market analysis
   */
  async runDailyAnalysis(): Promise<MarketAnalysisResult | null> {
    if (!this.enabled || !this.anthropic) {
      console.log('[MarketAnalysis] Service not enabled, skipping analysis');
      return null;
    }

    try {
      console.log('[MarketAnalysis] Starting daily analysis...');

      // Calculate date ranges
      const today = new Date();
      const weekStart = startOfWeek(addDays(today, 1), { weekStartsOn: 1 }); // Next Monday
      const weekEnd = endOfWeek(addDays(today, 1), { weekStartsOn: 1 }); // Next Sunday

      // Create the analysis prompt
      const prompt = this.createAnalysisPrompt(weekStart, weekEnd);

      // Call Claude Opus 4.5
      console.log('[MarketAnalysis] Calling Claude Opus 4.5...');
      const message = await this.anthropic.messages.create({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 4096,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Parse the response
      const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
      const result = this.parseAnalysisResponse(responseText);

      console.log('[MarketAnalysis] Analysis completed successfully', {
        recommendation: result.tradeRecommendation,
        confidence: result.confidence,
      });

      // Save to database
      await this.saveAnalysis(result, weekStart, weekEnd);

      return result;
    } catch (error) {
      console.error('[MarketAnalysis] Error running analysis:', error);
      return null;
    }
  }

  /**
   * Create the analysis prompt for Claude
   */
  private createAnalysisPrompt(weekStart: Date, weekEnd: Date): string {
    const weekStartStr = format(weekStart, 'MMMM d, yyyy');
    const weekEndStr = format(weekEnd, 'YYYY-MM-dd');
    const todayStr = format(new Date(), 'MMMM d, yyyy');

    return `You are an expert financial market analyst specializing in forex, commodities, and cryptocurrency markets. Today is ${todayStr}.

Your task is to analyze the key market news and economic events for the upcoming trading week (${weekStartStr} to ${weekEndStr}) and provide actionable trading recommendations.

Focus on these markets:
- Gold (XAUUSD) - Forex gold spot
- Silver (XAGUSD) - Forex silver spot
- Bitcoin (BTCUSD) - Cryptocurrency
- EUR/USD - Major forex pair
- GBP/USD - Major forex pair

Please provide your analysis in the following structured format:

# MARKET NEWS SUMMARY
[Summarize the key market news, economic data releases, central bank decisions, geopolitical events, and other factors that could impact these markets during the upcoming week]

# ANALYSIS
[Provide a detailed technical and fundamental analysis of the current market conditions and likely scenarios for each of the key markets listed above]

# LIKELY OUTCOME
[State your primary forecast for the most likely market outcome this week, considering all factors]

# TRADE RECOMMENDATION
[State: RECOMMENDED, NOT_RECOMMENDED, or NEUTRAL]

# RECOMMENDED SYMBOLS
[If RECOMMENDED, list the specific symbols to trade: XAUUSD, XAGUSD, BTCUSD, EURUSD, GBPUSD. If NOT_RECOMMENDED or NEUTRAL, write "NONE"]

# CONFIDENCE LEVEL
[Provide a confidence score from 0.0 to 1.0, where 1.0 is highest confidence]

# REASONING
[Explain your reasoning for the recommendation and confidence level]

Important considerations:
- Consider major economic indicators (NFP, CPI, Fed decisions, etc.)
- Evaluate technical levels and market structure
- Assess geopolitical risks and market sentiment
- Consider seasonality and historical patterns
- Be conservative - only recommend trades when you have strong conviction
- Current trading strategy uses Smart Money Concepts (Order Blocks, Liquidity Sweeps, Break of Structure)

Please provide comprehensive analysis based on publicly known information and typical market patterns.`;
  }

  /**
   * Parse Claude's response into structured data
   */
  private parseAnalysisResponse(response: string): MarketAnalysisResult {
    const sections = {
      marketNews: '',
      analysis: '',
      likelyOutcome: '',
      tradeRecommendation: 'NEUTRAL' as 'RECOMMENDED' | 'NOT_RECOMMENDED' | 'NEUTRAL',
      recommendedSymbols: [] as string[],
      confidence: 0.5,
      reasoning: '',
    };

    try {
      // Extract sections using regex
      const marketNewsMatch = response.match(/# MARKET NEWS SUMMARY\s+([\s\S]*?)(?=\n#|$)/);
      const analysisMatch = response.match(/# ANALYSIS\s+([\s\S]*?)(?=\n#|$)/);
      const outcomeMatch = response.match(/# LIKELY OUTCOME\s+([\s\S]*?)(?=\n#|$)/);
      const recommendationMatch = response.match(/# TRADE RECOMMENDATION\s+([\s\S]*?)(?=\n#|$)/);
      const symbolsMatch = response.match(/# RECOMMENDED SYMBOLS\s+([\s\S]*?)(?=\n#|$)/);
      const confidenceMatch = response.match(/# CONFIDENCE LEVEL\s+([\s\S]*?)(?=\n#|$)/);
      const reasoningMatch = response.match(/# REASONING\s+([\s\S]*?)(?=\n#|$)/);

      sections.marketNews = marketNewsMatch?.[1]?.trim() || 'No market news summary available';
      sections.analysis = analysisMatch?.[1]?.trim() || 'No analysis available';
      sections.likelyOutcome = outcomeMatch?.[1]?.trim() || 'No outcome forecast available';
      sections.reasoning = reasoningMatch?.[1]?.trim() || 'No reasoning provided';

      // Parse recommendation
      const recText = recommendationMatch?.[1]?.trim().toUpperCase() || 'NEUTRAL';
      if (recText.includes('RECOMMENDED') && !recText.includes('NOT')) {
        sections.tradeRecommendation = 'RECOMMENDED';
      } else if (recText.includes('NOT_RECOMMENDED') || recText.includes('NOT RECOMMENDED')) {
        sections.tradeRecommendation = 'NOT_RECOMMENDED';
      } else {
        sections.tradeRecommendation = 'NEUTRAL';
      }

      // Parse symbols
      const symbolsText = symbolsMatch?.[1]?.trim() || '';
      if (symbolsText && symbolsText !== 'NONE') {
        const symbols = symbolsText.match(/(XAUUSD|XAGUSD|BTCUSD|EURUSD|GBPUSD)/gi);
        if (symbols) {
          sections.recommendedSymbols = symbols.map(s => s.toUpperCase());
        }
      }

      // Parse confidence
      const confText = confidenceMatch?.[1]?.trim() || '';
      const confMatch = confText.match(/(\d+\.?\d*)/);
      if (confMatch) {
        sections.confidence = parseFloat(confMatch[1]);
        // Ensure it's between 0 and 1
        if (sections.confidence > 1) sections.confidence = sections.confidence / 100;
      }

    } catch (error) {
      console.error('[MarketAnalysis] Error parsing response:', error);
    }

    return sections;
  }

  /**
   * Save analysis to database
   */
  private async saveAnalysis(
    result: MarketAnalysisResult,
    weekStart: Date,
    weekEnd: Date
  ): Promise<void> {
    try {
      await prisma.marketAnalysis.create({
        data: {
          weekStartDate: weekStart,
          weekEndDate: weekEnd,
          marketNews: result.marketNews,
          analysis: result.analysis,
          likelyOutcome: result.likelyOutcome,
          tradeRecommendation: result.tradeRecommendation,
          recommendedSymbols: result.recommendedSymbols ? JSON.stringify(result.recommendedSymbols) : null,
          confidence: result.confidence,
          reasoning: result.reasoning,
          sentToTelegram: false,
        },
      });

      console.log('[MarketAnalysis] Analysis saved to database');
    } catch (error) {
      console.error('[MarketAnalysis] Error saving analysis to database:', error);
      throw error;
    }
  }

  /**
   * Get recent analyses
   */
  async getRecentAnalyses(limit: number = 10) {
    try {
      return await prisma.marketAnalysis.findMany({
        orderBy: { analysisDate: 'desc' },
        take: limit,
      });
    } catch (error) {
      console.error('[MarketAnalysis] Error fetching analyses:', error);
      return [];
    }
  }

  /**
   * Get latest analysis
   */
  async getLatestAnalysis() {
    try {
      return await prisma.marketAnalysis.findFirst({
        orderBy: { analysisDate: 'desc' },
      });
    } catch (error) {
      console.error('[MarketAnalysis] Error fetching latest analysis:', error);
      return null;
    }
  }

  /**
   * Mark analysis as sent to telegram
   */
  async markAsSentToTelegram(analysisId: string): Promise<void> {
    try {
      await prisma.marketAnalysis.update({
        where: { id: analysisId },
        data: {
          sentToTelegram: true,
          telegramSentAt: new Date(),
        },
      });
    } catch (error) {
      console.error('[MarketAnalysis] Error marking as sent:', error);
    }
  }
}

export const marketAnalysisService = new MarketAnalysisService();
export type { MarketAnalysisResult };
