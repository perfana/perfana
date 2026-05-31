/**
 * Time-Series Bucketing Utilities
 *
 * Provides utilities for bucketing time-series data into fixed-size time intervals
 * for the Performance Test Metrics Pipeline refactoring.
 *
 * Key features:
 * - Dynamic bucket size calculation based on test duration
 *
 * @see apps/worker/PERFORMANCE_METRICS_REFACTORING_PLAN.md
 */

/**
 * Configuration for target data points
 */
interface BucketSizeConfig {
  /**
   * Target number of data points to generate
   * Default: 1000
   */
  targetDataPoints: number;
}

/**
 * Default configuration for bucket sizing
 */
const DEFAULT_BUCKET_CONFIG: BucketSizeConfig = {
  targetDataPoints: 1000,
};

/**
 * Reduced target data points for full (non-incremental) collection.
 * Uses fewer data points since batch refresh doesn't need fine-grained resolution,
 * resulting in ~3x fewer ds_metrics rows to write and read.
 */
export const FULL_COLLECTION_TARGET_DATA_POINTS = 250;

/**
 * Calculate optimal bucket size to cap data points at target while using sensible intervals
 *
 * The algorithm ensures that:
 * - Data points never exceed the target
 * - Bucket sizes are rounded to sensible values (1s, 5s, 10s, 30s, 60s, or multiples of 60s)
 * - Short tests get fine-grained buckets (1s)
 * - Long tests get coarser buckets to avoid excessive data points
 *
 * @param testDurationSeconds - Total duration of the test in seconds
 * @param targetDataPoints - Maximum number of data points to generate (default: 1000)
 * @returns Bucket size in seconds
 *
 * @example
 * ```typescript
 * calculateBucketSize(60);     // 60s test → 1s buckets (60 data points)
 * calculateBucketSize(300);    // 300s test → 1s buckets (300 data points)
 * calculateBucketSize(1800);   // 1800s test → 5s buckets (360 data points)
 * calculateBucketSize(3600);   // 3600s test → 5s buckets (720 data points)
 * calculateBucketSize(7200);   // 7200s test → 10s buckets (720 data points)
 * calculateBucketSize(14400);  // 14400s test → 30s buckets (480 data points)
 * calculateBucketSize(86400);  // 86400s test → 120s buckets (720 data points)
 * ```
 */
export function calculateBucketSize(
  testDurationSeconds: number,
  targetDataPoints: number = DEFAULT_BUCKET_CONFIG.targetDataPoints
): number {
  if (testDurationSeconds <= 0) {
    throw new Error('Test duration must be positive');
  }

  if (targetDataPoints <= 0) {
    throw new Error('Target data points must be positive');
  }

  // Calculate ideal bucket size
  const idealBucketSize = Math.ceil(testDurationSeconds / targetDataPoints);

  // Round to sensible bucket sizes
  if (idealBucketSize <= 1) {
    return 1; // 1s buckets
  }

  if (idealBucketSize <= 5) {
    return 5; // 5s buckets
  }

  if (idealBucketSize <= 10) {
    return 10; // 10s buckets
  }

  if (idealBucketSize <= 15) {
    return 15; // 15s buckets
  }

  if (idealBucketSize <= 30) {
    return 30; // 30s buckets
  }

  if (idealBucketSize <= 60) {
    return 60; // 1min buckets
  }

  // For larger durations, round to nearest minute
  return Math.ceil(idealBucketSize / 60) * 60;
}
