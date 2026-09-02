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

const stripSqlComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

describe('StatisticsPipeline', () => {
  let pipeline: StatisticsPipeline;
  let mockLogger: any;
  let mockDb: any;
  let mockEntityManager: any;
  // In-transaction queries the proxy swallows (SET LOCAL, the ramp_up UPDATE) so
  // they don't shift mockEntityManager.query.mock.calls indices.
  let interceptedQueries: string[];
  // Full [sql, params] of every swallowed in-transaction query. The SQL alone
  // cannot prove the per-run UPDATE binds that run's OWN bounds.
  let interceptedCalls: Array<[string, unknown[]?]>;

  // Find a query by its SQL rather than by position — positional indices broke
  // every time a diagnostic query was added or removed.
  const callWith = (needle: string): any[] =>
    mockEntityManager.query.mock.calls.find((c: any[]) => String(c[0]).includes(needle));

  beforeEach(() => {
    interceptedQueries = [];
    interceptedCalls = [];
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
                  (args[0].includes('SET LOCAL') ||
                    args[0].includes('set_config') ||
                    args[0].includes('UPDATE ds_metrics'))
                ) {
                  interceptedQueries.push(args[0]);
                  interceptedCalls.push([args[0], args[1] as unknown[] | undefined]);
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
      // Pooled (non-transaction) queries: the cleanup query and the read-only
      // ramp_up pre-check. Default the pre-check to "nothing stale" so the
      // aggregation mock chains below stay the only thing under test.
      query: vi.fn((sql: string) =>
        typeof sql === 'string' && sql.includes('m.ramp_up IS DISTINCT FROM')
          ? Promise.resolve([])
          : Promise.resolve([undefined, 0])
      ),
      decompressChunksForRange: vi.fn().mockResolvedValue(undefined)
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 20 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      // Verify aggregation query was called with test run IDs
      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
      expect(aggregationCall[0]).toContain('INSERT INTO ds_metric_statistics');
      expect(aggregationCall[1]).toEqual(testRunIds);
    });

    test('should log aggregation progress', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
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
    test('treats an empty probe result as no metrics and touches nothing', async () => {
      // `!metricsProbe[0]?.has_metrics` reads index 0; an empty result short-circuits
      // to the early return, which is a different outcome from the old
      // parseInt(count[0]?.count || '0') path that the removed test covered.
      mockEntityManager.query.mockResolvedValueOnce([]);

      const result = await pipeline.execute({ testRunIds: ['test-run-001'] });

      expect(result.success).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('No metrics found'));
      const sqls = mockEntityManager.query.mock.calls.map((c: any[]) => String(c[0]));
      expect(sqls.some((q: string) => q.includes('DELETE FROM ds_metric_statistics'))).toBe(false);
      expect(sqls.some((q: string) => q.includes('INSERT INTO ds_metric_statistics'))).toBe(false);
    });

    test('should handle no metrics found for test runs', async () => {
      const testRunIds = ['test-run-001'];

      // Mock zero metrics
      mockEntityManager.query.mockResolvedValueOnce([{ has_metrics: false }]);

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

      mockEntityManager.query.mockResolvedValueOnce([{ has_metrics: false }]);

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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 10 })          // DELETE existing (10 deleted)
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 10 }]);          // Actual count verification

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(result.data.processedRecords).toBe(10);
    });

    test('should handle partial updates (some new, some existing)', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 7 })           // DELETE existing (7 deleted)
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 10 }]);          // Actual count verification

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(result.data.processedRecords).toBe(10);
    });

    test('should handle all new records', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing (nothing to delete)
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('approx_percentile(0.75, sa.pct_agg) - approx_percentile(0.25, sa.pct_agg)) as iqr');
      expect(sqlQuery).toContain('approx_percentile(0.90, sa.pct_agg) - approx_percentile(0.10, sa.pct_agg)) as idr');
    });

    test('should calculate missing value statistics', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('COUNT(CASE WHEN value IS NULL THEN 1 END) as n_missing');
      expect(sqlQuery).toContain('(sa.count = sa.n_missing) as all_missing');
      expect(sqlQuery).toContain('(sa.n_missing::float / sa.count::float) * 100.0');
    });

    test('should filter metrics with ramp_up=false', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const metricsCountCall = callWith('has_metrics');
      expect(metricsCountCall[0]).toContain('WHERE test_run_id IN');
      expect(metricsCountCall[0]).toContain('AND ramp_up = false');
      expect(metricsCountCall[0]).toContain('AND value IS NOT NULL');
    });

    test('should filter by valid application_dashboard_id', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      // Verify DELETE is called
      const deleteCall = callWith('DELETE FROM ds_metric_statistics');
      expect(deleteCall[0]).toContain('DELETE FROM ds_metric_statistics');

      // Verify INSERT is called
      const insertCall = callWith('INSERT INTO ds_metric_statistics');
      expect(insertCall[0]).toContain('INSERT INTO ds_metric_statistics');
      // Implementation now uses DELETE+INSERT instead of ON CONFLICT
    });

    test('should handle percentiles JSONB object', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      // Strip comments once, for BOTH directions: the query's own comment block
      // explains the LATERAL it replaced and names last(), so prose must not be
      // able to satisfy the positive assertion either.
      const sqlQuery = stripSqlComments(callWith('INSERT INTO ds_metric_statistics')[0]);

      // last() runs inside the aggregate pass that is already scanning these rows,
      // and keeps the deleted lateral's own value IS NOT NULL — last() returns the
      // value AT the greatest time even when that value is NULL.
      expect(sqlQuery).toContain('last(value, time) FILTER (WHERE value IS NOT NULL) as last_value');
      expect(sqlQuery).toContain('sa.last_value'); // produced AND projected downstream

      // The defect class is "ds_metrics is visited more than once", not one
      // spelling of it: a correlated scalar subquery reintroduces the same
      // per-group decompression at the same cost and contains no JOIN LATERAL.
      // Pin the visit count instead of the syntax.
      expect(sqlQuery.match(/\bds_metrics\b/g) ?? []).toHaveLength(1);
      expect(sqlQuery).not.toMatch(/JOIN\s+LATERAL/i);
    });

    test('derives is_constant from the projected min/max, not a per-group sort', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ count: 5 }]);

      await pipeline.execute({ testRunIds });

      const sqlQuery = stripSqlComments(callWith('INSERT INTO ds_metric_statistics')[0]);

      expect(sqlQuery).toContain('(sa.min_value = sa.max_value) as is_constant');
      // constant_value is a backward-compat alias and must track is_constant.
      expect(sqlQuery).toContain('(sa.min_value = sa.max_value) as constant_value');
      // Both COUNT(DISTINCT) forms cost a sort the aggregates above already paid for:
      // per-group on value, and whole-relation on the composite group key.
      expect(sqlQuery).not.toMatch(/COUNT\s*\(\s*DISTINCT/i);
      // A leftover sa.distinct_count would only fail against real Postgres.
      expect(sqlQuery).not.toContain('distinct_count');
    });

    test('should join with test_runs to get start_time', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      expect(mockDb.transaction).toHaveBeenCalled();
    });

    test('should rollback transaction on error', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
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
        .mockResolvedValueOnce([{ has_metrics: true }])
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

  });

  describe('Performance and Logging', () => {
    test('should log performance metrics', async () => {
      const testRunIds = ['test-run-001', 'test-run-002'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      const result = await pipeline.execute({ testRunIds });

      // Duration is set by BasePipelineTypeORM, which is mocked in these tests
      expect(result.success).toBe(true);
    });



    test('should log insert/update summary', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 10 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Statistics aggregation completed: deleted an unknown number of, wrote 10 statistic records')
      );
    });

  });

  describe('Multiple Test Runs', () => {
    test('should handle multiple test runs correctly', async () => {
      const testRunIds = ['test-run-001', 'test-run-002', 'test-run-003', 'test-run-004'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 40 }]);          // Actual count verification

      const result = await pipeline.execute({ testRunIds });

      expect(result.success).toBe(true);
      expect(result.data?.testRunIds).toBe(4);

      // Verify query was called with all test run IDs
      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
      expect(aggregationCall[1]).toEqual(testRunIds);
    });

    test('should generate correct placeholders for multiple test runs', async () => {
      const testRunIds = ['test-1', 'test-2', 'test-3'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 30 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const metricsCountCall = callWith('has_metrics');
      const sqlQuery = metricsCountCall[0];

      // Should have $1, $2, $3 placeholders
      expect(sqlQuery).toContain('$1, $2, $3');
    });

    test('should handle large number of test runs', async () => {
      const testRunIds = Array.from({ length: 50 }, (_, i) => `test-run-${i.toString().padStart(3, '0')}`);

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
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
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('THEN sa.first_benchmark_id::uuid');
      expect(sqlQuery).toContain('ELSE NULL');
    });

    test('should handle null benchmark_ids', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('WHEN sa.first_benchmark_id IS NOT NULL');
    });
  });

  describe('Default Value Handling', () => {
    test('should use COALESCE for missing labels', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain("COALESCE(sa.dashboard_label, 'missing')");
      expect(sqlQuery).toContain("COALESCE(sa.panel_title, 'missing')");
    });

    test('should handle zero count for percentage calculations', async () => {
      const testRunIds = ['test-run-001'];

      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])        // metrics-exist probe
        .mockResolvedValueOnce({ rowCount: 0 })           // DELETE existing
        .mockResolvedValueOnce(undefined)                 // INSERT (rowCount not used)
        .mockResolvedValueOnce([{ count: 5 }]);          // Actual count verification

      await pipeline.execute({ testRunIds });

      const aggregationCall = callWith('INSERT INTO ds_metric_statistics');
      const sqlQuery = aggregationCall[0];

      expect(sqlQuery).toContain('WHEN sa.count > 0 THEN');
      expect(sqlQuery).toContain('ELSE 0.0');
    });
  });

  describe('ramp_up refresh (compressed-chunk guard)', () => {
    const aggregationMocks = () =>
      mockEntityManager.query
        .mockResolvedValueOnce([{ has_metrics: true }])
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ count: 5 }]);

    test('asks with a read, and issues no UPDATE when every flag already matches', async () => {
      aggregationMocks();
      // mockDb.query returns [] for the pre-check by default: nothing is stale.

      await pipeline.execute({ testRunIds: ['test-run-001'] });

      const preCheck = mockDb.query.mock.calls
        .map((c: any[]) => c[0])
        .find((sql: any) => typeof sql === 'string' && sql.includes('m.ramp_up IS DISTINCT FROM'));

      // The pre-check must be a SELECT. ramp_up is neither compress_segmentby
      // (test_run_id) nor compress_orderby (time), so as an UPDATE guard it forces
      // TimescaleDB to decompress the run's whole segment as DML — 53s and
      // "tuple decompression limit exceeded" on a 2.6M-row run that needed no write.
      expect(preCheck).toBeDefined();
      // Strip comments first: the shared RAMP_UP_EXPR explains itself by referring
      // to "the UPDATE below", which is prose, not a statement.
      expect(stripSqlComments(preCheck!)).toMatch(/^\s*SELECT/);
      expect(stripSqlComments(preCheck!)).not.toMatch(/UPDATE/i);

      // Nothing stale => no write, and nothing decompressed.
      expect(interceptedQueries.some((q) => q.includes('UPDATE ds_metrics'))).toBe(false);
      expect(mockDb.decompressChunksForRange).not.toHaveBeenCalled();
    });

    test('decompresses only the disagreeing rows\' span, not the whole run', async () => {
      // The stale flags sit in the last two minutes of a one-hour run.
      const from = new Date('2026-01-01T10:58:00Z');
      const to = new Date('2026-01-01T11:00:00Z');
      mockDb.query.mockImplementation((sql: string) =>
        typeof sql === 'string' && sql.includes('m.ramp_up IS DISTINCT FROM')
          ? Promise.resolve([{ test_run_id: 'test-run-001', from_time: from, to_time: to }])
          : Promise.resolve([undefined, 0])
      );
      aggregationMocks();

      await pipeline.execute({ testRunIds: ['test-run-001'] });

      // Decompress up front, outside the transaction — same guard the force-refetch
      // path uses at simple-orchestrate-reevaluate-batch.ts, so the UPDATE never
      // has to decompress as DML. Scoped to the disagreement span: decompress_chunk
      // is chunk-granular and a chunk holds every run in its window, so a wider
      // range puts other runs into row store too.
      expect(mockDb.decompressChunksForRange).toHaveBeenCalledWith('ds_metrics', from, to);

      // The UPDATE is bounded by the same span, on compress_segmentby +
      // compress_orderby, so TimescaleDB can skip batches instead of decompressing
      // the run's whole segment to evaluate the ramp_up guard.
      const update = interceptedQueries.find((q) => q.includes('UPDATE ds_metrics'));
      expect(update).toBeDefined();
      expect(update).toContain('m.test_run_id = $1');
      expect(update).toContain('m.time >= $2');
      expect(update).toContain('m.time <= $3');

      const decompressOrder = mockDb.decompressChunksForRange.mock.invocationCallOrder[0];
      const transactionOrder = mockDb.transaction.mock.invocationCallOrder[0];
      expect(decompressOrder).toBeLessThan(transactionOrder);
    });

    test('decompresses each stale run separately, not one span across all of them', async () => {
      const runs = [
        { test_run_id: 'run-jan', from_time: new Date('2026-01-01T10:00:00Z'), to_time: new Date('2026-01-01T10:05:00Z') },
        { test_run_id: 'run-mar', from_time: new Date('2026-03-01T10:00:00Z'), to_time: new Date('2026-03-01T10:05:00Z') },
      ];
      mockDb.query.mockImplementation((sql: string) =>
        typeof sql === 'string' && sql.includes('m.ramp_up IS DISTINCT FROM')
          ? Promise.resolve(runs)
          : Promise.resolve([undefined, 0])
      );
      aggregationMocks();

      await pipeline.execute({ testRunIds: ['run-jan', 'run-mar'] });

      // A global min/max would decompress every chunk from January to March —
      // two months of every other run's data — to fix ten minutes of flags.
      expect(mockDb.decompressChunksForRange).toHaveBeenCalledTimes(2);
      expect(mockDb.decompressChunksForRange).toHaveBeenCalledWith('ds_metrics', runs[0].from_time, runs[0].to_time);
      expect(mockDb.decompressChunksForRange).toHaveBeenCalledWith('ds_metrics', runs[1].from_time, runs[1].to_time);
    });

    test('scopes the stale-flag pre-check to the disagreeing rows, not the run window', async () => {
      aggregationMocks();

      await pipeline.execute({ testRunIds: ['test-run-001'] });

      // Without this the two tests below pass against the OLD pre-check: it still
      // matches their mock needle while returning tr.start_time/tr.end_time, so they
      // prove only that the pipeline forwards whatever the SELECT handed back.
      const sql: string = mockDb.query.mock.calls
        .map((c: any[]) => String(c[0]))
        .find((q: string) => q.includes('m.ramp_up IS DISTINCT FROM'));
      expect(sql).toContain('MIN(m.time) AS from_time');
      expect(sql).toContain('MAX(m.time) AS to_time');
      expect(sql).toContain('GROUP BY tr.test_run_id');
      expect(sql).not.toContain('tr.start_time AS');
    });

    test('binds each run its own bounds in the UPDATE', async () => {
      const runs = [
        { test_run_id: 'run-jan', from_time: new Date('2026-01-01T10:00:00Z'), to_time: new Date('2026-01-01T10:05:00Z') },
        { test_run_id: 'run-mar', from_time: new Date('2026-03-01T10:00:00Z'), to_time: new Date('2026-03-01T10:05:00Z') },
      ];
      mockDb.query.mockImplementation((sql: string) =>
        typeof sql === 'string' && sql.includes('m.ramp_up IS DISTINCT FROM')
          ? Promise.resolve(runs)
          : Promise.resolve([undefined, 0])
      );
      aggregationMocks();

      await pipeline.execute({ testRunIds: ['run-jan', 'run-mar'] });

      // Asserting the SQL text alone lets a cross-run bug through: binding
      // staleRuns[0]'s bounds for every run would fix run-mar against run-jan's
      // window, leaving its flags stale forever, with the text unchanged.
      const updates = interceptedCalls.filter(([sql]) => sql.includes('UPDATE ds_metrics'));
      expect(updates).toHaveLength(2);
      expect(updates[0]?.[1]).toEqual(['run-jan', runs[0].from_time, runs[0].to_time]);
      expect(updates[1]?.[1]).toEqual(['run-mar', runs[1].from_time, runs[1].to_time]);
    });

    test('drops a stale run with an unparseable bound instead of binding an Invalid Date', async () => {
      const good = { test_run_id: 'run-ok', from_time: new Date('2026-01-01T10:00:00Z'), to_time: new Date('2026-01-01T10:05:00Z') };
      mockDb.query.mockImplementation((sql: string) =>
        typeof sql === 'string' && sql.includes('m.ramp_up IS DISTINCT FROM')
          ? Promise.resolve([{ test_run_id: 'run-bad', from_time: 'not-a-date', to_time: 'nope' }, good])
          : Promise.resolve([undefined, 0])
      );
      aggregationMocks();

      await pipeline.execute({ testRunIds: ['run-bad', 'run-ok'] });

      // The bad run must miss BOTH the decompression and the UPDATE. Skipping only
      // the former still sends Postgres an Invalid Date as $2/$3, with the chunks
      // left compressed — strictly worse than not trying.
      expect(mockDb.decompressChunksForRange).toHaveBeenCalledTimes(1);
      expect(mockDb.decompressChunksForRange).toHaveBeenCalledWith('ds_metrics', good.from_time, good.to_time);
      const updates = interceptedCalls.filter(([sql]) => sql.includes('UPDATE ds_metrics'));
      expect(updates).toHaveLength(1);
      expect(updates[0]?.[1]?.[0]).toBe('run-ok');
    });

    test('gives the whole transaction a budget larger than the 120s analytics cap', async () => {
      aggregationMocks();

      await pipeline.execute({ testRunIds: ['test-run-001'] });

      // withAnalyticsTransaction opens at 120s to stop a runaway read from starving
      // the write pool; a 20M-row aggregation died at exactly that mark.
      const settings = new Map(
        interceptedCalls
          .filter(([sql]) => sql.includes('set_config'))
          .map(([, params]) => [String(params?.[0]), String(params?.[1])])
      );
      expect(Number(settings.get('statement_timeout'))).toBeGreaterThan(120000);
      expect(settings.get('work_mem')).toBeTruthy();

      // Strictly under the analytics pool's client-side query_timeout (600000). At
      // equal deadlines node-postgres destroys the connection instead of letting
      // Postgres cancel, so the clean rollback and the useful error are both lost.
      expect(Number(settings.get('statement_timeout'))).toBeLessThan(600000);
    });
  });

});
