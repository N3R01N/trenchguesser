import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * The demo page is read off disk at request time, and it lives outside
   * `public/` so that nothing serves it but the route that checks the code.
   * Tracing cannot see through `readFile`, so the file is named here or it
   * would be missing from the deployed function.
   */
  outputFileTracingIncludes: {
    '/demo/\\[code\\]': ['./demo/**'],
  },
};

export default nextConfig;
