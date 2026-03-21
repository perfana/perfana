module.exports = {
  displayName: 'api',
  testEnvironment: 'node',
  coverageProvider: 'v8',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.test.json',
      isolatedModules: true,
    }],
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/test/',
    '/dist/',
    '/__mocks__/',
    '\\.spec\\.ts$',
    '\\.test\\.ts$',
  ],
  moduleNameMapper: {
    '^jose$': '<rootDir>/src/test/__mocks__/jose.ts',
    '^bullmq$': '<rootDir>/src/test/__mocks__/bullmq.ts',
    // Map @perfana/shared imports to source files instead of dist (for tests)
    '^@perfana/shared/entities$': '<rootDir>/../../packages/shared/src/entities/index.ts',
    '^@perfana/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    '^@perfana/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    // Strip .js extensions from relative ESM-style imports (e.g., in @perfana/shared source files)
    // Only targets relative paths (./foo.js, ../bar.js) to avoid breaking packages like sha.js
    // Jest resolves the extensionless path via moduleFileExtensions (.ts, .js)
    '^(\\.\\.?\\/.+)\\.js$': '$1',
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/api',
  coverageReporters: ['text', 'json', 'json-summary', 'html', 'lcov'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.(t|j)s',
    '<rootDir>/src/**/?(*.)(spec|test).(t|j)s',
    // Include only helper tests from test/ directory
    // Integration/security/performance tests require Redis/containers infrastructure
    '<rootDir>/test/helpers/*.(spec|test).(t|j)s',
  ],
  // Explicitly ignore infrastructure-dependent tests that require Redis/containers
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/test/integration/',
    '/test/security/',
    '/test/edge-cases/',
    '/test/performance/',
  ],
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
    '!src/**/test/**/*',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/__mocks__/**/*',
    '!src/test/**/*',
    '!src/config/**/*',
    '!src/data-source.ts',
    '!src/app.module.ts',
  ],
  // Global setup REPLACED by pretest script (package.json)
  // Database schema is initialized via: npm run pretest (setup-database.ts)
  // This uses ts-node for proper TypeScript + module resolution
  // globalSetup: '<rootDir>/src/test/global-setup.ts', // Old approach - replaced
  // Setup files run AFTER global setup
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  // Environment variables for testing
  setupFiles: ['<rootDir>/src/test/env.setup.ts'],
};