const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Send a formatted strategy analyst report via Telegram.
 */
export async function sendReport(report) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, skipping notification.');
    return;
  }

  const message = formatReport(report);
  await sendMessage(message);
}

/**
 * Send an error notification.
 */
export async function sendError(error, step) {
  if (!BOT_TOKEN || !CHAT_ID) return;

  const message = [
    `<b>⚠️ Strategy Analyst Error</b>`,
    `<b>Date:</b> ${new Date().toISOString().split('T')[0]}`,
    `<b>Step:</b> ${step}`,
    `<b>Error:</b> <code>${escapeHtml(String(error).substring(0, 500))}</code>`,
  ].join('\n');

  await sendMessage(message);
}

/**
 * Send a "no changes" notification.
 */
export async function sendNoChanges(assessment) {
  if (!BOT_TOKEN || !CHAT_ID) return;

  const message = [
    `<b>📊 Strategy Analyst — ${new Date().toISOString().split('T')[0]}</b>`,
    ``,
    `<b>Result:</b> No changes recommended`,
    `<b>Assessment:</b> ${escapeHtml(assessment || 'Strategies performing within expected parameters.')}`,
  ].join('\n');

  await sendMessage(message);
}

/**
 * Send a pause/resume notification.
 */
export async function sendPauseNotification(isPaused, reason, marketAssessment) {
  if (!BOT_TOKEN || !CHAT_ID) return;

  const icon = isPaused ? '⏸️' : '▶️';
  const action = isPaused ? 'Trading Paused' : 'Trading Resumed';

  const lines = [
    `<b>${icon} ${action} — Strategy Analyst</b>`,
    '',
  ];

  if (reason) {
    lines.push(`<b>Reason:</b> ${escapeHtml(reason)}`);
  }

  if (marketAssessment) {
    lines.push(`<b>Market:</b> ${escapeHtml(marketAssessment)}`);
  }

  if (isPaused) {
    lines.push('');
    lines.push('<i>The bot will continue running but will not open new trades until conditions improve.</i>');
  }

  await sendMessage(lines.join('\n'));
}

/**
 * Format a full report with changes and backtest comparison.
 */
function formatReport(report) {
  const lines = [];

  lines.push(`<b>📊 Strategy Analyst Report — ${report.date}</b>`);
  lines.push('');

  // Market assessment
  if (report.marketAssessment) {
    lines.push(`<b>Market:</b> ${escapeHtml(report.marketAssessment)}`);
    lines.push('');
  }

  // Changes summary
  if (report.applied && report.applied.length > 0) {
    lines.push(`<b>Changes:</b> ${report.applied.length} applied`);
    for (const change of report.applied) {
      lines.push(`✅ <b>${escapeHtml(change.file)}</b>`);
      lines.push(`  • ${escapeHtml(change.description)}`);
    }
  }

  if (report.failed && report.failed.length > 0) {
    lines.push('');
    lines.push(`<b>Failed:</b> ${report.failed.length}`);
    for (const change of report.failed) {
      lines.push(`❌ <b>${escapeHtml(change.file)}</b>: ${escapeHtml(change.error)}`);
    }
  }

  // Backtest comparison
  if (report.comparison) {
    lines.push('');
    lines.push('<b>📈 Backtest Comparison:</b>');
    for (const [symbol, comp] of Object.entries(report.comparison.details)) {
      if (comp.baseline && comp.validation) {
        const icon = comp.passed ? '✅' : '⚠️';
        lines.push(`${icon} <b>${symbol}</b>`);
        lines.push(`  Before: $${comp.baseline.bestPnl?.toFixed(0)} PnL, ${comp.baseline.bestWinRate?.toFixed(1)}% WR`);
        lines.push(`  After:  $${comp.validation.bestPnl?.toFixed(0)} PnL, ${comp.validation.bestWinRate?.toFixed(1)}% WR`);
      }
    }

    if (!report.comparison.allPassed) {
      lines.push('');
      lines.push('⚠️ <b>Some backtest gates failed — changes were rolled back.</b>');
    }
  }

  // Commit info
  if (report.commit) {
    lines.push('');
    lines.push(`<b>Commit:</b> <code>${report.commit.commitHash}</code>`);
    lines.push(`<b>Branch:</b> ${escapeHtml(report.commit.branch)}`);
  }

  // Redeploy status
  if (report.redeployed !== undefined) {
    lines.push(`<b>Redeploy:</b> ${report.redeployed ? '✅ triggered' : '⏭️ skipped'}`);
  }

  // Risk assessment
  if (report.riskAssessment) {
    lines.push('');
    lines.push(`<b>Risk:</b> ${report.riskAssessment}`);
  }

  return lines.join('\n');
}

/**
 * Send a message via Telegram Bot API.
 */
async function sendMessage(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[telegram] Send failed (${res.status}):`, body);
    } else {
      console.log('[telegram] Notification sent.');
    }
  } catch (err) {
    console.error('[telegram] Send error:', err.message);
  }
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
