/**
 * Statistics Pipeline Integration Tests
 *
 * Tests end-to-end statistics aggregation with real database connections,
 * complex SQL queries, UPSERT patterns, and data validation.
 *
 * Coverage:
 * - Complete statistics aggregation flow (metrics → aggregation → database)
 * - Complex SQL percentile calculations
 * - UPSERT pattern for existing statistics
 * - Error handling and recovery
 * - Missing/null value handling
 * - Ramp-up data filtering
 * - Benchmark ID extraction
 */

import { describe, test, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { StatisticsPipeline } from '../../pipelines/StatisticsPipeline.js';
import { Pool } from 'pg';
import { createTestScenario, clearTestData } from '../helpers/database.js';

// Mock database accessor to provide test database
vi.mock('../../common/database-accessor.js', () => {
  let testDb: any = null;

  return {
    getDatabaseService: vi.fn(() => {
      if (!testDb) {
        throw new Error('Test database not initialized. Call setTestDatabase first.');
      }
      return testDb;
    }),
    setTestDatabase: (db: any) => {
      testDb = db;
    }
  };
});

// Import after mocking
import { setTestDatabase } from '../../common/database-accessor.js';

describe('StatisticsPipeline Integration Tests', () => {
  let pipeline: StatisticsPipeline;
  let testDb: Pool;
  let mockLogger: any;
  let testRunId: string;

  beforeAll(async () => {
    // Setup test database connection
    testDb = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://perfana:perfana123@localhost:5432/perfana_test',
      max: 5
    });

    // Wait for database to be ready
    const maxRetries = 5;
    for (let i = 0; i < maxRetries; i++) {
      try {
        await testDb.query('SELECT 1');
        break;
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Create ds_metric_statistics table for testing
    await testDb.query(`
      CREATE TABLE IF NOT EXISTS ds_metric_statistics (
        id SERIAL PRIMARY KEY,
        test_run_id VARCHAR(255) NOT NULL,
        application_dashboard_id VARCHAR(255) NOT NULL,
        panel_id INTEGER NOT NULL,
        metric_name VARCHAR(255) NOT NULL,
        benchmark_id UUID,
        dashboard_uid VARCHAR(255),
        dashboard_label VARCHAR(255),
        panel_title VARCHAR(255),
        unit VARCHAR(50),
        count INTEGER,
        mean DOUBLE PRECISION,
        median DOUBLE PRECISION,
        min_value DOUBLE PRECISION,
        max_value DOUBLE PRECISION,
        std_dev DOUBLE PRECISION,
        last_value DOUBLE PRECISION,
        n_missing INTEGER,
        n_non_zero INTEGER,
        q10 DOUBLE PRECISION,
        q25 DOUBLE PRECISION,
        q75 DOUBLE PRECISION,
        q90 DOUBLE PRECISION,
        q95 DOUBLE PRECISION,
        q99 DOUBLE PRECISION,
        percentiles JSONB,
        iqr DOUBLE PRECISION,
        idr DOUBLE PRECISION,
        is_constant BOOLEAN,
        constant_value BOOLEAN,
        all_missing BOOLEAN,
        pct_missing DOUBLE PRECISION,
        missing_percentage DOUBLE PRECISION,
        updated_at TIMESTAMP,
        test_run_start TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (test_run_id, application_dashboard_id, panel_id, metric_name)
      );
    `);
  }, 30000);

  afterAll(async () => {
    if (testDb) {
      await testDb.end();
    }
  });

  beforeEach(async () => {
    // Clear test data
    await clearTestData(testDb);
    await testDb.query('DELETE FROM ds_metric_statistics');
    await testDb.query('DELETE FROM ds_metrics');

    // Create test scenario
    const scenario = await createTestScenario(testDb);
    testRunId = scenario.testRun.test_run_id;

    // Create mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Mock database service
    const mockDbService = createMockDatabaseService(testDb);
    setTestDatabase(mockDbService);

    // Create pipeline instance
    pipeline = new StatisticsPipeline(mockLogger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper function to create mock database service
   */
  function createMockDatabaseService(pool: Pool) {
    return {
      dataSource: {
        query: (sql: string, params?: any[]) => pool.query(sql, params),
        transaction: async (callback: any) => {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const manager = {
              query: (sql: string, params?: any[]) => client.query(sql, params)
            };
            const result = await callback(manager);
            await client.query('COMMIT');
            return result;
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
        }
      }
    };
  }

  /**
   * Helper function to insert test metrics
   */
  async function insertTestMetrics(metrics: Array<{
    test_run_id: string;
    application_dashboard_id: string;
    panel_id: number;
    metric_name: string;
    time: Date;
    value: number | null;
    ramp_up?: boolean;
    benchmark_ids?: string[];
    unit?: string;
  }>) {
    for (const metric of metrics) {
      await testDb.query(`
        INSERT INTO ds_metrics (
          test_run_id, application_dashboard_id, dashboard_uid, panel_id,
          panel_title, dashboard_label, metric_name, time, value, ramp_up,
          benchmark_ids, unit
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        metric.test_run_id,
        metric.application_dashboard_id,
        'dashboard-uid-123',
        metric.panel_id,
        'Test Panel',
        'Test Dashboard',
        metric.metric_name,
        metric.time,
        metric.value,
        metric.ramp_up || false,
        metric.benchmark_ids ? JSON.stringify(metric.benchmark_ids) : null,
        metric.unit || null
      ]);
    }
  }

  describe('Complete Statistics Aggregation Flow', () => {
    test('should aggregate statistics for single test run successfully', async () => {
      // Create metrics with varying values
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 100 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 100 + Math.random() * 50,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      // Execute pipeline
      const result = await pipeline.execute({ testRunIds: [testRunId] });

      // Verify success
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.processedRecords).toBeGreaterThan(0);

      // Verify statistics were stored
      const statsResult = await testDb.query(
        'SELECT * FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(statsResult.rows.length).toBe(1);
      const stat = statsResult.rows[0];
      expect(stat.count).toBe(100);
      expect(stat.mean).toBeGreaterThan(100);
      expect(stat.median).toBeGreaterThan(100);
      expect(stat.min_value).toBeGreaterThanOrEqual(100);
      expect(stat.max_value).toBeLessThanOrEqual(150);
    });

    test('should aggregate multiple metrics for single test run', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');

      // Create metrics for multiple panels and metric names
      const metrics = [];
      const metricNames = ['response_time', 'throughput', 'error_rate'];

      for (const metricName of metricNames) {
        for (let i = 0; i < 50; i++) {
          metrics.push({
            test_run_id: testRunId,
            application_dashboard_id: 'app-dash-001',
            panel_id: metricNames.indexOf(metricName) + 1,
            metric_name: metricName,
            time: new Date(baseTime.getTime() + i * 1000),
            value: Math.random() * 100,
            ramp_up: false
          });
        }
      }

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      // Verify all metrics have statistics
      const statsResult = await testDb.query(
        'SELECT * FROM ds_metric_statistics WHERE test_run_id = $1 ORDER BY metric_name',
        [testRunId]
      );

      expect(statsResult.rows.length).toBe(3);
      expect(statsResult.rows.map(r => r.metric_name)).toEqual(['error_rate', 'response_time', 'throughput']);
    });

    test('should aggregate statistics for multiple test runs', async () => {
      // Create second test run
      const testRun2Result = await testDb.query(`
        INSERT INTO test_runs (test_run_id, system_under_test_id, workload, test_environment, start_time, end_time)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING test_run_id
      `, ['test-run-002', 'app-001', 'load-test', 'production', new Date(), new Date()]);

      const testRunId2 = testRun2Result.rows[0].test_run_id;

      const baseTime = new Date('2024-01-01T10:00:00Z');

      // Insert metrics for both test runs
      for (const trid of [testRunId, testRunId2]) {
        const metrics = Array.from({ length: 50 }, (_, i) => ({
          test_run_id: trid,
          application_dashboard_id: 'app-dash-001',
          panel_id: 1,
          metric_name: 'response_time',
          time: new Date(baseTime.getTime() + i * 1000),
          value: 100 + Math.random() * 50,
          ramp_up: false
        }));

        await insertTestMetrics(metrics);
      }

      // Execute pipeline for both test runs
      const result = await pipeline.execute({ testRunIds: [testRunId, testRunId2] });

      expect(result.success).toBe(true);

      // Verify statistics for both test runs
      const statsResult = await testDb.query(
        'SELECT test_run_id, COUNT(*) as count FROM ds_metric_statistics GROUP BY test_run_id ORDER BY test_run_id'
      );

      expect(statsResult.rows.length).toBe(2);
      expect(statsResult.rows[0].count).toBe('1');
      expect(statsResult.rows[1].count).toBe('1');
    });
  });

  describe('Percentile Calculations', () => {
    test('should calculate correct percentiles (p10, p25, p50, p75, p90, p95, p99)', async () => {
      // Create sorted values: 1, 2, 3, ..., 100
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 100 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: i + 1,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT * FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      const stat = statsResult.rows[0];

      // Verify percentiles are approximately correct
      expect(stat.q10).toBeGreaterThanOrEqual(9);
      expect(stat.q10).toBeLessThanOrEqual(11);

      expect(stat.q25).toBeGreaterThanOrEqual(24);
      expect(stat.q25).toBeLessThanOrEqual(26);

      expect(stat.median).toBeGreaterThanOrEqual(49);
      expect(stat.median).toBeLessThanOrEqual(51);

      expect(stat.q75).toBeGreaterThanOrEqual(74);
      expect(stat.q75).toBeLessThanOrEqual(76);

      expect(stat.q90).toBeGreaterThanOrEqual(89);
      expect(stat.q90).toBeLessThanOrEqual(91);

      expect(stat.q95).toBeGreaterThanOrEqual(94);
      expect(stat.q95).toBeLessThanOrEqual(96);

      expect(stat.q99).toBeGreaterThanOrEqual(98);
      expect(stat.q99).toBeLessThanOrEqual(100);
    });

    test('should calculate IQR (Interquartile Range) correctly', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 100 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: i + 1,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT * FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      const stat = statsResult.rows[0];

      // IQR = Q75 - Q25 ≈ 75 - 25 = 50
      expect(stat.iqr).toBeGreaterThanOrEqual(48);
      expect(stat.iqr).toBeLessThanOrEqual(52);
    });

    test('should calculate IDR (Interdecile Range) correctly', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 100 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: i + 1,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT * FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      const stat = statsResult.rows[0];

      // IDR = Q90 - Q10 ≈ 90 - 10 = 80
      expect(stat.idr).toBeGreaterThanOrEqual(78);
      expect(stat.idr).toBeLessThanOrEqual(82);
    });

    test('should store percentiles as JSONB object', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 100 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: i + 1,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT percentiles FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      const percentiles = statsResult.rows[0].percentiles;

      expect(percentiles).toHaveProperty('p10');
      expect(percentiles).toHaveProperty('p25');
      expect(percentiles).toHaveProperty('p50');
      expect(percentiles).toHaveProperty('p75');
      expect(percentiles).toHaveProperty('p90');
      expect(percentiles).toHaveProperty('p95');
      expect(percentiles).toHaveProperty('p99');
    });
  });

  describe('Basic Statistics Calculations', () => {
    test('should calculate mean correctly', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const values = [10, 20, 30, 40, 50]; // Mean = 30
      const metrics = values.map((value, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT mean FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(statsResult.rows[0].mean).toBe(30);
    });

    test('should calculate median correctly', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const values = [10, 20, 30, 40, 50]; // Median = 30
      const metrics = values.map((value, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT median FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(statsResult.rows[0].median).toBe(30);
    });

    test('should calculate min and max correctly', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const values = [10, 50, 20, 40, 30];
      const metrics = values.map((value, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT min_value, max_value FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(statsResult.rows[0].min_value).toBe(10);
      expect(statsResult.rows[0].max_value).toBe(50);
    });

    test('should calculate standard deviation correctly', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const values = [10, 10, 10, 10, 10]; // StdDev = 0 for constant values
      const metrics = values.map((value, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT std_dev FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(statsResult.rows[0].std_dev).toBe(0);
    });

    test('should calculate last_value as most recent value', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const values = [10, 20, 30, 40, 999]; // Last value = 999
      const metrics = values.map((value, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT last_value FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(statsResult.rows[0].last_value).toBe(999);
    });
  });

  describe('Ramp-up Data Filtering', () => {
    test('should exclude ramp-up metrics from aggregation', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');

      // Create metrics with ramp_up = true
      const rampUpMetrics = Array.from({ length: 50 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 1000 + i,
        ramp_up: true
      }));

      // Create metrics with ramp_up = false
      const steadyStateMetrics = Array.from({ length: 50 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + (50 + i) * 1000),
        value: 100 + i,
        ramp_up: false
      }));

      await insertTestMetrics([...rampUpMetrics, ...steadyStateMetrics]);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT count, min_value, max_value FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      const stat = statsResult.rows[0];

      // Only steady-state metrics should be included
      expect(stat.count).toBe(50);
      expect(stat.min_value).toBeGreaterThanOrEqual(100);
      expect(stat.min_value).toBeLessThan(200);
      expect(stat.max_value).toBeLessThan(200); // Should not include ramp-up values
    });

    test('recomputes stale ramp_up flags from current analysis offsets before aggregating', async () => {
      // Regression for "ADAPT ignores the analysis time range": the ds_metrics.ramp_up
      // flag is baked at ingestion. Editing the offsets on a completed run skips
      // metric-collection on re-analysis, so without an in-pipeline refresh the flag
      // is stale and ADAPT reads the OLD window. Here every point is ingested with
      // ramp_up=false, then the run's offsets are set to trim 20s off each end.
      const testStart = new Date('2024-01-01T10:00:00Z');
      const testEnd = new Date(testStart.getTime() + 100 * 1000); // 100s run

      await testDb.query(
        `UPDATE test_runs SET start_time = $1, end_time = $2, ramp_up = $3, ramp_down = $4 WHERE test_run_id = $5`,
        [testStart, testEnd, 20, 20, testRunId], // window = [+20s, +80s]
      );

      // 100 points at +0s..+99s, value = elapsed second, ALL flagged ramp_up=false
      // (simulating flags baked before the offsets were set).
      const metrics = Array.from({ length: 100 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(testStart.getTime() + i * 1000),
        value: i,
        ramp_up: false,
      }));
      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });
      expect(result.success).toBe(true);

      // Only points inside [+20s, +80s] survive: elapsed >= 20 and elapsed <= 80.
      // Start window excludes elapsed < 20 (i=0..19); end window excludes
      // elapsed > 80 (i=81..99). Included: i=20..80 → 61 points, values 20..80.
      const statsResult = await testDb.query(
        'SELECT count, min_value, max_value FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId],
      );
      const stat = statsResult.rows[0];
      expect(stat.count).toBe(61);
      expect(stat.min_value).toBe(20);
      expect(stat.max_value).toBe(80);

      // And the underlying flags were actually rewritten (39 points now excluded).
      const flagged = await testDb.query(
        'SELECT COUNT(*)::int AS n FROM ds_metrics WHERE test_run_id = $1 AND ramp_up = true',
        [testRunId],
      );
      expect(flagged.rows[0].n).toBe(39);
    });

    test('should return zero records when all metrics are ramp-up', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 100 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 100 + i,
        ramp_up: true // All ramp-up
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(result.data.processedRecords).toBe(0);

      const statsResult = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(parseInt(statsResult.rows[0].count)).toBe(0);
    });
  });

  describe('Missing and Null Value Handling', () => {
    test('should count missing values correctly', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = [
        ...Array.from({ length: 70 }, (_, i) => ({
          test_run_id: testRunId,
          application_dashboard_id: 'app-dash-001',
          panel_id: 1,
          metric_name: 'response_time',
          time: new Date(baseTime.getTime() + i * 1000),
          value: 100 + i,
          ramp_up: false
        })),
        // Note: null values are filtered out by "value IS NOT NULL" in SQL
        // So n_missing is calculated within the group
      ];

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT n_missing, pct_missing FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      const stat = statsResult.rows[0];

      // With null filtering, n_missing should be 0
      expect(stat.n_missing).toBe(0);
      expect(stat.pct_missing).toBe(0);
    });

    test('should count non-zero values correctly', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = [
        ...Array.from({ length: 30 }, (_, i) => ({
          test_run_id: testRunId,
          application_dashboard_id: 'app-dash-001',
          panel_id: 1,
          metric_name: 'response_time',
          time: new Date(baseTime.getTime() + i * 1000),
          value: 0, // Zero values
          ramp_up: false
        })),
        ...Array.from({ length: 70 }, (_, i) => ({
          test_run_id: testRunId,
          application_dashboard_id: 'app-dash-001',
          panel_id: 1,
          metric_name: 'response_time',
          time: new Date(baseTime.getTime() + (30 + i) * 1000),
          value: 100 + i, // Non-zero values
          ramp_up: false
        }))
      ];

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT count, n_non_zero FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      const stat = statsResult.rows[0];

      expect(stat.count).toBe(100);
      expect(stat.n_non_zero).toBe(70);
    });

    test('should handle all NULL values gracefully', async () => {
      // All metrics with NULL values are filtered out by SQL
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 50 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: null,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(result.data.processedRecords).toBe(0);

      const statsResult = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(parseInt(statsResult.rows[0].count)).toBe(0);
    });
  });

  describe('Constant Value Detection', () => {
    test('should detect constant values correctly', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 100 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 42, // All same value
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT is_constant, constant_value, std_dev FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      const stat = statsResult.rows[0];

      expect(stat.is_constant).toBe(true);
      expect(stat.constant_value).toBe(true);
      expect(stat.std_dev).toBe(0);
    });

    test('should detect non-constant values correctly', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 100 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 100 + i, // Varying values
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT is_constant, std_dev FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      const stat = statsResult.rows[0];

      expect(stat.is_constant).toBe(false);
      expect(stat.std_dev).toBeGreaterThan(0);
    });
  });

  describe('UPSERT Pattern', () => {
    test('should insert new statistics on first execution', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 50 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 100 + i,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(result.data.processedRecords).toBeGreaterThan(0);

      const statsResult = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(parseInt(statsResult.rows[0].count)).toBe(1);
    });

    test('should update existing statistics on re-execution', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 50 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 100 + i,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      // First execution
      await pipeline.execute({ testRunIds: [testRunId] });

      const firstResult = await testDb.query(
        'SELECT mean FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );
      const firstMean = firstResult.rows[0].mean;

      // Add more metrics
      const newMetrics = Array.from({ length: 50 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + (50 + i) * 1000),
        value: 200 + i,
        ramp_up: false
      }));

      await insertTestMetrics(newMetrics);

      // Second execution (should update)
      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const secondResult = await testDb.query(
        'SELECT COUNT(*) as count, mean FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      // Should still have only 1 record (updated, not duplicate)
      expect(parseInt(secondResult.rows[0].count)).toBe(1);

      // Mean should be different (higher due to new values)
      const secondMean = secondResult.rows[0].mean;
      expect(secondMean).toBeGreaterThan(firstMean);
    });

    test('should not create duplicate statistics', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 50 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 100 + i,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      // Execute multiple times
      await pipeline.execute({ testRunIds: [testRunId] });
      await pipeline.execute({ testRunIds: [testRunId] });
      await pipeline.execute({ testRunIds: [testRunId] });

      // Should still have only 1 record
      const statsResult = await testDb.query(
        `SELECT test_run_id, application_dashboard_id, panel_id, metric_name, COUNT(*) as count
         FROM ds_metric_statistics
         WHERE test_run_id = $1
         GROUP BY test_run_id, application_dashboard_id, panel_id, metric_name
         HAVING COUNT(*) > 1`,
        [testRunId]
      );

      expect(statsResult.rows.length).toBe(0); // No duplicates
    });
  });

  describe('Benchmark ID Extraction', () => {
    test('should extract benchmark ID from metrics', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const benchmarkId = 'benchmark-123';

      const metrics = Array.from({ length: 50 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 100 + i,
        ramp_up: false,
        benchmark_ids: [benchmarkId]
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT benchmark_id FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(statsResult.rows[0].benchmark_id).toBe(benchmarkId);
    });

    test('should handle null benchmark IDs', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 50 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 100 + i,
        ramp_up: false
        // No benchmark_ids
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT benchmark_id FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(statsResult.rows[0].benchmark_id).toBeNull();
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid input gracefully', async () => {
      const result = await pipeline.execute({ invalid: 'input' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Invalid input');
    });

    test('should handle empty testRunIds array', async () => {
      const result = await pipeline.execute({ testRunIds: [] });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle non-existent test run gracefully', async () => {
      const result = await pipeline.execute({ testRunIds: ['non-existent-test-run'] });

      // Should succeed but process 0 records (no metrics found)
      expect(result.success).toBe(true);
      expect(result.data.processedRecords).toBe(0);
    });

    test('should handle database connection errors', async () => {
      // Close the database connection temporarily
      await testDb.end();

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Reconnect for cleanup
      testDb = new Pool({
        connectionString: process.env.DATABASE_URL || 'postgresql://perfana:perfana123@localhost:5432/perfana_test',
        max: 5
      });
    });
  });

  describe('Dashboard Metadata', () => {
    test('should store dashboard metadata correctly', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 50 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 100 + i,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT dashboard_uid, dashboard_label, panel_title FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      const stat = statsResult.rows[0];

      expect(stat.dashboard_uid).toBe('dashboard-uid-123');
      expect(stat.dashboard_label).toBe('Test Dashboard');
      expect(stat.panel_title).toBe('Test Panel');
    });

    test('should store unit field when provided', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 50 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 100 + i,
        ramp_up: false,
        unit: 'ms'
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);

      const statsResult = await testDb.query(
        'SELECT unit FROM ds_metric_statistics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(statsResult.rows[0].unit).toBe('ms');
    });
  });

  describe('Performance', () => {
    test('should complete within reasonable time for large dataset', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 10000 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 100 + Math.random() * 50,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const startTime = Date.now();
      const result = await pipeline.execute({ testRunIds: [testRunId] });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(10000); // Should complete in under 10 seconds
    }, 15000);

    test('should report accurate execution duration', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const metrics = Array.from({ length: 100 }, (_, i) => ({
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        panel_id: 1,
        metric_name: 'response_time',
        time: new Date(baseTime.getTime() + i * 1000),
        value: 100 + i,
        ramp_up: false
      }));

      await insertTestMetrics(metrics);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Statistics aggregation completed'));
    });
  });
});
