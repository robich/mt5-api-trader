'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Play, Square, RefreshCw, Clock, Trash2 } from 'lucide-react';

interface BotControlsProps {
  isRunning: boolean;
  symbols: string[];
  startedAt: string | null;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onRefresh: () => void;
}

function formatUptime(startedAt: string | null): string {
  if (!startedAt) return '-';

  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = now - start;

  if (diffMs < 0) return '-';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatStartedAt(startedAt: string | null): string {
  if (!startedAt) return '-';
  const date = new Date(startedAt);
  return date.toLocaleString();
}

export function BotControls({
  isRunning,
  symbols,
  startedAt,
  onStart,
  onStop,
  onRefresh,
}: BotControlsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [uptime, setUptime] = useState(formatUptime(startedAt));

  // Update uptime every second when running
  useEffect(() => {
    if (!isRunning || !startedAt) {
      setUptime('-');
      return;
    }

    setUptime(formatUptime(startedAt));
    const interval = setInterval(() => {
      setUptime(formatUptime(startedAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, startedAt]);

  const handleStart = async () => {
    setIsLoading(true);
    try {
      await onStart();
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    setIsLoading(true);
    try {
      await onStop();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetDatabase = async () => {
    setIsResetting(true);
    try {
      const response = await fetch('/api/admin/database/reset', {
        method: 'POST',
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Close dialog and refresh data
        setIsResetDialogOpen(false);
        onRefresh();
        alert('Database reset successfully!');
      } else {
        alert(`Failed to reset database: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Reset error:', error);
      alert('Failed to reset database. Check console for details.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Bot Status</CardTitle>
          <Badge variant={isRunning ? 'default' : 'secondary'}>
            {isRunning ? 'Running' : 'Stopped'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isRunning && (
          <div className="flex flex-col gap-1 mb-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>Started: {formatStartedAt(startedAt)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>Uptime: {uptime}</span>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2 mb-4">
          {symbols.map((symbol) => (
            <Badge key={symbol} variant="outline">
              {symbol}
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          {isRunning ? (
            <Button
              variant="destructive"
              onClick={handleStop}
              disabled={isLoading}
              className="flex-1"
            >
              <Square className="mr-2 h-4 w-4" />
              Stop Bot
            </Button>
          ) : (
            <Button
              onClick={handleStart}
              disabled={isLoading}
              className="flex-1"
            >
              <Play className="mr-2 h-4 w-4" />
              Start Bot
            </Button>
          )}
          <Button variant="outline" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <Dialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="w-full mt-2 text-destructive hover:text-destructive"
              disabled={isLoading || isResetting}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Reset Database
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset Database?</DialogTitle>
              <DialogDescription>
                This will permanently delete all trades, signals, and historical data from the
                database. This action cannot be undone.
                <br />
                <br />
                <strong>Warning:</strong> Make sure the bot is stopped before resetting the
                database.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsResetDialogOpen(false)}
                disabled={isResetting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleResetDatabase}
                disabled={isResetting}
              >
                {isResetting ? 'Resetting...' : 'Reset Database'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
