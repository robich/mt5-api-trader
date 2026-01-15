import { execSync } from 'child_process';

const getGitCommitHash = () => {
  // Check for DigitalOcean's COMMIT_HASH first (provided during build)
  if (process.env.COMMIT_HASH) {
    return process.env.COMMIT_HASH.substring(0, 7);
  }
  // Fallback to git command for local development
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_GIT_COMMIT: getGitCommitHash(),
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
