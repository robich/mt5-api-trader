'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface AnalysisResult {
  symbol: string;
  timestamp: string;
  currentPrice: number;
  analysis: {
    htf: {
      timeframe: string;
      bias: string;
      orderBlocks: any[];
      liquidityZones: any[];
    };
    mtf: {
      timeframe: string;
      bias: string;
      orderBlocks: any[];
      fvgs: any[];
      liquidityZones: any[];
    };
    ltf: {
      timeframe: string;
      bias: string;
      fvgs: any[];
    };
    confluenceScore: number;
  };
}

interface AnalysisPanelProps {
  analysisResults: AnalysisResult[];
}

function getBiasColor(bias: string): string {
  switch (bias) {
    case 'BULLISH':
      return 'bg-green-500/20 text-green-500';
    case 'BEARISH':
      return 'bg-red-500/20 text-red-500';
    default:
      return 'bg-gray-500/20 text-gray-500';
  }
}

function getConfluenceColor(score: number): string {
  if (score >= 70) return 'text-green-500';
  if (score >= 50) return 'text-yellow-500';
  return 'text-red-500';
}

export function AnalysisPanel({ analysisResults }: AnalysisPanelProps) {
  if (!analysisResults || analysisResults.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Market Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            No analysis available. Start the bot to see analysis results.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Market Analysis</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[300px] md:h-[400px]">
          <div className="p-4 space-y-4">
            {analysisResults.map((result) => (
              <div key={result.symbol} className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{result.symbol}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(result.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                <div className="text-sm text-muted-foreground">
                  Price: <span className="text-foreground font-medium">{result.currentPrice.toFixed(2)}</span>
                </div>

                {/* Timeframe Biases */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">
                      HTF ({result.analysis.htf.timeframe})
                    </div>
                    <Badge className={getBiasColor(result.analysis.htf.bias)} variant="outline">
                      {result.analysis.htf.bias}
                    </Badge>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">
                      MTF ({result.analysis.mtf.timeframe})
                    </div>
                    <Badge className={getBiasColor(result.analysis.mtf.bias)} variant="outline">
                      {result.analysis.mtf.bias}
                    </Badge>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">
                      LTF ({result.analysis.ltf.timeframe})
                    </div>
                    <Badge className={getBiasColor(result.analysis.ltf.bias)} variant="outline">
                      {result.analysis.ltf.bias}
                    </Badge>
                  </div>
                </div>

                {/* Confluence Score */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Confluence Score</span>
                  <span className={`font-bold ${getConfluenceColor(result.analysis.confluenceScore)}`}>
                    {result.analysis.confluenceScore}/100
                  </span>
                </div>

                {/* POIs Summary */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-muted/50 rounded p-2">
                    <div className="text-muted-foreground mb-1">Order Blocks</div>
                    <div className="font-medium">
                      HTF: {result.analysis.htf.orderBlocks.length} | MTF: {result.analysis.mtf.orderBlocks.length}
                    </div>
                  </div>
                  <div className="bg-muted/50 rounded p-2">
                    <div className="text-muted-foreground mb-1">FVGs</div>
                    <div className="font-medium">
                      MTF: {result.analysis.mtf.fvgs.length} | LTF: {result.analysis.ltf.fvgs.length}
                    </div>
                  </div>
                </div>

                {/* Liquidity Zones */}
                <div className="text-xs bg-muted/50 rounded p-2">
                  <div className="text-muted-foreground mb-1">Liquidity Zones</div>
                  <div className="font-medium">
                    HTF: {result.analysis.htf.liquidityZones.length} | MTF: {result.analysis.mtf.liquidityZones.length}
                  </div>
                </div>

                {analysisResults.indexOf(result) < analysisResults.length - 1 && (
                  <Separator className="mt-4" />
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
