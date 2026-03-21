// Configuration constants and utilities

export const API_CONFIG = {
  VERSION: 'v1',
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
} as const;

export const DATABASE_CONFIG = {
  MAX_CONNECTIONS: 100,
  IDLE_TIMEOUT: 30000,
  CONNECTION_TIMEOUT: 5000,
} as const;

export const CACHE_CONFIG = {
  TTL: 300, // 5 minutes in seconds
  MAX_SIZE: 1000,
} as const;

export const PAGINATION_CONFIG = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

export const VALIDATION_CONFIG = {
  MAX_NAME_LENGTH: 255,
  MAX_DESCRIPTION_LENGTH: 1000,
  MIN_PASSWORD_LENGTH: 8,
} as const;

export const TIME_SERIES_CONFIG = {
  CHUNK_INTERVAL: '1 day',
  RETENTION_POLICY: '1 year',
  COMPRESSION_POLICY: '7 days',
} as const;

export const MONITORING_CONFIG = {
  METRICS_INTERVAL: 60000, // 1 minute in milliseconds  
  HEALTH_CHECK_INTERVAL: 30000, // 30 seconds
  DEFAULT_TIMEOUT: 120000, // 2 minutes
} as const;

export const BENCHMARK_CONFIG = {
  DEFAULT_EVALUATION_TYPE: 'avg',
  EXCLUDE_RAMP_UP: true,
  DEFAULT_COMPARISON_STRATEGY: 'previous',
} as const;

// Environment-specific configuration
export function getConfig() {
  const env = process.env.NODE_ENV || 'development';
  
  return {
    isDevelopment: env === 'development',
    isProduction: env === 'production',
    isTest: env === 'test',
    
    api: {
      url: process.env.API_URL || 'http://localhost:3001',
      timeout: API_CONFIG.TIMEOUT,
    },
    
    database: {
      url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres',
      maxConnections: DATABASE_CONFIG.MAX_CONNECTIONS,
    },

    keycloak: {
      url: process.env.KEYCLOAK_URL || 'http://localhost:8080',
      realm: process.env.KEYCLOAK_REALM || 'perfana-prod',
      clientId: process.env.KEYCLOAK_CLIENT_ID || 'perfana-api',
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || '',
    },

    jwt: {
      secret: process.env.JWT_SECRET || 'your-jwt-secret',
      expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    },
    
    cors: {
      origins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
    },
  };
}