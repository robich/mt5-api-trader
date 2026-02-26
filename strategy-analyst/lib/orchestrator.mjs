import { clone, createBranch, commitAndPush, rollback, getWorkDir, countChangedLines } from './git-manager.mjs';
import { runBacktests, compareResults, formatResultsForPrompt } from './backtest-runner.mjs';
import { fetchMarketNews } from './news-fetcher.mjs';
import { analyzeStrategies, reviewChanges, fixCompilationErrors } from './claude-analyst.mjs';
import { applyChanges } from './code-applier.mjs';
import { validateChanges, validateDiffSize, checkTypeScript, validateModifiedFiles, hardLimits } from './safety-validator.mjs';
import { sendReport, sendError, sendNoChanges, sendPauseNotification } from './telegram-notifier.mjs';
import { persistRun } from './run-reporter.mjs';
import { setBotPauseState, getBotPauseState } from './pause-manager.mjs';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

const DRY_RUN = process.env.DRY_RUN === 'true';
const MAX_TSC_RETRIES = 2;

/**
 * Check if baseline backtests show no profitable strategy across ALL symbols.
 * Returns true if every symbol's best PnL is <= 0 (i.e. nothing is profitable).
 */
function isBaselineUnprofitable(baseline) {
  const symbols = Object.keys(baseline);
  if (symbols.length === 0) return false; // no data, can't judge

  for (const symbol of symbols) {
    const data = baseline[symbol];
    if (data.error || !data.summary) continue; // skip errored symbols
    if (data.summary.bestPnl > 0) return false; // at least one profitable strategy
  }

  return true; // all symbols unprofitable (or errored)
}

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
      execSync('npm ci --ignore-scripts', {
        cwd: repoDir, stdio: 'pipe', timeout: 180_000,
        env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=256' },
      });
      execSync('npx prisma generate', {
        cwd: repoDir, stdio: 'pipe', timeout: 60_000,
        env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=256' },
      });
    }

    // ── Step 2: Baseline backtest ──
    console.log('\n[3/10] Running baseline backtests...');
    const baseline = await runBacktests(repoDir);
    const baselineFormatted = formatResultsForPrompt(baseline);
    console.log('[baseline]', baselineFormatted.substring(0, 300) + '...');

    // ── Deterministic profitability check ──
    // If ALL symbols show no profitable strategy, auto-pause the bot as a safety net.
    // This is independent of the analyst's AI judgment and acts as a hard guardrail.
    const baselineUnprofitable = isBaselineUnprofitable(baseline);
    let pausedByBaseline = false;
    if (baselineUnprofitable) {
      console.log('\n[safety] ALL baseline strategies are unprofitable — auto-pausing bot');
      pausedByBaseline = true;
      if (!DRY_RUN) {
        await setBotPauseState(true, 'Auto-pause: no profitable strategy found in baseline backtests').catch(
          e => console.error('[pause] Failed to set pause state:', e.message)
        );
      }
      await sendPauseNotification(
        true,
        'Auto-pause: no profitable strategy found in baseline backtests',
        `All ${Object.keys(baseline).length} symbols show negative or zero PnL in ${Object.keys(baseline).join(', ')}`
      );
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

    // ── Handle pause/resume trading flag ──
    if (analysis.pauseTrading === true) {
      console.log('\n[pause] Analyst recommends PAUSING trading:', analysis.pauseReason || 'no reason');
      if (!DRY_RUN) {
        await setBotPauseState(true, analysis.pauseReason || 'Analyst: no viable strategy').catch(
          e => console.error('[pause] Failed to set pause state:', e.message)
        );
      }
      await sendPauseNotification(true, analysis.pauseReason, analysis.marketAssessment);
    } else if (analysis.pauseTrading === false) {
      // Analyst explicitly says resume — but NOT if baseline paused us in this same run
      if (pausedByBaseline) {
        console.log('\n[pause] Analyst recommends resuming, but baseline pause takes precedence — staying paused');
      } else {
        const currentState = await getBotPauseState().catch(() => null);
        if (currentState?.isPaused) {
          console.log('\n[pause] Analyst recommends RESUMING trading');
          if (!DRY_RUN) {
            await setBotPauseState(false, null).catch(
              e => console.error('[pause] Failed to clear pause state:', e.message)
            );
          }
          await sendPauseNotification(false, null, analysis.marketAssessment);
        }
      }
    }

    // Check if no changes recommended
    if (analysis.noChangeRecommended || !analysis.changes || analysis.changes.length === 0) {
      console.log('\n[result] No changes recommended.');
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
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: true, noChanges: true };
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
      await sendError(`Safety review rejected: ${review.issues.join('; ')}`, 'safety-review');
      await ensurePausedIfUnprofitable(baselineUnprofitable, 'safety-review');
      logDuration(startTime);
      await persistRun({
        startedAt, durationSeconds: (Date.now() - startTime) / 1000,
        status: 'FAILED', dryRun: DRY_RUN, failureStep: 'safety-review',
        failureReason: review.issues.join('; '),
        marketAssessment: analysis.marketAssessment, riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning, changesProposed: analysis.changes.length,
        backtestBaseline: baseline,
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: false, reason: 'review-rejected', issues: review.issues };
    }

    // ── Step 6: Pre-apply validation ──
    console.log('\n[7/10] Validating changes...');
    const preValidation = validateChanges(analysis.changes, repoDir);
    if (!preValidation.passed) {
      console.error('[validate] Pre-apply validation FAILED:', preValidation.errors);
      await sendError(`Validation failed: ${preValidation.errors.join('; ')}`, 'pre-validation');
      await ensurePausedIfUnprofitable(baselineUnprofitable, 'pre-validation');
      logDuration(startTime);
      await persistRun({
        startedAt, durationSeconds: (Date.now() - startTime) / 1000,
        status: 'FAILED', dryRun: DRY_RUN, failureStep: 'pre-validation',
        failureReason: preValidation.errors.join('; '),
        marketAssessment: analysis.marketAssessment, riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning, changesProposed: analysis.changes.length,
        backtestBaseline: baseline,
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: false, reason: 'validation-failed', errors: preValidation.errors };
    }

    // ── Step 7: Apply changes ──
    console.log('\n[8/10] Applying changes...');
    const { applied, failed, modifiedFiles } = applyChanges(analysis.changes, repoDir);

    if (applied.length === 0) {
      console.error('[apply] No changes could be applied.');
      await sendError(`All ${failed.length} changes failed to apply`, 'apply');
      await ensurePausedIfUnprofitable(baselineUnprofitable, 'apply');
      logDuration(startTime);
      await persistRun({
        startedAt, durationSeconds: (Date.now() - startTime) / 1000,
        status: 'FAILED', dryRun: DRY_RUN, failureStep: 'apply',
        failureReason: `All ${failed.length} changes failed to apply`,
        marketAssessment: analysis.marketAssessment, riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning, changesProposed: analysis.changes.length,
        changesFailed: failed.length, backtestBaseline: baseline,
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: false, reason: 'apply-failed', failed };
    }

    // Validate diff size
    const changedLines = countChangedLines();
    const diffCheck = validateDiffSize(changedLines);
    if (!diffCheck.passed) {
      console.error('[validate] Diff too large:', diffCheck.errors);
      rollback();
      await sendError(diffCheck.errors.join('; '), 'diff-size');
      await ensurePausedIfUnprofitable(baselineUnprofitable, 'diff-size');
      logDuration(startTime);
      await persistRun({
        startedAt, durationSeconds: (Date.now() - startTime) / 1000,
        status: 'FAILED', dryRun: DRY_RUN, failureStep: 'diff-size',
        failureReason: diffCheck.errors.join('; '),
        marketAssessment: analysis.marketAssessment, riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning, changesProposed: analysis.changes.length,
        changesApplied: applied.length, changesFailed: failed.length,
        changesDetail: applied.map(a => ({ file: a.file, description: a.description })),
        backtestBaseline: baseline,
      }).catch(e => console.error('[reporter] Failed to persist run:', e.message));
      return { success: false, reason: 'diff-too-large', errors: diffCheck.errors };
    }

    // Validate modified file contents
    const fileCheck = validateModifiedFiles(modifiedFiles, repoDir);
    if (!fileCheck.passed) {
      console.error('[validate] Modified files contain dangerous patterns:', fileCheck.errors);
      rollback();
      await sendError(fileCheck.errors.join('; '), 'file-validation');
      await ensurePausedIfUnprofitable(baselineUnprofitable, 'file-validation');
      logDuration(startTime);
      await persistRun({
        startedAt, durationSeconds: (Date.now() - startTime) / 1000,
        status: 'FAILED', dryRun: DRY_RUN, failureStep: 'file-validation',
        failureReason: fileCheck.errors.join('; '),
        marketAssessment: analysis.marketAssessment, riskAssessment: analysis.riskAssessment,
        reasoning: analysis.reasoning, changesProposed: analysis.changes.length,
        changesApplied: applied.length, changesFailed: failed.length,
        changesDetail: applied.map(a => ({ file: a.file, description: a.description })),
        backtestBaseline: baseline,
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
      await sendError(`TypeScript compilation failed:\n${tscResult.errors[0]?.substring(0, 300)}`, 'tsc');
      await ensurePausedIfUnprofitable(baselineUnprofitable, 'tsc');
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
        backtestBaseline: baseline,
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
      await ensurePausedIfUnprofitable(baselineUnprofitable, 'backtest-validation');
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
        backtestPassed: false,
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

      // Auto-resume trading if bot was paused and we just deployed a passing strategy
      // But NOT if baseline pause was triggered in this run (new code didn't fix the root cause)
      const currentPause = await getBotPauseState().catch(() => null);
      if (currentPause?.isPaused && !pausedByBaseline) {
        console.log('[pause] Bot was paused — auto-resuming after successful strategy deployment');
        await setBotPauseState(false, null).catch(
          e => console.error('[pause] Failed to auto-resume:', e.message)
        );
        await sendPauseNotification(false, 'Auto-resumed: new strategy passed backtests', analysis.marketAssessment);
      } else if (currentPause?.isPaused && pausedByBaseline) {
        console.log('[pause] New strategy deployed, but baseline was unprofitable — staying paused until next run confirms profitability');
      }

      // Trigger redeploy if configured
      await triggerRedeploy();
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
 * Ensure bot is paused when the pipeline fails and baseline strategies are unprofitable.
 * Called on failure paths where changes couldn't be deployed.
 */
async function ensurePausedIfUnprofitable(baselineUnprofitable, failureStep) {
  if (!baselineUnprofitable || DRY_RUN) return;

  const currentState = await getBotPauseState().catch(() => null);
  if (currentState?.isPaused) return; // already paused

  console.log(`[safety] Pipeline failed at ${failureStep} with unprofitable baseline — auto-pausing bot`);
  await setBotPauseState(
    true,
    `Auto-pause: baseline unprofitable and strategy update failed (${failureStep})`
  ).catch(e => console.error('[pause] Failed to set pause state:', e.message));
  await sendPauseNotification(
    true,
    `Auto-pause: strategy update failed at ${failureStep}, no profitable baseline to fall back on`,
    null
  );
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
