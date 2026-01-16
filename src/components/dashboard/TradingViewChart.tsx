'use client';

import { useEffect, useRef, memo, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries, createSeriesMarkers, ISeriesMarkersPluginApi, SeriesMarker } from 'lightweight-charts';

interface Trade {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  closePrice?: number;
  openTime: string;
  closeTime?: string;
  pnl?: number;
  status: string;
}

interface TradingViewChartProps {
  symbol: string;
  trades?: Trade[];
  currency?: string;
}

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function TradingViewChartComponent({ symbol, trades = [], currency = 'USD' }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch candle data and create chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a1a1a' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#2d2d2d' },
        horzLines: { color: '#2d2d2d' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 500,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#2d2d2d',
      },
      rightPriceScale: {
        borderColor: '#2d2d2d',
      },
      crosshair: {
        mode: 1,
      },
    });

    chartRef.current = chart;

    // Create candlestick series (v4 API)
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e',
    });

    candlestickSeriesRef.current = candlestickSeries;

    // Create markers plugin
    const seriesMarkers = createSeriesMarkers(candlestickSeries, []);
    markersRef.current = seriesMarkers;

    // Fetch candle data
    fetchCandleData(symbol).then((data) => {
      if (data && data.length > 0) {
        candlestickSeries.setData(data);

        // Add trade markers
        addTradeMarkers(candlestickSeries, seriesMarkers, trades, data);

        // Fit content
        chart.timeScale().fitContent();
        setError(null);
      } else {
        setError('No data available');
      }
      setIsLoading(false);
    }).catch((err) => {
      console.error('Error fetching candle data:', err);
      setError('Failed to load chart data');
      setIsLoading(false);
    });

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [symbol]);

  // Update markers when trades change
  useEffect(() => {
    if (candlestickSeriesRef.current && markersRef.current && !isLoading) {
      // Re-fetch data to get markers
      fetchCandleData(symbol).then((data) => {
        if (data && data.length > 0) {
          addTradeMarkers(candlestickSeriesRef.current!, markersRef.current!, trades, data);
        }
      });
    }
  }, [trades, symbol, isLoading]);

  return (
    <div className="relative w-full" style={{ height: '500px' }}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="text-muted-foreground">{error}</div>
        </div>
      )}
      <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

async function fetchCandleData(symbol: string): Promise<CandlestickData[]> {
  // Map symbol to a format suitable for data fetching
  const cleanSymbol = symbol.replace('.s', '').toUpperCase();

  // Try to fetch from our API first
  try {
    const response = await fetch(`/api/candles?symbol=${cleanSymbol}&timeframe=15m&limit=500`);
    if (response.ok) {
      const data = await response.json();
      if (data.candles && data.candles.length > 0) {
        return data.candles.map((c: CandleData) => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
      }
    }
  } catch (err) {
    console.log('API candles not available, using demo data');
  }

  // Generate demo data if API not available
  return generateDemoData(cleanSymbol);
}

function generateDemoData(symbol: string): CandlestickData[] {
  const data: CandlestickData[] = [];
  const now = Math.floor(Date.now() / 1000);
  const interval = 15 * 60; // 15 minutes

  // Base prices for different symbols
  const basePrices: Record<string, number> = {
    XAUUSD: 2650,
    XAGUSD: 30,
    BTCUSD: 95000,
    EURUSD: 1.05,
    GBPUSD: 1.27,
  };

  let price = basePrices[symbol] || 100;
  const volatility = price * 0.001; // 0.1% volatility per candle

  for (let i = 500; i >= 0; i--) {
    const time = (now - i * interval) as Time;
    const change = (Math.random() - 0.5) * volatility * 2;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * volatility;
    const low = Math.min(open, close) - Math.random() * volatility;

    data.push({ time, open, high, low, close });
    price = close;
  }

  return data;
}

function addTradeMarkers(
  series: ISeriesApi<"Candlestick">,
  markersPlugin: ISeriesMarkersPluginApi<Time>,
  trades: Trade[],
  candleData: CandlestickData[]
) {
  // Clear existing price lines
  const existingLines = (series as any)._priceLines || [];
  existingLines.forEach((line: any) => {
    try {
      series.removePriceLine(line);
    } catch (e) {
      // Ignore if already removed
    }
  });
  (series as any)._priceLines = [];

  if (!trades || trades.length === 0) {
    markersPlugin.setMarkers([]);
    return;
  }

  const priceLines: any[] = [];
  const markers: SeriesMarker<Time>[] = [];

  // Helper to find nearest candle time for a given timestamp
  const findNearestCandleTime = (timestamp: string): Time | null => {
    const tradeTime = Math.floor(new Date(timestamp).getTime() / 1000);
    let nearestCandle = candleData[0];
    let minDiff = Infinity;

    for (const candle of candleData) {
      const candleTime = typeof candle.time === 'number' ? candle.time : 0;
      const diff = Math.abs(candleTime - tradeTime);
      if (diff < minDiff) {
        minDiff = diff;
        nearestCandle = candle;
      }
    }

    // Only return if within reasonable range (2 hours = 7200 seconds)
    if (minDiff < 7200 && nearestCandle) {
      return nearestCandle.time;
    }
    return null;
  };

  trades.forEach((trade) => {
    // Entry price line
    const entryLine = series.createPriceLine({
      price: trade.entryPrice,
      color: trade.direction === 'BUY' ? '#22c55e' : '#ef4444',
      lineWidth: 2,
      lineStyle: 0, // Solid
      axisLabelVisible: true,
      title: `${trade.direction} Entry`,
    });
    priceLines.push(entryLine);

    // Stop Loss line if available
    if (trade.stopLoss) {
      const slLine = series.createPriceLine({
        price: trade.stopLoss,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'SL',
      });
      priceLines.push(slLine);
    }

    // Take Profit line if available
    if (trade.takeProfit) {
      const tpLine = series.createPriceLine({
        price: trade.takeProfit,
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'TP',
      });
      priceLines.push(tpLine);
    }

    // Add entry marker on chart
    const entryTime = findNearestCandleTime(trade.openTime);
    if (entryTime) {
      markers.push({
        time: entryTime,
        position: trade.direction === 'BUY' ? 'belowBar' : 'aboveBar',
        color: trade.direction === 'BUY' ? '#22c55e' : '#ef4444',
        shape: trade.direction === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: trade.direction === 'BUY' ? 'BUY' : 'SELL',
      });
    }

    // Exit price line and marker for closed trades
    if (trade.status === 'CLOSED' && trade.closePrice) {
      const exitLine = series.createPriceLine({
        price: trade.closePrice,
        color: (trade.pnl || 0) >= 0 ? '#22c55e' : '#ef4444',
        lineWidth: 2,
        lineStyle: 1, // Dotted
        axisLabelVisible: true,
        title: `Exit ${(trade.pnl || 0) >= 0 ? '+' : ''}$${(trade.pnl || 0).toFixed(2)}`,
      });
      priceLines.push(exitLine);

      // Add exit marker on chart
      if (trade.closeTime) {
        const exitTime = findNearestCandleTime(trade.closeTime);
        if (exitTime) {
          const pnlText = (trade.pnl || 0) >= 0
            ? `+$${(trade.pnl || 0).toFixed(0)}`
            : `-$${Math.abs(trade.pnl || 0).toFixed(0)}`;
          markers.push({
            time: exitTime,
            position: trade.direction === 'BUY' ? 'aboveBar' : 'belowBar',
            color: (trade.pnl || 0) >= 0 ? '#22c55e' : '#ef4444',
            shape: 'circle',
            text: pnlText,
          });
        }
      }
    }
  });

  // Sort markers by time (required by lightweight-charts)
  markers.sort((a, b) => {
    const timeA = typeof a.time === 'number' ? a.time : 0;
    const timeB = typeof b.time === 'number' ? b.time : 0;
    return timeA - timeB;
  });

  // Set markers using the plugin API
  markersPlugin.setMarkers(markers);

  // Store references for cleanup
  (series as any)._priceLines = priceLines;
}

export const TradingViewChart = memo(TradingViewChartComponent);
