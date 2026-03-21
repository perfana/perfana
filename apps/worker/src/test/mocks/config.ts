/**
 * Configuration Mock Helpers
 *
 * Provides mock configuration for testing without requiring loadConfig()
 */

import { vi } from 'vitest';

/**
 * Mock the configuration module to avoid loadConfig() requirement
 */
export function mockConfig() {
  // Mock the environment module
  vi.mock('../../config/environment.js', () => ({
    loadConfig: vi.fn(),
    getConfig: vi.fn(() => ({
      database: {
        connectionString: 'postgresql://test:test@localhost:5432/perfana_test',
        maxConnections: 5,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000
      },
      queue: {
        connectionString: 'postgresql://test:test@localhost:5432/perfana_test',
        schema: 'pgboss',
        retentionDays: 30
      },
      grafana: {
        baseURL: 'http://localhost:3000',
        apiKey: 'test-api-key',
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000
      },
      logging: {
        level: 'silent',
        format: 'json'
      },
      server: {
        port: 3000,
        host: 'localhost'
      }
    }))
  }));

  // Mock logger to avoid configuration dependency
  vi.mock('../../lib/utils/logger.js', () => ({
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn()
    })),
    getLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn()
    })),
    logPerformance: vi.fn(),
    logError: vi.fn()
  }));
}