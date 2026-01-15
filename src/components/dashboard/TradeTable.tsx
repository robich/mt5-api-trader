'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Trade {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  strategy: string;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lotSize: number | null;
  openTime: string;
  closeTime?: string | null;
  closePrice?: number | null;
  pnl?: number | null;
  pnlPercent?: number | null;
  status: string;
}

interface TradeTableProps {
  trades: Trade[];
  type: 'open' | 'closed';
}

export function TradeTable({ trades, type }: TradeTableProps) {
  const formatPrice = (price: number | null | undefined, symbol: string) => {
    if (price == null) return '-';
    const decimals = symbol.includes('JPY') ? 3 : symbol.includes('XAU') ? 2 : symbol.includes('BTC') ? 2 : 5;
    return price.toFixed(decimals);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No {type} trades
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead>Strategy</TableHead>
            <TableHead className="text-right">Entry</TableHead>
            <TableHead className="text-right">SL</TableHead>
            <TableHead className="text-right">TP</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead>{type === 'open' ? 'Opened' : 'Closed'}</TableHead>
            {type === 'closed' && (
              <>
                <TableHead className="text-right">Exit</TableHead>
                <TableHead className="text-right">P&L</TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => (
            <TableRow key={trade.id}>
              <TableCell className="font-medium">{trade.symbol}</TableCell>
              <TableCell>
                <Badge
                  variant={trade.direction === 'BUY' ? 'default' : 'destructive'}
                >
                  {trade.direction}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {trade.strategy.replace('_', ' ')}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatPrice(trade.entryPrice, trade.symbol)}
              </TableCell>
              <TableCell className="text-right font-mono text-red-600">
                {formatPrice(trade.stopLoss, trade.symbol)}
              </TableCell>
              <TableCell className="text-right font-mono text-green-600">
                {formatPrice(trade.takeProfit, trade.symbol)}
              </TableCell>
              <TableCell className="text-right">{trade.lotSize ?? '-'}</TableCell>
              <TableCell>
                {formatDate(type === 'open' ? trade.openTime : trade.closeTime || trade.openTime)}
              </TableCell>
              {type === 'closed' && (
                <>
                  <TableCell className="text-right font-mono">
                    {trade.closePrice ? formatPrice(trade.closePrice, trade.symbol) : '-'}
                  </TableCell>
                  <TableCell
                    className={`text-right font-bold ${
                      (trade.pnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {trade.pnl != null
                      ? `$${trade.pnl.toFixed(2)}`
                      : '-'}
                  </TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
