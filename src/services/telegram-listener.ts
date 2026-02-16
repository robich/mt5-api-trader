/**
 * Telegram Channel Listener Service
 * Connects to a private Telegram channel via gramjs (User API)
 * and forwards new messages for analysis.
 *
 * IMPORTANT: Uses a single TelegramClient instance for the entire lifetime
 * to avoid AUTH_KEY_DUPLICATED (406) errors. gramjs triggers InvokeWithLayer
 * on every new TelegramClient.connect(), and Telegram rejects duplicate auth
 * keys if the previous TCP connection hasn't fully closed server-side.
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import { prisma } from '@/lib/db';

export interface TelegramMessageCallback {
  onMessage: (msg: {
    id: number;
    text: string;
    senderName: string | null;
    hasMedia: boolean;
    date: Date;
  }) => Promise<void>;
}

class TelegramListenerService {
  private client: TelegramClient | null = null;
  private enabled = false;
  private listening = false;
  private channelId: string = '';
  private apiId: number = 0;
  private apiHash: string = '';
  private sessionString: string = '';
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastCallbacks: TelegramMessageCallback | null = null;
  private connectPromise: Promise<TelegramClient> | null = null; // mutex for concurrent connect calls
  private eventHandler: ((event: NewMessageEvent) => Promise<void>) | null = null;
  private lastEventMessageAt: number = 0; // timestamp of last event-driven message
  private listenerStartedAt: Date | null = null; // when this session started - messages before this are skipped

  initialize(): boolean {
    const apiId = process.env.TELEGRAM_API_ID?.trim();
    const apiHash = process.env.TELEGRAM_API_HASH?.trim();
    const sessionString = process.env.TELEGRAM_SESSION_STRING?.trim();
    const channelId = process.env.TELEGRAM_CHANNEL_ID?.trim();

    console.log('[TelegramListener] Initializing...', {
      hasApiId: !!apiId,
      hasApiHash: !!apiHash,
      hasSession: !!sessionString,
      hasChannelId: !!channelId,
    });

    if (apiId && apiHash && sessionString && channelId) {
      this.apiId = parseInt(apiId);
      this.apiHash = apiHash;
      this.sessionString = sessionString;
      this.channelId = channelId;
      this.enabled = true;
      console.log('[TelegramListener] Service enabled');
      return true;
    }

    const missing = [
      !apiId && 'TELEGRAM_API_ID',
      !apiHash && 'TELEGRAM_API_HASH',
      !sessionString && 'TELEGRAM_SESSION_STRING',
      !channelId && 'TELEGRAM_CHANNEL_ID',
    ].filter(Boolean);
    console.log(`[TelegramListener] Service disabled (missing: ${missing.join(', ')})`);
    return false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isListening(): boolean {
    return this.listening;
  }

  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  getConnectionInfo(): {
    enabled: boolean;
    listening: boolean;
    connected: boolean;
    reconnecting: boolean;
    reconnectAttempts: number;
  } {
    return {
      enabled: this.enabled,
      listening: this.listening,
      connected: this.client?.connected ?? false,
      reconnecting: this.reconnectTimeout !== null,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Get or create the singleton TelegramClient.
   * The client is created once and reused for the entire service lifetime.
   * This avoids AUTH_KEY_DUPLICATED errors caused by multiple InvokeWithLayer calls.
   */
  private getOrCreateClient(): TelegramClient {
    if (!this.client) {
      console.log('[TelegramListener] Creating new TelegramClient instance (session length:', this.sessionString.length, ')');
      const session = new StringSession(this.sessionString);
      this.client = new TelegramClient(session, this.apiId, this.apiHash, {
        connectionRetries: 5,
      });
    } else {
      console.log('[TelegramListener] Reusing existing TelegramClient (connected:', this.client.connected, ')');
    }
    return this.client;
  }

  /**
   * Ensure the singleton client is connected.
   * Uses a mutex (connectPromise) so concurrent callers (start + fetchLatest)
   * share a single connection attempt instead of racing each other.
   * On AUTH_KEY_DUPLICATED, retries with exponential backoff (never gives up).
   */
  private async ensureConnected(): Promise<TelegramClient> {
    const client = this.getOrCreateClient();
    if (client.connected) {
      return client;
    }

    // Mutex: if another caller is already connecting, wait for that attempt
    if (this.connectPromise) {
      console.log('[TelegramListener] Connection attempt already in progress, waiting...');
      return this.connectPromise;
    }

    this.connectPromise = this._doConnect();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  /**
   * Internal connect logic with indefinite AUTH_KEY_DUPLICATED retries.
   * Backoff: 30s, 60s, 120s, 120s, 120s, ... (caps at 2 minutes)
   */
  private async _doConnect(): Promise<TelegramClient> {
    let attempt = 0;
    const maxDelay = 120_000; // 2 minutes cap

    while (true) {
      // Destroy any stale client before each attempt
      if (attempt > 0) {
        try { await this.client?.disconnect(); } catch { /* ignore */ }
        this.client = null;
      }

      const client = this.getOrCreateClient();
      console.log(`[TelegramListener] Calling client.connect() (attempt ${attempt + 1})...`);

      try {
        await client.connect();
        console.log('[TelegramListener] client.connect() succeeded');
        return client;
      } catch (error: any) {
        const errMsg = error?.message || String(error);
        console.error('[TelegramListener] client.connect() failed:', {
          message: errMsg,
          code: error?.code || error?.errorMessage,
        });

        if (!errMsg.includes('AUTH_KEY_DUPLICATED')) {
          throw error; // non-retryable error
        }

        attempt++;
        const delay = Math.min(30_000 * Math.pow(2, attempt - 1), maxDelay);
        console.warn(`[TelegramListener] AUTH_KEY_DUPLICATED — waiting ${delay / 1000}s before retry ${attempt}...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  /**
   * Fetch the latest messages from the channel on demand.
   * Only works if already connected — does NOT trigger a new connection
   * to avoid racing with start() and causing AUTH_KEY_DUPLICATED.
   */
  async fetchLatest(count: number = 10): Promise<Array<{
    id: number;
    text: string;
    senderName: string | null;
    hasMedia: boolean;
    date: Date;
  }>> {
    if (!this.enabled) {
      throw new Error('Telegram listener not enabled (missing env vars)');
    }

    if (!this.client?.connected) {
      console.log('[TelegramListener] fetchLatest: not connected yet, returning empty');
      return [];
    }

    return this._fetchMessages(this.client, count);
  }

  private async _fetchMessages(client: TelegramClient, count: number): Promise<Array<{
    id: number;
    text: string;
    senderName: string | null;
    hasMedia: boolean;
    date: Date;
  }>> {
    const entity = await client.getEntity(this.channelId);
    const messages = await client.getMessages(entity, { limit: count });

    return messages
      .filter((msg) => msg.text)
      .map((msg) => ({
        id: msg.id,
        text: msg.text || '',
        senderName: msg.sender
          ? ((msg.sender as any).firstName || '') + ' ' + ((msg.sender as any).lastName || '')
          : null,
        hasMedia: !!msg.media,
        date: msg.date ? new Date(msg.date * 1000) : new Date(),
      }));
  }

  async start(callbacks: TelegramMessageCallback): Promise<void> {
    if (!this.enabled) {
      console.log('[TelegramListener] Cannot start - not enabled');
      return;
    }

    if (this.listening) {
      console.log('[TelegramListener] Already listening');
      return;
    }

    try {
      console.log('[TelegramListener] Connecting...');

      const client = await this.ensureConnected();
      console.log('[TelegramListener] Connected to Telegram');

      // Remove any previous event handler to prevent duplicates on reconnect
      if (this.eventHandler) {
        try {
          client.removeEventHandler(this.eventHandler, new NewMessage({}));
        } catch {
          // Ignore - handler may already be gone if client was recreated
        }
        this.eventHandler = null;
      }

      // Fetch dialogs to prime gramjs's internal update state (pts/qts).
      // Without this, gramjs connects but never receives real-time updates
      // because it hasn't synced the update gap with Telegram's servers.
      await client.getDialogs({ limit: 10 });
      console.log('[TelegramListener] Dialogs fetched — update state primed');

      // Resolve the channel entity to get its numeric ID
      const channelEntity = await client.getEntity(this.channelId);
      const channelPeerId = (channelEntity as any).id;
      console.log('[TelegramListener] Resolved channel:', (channelEntity as any).title || this.channelId, `(id: ${channelPeerId})`);

      // Register new message handler filtered to channel
      // gramjs NewMessage chats filter needs numeric IDs, not entity objects
      this.eventHandler = async (event: NewMessageEvent) => {
        this.lastEventMessageAt = Date.now();
        await this.handleNewMessage(event, callbacks);
      };
      client.addEventHandler(
        this.eventHandler,
        new NewMessage({
          chats: [channelPeerId],
        })
      );

      this.listening = true;
      this.reconnectAttempts = 0;
      this.lastCallbacks = callbacks;
      this.lastEventMessageAt = Date.now();
      this.listenerStartedAt = new Date();

      // Periodic active health check + keepalive
      this.startHealthCheck(callbacks);

      // Periodic polling fallback — catches any messages the event handler missed
      this.startPollingFallback(callbacks);

      // Update DB state
      await this.updateState({
        isListening: true,
        startedAt: new Date(),
        errorMessage: null,
      });

      console.log('[TelegramListener] Listening for messages (persistent mode + polling fallback)');
    } catch (error: any) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      console.error('[TelegramListener] Failed to start:', {
        message: errMsg,
        code: error?.code || error?.errorMessage,
        type: error?.constructor?.name,
        stack: errStack,
      });

      await this.updateState({
        isListening: false,
        errorMessage: errMsg,
      });

      // Attempt reconnect with backoff
      this.scheduleReconnect(callbacks);
    }
  }

  private async handleNewMessage(
    event: NewMessageEvent,
    callbacks: TelegramMessageCallback
  ): Promise<void> {
    try {
      const msg = event.message;
      if (!msg || !msg.text) return;

      const telegramMsgId = msg.id;
      const text = msg.text;
      const senderName = msg.sender
        ? ((msg.sender as any).firstName || '') + ' ' + ((msg.sender as any).lastName || '')
        : null;
      const hasMedia = !!msg.media;
      const date = msg.date ? new Date(msg.date * 1000) : new Date();

      // Skip messages sent before this listener session started (update gap backfill)
      if (this.listenerStartedAt && date < this.listenerStartedAt) {
        console.log(`[TelegramListener] Skipping pre-start message #${telegramMsgId} (sent ${date.toISOString()}, listener started ${this.listenerStartedAt.toISOString()})`);
        return;
      }

      console.log(`[TelegramListener] New message #${telegramMsgId}: ${text.substring(0, 80)}...`);

      // Dedup via DB unique constraint
      try {
        await prisma.telegramChannelMessage.create({
          data: {
            telegramMsgId,
            channelId: this.channelId,
            text,
            senderName: senderName?.trim() || null,
            hasMedia,
            receivedAt: date,
          },
        });
      } catch (e: any) {
        if (e.code === 'P2002') {
          console.log(`[TelegramListener] Duplicate message #${telegramMsgId}, skipping`);
          return;
        }
        throw e;
      }

      // Update state counters
      await prisma.telegramListenerState.update({
        where: { id: 'singleton' },
        data: {
          lastMessageAt: date,
          totalMessages: { increment: 1 },
        },
      });

      // Forward to callback
      await callbacks.onMessage({
        id: telegramMsgId,
        text,
        senderName: senderName?.trim() || null,
        hasMedia,
        date,
      });
    } catch (error) {
      console.error('[TelegramListener] Error handling message:', error);
    }
  }

  /**
   * Reconnect by re-calling connect() on the existing client.
   * Does NOT create a new TelegramClient — avoids AUTH_KEY_DUPLICATED.
   */
  private scheduleReconnect(callbacks: TelegramMessageCallback): void {
    // Cancel any already-pending reconnect to avoid parallel reconnection attempts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Never give up - cap backoff at 5 minutes
    const delay = Math.min(5000 * Math.pow(2, Math.min(this.reconnectAttempts, 6)), 300000);
    this.reconnectAttempts++;

    console.log(`[TelegramListener] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      this.stopHealthCheck();
      this.stopPollingFallback();
      this.listening = false;
      await this.start(callbacks);
    }, delay);
  }

  private startHealthCheck(callbacks: TelegramMessageCallback): void {
    this.stopHealthCheck();

    // Active health check every 30 seconds - actually pings Telegram
    // to detect stale connections and keep the TCP socket alive
    this.healthCheckInterval = setInterval(async () => {
      if (!this.client || !this.listening) return;
      if (this.reconnectTimeout) return; // skip if reconnect pending

      try {
        if (!this.client.connected) {
          console.warn('[TelegramListener] Health check: connection flag is false, reconnecting...');
          this.listening = false;
          await this.updateState({ isListening: false, errorMessage: 'Connection lost (health check)' });
          this.scheduleReconnect(callbacks);
          return;
        }

        // Active ping: call getMe() to keep the connection alive and verify it works
        await this.client.getMe();
      } catch (error) {
        console.error('[TelegramListener] Health check ping failed, reconnecting:', error);
        this.listening = false;
        await this.updateState({ isListening: false, errorMessage: 'Connection stale (ping failed)' });
        this.scheduleReconnect(callbacks);
      }
    }, 30_000);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Polling fallback: every 45 seconds, fetch the latest messages from the channel
   * and persist any that the event handler missed. This is belt-and-suspenders:
   * events give real-time delivery, polling gives reliability.
   */
  private startPollingFallback(callbacks: TelegramMessageCallback): void {
    this.stopPollingFallback();

    this.pollInterval = setInterval(async () => {
      if (!this.client?.connected || !this.listening) return;

      try {
        const messages = await this._fetchMessages(this.client, 5);

        for (const msg of messages) {
          // Skip messages sent before this listener session started
          if (this.listenerStartedAt && msg.date < this.listenerStartedAt) continue;
          // Dedup via DB unique constraint - only new messages get inserted
          try {
            await prisma.telegramChannelMessage.create({
              data: {
                telegramMsgId: msg.id,
                channelId: this.channelId,
                text: msg.text,
                senderName: msg.senderName?.trim() || null,
                hasMedia: msg.hasMedia,
                receivedAt: msg.date,
              },
            });

            // This message was NOT caught by the event handler — process it
            console.log(`[TelegramListener] Poll caught missed message #${msg.id}`);

            await prisma.telegramListenerState.update({
              where: { id: 'singleton' },
              data: {
                lastMessageAt: msg.date,
                totalMessages: { increment: 1 },
              },
            });

            await callbacks.onMessage(msg);
          } catch (e: any) {
            if (e.code === 'P2002') continue; // already in DB, skip
            console.error(`[TelegramListener] Poll error for message #${msg.id}:`, e);
          }
        }
      } catch (error) {
        // Don't reconnect on poll failure — the health check handles that
        console.error('[TelegramListener] Polling fallback error:', error);
      }
    }, 45_000);
  }

  private stopPollingFallback(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async stop(): Promise<void> {
    this.stopHealthCheck();
    this.stopPollingFallback();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.client) {
      // Remove event handler before disconnecting
      if (this.eventHandler) {
        try {
          this.client.removeEventHandler(this.eventHandler, new NewMessage({}));
        } catch { /* ignore */ }
        this.eventHandler = null;
      }
      try {
        await this.client.disconnect();
      } catch (error) {
        console.error('[TelegramListener] Error disconnecting:', error);
      }
      this.client = null;
    }

    this.listening = false;

    await this.updateState({
      isListening: false,
    });

    console.log('[TelegramListener] Stopped');
  }

  async getState() {
    return prisma.telegramListenerState.findUnique({
      where: { id: 'singleton' },
    });
  }

  private async updateState(data: {
    isListening?: boolean;
    startedAt?: Date;
    lastMessageAt?: Date;
    errorMessage?: string | null;
  }): Promise<void> {
    try {
      await prisma.telegramListenerState.upsert({
        where: { id: 'singleton' },
        update: data,
        create: {
          id: 'singleton',
          isListening: data.isListening ?? false,
          channelId: this.channelId,
          startedAt: data.startedAt,
          lastMessageAt: data.lastMessageAt,
          errorMessage: data.errorMessage,
        },
      });
    } catch (error) {
      console.error('[TelegramListener] Error updating state:', error);
    }
  }
}

export const telegramListener = new TelegramListenerService();
