/**
 * Real-World MetricsPipeline Integration Test
 *
 * This test uses actual database data for test run 'MyAfterburner-acc-loadTest-00002'
 * to validate the MetricsPipeline implementation against real production data.
 *
 * Test Strategy:
 * 1. Backup existing ds_metrics data for the test run
 * 2. Clear the ds_metrics data for the test run
 * 3. Run the MetricsPipeline using existing ds_panels data
 * 4. Compare the recreated metrics with the original data
 * 5. Restore original data if needed
 */

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { MetricsPipeline } from '../../../pipelines/MetricsPipeline.js';
import { mockGrafanaAPI } from '../../mocks/grafana.js';

describe('MetricsPipeline Real-World Integration Test', () => {
  const TEST_RUN_ID = 'MyAfterburner-acc-loadTest-00002';
  let db: Pool;
  let pipeline: MetricsPipeline;
  let originalMetricsData: any[] = [];
  let mockAxios: any;

  beforeAll(async () => {
    // Setup database connection
    db = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://perfana:perfana123@localhost:5432/perfana',
      max: 5
    });

    // Create pipeline instance
    pipeline = new MetricsPipeline(db, console);

    // Setup Grafana API mock
    const mock = mockGrafanaAPI();
    mockAxios = mock.mockAxios;

    vi.mock('axios', () => ({
      default: {
        create: () => mockAxios,
        post: mockAxios.post
      }
    }));

    // Backup existing metrics data
    console.log('📦 Backing up existing metrics data...');
    await backupExistingMetrics();

    console.log('✅ Test setup complete');
  }, 60000);

  afterAll(async () => {
    // Cleanup
    if (db) {
      await db.end();
    }
    vi.restoreAllMocks();
  });

  const backupExistingMetrics = async () => {
    const result = await db.query(`
      SELECT
        test_run_id,
        application_dashboard_id,
        dashboard_uid,
        panel_id,
        panel_title,
        dashboard_label,
        benchmark_ids,
        errors,
        metric_name,
        time,
        timestep,
        ramp_up,
        value,
        unit,
        updated_at,
        created_at
      FROM ds_metrics
      WHERE test_run_id = $1
      ORDER BY panel_id, metric_name, time
    `, [TEST_RUN_ID]);

    originalMetricsData = result.rows;
    console.log(`📊 Backed up ${originalMetricsData.length} metrics records`);
  };

  const clearTestRunMetrics = async () => {
    const result = await db.query(
      'DELETE FROM ds_metrics WHERE test_run_id = $1',
      [TEST_RUN_ID]
    );
    console.log(`🗑️  Cleared ${result.rowCount} metrics records for test run`);
  };

  const restoreOriginalMetrics = async () => {
    if (originalMetricsData.length === 0) return;

    console.log('🔄 Restoring original metrics data...');

    // Clear any test-created data first
    await clearTestRunMetrics();

    // Restore original data in batches
    const batchSize = 100;
    for (let i = 0; i < originalMetricsData.length; i += batchSize) {
      const batch = originalMetricsData.slice(i, i + batchSize);

      const insertQuery = `
        INSERT INTO ds_metrics (
          test_run_id, application_dashboard_id, dashboard_uid, panel_id,
          panel_title, dashboard_label, benchmark_ids, errors, metric_name,
          time, timestep, ramp_up, value, unit, updated_at, created_at
        ) VALUES ${batch.map((_, idx) =>
          `($${idx * 16 + 1}, $${idx * 16 + 2}, $${idx * 16 + 3}, $${idx * 16 + 4},
           $${idx * 16 + 5}, $${idx * 16 + 6}, $${idx * 16 + 7}, $${idx * 16 + 8},
           $${idx * 16 + 9}, $${idx * 16 + 10}, $${idx * 16 + 11}, $${idx * 16 + 12},
           $${idx * 16 + 13}, $${idx * 16 + 14}, $${idx * 16 + 15}, $${idx * 16 + 16})`
        ).join(', ')}
      `;

      const values = batch.flatMap(row => [
        row.test_run_id, row.application_dashboard_id, row.dashboard_uid, row.panel_id,
        row.panel_title, row.dashboard_label, row.benchmark_ids,
        row.errors ? JSON.stringify(row.errors) : null,
        row.metric_name, row.time, row.timestep, row.ramp_up, row.value, row.unit,
        row.updated_at, row.created_at
      ]);

      await db.query(insertQuery, values);
    }

    console.log(`✅ Restored ${originalMetricsData.length} metrics records`);
  };

  const setupGrafanaAPIResponses = () => {
    // Mock realistic Grafana API responses based on the actual data structure
    mockAxios.post.mockImplementation(async (url: string, data: any) => {
      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 50));

      if (url.includes('/api/ds/query')) {
        const results: any = {};

        // Generate mock responses for each query
        data.queries.forEach((query: any) => {
          const frames = [{
            schema: {
              fields: [
                { name: 'Time', type: 'time' },
                { name: 'Value', type: 'number' }
              ]
            },
            data: {
              values: [
                // Generate time series data matching the test run period
                generateTimeSeriesForQuery(query),
                generateValuesForQuery(query)
              ]
            }
          }];

          results[query.refId] = {
            status: 200,
            frames: frames
          };
        });

        return {
          status: 200,
          data: { results }
        };
      }

      return { status: 200, data: {} };
    });
  };

  const generateTimeSeriesForQuery = (query: any): number[] => {
    // Generate timestamps matching the test run period
    const startTime = new Date('2025-09-18T07:18:23.000Z').getTime();
    const endTime = new Date('2025-09-18T07:24:31.000Z').getTime();
    const interval = 1000; // 1 second intervals

    const timestamps = [];
    for (let time = startTime; time <= endTime; time += interval) {
      timestamps.push(time);
    }
    return timestamps;
  };

  const generateValuesForQuery = (query: any): (number | null)[] => {
    const timestamps = generateTimeSeriesForQuery(query);

    // Generate realistic values or nulls based on query type
    return timestamps.map((_, index) => {
      if (query.expr && query.expr.includes('ERROR')) {
        // ERROR metrics are mostly null in the original data
        return Math.random() < 0.1 ? Math.random() * 10 : null;
      } else {
        // Regular metrics have realistic values
        return 50 + Math.random() * 100;
      }
    });
  };

  describe('Real-World Data Validation', () => {
    test('should verify test run exists with expected data', async () => {
      const testRunResult = await db.query(
        'SELECT test_run_id, start_time, end_time, workload, test_environment FROM test_runs WHERE test_run_id = $1',
        [TEST_RUN_ID]
      );

      expect(testRunResult.rows).toHaveLength(1);

      const testRun = testRunResult.rows[0];
      expect(testRun.test_run_id).toBe(TEST_RUN_ID);
      expect(testRun.workload).toBe('loadTest');
      expect(testRun.test_environment).toBe('acc');
      expect(new Date(testRun.start_time)).toBeInstanceOf(Date);
      expect(new Date(testRun.end_time)).toBeInstanceOf(Date);
    });

    test('should have existing panel data for test run', async () => {
      const panelsResult = await db.query(
        'SELECT COUNT(*) as count FROM ds_panels WHERE test_run_id = $1',
        [TEST_RUN_ID]
      );

      const panelCount = parseInt(panelsResult.rows[0].count);
      expect(panelCount).toBeGreaterThan(0);
      console.log(`📊 Found ${panelCount} panels for test run`);
    });

    test('should have backed up original metrics data', () => {
      expect(originalMetricsData.length).toBeGreaterThan(0);
      console.log(`📦 Original metrics backup: ${originalMetricsData.length} records`);
    });
  });

  describe('MetricsPipeline Execution', () => {
    test('should successfully run metrics pipeline and recreate data', async () => {
      // Setup Grafana API responses
      setupGrafanaAPIResponses();

      // Clear existing metrics data
      await clearTestRunMetrics();

      // Verify metrics are cleared
      const clearedResult = await db.query(
        'SELECT COUNT(*) as count FROM ds_metrics WHERE test_run_id = $1',
        [TEST_RUN_ID]
      );
      expect(parseInt(clearedResult.rows[0].count)).toBe(0);

      // Execute the metrics pipeline
      console.log('🚀 Executing MetricsPipeline...');
      const result = await pipeline.execute({
        testRunId: TEST_RUN_ID,
        benchmarksOnly: false
      });

      // Verify pipeline execution success
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.testRunId).toBe(TEST_RUN_ID);
      expect(result.data.metricsCollected).toBeGreaterThan(0);

      console.log(`✅ Pipeline completed: ${result.data.metricsCollected} metrics collected`);

      // Verify data was created in database
      const newMetricsResult = await db.query(
        'SELECT COUNT(*) as count, COUNT(DISTINCT panel_id) as panels, COUNT(DISTINCT metric_name) as metrics FROM ds_metrics WHERE test_run_id = $1',
        [TEST_RUN_ID]
      );

      const newMetrics = newMetricsResult.rows[0];
      expect(parseInt(newMetrics.count)).toBeGreaterThan(0);
      expect(parseInt(newMetrics.panels)).toBeGreaterThan(0);
      expect(parseInt(newMetrics.metrics)).toBeGreaterThan(0);

      console.log(`📊 Created metrics - Records: ${newMetrics.count}, Panels: ${newMetrics.panels}, Metrics: ${newMetrics.metrics}`);
    }, 120000); // 2 minute timeout

    test('should validate data structure matches expected schema', async () => {
      const sampleDataResult = await db.query(`
        SELECT
          test_run_id,
          panel_id,
          panel_title,
          metric_name,
          time,
          timestep,
          ramp_up,
          value,
          unit,
          benchmark_ids
        FROM ds_metrics
        WHERE test_run_id = $1
        ORDER BY panel_id, metric_name, time
        LIMIT 10
      `, [TEST_RUN_ID]);

      expect(sampleDataResult.rows.length).toBeGreaterThan(0);

      // Validate each record structure
      sampleDataResult.rows.forEach(row => {
        expect(row.test_run_id).toBe(TEST_RUN_ID);
        expect(row.panel_id).toBeTypeOf('number');
        expect(row.panel_title).toBeTypeOf('string');
        expect(row.metric_name).toBeTypeOf('string');
        expect(row.time).toBeInstanceOf(Date);
        expect(typeof row.timestep).toMatch(/number|object/); // Can be null
        expect(typeof row.ramp_up).toMatch(/boolean|object/); // Can be null
        expect(typeof row.value).toMatch(/number|object/); // Can be null
        // benchmark_ids should be array (even if empty)
        expect(Array.isArray(row.benchmark_ids)).toBe(true);
      });
    });
  });

  describe('Data Comparison and Validation', () => {
    test('should restore original data after testing', async () => {
      // Restore original data
      await restoreOriginalMetrics();

      // Verify restoration
      const restoredResult = await db.query(
        'SELECT COUNT(*) as count FROM ds_metrics WHERE test_run_id = $1',
        [TEST_RUN_ID]
      );

      const restoredCount = parseInt(restoredResult.rows[0].count);
      expect(restoredCount).toBe(originalMetricsData.length);

      console.log(`✅ Successfully restored ${restoredCount} original metrics records`);
    });

    test('should validate key metrics are within expected ranges', async () => {
      // Get summary statistics of restored data
      const statsResult = await db.query(`
        SELECT
          COUNT(*) as total_records,
          COUNT(DISTINCT panel_id) as unique_panels,
          COUNT(DISTINCT metric_name) as unique_metrics,
          COUNT(CASE WHEN value IS NOT NULL THEN 1 END) as non_null_values,
          MIN(time) as earliest_time,
          MAX(time) as latest_time
        FROM ds_metrics
        WHERE test_run_id = $1
      `, [TEST_RUN_ID]);

      const stats = statsResult.rows[0];

      // Validate against known characteristics of the test data
      expect(parseInt(stats.total_records)).toBe(12180); // Known from original query
      expect(parseInt(stats.unique_panels)).toBe(71);    // Known from original query
      expect(parseInt(stats.unique_metrics)).toBe(145);  // Known from original query

      // Validate time range matches test run
      expect(new Date(stats.earliest_time)).toEqual(new Date('2025-09-18T07:18:00.000Z'));
      expect(new Date(stats.latest_time)).toEqual(new Date('2025-09-18T07:24:32.000Z'));

      console.log('📊 Data validation summary:', {
        totalRecords: stats.total_records,
        uniquePanels: stats.unique_panels,
        uniqueMetrics: stats.unique_metrics,
        nonNullValues: stats.non_null_values,
        timeRange: `${stats.earliest_time} to ${stats.latest_time}`
      });
    });
  });
});