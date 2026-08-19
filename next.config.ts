import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The participant's workspace, under a name that does not say which arm they
   * are in.
   *
   * The two conditions are presented as Slate and Clay precisely so nobody can
   * tell which one is the researchers' own; the address bar was still reading
   * `/instructor/assignments/<id>/score`, and "score" is the treatment's real
   * name. A rewrite — not a redirect — because the browser has to KEEP showing
   * the neutral path; a redirect would swap it back the moment they arrived.
   *
   * Additive: the real path still works, which is what researchers, the demo
   * exit and every `?view=` override already use.
   *
   * The client still calls /api/instructor/.../score/* underneath. That is
   * visible only in devtools, which is a different threat than a URL sitting in
   * the address bar for 25 minutes on a shared screen.
   */
  async rewrites() {
    return [{ source: '/studio/:id', destination: '/instructor/assignments/:id/score' }];
  },
  output: "standalone", // For Docker deployment
  reactStrictMode: false, // Required for BlockNote compatibility with Next.js 15
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    optimizePackageImports: ['lucide-react', '@headlessui/react'],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't resolve 'fs' module on the client to prevent this error on build
      config.resolve.fallback = {
        fs: false,
      };
    }

    return config;
  },
};

export default nextConfig;
