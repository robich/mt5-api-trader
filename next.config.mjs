/** @type {import('next').NextConfig} */
const nextConfig = {
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
