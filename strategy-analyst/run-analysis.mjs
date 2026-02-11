import 'dotenv/config';
import cron from 'node-cron';
import { runAnalysis } from './lib/orchestrator.mjs';

const SCHEDULE = process.env.ANALYST_SCHEDULE || '0 3 * * *'; // Default: 3 AM UTC daily
const RUN_ONCE = process.argv.includes('--once');

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         MT5 Strategy Analyst                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`  Schedule: ${SCHEDULE}`);
  console.log(`  Mode:     ${RUN_ONCE ? 'Run once' : 'Scheduled'}`);
  console.log(`  Dry run:  ${process.env.DRY_RUN === 'true' ? 'YES' : 'NO'}`);
  console.log('');

  // Validate required env vars
  const required = ['ANTHROPIC_API_KEY', 'GIT_REPO_URL', 'GIT_TOKEN', 'META_API_TOKEN', 'META_API_ACCOUNT_ID'];
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

  console.log(`Scheduled. Next run at cron: ${SCHEDULE}`);
  console.log('Waiting...\n');

  cron.schedule(SCHEDULE, async () => {
    console.log(`\n[${new Date().toISOString()}] Scheduled analysis starting...\n`);
    try {
      const result = await runAnalysis();
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
