'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Clock,
  GitCommitHorizontal,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';

interface StrategyAnalystRun {
  id: string;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  status: string;
  dryRun: boolean;
  failureStep: string | null;
  failureReason: string | null;
  marketAssessment: string | null;
  riskAssessment: string | null;
  reasoning: string | null;
  codeChanged: boolean;
  changesProposed: number;
  changesApplied: number;
  changesFailed: number;
  changesDetail: string | null;
  backtestBaseline: string | null;
  backtestValidation: string | null;
  backtestPassed: boolean | null;
  commitHash: string | null;
  branch: string | null;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'SUCCESS':
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">SUCCESS</Badge>;
    case 'NO_CHANGES':
      return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">NO CHANGES</Badge>;
    case 'FAILED':
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">FAILED</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function RiskBadge({ risk }: { risk: string | null }) {
  if (!risk) return null;
  switch (risk) {
    case 'LOW':
      return <Badge className="bg-green-500/10 text-green-400 border-green-500/20">LOW</Badge>;
    case 'MEDIUM':
      return <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20">MEDIUM</Badge>;
    case 'HIGH':
      return <Badge className="bg-red-500/10 text-red-400 border-red-500/20">HIGH</Badge>;
    default:
      return <Badge variant="outline">{risk}</Badge>;
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function parseJson(str: string | null): any {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function BacktestTable({ baseline, validation }: { baseline: any; validation: any }) {
  if (!baseline) return null;

  // baseline and validation can be objects keyed by symbol, or arrays
  const baselineData = Array.isArray(baseline) ? baseline : Object.entries(baseline).map(([symbol, data]: [string, any]) => ({ symbol, ...data }));
  const validationData = validation
    ? (Array.isArray(validation) ? validation : Object.entries(validation).map(([symbol, data]: [string, any]) => ({ symbol, ...data })))
    : null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left p-2 text-muted-foreground">Symbol</th>
            <th className="text-right p-2 text-muted-foreground">PnL (Before)</th>
            {validationData && <th className="text-right p-2 text-muted-foreground">PnL (After)</th>}
            <th className="text-right p-2 text-muted-foreground">WR (Before)</th>
            {validationData && <th className="text-right p-2 text-muted-foreground">WR (After)</th>}
            <th className="text-right p-2 text-muted-foreground">PF (Before)</th>
            {validationData && <th className="text-right p-2 text-muted-foreground">PF (After)</th>}
          </tr>
        </thead>
        <tbody>
          {baselineData.map((b: any, i: number) => {
            const v = validationData?.find((vd: any) => vd.symbol === b.symbol);
            return (
              <tr key={i} className="border-b border-border/50">
                <td className="p-2 font-medium">{b.symbol}</td>
                <td className="p-2 text-right">${b.totalPnl?.toFixed(0) ?? b.pnl?.toFixed(0) ?? '-'}</td>
                {validationData && (
                  <td className={`p-2 text-right ${v && (v.totalPnl ?? v.pnl) > (b.totalPnl ?? b.pnl) ? 'text-green-400' : v && (v.totalPnl ?? v.pnl) < (b.totalPnl ?? b.pnl) ? 'text-red-400' : ''}`}>
                    ${v?.totalPnl?.toFixed(0) ?? v?.pnl?.toFixed(0) ?? '-'}
                  </td>
                )}
                <td className="p-2 text-right">{b.winRate?.toFixed(1) ?? '-'}%</td>
                {validationData && (
                  <td className={`p-2 text-right ${v && v.winRate > b.winRate ? 'text-green-400' : v && v.winRate < b.winRate ? 'text-red-400' : ''}`}>
                    {v?.winRate?.toFixed(1) ?? '-'}%
                  </td>
                )}
                <td className="p-2 text-right">{b.profitFactor?.toFixed(2) ?? '-'}</td>
                {validationData && (
                  <td className={`p-2 text-right ${v && v.profitFactor > b.profitFactor ? 'text-green-400' : v && v.profitFactor < b.profitFactor ? 'text-red-400' : ''}`}>
                    {v?.profitFactor?.toFixed(2) ?? '-'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunDetail({ run }: { run: StrategyAnalystRun }) {
  const changesDetail = parseJson(run.changesDetail);
  const baseline = parseJson(run.backtestBaseline);
  const validation = parseJson(run.backtestValidation);

  return (
    <div className="space-y-4 pt-3 border-t border-border/50">
      {/* Reasoning */}
      {run.reasoning && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Claude's Reasoning</h4>
          <p className="text-sm whitespace-pre-wrap bg-muted/30 rounded p-3">{run.reasoning}</p>
        </div>
      )}

      {/* Market Assessment */}
      {run.marketAssessment && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Market Assessment</h4>
          <p className="text-sm whitespace-pre-wrap bg-muted/30 rounded p-3">{run.marketAssessment}</p>
        </div>
      )}

      {/* Changes Detail */}
      {changesDetail && changesDetail.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Changes Applied</h4>
          <ul className="space-y-1">
            {changesDetail.map((c: any, i: number) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="text-muted-foreground font-mono shrink-0">{c.file}</span>
                <span>{c.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Backtest Comparison */}
      {baseline && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">Backtest Comparison</h4>
          <BacktestTable baseline={baseline} validation={validation} />
        </div>
      )}

      {/* Commit Info */}
      {run.commitHash && (
        <div className="flex items-center gap-2 text-sm">
          <GitCommitHorizontal className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-muted-foreground">{run.commitHash.substring(0, 7)}</span>
          {run.branch && <span className="text-muted-foreground">on {run.branch}</span>}
        </div>
      )}

      {/* Failure Info */}
      {run.status === 'FAILED' && (
        <div className="bg-red-500/10 border border-red-500/20 rounded p-3">
          <h4 className="text-sm font-medium text-red-400 mb-1">
            Failed at: {run.failureStep}
          </h4>
          {run.failureReason && (
            <p className="text-sm text-red-300 whitespace-pre-wrap">{run.failureReason}</p>
          )}
        </div>
      )}
    </div>
  );
}

function RunCard({ run }: { run: StrategyAnalystRun }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="transition-colors hover:bg-muted/20">
      <CardContent className="p-4">
        <div
          className="flex items-center gap-3 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {/* Status Icon */}
          {run.status === 'SUCCESS' && <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />}
          {run.status === 'NO_CHANGES' && <MinusCircle className="h-5 w-5 text-blue-500 shrink-0" />}
          {run.status === 'FAILED' && <XCircle className="h-5 w-5 text-red-500 shrink-0" />}

          {/* Date + Time */}
          <div className="shrink-0">
            <div className="text-sm font-medium">{formatDate(run.startedAt)}</div>
            <div className="text-xs text-muted-foreground">{formatTime(run.startedAt)}</div>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={run.status} />
            {run.dryRun && <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">DRY RUN</Badge>}
            <RiskBadge risk={run.riskAssessment} />
          </div>

          {/* Changes summary */}
          <div className="flex items-center gap-3 ml-auto text-sm text-muted-foreground">
            {run.codeChanged && (
              <span className="text-green-400">{run.changesApplied} applied</span>
            )}
            {run.changesFailed > 0 && (
              <span className="text-red-400">{run.changesFailed} failed</span>
            )}
            <div className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {formatDuration(run.durationSeconds)}
            </div>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>

        {/* Market Assessment Preview (collapsed) */}
        {!expanded && run.marketAssessment && (
          <p className="text-xs text-muted-foreground mt-2 line-clamp-1 ml-8">
            {run.marketAssessment}
          </p>
        )}

        {/* Expanded Detail */}
        {expanded && <RunDetail run={run} />}
      </CardContent>
    </Card>
  );
}

export default function StrategyAnalystPage() {
  const [runs, setRuns] = useState<StrategyAnalystRun[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/strategy-analyst-runs?limit=50');
      if (!res.ok) throw new Error('Failed to fetch runs');
      const data = await res.json();
      setRuns(data.runs);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      console.error('Error fetching runs:', err);
      setError('Failed to load strategy analyst runs.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 60000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  const successCount = runs.filter(r => r.status === 'SUCCESS').length;
  const failedCount = runs.filter(r => r.status === 'FAILED').length;
  const noChangeCount = runs.filter(r => r.status === 'NO_CHANGES').length;
  const totalChangesApplied = runs.reduce((sum, r) => sum + r.changesApplied, 0);
  const lastRun = runs[0] ?? null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-6 space-y-6">
      {/* Header */}
      <div className="px-4 md:px-6 flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Dashboard
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Strategy Analyst</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchRuns} className="ml-auto">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <div className="mx-4 md:mx-6 bg-red-500/10 border border-red-500 text-red-500 p-4 rounded-lg">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="px-4 md:px-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Last Run</CardTitle>
          </CardHeader>
          <CardContent>
            {lastRun ? (
              <div className="space-y-1">
                <StatusBadge status={lastRun.status} />
                <div className="text-xs text-muted-foreground">{formatDate(lastRun.startedAt)}</div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No runs yet</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Changes Applied</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalChangesApplied}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Success Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {total > 0 ? ((successCount + noChangeCount) / total * 100).toFixed(0) : 0}%
            </div>
            <div className="text-xs text-muted-foreground">
              {successCount} ok / {failedCount} failed
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Runs List */}
      <div className="px-4 md:px-6 space-y-3">
        <h2 className="text-lg font-semibold">Run History</h2>
        {runs.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No strategy analyst runs recorded yet. Runs are saved automatically when the pipeline executes.
            </CardContent>
          </Card>
        ) : (
          runs.map(run => <RunCard key={run.id} run={run} />)
        )}
      </div>
    </div>
  );
}
