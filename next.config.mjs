/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Allow the sandbox preview host to talk to the dev server.
  allowedDevOrigins: ['*.e2b.app', '*.e2b.dev', 'localhost', '127.0.0.1'],
  // The API is served by the Replit backend (or the bundled server in local dev).
  // The browser only ever talks to this Next.js origin; /api/* is proxied server-side.
  async rewrites() {
    return [];
  },
  experimental: {
    // Keep the client bundle lean.
    optimizePackageImports: [],
  },
};

export default nextConfig;
