'use client';

import { useEffect, useRef, memo, useState } from 'react';

interface Trade {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  closePrice?: number;
  openTime: string;
  closeTime?: string;
  pnl?: number;
  status: string;
}

interface TradingViewChartProps {
  symbol: string;
  trades?: Trade[];
}

function TradingViewChartComponent({ symbol, trades = [] }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerId] = useState(() => `tradingview_${Math.random().toString(36).substring(7)}`);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous widget
    containerRef.current.innerHTML = '';

    // Map symbol to TradingView format
    const tvSymbol = mapSymbolToTV(symbol);

    // Create widget container with explicit dimensions
    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'tradingview-widget-container';
    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';
    widgetContainer.style.position = 'relative';

    const widgetDiv = document.createElement('div');
    widgetDiv.id = containerId;
    widgetDiv.style.height = '100%';
    widgetDiv.style.width = '100%';
    widgetDiv.style.position = 'absolute';
    widgetDiv.style.top = '0';
    widgetDiv.style.left = '0';

    widgetContainer.appendChild(widgetDiv);
    containerRef.current.appendChild(widgetContainer);

    // Create TradingView widget script after container is in DOM
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: '15',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      toolbar_bg: '#f1f3f6',
      enable_publishing: false,
      withdateranges: true,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      watchlist: ['OANDA:XAUUSD', 'OANDA:XAGUSD', 'BITSTAMP:BTCUSD'],
      details: true,
      hotlist: false,
      calendar: false,
      studies: ['MASimple@tv-basicstudies', 'RSI@tv-basicstudies'],
      container_id: containerId,
      show_popup_button: true,
      popup_width: '1000',
      popup_height: '650',
    });

    // Append script to widget container (must be inside the container for TradingView)
    widgetContainer.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol, containerId]);

  // Render trade overlays
  const renderTradeOverlays = () => {
    const closedTrades = trades.filter((t) => t.status === 'CLOSED' && t.closePrice);

    return (
      <div className="absolute top-2 right-2 z-10 bg-background/80 backdrop-blur p-2 rounded-lg max-w-xs">
        <div className="text-xs font-semibold mb-2">Recent Trades</div>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {closedTrades.slice(0, 5).map((trade) => (
            <div
              key={trade.id}
              className={`text-xs p-1 rounded ${
                (trade.pnl || 0) >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'
              }`}
            >
              <span className="font-medium">
                {trade.direction} @ {trade.entryPrice.toFixed(2)}
              </span>
              <span className="ml-2">
                {trade.pnl !== undefined && (
                  <span className={(trade.pnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'}>
                    {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="relative w-full" style={{ height: '500px' }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
      {trades.length > 0 && renderTradeOverlays()}
    </div>
  );
}

function mapSymbolToTV(symbol: string): string {
  const mapping: Record<string, string> = {
    XAUUSD: 'OANDA:XAUUSD',
    XAGUSD: 'OANDA:XAGUSD',
    BTCUSD: 'BITSTAMP:BTCUSD',
    EURUSD: 'OANDA:EURUSD',
    GBPUSD: 'OANDA:GBPUSD',
    USDJPY: 'OANDA:USDJPY',
  };

  return mapping[symbol] || `OANDA:${symbol}`;
}

export const TradingViewChart = memo(TradingViewChartComponent);
