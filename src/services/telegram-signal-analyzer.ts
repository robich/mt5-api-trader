/**
 * Telegram Signal Analyzer Service
 * Uses Claude AI to analyze Telegram messages and extract trading signals.
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/db';

export type SignalCategory = 'SIGNAL' | 'TP_UPDATE' | 'SL_UPDATE' | 'CLOSE_SIGNAL' | 'MOVE_TO_BE' | 'OTHER';

export interface SignalAnalysis {
  category: SignalCategory;
  symbol: string | null;
  direction: 'BUY' | 'SELL' | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  confidence: number;
  reasoning: string;
  linkedSignalId: string | null;
  closePercent: number | null;
}

// Symbol alias mapping
const SYMBOL_ALIASES: Record<string, string> = {
  'GOLD': 'XAUUSD.s',
  'OR': 'XAUUSD.s',
  'XAU': 'XAUUSD.s',
  'XAUUSD': 'XAUUSD.s',
  'SILVER': 'XAGUSD.s',
  'ARGENT': 'XAGUSD.s',
  'XAG': 'XAGUSD.s',
  'XAGUSD': 'XAGUSD.s',
  'BTC': 'BTCUSD',
  'BITCOIN': 'BTCUSD',
  'BTCUSD': 'BTCUSD',
  'ETH': 'ETHUSD',
  'ETHEREUM': 'ETHUSD',
  'ETHUSD': 'ETHUSD',
  'EURUSD': 'EURUSD',
  'GBPUSD': 'GBPUSD',
  'USDJPY': 'USDJPY',
};

class TelegramSignalAnalyzer {
  private anthropic: Anthropic | null = null;
  private enabled = false;

  initialize(): void {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.enabled = true;
      console.log('[SignalAnalyzer] Service enabled');
    } else {
      console.log('[SignalAnalyzer] Service disabled (missing ANTHROPIC_API_KEY)');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async analyzeMessage(text: string, messageId: string): Promise<SignalAnalysis> {
    if (!this.enabled || !this.anthropic) {
      return this.defaultAnalysis('Service not enabled');
    }

    try {
      // Fetch recent signals for context (to link TP/SL updates)
      const recentSignals = await prisma.telegramSignalAnalysis.findMany({
        where: {
          category: 'SIGNAL',
          executionStatus: 'EXECUTED',
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { message: true },
      });

      const recentContext = recentSignals.map((s) => ({
        id: s.id,
        symbol: s.symbol,
        direction: s.direction,
        entryPrice: s.entryPrice,
        stopLoss: s.stopLoss,
        takeProfit: s.takeProfit,
        text: s.message?.text?.substring(0, 100),
        createdAt: s.createdAt.toISOString(),
      }));

      const prompt = this.buildPrompt(text, recentContext);

      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseResponse(responseText);
    } catch (error) {
      console.error('[SignalAnalyzer] Error analyzing message:', error);
      return this.defaultAnalysis(`Analysis error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildPrompt(
    text: string,
    recentSignals: Array<{
      id: string;
      symbol: string | null;
      direction: string | null;
      entryPrice: number | null;
      stopLoss: number | null;
      takeProfit: number | null;
      text: string | undefined;
      createdAt: string;
    }>
  ): string {
    const signalsContext = recentSignals.length > 0
      ? `\n\nRecent executed signals (for linking TP/SL updates):\n${JSON.stringify(recentSignals, null, 2)}`
      : '';

    return `You are an expert trading signal analyzer. Analyze the following message from a French trading channel ("Kasper Trading Academie") and categorize it.

IMPORTANT RULES:
- Messages about "zone d'achat", "zone de vente", "analyse", "setup", general commentary, or education are ALWAYS category OTHER
- Only classify as SIGNAL if there is a CLEAR, ACTIONABLE trade instruction with explicit direction (BUY/SELL/LONG/SHORT/ACHAT/VENTE) and a specific price level
- TP_UPDATE: message provides a new take-profit price for a recently executed signal
- SL_UPDATE: message provides a new stop-loss price for a recently executed signal
- CLOSE_SIGNAL: message explicitly says to close/exit a position (full or partial). Extract the TP level and set closePercent:
  - "CLOSE TP1" or "fermer TP1" → closePercent: 50
  - "CLOSE TP2" or "fermer TP2" → closePercent: 30
  - "CLOSE TP3" or "fermer TP3" → closePercent: 20
  - "CLOSE ALL" / "CLOSE" / no TP level → closePercent: 100
- MOVE_TO_BE: message says to move stop-loss to breakeven / entry price. Trigger phrases: "déplacer à BE", "move to breakeven", "sécuriser", "secure entry", "mettre à BE", "BE activé"

Symbol mapping (use the mapped name):
- GOLD / OR / XAU / XAUUSD -> XAUUSD.s
- SILVER / ARGENT / XAG / XAGUSD -> XAGUSD.s
- BTC / BITCOIN -> BTCUSD
- ETH / ETHEREUM -> ETHUSD

For TP/SL updates, provide the "linkedSignalId" from the recent signals list that this update belongs to.
${signalsContext}

MESSAGE TO ANALYZE:
"""
${text}
"""

Respond with ONLY a valid JSON object (no markdown, no explanation outside JSON):
{
  "category": "SIGNAL" | "TP_UPDATE" | "SL_UPDATE" | "CLOSE_SIGNAL" | "MOVE_TO_BE" | "OTHER",
  "symbol": "XAUUSD.s" | "BTCUSD" | null,
  "direction": "BUY" | "SELL" | null,
  "entryPrice": number | null,
  "stopLoss": number | null,
  "takeProfit": number | null,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "linkedSignalId": "id from recent signals" | null,
  "closePercent": 50 | 30 | 20 | 100 | null
}`;
  }

  private parseResponse(responseText: string): SignalAnalysis {
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.defaultAnalysis('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and normalize
      const validCategories: SignalCategory[] = ['SIGNAL', 'TP_UPDATE', 'SL_UPDATE', 'CLOSE_SIGNAL', 'MOVE_TO_BE', 'OTHER'];
      const category: SignalCategory = validCategories.includes(parsed.category) ? parsed.category : 'OTHER';

      // Normalize symbol
      let symbol = parsed.symbol;
      if (symbol) {
        const upper = symbol.replace(/\.s$/i, '').toUpperCase();
        symbol = SYMBOL_ALIASES[upper] || symbol;
      }

      // Normalize direction
      let direction = parsed.direction;
      if (direction) {
        direction = direction.toUpperCase();
        if (!['BUY', 'SELL'].includes(direction)) direction = null;
      }

      return {
        category,
        symbol: symbol || null,
        direction: direction || null,
        entryPrice: typeof parsed.entryPrice === 'number' ? parsed.entryPrice : null,
        stopLoss: typeof parsed.stopLoss === 'number' ? parsed.stopLoss : null,
        takeProfit: typeof parsed.takeProfit === 'number' ? parsed.takeProfit : null,
        confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
        reasoning: parsed.reasoning || 'No reasoning provided',
        linkedSignalId: parsed.linkedSignalId || null,
        closePercent: typeof parsed.closePercent === 'number' ? parsed.closePercent : null,
      };
    } catch (error) {
      console.error('[SignalAnalyzer] Error parsing response:', error);
      return this.defaultAnalysis('Failed to parse Claude response');
    }
  }

  private defaultAnalysis(reasoning: string): SignalAnalysis {
    return {
      category: 'OTHER',
      symbol: null,
      direction: null,
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      confidence: 0,
      reasoning,
      linkedSignalId: null,
      closePercent: null,
    };
  }
}

export const telegramSignalAnalyzer = new TelegramSignalAnalyzer();
