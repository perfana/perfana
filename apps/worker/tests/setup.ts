import { beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';

// Global test setup
let testDb: Pool;

beforeAll(async () => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error'; // Reduce log noise in tests

  // Initialize test database connection
  if (process.env.TEST_DATABASE_URL) {
    testDb = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 5 // Small pool for tests
    });

    // Test the connection
    try {
      const client = await testDb.connect();
      client.release();
      console.log('✅ Test database connection established');
    } catch (error) {
      console.warn('⚠️ Test database not available:', error);
    }
  }
});

afterAll(async () => {
  if (testDb) {
    await testDb.end();
  }
});

// Export for use in tests
export { testDb };