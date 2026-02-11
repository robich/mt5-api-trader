/**
 * Custom server entry point.
 * Starts Next.js, then auto-starts the trading bot once the server is ready.
 * On SIGTERM (deploy), gracefully stops the bot so the Telegram session
 * is released before the new process tries to connect.
 */
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';

const port = parseInt(process.env.PORT || '3001', 10);
const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  });

  server.listen(port, () => {
    console.log(`> Server ready on port ${port}`);

    // Auto-start bot by calling the local API endpoint
    if (process.env.BOT_AUTO_START !== 'false') {
      console.log('[Auto-Start] Waiting 5s for server to stabilize...');
      setTimeout(async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/bot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'start' }),
          });
          const data = await res.json();
          console.log('[Auto-Start] Bot started:', data.message || data.error);
        } catch (err) {
          console.error('[Auto-Start] Failed to start bot:', err.message);
        }
      }, 5000);
    }
  });

  // Graceful shutdown: stop the bot and disconnect Telegram before exiting.
  // This prevents AUTH_KEY_DUPLICATED on the next deploy — the old process
  // cleanly releases the Telegram session so the new one can connect.
  const shutdown = async (signal) => {
    console.log(`[Server] ${signal} received, stopping bot...`);
    try {
      await fetch(`http://127.0.0.1:${port}/api/bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
        signal: AbortSignal.timeout(10000),
      });
      console.log('[Server] Bot stopped, closing server...');
    } catch (err) {
      console.error('[Server] Error stopping bot:', err.message);
    }
    server.close(() => {
      console.log('[Server] Server closed');
      process.exit(0);
    });
    // Force exit after 15s if graceful shutdown hangs
    setTimeout(() => process.exit(1), 15000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
});
