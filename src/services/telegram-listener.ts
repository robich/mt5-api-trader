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
  private lastCallbacks: TelegramMessageCallback | null = null;

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

  /**
   * Get or create the singleton TelegramClient.
   * The client is created once and reused for the entire service lifetime.
   * This avoids AUTH_KEY_DUPLICATED errors caused by multiple InvokeWithLayer calls.
   */
  private getOrCreateClient(): TelegramClient {
    if (!this.client) {
      const session = new StringSession(this.sessionString);
      this.client = new TelegramClient(session, this.apiId, this.apiHash, {
        connectionRetries: 5,
      });
    }
    return this.client;
  }

  /**
   * Ensure the singleton client is connected.
   * If already connected, returns immediately.
   */
  private async ensureConnected(): Promise<TelegramClient> {
    const client = this.getOrCreateClient();
    if (!client.connected) {
      await client.connect();
    }
    return client;
  }

  /**
   * Fetch the latest messages from the channel on demand.
   * Reuses the singleton client — never creates a second connection.
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

    const client = await this.ensureConnected();
    return this._fetchMessages(client, count);
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

      // Resolve the channel entity to get its numeric ID
      const channelEntity = await client.getEntity(this.channelId);
      const channelPeerId = (channelEntity as any).id;
      console.log('[TelegramListener] Resolved channel:', (channelEntity as any).title || this.channelId, `(id: ${channelPeerId})`);

      // Register new message handler filtered to channel
      // gramjs NewMessage chats filter needs numeric IDs, not entity objects
      client.addEventHandler(
        async (event: NewMessageEvent) => {
          await this.handleNewMessage(event, callbacks);
        },
        new NewMessage({
          chats: [channelPeerId],
        })
      );

      this.listening = true;
      this.reconnectAttempts = 0;
      this.lastCallbacks = callbacks;

      // Periodic health check - reconnect if connection is lost
      this.startHealthCheck(callbacks);

      // Update DB state
      await this.updateState({
        isListening: true,
        startedAt: new Date(),
        errorMessage: null,
      });

      console.log('[TelegramListener] Listening for messages (persistent mode)');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[TelegramListener] Failed to start:', errMsg);

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
      this.listening = false;
      await this.start(callbacks);
    }, delay);
  }

  private startHealthCheck(callbacks: TelegramMessageCallback): void {
    this.stopHealthCheck();

    // Check every 60 seconds if still connected
    this.healthCheckInterval = setInterval(async () => {
      if (!this.client || !this.listening) return;

      // Skip if a reconnect is already scheduled
      if (this.reconnectTimeout) return;

      try {
        const connected = this.client.connected;
        if (!connected) {
          console.warn('[TelegramListener] Health check: connection lost, reconnecting...');
          this.listening = false;
          await this.updateState({ isListening: false, errorMessage: 'Connection lost (health check)' });
          this.scheduleReconnect(callbacks);
        }
      } catch (error) {
        console.error('[TelegramListener] Health check error:', error);
        this.listening = false;
        this.scheduleReconnect(callbacks);
      }
    }, 60_000);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  async stop(): Promise<void> {
    this.stopHealthCheck();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.client) {
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
