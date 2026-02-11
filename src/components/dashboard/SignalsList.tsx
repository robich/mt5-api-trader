'use client';

import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface Signal {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  strategy: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  status: string;
  reason?: string;
  htfBias: string;
  createdAt: string;
}

interface SignalsListProps {
  signals: Signal[];
}

export function SignalsList({ signals }: SignalsListProps) {
  const formatPrice = (price: number, symbol: string) => {
    const decimals = symbol.includes('JPY') ? 3 : symbol.includes('XAU') ? 2 : symbol.includes('BTC') ? 2 : 5;
    return price.toFixed(decimals);
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'TAKEN':
        return 'bg-green-500';
      case 'REJECTED':
        return 'bg-red-500';
      case 'EXPIRED':
        return 'bg-gray-500';
      default:
        return 'bg-yellow-500';
    }
  };

  if (signals.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No recent signals
      </div>
    );
  }

  return (
    <ScrollArea className="h-[300px] md:h-[500px] pr-4">
      <div className="space-y-4">
        {signals.map((signal, index) => (
          <div key={signal.id}>
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{signal.symbol}</span>
                  <Badge
                    variant={signal.direction === 'BUY' ? 'default' : 'destructive'}
                    className="text-xs"
                  >
                    {signal.direction}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {signal.strategy.replace('_', ' ')}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  Entry: {formatPrice(signal.entryPrice, signal.symbol)} | SL:{' '}
                  {formatPrice(signal.stopLoss, signal.symbol)} | TP:{' '}
                  {formatPrice(signal.takeProfit, signal.symbol)}
                </div>
                <div className="text-xs text-muted-foreground">
                  HTF Bias: {signal.htfBias} | Confidence: {(signal.confidence * 100).toFixed(0)}%
                </div>
                {signal.reason && (
                  <div className="text-xs text-muted-foreground italic">
                    {signal.reason}
                  </div>
                )}
              </div>
              <div className="text-right">
                <Badge
                  className={`${getStatusColor(signal.status)} text-white`}
                >
                  {signal.status}
                </Badge>
                <div className="text-xs text-muted-foreground mt-1">
                  {formatTime(signal.createdAt)}
                </div>
              </div>
            </div>
            {index < signals.length - 1 && <Separator className="mt-4" />}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
