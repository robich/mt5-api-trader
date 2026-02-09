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
import {
  identifyOrderBlocks,
  filterValidOrderBlocks,
  checkOrderBlockMitigation,
} from '@/lib/analysis/order-blocks';
import type { Candle, OrderBlock, Timeframe as OBTimeframe } from '@/lib/types';

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

type Timeframe = 'M5' | 'M15' | 'H1' | 'H4' | 'D1';

interface TradingViewChartProps {
  symbol: string;
  trades?: Trade[];
  currency?: string;
  timeframe?: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
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

interface OBRect {
  startTime: number;
  endTime: number;
  high: number;
  low: number;
  type: 'BULLISH' | 'BEARISH';
  isMitigated: boolean;
}

// ────────── Trade Rectangle Renderer ──────────

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

        ctx.fillStyle = rect.color;
        ctx.fillRect(x1, Math.min(y1, y2), Math.abs(width), Math.abs(height));

        ctx.strokeStyle = rect.borderColor;
        ctx.lineWidth = 2 * pixelRatio;
        ctx.strokeRect(x1, Math.min(y1, y2), Math.abs(width), Math.abs(height));

        const entryY = rect.direction === 'BUY' ? Math.max(y1, y2) : Math.min(y1, y2);
        ctx.strokeStyle = rect.direction === 'BUY' ? '#22c55e' : '#ef4444';
        ctx.lineWidth = 2 * pixelRatio;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x1, entryY);
        ctx.lineTo(x2, entryY);
        ctx.stroke();

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

        const arrowSize = 8 * pixelRatio;
        const arrowX = x1 + 10 * pixelRatio;
        ctx.fillStyle = rect.direction === 'BUY' ? '#22c55e' : '#ef4444';
        ctx.beginPath();
        if (rect.direction === 'BUY') {
          ctx.moveTo(arrowX, entryY - arrowSize);
          ctx.lineTo(arrowX - arrowSize / 2, entryY);
          ctx.lineTo(arrowX + arrowSize / 2, entryY);
        } else {
          ctx.moveTo(arrowX, entryY + arrowSize);
          ctx.lineTo(arrowX - arrowSize / 2, entryY);
          ctx.lineTo(arrowX + arrowSize / 2, entryY);
        }
        ctx.closePath();
        ctx.fill();

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
      const x1 = timeScale.timeToCoordinate(trade.startTime as Time);
      const x2 = timeScale.timeToCoordinate(trade.endTime as Time);
      if (x1 === null || x2 === null) continue;

      const y1 = this._series.priceToCoordinate(trade.entryPrice);
      const y2 = this._series.priceToCoordinate(trade.exitPrice);
      if (y1 === null || y2 === null) continue;

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

      let color: string;
      let borderColor: string;
      if (isOpen) {
        color = trade.direction === 'BUY' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
        borderColor = trade.direction === 'BUY' ? '#22c55e' : '#ef4444';
      } else {
        color = isWin ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)';
        borderColor = isWin ? '#22c55e' : '#ef4444';
      }

      rects.push({ x1, x2, y1, y2, slY, tpY, color, borderColor, direction: trade.direction, isWin, isOpen });
    }

    this._renderer.setRects(rects);
  }
}

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

  updateAllViews() {}

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

// ────────── Order Block Renderer ──────────

class OrderBlockRenderer implements IPrimitivePaneRenderer {
  private _rects: {
    x1: number;
    x2: number;
    y1: number;
    y2: number;
    fillColor: string;
    borderColor: string;
    isMitigated: boolean;
    label: string;
  }[] = [];

  setRects(rects: typeof this._rects) {
    this._rects = rects;
  }

  draw(target: any) {
    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      const pixelRatio = scope.horizontalPixelRatio;
      const bitmapWidth = scope.bitmapSize.width;

      for (const rect of this._rects) {
        const x1 = Math.round(rect.x1 * pixelRatio);
        // Extend to the right edge of the chart
        const x2 = bitmapWidth;
        const y1 = Math.round(rect.y1 * pixelRatio);
        const y2 = Math.round(rect.y2 * pixelRatio);
        const top = Math.min(y1, y2);
        const height = Math.abs(y2 - y1);

        // Fill
        ctx.fillStyle = rect.fillColor;
        ctx.fillRect(x1, top, x2 - x1, height);

        // Border
        ctx.strokeStyle = rect.borderColor;
        ctx.lineWidth = 1 * pixelRatio;
        if (rect.isMitigated) {
          ctx.setLineDash([4 * pixelRatio, 4 * pixelRatio]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.strokeRect(x1, top, x2 - x1, height);
        ctx.setLineDash([]);

        // Label
        const fontSize = Math.round(10 * pixelRatio);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = rect.borderColor;
        ctx.globalAlpha = rect.isMitigated ? 0.5 : 0.9;
        ctx.fillText(rect.label, x1 + 4 * pixelRatio, top + fontSize + 2 * pixelRatio);
        ctx.globalAlpha = 1;
      }
    });
  }
}

class OrderBlockPaneView implements IPrimitivePaneView {
  private _renderer: OrderBlockRenderer;
  private _obRects: OBRect[] = [];
  private _series: ISeriesApi<"Candlestick">;

  constructor(series: ISeriesApi<"Candlestick">) {
    this._renderer = new OrderBlockRenderer();
    this._series = series;
  }

  setOrderBlocks(obRects: OBRect[]) {
    this._obRects = obRects;
  }

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this._renderer;
  }

  update(param: SeriesAttachedParameter<Time, "Candlestick">) {
    const timeScale = param.chart.timeScale();
    const rects: Parameters<OrderBlockRenderer['setRects']>[0] = [];

    for (const ob of this._obRects) {
      const x1 = timeScale.timeToCoordinate(ob.startTime as Time);
      if (x1 === null) continue;

      const y1 = this._series.priceToCoordinate(ob.high);
      const y2 = this._series.priceToCoordinate(ob.low);
      if (y1 === null || y2 === null) continue;

      const isBullish = ob.type === 'BULLISH';
      const alpha = ob.isMitigated ? 0.08 : 0.18;
      const borderAlpha = ob.isMitigated ? 0.3 : 0.7;

      const fillColor = isBullish
        ? `rgba(56, 189, 248, ${alpha})`   // sky-400
        : `rgba(251, 146, 60, ${alpha})`;   // orange-400

      const borderColor = isBullish
        ? `rgba(56, 189, 248, ${borderAlpha})`
        : `rgba(251, 146, 60, ${borderAlpha})`;

      const label = `${isBullish ? 'Bull' : 'Bear'} OB`;

      rects.push({
        x1,
        x2: 0, // unused - we extend to right edge in renderer
        y1,
        y2,
        fillColor,
        borderColor,
        isMitigated: ob.isMitigated,
        label,
      });
    }

    this._renderer.setRects(rects);
  }
}

class OrderBlockPrimitive implements ISeriesPrimitive<Time> {
  private _paneView: OrderBlockPaneView;
  private _requestUpdate?: () => void;

  constructor(series: ISeriesApi<"Candlestick">) {
    this._paneView = new OrderBlockPaneView(series);
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

  updateAllViews() {}

  hitTest(): PrimitiveHoveredItem | null {
    return null;
  }

  setOrderBlocks(obRects: OBRect[]) {
    this._paneView.setOrderBlocks(obRects);
    if (this._requestUpdate) {
      this._requestUpdate();
    }
  }

  update(param: SeriesAttachedParameter<Time, "Candlestick">) {
    this._paneView.update(param);
  }
}

// ────────── Constants ──────────

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: 'M5', label: '5m' },
  { value: 'M15', label: '15m' },
  { value: 'H1', label: '1H' },
  { value: 'H4', label: '4H' },
  { value: 'D1', label: '1D' },
];

// ────────── Main Component ──────────

function TradingViewChartComponent({ symbol, trades = [], currency = 'USD', timeframe = 'M15', onTimeframeChange }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const tradeRectPrimitiveRef = useRef<TradeRectPrimitive | null>(null);
  const obPrimitiveRef = useRef<OrderBlockPrimitive | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalTimeframe, setInternalTimeframe] = useState<Timeframe>(timeframe);
  const [showOBs, setShowOBs] = useState(true);

  // Fetch candle data and create chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a1a1a' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#2d2d2d' },
        horzLines: { color: '#2d2d2d' },
      },
      width: container.clientWidth,
      height: container.clientHeight,
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

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e',
    });

    candlestickSeriesRef.current = candlestickSeries;

    // Trade rectangles primitive
    const tradeRectPrimitive = new TradeRectPrimitive(candlestickSeries);
    candlestickSeries.attachPrimitive(tradeRectPrimitive);
    tradeRectPrimitiveRef.current = tradeRectPrimitive;

    // Order block primitive
    const obPrimitive = new OrderBlockPrimitive(candlestickSeries);
    candlestickSeries.attachPrimitive(obPrimitive);
    obPrimitiveRef.current = obPrimitive;

    // Fetch candle data
    const currentTf = onTimeframeChange ? timeframe : internalTimeframe;
    fetchCandleData(symbol, currentTf).then((data) => {
      if (data && data.length > 0) {
        candlestickSeries.setData(data);

        // Trade rectangles
        const tradeRects = convertTradesToRects(trades, data);
        tradeRectPrimitive.setTrades(tradeRects);

        // Order blocks
        if (showOBs) {
          const obRects = computeOrderBlocks(data, symbol, currentTf);
          obPrimitive.setOrderBlocks(obRects);
        }

        chart.timeScale().fitContent();
        setError(null);
      } else {
        setError(`No candle data for ${symbol} (${currentTf}). MetaAPI may be disconnected.`);
      }
      setIsLoading(false);
    }).catch((err) => {
      console.error('Error fetching candle data:', err);
      setError(`Failed to load chart data: ${err.message || 'Unknown error'}`);
      setIsLoading(false);
    });

    // ResizeObserver for dynamic sizing
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          chart.applyOptions({ width, height });
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [symbol, timeframe, internalTimeframe]);

  // Update rectangles/OBs when trades or showOBs change
  useEffect(() => {
    const currentTf = onTimeframeChange ? timeframe : internalTimeframe;
    if (candlestickSeriesRef.current && tradeRectPrimitiveRef.current && obPrimitiveRef.current && !isLoading) {
      fetchCandleData(symbol, currentTf).then((data) => {
        if (data && data.length > 0) {
          const tradeRects = convertTradesToRects(trades, data);
          tradeRectPrimitiveRef.current!.setTrades(tradeRects);

          if (showOBs) {
            const obRects = computeOrderBlocks(data, symbol, currentTf);
            obPrimitiveRef.current!.setOrderBlocks(obRects);
          } else {
            obPrimitiveRef.current!.setOrderBlocks([]);
          }
        }
      });
    }
  }, [trades, symbol, isLoading, timeframe, internalTimeframe, showOBs]);

  const currentTf = onTimeframeChange ? timeframe : internalTimeframe;

  const handleTimeframeChange = (tf: Timeframe) => {
    if (onTimeframeChange) {
      onTimeframeChange(tf);
    } else {
      setInternalTimeframe(tf);
    }
  };

  return (
    <div className="relative w-full h-full">
      {/* Controls overlay */}
      <div className="absolute top-2 right-2 z-20 flex gap-2">
        {/* OB toggle */}
        <button
          onClick={() => setShowOBs(!showOBs)}
          className={`px-2 py-1 text-xs font-medium rounded transition-colors border ${
            showOBs
              ? 'bg-sky-500/20 text-sky-400 border-sky-500/50'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted border-border'
          }`}
          title="Toggle Order Blocks"
        >
          OB
        </button>

        {/* Timeframe selector */}
        <div className="flex gap-1 bg-background/90 backdrop-blur-sm rounded-md p-1 border border-border">
          {TIMEFRAMES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handleTimeframeChange(value)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                currentTf === value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* OB legend */}
      {showOBs && !isLoading && !error && (
        <div className="absolute bottom-2 left-2 z-20 flex gap-3 text-[10px] bg-background/80 backdrop-blur-sm rounded px-2 py-1 border border-border">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm" style={{ background: 'rgba(56, 189, 248, 0.4)' }} />
            Bull OB
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm" style={{ background: 'rgba(251, 146, 60, 0.4)' }} />
            Bear OB
          </span>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10 gap-2">
          <div className="text-muted-foreground text-sm">{error}</div>
          <div className="text-muted-foreground/60 text-xs">Check that the trading bot is running and MetaAPI is connected</div>
        </div>
      )}
      <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

// ────────── Order Block Computation ──────────

function computeOrderBlocks(candleData: CandlestickData[], symbol: string, tf: Timeframe): OBRect[] {
  if (candleData.length < 20) return [];

  // Convert lightweight-charts CandlestickData to the Candle format expected by order-blocks.ts
  const candles: Candle[] = candleData.map((c) => ({
    time: new Date((c.time as number) * 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: 0,
    symbol,
    timeframe: tf as OBTimeframe,
  }));

  const allOBs = identifyOrderBlocks(candles, symbol, tf as OBTimeframe, Math.min(candles.length, 100));
  const validOBs = filterValidOrderBlocks(allOBs, candles, 5);

  // Check mitigation for each OB
  const lastCandleTime = candleData[candleData.length - 1].time as number;

  return validOBs.map((ob) => {
    const obTimestamp = Math.floor(ob.candleTime.getTime() / 1000);

    // Check if mitigated by any subsequent candle
    const obIndex = candles.findIndex((c) => c.time.getTime() === ob.candleTime.getTime());
    let isMitigated = false;
    if (obIndex >= 0) {
      for (let i = obIndex + 1; i < candles.length; i++) {
        if (checkOrderBlockMitigation(ob, candles[i])) {
          isMitigated = true;
          break;
        }
      }
    }

    return {
      startTime: obTimestamp,
      endTime: lastCandleTime,
      high: ob.high,
      low: ob.low,
      type: ob.type,
      isMitigated,
    };
  });
}

// ────────── Trade Rect Conversion ──────────

function convertTradesToRects(trades: Trade[], candleData: CandlestickData[]): TradeRect[] {
  if (!trades || trades.length === 0 || !candleData || candleData.length === 0) {
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

  const isWithinRange = (timestamp: string): boolean => {
    const tradeTime = Math.floor(new Date(timestamp).getTime() / 1000);
    const buffer = 86400;
    return tradeTime >= (firstCandleTime - buffer) && tradeTime <= (lastCandleTime + buffer);
  };

  const findCandleTime = (timestamp: string): number => {
    const tradeTime = Math.floor(new Date(timestamp).getTime() / 1000);
    if (tradeTime <= firstCandleTime) return firstCandleTime;
    if (tradeTime >= lastCandleTime) return lastCandleTime;

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
    return typeof nearestCandle.time === 'number' ? nearestCandle.time : tradeTime;
  };

  for (const trade of trades) {
    if (!isWithinRange(trade.openTime)) continue;

    const startTime = findCandleTime(trade.openTime);

    let endTime: number;
    let exitPrice: number;

    if (trade.status === 'CLOSED' && trade.closeTime && trade.closePrice) {
      endTime = findCandleTime(trade.closeTime);
      exitPrice = trade.closePrice;
    } else {
      endTime = lastCandleTime;
      const lastCandle = candleData[candleData.length - 1];
      exitPrice = lastCandle.close;
    }

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

  return rects;
}

// ────────── Helpers ──────────

function getDateRangeForTimeframe(tf: Timeframe): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  const startDate = new Date();

  switch (tf) {
    case 'M5':
      startDate.setDate(startDate.getDate() - 3);
      break;
    case 'M15':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case 'H1':
      startDate.setDate(startDate.getDate() - 30);
      break;
    case 'H4':
      startDate.setDate(startDate.getDate() - 60);
      break;
    case 'D1':
      startDate.setDate(startDate.getDate() - 180);
      break;
  }

  return { startDate, endDate };
}

async function fetchCandleData(symbol: string, tf: Timeframe = 'M15'): Promise<CandlestickData[]> {
  const apiSymbol = symbol;
  const { startDate, endDate } = getDateRangeForTimeframe(tf);

  try {
    const params = new URLSearchParams({
      symbol: apiSymbol,
      timeframe: tf,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
    const url = `/api/candles?${params.toString()}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const text = await response.text();
      if (text && text.trim()) {
        const data = JSON.parse(text);
        if (data.candles && data.candles.length > 0) {
          const startTimestamp = Math.floor(startDate.getTime() / 1000);
          const endTimestamp = Math.floor(endDate.getTime() / 1000);

          const candles = data.candles
            .map((c: any) => ({
              time: Math.floor(new Date(c.time).getTime() / 1000) as Time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            }))
            .filter((c: CandlestickData) => {
              const t = c.time as number;
              return t >= startTimestamp && t <= endTimestamp;
            })
            .sort((a: CandlestickData, b: CandlestickData) => (a.time as number) - (b.time as number))
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
    if (err.name === 'AbortError') {
      console.log('[Chart] API request timed out');
    } else {
      console.log('[Chart] API candles not available:', err.message || err);
    }
  }

  return [];
}

export const TradingViewChart = memo(TradingViewChartComponent);
export type { Timeframe };
