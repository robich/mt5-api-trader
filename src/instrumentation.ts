export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const autoStart = process.env.BOT_AUTO_START !== 'false';
    if (!autoStart) {
      console.log('[Auto-Start] Disabled via BOT_AUTO_START=false');
      return;
    }

    console.log('[Auto-Start] Scheduling bot startup in 90s (waiting for old deploy to shut down)...');

    // 90s delay: DigitalOcean keeps the old container alive ~30-60s after the new one
    // is healthy. Starting too early causes AUTH_KEY_DUPLICATED because the old process
    // still holds the Telegram session. 90s gives ample time for the old process to die.
    setTimeout(async () => {
      try {
        // Use relative path - @/ alias may not resolve in instrumentation context
        const { tradingBot } = await import('./services/bot');
        console.log('[Auto-Start] Starting trading bot...');
        await tradingBot.start();
        console.log('[Auto-Start] Trading bot started successfully');
      } catch (error) {
        console.error('[Auto-Start] Failed to start trading bot:', error);
      }
    }, 90_000);
  }
}
