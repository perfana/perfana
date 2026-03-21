/**
 * Time-Series Bucketing Utilities
 *
 * Provides utilities for bucketing time-series data into fixed-size time intervals
 * for the Performance Test Metrics Pipeline refactoring.
 *
 * Key features:
 * - Dynamic bucket size calculation based on test duration
 * - Time-series data bucketing with gap handling
 * - Statistical aggregation for values within each bucket
 *
 * @see apps/worker/PERFORMANCE_METRICS_REFACTORING_PLAN.md
 */

import {
  calculateAverage,
  calculatePercentile,
} from './performance-aggregations.js';

/**
 * Time bucket containing aggregated values for a specific time interval
 */
export interface TimeBucket {
  /**
   * Timestamp representing the start of this bucket
   */
  timestamp: Date;

  /**
   * Array of all values that fall within this bucket's time range
   */
  values: number[];

  /**
   * Number of values in this bucket
   */
  count: number;

  /**
   * Count of failed requests/operations in this bucket (optional)
   */
  failedCount?: number;

  /**
   * Count of successful requests/operations in this bucket (optional)
   */
  successCount?: number;

  /**
   * Total count including both success and failures (optional)
   */
  totalCount?: number;
}

/**
 * Aggregated statistics for a time bucket
 */
export interface BucketAggregation {
  /**
   * Average value in the bucket
   */
  avg: number | null;

  /**
   * 50th percentile (median)
   */
  p50: number | null;

  /**
   * 90th percentile
   */
  p90: number | null;

  /**
   * 95th percentile
   */
  p95: number | null;

  /**
   * 99th percentile
   */
  p99: number | null;
}

/**
 * Complete bucketed metric data with aggregations
 */
export interface BucketedMetricData {
  /**
   * Timestamp for this data point
   */
  timestamp: Date;

  /**
   * Statistical aggregations for this bucket
   */
  aggregations: BucketAggregation;

  /**
   * Number of values in this bucket
   */
  count: number;
}

/**
 * Configuration for target data points
 */
export interface BucketSizeConfig {
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

/**
 * Bucket time-series data into fixed-size time intervals
 *
 * Groups data points by time bucket and handles gaps in data by creating empty buckets.
 * All buckets between startTime and endTime are created, even if they contain no data.
 *
 * @param data - Array of data points with timestamp and value
 * @param bucketSizeSeconds - Size of each bucket in seconds
 * @param startTime - Start time of the test run
 * @param endTime - End time of the test run
 * @returns Array of time buckets sorted by timestamp
 *
 * @example
 * ```typescript
 * const data = [
 *   { timestamp: new Date('2025-01-01T10:00:00Z'), value: 125.4 },
 *   { timestamp: new Date('2025-01-01T10:00:01Z'), value: 128.1 },
 *   { timestamp: new Date('2025-01-01T10:00:02Z'), value: 122.7 },
 * ];
 *
 * const buckets = bucketTimeSeriesData(
 *   data,
 *   1, // 1 second buckets
 *   new Date('2025-01-01T10:00:00Z'),
 *   new Date('2025-01-01T10:00:05Z')
 * );
 *
 * // Result: 5 buckets (10:00:00 to 10:00:04), some with data, some empty
 * ```
 */
export function bucketTimeSeriesData(
  data: Array<{ timestamp: Date; value: number; success?: boolean }>,
  bucketSizeSeconds: number,
  startTime: Date,
  endTime: Date
): TimeBucket[] {
  if (bucketSizeSeconds <= 0) {
    throw new Error('Bucket size must be positive');
  }

  if (startTime >= endTime) {
    throw new Error('Start time must be before end time');
  }

  // Convert to milliseconds for calculations
  const bucketSizeMs = bucketSizeSeconds * 1000;
  const startTimeMs = startTime.getTime();
  const endTimeMs = endTime.getTime();

  // Create map to store buckets by timestamp
  const bucketMap = new Map<number, TimeBucket>();

  // Initialize all buckets (including empty ones to handle gaps)
  for (let time = startTimeMs; time < endTimeMs; time += bucketSizeMs) {
    bucketMap.set(time, {
      timestamp: new Date(time),
      values: [],
      count: 0,
      failedCount: 0,
      successCount: 0,
      totalCount: 0,
    });
  }

  // Fill buckets with data
  for (const point of data) {
    const pointTime = point.timestamp.getTime();

    // Skip points outside the time range
    if (pointTime < startTimeMs || pointTime >= endTimeMs) {
      continue;
    }

    // Calculate which bucket this point belongs to
    const bucketTime = Math.floor((pointTime - startTimeMs) / bucketSizeMs) * bucketSizeMs + startTimeMs;

    const bucket = bucketMap.get(bucketTime);
    if (bucket) {
      bucket.values.push(point.value);
      bucket.count++;
      bucket.totalCount!++;

      // Track success/failure counts if provided
      if (typeof point.success === 'boolean') {
        if (point.success) {
          bucket.successCount!++;
        } else {
          bucket.failedCount!++;
        }
      }
    }
  }

  // Convert map to sorted array
  return Array.from(bucketMap.values()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Calculate aggregated statistics for values in a bucket
 *
 * Computes common statistical aggregations (avg, p50, p90, p95, p99) using
 * the existing statistics utilities from performance-aggregations.ts
 *
 * @param values - Array of values to aggregate
 * @returns Object containing all aggregated statistics
 *
 * @example
 * ```typescript
 * const values = [125.4, 128.1, 122.7, 130.5, 126.9];
 * const stats = aggregateValuesInBucket(values);
 * // Result: { avg: 126.72, p50: 126.9, p90: 130.1, p95: 130.3, p99: 130.46 }
 * ```
 */
export function aggregateValuesInBucket(values: number[]): BucketAggregation {
  return {
    avg: calculateAverage(values),
    p50: calculatePercentile(values, 50),
    p90: calculatePercentile(values, 90),
    p95: calculatePercentile(values, 95),
    p99: calculatePercentile(values, 99),
  };
}

/**
 * Process bucketed data to include aggregated statistics
 *
 * Converts raw time buckets into enriched metric data with statistical aggregations.
 * This is a convenience function that combines bucketing with aggregation.
 *
 * @param buckets - Array of time buckets
 * @returns Array of bucketed metric data with aggregations
 *
 * @example
 * ```typescript
 * const buckets = bucketTimeSeriesData(data, 5, startTime, endTime);
 * const metricData = processBucketedData(buckets);
 * // Each item contains: timestamp, aggregations (avg, p50, p90, p95, p99), count
 * ```
 */
export function processBucketedData(buckets: TimeBucket[]): BucketedMetricData[] {
  return buckets.map((bucket) => ({
    timestamp: bucket.timestamp,
    aggregations: aggregateValuesInBucket(bucket.values),
    count: bucket.count,
  }));
}

/**
 * Calculate error rate percentage for a bucket
 *
 * @param failedCount - Number of failed requests in the bucket
 * @param totalCount - Total number of requests in the bucket
 * @returns Error rate as a percentage (0-100), or null if totalCount is 0
 *
 * @example
 * ```typescript
 * calculateErrorRate(5, 100); // 5% error rate
 * calculateErrorRate(0, 100); // 0% error rate
 * calculateErrorRate(10, 0);  // null (no data)
 * ```
 */
export function calculateErrorRate(failedCount: number, totalCount: number): number | null {
  if (totalCount === 0) {
    return null;
  }
  return (failedCount / totalCount) * 100;
}

/**
 * Calculate throughput (requests per second) for a bucket
 *
 * @param requestCount - Number of requests in the bucket
 * @param bucketSizeSeconds - Size of the bucket in seconds
 * @returns Throughput in requests per second, or null if bucketSizeSeconds is 0
 *
 * @example
 * ```typescript
 * calculateThroughput(50, 5);  // 10 req/s
 * calculateThroughput(100, 10); // 10 req/s
 * calculateThroughput(0, 5);    // 0 req/s
 * ```
 */
export function calculateThroughput(requestCount: number, bucketSizeSeconds: number): number | null {
  if (bucketSizeSeconds === 0) {
    return null;
  }
  return requestCount / bucketSizeSeconds;
}

/**
 * Validate time-series data for bucketing
 *
 * Checks that the data is suitable for bucketing and provides helpful error messages.
 *
 * @param data - Array of data points to validate
 * @param startTime - Start time of the test run
 * @param endTime - End time of the test run
 * @throws Error if validation fails
 */
export function validateTimeSeriesData(
  data: Array<{ timestamp: Date; value: number }>,
  startTime: Date,
  endTime: Date
): void {
  if (!Array.isArray(data)) {
    throw new Error('Data must be an array');
  }

  if (startTime >= endTime) {
    throw new Error('Start time must be before end time');
  }

  // Check that data points have required fields
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    const point = data[i];
    if (!point.timestamp || !(point.timestamp instanceof Date)) {
      throw new Error(`Data point at index ${i} has invalid timestamp`);
    }
    if (typeof point.value !== 'number' || isNaN(point.value)) {
      throw new Error(`Data point at index ${i} has invalid value`);
    }
  }
}
