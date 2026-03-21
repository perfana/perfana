/**
 * Performance Test Aggregation Utilities
 *
 * Provides statistical aggregation functions for performance test metrics including:
 * - Percentile calculations (p50, p95, p99)
 * - Apdex score calculation
 * - Basic statistical aggregations (avg, min, max)
 */

import { APDEX_CONSTANTS } from '../constants/performance-metrics.js';

/**
 * Calculate a specific percentile from an array of numbers
 * Uses linear interpolation method
 *
 * @param values - Array of numbers to calculate percentile from
 * @param percentile - Percentile to calculate (0-100), e.g., 50 for median, 95 for p95
 * @returns The calculated percentile value, or null if array is empty
 */
export function calculatePercentile(values: number[], percentile: number): number | null {
  if (values.length === 0) {
    return null;
  }

  // Sort values in ascending order
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);

  // Use linear interpolation if index is not an integer
  if (Number.isInteger(index)) {
    return sorted[index];
  } else {
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }
}

/**
 * Calculate median (50th percentile) from an array of numbers
 *
 * @param values - Array of numbers
 * @returns The median value, or null if array is empty
 */
export function calculateMedian(values: number[]): number | null {
  return calculatePercentile(values, 50);
}

/**
 * Calculate average (mean) from an array of numbers
 *
 * @param values - Array of numbers
 * @returns The average value, or null if array is empty
 */
export function calculateAverage(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate minimum value from an array of numbers
 *
 * @param values - Array of numbers
 * @returns The minimum value, or null if array is empty
 */
export function calculateMin(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  // FIXED: Use loop instead of Math.min(...values) to avoid stack overflow on large arrays
  let min = values[0]!;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < min) { min = values[i]!; }
  }
  return min;
}

/**
 * Calculate maximum value from an array of numbers
 *
 * @param values - Array of numbers
 * @returns The maximum value, or null if array is empty
 */
export function calculateMax(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > max) { max = values[i]; }
  }
  return max;
}

/**
 * Calculate success rate percentage from success/failure counts
 *
 * @param successCount - Number of successful requests
 * @param totalCount - Total number of requests
 * @returns Success rate as a percentage (0-100), or null if totalCount is 0
 */
export function calculateSuccessRate(successCount: number, totalCount: number): number | null {
  if (totalCount === 0) {
    return null;
  }
  return (successCount / totalCount) * 100;
}

/**
 * Calculate throughput (requests per second)
 *
 * @param requestCount - Total number of requests
 * @param durationSeconds - Duration in seconds
 * @returns Throughput in requests per second, or null if duration is 0
 */
export function calculateThroughput(requestCount: number, durationSeconds: number): number | null {
  if (durationSeconds === 0) {
    return null;
  }
  return requestCount / durationSeconds;
}

/**
 * Calculate error rate (errors per second)
 *
 * @param errorCount - Total number of errors
 * @param durationSeconds - Duration in seconds
 * @returns Error rate in errors per second, or null if duration is 0
 */
export function calculateErrorRate(errorCount: number, durationSeconds: number): number | null {
  if (durationSeconds === 0) {
    return null;
  }
  return errorCount / durationSeconds;
}

/**
 * Apdex score calculation result
 */
export interface ApdexResult {
  /**
   * Apdex score (0.0 - 1.0)
   * 1.0 = all requests satisfied
   * 0.0 = all requests frustrated
   */
  score: number;

  /**
   * Number of satisfied requests (response_time <= T)
   */
  satisfied: number;

  /**
   * Number of tolerating requests (T < response_time <= 4T)
   */
  tolerating: number;

  /**
   * Number of frustrated requests (response_time > 4T)
   */
  frustrated: number;

  /**
   * Total number of requests
   */
  total: number;

  /**
   * Threshold used for calculation (in milliseconds)
   */
  thresholdMs: number;
}

/**
 * Calculate Apdex (Application Performance Index) score
 *
 * Apdex is an industry standard for measuring application performance satisfaction:
 * - Satisfied: response_time <= T (threshold)
 * - Tolerating: T < response_time <= 4T
 * - Frustrated: response_time > 4T
 * - Score = (Satisfied + 0.5 * Tolerating) / Total
 *
 * @param responseTimes - Array of response times in milliseconds
 * @param thresholdMs - Apdex threshold in milliseconds (T)
 * @returns Apdex result with score and breakdown, or null if no data
 *
 * @example
 * ```typescript
 * // Calculate Apdex with 500ms threshold
 * const responseTimes = [100, 300, 500, 1000, 2500];
 * const result = calculateApdex(responseTimes, 500);
 * // result.score = 0.6 (2 satisfied + 2 tolerating + 1 frustrated)
 * ```
 */
export function calculateApdex(
  responseTimes: number[],
  thresholdMs: number
): ApdexResult | null {
  if (responseTimes.length === 0) {
    return null;
  }

  const toleratingThreshold = thresholdMs * APDEX_CONSTANTS.TOLERATING_MULTIPLIER;

  let satisfied = 0;
  let tolerating = 0;
  let frustrated = 0;

  for (const responseTime of responseTimes) {
    if (responseTime <= thresholdMs) {
      satisfied++;
    } else if (responseTime <= toleratingThreshold) {
      tolerating++;
    } else {
      frustrated++;
    }
  }

  const total = responseTimes.length;
  const score = (satisfied + APDEX_CONSTANTS.TOLERATING_WEIGHT * tolerating) / total;

  return {
    score,
    satisfied,
    tolerating,
    frustrated,
    total,
    thresholdMs,
  };
}

/**
 * Calculate Apdex score (simplified version for time-bucketing)
 *
 * This is a simplified version that returns only the numeric score value,
 * useful for time-series bucketing where you need just the score per bucket.
 *
 * Apdex formula:
 * - Satisfied: value <= satisfiedThreshold
 * - Tolerating: satisfiedThreshold < value <= toleratingThreshold
 * - Frustrated: value > toleratingThreshold
 * - Score = (Satisfied + 0.5 * Tolerating) / Total
 *
 * @param values - Array of values (e.g., response times) to calculate Apdex from
 * @param satisfiedThreshold - Threshold for satisfied category
 * @param toleratingThreshold - Threshold for tolerating category (typically 4x satisfiedThreshold)
 * @returns Apdex score between 0.0 and 1.0, or null if array is empty
 *
 * @example
 * ```typescript
 * // Calculate Apdex with custom thresholds
 * const values = [100, 300, 600, 1000, 2500];
 * const score = calculateApdexScore(values, 500, 2000);
 * // score = 0.6 (2 satisfied + 2 tolerating + 1 frustrated)
 * ```
 *
 * @example
 * ```typescript
 * // Use in time-bucketing scenario
 * const bucketValues = [125, 430, 580];
 * const apdexScore = calculateApdexScore(
 *   bucketValues,
 *   transaction.satisfiedThreshold,
 *   transaction.toleratingThreshold
 * );
 * ```
 */
export function calculateApdexScore(
  values: number[],
  satisfiedThreshold: number,
  toleratingThreshold: number
): number | null {
  if (values.length === 0) {
    return null;
  }

  let satisfied = 0;
  let tolerating = 0;

  for (const value of values) {
    if (value <= satisfiedThreshold) {
      satisfied++;
    } else if (value <= toleratingThreshold) {
      tolerating++;
    }
    // Values > toleratingThreshold are frustrated (not counted)
  }

  return (satisfied + tolerating / 2) / values.length;
}

/**
 * Aggregated statistics for a set of values
 */
export interface AggregatedStats {
  avg: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

/**
 * Calculate all common statistical aggregations for a set of values
 *
 * @param values - Array of numbers to aggregate
 * @returns Object containing all aggregated statistics
 */
export function calculateAllStats(values: number[]): AggregatedStats {
  return {
    avg: calculateAverage(values),
    p50: calculatePercentile(values, 50),
    p95: calculatePercentile(values, 95),
    p99: calculatePercentile(values, 99),
    min: calculateMin(values),
    max: calculateMax(values),
    count: values.length,
  };
}

/**
 * Filter out ramp-up data based on cutoff time
 *
 * @param data - Array of records with 'time' field
 * @param rampUpCutoffTime - Date object representing the end of ramp-up period
 * @returns Filtered array with only post-ramp-up data
 */
export function excludeRampUpData<T extends { time: Date }>(
  data: T[],
  rampUpCutoffTime: Date
): T[] {
  return data.filter((record) => record.time >= rampUpCutoffTime);
}

/**
 * Calculate ramp-up cutoff time
 *
 * @param testStartTime - Test start timestamp
 * @param rampUpTimeSeconds - Ramp-up duration in seconds
 * @returns Date object representing the end of ramp-up period
 */
export function calculateRampUpCutoffTime(
  testStartTime: Date,
  rampUpTimeSeconds: number
): Date {
  const cutoffTime = new Date(testStartTime);
  cutoffTime.setSeconds(cutoffTime.getSeconds() + rampUpTimeSeconds);
  return cutoffTime;
}
