import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hardLimits = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'hard-limits.json'), 'utf-8'));
const allowedFiles = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'allowed-files.json'), 'utf-8'));

// Files that must NEVER be modified
const FORBIDDEN_PATTERNS = [
  'position-sizing.ts',
  'bot.ts',
  'server.mjs',
  'Dockerfile',
  '.env',
  'prisma/',
  'package.json',
  'package-lock.json',
  'node_modules/',
  'strategy-analyst/',
];

// Dangerous code patterns
const DANGEROUS_PATTERNS = [
  { pattern: /\beval\s*\(/, name: 'eval()' },
  { pattern: /\bnew\s+Function\s*\(/, name: 'new Function()' },
  { pattern: /child_process/, name: 'child_process' },
  { pattern: /process\.exit/, name: 'process.exit' },
  { pattern: /require\s*\(\s*['"`]fs['"`]\s*\)/, name: 'fs require' },
  { pattern: /import\s+.*from\s+['"`]fs['"`]/, name: 'fs import' },
  { pattern: /\.exec\s*\(/, name: '.exec()' },
  { pattern: /\.execSync\s*\(/, name: '.execSync()' },
  { pattern: /fetch\s*\(/, name: 'fetch() in strategy code' },
];

/**
 * Validate all proposed changes against safety rules.
 * @param {Array} changes - Claude's proposed changes
 * @param {string} repoDir - Repository directory
 * @returns {{ passed: boolean, errors: string[] }}
 */
export function validateChanges(changes, repoDir) {
  const errors = [];

  // 1. File scope check
  for (const change of changes) {
    if (!allowedFiles.includes(change.file)) {
      errors.push(`BLOCKED: "${change.file}" is not in allowed-files.json`);
    }
    for (const forbidden of FORBIDDEN_PATTERNS) {
      if (change.file.includes(forbidden)) {
        errors.push(`FORBIDDEN: "${change.file}" matches forbidden pattern "${forbidden}"`);
      }
    }
  }

  if (errors.length > 0) {
    return { passed: false, errors };
  }

  // 2. Dangerous pattern check in replacement content
  for (const change of changes) {
    for (const { pattern, name } of DANGEROUS_PATTERNS) {
      if (pattern.test(change.replaceBlock)) {
        errors.push(`DANGEROUS: Change to "${change.file}" introduces ${name}`);
      }
    }
  }

  // 3. Hard limits check on strategy profiles (auto-clamp values to stay within limits)
  for (const change of changes) {
    if (change.file.includes('strategy-profiles')) {
      change.replaceBlock = clampHardLimits(change.replaceBlock);
      const limitErrors = checkHardLimits(change.replaceBlock);
      errors.push(...limitErrors);
    }
  }

  // 4. Required patterns check - any signal must include stopLoss and takeProfit
  for (const change of changes) {
    if (change.file.includes('strategy-profiles')) continue; // profiles don't have signals

    const content = change.replaceBlock;
    // If the change introduces a signal return, check it has SL/TP
    if (content.includes('direction:') && content.includes('entry')) {
      if (!content.includes('stopLoss') && !content.includes('sl')) {
        errors.push(`MISSING: Change to "${change.file}" returns signal without stopLoss`);
      }
      if (!content.includes('takeProfit') && !content.includes('tp')) {
        errors.push(`MISSING: Change to "${change.file}" returns signal without takeProfit`);
      }
    }
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Auto-clamp numeric values in profile content to respect hard limits.
 * Fixes values in-place so the pipeline doesn't fail on Claude mistakes.
 */
function clampHardLimits(content) {
  return content.replace(
    /(\b(?:maxDailyDrawdown|riskPercent|maxConcurrentTrades|riskReward)\s*[:=]\s*)([\d.]+)/g,
    (match, prefix, valueStr) => {
      const value = parseFloat(valueStr);
      if (isNaN(value)) return match;

      const key = prefix.match(/(\w+)\s*[:=]/)?.[1];
      let clamped = value;

      switch (key) {
        case 'maxDailyDrawdown':
          clamped = Math.min(value, hardLimits.maxDailyDrawdown);
          break;
        case 'riskPercent':
          clamped = Math.min(value, hardLimits.maxRiskPercentPerTrade);
          break;
        case 'maxConcurrentTrades':
          clamped = Math.min(value, hardLimits.maxConcurrentTrades);
          break;
        case 'riskReward':
          clamped = Math.max(hardLimits.minRiskReward, Math.min(value, hardLimits.maxRiskReward));
          break;
      }

      if (clamped !== value) {
        console.log(`[safety] Clamped ${key}: ${value} → ${clamped}`);
      }
      return prefix + clamped;
    }
  );
}

/**
 * Check that numeric values in profile changes respect hard limits.
 */
function checkHardLimits(content) {
  const errors = [];

  // Extract numeric assignments (e.g., "riskPercent: 5" or "riskPercent = 5")
  const numericAssignments = content.matchAll(/(\w+)\s*[:=]\s*([\d.]+)/g);

  for (const match of numericAssignments) {
    const [, key, valueStr] = match;
    const value = parseFloat(valueStr);
    if (isNaN(value)) continue;

    switch (key) {
      case 'riskPercent':
        if (value > hardLimits.maxRiskPercentPerTrade) {
          errors.push(`LIMIT: riskPercent ${value} exceeds max ${hardLimits.maxRiskPercentPerTrade}`);
        }
        break;
      case 'maxDailyDrawdown':
        if (value > hardLimits.maxDailyDrawdown) {
          errors.push(`LIMIT: maxDailyDrawdown ${value} exceeds max ${hardLimits.maxDailyDrawdown}`);
        }
        break;
      case 'maxConcurrentTrades':
        if (value > hardLimits.maxConcurrentTrades) {
          errors.push(`LIMIT: maxConcurrentTrades ${value} exceeds max ${hardLimits.maxConcurrentTrades}`);
        }
        break;
      case 'riskReward':
        if (value < hardLimits.minRiskReward) {
          errors.push(`LIMIT: riskReward ${value} below min ${hardLimits.minRiskReward}`);
        }
        if (value > hardLimits.maxRiskReward) {
          errors.push(`LIMIT: riskReward ${value} exceeds max ${hardLimits.maxRiskReward}`);
        }
        break;
    }
  }

  return errors;
}

/**
 * Validate diff size is within limits.
 */
export function validateDiffSize(changedLines) {
  if (changedLines > hardLimits.maxDiffLines) {
    return {
      passed: false,
      errors: [`DIFF: ${changedLines} changed lines exceeds max ${hardLimits.maxDiffLines}`],
    };
  }
  return { passed: true, errors: [] };
}

/**
 * Run TypeScript compilation check.
 * @param {string} repoDir - Repository directory
 * @returns {{ passed: boolean, errors: string[] }}
 */
export function checkTypeScript(repoDir) {
  try {
    execSync('npx tsc --noEmit', {
      cwd: repoDir,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: 'pipe',
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=256' },
    });
    console.log('[safety] TypeScript compilation: PASSED');
    return { passed: true, errors: [] };
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    console.error('[safety] TypeScript compilation: FAILED');
    return {
      passed: false,
      errors: [`TypeScript compilation failed:\n${output.substring(0, 2000)}`],
    };
  }
}

/**
 * Validate the full modified files after changes are applied.
 * Reads the actual files and checks for dangerous patterns in them.
 */
export function validateModifiedFiles(files, repoDir) {
  const errors = [];

  for (const file of files) {
    const fullPath = join(repoDir, file);
    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, 'utf-8');
    for (const { pattern, name } of DANGEROUS_PATTERNS) {
      if (pattern.test(content)) {
        errors.push(`DANGEROUS: "${file}" contains ${name}`);
      }
    }
  }

  return { passed: errors.length === 0, errors };
}

export { hardLimits, allowedFiles };
