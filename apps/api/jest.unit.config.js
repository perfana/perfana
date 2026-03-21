/**
 * Jest configuration for pure unit tests that don't require database connection.
 * Use this for testing services with mocked dependencies.
 *
 * Usage: npm run test:unit OR npx jest --config jest.unit.config.js
 */
module.exports = {
  displayName: 'api-unit',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleNameMapper: {
    '^jose$': '<rootDir>/src/test/__mocks__/jose.ts',
    '^bullmq$': '<rootDir>/src/test/__mocks__/bullmq.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/api-unit',
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.(t|j)s',
    '<rootDir>/src/**/?(*.)(spec|test).(t|j)s',
  ],
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
    '!src/**/test/**/*',
    '!src/main.ts',
    '!src/**/*.module.ts',
  ],
  // NO globalSetup - this config is for unit tests that don't need database
  // Setup files for environment variables only
  setupFiles: ['<rootDir>/src/test/env.setup.ts'],
  // Increase test timeout
  testTimeout: 30000,
};
