const { config } = require('dotenv');

// Load test environment variables
config({ path: '.env.test' });
config({ path: '.env.local' });
config({ path: '.env' });

// Set test environment
process.env.NODE_ENV = 'test';

// Set default test database configuration
// IMPORTANT: Tests use a separate database (perfana_test) to avoid destroying dev data
if (!process.env.DB_HOST) process.env.DB_HOST = 'localhost';
if (!process.env.DB_PORT) process.env.DB_PORT = '5432';
if (!process.env.DB_USERNAME) process.env.DB_USERNAME = 'perfana';
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = 'perfana';
if (!process.env.DB_NAME) process.env.DB_NAME = 'perfana_test';

// Set default Redis configuration for testing
if (!process.env.REDIS_URL) process.env.REDIS_URL = 'redis://localhost:6380';
if (!process.env.REDIS_PASSWORD) process.env.REDIS_PASSWORD = 'redis_dev_password';

// Set default JWT configuration for testing
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-jwt-secret-key';
if (!process.env.JWT_REFRESH_SECRET) process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key';
if (!process.env.JWT_EXPIRES_IN) process.env.JWT_EXPIRES_IN = '1h';
if (!process.env.JWT_REFRESH_EXPIRES_IN) process.env.JWT_REFRESH_EXPIRES_IN = '7d';

// Set feature flags for testing (can be overridden per test)
if (!process.env.USE_NATIVE_DB) process.env.USE_NATIVE_DB = 'true';
if (!process.env.USE_NATIVE_AUTH) process.env.USE_NATIVE_AUTH = 'true';
if (!process.env.USE_NATIVE_REALTIME) process.env.USE_NATIVE_REALTIME = 'true';
if (!process.env.LOG_MIGRATION_DIFFS) process.env.LOG_MIGRATION_DIFFS = 'true';

// Set frontend URL for testing
if (!process.env.FRONTEND_URL) process.env.FRONTEND_URL = 'http://localhost:4001';

// Increase test timeout for integration tests
jest.setTimeout(30000);

// Global test setup
beforeAll(async () => {
  // Any global setup logic
  console.log('🧪 Starting test suite with native PostgreSQL configuration');
});

afterAll(async () => {
  // Any global cleanup logic
  console.log('✅ Test suite completed');
});

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process in tests, just log
});