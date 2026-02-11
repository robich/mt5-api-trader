/**
 * Custom server entry point.
 * Starts Next.js, then auto-starts the trading bot once the server is ready.
 * This replaces `next start` so the bot starts on deploy without any page visit.
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
});
