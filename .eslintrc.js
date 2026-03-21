module.exports = {
  root: true,
  extends: [
    'eslint:recommended',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_'
    }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-empty-function': 'warn',
    'no-unused-vars': 'off', // Turn off base rule as it can report incorrect errors
    'prefer-const': 'warn',
  },
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      extends: ['plugin:@typescript-eslint/recommended'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn', // Warn instead of error
        '@typescript-eslint/ban-types': 'warn', // Warn instead of error
        '@typescript-eslint/no-var-requires': 'warn', // Warn instead of error
        'no-prototype-builtins': 'warn', // Warn instead of error
      },
    },
    {
      files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/*.test.ts', 'test/**/*.ts', '**/test/**/*.ts'],
      parserOptions: {
        project: null, // Don't use TypeScript project for test files
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off', // Allow any in test files
        '@typescript-eslint/no-var-requires': 'off', // Allow require in test files
        '@typescript-eslint/no-unused-vars': 'off', // Allow unused vars in test files
      },
    },
  ],
  ignorePatterns: [
    '**/*.d.ts',  // Exclude all TypeScript declaration files from linting
    'node_modules/',
    'dist/',
    '.next/',
    'out/',
  ],
};