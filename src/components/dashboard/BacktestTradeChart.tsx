'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, Loader2 } from 'lucide-react';

const formatNumber = (num: number, decimals = 2) => {
  const fixed = num.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return decPart ? `${formatted}.${decPart}` : formatted;
};

const formatEUR = (num: number, decimals = 2) => `${formatNumber(num, decimals)} €`;

interface BacktestTrade {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  entryTime: Date | string;
  exitTime: Date | string;
  pnl: number;
  pnlPercent: number;
  isWinner: boolean;
  exitReason: 'TP' | 'SL' | 'SIGNAL';
}

interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface BacktestTradeChartProps {
  trades: BacktestTrade[];
  equityCurve?: { date: string; equity: number }[];
  symbol: string;
}

type TimeframeOption = 'M5' | 'M15' | 'H1' | 'H4';

const TIMEFRAME_OPTIONS: { value: TimeframeOption; label: string }[] = [
  { value: 'M5', label: '5 min' },
  { value: 'M15', label: '15 min' },
  { value: 'H1', label: '1 hour' },
  { value: 'H4', label: '4 hours' },
];

const CHART_HEIGHT = 500;
const PRICE_AXIS_WIDTH = 80;
const TIME_AXIS_HEIGHT = 30;
const MIN_CANDLE_WIDTH = 3;
const MAX_CANDLE_WIDTH = 30;

export function BacktestTradeChart({ trades, symbol }: BacktestTradeChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [timeframe, setTimeframe] = useState<TimeframeOption>('H1');
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // View state
  const [viewOffset, setViewOffset] = useState(0); // Index offset from the end
  const [candleWidth, setCandleWidth] = useState(8);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartOffset, setDragStartOffset] = useState(0);

  // Hover state
  const [hoveredCandle, setHoveredCandle] = useState<CandleData | null>(null);
  const [hoveredTrade, setHoveredTrade] = useState<BacktestTrade | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Get date range from trades
  const dateRange = useMemo(() => {
    if (trades.length === 0) return null;
    const times = trades.flatMap(t => [
      new Date(t.entryTime).getTime(),
      new Date(t.exitTime).getTime()
    ]);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    // Add some padding
    const padding = (maxTime - minTime) * 0.1;
    return {
      start: new Date(minTime - padding),
      end: new Date(maxTime + padding),
    };
  }, [trades]);

  // Generate synthetic candles from trade data as fallback
  const generateSyntheticCandles = useCallback(() => {
    if (trades.length === 0 || !dateRange) {
      setCandles([]);
      return;
    }

    const sortedTrades = [...trades].sort(
      (a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime()
    );

    // Create price points from trades
    const pricePoints: { time: number; price: number }[] = [];
    sortedTrades.forEach((trade) => {
      const entryTime = new Date(trade.entryTime).getTime();
      const exitTime = new Date(trade.exitTime).getTime();
      pricePoints.push(
        { time: entryTime, price: trade.entryPrice },
        { time: exitTime, price: trade.exitPrice },
        { time: entryTime, price: trade.stopLoss },
        { time: entryTime, price: trade.takeProfit }
      );
    });

    // Determine interval based on timeframe
    const intervals: Record<TimeframeOption, number> = {
      'M5': 5 * 60 * 1000,
      'M15': 15 * 60 * 1000,
      'H1': 60 * 60 * 1000,
      'H4': 4 * 60 * 60 * 1000,
    };
    const interval = intervals[timeframe];

    const minTime = dateRange.start.getTime();
    const maxTime = dateRange.end.getTime();
    const numCandles = Math.ceil((maxTime - minTime) / interval);

    const syntheticCandles: CandleData[] = [];
    let lastClose = pricePoints[0]?.price || 0;

    for (let i = 0; i < numCandles; i++) {
      const candleStart = minTime + i * interval;
      const candleEnd = candleStart + interval;

      const candlePrices = pricePoints.filter(
        (p) => p.time >= candleStart && p.time < candleEnd
      );

      let open = lastClose;
      let close = lastClose;
      let high = lastClose;
      let low = lastClose;

      if (candlePrices.length > 0) {
        const prices = candlePrices.map((p) => p.price);
        open = candlePrices[0].price;
        close = candlePrices[candlePrices.length - 1].price;
        high = Math.max(...prices, open, close);
        low = Math.min(...prices, open, close);
      }

      // Add small variation
      const variation = (high - low) * 0.05 || lastClose * 0.0005;
      if (high === low) {
        high += variation;
        low -= variation;
      }

      syntheticCandles.push({
        time: new Date(candleStart).toISOString(),
        open,
        high,
        low,
        close,
      });

      lastClose = close;
    }

    setCandles(syntheticCandles);
  }, [trades, dateRange, timeframe]);

  // Fetch candles when timeframe or date range changes
  useEffect(() => {
    if (!dateRange) return;

    const fetchCandles = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          symbol,
          timeframe,
          startDate: dateRange.start.toISOString(),
          endDate: dateRange.end.toISOString(),
        });

        const response = await fetch(`/api/candles?${params}`);
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to fetch candles');
        }

        const data = await response.json();
        setCandles(data.candles);
        // Reset view to show the end of data
        setViewOffset(0);
      } catch (err: any) {
        setError(err.message);
        // Generate synthetic candles as fallback
        generateSyntheticCandles();
      } finally {
        setLoading(false);
      }
    };

    fetchCandles();
  }, [symbol, timeframe, dateRange, generateSyntheticCandles]);

  // Calculate visible candles and price range
  const { visibleCandles, priceRange, chartWidth } = useMemo(() => {
    if (candles.length === 0) {
      return { visibleCandles: [], priceRange: { min: 0, max: 100 }, chartWidth: 800 };
    }

    const containerWidth = containerRef.current?.clientWidth || 800;
    const chartArea = containerWidth - PRICE_AXIS_WIDTH;
    const visibleCount = Math.floor(chartArea / candleWidth);

    // Calculate start and end indices
    const endIndex = Math.max(0, candles.length - viewOffset);
    const startIndex = Math.max(0, endIndex - visibleCount);

    const visible = candles.slice(startIndex, endIndex);

    // Calculate price range from visible candles and any visible trades
    const allPrices = visible.flatMap(c => [c.high, c.low]);

    // Add trade prices if they're in the visible range
    const visibleStartTime = visible[0]?.time ? new Date(visible[0].time).getTime() : 0;
    const visibleEndTime = visible[visible.length - 1]?.time
      ? new Date(visible[visible.length - 1].time).getTime()
      : Date.now();

    trades.forEach(trade => {
      const entryTime = new Date(trade.entryTime).getTime();
      const exitTime = new Date(trade.exitTime).getTime();
      if (entryTime <= visibleEndTime && exitTime >= visibleStartTime) {
        allPrices.push(trade.entryPrice, trade.exitPrice, trade.stopLoss, trade.takeProfit);
      }
    });

    if (allPrices.length === 0) {
      return { visibleCandles: visible, priceRange: { min: 0, max: 100 }, chartWidth: chartArea };
    }

    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const padding = (max - min) * 0.1;

    return {
      visibleCandles: visible,
      priceRange: { min: min - padding, max: max + padding },
      chartWidth: chartArea,
    };
  }, [candles, viewOffset, candleWidth, trades]);

  // Map trades to visible area
  const visibleTrades = useMemo(() => {
    if (visibleCandles.length === 0) return [];

    const startTime = new Date(visibleCandles[0].time).getTime();
    const endTime = new Date(visibleCandles[visibleCandles.length - 1].time).getTime();

    return trades.filter(trade => {
      const entryTime = new Date(trade.entryTime).getTime();
      const exitTime = new Date(trade.exitTime).getTime();
      return entryTime <= endTime && exitTime >= startTime;
    });
  }, [trades, visibleCandles]);

  // Price to Y coordinate
  const priceToY = useCallback((price: number) => {
    const { min, max } = priceRange;
    const chartHeight = CHART_HEIGHT - TIME_AXIS_HEIGHT;
    return chartHeight - ((price - min) / (max - min)) * chartHeight;
  }, [priceRange]);

  // Time to X coordinate
  const timeToX = useCallback((time: Date | string) => {
    if (visibleCandles.length === 0) return 0;

    const targetTime = new Date(time).getTime();
    const startTime = new Date(visibleCandles[0].time).getTime();
    const endTime = new Date(visibleCandles[visibleCandles.length - 1].time).getTime();

    if (endTime === startTime) return chartWidth / 2;

    const ratio = (targetTime - startTime) / (endTime - startTime);
    return ratio * chartWidth;
  }, [visibleCandles, chartWidth]);

  // Draw the chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const dpr = window.devicePixelRatio || 1;
    const containerWidth = containerRef.current?.clientWidth || 800;
    canvas.width = containerWidth * dpr;
    canvas.height = CHART_HEIGHT * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${CHART_HEIGHT}px`;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, containerWidth, CHART_HEIGHT);

    // Draw grid
    ctx.strokeStyle = '#1f1f1f';
    ctx.lineWidth = 1;

    // Horizontal grid lines
    const chartHeight = CHART_HEIGHT - TIME_AXIS_HEIGHT;
    const numPriceLines = 6;
    for (let i = 0; i <= numPriceLines; i++) {
      const y = (i / numPriceLines) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartWidth, y);
      ctx.stroke();
    }

    // Vertical grid lines (every N candles)
    const gridInterval = Math.max(1, Math.floor(visibleCandles.length / 8));
    visibleCandles.forEach((_, i) => {
      if (i % gridInterval === 0) {
        const x = (i / visibleCandles.length) * chartWidth;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, chartHeight);
        ctx.stroke();
      }
    });

    // Draw trade rectangles FIRST (behind candles)
    visibleTrades.forEach(trade => {
      const x1 = timeToX(trade.entryTime);
      const x2 = timeToX(trade.exitTime);
      const y1 = priceToY(Math.max(trade.entryPrice, trade.exitPrice, trade.takeProfit));
      const y2 = priceToY(Math.min(trade.entryPrice, trade.exitPrice, trade.stopLoss));

      // Trade rectangle
      ctx.fillStyle = trade.isWinner ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

      // Trade border
      ctx.strokeStyle = trade.isWinner ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      // Entry line
      const entryY = priceToY(trade.entryPrice);
      ctx.strokeStyle = trade.direction === 'BUY' ? '#3b82f6' : '#f97316';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, entryY);
      ctx.lineTo(x2, entryY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Stop loss line
      const slY = priceToY(trade.stopLoss);
      ctx.strokeStyle = '#ef4444';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x1, slY);
      ctx.lineTo(x2, slY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Take profit line
      const tpY = priceToY(trade.takeProfit);
      ctx.strokeStyle = '#22c55e';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x1, tpY);
      ctx.lineTo(x2, tpY);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Draw candlesticks
    const candleSpacing = chartWidth / visibleCandles.length;
    const bodyWidth = Math.max(1, candleWidth * 0.8);

    visibleCandles.forEach((candle, i) => {
      const x = i * candleSpacing + candleSpacing / 2;
      const isGreen = candle.close >= candle.open;

      const openY = priceToY(candle.open);
      const closeY = priceToY(candle.close);
      const highY = priceToY(candle.high);
      const lowY = priceToY(candle.low);

      // Wick
      ctx.strokeStyle = isGreen ? '#22c55e' : '#ef4444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body
      ctx.fillStyle = isGreen ? '#22c55e' : '#ef4444';
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(Math.abs(closeY - openY), 1);
      ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
    });

    // Draw price axis
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(chartWidth, 0, PRICE_AXIS_WIDTH, CHART_HEIGHT);

    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';

    for (let i = 0; i <= numPriceLines; i++) {
      const y = (i / numPriceLines) * chartHeight;
      const price = priceRange.max - (i / numPriceLines) * (priceRange.max - priceRange.min);
      ctx.fillText(formatNumber(price), chartWidth + 5, y + 4);
    }

    // Draw time axis
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, chartHeight, containerWidth, TIME_AXIS_HEIGHT);

    ctx.fillStyle = '#888';
    ctx.textAlign = 'center';

    const timeInterval = Math.max(1, Math.floor(visibleCandles.length / 6));
    visibleCandles.forEach((candle, i) => {
      if (i % timeInterval === 0) {
        const x = (i / visibleCandles.length) * chartWidth;
        const date = new Date(candle.time);
        const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        ctx.fillText(timeStr, x, chartHeight + 12);
        ctx.fillText(dateStr, x, chartHeight + 24);
      }
    });

    // Draw crosshair if hovering
    if (hoveredCandle) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(mousePos.x, 0);
      ctx.lineTo(mousePos.x, chartHeight);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, mousePos.y);
      ctx.lineTo(chartWidth, mousePos.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

  }, [visibleCandles, visibleTrades, priceRange, chartWidth, candleWidth, priceToY, timeToX, hoveredCandle, mousePos]);

  // Handle mouse events
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || visibleCandles.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setMousePos({ x, y });

    // Find hovered candle
    const candleSpacing = chartWidth / visibleCandles.length;
    const candleIndex = Math.floor(x / candleSpacing);
    if (candleIndex >= 0 && candleIndex < visibleCandles.length) {
      setHoveredCandle(visibleCandles[candleIndex]);
    } else {
      setHoveredCandle(null);
    }

    // Find hovered trade
    const chartHeight = CHART_HEIGHT - TIME_AXIS_HEIGHT;
    const price = priceRange.max - (y / chartHeight) * (priceRange.max - priceRange.min);

    const hovered = visibleTrades.find(trade => {
      const x1 = timeToX(trade.entryTime);
      const x2 = timeToX(trade.exitTime);
      const minPrice = Math.min(trade.entryPrice, trade.exitPrice, trade.stopLoss);
      const maxPrice = Math.max(trade.entryPrice, trade.exitPrice, trade.takeProfit);
      return x >= x1 && x <= x2 && price >= minPrice && price <= maxPrice;
    });
    setHoveredTrade(hovered || null);

    // Handle dragging
    if (isDragging) {
      const dx = e.clientX - dragStartX;
      const candlesMoved = Math.round(dx / candleWidth);
      const newOffset = Math.max(0, Math.min(candles.length - 10, dragStartOffset + candlesMoved));
      setViewOffset(newOffset);
    }
  }, [visibleCandles, visibleTrades, chartWidth, candleWidth, isDragging, dragStartX, dragStartOffset, priceRange, timeToX, candles.length]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStartX(e.clientX);
    setDragStartOffset(viewOffset);
  }, [viewOffset]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredCandle(null);
    setHoveredTrade(null);
    setIsDragging(false);
  }, []);

  // Handle wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    setCandleWidth(prev => Math.max(MIN_CANDLE_WIDTH, Math.min(MAX_CANDLE_WIDTH, prev + delta)));
  }, []);

  // Navigation handlers
  const panLeft = useCallback(() => {
    setViewOffset(prev => Math.min(candles.length - 10, prev + Math.floor(20 / (candleWidth / 8))));
  }, [candles.length, candleWidth]);

  const panRight = useCallback(() => {
    setViewOffset(prev => Math.max(0, prev - Math.floor(20 / (candleWidth / 8))));
  }, [candleWidth]);

  const zoomIn = useCallback(() => {
    setCandleWidth(prev => Math.min(MAX_CANDLE_WIDTH, prev + 2));
  }, []);

  const zoomOut = useCallback(() => {
    setCandleWidth(prev => Math.max(MIN_CANDLE_WIDTH, prev - 2));
  }, []);

  const resetView = useCallback(() => {
    setViewOffset(0);
    setCandleWidth(8);
  }, []);

  if (trades.length === 0) {
    return (
      <div className="h-[500px] flex items-center justify-center text-muted-foreground">
        No trades to display
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Select value={timeframe} onValueChange={(v) => setTimeframe(v as TimeframeOption)}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEFRAME_OPTIONS.map((tf) => (
                <SelectItem key={tf.value} value={tf.value}>
                  {tf.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="font-mono">
            {symbol}
          </Badge>
          {loading && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading...
            </Badge>
          )}
          {error && (
            <Badge variant="destructive" className="text-xs">
              Using synthetic data
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={panLeft} title="Pan left">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={panRight} title="Pan right">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border mx-1" />
          <Button variant="outline" size="icon" onClick={zoomOut} title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground w-12 text-center">
            {Math.round((candleWidth / 8) * 100)}%
          </span>
          <Button variant="outline" size="icon" onClick={zoomIn} title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border mx-1" />
          <Button variant="outline" size="icon" onClick={resetView} title="Reset view">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Chart */}
      <div
        ref={containerRef}
        className="relative border rounded-lg overflow-hidden bg-[#0a0a0a]"
        style={{ height: CHART_HEIGHT }}
      >
        <canvas
          ref={canvasRef}
          className="cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
        />

        {/* Tooltip */}
        {(hoveredCandle || hoveredTrade) && (
          <div
            className="absolute bg-background/95 border rounded-lg p-3 shadow-lg text-xs pointer-events-none z-10"
            style={{
              left: Math.min(mousePos.x + 10, (containerRef.current?.clientWidth || 800) - 200),
              top: Math.min(mousePos.y + 10, CHART_HEIGHT - 150),
            }}
          >
            {hoveredCandle && (
              <div className="space-y-1">
                <div className="font-semibold text-sm">
                  {new Date(hoveredCandle.time).toLocaleString()}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
                  <span className="text-muted-foreground">O:</span>
                  <span>{formatNumber(hoveredCandle.open)}</span>
                  <span className="text-muted-foreground">H:</span>
                  <span className="text-green-500">{formatNumber(hoveredCandle.high)}</span>
                  <span className="text-muted-foreground">L:</span>
                  <span className="text-red-500">{formatNumber(hoveredCandle.low)}</span>
                  <span className="text-muted-foreground">C:</span>
                  <span>{formatNumber(hoveredCandle.close)}</span>
                </div>
              </div>
            )}
            {hoveredTrade && (
              <div className={`mt-2 pt-2 border-t space-y-1 ${hoveredTrade.isWinner ? 'text-green-500' : 'text-red-500'}`}>
                <div className="flex items-center gap-2">
                  <Badge variant={hoveredTrade.direction === 'BUY' ? 'default' : 'destructive'} className="text-[10px]">
                    {hoveredTrade.direction}
                  </Badge>
                  <Badge variant={hoveredTrade.isWinner ? 'default' : 'destructive'} className="text-[10px]">
                    {hoveredTrade.exitReason}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-foreground">
                  <span className="text-muted-foreground">Entry:</span>
                  <span>{formatNumber(hoveredTrade.entryPrice)}</span>
                  <span className="text-muted-foreground">Exit:</span>
                  <span>{formatNumber(hoveredTrade.exitPrice)}</span>
                  <span className="text-muted-foreground">SL:</span>
                  <span className="text-red-500">{formatNumber(hoveredTrade.stopLoss)}</span>
                  <span className="text-muted-foreground">TP:</span>
                  <span className="text-green-500">{formatNumber(hoveredTrade.takeProfit)}</span>
                </div>
                <div className={`font-bold ${hoveredTrade.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  P&L: {hoveredTrade.pnl >= 0 ? '+' : ''}{formatEUR(hoveredTrade.pnl)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-500/20 border border-green-500 rounded" />
          <span>Winning Trade</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-500/20 border border-red-500 rounded" />
          <span>Losing Trade</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-1 bg-blue-500" />
          <span>BUY Entry</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-1 bg-orange-500" />
          <span>SELL Entry</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-red-500" style={{ borderTop: '2px dashed' }} />
          <span>Stop Loss</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-green-500" style={{ borderTop: '2px dashed' }} />
          <span>Take Profit</span>
        </div>
      </div>

      {/* Trade summary by day */}
      <div className="space-y-3 mt-6">
        <h4 className="font-semibold text-sm">Trade Summary</h4>
        {(() => {
          const tradesByDay = trades.reduce((acc, trade) => {
            const date = new Date(trade.entryTime).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            });
            if (!acc[date]) acc[date] = [];
            acc[date].push(trade);
            return acc;
          }, {} as Record<string, BacktestTrade[]>);

          return Object.entries(tradesByDay).map(([day, dayTrades]) => {
            const dayPnl = dayTrades.reduce((sum, t) => sum + t.pnl, 0);
            const dayWins = dayTrades.filter(t => t.pnl >= 0).length;

            return (
              <div key={day} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{day}</span>
                    <span className="text-xs text-muted-foreground">
                      ({dayTrades.length} trade{dayTrades.length !== 1 ? 's' : ''})
                    </span>
                    <span className="text-xs">
                      <span className="text-green-500">{dayWins}W</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-red-500">{dayTrades.length - dayWins}L</span>
                    </span>
                  </div>
                  <span className={`font-bold text-sm ${dayPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {dayPnl >= 0 ? '+' : ''}{formatEUR(dayPnl)}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {dayTrades.map((trade, idx) => {
                    const entryTime = new Date(trade.entryTime).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    });
                    const exitTime = new Date(trade.exitTime).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    });

                    return (
                      <div
                        key={idx}
                        className={`p-2 rounded-lg border text-xs ${
                          trade.isWinner
                            ? 'bg-green-500/10 border-green-500/30'
                            : 'bg-red-500/10 border-red-500/30'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {entryTime} → {exitTime}
                          </span>
                          <span className={trade.isWinner ? 'text-green-500' : 'text-red-500'}>
                            {trade.exitReason}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`font-semibold ${trade.direction === 'BUY' ? 'text-blue-500' : 'text-orange-500'}`}>
                            {trade.direction}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {formatNumber(trade.entryPrice)} → {formatNumber(trade.exitPrice)}
                          </span>
                        </div>
                        <div className={`font-semibold mt-1 ${trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {trade.pnl >= 0 ? '+' : ''}{formatEUR(trade.pnl)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}
