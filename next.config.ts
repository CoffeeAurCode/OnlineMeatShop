import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Produces a minimal self-contained server bundle. Matters on a 512 MB /
  // 0.5 vCPU instance, where shipping node_modules to the runtime is waste.
  output: 'standalone',

  // Product images are served from Supabase Storage behind a CDN, deliberately
  // NOT optimised by Next at request time: image processing on a 0.5 vCPU
  // instance is the wrong place to spend the CPU, and routing the bytes around
  // the app also keeps them off the host's bandwidth allowance.
  images: {
    unoptimized: true,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        // The owner's console must never be indexed.
        source: '/admin/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default nextConfig;
