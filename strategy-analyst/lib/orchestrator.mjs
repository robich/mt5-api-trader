import { clone, createBranch, commitAndPush, rollback, getWorkDir, countChangedLines } from './git-manager.mjs';
import { runBacktests, compareResults, formatResultsForPrompt, evaluateBaselinePerformance } from './backtest-runner.mjs';
import { fetchMarketNews } from './news-fetcher.mjs';
import { analyzeStrategies, reviewChanges, fixCompilationErrors } from './claude-analyst.mjs';
import { applyChanges } from './code-applier.mjs';
import { validateChanges, validateDiffSize, checkTypeScript, validateModifiedFiles, hardLimits } from './safety-validator.mjs';
import { sendReport, sendError, sendNoChanges, sendBotPaused, sendBotResumed } from './telegram-notifier.mjs';
import { persistRun, wasBotPreviouslyPaused } from './run-reporter.mjs';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

const DRY_RUN = process.env.DRY_RUN === 'true';
const MAX_TSC_RETRIES = 2;
const BOT_API_URL = process.env.BOT_API_URL; // e.g. http://trading-bot:3000

/**
 * Run the full strategy analysis pipeline.
 */
export async function runAnalysis() {
  const startTime = Date.now();
  const startedAt = new Date();
  const date = new Date().toISOString().split('T')[0];

  console.log('═'.repeat(60));
  console.log(`  Strategy Analyst — ${date}`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('═'.repeat(60));

  let repoDir;

  // Check if the bot was paused by a previous run (e.g. yesterday).
  // If so, we'll restart it when this run finds a good strategy.
  let previouslyPaused = false;
  try {
    previouslyPaused = await wasBotPreviouslyPaused();
  } catch (err) {
    console.warn('[init] Could not check previous pause status:', err.message);
  }

  try {
    // ── Step 1: Clone repository ──
    console.log('\n[1/10] Cloning repository...');
    repoDir = clone();

    // Install dependencies for backtest + tsc
    // Use pre-cached node_modules from Docker build to avoid running npm ci
    // at runtime (which fails in sandboxed environments like DigitalOcean)
    console.log('\n[2/10] Installing dependencies...');
    const depsCache = '/app-deps-cache/node_modules';
    if (existsSync(depsCache)) {
      console.log('[deps] Symlinking pre-cached node_modules...');
      execSync(`ln -s ${depsCache} node_modules`, { cwd: repoDir, stdio: 'pipe' });
    } else {
      console.log('[deps] No cache found, running npm ci...');
      execSync('npm ci --ignore-scripts', { cwd: repoDir, stdio: 'pipe', timeout: 180_000 });
      execSync('npx prisma generate', { cwd: repoDir, stdio: 'pipe', timeout: 60_000 });
    }

    // ── Step 2: Baseline backtest ──
    console.log('\n[3/10] Running baseline backtests...');
    const baseline = await runBacktests(repoDir);
    const baselineFormatted = formatResultsForPrompt(baseline);
    console.log('[baseline]', baselineFormatted.substring(0, 300) + '...');

    // ── Step 2b: Evaluate baseline performance ──
    // Flag poor performance but don't pause yet — let the analyst try to optimize first.
    // The bot is only paused at the end if no better strategy was found.
    let baselinePoor = false;
    let botPaused = false;
    let pauseReason = null;
    if (hardLimits.pauseThresholds) {
      const perfEval = evaluateBaselinePerformance(baseline, hardLimits.pauseThresholds);
      if (perfEval.shouldPause) {
        baselinePoor = true;
        pauseReason = perfEval.reasons.join('; ');
        console.warn(`\n[WARN] Strategy performance is poor — ${perfEval.failingSymbols.length} symbol(s) failing:`);
        for (const reason of perfEval.reasons) {
          console.warn(`  • ${reason}`);
        }
        console.log('[WARN] Will pause bot if no improved strategy is found.');
      } else {
        console.log('[baseline] Performance within acceptable thresholds.');
      }
    }

    // ── Step 3: Fetch news ──
    console.log('\n[4/10] Fetching market news...');
    const news = await fetchMarketNews();

    // ── Step 4: Claude Analysis ──
    console.log('\n[5/10] Running Claude analysis...');
    const analysis = await analyzeStrategies({
      backtestResults: baselineFormatted,
      newsSummary: news.summary,
      repoDir,
    });

    // Check if no changes recommended
    if (analysis.noChangeRecommended || !analysis.changes || analysis.changes.length === 0) {
      console.log('\n[result] No changes recommended.');

      // Pause the bot if baseline was poor and analyst found nothing better
      if (baselinePoor) {
        botPaused = await pauseBotIfPoor(pauseReason, DRY_RUN);
      }

      await sendNoChanges(analysis.marketAssessment);
      logDuration(startTime);
      await persistRun({
        startedAt,
        durationSeconds: (Date.now() - startTime) / 1000,
        status: 'NO_CHANGES',
        dryRun: DRY_RUN,
        marketAssessment: analysis.marketAssessment,
        riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning,
        backtestBaseline: baseline,
        botPaused,
        pauseReason,
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: true, noChanges: true, botPaused };
    }

    console.log(`\n[analysis] ${analysis.changes.length} change(s) proposed.`);

    // ── Step 5: Safety review (Phase 2) ──
    console.log('\n[6/10] Running safety review...');
    const review = await reviewChanges({
      changes: analysis.changes,
      repoDir,
    });

    if (!review.approved) {
      console.error('[review] Changes REJECTED by reviewer:', review.issues);
      if (baselinePoor) botPaused = await pauseBotIfPoor(pauseReason, DRY_RUN);
      await sendError(`Safety review rejected: ${review.issues.join('; ')}`, 'safety-review');
      logDuration(startTime);
      await persistRun({
        startedAt, durationSeconds: (Date.now() - startTime) / 1000,
        status: 'FAILED', dryRun: DRY_RUN, failureStep: 'safety-review',
        failureReason: review.issues.join('; '),
        marketAssessment: analysis.marketAssessment, riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning, changesProposed: analysis.changes.length,
        backtestBaseline: baseline, botPaused, pauseReason,
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: false, reason: 'review-rejected', issues: review.issues };
    }

    // ── Step 6: Pre-apply validation ──
    console.log('\n[7/10] Validating changes...');
    const preValidation = validateChanges(analysis.changes, repoDir);
    if (!preValidation.passed) {
      console.error('[validate] Pre-apply validation FAILED:', preValidation.errors);
      if (baselinePoor) botPaused = await pauseBotIfPoor(pauseReason, DRY_RUN);
      await sendError(`Validation failed: ${preValidation.errors.join('; ')}`, 'pre-validation');
      logDuration(startTime);
      await persistRun({
        startedAt, durationSeconds: (Date.now() - startTime) / 1000,
        status: 'FAILED', dryRun: DRY_RUN, failureStep: 'pre-validation',
        failureReason: preValidation.errors.join('; '),
        marketAssessment: analysis.marketAssessment, riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning, changesProposed: analysis.changes.length,
        backtestBaseline: baseline, botPaused, pauseReason,
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: false, reason: 'validation-failed', errors: preValidation.errors };
    }

    // ── Step 7: Apply changes ──
    console.log('\n[8/10] Applying changes...');
    const { applied, failed, modifiedFiles } = applyChanges(analysis.changes, repoDir);

    if (applied.length === 0) {
      console.error('[apply] No changes could be applied.');
      if (baselinePoor) botPaused = await pauseBotIfPoor(pauseReason, DRY_RUN);
      await sendError(`All ${failed.length} changes failed to apply`, 'apply');
      logDuration(startTime);
      await persistRun({
        startedAt, durationSeconds: (Date.now() - startTime) / 1000,
        status: 'FAILED', dryRun: DRY_RUN, failureStep: 'apply',
        failureReason: `All ${failed.length} changes failed to apply`,
        marketAssessment: analysis.marketAssessment, riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning, changesProposed: analysis.changes.length,
        changesFailed: failed.length, backtestBaseline: baseline,
        botPaused, pauseReason,
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: false, reason: 'apply-failed', failed };
    }

    // Validate diff size
    const changedLines = countChangedLines();
    const diffCheck = validateDiffSize(changedLines);
    if (!diffCheck.passed) {
      console.error('[validate] Diff too large:', diffCheck.errors);
      rollback();
      if (baselinePoor) botPaused = await pauseBotIfPoor(pauseReason, DRY_RUN);
      await sendError(diffCheck.errors.join('; '), 'diff-size');
      logDuration(startTime);
      await persistRun({
        startedAt, durationSeconds: (Date.now() - startTime) / 1000,
        status: 'FAILED', dryRun: DRY_RUN, failureStep: 'diff-size',
        failureReason: diffCheck.errors.join('; '),
        marketAssessment: analysis.marketAssessment, riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning, changesProposed: analysis.changes.length,
        changesApplied: applied.length, changesFailed: failed.length,
        changesDetail: applied.map(a => ({ file: a.file, description: a.description })),
        backtestBaseline: baseline, botPaused, pauseReason,
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: false, reason: 'diff-too-large', errors: diffCheck.errors };
    }

    // Validate modified file contents
    const fileCheck = validateModifiedFiles(modifiedFiles, repoDir);
    if (!fileCheck.passed) {
      console.error('[validate] Modified files contain dangerous patterns:', fileCheck.errors);
      rollback();
      if (baselinePoor) botPaused = await pauseBotIfPoor(pauseReason, DRY_RUN);
      await sendError(fileCheck.errors.join('; '), 'file-validation');
      logDuration(startTime);
      await persistRun({
        startedAt, durationSeconds: (Date.now() - startTime) / 1000,
        status: 'FAILED', dryRun: DRY_RUN, failureStep: 'file-validation',
        failureReason: fileCheck.errors.join('; '),
        marketAssessment: analysis.marketAssessment, riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning, changesProposed: analysis.changes.length,
        changesApplied: applied.length, changesFailed: failed.length,
        changesDetail: applied.map(a => ({ file: a.file, description: a.description })),
        backtestBaseline: baseline, botPaused, pauseReason,
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: false, reason: 'file-validation-failed', errors: fileCheck.errors };
    }

    // ── Step 8: TypeScript compilation ──
    console.log('\n[9/10] TypeScript compilation check...');
    let tscResult = checkTypeScript(repoDir);
    let tscRetries = 0;

    while (!tscResult.passed && tscRetries < MAX_TSC_RETRIES) {
      tscRetries++;
      console.log(`[tsc] Attempting auto-fix (retry ${tscRetries}/${MAX_TSC_RETRIES})...`);

      const fix = await fixCompilationErrors({
        errors: tscResult.errors,
        changes: analysis.changes,
        repoDir,
      });

      if (!fix || !fix.changes || fix.changes.length === 0) {
        console.error('[tsc] Could not generate fix.');
        break;
      }

      // Validate fix changes
      const fixValidation = validateChanges(fix.changes, repoDir);
      if (!fixValidation.passed) {
        console.error('[tsc] Fix changes failed validation:', fixValidation.errors);
        break;
      }

      applyChanges(fix.changes, repoDir);
      tscResult = checkTypeScript(repoDir);
    }

    if (!tscResult.passed) {
      console.error('[tsc] TypeScript compilation FAILED after retries. Rolling back.');
      rollback();
      if (baselinePoor) botPaused = await pauseBotIfPoor(pauseReason, DRY_RUN);
      await sendError(`TypeScript compilation failed:\n${tscResult.errors[0]?.substring(0, 300)}`, 'tsc');
      logDuration(startTime);
      await persistRun({
        startedAt, durationSeconds: (Date.now() - startTime) / 1000,
        status: 'FAILED', dryRun: DRY_RUN, failureStep: 'tsc',
        failureReason: tscResult.errors.join('\n').substring(0, 2000),
        marketAssessment: analysis.marketAssessment, riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning, codeChanged: true,
        changesProposed: analysis.changes.length, changesApplied: applied.length,
        changesFailed: failed.length,
        changesDetail: applied.map(a => ({ file: a.file, description: a.description })),
        backtestBaseline: baseline, botPaused, pauseReason,
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: false, reason: 'tsc-failed', errors: tscResult.errors };
    }

    // ── Step 9: Validation backtest ──
    console.log('\n[10/10] Running validation backtests...');
    const validation = await runBacktests(repoDir);
    const comparison = compareResults(baseline, validation, hardLimits.backtestGates);

    if (!comparison.allPassed) {
      console.error('[backtest] Validation backtests FAILED gate checks.');
      for (const [symbol, detail] of Object.entries(comparison.details)) {
        if (!detail.passed) {
          console.error(`  ${symbol}: ${detail.failures?.join(', ')}`);
        }
      }
      rollback();
      if (baselinePoor) botPaused = await pauseBotIfPoor(pauseReason, DRY_RUN);
      await sendReport({
        date,
        marketAssessment: analysis.marketAssessment,
        applied,
        failed,
        comparison,
        riskAssessment: analysis.riskAssessment,
        redeployed: false,
      });
      logDuration(startTime);
      await persistRun({
        startedAt, durationSeconds: (Date.now() - startTime) / 1000,
        status: 'FAILED', dryRun: DRY_RUN, failureStep: 'backtest-validation',
        failureReason: Object.entries(comparison.details)
          .filter(([, d]) => !d.passed)
          .map(([s, d]) => `${s}: ${d.failures?.join(', ')}`)
          .join('; '),
        marketAssessment: analysis.marketAssessment, riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning, codeChanged: true,
        changesProposed: analysis.changes.length, changesApplied: applied.length,
        changesFailed: failed.length,
        changesDetail: applied.map(a => ({ file: a.file, description: a.description })),
        backtestBaseline: baseline, backtestValidation: validation,
        backtestPassed: false, botPaused, pauseReason,
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: false, reason: 'backtest-gate-failed', comparison };
    }

    // ── Step 10: Commit & push ──
    let commit = null;
    if (!DRY_RUN) {
      console.log('\n[commit] Committing and pushing...');
      const branch = createBranch();
      const message = buildCommitMessage(analysis, applied, comparison);
      commit = commitAndPush(modifiedFiles, message);

      // Trigger redeploy if configured
      await triggerRedeploy();

      // Resume bot if it was paused by a previous run (or this run's baseline flagged poor
      // but the optimization succeeded, so no pause was triggered).
      if (previouslyPaused) {
        console.log('\n[resume] Bot was paused by a previous run — restarting with improved strategy...');
        await resumeBot();
      } else if (baselinePoor) {
        console.log('[OK] Baseline was poor but optimization succeeded — bot keeps running with improved strategy.');
      }
    } else {
      console.log('\n[dry-run] Skipping commit/push.');
    }

    // ── Notify ──
    await sendReport({
      date,
      marketAssessment: analysis.marketAssessment,
      applied,
      failed,
      comparison,
      commit,
      riskAssessment: analysis.riskAssessment,
      redeployed: !DRY_RUN,
    });

    logDuration(startTime);
    await persistRun({
      startedAt,
      durationSeconds: (Date.now() - startTime) / 1000,
      status: 'SUCCESS',
      dryRun: DRY_RUN,
      marketAssessment: analysis.marketAssessment,
      riskAssessment: analysis.riskAssessment,
      reasoning: analysis.reasoning,
      codeChanged: true,
      changesProposed: analysis.changes.length,
      changesApplied: applied.length,
      changesFailed: failed.length,
      changesDetail: applied.map(a => ({ file: a.file, description: a.description })),
      backtestBaseline: baseline,
      backtestValidation: validation,
      backtestPassed: comparison.allPassed,
      commitHash: commit?.hash ?? null,
      branch: commit?.branch ?? null,
      botPaused,
      pauseReason,
    }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
    return { success: true, applied, commit, comparison };

  } catch (err) {
    console.error('\n[FATAL]', err);
    await sendError(err.message || String(err), 'orchestrator');
    if (repoDir) {
      try { rollback(); } catch {}
    }
    logDuration(startTime);
    await persistRun({
      startedAt,
      durationSeconds: (Date.now() - startTime) / 1000,
      status: 'FAILED',
      dryRun: DRY_RUN,
      failureStep: 'orchestrator',
      failureReason: err.message || String(err),
    }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
    return { success: false, reason: 'fatal', error: err.message };
  }
}

/**
 * Build a descriptive commit message from the analysis.
 */
function buildCommitMessage(analysis, applied, comparison) {
  const date = new Date().toISOString().split('T')[0];
  const files = [...new Set(applied.map(a => a.file.split('/').pop()))].join(', ');
  const descriptions = applied.map(a => `- ${a.description}`).join('\n');

  return [
    `chore(strategy): AI-optimized update ${date}`,
    '',
    `Risk: ${analysis.riskAssessment}`,
    `Files: ${files}`,
    '',
    'Changes:',
    descriptions,
    '',
    `Assessment: ${analysis.marketAssessment?.substring(0, 200)}`,
    '',
    'Generated by MT5 Strategy Analyst',
  ].join('\n');
}

/**
 * Trigger a redeploy of the trading bot container.
 */
async function triggerRedeploy() {
  const method = process.env.DEPLOY_METHOD;

  if (method === 'docker-compose') {
    try {
      console.log('[deploy] Restarting trading-bot container...');
      execSync('docker-compose up -d --build trading-bot', {
        stdio: 'pipe',
        timeout: 300_000,
      });
      console.log('[deploy] Trading bot restarted.');
    } catch (err) {
      console.error('[deploy] Failed to restart:', err.message);
    }
  } else if (method === 'webhook' && process.env.DEPLOY_WEBHOOK_URL) {
    try {
      const res = await fetch(process.env.DEPLOY_WEBHOOK_URL, { method: 'POST' });
      console.log(`[deploy] Webhook response: ${res.status}`);
    } catch (err) {
      console.error('[deploy] Webhook failed:', err.message);
    }
  } else {
    console.log('[deploy] No deploy method configured, skipping.');
  }
}

function logDuration(startTime) {
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[done] Total duration: ${duration}s`);
}

/**
 * Resume (start) the trading bot via its API after finding an improved strategy.
 * @returns {boolean} true if the bot was successfully resumed
 */
async function resumeBot() {
  if (!BOT_API_URL) {
    console.log('[resume] BOT_API_URL not set — cannot resume bot remotely.');
    return false;
  }

  try {
    const url = `${BOT_API_URL}/api/bot`;
    console.log(`[resume] Starting bot via ${url}...`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    });

    if (res.ok) {
      console.log('[resume] Bot started successfully.');
      await sendBotResumed();
      return true;
    } else {
      const body = await res.text();
      console.error(`[resume] Failed to start bot (${res.status}): ${body}`);
      return false;
    }
  } catch (err) {
    console.error('[resume] Error starting bot:', err.message);
    return false;
  }
}

/**
 * Pause the trading bot because baseline performance is poor and no better
 * strategy was found. Handles dry-run mode and Telegram notification.
 *
 * @param {string} reason - Why the bot is being paused
 * @param {boolean} dryRun - Whether this is a dry run
 * @returns {boolean} true if the bot was paused (or would be in dry-run)
 */
async function pauseBotIfPoor(reason, dryRun) {
  console.warn('\n[PAUSE] No improved strategy found — pausing bot due to poor baseline performance.');

  if (dryRun) {
    console.log('[dry-run] Would pause bot.');
    return true;
  }

  // Send Telegram notification
  const reasons = reason ? reason.split('; ') : ['Poor baseline performance'];
  await sendBotPaused(reasons);

  if (!BOT_API_URL) {
    console.log('[pause] BOT_API_URL not set — cannot pause bot remotely.');
    return false;
  }

  try {
    const url = `${BOT_API_URL}/api/bot`;
    console.log(`[pause] Stopping bot via ${url}...`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });

    if (res.ok) {
      console.log('[pause] Bot stopped successfully.');
      return true;
    } else {
      const body = await res.text();
      console.error(`[pause] Failed to stop bot (${res.status}): ${body}`);
      return false;
    }
  } catch (err) {
    console.error('[pause] Error stopping bot:', err.message);
    return false;
  }
}
