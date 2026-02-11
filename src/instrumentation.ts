export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const autoStart = process.env.BOT_AUTO_START !== 'false';
    if (!autoStart) {
      console.log('[Auto-Start] Disabled via BOT_AUTO_START=false');
      return;
    }

    // Delay to let the Next.js server fully initialize before connecting to MetaAPI/Telegram
    setTimeout(async () => {
      try {
        const { tradingBot } = await import('@/services/bot');
        console.log('[Auto-Start] Starting trading bot...');
        await tradingBot.start();
        console.log('[Auto-Start] Trading bot started successfully');
      } catch (error) {
        console.error('[Auto-Start] Failed to start trading bot:', error);
      }
    }, 5000);
  }
}
