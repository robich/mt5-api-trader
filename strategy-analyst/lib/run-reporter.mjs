import pg from 'pg';
import { randomUUID } from 'crypto';

/**
 * Persist a strategy analyst run to the database.
 * Uses pg directly (no Prisma dependency) so the strategy-analyst
 * container doesn't need the main app's node_modules.
 *
 * @param {object} runData
 * @param {Date}    runData.startedAt
 * @param {number}  runData.durationSeconds
 * @param {string}  runData.status           - SUCCESS | NO_CHANGES | FAILED
 * @param {boolean} [runData.dryRun]
 * @param {string}  [runData.failureStep]
 * @param {string}  [runData.failureReason]
 * @param {string}  [runData.marketAssessment]
 * @param {string}  [runData.riskAssessment]
 * @param {string}  [runData.reasoning]
 * @param {boolean} [runData.codeChanged]
 * @param {number}  [runData.changesProposed]
 * @param {number}  [runData.changesApplied]
 * @param {number}  [runData.changesFailed]
 * @param {Array}   [runData.changesDetail]   - [{file, description}]
 * @param {object}  [runData.backtestBaseline]
 * @param {object}  [runData.backtestValidation]
 * @param {boolean} [runData.backtestPassed]
 * @param {string}  [runData.commitHash]
 * @param {string}  [runData.branch]
 */
/**
 * Check if the bot is currently paused by the strategy analyst (via BotState flag).
 * @returns {boolean} true if BotState.pausedByAnalyst is true
 */
export async function wasBotPreviouslyPaused() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) return false;

  const client = new pg.Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const result = await client.query(
      `SELECT "pausedByAnalyst" FROM "BotState" WHERE id = 'singleton' LIMIT 1`
    );
    const paused = result.rows.length > 0 && result.rows[0].pausedByAnalyst === true;
    if (paused) {
      console.log('[reporter] Bot is currently paused by analyst.');
    }
    return paused;
  } catch (err) {
    console.error('[reporter] Failed to check pause status:', err.message);
    return false;
  } finally {
    await client.end();
  }
}

/**
 * Set or clear the pausedByAnalyst flag on BotState.
 * @param {boolean} paused - Whether to pause or unpause
 * @param {string|null} reason - Reason for pausing (null to clear)
 */
export async function setBotPausedFlag(paused, reason) {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.warn('[reporter] DATABASE_URL not set — cannot update BotState pause flag.');
    return;
  }

  const client = new pg.Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query(
      `UPDATE "BotState" SET "pausedByAnalyst" = $1, "pauseReason" = $2 WHERE id = 'singleton'`,
      [paused, reason]
    );
    console.log(`[reporter] BotState.pausedByAnalyst set to ${paused}.`);
  } catch (err) {
    console.error('[reporter] Failed to update BotState pause flag:', err.message);
  } finally {
    await client.end();
  }
}

export async function persistRun(runData) {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error('DATABASE_URL is not set — cannot persist run');
  }

  const id = randomUUID();
  const client = new pg.Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const query = `
      INSERT INTO "StrategyAnalystRun" (
        "id", "startedAt", "completedAt", "durationSeconds", "status", "dryRun",
        "failureStep", "failureReason", "marketAssessment", "riskAssessment",
        "reasoning", "codeChanged", "changesProposed", "changesApplied",
        "changesFailed", "changesDetail", "backtestBaseline", "backtestValidation",
        "backtestPassed", "commitHash", "branch", "botPaused", "pauseReason"
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, $21, $22, $23
      )
    `;

    const values = [
      id,
      runData.startedAt,
      new Date(),
      runData.durationSeconds,
      runData.status,
      runData.dryRun ?? false,
      runData.failureStep ?? null,
      runData.failureReason ?? null,
      runData.marketAssessment ?? null,
      runData.riskAssessment ?? null,
      runData.reasoning ?? null,
      runData.codeChanged ?? false,
      runData.changesProposed ?? 0,
      runData.changesApplied ?? 0,
      runData.changesFailed ?? 0,
      runData.changesDetail ? JSON.stringify(runData.changesDetail) : null,
      runData.backtestBaseline ? JSON.stringify(runData.backtestBaseline) : null,
      runData.backtestValidation ? JSON.stringify(runData.backtestValidation) : null,
      runData.backtestPassed ?? null,
      runData.commitHash ?? null,
      runData.branch ?? null,
      runData.botPaused ?? false,
      runData.pauseReason ?? null,
    ];

    await client.query(query, values);
    console.log(`[reporter] Run persisted: ${id} (${runData.status})`);
  } finally {
    await client.end();
  }
}
