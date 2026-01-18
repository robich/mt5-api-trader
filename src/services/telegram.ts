/**
 * Telegram Notification Service
 * Sends trade notifications to a Telegram chat
 */

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

interface TradeInfo {
  symbol: string;
  direction: 'BUY' | 'SELL';
  strategy: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  riskAmount: number;
  riskRewardRatio: number;
}

interface ClosedTradeInfo {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  profit: number;
  lotSize?: number;
}

interface OpenPosition {
  symbol: string;
  direction: string;
  entryPrice: number;
  currentPrice: number;
  profit: number;
  lotSize: number;
}

class TelegramNotifier {
  private config: TelegramConfig | null = null;
  private enabled = false;

  initialize(): void {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

    console.log('[Telegram] Initializing...', {
      hasBotToken: !!botToken,
      hasChatId: !!chatId,
      botTokenLength: botToken?.length || 0,
      chatIdLength: chatId?.length || 0,
    });

    if (botToken && chatId) {
      this.config = { botToken, chatId };
      this.enabled = true;
      console.log('[Telegram] Notifications enabled');
    } else {
      console.log('[Telegram] Notifications disabled (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private async sendMessage(text: string): Promise<void> {
    if (!this.enabled || !this.config) return;

    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Telegram] Failed to send message:', error);
      }
    } catch (error) {
      console.error('[Telegram] Error sending message:', error);
    }
  }

  private formatPrice(price: number, symbol: string): string {
    // Format price based on symbol type
    if (symbol.includes('BTC') || symbol.includes('XAU') || symbol.includes('XAG')) {
      return price.toFixed(2);
    }
    return price.toFixed(5);
  }

  private formatOpenPositionsSummary(positions: OpenPosition[]): string {
    if (positions.length === 0) {
      return '\n📊 <b>No open positions</b>';
    }

    const totalProfit = positions.reduce((sum, p) => sum + p.profit, 0);
    const profitEmoji = totalProfit >= 0 ? '🟢' : '🔴';

    let summary = `\n📊 <b>Open Positions (${positions.length})</b>\n`;
    summary += `${profitEmoji} Total P/L: <b>$${totalProfit.toFixed(2)}</b>\n`;
    summary += '─────────────────\n';

    for (const pos of positions) {
      const emoji = pos.profit >= 0 ? '✅' : '❌';
      const dir = pos.direction === 'BUY' ? '🟢' : '🔴';
      summary += `${dir} ${pos.symbol}: ${emoji} $${pos.profit.toFixed(2)}\n`;
    }

    return summary;
  }

  async notifyTradeOpened(trade: TradeInfo, openPositions: OpenPosition[]): Promise<void> {
    const dirEmoji = trade.direction === 'BUY' ? '🟢 LONG' : '🔴 SHORT';
    const rr = trade.riskRewardRatio.toFixed(1);

    let message = `🔔 <b>TRADE OPENED</b>\n\n`;
    message += `${dirEmoji} <b>${trade.symbol}</b>\n`;
    message += `📈 Strategy: ${trade.strategy}\n`;
    message += `─────────────────\n`;
    message += `Entry: ${this.formatPrice(trade.entryPrice, trade.symbol)}\n`;
    message += `SL: ${this.formatPrice(trade.stopLoss, trade.symbol)}\n`;
    message += `TP: ${this.formatPrice(trade.takeProfit, trade.symbol)}\n`;
    message += `─────────────────\n`;
    message += `Size: ${trade.lotSize} lots\n`;
    message += `Risk: $${trade.riskAmount.toFixed(2)}\n`;
    message += `R:R: 1:${rr}\n`;
    message += this.formatOpenPositionsSummary(openPositions);

    await this.sendMessage(message);
  }

  async notifyTradeClosed(trade: ClosedTradeInfo, openPositions: OpenPosition[]): Promise<void> {
    const resultEmoji = trade.profit >= 0 ? '✅ WIN' : '❌ LOSS';
    const profitSign = trade.profit >= 0 ? '+' : '';

    let message = `🔔 <b>TRADE CLOSED</b>\n\n`;
    message += `${resultEmoji} <b>${trade.symbol}</b>\n`;
    message += `─────────────────\n`;
    message += `Entry: ${this.formatPrice(trade.entryPrice, trade.symbol)}\n`;
    message += `Exit: ${this.formatPrice(trade.exitPrice, trade.symbol)}\n`;
    message += `P/L: <b>${profitSign}$${trade.profit.toFixed(2)}</b>\n`;
    message += this.formatOpenPositionsSummary(openPositions);

    await this.sendMessage(message);
  }

  async sendTestMessage(): Promise<{ success: boolean; message: string }> {
    if (!this.enabled || !this.config) {
      return {
        success: false,
        message: 'Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env',
      };
    }

    try {
      const timestamp = new Date().toLocaleString();
      const testMessage = `🧪 <b>Test Message</b>\n\n` +
        `This is a test notification from MT5 API Trader.\n` +
        `─────────────────\n` +
        `✅ Bot Token: Configured\n` +
        `✅ Chat ID: Configured\n` +
        `🕐 Timestamp: ${timestamp}`;

      const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text: testMessage,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Telegram] Test message failed:', error);
        return {
          success: false,
          message: `Failed to send test message: ${error}`,
        };
      }

      return {
        success: true,
        message: 'Test message sent successfully',
      };
    } catch (error) {
      console.error('[Telegram] Test message error:', error);
      return {
        success: false,
        message: `Error sending test message: ${error}`,
      };
    }
  }
}

export const telegramNotifier = new TelegramNotifier();
