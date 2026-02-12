import {
  Candle,
  Tick,
  Timeframe,
  TIMEFRAME_MAP,
  AccountInfo,
  Position,
  SymbolInfo,
} from '../types';
import { candleCache } from '../cache/candle-cache';
import { TradingBotSyncListener } from './sync-listener';

// Dynamic import to avoid 'window is not defined' error during SSR
let MetaApi: any = null;

// Market data subscription types
export interface MarketDataSubscription {
  type: 'quotes' | 'candles' | 'ticks' | 'marketDepth';
  timeframe?: string;
  intervalInMilliseconds?: number;
}

class MetaAPIClient {
  private static instance: MetaAPIClient;
  private api: any = null;
  private account: any = null;
  private connection: any = null;
  private isConnecting = false;
  private isConnected = false;
  private isAccountReady = false; // For non-streaming operations (historical data)
  private syncListeners: TradingBotSyncListener[] = [];
  private subscribedSymbols: Map<string, MarketDataSubscription[]> = new Map();

  private constructor() {}

  static getInstance(): MetaAPIClient {
    if (!MetaAPIClient.instance) {
      MetaAPIClient.instance = new MetaAPIClient();
    }
    return MetaAPIClient.instance;
  }

  /**
   * Connect with full streaming support (for live trading)
   * WARNING: This uses account subscriptions which are limited
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log('Already connected to MetaAPI');
      return;
    }

    if (this.isConnecting) {
      console.log('Connection already in progress...');
      return;
    }

    this.isConnecting = true;

    try {
      // First ensure account is ready
      await this.connectAccountOnly();

      // Get streaming connection (this uses a subscription!)
      console.log('Creating streaming connection...');
      this.connection = this.account.getStreamingConnection();
      await this.connection.connect();

      console.log('Waiting for synchronization...');
      await this.connection.waitSynchronized();

      this.isConnected = true;
      console.log('Successfully connected to MetaAPI with streaming');
    } catch (error) {
      console.error('Failed to connect to MetaAPI:', error);
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Connect account only (for historical data / backtesting)
   * This does NOT create a streaming subscription
   */
  async connectAccountOnly(): Promise<void> {
    if (this.isAccountReady && this.account) {
      console.log('Account already ready');
      return;
    }

    try {
      const token = process.env.META_API_TOKEN;
      const accountId = process.env.META_API_ACCOUNT_ID;

      if (!token || !accountId) {
        throw new Error('META_API_TOKEN and META_API_ACCOUNT_ID must be set in environment variables');
      }

      console.log('Initializing MetaAPI (account-only mode, no streaming)...');
      // Dynamic import using Node.js specific entry point
      if (!MetaApi) {
        // Use the Node.js specific build to avoid 'window is not defined' errors
        const metaApiModule = await import('metaapi.cloud-sdk/node');
        MetaApi = metaApiModule.default;
      }

      if (!this.api) {
        // Configure API to NOT auto-subscribe to anything
        this.api = new MetaApi(token, {
          application: 'backtest-only',
          retryOpts: {
            retries: 3,
            minDelayInSeconds: 1,
            maxDelayInSeconds: 5,
          },
        });
      }

      console.log(`Connecting to account ${accountId}...`);
      this.account = await this.api.metatraderAccountApi.getAccount(accountId);

      // Wait for deployment if needed
      if (this.account.state !== 'DEPLOYED') {
        console.log('Deploying account...');
        await this.account.deploy();
      }

      // Wait for server connection
      console.log('Waiting for API server connection...');
      await this.account.waitConnected();

      this.isAccountReady = true;
      console.log('Account ready for historical data access (no streaming subscriptions used)');
    } catch (error: any) {
      // Check if it's a subscription quota error - these can be ignored for historical data
      if (error?.status === 429 && error?.metadata?.type === 'LIMIT_ACCOUNT_SUBSCRIPTIONS_PER_USER') {
        console.warn('Subscription quota warning (can be ignored for historical data access)');
        // Account might still be usable for historical data
        if (this.account) {
          this.isAccountReady = true;
          return;
        }
      }
      console.error('Failed to connect account:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
    if (this.account) {
      await this.account.undeploy();
    }
    this.isConnected = false;
    this.isAccountReady = false;
    console.log('Disconnected from MetaAPI');
  }

  private ensureConnected(): void {
    if (!this.isConnected || !this.connection) {
      throw new Error('Not connected to MetaAPI. Call connect() first.');
    }
  }

  private ensureAccountReady(): void {
    if (!this.isAccountReady || !this.account) {
      throw new Error('Account not ready. Call connectAccountOnly() first.');
    }
  }

  async getAccountInfo(): Promise<AccountInfo> {
    this.ensureConnected();
    // Use terminalState for synchronized account data
    const info = this.connection.terminalState.accountInformation;

    return {
      balance: info.balance,
      equity: info.equity,
      margin: info.margin,
      freeMargin: info.freeMargin,
      marginLevel: info.marginLevel,
      leverage: info.leverage,
      currency: info.currency,
    };
  }


  async getPositions(): Promise<Position[]> {
    this.ensureConnected();
    // Use terminalState for synchronized positions
    const positions = this.connection.terminalState.positions || [];

    return positions.map((pos: any) => ({
      id: pos.id,
      symbol: pos.symbol,
      type: pos.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL',
      volume: pos.volume,
      openPrice: pos.openPrice,
      currentPrice: pos.currentPrice,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      profit: pos.profit || pos.unrealizedProfit || 0,
      swap: pos.swap || 0,
      openTime: new Date(pos.time),
      comment: pos.comment,
    }));
  }

  async getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    this.ensureConnected();
    // Get symbol specification from terminalState
    const spec = this.connection.terminalState.specification(symbol);

    if (!spec) {
      throw new Error(`Symbol ${symbol} not found`);
    }

    return {
      symbol: spec.symbol,
      description: spec.description || '',
      digits: spec.digits,
      pipSize: Math.pow(10, -spec.digits),
      contractSize: spec.contractSize || 100000,
      minVolume: spec.minVolume || 0.01,
      maxVolume: spec.maxVolume || 100,
      volumeStep: spec.volumeStep || 0.01,
      tickSize: spec.tickSize || Math.pow(10, -spec.digits),
      tickValue: spec.tickValue || 1,
    };
  }

  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    count: number = 500,
    startTime?: Date
  ): Promise<Candle[]> {
    // Historical candles only need account access, not streaming connection
    this.ensureAccountReady();

    const tf = TIMEFRAME_MAP[timeframe];

    // Use account.getHistoricalCandles for historical data
    let candles;
    if (startTime) {
      candles = await this.account.getHistoricalCandles(
        symbol,
        tf,
        startTime,
        count
      );
    } else {
      // Get candles ending now
      const endTime = new Date();
      candles = await this.account.getHistoricalCandles(
        symbol,
        tf,
        undefined,
        count
      );
    }

    if (!candles || candles.length === 0) {
      return [];
    }

    return candles.map((c: any) => ({
      time: new Date(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.tickVolume || c.volume || 0,
      symbol,
      timeframe,
    }));
  }

  async getHistoricalCandles(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<Candle[]> {
    // Historical candles only need account access, not streaming connection
    this.ensureAccountReady();

    const tf = TIMEFRAME_MAP[timeframe];
    const allCandles: Candle[] = [];
    let currentStart = new Date(startDate);
    let previousStartTime = 0;
    let stuckCount = 0;
    const MAX_STUCK_ITERATIONS = 3;

    // Fetch in batches of 1000
    while (currentStart < endDate) {
      const candles = await this.account.getHistoricalCandles(
        symbol,
        tf,
        currentStart,
        1000
      );

      if (!candles || candles.length === 0) break;

      const mappedCandles = candles
        .map((c: any) => ({
          time: new Date(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.tickVolume || c.volume || 0,
          symbol,
          timeframe,
        }))
        .filter((c: Candle) => c.time <= endDate);

      allCandles.push(...mappedCandles);

      if (candles.length < 1000) break;

      // Move start time to last candle time + 1 minute
      const lastCandleTime = new Date(candles[candles.length - 1].time).getTime();

      // Detect infinite loop: if start time isn't advancing, break out
      if (lastCandleTime <= previousStartTime) {
        stuckCount++;
        console.warn(`[MetaAPI] getHistoricalCandles stuck detection: iteration ${stuckCount}, lastCandleTime=${lastCandleTime}, previousStartTime=${previousStartTime}`);
        if (stuckCount >= MAX_STUCK_ITERATIONS) {
          console.error(`[MetaAPI] getHistoricalCandles breaking out of potential infinite loop for ${symbol} ${timeframe}`);
          break;
        }
      } else {
        stuckCount = 0;
      }
      previousStartTime = lastCandleTime;

      currentStart = new Date(lastCandleTime);
      currentStart.setMinutes(currentStart.getMinutes() + 1);

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return allCandles;
  }

  async getHistoricalTicks(
    symbol: string,
    startTime: Date,
    offset: number = 0,
    limit: number = 1000
  ): Promise<Tick[]> {
    // Historical ticks only need account access, not streaming connection
    this.ensureAccountReady();

    const ticks = await this.account.getHistoricalTicks(
      symbol,
      startTime,
      offset,
      limit
    );

    if (!ticks || ticks.length === 0) {
      return [];
    }

    return ticks.map((t: any) => ({
      time: new Date(t.time),
      bid: t.bid,
      ask: t.ask,
      symbol,
    }));
  }

  async getAllHistoricalTicks(
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<Tick[]> {
    // Historical ticks only need account access, not streaming connection
    this.ensureAccountReady();

    const allTicks: Tick[] = [];
    let currentStart = new Date(startDate);
    let offset = 0;

    while (currentStart < endDate) {
      const ticks = await this.account.getHistoricalTicks(
        symbol,
        currentStart,
        offset,
        1000
      );

      if (!ticks || ticks.length === 0) {
        // Move to next hour if no ticks
        currentStart.setHours(currentStart.getHours() + 1);
        offset = 0;
        continue;
      }

      const mappedTicks = ticks
        .map((t: any) => ({
          time: new Date(t.time),
          bid: t.bid,
          ask: t.ask,
          symbol,
        }))
        .filter((t: Tick) => t.time <= endDate);

      allTicks.push(...mappedTicks);

      if (ticks.length < 1000) {
        // Move to next time period
        const lastTick = ticks[ticks.length - 1];
        currentStart = new Date(lastTick.time);
        currentStart.setMinutes(currentStart.getMinutes() + 1);
        offset = 0;
      } else {
        offset += 1000;
      }

      // Respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return allTicks;
  }

  async getCurrentPrice(symbol: string): Promise<{ bid: number; ask: number }> {
    this.ensureConnected();
    // Get price from terminalState
    const price = this.connection.terminalState.price(symbol);

    if (!price) {
      throw new Error(`Price not available for ${symbol}`);
    }

    return {
      bid: price.bid,
      ask: price.ask,
    };
  }

  async placeMarketOrder(
    symbol: string,
    type: 'BUY' | 'SELL',
    volume: number,
    stopLoss?: number,
    takeProfit?: number,
    comment?: string
  ): Promise<{ orderId: string; positionId?: string }> {
    this.ensureConnected();

    let result;
    if (type === 'BUY') {
      result = await this.connection.createMarketBuyOrder(
        symbol,
        volume,
        stopLoss,
        takeProfit,
        {
          comment: comment || 'SMC Bot Trade',
        }
      );
    } else {
      result = await this.connection.createMarketSellOrder(
        symbol,
        volume,
        stopLoss,
        takeProfit,
        {
          comment: comment || 'SMC Bot Trade',
        }
      );
    }

    return {
      orderId: result.orderId,
      positionId: result.positionId,
    };
  }

  async placeLimitOrder(
    symbol: string,
    type: 'BUY' | 'SELL',
    volume: number,
    price: number,
    stopLoss?: number,
    takeProfit?: number,
    comment?: string
  ): Promise<{ orderId: string }> {
    this.ensureConnected();

    let result;
    if (type === 'BUY') {
      result = await this.connection.createLimitBuyOrder(
        symbol,
        volume,
        price,
        stopLoss,
        takeProfit,
        {
          comment: comment || 'SMC Bot Limit',
        }
      );
    } else {
      result = await this.connection.createLimitSellOrder(
        symbol,
        volume,
        price,
        stopLoss,
        takeProfit,
        {
          comment: comment || 'SMC Bot Limit',
        }
      );
    }

    return { orderId: result.orderId };
  }

  async closePosition(positionId: string): Promise<void> {
    this.ensureConnected();
    await this.connection.closePosition(positionId);
  }

  async closePositionPartially(
    positionId: string,
    volume: number
  ): Promise<void> {
    this.ensureConnected();
    await this.connection.closePositionPartially(positionId, volume);
  }

  async modifyPosition(
    positionId: string,
    stopLoss?: number,
    takeProfit?: number
  ): Promise<void> {
    this.ensureConnected();
    await this.connection.modifyPosition(positionId, stopLoss, takeProfit);
  }

  async cancelOrder(orderId: string): Promise<void> {
    this.ensureConnected();
    await this.connection.cancelOrder(orderId);
  }

  async getPendingOrders(): Promise<any[]> {
    this.ensureConnected();
    // Use terminalState for synchronized orders
    return this.connection.terminalState.orders || [];
  }

  /**
   * Get historical deals from the synchronized history storage
   * Optionally filter by time range
   * Only returns trading deals (excludes balance/credit operations)
   */
  async getHistoricalDeals(startTime?: Date, endTime?: Date): Promise<any[]> {
    this.ensureConnected();
    try {
      const historyStorage = this.connection.historyStorage;
      if (!historyStorage || !historyStorage.deals) {
        console.log('[MetaAPI] No history storage or deals available');
        return [];
      }

      let deals = historyStorage.deals;

      // Filter to only trading deals (exclude balance, credit, etc.)
      deals = deals.filter((d: any) =>
        d.type === 'DEAL_TYPE_BUY' || d.type === 'DEAL_TYPE_SELL'
      );

      // Filter by time range if provided
      if (startTime || endTime) {
        deals = deals.filter((d: any) => {
          const dealTime = new Date(d.time);
          if (startTime && dealTime < startTime) return false;
          if (endTime && dealTime > endTime) return false;
          return true;
        });
      }

      return deals;
    } catch (error) {
      console.error('[MetaAPI] Error fetching historical deals:', error);
      return [];
    }
  }

  /**
   * Get ALL deals from the synchronized history storage (no type filter)
   * Includes trading deals, balance operations, swaps, commissions, etc.
   */
  async getAllDeals(startTime?: Date, endTime?: Date): Promise<any[]> {
    this.ensureConnected();
    try {
      const historyStorage = this.connection.historyStorage;
      if (!historyStorage || !historyStorage.deals) {
        console.log('[MetaAPI] No history storage or deals available');
        return [];
      }

      let deals = historyStorage.deals;

      // Filter by time range if provided
      if (startTime || endTime) {
        deals = deals.filter((d: any) => {
          const dealTime = new Date(d.time);
          if (startTime && dealTime < startTime) return false;
          if (endTime && dealTime > endTime) return false;
          return true;
        });
      }

      return deals;
    } catch (error) {
      console.error('[MetaAPI] Error fetching all deals:', error);
      return [];
    }
  }

  /**
   * Compute account summary from all deals in history storage
   * Deposits, withdrawals, swap, commission, trading profit — all from deals
   */
  async getAccountDealsSummary(startTime?: Date, endTime?: Date): Promise<{
    deposits: number;
    withdrawals: number;
    totalSwap: number;
    totalCommission: number;
    tradingProfit: number;
    dealCount: number;
    operations: Array<{ type: 'deposit' | 'withdrawal'; amount: number; time: Date; comment: string | null }>;
  }> {
    const deals = await this.getAllDeals(startTime, endTime);

    let deposits = 0;
    let withdrawals = 0;
    let totalSwap = 0;
    let totalCommission = 0;
    let tradingProfit = 0;
    const operations: Array<{ type: 'deposit' | 'withdrawal'; amount: number; time: Date; comment: string | null }> = [];

    for (const deal of deals) {
      // Accumulate swap and commission from every deal
      totalSwap += deal.swap || 0;
      totalCommission += deal.commission || 0;

      if (deal.type === 'DEAL_TYPE_BALANCE') {
        const profit = deal.profit || 0;
        if (profit > 0) {
          deposits += profit;
          operations.push({ type: 'deposit', amount: profit, time: new Date(deal.time), comment: deal.comment || null });
        } else if (profit < 0) {
          withdrawals += Math.abs(profit);
          operations.push({ type: 'withdrawal', amount: Math.abs(profit), time: new Date(deal.time), comment: deal.comment || null });
        }
      } else if (deal.type === 'DEAL_TYPE_BUY' || deal.type === 'DEAL_TYPE_SELL') {
        tradingProfit += deal.profit || 0;
      }
    }

    return {
      deposits,
      withdrawals,
      totalSwap,
      totalCommission,
      tradingProfit,
      dealCount: deals.length,
      operations,
    };
  }

  /**
   * Get historical orders from the synchronized history storage
   */
  async getHistoricalOrders(startTime?: Date, endTime?: Date): Promise<any[]> {
    this.ensureConnected();
    try {
      const historyStorage = this.connection.historyStorage;
      if (!historyStorage || !historyStorage.historyOrders) {
        console.log('[MetaAPI] No history storage or orders available');
        return [];
      }

      let orders = historyStorage.historyOrders;

      // Filter by time range if provided
      if (startTime || endTime) {
        orders = orders.filter((o: any) => {
          const orderTime = new Date(o.time || o.doneTime);
          if (startTime && orderTime < startTime) return false;
          if (endTime && orderTime > endTime) return false;
          return true;
        });
      }

      return orders;
    } catch (error) {
      console.error('[MetaAPI] Error fetching historical orders:', error);
      return [];
    }
  }

  /**
   * Get deals for a specific position ID from history storage
   */
  getDealsByPosition(positionId: string): any[] {
    this.ensureConnected();
    try {
      const historyStorage = this.connection.historyStorage;
      if (!historyStorage || !historyStorage.deals) {
        return [];
      }

      return historyStorage.deals.filter((d: any) =>
        d.positionId === positionId || d.positionId?.toString() === positionId
      );
    } catch (error) {
      console.error('[MetaAPI] Error fetching deals for position:', error);
      return [];
    }
  }

  isConnectionActive(): boolean {
    return this.isConnected;
  }

  isAccountReadyForHistoricalData(): boolean {
    return this.isAccountReady;
  }

  async getAvailableSymbols(): Promise<string[]> {
    this.ensureConnected();
    const specifications = this.connection.terminalState.specifications || [];
    return specifications.map((spec: any) => spec.symbol);
  }

  async searchSymbols(query: string): Promise<string[]> {
    this.ensureConnected();
    const specifications = this.connection.terminalState.specifications || [];
    const lowerQuery = query.toLowerCase();
    return specifications
      .filter((spec: any) =>
        spec.symbol.toLowerCase().includes(lowerQuery) ||
        (spec.description && spec.description.toLowerCase().includes(lowerQuery))
      )
      .map((spec: any) => spec.symbol);
  }

  // ============================================
  // Synchronization Listener Methods (Event-Driven)
  // ============================================

  /**
   * Add a synchronization listener to receive real-time updates
   */
  addSynchronizationListener(listener: TradingBotSyncListener): void {
    this.ensureConnected();
    this.syncListeners.push(listener);
    this.connection.addSynchronizationListener(listener);
    console.log('[MetaAPI] Added synchronization listener');
  }

  /**
   * Remove a synchronization listener
   */
  removeSynchronizationListener(listener: TradingBotSyncListener): void {
    const index = this.syncListeners.indexOf(listener);
    if (index > -1) {
      this.syncListeners.splice(index, 1);
      if (this.connection) {
        this.connection.removeSynchronizationListener(listener);
      }
      console.log('[MetaAPI] Removed synchronization listener');
    }
  }

  /**
   * Subscribe to real-time market data for a symbol
   * This enables push-based updates instead of polling
   */
  async subscribeToMarketData(
    symbol: string,
    subscriptions: MarketDataSubscription[]
  ): Promise<void> {
    this.ensureConnected();

    console.log(`[MetaAPI] Subscribing to market data for ${symbol}:`, subscriptions);

    await this.connection.subscribeToMarketData(symbol, subscriptions);
    this.subscribedSymbols.set(symbol, subscriptions);

    // Update all listeners with the new symbol
    for (const listener of this.syncListeners) {
      listener.addSubscribedSymbol(symbol);
    }
  }

  /**
   * Unsubscribe from real-time market data for a symbol
   */
  async unsubscribeFromMarketData(symbol: string): Promise<void> {
    this.ensureConnected();

    const subscriptions = this.subscribedSymbols.get(symbol);
    if (!subscriptions) return;

    console.log(`[MetaAPI] Unsubscribing from market data for ${symbol}`);

    await this.connection.unsubscribeFromMarketData(symbol, subscriptions);
    this.subscribedSymbols.delete(symbol);

    // Update all listeners
    for (const listener of this.syncListeners) {
      listener.removeSubscribedSymbol(symbol);
    }
  }

  /**
   * Get list of currently subscribed symbols
   */
  getSubscribedSymbols(): string[] {
    return Array.from(this.subscribedSymbols.keys());
  }

  /**
   * Check if symbol is subscribed to market data
   */
  isSymbolSubscribed(symbol: string): boolean {
    return this.subscribedSymbols.has(symbol);
  }

  // ============================================
  // Cache-Enabled Historical Data Methods
  // ============================================

  /**
   * Get historical candles with caching support
   * This checks the local cache first and only fetches missing data from API
   */
  async getHistoricalCandlesCached(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<Candle[]> {
    // Historical candles only need account access, not streaming connection
    this.ensureAccountReady();

    // Use the cache service which will call our fetch function for missing data
    return candleCache.getHistoricalCandles(
      symbol,
      timeframe,
      startDate,
      endDate,
      // This function is called only for missing date ranges
      async (sym, tf, start, end) => {
        return this.fetchHistoricalCandlesFromApi(sym, tf, start, end);
      }
    );
  }

  /**
   * Internal method to fetch candles directly from MetaAPI (bypasses cache)
   */
  private async fetchHistoricalCandlesFromApi(
    symbol: string,
    timeframe: Timeframe,
    startDate: Date,
    endDate: Date
  ): Promise<Candle[]> {
    const tf = TIMEFRAME_MAP[timeframe];
    const allCandles: Candle[] = [];
    let currentStart = new Date(startDate);
    let previousStartTime = 0;
    let stuckCount = 0;
    const MAX_STUCK_ITERATIONS = 3;

    // Fetch in batches of 1000
    while (currentStart < endDate) {
      const candles = await this.account.getHistoricalCandles(
        symbol,
        tf,
        currentStart,
        1000
      );

      if (!candles || candles.length === 0) break;

      const mappedCandles = candles
        .map((c: any) => ({
          time: new Date(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.tickVolume || c.volume || 0,
          symbol,
          timeframe,
        }))
        .filter((c: Candle) => c.time <= endDate);

      allCandles.push(...mappedCandles);

      if (candles.length < 1000) break;

      // Move start time to last candle time + 1 minute
      const lastCandleTime = new Date(candles[candles.length - 1].time).getTime();

      // Detect infinite loop: if start time isn't advancing, break out
      if (lastCandleTime <= previousStartTime) {
        stuckCount++;
        if (stuckCount >= MAX_STUCK_ITERATIONS) {
          console.error(`[MetaAPI] fetchHistoricalCandlesFromApi breaking out of potential infinite loop for ${symbol} ${timeframe}`);
          break;
        }
      } else {
        stuckCount = 0;
      }
      previousStartTime = lastCandleTime;

      currentStart = new Date(lastCandleTime);
      currentStart.setMinutes(currentStart.getMinutes() + 1);

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return allCandles;
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return candleCache.getStats();
  }

  /**
   * Get cache info (counts by symbol/timeframe)
   */
  async getCacheInfo() {
    return candleCache.getCacheInfo();
  }

  /**
   * Clear candle cache
   */
  async clearCache(symbol?: string, timeframe?: Timeframe) {
    return candleCache.clearCache(symbol, timeframe);
  }

  /**
   * Get the streaming connection for advanced use cases
   */
  getConnection(): any {
    this.ensureConnected();
    return this.connection;
  }
}

// Export singleton instance
export const metaApiClient = MetaAPIClient.getInstance();
export default metaApiClient;
