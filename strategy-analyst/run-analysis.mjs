import 'dotenv/config';
import cron from 'node-cron';
import pg from 'pg';
import { runAnalysis } from './lib/orchestrator.mjs';

const SCHEDULE = process.env.ANALYST_SCHEDULE || '0 3 * * *'; // Default: 3 AM UTC daily
const RUN_ONCE = process.argv.includes('--once');
const POLL_INTERVAL = parseInt(process.env.TRIGGER_POLL_INTERVAL || '30000', 10); // 30s default
const STALE_TRIGGER_MINUTES = 30;

let isRunning = false;

/**
 * Run analysis with state tracking (used by both cron and DB trigger).
 */
async function executeAnalysis(source = 'scheduled') {
  if (isRunning) {
    return { success: false, reason: 'already-running' };
  }
  isRunning = true;
  try {
    console.log(`\n[${new Date().toISOString()}] Analysis starting (source: ${source})...\n`);
    const result = await runAnalysis();
    console.log(`[${new Date().toISOString()}] Analysis complete:`, result.success ? 'SUCCESS' : 'FAILED');
    return result;
  } finally {
    isRunning = false;
  }
}

/**
 * Create a short-lived DB client for trigger polling.
 */
function createClient() {
  return new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

/**
 * Expire any PENDING/RUNNING triggers older than STALE_TRIGGER_MINUTES.
 * Handles the case where the process was killed mid-run (e.g. by a deployment).
 */
async function expireStaleTriggers() {
  let client;
  try {
    client = createClient();
    await client.connect();
    const { rowCount } = await client.query(
      `UPDATE "StrategyAnalystTrigger"
       SET "status" = 'FAILED', "completedAt" = NOW(),
           "result" = '{"success":false,"reason":"expired-stale-trigger"}'
       WHERE "status" IN ('PENDING', 'RUNNING')
         AND "requestedAt" < NOW() - INTERVAL '${STALE_TRIGGER_MINUTES} minutes'`
    );
    await client.end();
    if (rowCount > 0) {
      console.log(`[trigger] Expired ${rowCount} stale trigger(s) older than ${STALE_TRIGGER_MINUTES}m`);
    }
  } catch (err) {
    console.error('[trigger] Error expiring stale triggers:', err.message);
    if (client) {
      try { await client.end(); } catch {}
    }
  }
}

/**
 * Poll the database for PENDING trigger requests.
 * Claims the trigger by setting status=RUNNING, runs analysis,
 * then marks it COMPLETED or FAILED.
 */
async function pollForTriggers() {
  if (isRunning) return;

  let client;
  try {
    client = createClient();
    await client.connect();

    // Atomically claim the oldest PENDING trigger
    const { rows } = await client.query(`
      UPDATE "StrategyAnalystTrigger"
      SET "status" = 'RUNNING', "startedAt" = NOW()
      WHERE "id" = (
        SELECT "id" FROM "StrategyAnalystTrigger"
        WHERE "status" = 'PENDING'
        ORDER BY "requestedAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"
    `);

    await client.end();
    client = null;

    if (rows.length === 0) return;

    const triggerId = rows[0].id;
    console.log(`[trigger] Picked up manual trigger: ${triggerId}`);

    let result;
    try {
      result = await executeAnalysis('manual');
    } catch (err) {
      result = { success: false, error: err.message };
    }

    // Update trigger with result
    const done = createClient();
    await done.connect();
    await done.query(
      `UPDATE "StrategyAnalystTrigger"
       SET "status" = $1, "completedAt" = NOW(), "result" = $2
       WHERE "id" = $3`,
      [
        result.success ? 'COMPLETED' : 'FAILED',
        JSON.stringify({ success: result.success, reason: result.reason || null }),
        triggerId,
      ]
    );
    await done.end();
  } catch (err) {
    // Don't crash the process on polling errors
    console.error('[trigger] Poll error:', err.message);
    if (client) {
      try { await client.end(); } catch {}
    }
  }
}

/**
 * Start polling the DB for manual trigger requests.
 */
async function startTriggerPoller() {
  console.log(`  Trigger:  DB polling every ${POLL_INTERVAL / 1000}s`);
  // On startup, expire any stale triggers left over from a previous crash/deployment
  await expireStaleTriggers();
  setInterval(pollForTriggers, POLL_INTERVAL);
  // Also poll immediately on startup to catch any triggers that arrived while offline
  pollForTriggers();
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

  // Start DB trigger poller (also expires stale triggers from previous runs)
  await startTriggerPoller();

  console.log(`  Scheduled. Next run at cron: ${SCHEDULE}`);
  console.log('  Waiting...\n');

  cron.schedule(SCHEDULE, async () => {
    try {
      await executeAnalysis('scheduled');
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
