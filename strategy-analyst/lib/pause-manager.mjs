import pg from 'pg';

/**
 * Set the bot pause state in the database.
 * Uses raw pg (no Prisma) so the strategy-analyst container stays independent.
 *
 * @param {boolean} isPaused  - Whether to pause or resume
 * @param {string}  [reason]  - Why the bot is being paused/resumed
 */
export async function setBotPauseState(isPaused, reason) {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.warn('[pause-manager] DATABASE_URL not set — cannot update pause state');
    return;
  }

  const client = new pg.Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const now = new Date();

    // Upsert the singleton row
    const query = `
      INSERT INTO "BotPauseState" ("id", "isPaused", "reason", "pausedBy", "pausedAt", "resumedAt", "updatedAt")
      VALUES ('singleton', $1, $2, 'analyst', $3, $4, $5)
      ON CONFLICT ("id") DO UPDATE SET
        "isPaused"  = $1,
        "reason"    = $2,
        "pausedBy"  = CASE WHEN $1 THEN 'analyst' ELSE "BotPauseState"."pausedBy" END,
        "pausedAt"  = CASE WHEN $1 THEN $3 ELSE "BotPauseState"."pausedAt" END,
        "resumedAt" = CASE WHEN NOT $1 THEN $4 ELSE "BotPauseState"."resumedAt" END,
        "updatedAt" = $5
    `;

    const values = [
      isPaused,
      isPaused ? (reason || null) : null,
      isPaused ? now : null,   // pausedAt
      isPaused ? null : now,   // resumedAt
      now,                     // updatedAt
    ];

    await client.query(query, values);
    const action = isPaused ? 'PAUSED' : 'RESUMED';
    console.log(`[pause-manager] Trading ${action}${reason ? `: ${reason}` : ''}`);
  } finally {
    await client.end();
  }
}

/**
 * Get the current bot pause state from the database.
 *
 * @returns {{ isPaused: boolean, reason: string|null } | null}
 */
export async function getBotPauseState() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) return null;

  const client = new pg.Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const result = await client.query(
      `SELECT "isPaused", "reason" FROM "BotPauseState" WHERE "id" = 'singleton'`
    );
    if (result.rows.length === 0) return { isPaused: false, reason: null };
    return { isPaused: result.rows[0].isPaused, reason: result.rows[0].reason };
  } finally {
    await client.end();
  }
}
