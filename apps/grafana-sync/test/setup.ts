/**
 * Global test setup file
 * Runs before all test files
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_USERNAME = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'perfana_test';

// Suppress console logs during tests (optional)
// Uncomment to reduce noise in test output
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };

// Increase timeout for integration tests
jest.setTimeout(10000);

// Setup global test utilities
beforeAll(() => {
  // Global setup logic
});

afterAll(() => {
  // Global cleanup logic
});
