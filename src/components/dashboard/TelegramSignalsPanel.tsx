'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface TelegramAnalysis {
  id: string;
  category: string;
  symbol: string | null;
  direction: string | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  confidence: number | null;
  reasoning: string | null;
  executionStatus: string;
  executionError: string | null;
  tradeId: string | null;
  linkedSignalId: string | null;
  createdAt: string;
}

interface TelegramMessage {
  id: string;
  telegramMsgId: number;
  channelId: string;
  text: string | null;
  senderName: string | null;
  hasMedia: boolean;
  receivedAt: string;
  analysis: TelegramAnalysis | null;
}

interface ListenerStatus {
  isListening: boolean;
  startedAt: string | null;
  lastMessageAt: string | null;
  totalMessages: number;
  totalSignals: number;
  totalExecuted: number;
  errorMessage: string | null;
}

interface TestResult {
  analysis: TelegramAnalysis;
  executionStatus: string;
}

function getCategoryBadge(category: string) {
  switch (category) {
    case 'SIGNAL':
      return <Badge className="bg-green-500/20 text-green-500">SIGNAL</Badge>;
    case 'TP_UPDATE':
      return <Badge className="bg-blue-500/20 text-blue-500">TP UPDATE</Badge>;
    case 'SL_UPDATE':
      return <Badge className="bg-orange-500/20 text-orange-500">SL UPDATE</Badge>;
    case 'CLOSE_SIGNAL':
      return <Badge className="bg-purple-500/20 text-purple-500">CLOSE</Badge>;
    default:
      return <Badge className="bg-gray-500/20 text-gray-500">OTHER</Badge>;
  }
}

function getExecutionBadge(status: string) {
  switch (status) {
    case 'EXECUTED':
      return <Badge className="bg-green-500/20 text-green-500 text-xs">EXECUTED</Badge>;
    case 'SKIPPED':
      return <Badge className="bg-yellow-500/20 text-yellow-500 text-xs">SKIPPED</Badge>;
    case 'FAILED':
      return <Badge className="bg-red-500/20 text-red-500 text-xs">FAILED</Badge>;
    default:
      return <Badge className="bg-gray-500/20 text-gray-500 text-xs">PENDING</Badge>;
  }
}

export function TelegramSignalsPanel() {
  const [listener, setListener] = useState<ListenerStatus | null>(null);
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [testText, setTestText] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/telegram-listener?limit=20');
      if (!res.ok) return;
      const data = await res.json();
      setListener(data.listener);
      setMessages(data.messages || []);
    } catch {
      // Silently fail on polling
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  const testMessage = async () => {
    if (!testText.trim()) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/telegram-listener/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: testText, simulate: true }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setTestResult({
        analysis: data.analysis,
        executionStatus: data.executionStatus,
      });
      // Refresh messages list
      await fetchData();
    } catch {
      setTestResult(null);
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Telegram Signals</CardTitle>
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
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg">Telegram Signals</CardTitle>
          <div
            className={`h-2 w-2 rounded-full ${
              listener?.isListening ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
        </div>
        {/* Stats */}
        <div className="flex gap-3 text-xs text-muted-foreground mt-1">
          <span>{listener?.totalMessages ?? 0} msgs</span>
          <span>{listener?.totalSignals ?? 0} signals</span>
          <span>{listener?.totalExecuted ?? 0} executed</span>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Test message input */}
        <div className="px-4 pb-3">
          <div className="flex gap-2">
            <Input
              placeholder="Test a message..."
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') testMessage();
              }}
              className="text-sm h-8"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={testMessage}
              disabled={isTesting || !testText.trim()}
              className="h-8 px-3"
            >
              {isTesting ? '...' : 'Analyze'}
            </Button>
          </div>

          {/* Test result */}
          {testResult && (
            <div className="mt-2 p-2 bg-muted/50 rounded text-sm space-y-1">
              <div className="flex items-center gap-2">
                {getCategoryBadge(testResult.analysis.category)}
                {testResult.analysis.symbol && (
                  <Badge variant="secondary" className="text-xs">
                    {testResult.analysis.symbol}
                  </Badge>
                )}
                {testResult.analysis.direction && (
                  <Badge
                    className={`text-xs ${
                      testResult.analysis.direction === 'BUY'
                        ? 'bg-green-500/20 text-green-500'
                        : 'bg-red-500/20 text-red-500'
                    }`}
                  >
                    {testResult.analysis.direction}
                  </Badge>
                )}
                {testResult.analysis.confidence !== null && (
                  <span className="text-xs text-muted-foreground">
                    {(testResult.analysis.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {testResult.analysis.reasoning}
              </p>
            </div>
          )}
        </div>

        {listener?.errorMessage && (
          <div className="px-4 pb-3">
            <p className="text-red-500 text-xs">{listener.errorMessage}</p>
          </div>
        )}

        {/* Messages list */}
        {messages.length === 0 ? (
          <div className="px-4 pb-4">
            <p className="text-muted-foreground text-sm">
              No messages yet. Start the listener or test a message above.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[350px]">
            <div className="p-4 space-y-3">
              {messages.map((msg, index) => (
                <div key={msg.id} className="space-y-2">
                  {/* Time + category */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {new Date(msg.receivedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {msg.channelId === 'TEST' && (
                        <span className="ml-1 text-yellow-500">(test)</span>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      {msg.analysis && getCategoryBadge(msg.analysis.category)}
                      {msg.analysis && getExecutionBadge(msg.analysis.executionStatus)}
                    </div>
                  </div>

                  {/* Message text */}
                  <p className="text-sm leading-relaxed line-clamp-3">
                    {msg.text || '(no text)'}
                  </p>

                  {/* Signal details */}
                  {msg.analysis && msg.analysis.category !== 'OTHER' && (
                    <div className="flex flex-wrap gap-1">
                      {msg.analysis.symbol && (
                        <Badge variant="secondary" className="text-xs">
                          {msg.analysis.symbol}
                        </Badge>
                      )}
                      {msg.analysis.direction && (
                        <Badge
                          className={`text-xs ${
                            msg.analysis.direction === 'BUY'
                              ? 'bg-green-500/20 text-green-500'
                              : 'bg-red-500/20 text-red-500'
                          }`}
                        >
                          {msg.analysis.direction}
                        </Badge>
                      )}
                      {msg.analysis.entryPrice && (
                        <span className="text-xs text-muted-foreground">
                          @{msg.analysis.entryPrice}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Reasoning (expandable) */}
                  {msg.analysis?.reasoning && (
                    <div className="text-xs text-muted-foreground">
                      <details>
                        <summary className="cursor-pointer hover:text-foreground">
                          Reasoning
                        </summary>
                        <p className="mt-1 text-foreground leading-relaxed">
                          {msg.analysis.reasoning}
                        </p>
                        {msg.analysis.executionError && (
                          <p className="mt-1 text-yellow-500">
                            {msg.analysis.executionError}
                          </p>
                        )}
                      </details>
                    </div>
                  )}

                  {index < messages.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
