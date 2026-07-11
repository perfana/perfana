import { NextResponse } from 'next/server';

/**
 * Runtime configuration endpoint
 *
 * This API route serves runtime environment variables to the client.
 * It allows the same Docker image to be deployed to different environments
 * by reading environment variables at request time (not build time).
 *
 * IMPORTANT: We read env vars WITHOUT the NEXT_PUBLIC_ prefix on the server side,
 * because Next.js inlines NEXT_PUBLIC_* at build time. The container should set
 * both versions (with and without prefix) or just the non-prefixed ones.
 *
 * Container env vars to set:
 * - RUNTIME_API_URL (or NEXT_PUBLIC_API_URL)
 * - RUNTIME_KEYCLOAK_URL (or NEXT_PUBLIC_KEYCLOAK_URL)
 * - RUNTIME_KEYCLOAK_REALM (or NEXT_PUBLIC_KEYCLOAK_REALM)
 * - RUNTIME_KEYCLOAK_CLIENT_ID (or NEXT_PUBLIC_KEYCLOAK_CLIENT_ID)
 * - RUNTIME_USE_KEYCLOAK_AUTH (or NEXT_PUBLIC_USE_KEYCLOAK_AUTH)
 * - RUNTIME_LOG_VIEWER_ENABLED (or NEXT_PUBLIC_LOG_VIEWER_ENABLED)
 * - RUNTIME_SUT_TRANSFER_ENABLED (or NEXT_PUBLIC_SUT_TRANSFER_ENABLED)
 *
 * This is the source of truth for window.__ENV__ (the client fetches
 * /api/config via loadRuntimeConfig). Keep the returned keys in sync with
 * RUNTIME_ENV_KEYS in lib/runtime-config.ts and scripts/start-server.js.
 */

// Force this route to be dynamic (not statically generated)
export const dynamic = 'force-dynamic';

export async function GET() {
  // Read env vars at request time, not module load time
  // Try RUNTIME_* first (server-only), then fall back to NEXT_PUBLIC_* (may be build-time)
  const config: Record<string, string> = {
    NEXT_PUBLIC_API_URL: getEnvValue('API_URL', 'http://localhost:3001/api'),
    NEXT_PUBLIC_KEYCLOAK_URL: getEnvValue('KEYCLOAK_URL', 'http://localhost:8080'),
    NEXT_PUBLIC_KEYCLOAK_REALM: getEnvValue('KEYCLOAK_REALM', 'perfana-prod'),
    NEXT_PUBLIC_KEYCLOAK_CLIENT_ID: getEnvValue('KEYCLOAK_CLIENT_ID', 'perfana-web'),
    NEXT_PUBLIC_USE_KEYCLOAK_AUTH: getEnvValue('USE_KEYCLOAK_AUTH', 'false'),
    NEXT_PUBLIC_LOG_VIEWER_ENABLED: getEnvValue('LOG_VIEWER_ENABLED', 'false'),
    NEXT_PUBLIC_SUT_TRANSFER_ENABLED: getEnvValue('SUT_TRANSFER_ENABLED', 'false'),
  };

  // Log for debugging (visible in container logs)
  console.log('[/api/config] Serving runtime config:', config);

  return NextResponse.json(config, {
    headers: {
      // Don't cache - we want fresh values on each request during debugging
      // Can add caching later once confirmed working
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Get environment variable value, checking multiple prefixes
 * Priority: RUNTIME_* > NEXT_PUBLIC_* > default
 */
function getEnvValue(key: string, defaultValue: string): string {
  // Check RUNTIME_ prefix first (set at container runtime, not inlined by Next.js)
  const runtimeKey = `RUNTIME_${key}`;
  const runtimeValue = process.env[runtimeKey];
  if (runtimeValue && !isPlaceholder(runtimeValue)) {
    return runtimeValue;
  }

  // Check NEXT_PUBLIC_ prefix (may be build-time value or runtime if not inlined)
  const nextPublicKey = `NEXT_PUBLIC_${key}`;
  const nextPublicValue = process.env[nextPublicKey];
  if (nextPublicValue && !isPlaceholder(nextPublicValue)) {
    return nextPublicValue;
  }

  return defaultValue;
}

/**
 * Check if a value is a build-time placeholder
 */
function isPlaceholder(value: string): boolean {
  return value.startsWith('__RUNTIME_') && value.endsWith('__');
}
