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
  ArrowRightLeft,
  Play,
  Loader2,
} from 'lucide-react';

interface StrategySwitch {
  id: string;
  symbol: string | null;
  previousProfile: string;
  newProfile: string;
  reason: string;
  source: string;
  backtestPnl: number | null;
  backtestWinRate: number | null;
  backtestPF: number | null;
  backtestTrades: number | null;
  backtestMaxDD: number | null;
  backtestDays: number | null;
  backtestStart: string | null;
  backtestEnd: string | null;
  previousPnl: number | null;
  previousWinRate: number | null;
  previousPF: number | null;
  switchedAt: string;
}

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
    <>
      {/* Mobile: stacked cards */}
      <div className="space-y-3 sm:hidden">
        {baselineData.map((b: any, i: number) => {
          const v = validationData?.find((vd: any) => vd.symbol === b.symbol);
          return (
            <div key={i} className="bg-muted/30 rounded p-3 space-y-2">
              <div className="font-medium text-sm">{b.symbol}</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">PnL</div>
                  <div>${b.totalPnl?.toFixed(0) ?? b.pnl?.toFixed(0) ?? '-'}</div>
                  {v && (
                    <div className={`${(v.totalPnl ?? v.pnl) > (b.totalPnl ?? b.pnl) ? 'text-green-400' : (v.totalPnl ?? v.pnl) < (b.totalPnl ?? b.pnl) ? 'text-red-400' : ''}`}>
                      &rarr; ${v?.totalPnl?.toFixed(0) ?? v?.pnl?.toFixed(0) ?? '-'}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-muted-foreground">Win Rate</div>
                  <div>{b.winRate?.toFixed(1) ?? '-'}%</div>
                  {v && (
                    <div className={`${v.winRate > b.winRate ? 'text-green-400' : v.winRate < b.winRate ? 'text-red-400' : ''}`}>
                      &rarr; {v?.winRate?.toFixed(1) ?? '-'}%
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-muted-foreground">PF</div>
                  <div>{b.profitFactor?.toFixed(2) ?? '-'}</div>
                  {v && (
                    <div className={`${v.profitFactor > b.profitFactor ? 'text-green-400' : v.profitFactor < b.profitFactor ? 'text-red-400' : ''}`}>
                      &rarr; {v?.profitFactor?.toFixed(2) ?? '-'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: table */}
      <div className="overflow-x-auto hidden sm:block">
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
    </>
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
          <ul className="space-y-2">
            {changesDetail.map((c: any, i: number) => (
              <li key={i} className="text-sm">
                <span className="text-muted-foreground font-mono text-xs break-all block sm:inline">{c.file}</span>
                <span className="block sm:inline sm:ml-2">{c.description}</span>
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

function SourceBadge({ source }: { source: string }) {
  switch (source) {
    case 'manual':
      return <Badge variant="outline" className="text-blue-400 border-blue-500/30">Manual</Badge>;
    case 'analyst':
      return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Analyst</Badge>;
    case 'daily-reopt':
      return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Daily Reopt</Badge>;
    case 'api':
      return <Badge variant="outline" className="text-gray-400 border-gray-500/30">API</Badge>;
    default:
      return <Badge variant="outline">{source}</Badge>;
  }
}

function SwitchCard({ sw }: { sw: StrategySwitch }) {
  const [expanded, setExpanded] = useState(false);
  const hasBacktest = sw.backtestWinRate !== null || sw.backtestPnl !== null;
  const hasPrevious = sw.previousWinRate !== null || sw.previousPnl !== null;

  return (
    <Card className="transition-colors hover:bg-muted/20">
      <CardContent className="p-3 sm:p-4">
        <div
          className="cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {/* Mobile: stacked layout */}
          <div className="flex items-start gap-2 sm:hidden">
            <ArrowRightLeft className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <SourceBadge source={sw.source} />
                  {sw.symbol && (
                    <Badge variant="outline" className="text-cyan-400 border-cyan-500/30 text-xs">{sw.symbol}</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-muted-foreground">{formatDate(sw.switchedAt)}</span>
                  {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">{sw.previousProfile}</span>
                <span className="text-muted-foreground mx-1">&rarr;</span>
                <span className="font-medium">{sw.newProfile}</span>
              </div>
              {(sw.backtestWinRate !== null || sw.backtestPF !== null) && (
                <div className="flex items-center gap-2 text-xs">
                  {sw.backtestWinRate !== null && (
                    <span className="text-green-400">{sw.backtestWinRate.toFixed(1)}% WR</span>
                  )}
                  {sw.backtestPF !== null && (
                    <span className="text-muted-foreground">PF {sw.backtestPF.toFixed(2)}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Desktop: horizontal layout */}
          <div className="hidden sm:flex items-center gap-3">
            <ArrowRightLeft className="h-5 w-5 text-orange-500 shrink-0" />

            <div className="shrink-0">
              <div className="text-sm font-medium">{formatDate(sw.switchedAt)}</div>
              <div className="text-xs text-muted-foreground">{formatTime(sw.switchedAt)}</div>
            </div>

            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <SourceBadge source={sw.source} />
              {sw.symbol && (
                <Badge variant="outline" className="text-cyan-400 border-cyan-500/30">{sw.symbol}</Badge>
              )}
              <span className="text-sm truncate">
                <span className="text-muted-foreground">{sw.previousProfile}</span>
                <span className="text-muted-foreground mx-1">&rarr;</span>
                <span className="font-medium">{sw.newProfile}</span>
              </span>
            </div>

            <div className="flex items-center gap-3 ml-auto text-sm text-muted-foreground shrink-0">
              {sw.backtestWinRate !== null && (
                <span className="text-green-400">{sw.backtestWinRate.toFixed(1)}% WR</span>
              )}
              {sw.backtestPF !== null && (
                <span>PF {sw.backtestPF.toFixed(2)}</span>
              )}
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </div>
        </div>

        {!expanded && (
          <p className="text-xs text-muted-foreground mt-2 line-clamp-1 ml-6 sm:ml-8">
            {sw.reason}
          </p>
        )}

        {expanded && (
          <div className="space-y-4 pt-3 border-t border-border/50 mt-3">
            {/* Reason */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">Reason</h4>
              <p className="text-sm whitespace-pre-wrap bg-muted/30 rounded p-3">{sw.reason}</p>
            </div>

            {/* Backtest Results Comparison */}
            {(hasBacktest || hasPrevious) && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Backtest Results</h4>

                {/* Mobile: stacked cards */}
                <div className="space-y-2 sm:hidden">
                  {hasPrevious && (
                    <div className="bg-muted/30 rounded p-3">
                      <div className="text-xs text-muted-foreground mb-1.5">Previous: {sw.previousProfile}</div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <div>
                          <div className="text-muted-foreground/60">PnL</div>
                          <div>{sw.previousPnl !== null ? `$${sw.previousPnl.toFixed(0)}` : '-'}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground/60">WR</div>
                          <div>{sw.previousWinRate !== null ? `${sw.previousWinRate.toFixed(1)}%` : '-'}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground/60">PF</div>
                          <div>{sw.previousPF !== null ? sw.previousPF.toFixed(2) : '-'}</div>
                        </div>
                      </div>
                    </div>
                  )}
                  {hasBacktest && (
                    <div className="bg-muted/30 rounded p-3">
                      <div className="text-xs font-medium mb-1.5">New: {sw.newProfile}</div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-muted-foreground">PnL</div>
                          <div className={sw.previousPnl !== null && sw.backtestPnl !== null && sw.backtestPnl > sw.previousPnl ? 'text-green-400' : ''}>
                            {sw.backtestPnl !== null ? `$${sw.backtestPnl.toFixed(0)}` : '-'}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">WR</div>
                          <div className={sw.previousWinRate !== null && sw.backtestWinRate !== null && sw.backtestWinRate > sw.previousWinRate ? 'text-green-400' : ''}>
                            {sw.backtestWinRate !== null ? `${sw.backtestWinRate.toFixed(1)}%` : '-'}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">PF</div>
                          <div className={sw.previousPF !== null && sw.backtestPF !== null && sw.backtestPF > sw.previousPF ? 'text-green-400' : ''}>
                            {sw.backtestPF !== null ? sw.backtestPF.toFixed(2) : '-'}
                          </div>
                        </div>
                      </div>
                      {(sw.backtestTrades !== null || sw.backtestMaxDD !== null) && (
                        <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground">
                          {sw.backtestTrades !== null && <span>{sw.backtestTrades} trades</span>}
                          {sw.backtestMaxDD !== null && <span>{sw.backtestMaxDD.toFixed(1)}% DD</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Desktop: table */}
                <div className="overflow-x-auto hidden sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-2 text-muted-foreground">Profile</th>
                        <th className="text-right p-2 text-muted-foreground">PnL</th>
                        <th className="text-right p-2 text-muted-foreground">Win Rate</th>
                        <th className="text-right p-2 text-muted-foreground">Profit Factor</th>
                        {sw.backtestTrades !== null && <th className="text-right p-2 text-muted-foreground">Trades</th>}
                        {sw.backtestMaxDD !== null && <th className="text-right p-2 text-muted-foreground">Max DD</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {hasPrevious && (
                        <tr className="border-b border-border/50 text-muted-foreground">
                          <td className="p-2 font-medium">{sw.previousProfile}</td>
                          <td className="p-2 text-right">{sw.previousPnl !== null ? `$${sw.previousPnl.toFixed(0)}` : '-'}</td>
                          <td className="p-2 text-right">{sw.previousWinRate !== null ? `${sw.previousWinRate.toFixed(1)}%` : '-'}</td>
                          <td className="p-2 text-right">{sw.previousPF !== null ? sw.previousPF.toFixed(2) : '-'}</td>
                          {sw.backtestTrades !== null && <td className="p-2 text-right">-</td>}
                          {sw.backtestMaxDD !== null && <td className="p-2 text-right">-</td>}
                        </tr>
                      )}
                      {hasBacktest && (
                        <tr className="border-b border-border/50">
                          <td className="p-2 font-medium">{sw.newProfile}</td>
                          <td className={`p-2 text-right ${sw.previousPnl !== null && sw.backtestPnl !== null && sw.backtestPnl > sw.previousPnl ? 'text-green-400' : ''}`}>
                            {sw.backtestPnl !== null ? `$${sw.backtestPnl.toFixed(0)}` : '-'}
                          </td>
                          <td className={`p-2 text-right ${sw.previousWinRate !== null && sw.backtestWinRate !== null && sw.backtestWinRate > sw.previousWinRate ? 'text-green-400' : ''}`}>
                            {sw.backtestWinRate !== null ? `${sw.backtestWinRate.toFixed(1)}%` : '-'}
                          </td>
                          <td className={`p-2 text-right ${sw.previousPF !== null && sw.backtestPF !== null && sw.backtestPF > sw.previousPF ? 'text-green-400' : ''}`}>
                            {sw.backtestPF !== null ? sw.backtestPF.toFixed(2) : '-'}
                          </td>
                          {sw.backtestTrades !== null && <td className="p-2 text-right">{sw.backtestTrades}</td>}
                          {sw.backtestMaxDD !== null && <td className="p-2 text-right">{sw.backtestMaxDD.toFixed(1)}%</td>}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {sw.backtestDays !== null && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {sw.backtestDays}-day backtest
                    {sw.backtestStart && sw.backtestEnd && (
                      <> ({formatDate(sw.backtestStart)} - {formatDate(sw.backtestEnd)})</>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RunCard({ run }: { run: StrategyAnalystRun }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="transition-colors hover:bg-muted/20">
      <CardContent className="p-3 sm:p-4">
        <div
          className="cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {/* Mobile: stacked layout */}
          <div className="flex items-start gap-2 sm:hidden">
            {/* Status Icon */}
            {run.status === 'SUCCESS' && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />}
            {run.status === 'NO_CHANGES' && <MinusCircle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />}
            {run.status === 'FAILED' && <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />}

            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <StatusBadge status={run.status} />
                  {run.dryRun && <Badge variant="outline" className="text-yellow-400 border-yellow-500/30 text-xs">DRY RUN</Badge>}
                  <RiskBadge risk={run.riskAssessment} />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-muted-foreground">{formatDate(run.startedAt)}</span>
                  {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {run.codeChanged && (
                  <span className="text-green-400">{run.changesApplied} applied</span>
                )}
                {run.changesFailed > 0 && (
                  <span className="text-red-400">{run.changesFailed} failed</span>
                )}
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDuration(run.durationSeconds)}
                </div>
              </div>
            </div>
          </div>

          {/* Desktop: horizontal layout */}
          <div className="hidden sm:flex items-center gap-3">
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
        </div>

        {/* Market Assessment Preview (collapsed) */}
        {!expanded && run.marketAssessment && (
          <p className="text-xs text-muted-foreground mt-2 line-clamp-1 ml-6 sm:ml-8">
            {run.marketAssessment}
          </p>
        )}

        {/* Expanded Detail */}
        {expanded && <RunDetail run={run} />}
      </CardContent>
    </Card>
  );
}

type ActiveTab = 'runs' | 'switches';

export default function StrategyAnalystPage() {
  const [runs, setRuns] = useState<StrategyAnalystRun[]>([]);
  const [switches, setSwitches] = useState<StrategySwitch[]>([]);
  const [total, setTotal] = useState(0);
  const [switchTotal, setSwitchTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('switches');
  const [isTriggering, setIsTriggering] = useState(false);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [runsRes, switchesRes] = await Promise.all([
        fetch('/api/strategy-analyst-runs?limit=50'),
        fetch('/api/strategy-switches?limit=50'),
      ]);
      if (!runsRes.ok) throw new Error('Failed to fetch runs');
      const runsData = await runsRes.json();
      setRuns(runsData.runs);
      setTotal(runsData.total);

      if (switchesRes.ok) {
        const switchesData = await switchesRes.json();
        setSwitches(switchesData.switches);
        setSwitchTotal(switchesData.total);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load strategy analyst data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchAnalystStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/strategy-analyst-runs/trigger');
      if (res.ok) {
        const data = await res.json();
        setAnalysisRunning(data.isRunning ?? false);
      }
    } catch {
      // Silently fail - service may not be available
    }
  }, []);

  const triggerAnalysis = useCallback(async () => {
    setIsTriggering(true);
    setTriggerMessage(null);
    try {
      const res = await fetch('/api/strategy-analyst-runs/trigger', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setTriggerMessage('Analysis triggered successfully');
        setAnalysisRunning(true);
      } else {
        setTriggerMessage(data.error || 'Failed to trigger analysis');
      }
    } catch {
      setTriggerMessage('Failed to reach analyst service');
    } finally {
      setIsTriggering(false);
      setTimeout(() => setTriggerMessage(null), 5000);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchAnalystStatus();
    const interval = setInterval(fetchData, 60000);
    const statusInterval = setInterval(fetchAnalystStatus, 15000);
    return () => {
      clearInterval(interval);
      clearInterval(statusInterval);
    };
  }, [fetchData, fetchAnalystStatus]);

  const successCount = runs.filter(r => r.status === 'SUCCESS').length;
  const failedCount = runs.filter(r => r.status === 'FAILED').length;
  const noChangeCount = runs.filter(r => r.status === 'NO_CHANGES').length;
  const totalChangesApplied = runs.reduce((sum, r) => sum + r.changesApplied, 0);
  const lastRun = runs[0] ?? null;
  const lastSwitch = switches[0] ?? null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-4 sm:py-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="px-4 md:px-6">
        <div className="flex items-center gap-2 sm:gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Dashboard</span>
            </Button>
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <Brain className="h-5 w-5 text-primary shrink-0" />
            <h1 className="text-lg sm:text-xl font-bold truncate">Strategy Analyst</h1>
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
            {triggerMessage && (
              <span className={`text-xs hidden sm:inline ${triggerMessage.includes('successfully') ? 'text-green-400' : 'text-red-400'}`}>
                {triggerMessage}
              </span>
            )}
            {analysisRunning && (
              <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 animate-pulse text-xs">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                <span className="hidden sm:inline">Running</span>
              </Badge>
            )}
            <Button
              variant="default"
              size="sm"
              onClick={triggerAnalysis}
              disabled={isTriggering || analysisRunning}
            >
              {isTriggering ? (
                <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
              ) : (
                <Play className="h-4 w-4 sm:mr-2" />
              )}
              <span className="hidden sm:inline">Run Analysis</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={fetchData}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* Mobile trigger message - shown below header */}
        {triggerMessage && (
          <div className={`text-xs text-center mt-2 sm:hidden ${triggerMessage.includes('successfully') ? 'text-green-400' : 'text-red-400'}`}>
            {triggerMessage}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 md:mx-6 bg-red-500/10 border border-red-500 text-red-500 p-4 rounded-lg">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="px-4 md:px-6 grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
        <Card>
          <CardHeader className="p-3 pb-1 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm text-muted-foreground">Strategy Switches</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            <div className="text-xl sm:text-2xl font-bold">{switchTotal}</div>
            {lastSwitch && (
              <div className="text-xs text-muted-foreground">{formatDate(lastSwitch.switchedAt)}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm text-muted-foreground">Current Profile</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            {lastSwitch ? (
              <div className="space-y-1">
                <div className="text-xs sm:text-sm font-medium truncate">{lastSwitch.newProfile}</div>
                <SourceBadge source={lastSwitch.source} />
              </div>
            ) : (
              <div className="text-xs sm:text-sm text-muted-foreground">No switches yet</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm text-muted-foreground">Analyst Runs</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            <div className="text-xl sm:text-2xl font-bold">{total}</div>
            <div className="text-xs text-muted-foreground">
              {successCount} ok / {failedCount} failed
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm text-muted-foreground">Changes Applied</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            <div className="text-xl sm:text-2xl font-bold">{totalChangesApplied}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tab Navigation */}
      <div className="px-4 md:px-6 flex gap-1 sm:gap-2 border-b border-border pb-0">
        <button
          className={`px-2.5 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'switches'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('switches')}
        >
          <ArrowRightLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4 inline mr-1 sm:mr-1.5 -mt-0.5" />
          Switches ({switchTotal})
        </button>
        <button
          className={`px-2.5 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'runs'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('runs')}
        >
          <Brain className="h-3.5 w-3.5 sm:h-4 sm:w-4 inline mr-1 sm:mr-1.5 -mt-0.5" />
          Analyst Runs ({total})
        </button>
      </div>

      {/* Strategy Switches Tab */}
      {activeTab === 'switches' && (
        <div className="px-4 md:px-6 space-y-3">
          {switches.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No strategy switches recorded yet. Switches are logged automatically when the strategy profile is changed.
              </CardContent>
            </Card>
          ) : (
            switches.map(sw => <SwitchCard key={sw.id} sw={sw} />)
          )}
        </div>
      )}

      {/* Analyst Runs Tab */}
      {activeTab === 'runs' && (
        <div className="px-4 md:px-6 space-y-3">
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
      )}
    </div>
  );
}
