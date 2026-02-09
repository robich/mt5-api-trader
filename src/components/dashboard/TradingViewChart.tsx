'use client';

import { useEffect, useRef, memo } from 'react';

type Timeframe = 'M5' | 'M15' | 'H1' | 'H4' | 'D1';

interface TradingViewChartProps {
  symbol: string;
  trades?: any[];
  currency?: string;
  timeframe?: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
}

// Map our symbols to TradingView symbol format
const TV_SYMBOLS: Record<string, string> = {
  'XAUUSD.s': 'OANDA:XAUUSD',
  'XAGUSD.s': 'OANDA:XAGUSD',
  'BTCUSD': 'BINANCE:BTCUSDT',
  'ETHUSD': 'BINANCE:ETHUSDT',
};

// Map our timeframes to TradingView interval values
const TV_INTERVALS: Record<Timeframe, string> = {
  M5: '5',
  M15: '15',
  H1: '60',
  H4: '240',
  D1: 'D',
};

function TradingViewChartComponent({ symbol, timeframe = 'M15' }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);

  const tvSymbol = TV_SYMBOLS[symbol] || `OANDA:${symbol.replace(/\.s$/i, '')}`;
  const tvInterval = TV_INTERVALS[timeframe] || '15';

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous widget
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: tvInterval,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1', // candlestick
      locale: 'en',
      allow_symbol_change: true,
      support_host: 'https://www.tradingview.com',
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: true,
      calendar: false,
      hide_volume: false,
      backgroundColor: 'rgba(26, 26, 26, 1)',
      gridColor: 'rgba(45, 45, 45, 1)',
    });

    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'tradingview-widget-container__widget';
    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';

    const wrapper = document.createElement('div');
    wrapper.className = 'tradingview-widget-container';
    wrapper.style.height = '100%';
    wrapper.style.width = '100%';
    wrapper.appendChild(widgetContainer);
    wrapper.appendChild(script);

    containerRef.current.appendChild(wrapper);
    widgetRef.current = wrapper;

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [tvSymbol, tvInterval]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
    />
  );
}

export const TradingViewChart = memo(TradingViewChartComponent);
export type { Timeframe };
