/**
 * StatisticsPipeline Unit Tests
 *
 * Tests the StatisticsPipeline class functionality including:
 * - Pipeline execution flow
 * - Input validation
 * - Statistics aggregation (mean, median, percentiles, etc.)
 * - Complex SQL aggregation queries
 * - Multiple test run processing
 * - Error handling
 * - Edge cases (no metrics, missing data)
 * - Performance logging
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { StatisticsPipeline, StatisticsInput } from '../../../pipelines/StatisticsPipeline.js';
import { getLogger } from '../../../lib/utils/logger.js';
import * as databaseAccessor from '../../../common/database-accessor.js';
import { EntityManager } from 'typeorm';

// Mock dependencies
vi.mock('../../../lib/utils/logger.js');
vi.mock('../../../common/database-accessor.js');

describe('StatisticsPipeline', () => {
  let pipeline: StatisticsPipeline;
  let mockLogger: any;
  let mockDb: any;
  let mockEntityManager: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };
    vi.mocked(getLogger).mockReturnValue(mockLogger as any);

    // Setup mock entity manager
    mockEntityManager = {
      query: vi.fn().mockResolvedValue([])
    };

    // Setup mock database service
    // The transaction mock creates a proxy that intercepts SET LOCAL calls
    // (from withAnalyticsTransaction) AND the ramp_up refresh UPDATE (from
    // refreshRampUpFlags) so they don't consume mockResolvedValueOnce chains or
    // shift mock.calls indices on mockEntityManager.query — those chains model
    // only the aggregation query sequence.
    mockDb = {
      transaction: vi.fn((fn) => {
        const proxy = new Proxy(mockEntityManager, {
          get(target: any, prop: string) {
            if (prop === 'query') {
              return (...args: any[]) => {
                if (
                  typeof args[0] === 'string' &&
                  (args[0].includes('SET LOCAL') || args[0].includes('UPDATE ds_metrics'))
                ) {
                  return Promise.resolve(undefined);
                }
                return target.query(...args);
              };
            }
            return target[prop];
          }
        });
        return fn(proxy);
      }),
      query: vi.fn().mockResolvedValue([undefined, 0]) // Mock cleanup query
    };

    vi.mocked(databaseAccessor.getDatabaseService).mockReturnValue(mockDb as any);

    // Create pipeline instance
    pipeline = new StatisticsPipeline(mockLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Input Validation', () => {
    test('should validate valid input with single test run', () => {
      const validInput: StatisticsInput = {
        testRunIds: ['test-run-001']
      };

      expect(pipeline.validateInput(validInput)).toBe(true);
    });

    test('should validate valid input with multiple test runs', () => {
      const validInput: StatisticsInput = {
        testRunIds: ['test-run-001', 'test-run-002', 'test-run-003']
      };

      expect(pipeline.validateInput(validInput)).toBe(true);
    });

    test('should reject null input', () => {
      expect(pipeline.validateInput(null)).toBe(false);
    });

    test('should reject undefined input', () => {
      expect(pipeline.validateInput(undefined)).toBe(false);
    });

    test('should reject non-object input', () => {
      expect(pipeline.validateInput('string')).toBe(false);
      expect(pipeline.validateInput(123)).toBe(false);
      expect(pipeline.validateInput([])).toBe(false);
    });

    test('should reject input without testRunIds', () => {
      expect(pipeline.validateInput({})).toBe(false);
    });

    test('should reject input with non-array testRunIds', () => {
      expect(pipeline.validateInput({ testRunIds: 'test-run-001' })).toBe(false);
      expect(pipeline.validateInput({ testRunIds: 123 })).toBe(false);
      expect(pipeline.validateInput({ testRunIds: {} })).toBe(false);
    });

    test('should reject input with empty testRunIds array', () => {
      expect(pipeline.validateInput({ testRunIds: [] })).toBe(false);
    });

    test('should reject input with non-string array elements', () => {
      expect(pipeline.validateInput({ testRunIds: [123, 456] })).toBe(false);
      expect(pipeline.validateInput({ testRunIds: ['valid', 123] })).toBe(false);
      expect(pipeline.validateInput({ testRunIds: [null, 'valid'] })).toBe(false);
      expect(pipeline.validateInput({ testRunIds: [undefined] })).toBe(false);
    });

    test('should accept input with all string test run IDs', () => {
      const input = { testRunIds: ['test-1', 'test-2', 'test-3', 'test-4'] };
      expect(pipeline.validateInput(input)).toBe(true);
    });
  });

  describe('Pipeline Execution - Happy Path', () => {
    test('should execute successfully with metrics data', async () => {
      const testRunIds = ['test-run-001'];

      // Mock query sequence: metrics count, DELETE, expected rows, INSERT, actual count
      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 10 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 10 }]);          // Actual count verification

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        processedRecords: 10,
        testRunIds: 1
      });
    });

    test('should execute successfully with multiple test runs', async () => {
      const testRunIds = ['test-run-001', 'test-run-002', 'test-run-003'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '500' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 50 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 50 }]);          // Actual count verification

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        processedRecords: 50,
        testRunIds: 3
      });
    });

    test('should call cleanup for stale application dashboards', async () => {
      const testRunIds = ['test-run-001'];

      mockDb.query.mockResolvedValue([undefined, 0]); // No stale data
      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 10 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 10 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ds_metric_statistics')
      );
    });

    test('should execute aggregation query with parameterized test run IDs', async () => {
      const testRunIds = ['test-run-001', 'test-run-002'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '200' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 20 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 20 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      // Verify aggregation query was called with test run IDs
      const aggregationCall = mockEntityManager.query.mock.calls[3];
      expect(aggregationCall[0]).toContain('INSERT INTO ds_metric_statistics');
      expect(aggregationCall[1]).toEqual(testRunIds);
    });

    test('should log aggregation progress', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 10 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 10 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting statistics aggregation')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Aggregating statistics for 1 test run')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Statistics aggregation completed')
      );
    });
  });

  describe('Pipeline Execution - Edge Cases', () => {
    test('should handle no metrics found for test runs', async () => {
      const testRunIds = ['test-run-001'];

      // Mock zero metrics
      mockEntityManager.query.mockResolvedValueOnce([{ count: '0' }]);

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        processedRecords: 0,
        testRunIds: 1
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No metrics found for test runs')
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('MetricsPipeline hasn\'t run yet')
      );
    });

    test('should handle metrics with ramp_up=true only', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query.mockResolvedValueOnce([{ count: '0' }]);

      await pipeline.execute({ testRunIds });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('All metrics have ramp_up=true')
      );
    });

    test('should handle invalid input and return error result', async () => {
      const result = await pipeline.execute({ testRunIds: [] });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid input: expected { testRunIds: string[] }');
      expect(result.error?.code).toBe('INVALID_INPUT');
    });

    test('should handle non-object input', async () => {
      const result = await pipeline.execute(null);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid input');
    });

    test('should handle zero inserted records with existing statistics', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 10 })          // DELETE existing (10 deleted)
        .mockResolvedValueOnce([{ expected_rows: 10 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 10 }]);          // Actual count verification

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(result.data.processedRecords).toBe(10);
    });

    test('should handle partial updates (some new, some existing)', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 7 })           // DELETE existing (7 deleted)
        .mockResolvedValueOnce([{ expected_rows: 10 }])   // Expected rows (3 new + 7 re-inserted)
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 10 }]);          // Actual count verification

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(result.data.processedRecords).toBe(10);
    });

    test('should handle all new records', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing (nothing to delete)
        .mockResolvedValueOnce([{ expected_rows: 10 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 10 }]);          // Actual count verification

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(result.data.processedRecords).toBe(10);
    });
  });

  describe('SQL Aggregation Query', () => {
    test('should execute complex statistics aggregation query', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      // Verify key SQL components
      expect(sqlQuery).toContain('WITH run_orgs AS MATERIALIZED');
      expect(sqlQuery).toContain('metrics_filtered AS');
      expect(sqlQuery).toContain('statistics_aggregated AS');
      expect(sqlQuery).toContain('final_statistics AS');
      expect(sqlQuery).toContain('INSERT INTO ds_metric_statistics');
      // Note: Implementation now uses DELETE + INSERT instead of ON CONFLICT
    });

    test('should calculate standard statistics (mean, median, min, max)', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('AVG(value) as mean');
      expect(sqlQuery).toContain('approx_percentile(0.50, sa.pct_agg) as median');
      expect(sqlQuery).toContain('MIN(value) as min_value');
      expect(sqlQuery).toContain('MAX(value) as max_value');
      expect(sqlQuery).toContain('STDDEV_POP(value) as std_dev');
    });

    test('should calculate percentiles (q10, q25, q75, q90, q95, q99)', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('approx_percentile(0.10, sa.pct_agg) as q10');
      expect(sqlQuery).toContain('approx_percentile(0.25, sa.pct_agg) as q25');
      expect(sqlQuery).toContain('approx_percentile(0.75, sa.pct_agg) as q75');
      expect(sqlQuery).toContain('approx_percentile(0.90, sa.pct_agg) as q90');
      expect(sqlQuery).toContain('approx_percentile(0.95, sa.pct_agg) as q95');
      expect(sqlQuery).toContain('approx_percentile(0.99, sa.pct_agg) as q99');
    });

    test('should calculate derived metrics (IQR, IDR)', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('approx_percentile(0.75, sa.pct_agg) - approx_percentile(0.25, sa.pct_agg)) as iqr');
      expect(sqlQuery).toContain('approx_percentile(0.90, sa.pct_agg) - approx_percentile(0.10, sa.pct_agg)) as idr');
    });

    test('should calculate missing value statistics', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('COUNT(CASE WHEN value IS NULL THEN 1 END) as n_missing');
      expect(sqlQuery).toContain('(sa.count = sa.n_missing) as all_missing');
      expect(sqlQuery).toContain('(sa.n_missing::float / sa.count::float) * 100.0');
    });

    test('should filter metrics with ramp_up=false', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const metricsCountCall = mockEntityManager.query.mock.calls[0];
      expect(metricsCountCall[0]).toContain('WHERE test_run_id IN');
      expect(metricsCountCall[0]).toContain('AND ramp_up = false');
      expect(metricsCountCall[0]).toContain('AND value IS NOT NULL');
    });

    test('should filter by valid application_dashboard_id', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      // The dashboard set is resolved once in a MATERIALIZED CTE. MATERIALIZED is
      // load-bearing: without it the planner may inline the CTE back into the
      // ds_metrics scan, which is the correlated-subplan shape that timed out in
      // production (statistics-calculation, 163s, 2026-08-27).
      expect(sqlQuery).toContain('allowed_dashboards AS MATERIALIZED');
      expect(sqlQuery).toContain('application_dashboard_id IN (SELECT id FROM allowed_dashboards)');
      // ...and the filter must not correlate on the outer row again.
      expect(sqlQuery).not.toContain('ad.organization_id = tr.organization_id');
      expect(sqlQuery).not.toContain('dq.organization_id = tr.organization_id');
    });

    test('should use DELETE then INSERT pattern (not UPSERT)', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      // Verify DELETE is called (call index 1)
      const deleteCall = mockEntityManager.query.mock.calls[1];
      expect(deleteCall[0]).toContain('DELETE FROM ds_metric_statistics');

      // Verify INSERT is called (call index 3)
      const insertCall = mockEntityManager.query.mock.calls[3];
      expect(insertCall[0]).toContain('INSERT INTO ds_metric_statistics');
      // Implementation now uses DELETE+INSERT instead of ON CONFLICT
    });

    test('should handle percentiles JSONB object', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('jsonb_build_object');
      expect(sqlQuery).toContain("'p10'");
      expect(sqlQuery).toContain("'p25'");
      expect(sqlQuery).toContain("'p50'");
      expect(sqlQuery).toContain("'p75'");
      expect(sqlQuery).toContain("'p90'");
      expect(sqlQuery).toContain("'p95'");
      expect(sqlQuery).toContain("'p99'");
    });

    test('should calculate last_value from most recent timestamp', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('lv.value as last_value');
    });

    test('should join with test_runs to get start_time', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      // start_time comes from the run_orgs CTE, so test_runs is read once.
      expect(sqlQuery).toContain('LEFT JOIN run_orgs tr ON tr.test_run_id = sa.test_run_id');
      expect(sqlQuery).toContain('tr.start_time as test_run_start');
    });
  });

  describe('Database Operations', () => {
    test('should use transaction for aggregation', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      expect(mockDb.transaction).toHaveBeenCalled();
    });

    test('should rollback transaction on error', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])
        .mockResolvedValueOnce([{ expected_rows: 5 }])
        .mockRejectedValueOnce(new Error('Aggregation failed'));

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Aggregation failed');
    });

    test('should handle database connection error', async () => {
      const testRunIds = ['test-run-001'];

      mockDb.transaction.mockRejectedValue(new Error('Connection timeout'));

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Connection timeout');
    });

    test('should clean up stale data before processing', async () => {
      const testRunIds = ['test-run-001'];

      mockDb.query.mockResolvedValue([undefined, 3]); // 3 rows deleted
      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ds_metric_statistics')
      );
    });
  });

  describe('Error Handling', () => {
    test('should provide detailed error information', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query.mockRejectedValue(new Error('SQL syntax error'));

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(false);
      expect(result.error).toEqual({
        message: 'SQL syntax error',
        code: 'STATISTICS_AGGREGATION_FAILED',
        details: { testRunIds }
      });
    });

    test('should log errors with context', async () => {
      const testRunIds = ['test-run-001', 'test-run-002'];

      mockEntityManager.query.mockRejectedValue(new Error('Test error'));

      await pipeline.execute({ testRunIds });

      expect(mockLogger.error).toBeDefined();
    });

    test('should handle unexpected errors gracefully', async () => {
      const testRunIds = ['test-run-001'];

      mockDb.transaction.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Unexpected error');
    });

    test('should handle non-Error exceptions', async () => {
      const testRunIds = ['test-run-001'];

      mockDb.transaction.mockRejectedValue('String error');

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle null rowCount from query result', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])
        .mockResolvedValueOnce([{ expected_rows: 5 }])
        .mockResolvedValueOnce({}); // No rowCount property

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(result.data?.processedRecords).toBe(0);
    });

    test('should handle invalid count response', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query.mockResolvedValueOnce([]); // Empty result

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    test('should handle invalid expected_rows response', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])
        .mockResolvedValueOnce([]) // Empty expected_rows
        .mockResolvedValueOnce({ rowCount: 5 });

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
    });
  });

  describe('Performance and Logging', () => {
    test('should log performance metrics', async () => {
      const testRunIds = ['test-run-001', 'test-run-002'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '200' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 20 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 20 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting statistics aggregation')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('test-run-001, test-run-002')
      );
    });

    test('should include duration in result', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      const result = await pipeline.execute({ testRunIds });

      // Duration is set by BasePipelineTypeORM, which is mocked in these tests
      expect(result.success).toBe(true);
    });

    test('should log metrics found count', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '42' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found 42 metrics to aggregate')
      );
    });

    test('should log expected rows count', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 15 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 15 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Aggregation will process 15 unique metrics')
      );
    });

    test('should log insert/update summary', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 10 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 10 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Statistics aggregation completed')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully processed all 10 statistics')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully processed all 10 statistics')
      );
    });

    test('should log source data points count', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '1500' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 10 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 10 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Source: 1500 total data points')
      );
    });
  });

  describe('Multiple Test Runs', () => {
    test('should handle multiple test runs correctly', async () => {
      const testRunIds = ['test-run-001', 'test-run-002', 'test-run-003', 'test-run-004'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '400' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 40 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 40 }]);          // Actual count verification

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(result.data?.testRunIds).toBe(4);

      // Verify query was called with all test run IDs
      const aggregationCall = mockEntityManager.query.mock.calls[3];
      expect(aggregationCall[1]).toEqual(testRunIds);
    });

    test('should generate correct placeholders for multiple test runs', async () => {
      const testRunIds = ['test-1', 'test-2', 'test-3'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '300' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 30 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 30 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const metricsCountCall = mockEntityManager.query.mock.calls[0];
      const sqlQuery = metricsCountCall[0];

      // Should have $1, $2, $3 placeholders
      expect(sqlQuery).toContain('$1, $2, $3');
    });

    test('should handle large number of test runs', async () => {
      const testRunIds = Array.from({ length: 50 }, (_, i) => `test-run-${i.toString().padStart(3, '0')}`);

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '5000' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 500 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 500 }]);          // Actual count verification

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(result.data?.testRunIds).toBe(50);
    });
  });

  describe('Benchmark Handling', () => {
    test('should extract first benchmark_id from array', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('THEN sa.first_benchmark_id::uuid');
      expect(sqlQuery).toContain('ELSE NULL');
    });

    test('should handle null benchmark_ids', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('WHEN sa.first_benchmark_id IS NOT NULL');
    });
  });

  describe('Default Value Handling', () => {
    test('should use COALESCE for missing labels', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain("COALESCE(sa.dashboard_label, 'missing')");
      expect(sqlQuery).toContain("COALESCE(sa.panel_title, 'missing')");
    });

    test('should handle zero count for percentage calculations', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ count: '100' }])        // Metrics count check
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce([{ expected_rows: 5 }])   // Expected rows
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = mockEntityManager.query.mock.calls[3];
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('WHEN sa.count > 0 THEN');
      expect(sqlQuery).toContain('ELSE 0.0');
    });
  });
});
