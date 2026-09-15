/**
 * Deployment-wide default for `thresholds.minSampleCount` (env `ADAPT_MIN_SAMPLE_COUNT`).
 * Leaf module: read by both config/environment.ts (the boot-time zod gate) and the ADAPT
 * SQL fragments (which read process.env directly so unit tests need no full config).
 */
export const DEFAULT_ADAPT_MIN_SAMPLE_COUNT = 2;
