'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface MarketAnalysis {
  id: string;
  analysisDate: string;
  weekStartDate: string;
  weekEndDate: string;
  tradeRecommendation: 'RECOMMENDED' | 'NOT_RECOMMENDED' | 'NEUTRAL';
  recommendedSymbols: string[] | null;
  confidence: number | null;
  likelyOutcome: string;
  reasoning: string | null;
  sentToTelegram: boolean;
}

function getRecommendationBadge(recommendation: string) {
  switch (recommendation) {
    case 'RECOMMENDED':
      return <Badge className="bg-green-500/20 text-green-500">Recommended</Badge>;
    case 'NOT_RECOMMENDED':
      return <Badge className="bg-red-500/20 text-red-500">Not Recommended</Badge>;
    default:
      return <Badge className="bg-yellow-500/20 text-yellow-500">Neutral</Badge>;
  }
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.7) return 'text-green-500';
  if (confidence >= 0.5) return 'text-yellow-500';
  return 'text-red-500';
}

export function MarketAnalysisPanel() {
  const [analyses, setAnalyses] = useState<MarketAnalysis[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTriggering, setIsTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalyses = async () => {
    try {
      const res = await fetch('/api/market-analysis?limit=5');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setAnalyses(data.analyses || []);
      setError(null);
    } catch {
      setError('Failed to load market analysis');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalyses();
    // Refresh every 5 minutes
    const interval = setInterval(fetchAnalyses, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const triggerAnalysis = async () => {
    setIsTriggering(true);
    try {
      const res = await fetch('/api/market-analysis', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to trigger');
      await fetchAnalyses();
    } catch {
      setError('Failed to trigger analysis');
    } finally {
      setIsTriggering(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Daily Market Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Daily Market Analysis</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={triggerAnalysis}
            disabled={isTriggering}
          >
            {isTriggering ? 'Analyzing...' : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error && (
          <div className="px-4 pb-4">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}

        {analyses.length === 0 ? (
          <div className="px-4 pb-4">
            <p className="text-muted-foreground text-sm">
              No analysis available. Click Refresh to generate one.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[350px]">
            <div className="p-4 space-y-4">
              {analyses.map((analysis, index) => (
                <div key={analysis.id} className="space-y-3">
                  {/* Date and Recommendation */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {new Date(analysis.analysisDate).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    {getRecommendationBadge(analysis.tradeRecommendation)}
                  </div>

                  {/* Confidence Score */}
                  {analysis.confidence !== null && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Confidence</span>
                      <span className={`font-semibold ${getConfidenceColor(analysis.confidence)}`}>
                        {(analysis.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}

                  {/* Recommended Symbols */}
                  {analysis.recommendedSymbols && analysis.recommendedSymbols.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {analysis.recommendedSymbols.map((symbol) => (
                        <Badge key={symbol} variant="secondary" className="text-xs">
                          {symbol}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Likely Outcome */}
                  <div className="bg-muted/50 rounded p-2">
                    <div className="text-xs text-muted-foreground mb-1">Likely Outcome</div>
                    <p className="text-sm leading-relaxed line-clamp-4">
                      {analysis.likelyOutcome}
                    </p>
                  </div>

                  {/* Reasoning */}
                  {analysis.reasoning && (
                    <div className="text-xs text-muted-foreground">
                      <details>
                        <summary className="cursor-pointer hover:text-foreground">
                          View reasoning
                        </summary>
                        <p className="mt-2 text-foreground leading-relaxed">
                          {analysis.reasoning}
                        </p>
                      </details>
                    </div>
                  )}

                  {index < analyses.length - 1 && <Separator className="mt-4" />}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
