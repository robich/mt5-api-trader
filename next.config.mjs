import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const getPackageVersion = () => {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
};

const getGitCommitHash = () => {
  // 1. Check for .commit-hash file (written by prebuild script)
  const hashFile = join(__dirname, '.commit-hash');
  if (existsSync(hashFile)) {
    try {
      const hash = readFileSync(hashFile, 'utf8').trim();
      if (hash && hash !== 'unknown') {
        return hash;
      }
    } catch {
      // Continue to fallbacks
    }
  }

  // 2. Check for DigitalOcean's COMMIT_HASH
  if (process.env.COMMIT_HASH) {
    return process.env.COMMIT_HASH.substring(0, 7);
  }

  // 3. Fallback to git command for local development
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
};

const getBuildTime = () => {
  // Check for .build-time file (written by prebuild script)
  const buildTimeFile = join(__dirname, '.build-time');
  if (existsSync(buildTimeFile)) {
    try {
      return readFileSync(buildTimeFile, 'utf8').trim();
    } catch {
      // Continue to fallback
    }
  }
  // Fallback for dev mode
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_VERSION: getPackageVersion(),
    NEXT_PUBLIC_GIT_COMMIT: getGitCommitHash(),
    NEXT_PUBLIC_BUILD_TIME: getBuildTime(),
  },
  webpack: (config, { isServer }) => {
    // Force MetaAPI SDK to use Node.js version on server
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'metaapi.cloud-sdk': 'metaapi.cloud-sdk/dists/cjs/index.js',
      };
    }
    return config;
  },
  // Mark metaapi as external for server-side to avoid bundling issues
  experimental: {
    serverComponentsExternalPackages: ['metaapi.cloud-sdk'],
  },
};

export default nextConfig;
