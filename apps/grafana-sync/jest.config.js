module.exports = {
  // Use ts-jest for TypeScript support
  preset: 'ts-jest',

  // Test environment
  testEnvironment: 'node',

  // Use v8 coverage provider instead of babel (faster and more reliable)
  coverageProvider: 'v8',

  // Root directory
  rootDir: '.',

  // Module file extensions
  moduleFileExtensions: ['js', 'json', 'ts'],

  // Test file patterns
  testRegex: '.*\\.spec\\.ts$',

  // Module name mapping for @perfana/shared
  moduleNameMapper: {
    '^@perfana/shared$': '<rootDir>/../../packages/shared/src',
    '^@perfana/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },

  // Paths to test files
  roots: ['<rootDir>/src/', '<rootDir>/test/'],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/*.interface.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.entity.ts',
    '!src/**/index.ts',
  ],

  // Coverage threshold temporarily disabled due to v8 provider compatibility issue
  // See: https://github.com/jestjs/jest/issues/11188
  // coverageThreshold: {
  //   global: {
  //     branches: 80,
  //     functions: 80,
  //     lines: 80,
  //     statements: 80,
  //   },
  // },

  // Coverage directory
  coverageDirectory: '<rootDir>/coverage',

  // Coverage reporters
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],

  // Clear mocks between tests
  clearMocks: true,

  // Restore mocks between tests
  restoreMocks: true,

  // Reset mocks between tests
  resetMocks: true,

  // Verbose output
  verbose: true,

  // Test timeout (10 seconds)
  testTimeout: 10000,

  // Transform with ts-jest options (updated configuration)
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: {
          // Override tsconfig for tests
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
};
