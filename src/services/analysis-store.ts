import { MultiTimeframeAnalysis } from '@/lib/types';

export interface AnalysisResult {
  symbol: string;
  timestamp: Date;
  analysis: MultiTimeframeAnalysis;
  currentPrice: number;
}

/**
 * In-memory store for latest analysis results per symbol
 */
class AnalysisStore {
  private results: Map<string, AnalysisResult> = new Map();

  set(symbol: string, analysis: MultiTimeframeAnalysis, currentPrice: number): void {
    this.results.set(symbol, {
      symbol,
      timestamp: new Date(),
      analysis,
      currentPrice,
    });
  }

  get(symbol: string): AnalysisResult | undefined {
    return this.results.get(symbol);
  }

  getAll(): AnalysisResult[] {
    return Array.from(this.results.values());
  }

  clear(): void {
    this.results.clear();
  }
}

export const analysisStore = new AnalysisStore();
