import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const WORK_DIR = process.env.ANALYST_WORK_DIR || '/tmp/strategy-analyst-repo';

/**
 * Clone the repository fresh for each run.
 */
export function clone() {
  const repoUrl = process.env.GIT_REPO_URL;
  const token = process.env.GIT_TOKEN;
  const branch = process.env.GIT_BRANCH || 'main';

  if (!repoUrl) throw new Error('GIT_REPO_URL is required');
  if (!token) throw new Error('GIT_TOKEN is required');

  // Clean up any previous clone
  if (existsSync(WORK_DIR)) {
    rmSync(WORK_DIR, { recursive: true, force: true });
  }
  mkdirSync(WORK_DIR, { recursive: true });

  // Insert token into HTTPS URL: https://TOKEN@github.com/user/repo.git
  const authedUrl = repoUrl.replace('https://', `https://${token}@`);

  console.log(`[git] Cloning ${repoUrl} (branch: ${branch})...`);
  execSync(`git clone --depth 1 --branch ${branch} ${authedUrl} ${WORK_DIR}`, {
    stdio: 'pipe',
    timeout: 120_000,
  });
  console.log('[git] Clone complete.');

  return WORK_DIR;
}

/**
 * Get the current short commit hash.
 */
export function getCurrentCommit() {
  return execSync('git rev-parse --short HEAD', { cwd: WORK_DIR, encoding: 'utf-8' }).trim();
}

/**
 * Create a dated branch for the strategy update.
 */
export function createBranch() {
  const date = new Date().toISOString().split('T')[0];
  const branchName = `strategy-update/${date}`;

  execSync(`git checkout -b ${branchName}`, { cwd: WORK_DIR, stdio: 'pipe' });
  console.log(`[git] Created branch: ${branchName}`);
  return branchName;
}

/**
 * Stage specific files, commit, and push.
 * Only allowed files can be committed.
 */
export function commitAndPush(files, message) {
  const branch = execSync('git branch --show-current', { cwd: WORK_DIR, encoding: 'utf-8' }).trim();

  // Configure git identity for the analyst bot
  execSync('git config user.email "strategy-analyst@mt5-trader.local"', { cwd: WORK_DIR, stdio: 'pipe' });
  execSync('git config user.name "MT5 Strategy Analyst"', { cwd: WORK_DIR, stdio: 'pipe' });

  // Stage only the specified files
  for (const file of files) {
    const fullPath = join(WORK_DIR, file);
    if (!existsSync(fullPath)) {
      console.warn(`[git] Skipping non-existent file: ${file}`);
      continue;
    }
    execSync(`git add "${file}"`, { cwd: WORK_DIR, stdio: 'pipe' });
  }

  // Check if there are staged changes
  const status = execSync('git diff --cached --stat', { cwd: WORK_DIR, encoding: 'utf-8' }).trim();
  if (!status) {
    console.log('[git] No changes to commit.');
    return null;
  }

  // Commit
  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: WORK_DIR, stdio: 'pipe' });
  const commitHash = getCurrentCommit();
  console.log(`[git] Committed: ${commitHash}`);

  // Push
  execSync(`git push origin ${branch}`, { cwd: WORK_DIR, stdio: 'pipe', timeout: 60_000 });
  console.log(`[git] Pushed to origin/${branch}`);

  return { branch, commitHash };
}

/**
 * Get the diff of staged + unstaged changes (for reporting).
 */
export function getDiff() {
  return execSync('git diff', { cwd: WORK_DIR, encoding: 'utf-8' });
}

/**
 * Count total changed lines in the working directory.
 */
export function countChangedLines() {
  try {
    const diff = execSync('git diff --stat', { cwd: WORK_DIR, encoding: 'utf-8' });
    // Last line of --stat is: " N files changed, X insertions(+), Y deletions(-)"
    const match = diff.match(/(\d+) insertions?\(\+\).*?(\d+) deletions?\(-\)/);
    if (match) return parseInt(match[1]) + parseInt(match[2]);

    // Try just insertions
    const insMatch = diff.match(/(\d+) insertions?\(\+\)/);
    if (insMatch) return parseInt(insMatch[1]);

    const delMatch = diff.match(/(\d+) deletions?\(-\)/);
    if (delMatch) return parseInt(delMatch[1]);

    return 0;
  } catch {
    return 0;
  }
}

/**
 * Discard all working directory changes (for rollback on failure).
 */
export function rollback() {
  try {
    execSync('git checkout -- .', { cwd: WORK_DIR, stdio: 'pipe' });
    console.log('[git] Rolled back all changes.');
  } catch (e) {
    console.error('[git] Rollback failed:', e.message);
  }
}

export function getWorkDir() {
  return WORK_DIR;
}
