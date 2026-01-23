'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  CandlestickSeries,
  IPriceLine,
  MouseEventParams,
} from 'lightweight-charts';
import { Badge } from '@/components/ui/badge';

interface InteractiveTradeChartProps {
  symbol: string;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  direction: 'BUY' | 'SELL';
  onPriceChange: (type: 'entry' | 'sl' | 'tp', price: number) => void;
}

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export default function InteractiveTradeChart({
  symbol,
  entryPrice,
  stopLoss,
  takeProfit,
  direction,
  onPriceChange,
}: InteractiveTradeChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentBid, setCurrentBid] = useState<number | null>(null);
  const [currentAsk, setCurrentAsk] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<'entry' | 'sl' | 'tp' | null>(null);

  // Price lines refs
  const entryLineRef = useRef<IPriceLine | null>(null);
  const slLineRef = useRef<IPriceLine | null>(null);
  const tpLineRef = useRef<IPriceLine | null>(null);

  // Fetch M1 candle data and update bid/ask
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const data = await fetchM1CandleData(symbol);

        if (data && data.length > 0) {
          // Get latest candle for bid/ask simulation
          const lastCandle = data[data.length - 1];
          const spread = lastCandle.close * 0.0001; // 0.01% spread
          setCurrentBid(lastCandle.close - spread / 2);
          setCurrentAsk(lastCandle.close + spread / 2);

          // Create or update chart
          if (!chartRef.current && chartContainerRef.current) {
            createChartInstance(data);
          } else if (candlestickSeriesRef.current) {
            candlestickSeriesRef.current.setData(data);
            chartRef.current?.timeScale().fitContent();
          }

          setError(null);
        } else {
          setError('No data available');
        }
      } catch (err) {
        console.error('Error fetching M1 data:', err);
        setError('Failed to load chart data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    // Refresh every 5 seconds for M1 data
    const interval = setInterval(fetchData, 5000);

    return () => clearInterval(interval);
  }, [symbol]);

  // Create chart instance
  const createChartInstance = (data: CandlestickData[]) => {
    if (!chartContainerRef.current) return;

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
      height: 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
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

    // Create candlestick series
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e',
    });

    candlestickSeries.setData(data);
    candlestickSeriesRef.current = candlestickSeries;

    // Fit content
    chart.timeScale().fitContent();

    // Add mouse event handlers for dragging
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (!isDragging || !param.seriesData || !candlestickSeriesRef.current) return;

      const seriesData = param.seriesData.get(candlestickSeriesRef.current);
      if (!seriesData) return;

      const price = (seriesData as any).close || param.point?.y;
      if (price && typeof price === 'number') {
        onPriceChange(isDragging, price);
      }
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
  };

  // Update price lines when prices change
  useEffect(() => {
    if (!candlestickSeriesRef.current) return;

    const series = candlestickSeriesRef.current;

    // Remove old lines
    if (entryLineRef.current) {
      series.removePriceLine(entryLineRef.current);
      entryLineRef.current = null;
    }
    if (slLineRef.current) {
      series.removePriceLine(slLineRef.current);
      slLineRef.current = null;
    }
    if (tpLineRef.current) {
      series.removePriceLine(tpLineRef.current);
      tpLineRef.current = null;
    }

    // Add entry line
    if (entryPrice && entryPrice > 0) {
      entryLineRef.current = series.createPriceLine({
        price: entryPrice,
        color: direction === 'BUY' ? '#22c55e' : '#ef4444',
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: 'Entry',
      });
    }

    // Add SL line
    if (stopLoss && stopLoss > 0) {
      slLineRef.current = series.createPriceLine({
        price: stopLoss,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'SL',
      });
    }

    // Add TP line
    if (takeProfit && takeProfit > 0) {
      tpLineRef.current = series.createPriceLine({
        price: takeProfit,
        color: '#22c55e',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'TP',
      });
    }
  }, [entryPrice, stopLoss, takeProfit, direction]);

  // Mouse event handlers for dragging
  const handleMouseDown = (type: 'entry' | 'sl' | 'tp') => {
    setIsDragging(type);
  };

  const handleMouseUp = () => {
    setIsDragging(null);
  };

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  return (
    <div className="space-y-2">
      {/* Current Prices Display */}
      <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
        <div className="flex gap-4">
          <div>
            <p className="text-xs text-muted-foreground">BID</p>
            <p className="text-lg font-bold text-red-500">
              {currentBid ? currentBid.toFixed(2) : '---'}
            </p>
          </div>
          <div className="w-px bg-border" />
          <div>
            <p className="text-xs text-muted-foreground">ASK</p>
            <p className="text-lg font-bold text-green-500">
              {currentAsk ? currentAsk.toFixed(2) : '---'}
            </p>
          </div>
          <div className="w-px bg-border" />
          <div>
            <p className="text-xs text-muted-foreground">SPREAD</p>
            <p className="text-sm font-medium">
              {currentBid && currentAsk
                ? ((currentAsk - currentBid).toFixed(2))
                : '---'}
            </p>
          </div>
        </div>
        <Badge variant="outline" className="text-xs">
          M1 (1 Min)
        </Badge>
      </div>

      {/* Drag Instructions */}
      <div className="text-xs text-muted-foreground text-center py-1">
        💡 Click on Entry/SL/TP buttons below, then click on the chart to set price
      </div>

      {/* Chart Container */}
      <div className="relative w-full bg-[#1a1a1a] rounded-lg overflow-hidden" style={{ height: '400px' }}>
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

      {/* Price Line Controls */}
      <div className="flex gap-2 justify-center">
        <button
          onMouseDown={() => handleMouseDown('entry')}
          className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
            isDragging === 'entry'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted hover:bg-muted/80'
          }`}
        >
          {isDragging === 'entry' ? 'Click on chart...' : 'Set Entry'}
        </button>
        <button
          onMouseDown={() => handleMouseDown('sl')}
          className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
            isDragging === 'sl'
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-muted hover:bg-muted/80'
          }`}
        >
          {isDragging === 'sl' ? 'Click on chart...' : 'Set Stop Loss'}
        </button>
        <button
          onMouseDown={() => handleMouseDown('tp')}
          className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
            isDragging === 'tp'
              ? 'bg-green-600 text-white'
              : 'bg-muted hover:bg-muted/80'
          }`}
        >
          {isDragging === 'tp' ? 'Click on chart...' : 'Set Take Profit'}
        </button>
        {isDragging && (
          <button
            onClick={handleMouseUp}
            className="px-3 py-1 text-xs font-medium rounded bg-muted hover:bg-muted/80"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Use Current Prices */}
      {currentBid && currentAsk && (
        <div className="flex gap-2 justify-center pt-2">
          <button
            onClick={() => onPriceChange('entry', currentAsk)}
            className="px-3 py-1 text-xs font-medium rounded bg-green-600/20 hover:bg-green-600/30 text-green-500"
          >
            Buy @ {currentAsk.toFixed(2)}
          </button>
          <button
            onClick={() => onPriceChange('entry', currentBid)}
            className="px-3 py-1 text-xs font-medium rounded bg-red-600/20 hover:bg-red-600/30 text-red-500"
          >
            Sell @ {currentBid.toFixed(2)}
          </button>
        </div>
      )}
    </div>
  );
}

// Fetch M1 candle data
async function fetchM1CandleData(symbol: string): Promise<CandlestickData[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setHours(startDate.getHours() - 4); // Last 4 hours for M1

  try {
    const params = new URLSearchParams({
      symbol,
      timeframe: 'M1',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    const url = `/api/candles?${params.toString()}`;
    console.log('[InteractiveChart] Fetching M1 candles:', url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const text = await response.text();
      if (text && text.trim()) {
        const data = JSON.parse(text);
        console.log('[InteractiveChart] Received', data.count, 'M1 candles');

        if (data.candles && data.candles.length > 0) {
          const candles = data.candles
            .map((c: any) => ({
              time: Math.floor(new Date(c.time).getTime() / 1000) as Time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            }))
            .sort((a: CandlestickData, b: CandlestickData) =>
              (a.time as number) - (b.time as number)
            )
            .filter((c: CandlestickData, i: number, arr: CandlestickData[]) =>
              i === 0 || (c.time as number) !== (arr[i - 1].time as number)
            );

          if (candles.length > 0) {
            return candles;
          }
        }
      }
    }
  } catch (err: any) {
    console.log('[InteractiveChart] API error, using demo data:', err.message);
  }

  // Fallback to demo data
  return generateDemoM1Data(symbol);
}

// Generate demo M1 data
function generateDemoM1Data(symbol: string): CandlestickData[] {
  const data: CandlestickData[] = [];
  const now = Math.floor(Date.now() / 1000);
  const interval = 60; // 1 minute

  // Base prices
  const basePrices: Record<string, number> = {
    XAUUSD: 2650,
    'XAUUSD.s': 2650,
    XAGUSD: 30,
    'XAGUSD.s': 90,
    BTCUSD: 95000,
    ETHUSD: 3500,
    EURUSD: 1.05,
    GBPUSD: 1.27,
    USDJPY: 150,
  };

  let price = basePrices[symbol] || basePrices[symbol.replace(/\.s$/i, '')] || 100;
  const volatility = price * 0.0002; // 0.02% volatility per minute

  // Generate last 4 hours (240 candles)
  for (let i = 240; i >= 0; i--) {
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
