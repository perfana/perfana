/**
 * Vitest Integration Test Setup
 *
 * This file is executed before all integration tests.
 * It sets up real database connections, test containers, and cleanup procedures.
 */

import { beforeAll, afterAll } from 'vitest';
import { StartedTestContainer } from 'testcontainers';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/database.js';

// Global test database container
let testContainer: StartedTestContainer | undefined;

beforeAll(async () => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'warn';

  // Setup test database
  testContainer = await setupTestDatabase();

  console.log('✅ Integration test environment ready');
}, 120000); // 2 minute timeout for container setup

afterAll(async () => {
  // Cleanup test database
  if (testContainer) {
    await cleanupTestDatabase(testContainer);
  }

  console.log('✅ Integration test cleanup complete');
}, 60000); // 1 minute timeout for cleanup