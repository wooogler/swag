import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // For Docker deployment
  reactStrictMode: false, // Required for BlockNote compatibility with Next.js 15
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't resolve 'fs' module on the client to prevent this error on build
      config.resolve.fallback = {
        fs: false,
      };
    }

    // Exclude BlockNote from SSR compilation
    config.externals = config.externals || [];
    if (isServer) {
      config.externals.push({
        '@blocknote/core': 'commonjs @blocknote/core',
        '@blocknote/react': 'commonjs @blocknote/react',
        '@blocknote/mantine': 'commonjs @blocknote/mantine',
      });
    }

    return config;
  },
};

export default nextConfig;
