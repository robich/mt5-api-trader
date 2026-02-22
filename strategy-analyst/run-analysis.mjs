import 'dotenv/config';
import cron from 'node-cron';
import http from 'node:http';
import { runAnalysis } from './lib/orchestrator.mjs';

const SCHEDULE = process.env.ANALYST_SCHEDULE || '0 3 * * *'; // Default: 3 AM UTC daily
const RUN_ONCE = process.argv.includes('--once');
const TRIGGER_PORT = parseInt(process.env.TRIGGER_PORT || '3002', 10);

// Track running state for the HTTP trigger
let isRunning = false;
let lastTrigger = null;

/**
 * Run analysis with state tracking (used by both cron and HTTP trigger).
 */
async function executeAnalysis(source = 'scheduled') {
  if (isRunning) {
    return { success: false, reason: 'already-running' };
  }
  isRunning = true;
  lastTrigger = { source, startedAt: new Date().toISOString(), status: 'running' };
  try {
    const result = await runAnalysis();
    lastTrigger = { ...lastTrigger, status: result.success ? 'completed' : 'failed', completedAt: new Date().toISOString() };
    return result;
  } catch (err) {
    lastTrigger = { ...lastTrigger, status: 'failed', completedAt: new Date().toISOString(), error: err.message };
    throw err;
  } finally {
    isRunning = false;
  }
}

/**
 * Start a lightweight HTTP server for manual trigger requests.
 */
function startTriggerServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200);
      res.end(JSON.stringify({ isRunning, lastTrigger }));
      return;
    }

    if (req.method === 'POST' && req.url === '/trigger') {
      if (isRunning) {
        res.writeHead(409);
        res.end(JSON.stringify({ success: false, error: 'Analysis is already running' }));
        return;
      }

      // Respond immediately, run analysis in background
      res.writeHead(202);
      res.end(JSON.stringify({ success: true, message: 'Analysis triggered' }));

      console.log(`\n[${new Date().toISOString()}] Manual analysis triggered via HTTP...\n`);
      try {
        const result = await executeAnalysis('manual');
        console.log(`[${new Date().toISOString()}] Manual analysis complete:`, result.success ? 'SUCCESS' : 'FAILED');
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Manual analysis fatal error:`, err);
      }
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(TRIGGER_PORT, '0.0.0.0', () => {
    console.log(`  Trigger:  http://0.0.0.0:${TRIGGER_PORT}/trigger (POST)`);
    console.log(`  Status:   http://0.0.0.0:${TRIGGER_PORT}/status (GET)`);
  });
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         MT5 Strategy Analyst                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`  Schedule: ${SCHEDULE}`);
  console.log(`  Mode:     ${RUN_ONCE ? 'Run once' : 'Scheduled'}`);
  console.log(`  Dry run:  ${process.env.DRY_RUN === 'true' ? 'YES' : 'NO'}`);
  console.log('');

  // Validate required env vars
  const required = ['ANTHROPIC_API_KEY', 'GIT_REPO_URL', 'GIT_TOKEN', 'META_API_TOKEN', 'META_API_ACCOUNT_ID', 'DATABASE_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (RUN_ONCE) {
    // Run immediately and exit
    console.log('Running analysis now...\n');
    const result = await runAnalysis();
    console.log('\nResult:', JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  }

  // Scheduled mode
  if (!cron.validate(SCHEDULE)) {
    console.error(`Invalid cron schedule: ${SCHEDULE}`);
    process.exit(1);
  }

  // Start HTTP trigger server
  startTriggerServer();

  console.log(`  Scheduled. Next run at cron: ${SCHEDULE}`);
  console.log('  Waiting...\n');

  cron.schedule(SCHEDULE, async () => {
    console.log(`\n[${new Date().toISOString()}] Scheduled analysis starting...\n`);
    try {
      const result = await executeAnalysis('scheduled');
      console.log(`[${new Date().toISOString()}] Analysis complete:`, result.success ? 'SUCCESS' : 'FAILED');
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Fatal error:`, err);
    }
  }, {
    timezone: 'UTC',
  });

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('\nShutting down Strategy Analyst...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down Strategy Analyst...');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
