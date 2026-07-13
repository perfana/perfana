// Environment variables configuration
// All environment variables used in the frontend should be defined here
//
// This module supports runtime environment configuration for containerized deployments.
// Values can be overridden at container startup via window.__ENV__ (loaded from __env.js)

import { getRuntimeEnv, isPlaceholder } from './runtime-config';

// Default values for development
const DEFAULTS = {
  API_URL: 'http://localhost:3001/api',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'perfana-prod',
  KEYCLOAK_CLIENT_ID: 'perfana-web',
  USE_KEYCLOAK_AUTH: 'false',
} as const;

/**
 * Get environment variable with runtime override support
 * Priority: window.__ENV__ > process.env > default
 */
function getEnvValue(
  key:
    | 'NEXT_PUBLIC_API_URL'
    | 'NEXT_PUBLIC_KEYCLOAK_URL'
    | 'NEXT_PUBLIC_KEYCLOAK_REALM'
    | 'NEXT_PUBLIC_KEYCLOAK_CLIENT_ID'
    | 'NEXT_PUBLIC_USE_KEYCLOAK_AUTH'
    | 'NEXT_PUBLIC_LOG_VIEWER_ENABLED'
    | 'NEXT_PUBLIC_SUT_TRANSFER_ENABLED',
  defaultValue: string
): string {
  // Use runtime config which checks window.__ENV__ first, then process.env
  const value = getRuntimeEnv(key, defaultValue);
  return value && !isPlaceholder(value) ? value : defaultValue;
}

// Validate required environment variables (only in browser, skip during SSR/build)
function validateEnv() {
  // Skip validation during SSR or build
  if (typeof window === 'undefined') return;

  // Check if using runtime config placeholders (check raw process.env, not getRuntimeEnv)
  // getRuntimeEnv filters out placeholders, so we check process.env directly
  const rawApiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (rawApiUrl && isPlaceholder(rawApiUrl)) {
    // Using runtime config mode - window.__ENV__ should be loaded
    const windowEnv = (window as Window & { __ENV__?: Record<string, string> }).__ENV__;
    if (!windowEnv) {
      console.warn(
        'Runtime config mode detected but window.__ENV__ not loaded. ' +
          'Ensure __env.js is included in the page.'
      );
    }
    return;
  }

  // Normal validation for development/non-placeholder mode
  const required = [
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_KEYCLOAK_URL',
    'NEXT_PUBLIC_KEYCLOAK_REALM',
    'NEXT_PUBLIC_KEYCLOAK_CLIENT_ID',
  ] as const;

  const missing = required.filter((key) => {
    const value = getRuntimeEnv(key);
    return !value || isPlaceholder(value);
  });

  if (missing.length > 0) {
    console.warn(`Missing environment variables: ${missing.join(', ')}. Using defaults.`);
  }
}

// Run validation on client side
if (typeof window !== 'undefined') {
  validateEnv();
}

// Export environment variables with runtime override support
// These are getters to ensure they read the latest values from window.__ENV__
export const env = {
  get API_URL(): string {
    return getEnvValue('NEXT_PUBLIC_API_URL', DEFAULTS.API_URL);
  },
  get KEYCLOAK_URL(): string {
    return getEnvValue('NEXT_PUBLIC_KEYCLOAK_URL', DEFAULTS.KEYCLOAK_URL);
  },
  get KEYCLOAK_REALM(): string {
    return getEnvValue('NEXT_PUBLIC_KEYCLOAK_REALM', DEFAULTS.KEYCLOAK_REALM);
  },
  get KEYCLOAK_CLIENT_ID(): string {
    return getEnvValue('NEXT_PUBLIC_KEYCLOAK_CLIENT_ID', DEFAULTS.KEYCLOAK_CLIENT_ID);
  },
  get USE_KEYCLOAK_AUTH(): boolean {
    return getEnvValue('NEXT_PUBLIC_USE_KEYCLOAK_AUTH', DEFAULTS.USE_KEYCLOAK_AUTH) === 'true';
  },
  get LOG_VIEWER_ENABLED(): boolean {
    return getEnvValue('NEXT_PUBLIC_LOG_VIEWER_ENABLED', 'false') === 'true';
  },
  get SUT_TRANSFER_ENABLED(): boolean {
    return getEnvValue('NEXT_PUBLIC_SUT_TRANSFER_ENABLED', 'false') === 'true';
  },
} as const;

// Type-safe environment variables
export type Env = {
  API_URL: string;
  KEYCLOAK_URL: string;
  KEYCLOAK_REALM: string;
  KEYCLOAK_CLIENT_ID: string;
  USE_KEYCLOAK_AUTH: boolean;
  LOG_VIEWER_ENABLED: boolean;
  SUT_TRANSFER_ENABLED: boolean;
};
