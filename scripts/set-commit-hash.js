#!/usr/bin/env node
/**
 * Sets the COMMIT_HASH environment variable for the build.
 * Works with DigitalOcean App Platform, Docker, and local builds.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getCommitHash() {
  // 1. Check for DigitalOcean's COMMIT_HASH (full SHA)
  if (process.env.COMMIT_HASH) {
    console.log('[set-commit-hash] Using COMMIT_HASH from environment');
    return process.env.COMMIT_HASH.substring(0, 7);
  }

  // 2. Check for common CI environment variables
  const ciVars = [
    'GITHUB_SHA',
    'GITLAB_CI_COMMIT_SHA',
    'CI_COMMIT_SHA',
    'SOURCE_VERSION', // Heroku
  ];

  for (const varName of ciVars) {
    if (process.env[varName]) {
      console.log(`[set-commit-hash] Using ${varName} from environment`);
      return process.env[varName].substring(0, 7);
    }
  }

  // 3. Try git command
  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    console.log('[set-commit-hash] Using git rev-parse');
    return hash;
  } catch (e) {
    // Git not available
  }

  // 4. Fallback
  console.log('[set-commit-hash] No commit hash found, using "unknown"');
  return 'unknown';
}

const commitHash = getCommitHash();
console.log(`[set-commit-hash] Commit hash: ${commitHash}`);

// Generate build timestamp in Swiss time (Europe/Zurich)
const buildTimeShort = new Date().toLocaleString('sv-SE', {
  timeZone: 'Europe/Zurich',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
}).replace(',', ''); // "2026-01-16 12:34"
console.log(`[set-commit-hash] Build time: ${buildTimeShort}`);

// Write to files that next.config.mjs can read
const hashPath = path.join(__dirname, '..', '.commit-hash');
const buildTimePath = path.join(__dirname, '..', '.build-time');

fs.writeFileSync(hashPath, commitHash);
fs.writeFileSync(buildTimePath, buildTimeShort);

console.log(`[set-commit-hash] Written to ${hashPath}`);
console.log(`[set-commit-hash] Written to ${buildTimePath}`);
