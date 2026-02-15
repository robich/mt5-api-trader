'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface AnalysisScan {
  id: string;
  symbol: string;
  currentPrice: number;
  htfBias: string;
  mtfBias: string;
  ltfBias: string;
  confluenceScore: number;
  htfOBCount: number;
  mtfOBCount: number;
  mtfFVGCount: number;
  ltfFVGCount: number;
  htfLiqZoneCount: number;
  mtfLiqZoneCount: number;
  signalGenerated: boolean;
  signalDirection: string | null;
  signalStrategy: string | null;
  signalConfidence: number | null;
  scannedAt: string;
}

const SYMBOLS = ['XAUUSD.s', 'XAGUSD.s', 'BTCUSD', 'ETHUSD'];

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getBiasColor(bias: string): string {
  switch (bias) {
    case 'BULLISH': return 'bg-green-500/20 text-green-500';
    case 'BEARISH': return 'bg-red-500/20 text-red-500';
    default: return 'bg-gray-500/20 text-gray-500';
  }
}

function getConfluenceColor(score: number): string {
  if (score >= 70) return 'text-green-500';
  if (score >= 50) return 'text-yellow-500';
  return 'text-red-500';
}

export function AnalysisHistoryPanel() {
  const [scans, setScans] = useState<AnalysisScan[]>([]);
  const [total, setTotal] = useState(0);
  const [symbolFilter, setSymbolFilter] = useState<string | null>(null);
  const [signalOnly, setSignalOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchScans = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '50', offset: '0' });
      if (symbolFilter) params.set('symbol', symbolFilter);
      if (signalOnly) params.set('signalOnly', 'true');

      const res = await fetch(`/api/analysis-history?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setScans(data.scans);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to fetch analysis history:', err);
    } finally {
      setLoading(false);
    }
  }, [symbolFilter, signalOnly]);

  useEffect(() => {
    fetchScans();
    const interval = setInterval(fetchScans, 30000);
    return () => clearInterval(interval);
  }, [fetchScans]);

  return (
    <div className="flex flex-col">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 p-3 pb-2">
        <Button
          variant={symbolFilter === null ? 'default' : 'outline'}
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setSymbolFilter(null)}
        >
          All
        </Button>
        {SYMBOLS.map((s) => (
          <Button
            key={s}
            variant={symbolFilter === s ? 'default' : 'outline'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setSymbolFilter(s)}
          >
            {s.replace('.s', '')}
          </Button>
        ))}
        <Button
          variant={signalOnly ? 'default' : 'outline'}
          size="sm"
          className="h-6 px-2 text-xs ml-auto"
          onClick={() => setSignalOnly(!signalOnly)}
        >
          Signals only
        </Button>
      </div>

      {/* Scan list */}
      <ScrollArea className="h-[300px] md:h-[400px]">
        {loading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
        ) : scans.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No scans yet. Start the bot to see analysis history.
          </div>
        ) : (
          <div className="px-3 pb-3 space-y-1">
            <div className="text-xs text-muted-foreground px-1 pb-1">{total} total scans</div>
            {scans.map((scan) => (
              <div
                key={scan.id}
                className="rounded border px-2.5 py-2 space-y-1.5 bg-card hover:bg-muted/30 transition-colors"
              >
                {/* Row 1: time + symbol + outcome */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-14 shrink-0">
                    {relativeTime(scan.scannedAt)}
                  </span>
                  <span className="text-xs font-semibold">{scan.symbol}</span>
                  {scan.signalGenerated ? (
                    <Badge className="bg-blue-500/20 text-blue-400 text-[10px] px-1.5 py-0" variant="outline">
                      SIGNAL
                    </Badge>
                  ) : (
                    <Badge className="bg-gray-500/10 text-gray-500 text-[10px] px-1.5 py-0" variant="outline">
                      NO SIGNAL
                    </Badge>
                  )}
                  {scan.signalGenerated && scan.signalDirection && (
                    <>
                      <Badge
                        className={`text-[10px] px-1.5 py-0 ${
                          scan.signalDirection === 'BUY'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                        variant="outline"
                      >
                        {scan.signalDirection}
                      </Badge>
                      {scan.signalStrategy && (
                        <span className="text-[10px] text-muted-foreground truncate">
                          {scan.signalStrategy}
                        </span>
                      )}
                      {scan.signalConfidence != null && (
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {(scan.signalConfidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* Row 2: biases + confluence */}
                <div className="flex items-center gap-1.5">
                  <Badge className={`${getBiasColor(scan.htfBias)} text-[10px] px-1 py-0`} variant="outline">
                    H:{scan.htfBias.charAt(0)}
                  </Badge>
                  <Badge className={`${getBiasColor(scan.mtfBias)} text-[10px] px-1 py-0`} variant="outline">
                    M:{scan.mtfBias.charAt(0)}
                  </Badge>
                  <Badge className={`${getBiasColor(scan.ltfBias)} text-[10px] px-1 py-0`} variant="outline">
                    L:{scan.ltfBias.charAt(0)}
                  </Badge>
                  <span className={`text-[10px] font-bold ml-1 ${getConfluenceColor(scan.confluenceScore)}`}>
                    C:{scan.confluenceScore}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    OB:{scan.htfOBCount}/{scan.mtfOBCount} | FVG:{scan.mtfFVGCount}/{scan.ltfFVGCount} | Liq:{scan.htfLiqZoneCount}/{scan.mtfLiqZoneCount}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
