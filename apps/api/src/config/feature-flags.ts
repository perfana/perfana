export const FeatureFlags = {
  USE_NATIVE_DB: process.env.USE_NATIVE_DB === 'true',
  USE_NATIVE_AUTH: process.env.USE_NATIVE_AUTH === 'true',
  USE_NATIVE_REALTIME: process.env.USE_NATIVE_REALTIME === 'true',
  ENABLE_MIGRATION_TESTING: process.env.ENABLE_MIGRATION_TESTING === 'true',
  LOG_MIGRATION_DIFFS: process.env.LOG_MIGRATION_DIFFS === 'true',
} as const;

export type FeatureFlag = keyof typeof FeatureFlags;