/** @type {import('next').NextConfig} */

// CSP Configuration
// Additional frame sources can be configured via NEXT_PUBLIC_CSP_FRAME_SRC environment variable
// (space-separated list of allowed origins, e.g., "https://grafana.example.com https://other.example.com")
const getFrameSrc = () => {
  const defaultFrameSrc = ["'self'"];
  const envFrameSrc = process.env.NEXT_PUBLIC_CSP_FRAME_SRC;

  if (envFrameSrc) {
    // Split by space and filter out empty strings
    const additionalSources = envFrameSrc.split(' ').filter(Boolean);
    return [...defaultFrameSrc, ...additionalSources].join(' ');
  }

  // In development, allow all https sources for Grafana instances
  // In production, configure NEXT_PUBLIC_CSP_FRAME_SRC with specific allowed origins
  if (process.env.NODE_ENV === 'development') {
    return "'self' http: https:";
  }

  // Production default: allow self and https sources
  // Use NEXT_PUBLIC_CSP_FRAME_SRC to allow specific HTTP origins (e.g. local Grafana)
  return "'self' https:";
};

// Safely parse a URL origin, returning null if invalid (e.g. build-time placeholders)
const safeOrigin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

// Build Content-Security-Policy header value
const buildCspHeader = () => {
  const cspDirectives = [
    // Default fallback for all resources
    "default-src 'self'",

    // Scripts - Next.js requires unsafe-inline and unsafe-eval for development
    // In production, consider using nonces or hashes for stricter CSP
    process.env.NODE_ENV === 'development'
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // MUI/Next.js still needs these in production

    // Styles - MUI uses inline styles extensively
    "style-src 'self' 'unsafe-inline'",

    // Images - allow data URIs for inline images and blob for dynamically generated
    "img-src 'self' data: blob: https:",

    // Fonts
    "font-src 'self' data:",

    // Connect sources - API and Keycloak
    // Use origin only (no path) for CSP - path-based CSP requires trailing slash for prefix matching
    // In development, allow all localhost ports for flexibility
    // During Docker builds, env vars are placeholders so we fall back to permissive https:
    (() => {
      if (process.env.NODE_ENV === 'development') {
        return "connect-src 'self' http://localhost:* ws://localhost:* https: wss:";
      }
      const apiOrigin = safeOrigin(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');
      const kcOrigin = safeOrigin(process.env.NEXT_PUBLIC_KEYCLOAK_URL || 'http://localhost:8080');
      if (!apiOrigin || !kcOrigin) {
        // Build-time placeholders — use permissive CSP, runtime start-server.js will set real values
        return "connect-src 'self' https: wss:";
      }
      const apiWsOrigin = apiOrigin.replace(/^http/, 'ws');
      return `connect-src 'self' ${apiOrigin} ${apiWsOrigin} ${kcOrigin} https: wss:`;
    })(),

    // Frame sources - for Grafana dashboards and other embedded content
    `frame-src ${getFrameSrc()}`,

    // Frame ancestors - controls what can embed this site
    "frame-ancestors 'self'",

    // Form actions
    "form-action 'self'",

    // Base URI restriction
    "base-uri 'self'",

    // Object/embed restrictions
    "object-src 'none'",

    // Upgrade insecure requests in production (disable with CSP_UPGRADE_INSECURE=false for local HTTP setups)
    ...(process.env.NODE_ENV === 'production' && process.env.CSP_UPGRADE_INSECURE !== 'false' ? ['upgrade-insecure-requests'] : []),
  ];

  return cspDirectives.join('; ');
};

const nextConfig = {
  output: 'standalone',
  typescript: {
    // Disable type checking during Docker builds - handle separately
    ignoreBuildErrors: true,
  },
  eslint: {
    // Disable ESLint during Docker builds - handle separately
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: buildCspHeader(),
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [];
  },
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
  webpack: (config, { isServer }) => {
    // Externalize Node.js-only modules from the shared package for client-side builds
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        // Node.js modules that don't work in browser
        dns: false,
        net: false,
        tls: false,
        fs: false,
        child_process: false,
        // Node.js built-in modules with node: prefix
        'node:assert': false,
        'node:async_hooks': false,
        'node:buffer': false,
        'node:crypto': false,
        'node:diagnostics_channel': false,
        'node:events': false,
        'node:http': false,
        'node:https': false,
        'node:net': false,
        'node:perf_hooks': false,
        'node:querystring': false,
        'node:stream': false,
        'node:string_decoder': false,
        'node:tls': false,
        'node:url': false,
        'node:util': false,
        'node:zlib': false,
        // Server-only HTTP client libraries
        undici: false,
      };
    }

    return config;
  },
};

module.exports = nextConfig;