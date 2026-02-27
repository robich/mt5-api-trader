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

/** Build Basic Auth header from env vars (used by middleware). */
function internalAuthHeaders() {
  const user = process.env.AUTH_USER;
  const pass = process.env.AUTH_PASS;
  if (!user || !pass) return {};
  return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  });

  server.listen(port, () => {
    console.log(`> Server ready on port ${port}`);

    // Auto-start bot only if it was running before the last shutdown.
    // The graceful-stop action preserves BotState.isRunning=true in DB,
    // so we check that flag to decide whether to restart.
    if (process.env.BOT_AUTO_START !== 'false') {
      // Auto-start bot after 5s
      console.log('[Auto-Start] Waiting 5s for server to stabilize...');
      setTimeout(async () => {
        try {
          const stateRes = await fetch(`http://127.0.0.1:${port}/api/bot-state`, {
            headers: internalAuthHeaders(),
          });
          const stateData = await stateRes.json();

          if (stateData.wasRunning) {
            console.log('[Auto-Start] Bot was previously running — restarting...');
            const res = await fetch(`http://127.0.0.1:${port}/api/bot`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...internalAuthHeaders() },
              body: JSON.stringify({ action: 'start' }),
            });
            const data = await res.json();
            console.log('[Auto-Start] Bot started:', data.message || data.error);
          } else {
            console.log('[Auto-Start] Bot was not running before shutdown — skipping auto-start');
          }
        } catch (err) {
          console.error('[Auto-Start] Failed to check/start bot:', err.message);
        }
      }, 5000);

      // Auto-start Telegram listener after 60s — needs extra delay so the old
      // process's session is fully released on Telegram's servers.
      // This runs independently of the bot.
      setTimeout(async () => {
        try {
          const stateRes = await fetch(`http://127.0.0.1:${port}/api/bot-state`, {
            headers: internalAuthHeaders(),
          });
          const stateData = await stateRes.json();

          if (stateData.telegramWasListening) {
            console.log('[Auto-Start] Telegram listener was previously running — restarting...');
            const tlRes = await fetch(`http://127.0.0.1:${port}/api/telegram-listener`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...internalAuthHeaders() },
              body: JSON.stringify({ action: 'start' }),
            });
            const tlData = await tlRes.json();
            console.log('[Auto-Start] Telegram listener:', tlData.message || tlData.error);
          }
        } catch (err) {
          console.error('[Auto-Start] Failed to start Telegram listener:', err.message);
        }
      }, 60000);
    }
  });

  // Graceful shutdown: stop the bot and disconnect Telegram before exiting.
  // This prevents AUTH_KEY_DUPLICATED on the next deploy — the old process
  // cleanly releases the Telegram session so the new one can connect.
  const shutdown = async (signal) => {
    console.log(`[Server] ${signal} received, stopping services...`);
    try {
      // Stop Telegram listener first — releases the session cleanly
      // so the next deploy can connect without AUTH_KEY_DUPLICATED
      // Uses graceful-stop to preserve DB isListening=true for auto-restart
      await fetch(`http://127.0.0.1:${port}/api/telegram-listener`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalAuthHeaders() },
        body: JSON.stringify({ action: 'graceful-stop' }),
        signal: AbortSignal.timeout(5000),
      }).then(() => console.log('[Server] Telegram listener stopped (graceful)'))
        .catch(err => console.error('[Server] Error stopping Telegram listener:', err.message));

      // Stop the bot (graceful — preserves DB isRunning for auto-restart)
      await fetch(`http://127.0.0.1:${port}/api/bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalAuthHeaders() },
        body: JSON.stringify({ action: 'graceful-stop' }),
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
