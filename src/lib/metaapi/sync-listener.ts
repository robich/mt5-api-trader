/**
 * MetaAPI Synchronization Listener
 * Handles real-time data push from MetaAPI instead of polling
 */

// Event handlers that can be registered
export interface SyncListenerCallbacks {
  onPriceUpdate?: (symbol: string, price: SymbolPrice) => void;
  onCandleUpdate?: (candles: CandleUpdate[]) => void;
  onPositionUpdate?: (positions: PositionUpdate[], removedIds: string[]) => void;
  onOrderUpdate?: (orders: OrderUpdate[], completedIds: string[]) => void;
  onAccountUpdate?: (accountInfo: AccountInfoUpdate) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  onRateLimitWarning?: (symbol: string, message: string) => void;
}

export interface SymbolPrice {
  symbol: string;
  bid: number;
  ask: number;
  time: Date;
  brokerTime?: string;
}

export interface CandleUpdate {
  symbol: string;
  timeframe: string;
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PositionUpdate {
  id: string;
  symbol: string;
  type: 'POSITION_TYPE_BUY' | 'POSITION_TYPE_SELL';
  volume: number;
  openPrice: number;
  currentPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  profit?: number;
  swap?: number;
  time: Date;
  comment?: string;
}

export interface OrderUpdate {
  id: string;
  symbol: string;
  type: string;
  openPrice: number;
  volume: number;
  stopLoss?: number;
  takeProfit?: number;
  state: string;
}

export interface AccountInfoUpdate {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel?: number;
  leverage: number;
  currency: string;
}

/**
 * Custom SynchronizationListener that forwards MetaAPI events to registered callbacks
 * This allows the trading bot to react to real-time events instead of polling
 */
export class TradingBotSyncListener {
  private callbacks: SyncListenerCallbacks;
  private subscribedSymbols: Set<string> = new Set();

  constructor(callbacks: SyncListenerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Update callbacks after construction
   */
  setCallbacks(callbacks: Partial<SyncListenerCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Track subscribed symbols for filtering
   */
  addSubscribedSymbol(symbol: string): void {
    this.subscribedSymbols.add(symbol);
  }

  removeSubscribedSymbol(symbol: string): void {
    this.subscribedSymbols.delete(symbol);
  }

  /**
   * Called when connection to MetaTrader terminal established
   */
  async onConnected(instanceIndex: string): Promise<void> {
    console.log(`[SyncListener] Connected (instance: ${instanceIndex})`);
    this.callbacks.onConnected?.();
  }

  /**
   * Called when connection to MetaTrader terminal terminated
   */
  async onDisconnected(instanceIndex: string): Promise<void> {
    console.log(`[SyncListener] Disconnected (instance: ${instanceIndex})`);
    this.callbacks.onDisconnected?.();
  }

  /**
   * Called when broker connection status changes
   */
  async onBrokerConnectionStatusChanged(
    instanceIndex: string,
    connected: boolean
  ): Promise<void> {
    console.log(`[SyncListener] Broker connection status: ${connected ? 'connected' : 'disconnected'}`);
    if (!connected) {
      this.callbacks.onDisconnected?.();
    }
  }

  /**
   * Called when account information is updated
   */
  async onAccountInformationUpdated(
    instanceIndex: string,
    accountInformation: any
  ): Promise<void> {
    const update: AccountInfoUpdate = {
      balance: accountInformation.balance,
      equity: accountInformation.equity,
      margin: accountInformation.margin,
      freeMargin: accountInformation.freeMargin,
      marginLevel: accountInformation.marginLevel,
      leverage: accountInformation.leverage,
      currency: accountInformation.currency,
    };
    this.callbacks.onAccountUpdate?.(update);
  }

  /**
   * Called when symbol price is updated (real-time quotes)
   */
  async onSymbolPriceUpdated(
    instanceIndex: string,
    price: any
  ): Promise<void> {
    // Only process prices for subscribed symbols
    if (this.subscribedSymbols.size > 0 && !this.subscribedSymbols.has(price.symbol)) {
      return;
    }

    const update: SymbolPrice = {
      symbol: price.symbol,
      bid: price.bid,
      ask: price.ask,
      time: new Date(price.time),
      brokerTime: price.brokerTime,
    };
    this.callbacks.onPriceUpdate?.(price.symbol, update);
  }

  /**
   * Called when multiple symbol prices are updated
   */
  async onSymbolPricesUpdated(
    instanceIndex: string,
    prices: any[],
    equity: number,
    margin: number,
    freeMargin: number,
    marginLevel: number
  ): Promise<void> {
    for (const price of prices) {
      await this.onSymbolPriceUpdated(instanceIndex, price);
    }
  }

  /**
   * Called when candles are updated (new candle or candle close)
   */
  async onCandlesUpdated(
    instanceIndex: string,
    candles: any[]
  ): Promise<void> {
    const updates: CandleUpdate[] = [];

    for (const candle of candles) {
      // Only process candles for subscribed symbols
      if (this.subscribedSymbols.size > 0 && !this.subscribedSymbols.has(candle.symbol)) {
        continue;
      }

      updates.push({
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        time: new Date(candle.time),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.tickVolume || candle.volume || 0,
      });
    }

    if (updates.length > 0) {
      this.callbacks.onCandleUpdate?.(updates);
    }
  }

  /**
   * Called when ticks are updated
   */
  async onTicksUpdated(
    instanceIndex: string,
    ticks: any[]
  ): Promise<void> {
    // Forward ticks as price updates
    for (const tick of ticks) {
      if (this.subscribedSymbols.size > 0 && !this.subscribedSymbols.has(tick.symbol)) {
        continue;
      }

      const update: SymbolPrice = {
        symbol: tick.symbol,
        bid: tick.bid,
        ask: tick.ask,
        time: new Date(tick.time),
        brokerTime: tick.brokerTime,
      };
      this.callbacks.onPriceUpdate?.(tick.symbol, update);
    }
  }

  /**
   * Called when positions are updated
   */
  async onPositionsUpdated(
    instanceIndex: string,
    positions: any[],
    removedPositionIds: string[]
  ): Promise<void> {
    const updates: PositionUpdate[] = positions.map((pos) => ({
      id: pos.id,
      symbol: pos.symbol,
      type: pos.type,
      volume: pos.volume,
      openPrice: pos.openPrice,
      currentPrice: pos.currentPrice,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      profit: pos.profit || pos.unrealizedProfit || 0,
      swap: pos.swap || 0,
      time: new Date(pos.time),
      comment: pos.comment,
    }));

    this.callbacks.onPositionUpdate?.(updates, removedPositionIds);
  }

  /**
   * Called when positions are replaced (initial sync)
   */
  async onPositionsReplaced(
    instanceIndex: string,
    positions: any[]
  ): Promise<void> {
    await this.onPositionsUpdated(instanceIndex, positions, []);
  }

  /**
   * Called when pending orders are updated
   */
  async onPendingOrdersUpdated(
    instanceIndex: string,
    orders: any[],
    completedOrderIds: string[]
  ): Promise<void> {
    const updates: OrderUpdate[] = orders.map((order) => ({
      id: order.id,
      symbol: order.symbol,
      type: order.type,
      openPrice: order.openPrice,
      volume: order.volume,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      state: order.state,
    }));

    this.callbacks.onOrderUpdate?.(updates, completedOrderIds);
  }

  /**
   * Called when market data subscription is downgraded due to rate limits
   */
  async onSubscriptionDowngraded(
    instanceIndex: string,
    symbol: string,
    updates: any,
    unsubscriptions: any
  ): Promise<void> {
    const message = `Market data subscriptions for ${symbol} were downgraded by the server due to rate limits`;
    console.warn(`[SyncListener] ${message}`);
    this.callbacks.onRateLimitWarning?.(symbol, message);
  }

  /**
   * Called when synchronization starts
   */
  async onSynchronizationStarted(
    instanceIndex: string,
    specificationsHash: string,
    positionsHash: string,
    ordersHash: string,
    synchronizationId: string
  ): Promise<void> {
    console.log(`[SyncListener] Synchronization started (id: ${synchronizationId})`);
  }

  /**
   * Called when symbol specifications are updated
   */
  async onSymbolSpecificationsUpdated(
    instanceIndex: string,
    specifications: any[],
    removedSymbols: string[]
  ): Promise<void> {
    // No-op: we don't need symbol specification data
  }

  /**
   * Called when a single symbol specification is updated
   */
  async onSymbolSpecificationUpdated(
    instanceIndex: string,
    specification: any
  ): Promise<void> {
    // No-op: we don't need symbol specification data
  }

  /**
   * Called when server health status is received
   */
  async onHealthStatus(instanceIndex: string, status: any): Promise<void> {
    // No-op: we don't need health status events
  }

  /**
   * Called when stream is closed
   */
  async onStreamClosed(instanceIndex: string): Promise<void> {
    console.log(`[SyncListener] Stream closed (instance: ${instanceIndex})`);
    this.callbacks.onDisconnected?.();
  }
}

export default TradingBotSyncListener;
