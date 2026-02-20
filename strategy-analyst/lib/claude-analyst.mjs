import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const systemPrompt = readFileSync(join(__dirname, '..', 'prompts', 'system.md'), 'utf-8');
const analysisTemplate = readFileSync(join(__dirname, '..', 'prompts', 'analysis.md'), 'utf-8');
const hardLimits = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'hard-limits.json'), 'utf-8'));
const allowedFiles = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'allowed-files.json'), 'utf-8'));

const client = new Anthropic();

/**
 * Phase 1: Call Claude Opus to analyze performance and propose changes.
 * Uses extended thinking for deeper reasoning.
 */
export async function analyzeStrategies({ backtestResults, newsSummary, repoDir }) {
  const backTestDays = process.env.BACKTEST_DAYS || '14';

  // Build strategy file contents
  const fileContents = [];
  for (const file of allowedFiles) {
    const fullPath = join(repoDir, file);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8');
      fileContents.push(`### ${file}\n\`\`\`typescript\n${content}\n\`\`\``);
    }
  }

  // Build the analysis prompt from template
  const analysisPrompt = analysisTemplate
    .replace('{{DATE}}', new Date().toISOString().split('T')[0])
    .replace('{{STRATEGY_FILES}}', fileContents.join('\n\n'))
    .replace('{{BACKTEST_DAYS}}', backTestDays)
    .replace('{{BACKTEST_RESULTS}}', backtestResults)
    .replace('{{NEWS_SUMMARY}}', newsSummary || 'No market news available.')
    .replace('{{HARD_LIMITS}}', JSON.stringify(hardLimits, null, 2))
    .replace('{{ALLOWED_FILES}}', allowedFiles.map(f => `- ${f}`).join('\n'));

  console.log('[claude] Phase 1: Analyzing strategies with Opus...');
  console.log(`[claude] Context: ${fileContents.length} files, ~${analysisPrompt.length} chars`);

  const response = await client.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 16000,
    thinking: {
      type: 'enabled',
      budget_tokens: 10000,
    },
    system: systemPrompt,
    messages: [
      { role: 'user', content: analysisPrompt },
    ],
  });

  // Extract the text response (skip thinking blocks)
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error('No text response from Claude');
  }

  // Parse JSON from the response
  const parsed = extractJSON(textBlock.text);
  if (!parsed) {
    throw new Error(`Failed to parse Claude response as JSON:\n${textBlock.text.substring(0, 500)}`);
  }

  // Log thinking if available
  const thinkingBlock = response.content.find(b => b.type === 'thinking');
  if (thinkingBlock) {
    console.log('[claude] Thinking summary:', thinkingBlock.thinking.substring(0, 200) + '...');
  }

  console.log(`[claude] Phase 1 complete. Changes proposed: ${parsed.changes?.length || 0}`);
  console.log(`[claude] Risk assessment: ${parsed.riskAssessment}`);
  console.log(`[claude] Tokens used: ${response.usage?.input_tokens}in / ${response.usage?.output_tokens}out`);

  return parsed;
}

/**
 * Phase 2: Call Claude Sonnet to review proposed changes for safety.
 */
export async function reviewChanges({ changes, repoDir }) {
  if (!changes || changes.length === 0) {
    return { approved: true, issues: [] };
  }

  // Build file contents for the modified files
  const affectedFiles = [...new Set(changes.map(c => c.file))];
  const fileContents = [];
  for (const file of affectedFiles) {
    const fullPath = join(repoDir, file);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8');
      fileContents.push(`### ${file}\n\`\`\`typescript\n${content}\n\`\`\``);
    }
  }

  const reviewPrompt = `# Code Review Request

You are reviewing proposed changes to a live trading system's strategy code. This is a safety review.

## Current File Contents
${fileContents.join('\n\n')}

## Proposed Changes
\`\`\`json
${JSON.stringify(changes, null, 2)}
\`\`\`

## Hard Limits (IMMUTABLE)
\`\`\`json
${JSON.stringify(hardLimits, null, 2)}
\`\`\`

## Review Checklist — ONLY reject for CRITICAL safety issues
1. Do any numeric values EXCEED the hard limits? (riskPercent > 3%, dailyDrawdown > 15%, etc.). Reducing values (making them stricter/more conservative) is ALWAYS safe — do NOT reject.
2. Are there actual logic errors or inverted conditions that would cause wrong trades?
3. Are there dangerous code patterns (eval, exec, filesystem, network access)?

## What is NOT a rejection reason (approve these):
- Adjusting strategy parameters (riskReward, minOBScore, useKillZones, etc.) — these are the PURPOSE of the analyst
- Changing or removing tiered TP profiles — this is a valid strategy adjustment
- searchBlock appearing to be a partial match — the code applier handles substring matching, partial blocks are fine
- Reducing risk parameters below hard limits — this is more conservative, always safe
- Changing filters, timeframes, or entry conditions — these are normal strategy tuning

You should ALMOST ALWAYS approve. Only reject if a change would exceed hard limits, introduce code execution vulnerabilities, or contain an obvious logic bug that would cause unintended trades.

Respond with JSON:
\`\`\`json
{
  "approved": true/false,
  "issues": ["only list genuinely dangerous issues, not observations"],
  "severity": "NONE|LOW|MEDIUM|HIGH|CRITICAL"
}
\`\`\``;

  console.log('[claude] Phase 2: Safety review with Sonnet...');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [
      { role: 'user', content: reviewPrompt },
    ],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) {
    return { approved: false, issues: ['No response from reviewer'] };
  }

  const parsed = extractJSON(textBlock.text);
  if (!parsed) {
    console.warn('[claude] Could not parse review response, treating as rejection');
    return { approved: false, issues: ['Unparseable review response'] };
  }

  console.log(`[claude] Phase 2 complete. Approved: ${parsed.approved}, Issues: ${parsed.issues?.length || 0}`);
  console.log(`[claude] Tokens used: ${response.usage?.input_tokens}in / ${response.usage?.output_tokens}out`);

  return parsed;
}

/**
 * Ask Claude to fix TypeScript compilation errors.
 */
export async function fixCompilationErrors({ errors, changes, repoDir }) {
  const affectedFiles = [...new Set(changes.map(c => c.file))];
  const fileContents = [];
  for (const file of affectedFiles) {
    const fullPath = join(repoDir, file);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8');
      fileContents.push(`### ${file}\n\`\`\`typescript\n${content}\n\`\`\``);
    }
  }

  const fixPrompt = `# TypeScript Compilation Fix

The following changes were applied to strategy files but caused TypeScript compilation errors.

## Current File Contents (after changes)
${fileContents.join('\n\n')}

## Compilation Errors
\`\`\`
${errors.join('\n')}
\`\`\`

Fix the compilation errors with minimal changes. Respond with the same JSON format:
\`\`\`json
{
  "changes": [
    {
      "file": "path/to/file.ts",
      "description": "Fix description",
      "searchBlock": "exact text to find",
      "replaceBlock": "replacement text"
    }
  ]
}
\`\`\`

Only fix compilation errors — do not make any other changes.`;

  console.log('[claude] Fixing TypeScript compilation errors...');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [
      { role: 'user', content: fixPrompt },
    ],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) return null;

  return extractJSON(textBlock.text);
}

/**
 * Extract JSON from a text response that may contain markdown code fences.
 */
function extractJSON(text) {
  // Try direct parse first
  try {
    return JSON.parse(text.trim());
  } catch {}

  // Try extracting from code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }

  // Try finding JSON object in the text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {}
  }

  return null;
}
