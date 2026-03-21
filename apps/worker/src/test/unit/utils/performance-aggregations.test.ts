/**
 * Unit tests for Performance Aggregation Utilities
 *
 * Tests for statistical functions used in performance metrics processing including:
 * - Percentile calculations
 * - Apdex score calculation
 * - Basic statistical aggregations (avg, min, max, median)
 * - Success rate and throughput calculations
 * - Ramp-up data filtering
 */

import {
  calculatePercentile,
  calculateMedian,
  calculateAverage,
  calculateMin,
  calculateMax,
  calculateSuccessRate,
  calculateThroughput,
  calculateErrorRate,
  calculateApdex,
  calculateApdexScore,
  calculateAllStats,
  excludeRampUpData,
  calculateRampUpCutoffTime,
  ApdexResult,
  AggregatedStats,
} from '../../../utils/performance-aggregations.js';

describe('Performance Aggregations', () => {
  describe('calculatePercentile', () => {
    it('should return null for empty array', () => {
      expect(calculatePercentile([], 50)).toBeNull();
    });

    it('should calculate 50th percentile (median) correctly', () => {
      const values = [1, 2, 3, 4, 5];
      expect(calculatePercentile(values, 50)).toBe(3);
    });

    it('should calculate 95th percentile correctly', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(calculatePercentile(values, 95)).toBeCloseTo(9.55, 2);
    });

    it('should calculate 99th percentile correctly', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(calculatePercentile(values, 99)).toBeCloseTo(9.91, 2);
    });

    it('should handle single value array', () => {
      expect(calculatePercentile([42], 95)).toBe(42);
    });

    it('should use linear interpolation for non-integer indices', () => {
      const values = [10, 20, 30, 40, 50];
      const p75 = calculatePercentile(values, 75);
      expect(p75).toBe(40);
    });

    it('should not modify original array', () => {
      const values = [5, 3, 1, 4, 2];
      const originalValues = [...values];
      calculatePercentile(values, 50);
      expect(values).toEqual(originalValues);
    });
  });

  describe('calculateMedian', () => {
    it('should return null for empty array', () => {
      expect(calculateMedian([])).toBeNull();
    });

    it('should calculate median for odd-length array', () => {
      expect(calculateMedian([1, 2, 3, 4, 5])).toBe(3);
    });

    it('should calculate median for even-length array', () => {
      expect(calculateMedian([1, 2, 3, 4])).toBe(2.5);
    });

    it('should handle unsorted arrays', () => {
      expect(calculateMedian([5, 1, 3, 2, 4])).toBe(3);
    });
  });

  describe('calculateAverage', () => {
    it('should return null for empty array', () => {
      expect(calculateAverage([])).toBeNull();
    });

    it('should calculate average correctly', () => {
      expect(calculateAverage([1, 2, 3, 4, 5])).toBe(3);
    });

    it('should handle single value', () => {
      expect(calculateAverage([42])).toBe(42);
    });

    it('should handle decimal values', () => {
      expect(calculateAverage([1.5, 2.5, 3.5])).toBe(2.5);
    });

    it('should handle negative values', () => {
      expect(calculateAverage([-5, 0, 5])).toBe(0);
    });
  });

  describe('calculateMin', () => {
    it('should return null for empty array', () => {
      expect(calculateMin([])).toBeNull();
    });

    it('should find minimum value', () => {
      expect(calculateMin([5, 2, 8, 1, 9])).toBe(1);
    });

    it('should handle single value', () => {
      expect(calculateMin([42])).toBe(42);
    });

    it('should handle negative values', () => {
      expect(calculateMin([10, -5, 0, 3])).toBe(-5);
    });
  });

  describe('calculateMax', () => {
    it('should return null for empty array', () => {
      expect(calculateMax([])).toBeNull();
    });

    it('should find maximum value', () => {
      expect(calculateMax([5, 2, 8, 1, 9])).toBe(9);
    });

    it('should handle single value', () => {
      expect(calculateMax([42])).toBe(42);
    });

    it('should handle negative values', () => {
      expect(calculateMax([-10, -5, -20, -3])).toBe(-3);
    });
  });

  describe('calculateSuccessRate', () => {
    it('should return null when totalCount is 0', () => {
      expect(calculateSuccessRate(0, 0)).toBeNull();
    });

    it('should calculate 100% success rate', () => {
      expect(calculateSuccessRate(100, 100)).toBe(100);
    });

    it('should calculate 0% success rate', () => {
      expect(calculateSuccessRate(0, 100)).toBe(0);
    });

    it('should calculate partial success rate', () => {
      expect(calculateSuccessRate(75, 100)).toBe(75);
    });

    it('should handle decimal results', () => {
      expect(calculateSuccessRate(33, 100)).toBe(33);
    });
  });

  describe('calculateThroughput', () => {
    it('should return null when duration is 0', () => {
      expect(calculateThroughput(100, 0)).toBeNull();
    });

    it('should calculate throughput correctly', () => {
      expect(calculateThroughput(1000, 60)).toBeCloseTo(16.67, 2);
    });

    it('should handle 0 requests', () => {
      expect(calculateThroughput(0, 60)).toBe(0);
    });

    it('should calculate throughput for 1 second', () => {
      expect(calculateThroughput(10, 1)).toBe(10);
    });
  });

  describe('calculateErrorRate', () => {
    it('should return null when duration is 0', () => {
      expect(calculateErrorRate(10, 0)).toBeNull();
    });

    it('should calculate error rate correctly', () => {
      expect(calculateErrorRate(120, 60)).toBe(2);
    });

    it('should handle 0 errors', () => {
      expect(calculateErrorRate(0, 60)).toBe(0);
    });

    it('should calculate error rate for 1 second', () => {
      expect(calculateErrorRate(5, 1)).toBe(5);
    });
  });

  describe('calculateApdex', () => {
    it('should return null for empty array', () => {
      expect(calculateApdex([], 500)).toBeNull();
    });

    it('should return score of 1.0 when all requests are satisfied', () => {
      const responseTimes = [100, 200, 300, 400, 500];
      const result = calculateApdex(responseTimes, 500);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(1.0);
      expect(result!.satisfied).toBe(5);
      expect(result!.tolerating).toBe(0);
      expect(result!.frustrated).toBe(0);
      expect(result!.total).toBe(5);
      expect(result!.thresholdMs).toBe(500);
    });

    it('should return score of 0.0 when all requests are frustrated', () => {
      const responseTimes = [3000, 4000, 5000];
      const result = calculateApdex(responseTimes, 500);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(0.0);
      expect(result!.satisfied).toBe(0);
      expect(result!.tolerating).toBe(0);
      expect(result!.frustrated).toBe(3);
      expect(result!.total).toBe(3);
    });

    it('should calculate score with mixed satisfied, tolerating, and frustrated', () => {
      // Threshold: 500ms
      // Tolerating threshold: 2000ms (500 * 4)
      // satisfied: 100, 300, 500 = 3 requests
      // tolerating: 1000, 1500 = 2 requests
      // frustrated: 2500, 3000 = 2 requests
      // score = (3 + 2 * 0.5) / 7 = 4 / 7 = 0.571428...
      const responseTimes = [100, 300, 500, 1000, 1500, 2500, 3000];
      const result = calculateApdex(responseTimes, 500);

      expect(result).not.toBeNull();
      expect(result!.score).toBeCloseTo(0.571428, 5);
      expect(result!.satisfied).toBe(3);
      expect(result!.tolerating).toBe(2);
      expect(result!.frustrated).toBe(2);
      expect(result!.total).toBe(7);
    });

    it('should handle all tolerating requests', () => {
      const responseTimes = [600, 800, 1000, 1500, 2000];
      const result = calculateApdex(responseTimes, 500);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(0.5); // (0 + 5 * 0.5) / 5
      expect(result!.satisfied).toBe(0);
      expect(result!.tolerating).toBe(5);
      expect(result!.frustrated).toBe(0);
    });

    it('should use correct tolerating threshold (4T)', () => {
      const responseTimes = [1999, 2000, 2001];
      const result = calculateApdex(responseTimes, 500);

      expect(result).not.toBeNull();
      // 1999 and 2000 are tolerating (500 < x <= 2000)
      // 2001 is frustrated (x > 2000)
      expect(result!.satisfied).toBe(0);
      expect(result!.tolerating).toBe(2);
      expect(result!.frustrated).toBe(1);
    });

    it('should handle edge case where response time equals threshold', () => {
      const responseTimes = [500];
      const result = calculateApdex(responseTimes, 500);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(1.0);
      expect(result!.satisfied).toBe(1);
      expect(result!.tolerating).toBe(0);
      expect(result!.frustrated).toBe(0);
    });

    it('should handle edge case where response time equals tolerating threshold', () => {
      const responseTimes = [2000];
      const result = calculateApdex(responseTimes, 500);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(0.5);
      expect(result!.satisfied).toBe(0);
      expect(result!.tolerating).toBe(1);
      expect(result!.frustrated).toBe(0);
    });

    it('should handle single value', () => {
      const result = calculateApdex([250], 500);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(1.0);
      expect(result!.total).toBe(1);
    });

    it('should handle large datasets', () => {
      const responseTimes = Array(1000).fill(300);
      const result = calculateApdex(responseTimes, 500);

      expect(result).not.toBeNull();
      expect(result!.score).toBe(1.0);
      expect(result!.total).toBe(1000);
    });
  });

  describe('calculateApdexScore', () => {
    it('should return null for empty array', () => {
      expect(calculateApdexScore([], 500, 2000)).toBeNull();
    });

    it('should return 1.0 when all values are satisfied', () => {
      const values = [100, 200, 300, 400, 500];
      expect(calculateApdexScore(values, 500, 2000)).toBe(1.0);
    });

    it('should return 0.0 when all values are frustrated', () => {
      const values = [2500, 3000, 3500];
      expect(calculateApdexScore(values, 500, 2000)).toBe(0.0);
    });

    it('should calculate score with mixed values', () => {
      // satisfied: 100, 300 = 2
      // tolerating: 600, 1000 = 2
      // frustrated: 2500 = 1
      // score = (2 + 2/2) / 5 = 3 / 5 = 0.6
      const values = [100, 300, 600, 1000, 2500];
      expect(calculateApdexScore(values, 500, 2000)).toBe(0.6);
    });

    it('should handle all tolerating values', () => {
      const values = [600, 800, 1000, 1500, 2000];
      expect(calculateApdexScore(values, 500, 2000)).toBe(0.5);
    });

    it('should handle edge case where value equals satisfiedThreshold', () => {
      expect(calculateApdexScore([500], 500, 2000)).toBe(1.0);
    });

    it('should handle edge case where value equals toleratingThreshold', () => {
      expect(calculateApdexScore([2000], 500, 2000)).toBe(0.5);
    });

    it('should correctly classify values just above satisfiedThreshold', () => {
      // 501 should be tolerating, not satisfied
      const values = [500, 501];
      const score = calculateApdexScore(values, 500, 2000);
      expect(score).toBe(0.75); // (1 + 1/2) / 2 = 0.75
    });

    it('should correctly classify values just above toleratingThreshold', () => {
      // 2001 should be frustrated, not tolerating
      const values = [2000, 2001];
      const score = calculateApdexScore(values, 500, 2000);
      expect(score).toBe(0.25); // (0 + 1/2) / 2 = 0.25
    });

    it('should handle single value', () => {
      expect(calculateApdexScore([250], 500, 2000)).toBe(1.0);
    });

    it('should handle equal thresholds edge case', () => {
      // When satisfiedThreshold == toleratingThreshold
      // Only satisfied or frustrated categories exist
      const values = [400, 500, 600];
      expect(calculateApdexScore(values, 500, 500)).toBeCloseTo(0.6667, 4);
    });

    it('should handle large datasets efficiently', () => {
      const values = Array(10000).fill(300);
      const score = calculateApdexScore(values, 500, 2000);
      expect(score).toBe(1.0);
    });

    it('should match standard Apdex calculation formula', () => {
      // Test case from Apdex specification
      // T = 500ms, 4T = 2000ms
      // satisfied: 100 requests
      // tolerating: 50 requests
      // frustrated: 25 requests
      // score = (100 + 50/2) / 175 = 125 / 175 = 0.714285...
      const values = [
        ...Array(100).fill(400),   // satisfied
        ...Array(50).fill(1000),   // tolerating
        ...Array(25).fill(3000),   // frustrated
      ];
      expect(calculateApdexScore(values, 500, 2000)).toBeCloseTo(0.714285, 5);
    });
  });

  describe('calculateAllStats', () => {
    it('should return null values for empty array', () => {
      const stats = calculateAllStats([]);

      expect(stats.avg).toBeNull();
      expect(stats.p50).toBeNull();
      expect(stats.p95).toBeNull();
      expect(stats.p99).toBeNull();
      expect(stats.min).toBeNull();
      expect(stats.max).toBeNull();
      expect(stats.count).toBe(0);
    });

    it('should calculate all statistics correctly', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const stats = calculateAllStats(values);

      expect(stats.avg).toBe(5.5);
      expect(stats.p50).toBe(5.5);
      expect(stats.p95).toBeCloseTo(9.55, 2);
      expect(stats.p99).toBeCloseTo(9.91, 2);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(10);
      expect(stats.count).toBe(10);
    });

    it('should handle single value', () => {
      const stats = calculateAllStats([42]);

      expect(stats.avg).toBe(42);
      expect(stats.p50).toBe(42);
      expect(stats.p95).toBe(42);
      expect(stats.p99).toBe(42);
      expect(stats.min).toBe(42);
      expect(stats.max).toBe(42);
      expect(stats.count).toBe(1);
    });
  });

  describe('excludeRampUpData', () => {
    it('should filter out data before cutoff time', () => {
      const cutoffTime = new Date('2024-01-01T10:00:30Z');
      const data = [
        { time: new Date('2024-01-01T10:00:15Z'), value: 1 },
        { time: new Date('2024-01-01T10:00:25Z'), value: 2 },
        { time: new Date('2024-01-01T10:00:30Z'), value: 3 },
        { time: new Date('2024-01-01T10:00:45Z'), value: 4 },
      ];

      const filtered = excludeRampUpData(data, cutoffTime);

      expect(filtered).toHaveLength(2);
      expect(filtered[0].value).toBe(3);
      expect(filtered[1].value).toBe(4);
    });

    it('should include data at exact cutoff time', () => {
      const cutoffTime = new Date('2024-01-01T10:00:30Z');
      const data = [
        { time: new Date('2024-01-01T10:00:30Z'), value: 1 },
      ];

      const filtered = excludeRampUpData(data, cutoffTime);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].value).toBe(1);
    });

    it('should return empty array when all data is before cutoff', () => {
      const cutoffTime = new Date('2024-01-01T10:00:30Z');
      const data = [
        { time: new Date('2024-01-01T10:00:15Z'), value: 1 },
        { time: new Date('2024-01-01T10:00:25Z'), value: 2 },
      ];

      const filtered = excludeRampUpData(data, cutoffTime);

      expect(filtered).toHaveLength(0);
    });

    it('should return all data when all is after cutoff', () => {
      const cutoffTime = new Date('2024-01-01T10:00:00Z');
      const data = [
        { time: new Date('2024-01-01T10:00:15Z'), value: 1 },
        { time: new Date('2024-01-01T10:00:25Z'), value: 2 },
      ];

      const filtered = excludeRampUpData(data, cutoffTime);

      expect(filtered).toHaveLength(2);
    });

    it('should handle empty array', () => {
      const cutoffTime = new Date('2024-01-01T10:00:30Z');
      const filtered = excludeRampUpData([], cutoffTime);

      expect(filtered).toHaveLength(0);
    });
  });

  describe('calculateRampUpCutoffTime', () => {
    it('should calculate cutoff time correctly', () => {
      const startTime = new Date('2024-01-01T10:00:00Z');
      const rampUpSeconds = 30;

      const cutoffTime = calculateRampUpCutoffTime(startTime, rampUpSeconds);

      expect(cutoffTime.toISOString()).toBe('2024-01-01T10:00:30.000Z');
    });

    it('should handle 0 ramp-up time', () => {
      const startTime = new Date('2024-01-01T10:00:00Z');
      const cutoffTime = calculateRampUpCutoffTime(startTime, 0);

      expect(cutoffTime.toISOString()).toBe(startTime.toISOString());
    });

    it('should handle large ramp-up times', () => {
      const startTime = new Date('2024-01-01T10:00:00Z');
      const rampUpSeconds = 3600; // 1 hour

      const cutoffTime = calculateRampUpCutoffTime(startTime, rampUpSeconds);

      expect(cutoffTime.toISOString()).toBe('2024-01-01T11:00:00.000Z');
    });

    it('should not modify original date', () => {
      const startTime = new Date('2024-01-01T10:00:00Z');
      const originalTime = startTime.toISOString();

      calculateRampUpCutoffTime(startTime, 30);

      expect(startTime.toISOString()).toBe(originalTime);
    });
  });
});
