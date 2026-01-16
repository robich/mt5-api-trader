'use client';

import { useEffect, useRef, memo, useState } from 'react';
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  CandlestickSeries,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitiveHoveredItem,
} from 'lightweight-charts';

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

interface TradeRect {
  startTime: number;
  endTime: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  direction: 'BUY' | 'SELL';
  pnl?: number;
  status: string;
}

// Custom renderer for drawing trade rectangles
class TradeRectRenderer implements IPrimitivePaneRenderer {
  private _rects: {
    x1: number;
    x2: number;
    y1: number;
    y2: number;
    slY?: number;
    tpY?: number;
    color: string;
    borderColor: string;
    direction: 'BUY' | 'SELL';
    isWin: boolean;
    isOpen: boolean;
  }[] = [];

  setRects(rects: typeof this._rects) {
    this._rects = rects;
  }

  draw(target: any) {
    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      const pixelRatio = scope.horizontalPixelRatio;

      for (const rect of this._rects) {
        const x1 = Math.round(rect.x1 * pixelRatio);
        const x2 = Math.round(rect.x2 * pixelRatio);
        const y1 = Math.round(rect.y1 * pixelRatio);
        const y2 = Math.round(rect.y2 * pixelRatio);
        const width = x2 - x1;
        const height = y2 - y1;

        // Draw main trade rectangle (entry to exit/current)
        ctx.fillStyle = rect.color;
        ctx.fillRect(x1, Math.min(y1, y2), Math.abs(width), Math.abs(height));

        // Draw border
        ctx.strokeStyle = rect.borderColor;
        ctx.lineWidth = 2 * pixelRatio;
        ctx.strokeRect(x1, Math.min(y1, y2), Math.abs(width), Math.abs(height));

        // Draw entry line (solid)
        const entryY = rect.direction === 'BUY' ? Math.max(y1, y2) : Math.min(y1, y2);
        ctx.strokeStyle = rect.direction === 'BUY' ? '#22c55e' : '#ef4444';
        ctx.lineWidth = 2 * pixelRatio;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x1, entryY);
        ctx.lineTo(x2, entryY);
        ctx.stroke();

        // Draw SL line (dashed red)
        if (rect.slY !== undefined) {
          const slY = Math.round(rect.slY * pixelRatio);
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 1 * pixelRatio;
          ctx.setLineDash([4 * pixelRatio, 4 * pixelRatio]);
          ctx.beginPath();
          ctx.moveTo(x1, slY);
          ctx.lineTo(x2, slY);
          ctx.stroke();
        }

        // Draw TP line (dashed green)
        if (rect.tpY !== undefined) {
          const tpY = Math.round(rect.tpY * pixelRatio);
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 1 * pixelRatio;
          ctx.setLineDash([4 * pixelRatio, 4 * pixelRatio]);
          ctx.beginPath();
          ctx.moveTo(x1, tpY);
          ctx.lineTo(x2, tpY);
          ctx.stroke();
        }

        ctx.setLineDash([]);

        // Draw direction arrow at entry
        const arrowSize = 8 * pixelRatio;
        const arrowX = x1 + 10 * pixelRatio;
        ctx.fillStyle = rect.direction === 'BUY' ? '#22c55e' : '#ef4444';
        ctx.beginPath();
        if (rect.direction === 'BUY') {
          // Up arrow
          ctx.moveTo(arrowX, entryY - arrowSize);
          ctx.lineTo(arrowX - arrowSize / 2, entryY);
          ctx.lineTo(arrowX + arrowSize / 2, entryY);
        } else {
          // Down arrow
          ctx.moveTo(arrowX, entryY + arrowSize);
          ctx.lineTo(arrowX - arrowSize / 2, entryY);
          ctx.lineTo(arrowX + arrowSize / 2, entryY);
        }
        ctx.closePath();
        ctx.fill();

        // Draw status indicator for closed trades
        if (!rect.isOpen) {
          const indicatorX = x2 - 20 * pixelRatio;
          const exitY = rect.direction === 'BUY' ? Math.min(y1, y2) : Math.max(y1, y2);
          ctx.fillStyle = rect.isWin ? '#22c55e' : '#ef4444';
          ctx.beginPath();
          ctx.arc(indicatorX, exitY, 6 * pixelRatio, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }
}

// Custom pane view for trade rectangles
class TradeRectPaneView implements IPrimitivePaneView {
  private _renderer: TradeRectRenderer;
  private _trades: TradeRect[] = [];
  private _series: ISeriesApi<"Candlestick">;

  constructor(series: ISeriesApi<"Candlestick">) {
    this._renderer = new TradeRectRenderer();
    this._series = series;
  }

  setTrades(trades: TradeRect[]) {
    this._trades = trades;
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this._renderer;
  }

  update(param: SeriesAttachedParameter<Time, "Candlestick">) {
    const timeScale = param.chart.timeScale();
    const rects: Parameters<TradeRectRenderer['setRects']>[0] = [];

    for (const trade of this._trades) {
      // Convert time to x coordinate
      const x1 = timeScale.timeToCoordinate(trade.startTime as Time);
      const x2 = timeScale.timeToCoordinate(trade.endTime as Time);

      if (x1 === null || x2 === null) continue;

      // Convert price to y coordinate
      const y1 = this._series.priceToCoordinate(trade.entryPrice);
      const y2 = this._series.priceToCoordinate(trade.exitPrice);

      if (y1 === null || y2 === null) continue;

      // SL and TP coordinates
      let slY: number | undefined;
      let tpY: number | undefined;
      if (trade.stopLoss) {
        slY = this._series.priceToCoordinate(trade.stopLoss) ?? undefined;
      }
      if (trade.takeProfit) {
        tpY = this._series.priceToCoordinate(trade.takeProfit) ?? undefined;
      }

      const isWin = (trade.pnl ?? 0) >= 0;
      const isOpen = trade.status !== 'CLOSED';

      // Color based on direction and status
      let color: string;
      let borderColor: string;
      if (isOpen) {
        // Open trade: semi-transparent based on direction
        color = trade.direction === 'BUY' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
        borderColor = trade.direction === 'BUY' ? '#22c55e' : '#ef4444';
      } else {
        // Closed trade: colored based on P&L
        color = isWin ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)';
        borderColor = isWin ? '#22c55e' : '#ef4444';
      }

      rects.push({
        x1,
        x2,
        y1,
        y2,
        slY,
        tpY,
        color,
        borderColor,
        direction: trade.direction,
        isWin,
        isOpen,
      });
    }

    this._renderer.setRects(rects);
  }
}

// Custom primitive for trade rectangles
class TradeRectPrimitive implements ISeriesPrimitive<Time> {
  private _paneView: TradeRectPaneView;
  private _series: ISeriesApi<"Candlestick">;
  private _requestUpdate?: () => void;

  constructor(series: ISeriesApi<"Candlestick">) {
    this._series = series;
    this._paneView = new TradeRectPaneView(series);
  }

  attached(param: SeriesAttachedParameter<Time, "Candlestick">) {
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this._requestUpdate = undefined;
  }

  paneViews() {
    return [this._paneView];
  }

  updateAllViews() {
    // This is called automatically
  }

  hitTest(): PrimitiveHoveredItem | null {
    return null;
  }

  setTrades(trades: TradeRect[]) {
    this._paneView.setTrades(trades);
    if (this._requestUpdate) {
      this._requestUpdate();
    }
  }

  update(param: SeriesAttachedParameter<Time, "Candlestick">) {
    this._paneView.update(param);
  }
}

function TradingViewChartComponent({ symbol, trades = [], currency = 'USD' }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const tradeRectPrimitiveRef = useRef<TradeRectPrimitive | null>(null);
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

    // Create candlestick series
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e',
    });

    candlestickSeriesRef.current = candlestickSeries;

    // Create trade rectangle primitive
    const tradeRectPrimitive = new TradeRectPrimitive(candlestickSeries);
    candlestickSeries.attachPrimitive(tradeRectPrimitive);
    tradeRectPrimitiveRef.current = tradeRectPrimitive;

    // Fetch candle data
    fetchCandleData(symbol).then((data) => {
      if (data && data.length > 0) {
        candlestickSeries.setData(data);

        // Add trade rectangles
        const tradeRects = convertTradesToRects(trades, data);
        tradeRectPrimitive.setTrades(tradeRects);

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

  // Update rectangles when trades change
  useEffect(() => {
    if (candlestickSeriesRef.current && tradeRectPrimitiveRef.current && !isLoading) {
      fetchCandleData(symbol).then((data) => {
        if (data && data.length > 0) {
          const tradeRects = convertTradesToRects(trades, data);
          tradeRectPrimitiveRef.current!.setTrades(tradeRects);
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

function convertTradesToRects(trades: Trade[], candleData: CandlestickData[]): TradeRect[] {
  console.log('[Chart] convertTradesToRects called with', trades.length, 'trades and', candleData.length, 'candles');

  if (!trades || trades.length === 0 || !candleData || candleData.length === 0) {
    console.log('[Chart] Early return - no trades or candles');
    return [];
  }

  const rects: TradeRect[] = [];
  const now = Math.floor(Date.now() / 1000);
  const lastCandleTime = typeof candleData[candleData.length - 1].time === 'number'
    ? candleData[candleData.length - 1].time as number
    : now;
  const firstCandleTime = typeof candleData[0].time === 'number'
    ? candleData[0].time as number
    : 0;

  console.log('[Chart] Candle range:', new Date(firstCandleTime * 1000).toISOString(), 'to', new Date(lastCandleTime * 1000).toISOString());

  // Helper to find nearest candle time
  const findNearestCandleTime = (timestamp: string, tradeId: string): number | null => {
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

    console.log(`[Chart] Trade ${tradeId}: openTime=${timestamp}, tradeTime=${new Date(tradeTime * 1000).toISOString()}, minDiff=${minDiff}s (${(minDiff/3600).toFixed(1)}h)`);

    // Only return if within reasonable range (24 hours = 86400 seconds)
    if (minDiff < 86400 && nearestCandle) {
      return typeof nearestCandle.time === 'number' ? nearestCandle.time : null;
    }
    console.log(`[Chart] Trade ${tradeId}: SKIPPED - outside 24h range`);
    return null;
  };

  for (const trade of trades) {
    console.log(`[Chart] Processing trade:`, trade.id, trade.symbol, trade.direction, trade.status);
    const startTime = findNearestCandleTime(trade.openTime, trade.id);
    if (startTime === null) continue;

    let endTime: number;
    let exitPrice: number;

    if (trade.status === 'CLOSED' && trade.closeTime && trade.closePrice) {
      const closeT = findNearestCandleTime(trade.closeTime, trade.id + '-close');
      endTime = closeT !== null ? closeT : lastCandleTime;
      exitPrice = trade.closePrice;
    } else {
      // Open trade: extend to current time and use current price estimation
      endTime = lastCandleTime;
      // For open trades, show rectangle to the last candle's close price or entry
      const lastCandle = candleData[candleData.length - 1];
      exitPrice = lastCandle.close;
    }

    console.log(`[Chart] Trade ${trade.id}: Adding rect from ${startTime} to ${endTime}, entry=${trade.entryPrice}, exit=${exitPrice}`);

    rects.push({
      startTime,
      endTime,
      entryPrice: trade.entryPrice,
      exitPrice,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      direction: trade.direction,
      pnl: trade.pnl,
      status: trade.status,
    });
  }

  console.log(`[Chart] Created ${rects.length} trade rectangles`);
  return rects;
}

async function fetchCandleData(symbol: string): Promise<CandlestickData[]> {
  // Keep the symbol exactly as provided (preserve case for broker compatibility)
  const apiSymbol = symbol;

  // Calculate date range: last 5 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 5);

  // Try to fetch from our API first
  try {
    const params = new URLSearchParams({
      symbol: apiSymbol,
      timeframe: 'M15',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
    const url = `/api/candles?${params.toString()}`;
    console.log('[Chart] Fetching candles:', url);

    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      console.log('[Chart] Received', data.count, 'candles from API');
      if (data.candles && data.candles.length > 0) {
        return data.candles.map((c: any) => ({
          time: Math.floor(new Date(c.time).getTime() / 1000) as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
      }
    } else {
      const errorText = await response.text();
      console.log('[Chart] API error:', response.status, errorText);
    }
  } catch (err) {
    console.log('[Chart] API candles not available, using demo data:', err);
  }

  // Generate demo data if API not available
  console.log('[Chart] Falling back to demo data for', apiSymbol);
  return generateDemoData(apiSymbol);
}

function generateDemoData(symbol: string): CandlestickData[] {
  const data: CandlestickData[] = [];
  const now = Math.floor(Date.now() / 1000);
  const interval = 15 * 60; // 15 minutes

  // Base prices for different symbols (including broker-specific variants)
  const basePrices: Record<string, number> = {
    XAUUSD: 2650,
    'XAUUSD.s': 2650,
    XAGUSD: 30,
    'XAGUSD.s': 90, // Broker-specific pricing
    BTCUSD: 95000,
    EURUSD: 1.05,
    GBPUSD: 1.27,
  };

  // Normalize symbol for lookup (try exact match first, then without suffix)
  let price = basePrices[symbol] || basePrices[symbol.replace(/\.s$/i, '')] || 100;
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

export const TradingViewChart = memo(TradingViewChartComponent);
