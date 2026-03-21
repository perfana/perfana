/**
 * Vitest Unit Test Setup
 *
 * This file is executed before all unit tests.
 * It sets up the testing environment, mocks, and global configurations.
 */

import { beforeAll, afterAll, vi } from 'vitest';
import { mockConfig } from './mocks/config.js';

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_USERNAME = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'perfana_test';

// Mock configuration to avoid loadConfig() requirement
mockConfig();

// Mock console methods to reduce noise during testing
const originalConsole = { ...console };

beforeAll(() => {
  // Mock console methods for cleaner test output
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // Set timezone for consistent test results
  process.env.TZ = 'UTC';
});

afterAll(() => {
  // Restore console methods
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;

  // Restore all mocks
  vi.restoreAllMocks();
});