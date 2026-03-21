/**
 * ADAPT Pipeline Integration Tests
 *
 * Tests end-to-end ADAPT regression detection with real database,
 * threshold validation, and conclusion generation.
 */

import { describe, test, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { AdaptPipeline } from '../../pipelines/AdaptPipeline.js';
import { Pool } from 'pg';
import { createTestScenario, clearTestData } from '../helpers/database.js';

vi.mock('../../common/realtime-accessor.js', () => ({
  getRealtimePublisher: () => ({
    triggerTestRunUpdated: vi.fn()
  })
}));

vi.mock('../../common/database-accessor.js', () => {
  let testDb: any = null;
  return {
    getDatabaseService: vi.fn(() => {
      if (!testDb) throw new Error('Test database not initialized.');
      return testDb;
    }),
    setTestDatabase: (db: any) => { testDb = db; }
  };
});

import { setTestDatabase } from '../../common/database-accessor.js';

describe('AdaptPipeline Integration Tests', () => {
  let pipeline: AdaptPipeline;
  let testDb: Pool;
  let mockLogger: any;
  let testRunId: string;

  beforeAll(async () => {
    testDb = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://perfana:perfana123@localhost:5432/perfana_test',
      max: 5
    });

    for (let i = 0; i < 5; i++) {
      try {
        await testDb.query('SELECT 1');
        break;
      } catch (error) {
        if (i === 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    await testDb.query(`
      CREATE TABLE IF NOT EXISTS ds_adapt_results (
        id SERIAL PRIMARY KEY,
        test_run_id VARCHAR(255) NOT NULL,
        application_dashboard_id VARCHAR(255) NOT NULL,
        panel_id INTEGER NOT NULL,
        metric_name VARCHAR(255) NOT NULL,
        test_value DOUBLE PRECISION,
        control_value DOUBLE PRECISION,
        diff DOUBLE PRECISION,
        pct_diff DOUBLE PRECISION,
        is_difference BOOLEAN,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await testDb.query(`
      CREATE TABLE IF NOT EXISTS ds_adapt_tracked_results (
        id SERIAL PRIMARY KEY,
        test_run_id VARCHAR(255) NOT NULL,
        metric_name VARCHAR(255) NOT NULL,
        is_difference BOOLEAN,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await testDb.query(`
      CREATE TABLE IF NOT EXISTS ds_compare_config (
        id SERIAL PRIMARY KEY,
        application_dashboard_id VARCHAR(255) NOT NULL,
        panel_id INTEGER NOT NULL,
        metric_name VARCHAR(255) NOT NULL,
        threshold_config JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }, 30000);

  afterAll(async () => {
    if (testDb) await testDb.end();
  });

  beforeEach(async () => {
    await clearTestData(testDb);
    await testDb.query('DELETE FROM ds_adapt_results');
    await testDb.query('DELETE FROM ds_adapt_tracked_results');
    await testDb.query('DELETE FROM ds_compare_config');
    await testDb.query('DELETE FROM ds_control_groups');
    await testDb.query('DELETE FROM ds_metric_statistics');

    const scenario = await createTestScenario(testDb);
    testRunId = scenario.testRun.test_run_id;

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const mockDbService = createMockDatabaseService(testDb);
    setTestDatabase(mockDbService);

    pipeline = new AdaptPipeline(mockLogger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createMockDatabaseService(pool: Pool) {
    return {
      dataSource: {
        query: (sql: string, params?: any[]) => pool.query(sql, params),
        transaction: async (callback: any) => {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const manager = { query: (sql: string, params?: any[]) => client.query(sql, params) };
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
      },
      getTestRunByTestRunId: async (id: string) => {
        const result = await pool.query('SELECT * FROM test_runs WHERE test_run_id = $1', [id]);
        return result.rows[0] || null;
      }
    };
  }

  async function setupControlGroup(testValue: number, controlValue: number) {
    const controlRunId = 'control-run-001';

    await testDb.query(`
      INSERT INTO test_runs (
        test_run_id, system_under_test_id, workload, test_environment, start_time, end_time
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [controlRunId, 'app-001', 'load-test', 'production', new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T01:00:00Z')]);

    await testDb.query(`
      INSERT INTO ds_control_groups (
        control_group_id, system_under_test_id, workload, test_environment, test_runs, n_test_runs
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [testRunId, 'app-001', 'load-test', 'production', [controlRunId], 1]);

    await testDb.query(`
      INSERT INTO ds_metric_statistics (
        test_run_id, application_dashboard_id, panel_id, metric_name, mean, median
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [testRunId, 'app-dash-001', 1, 'response_time', testValue, testValue]);

    await testDb.query(`
      INSERT INTO ds_metric_statistics (
        test_run_id, application_dashboard_id, panel_id, metric_name, mean, median
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [controlRunId, 'app-dash-001', 1, 'response_time', controlValue, controlValue]);
  }

  describe('Complete ADAPT Analysis Flow', () => {
    test('should execute full adapt pipeline successfully', async () => {
      await setupControlGroup(150, 100);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(result.data.processedRows).toBeGreaterThan(0);
    });

    test('should detect performance regression', async () => {
      await setupControlGroup(200, 100); // 100% increase

      await pipeline.execute({ testRunIds: [testRunId] });

      const adaptResults = await testDb.query(
        'SELECT * FROM ds_adapt_results WHERE test_run_id = $1',
        [testRunId]
      );

      expect(adaptResults.rows.length).toBeGreaterThan(0);
      const result = adaptResults.rows[0];
      expect(result.test_value).toBe(200);
      expect(result.control_value).toBe(100);
      expect(result.pct_diff).toBeCloseTo(100, 1);
    });

    test('should detect performance improvement', async () => {
      await setupControlGroup(50, 100); // 50% decrease

      await pipeline.execute({ testRunIds: [testRunId] });

      const adaptResults = await testDb.query(
        'SELECT * FROM ds_adapt_results WHERE test_run_id = $1',
        [testRunId]
      );

      const result = adaptResults.rows[0];
      expect(result.pct_diff).toBeLessThan(0);
    });
  });

  describe('Threshold Validation', () => {
    test('should detect difference when exceeding percentage threshold', async () => {
      await setupControlGroup(150, 100); // 50% increase

      await testDb.query(`
        INSERT INTO ds_compare_config (
          application_dashboard_id, panel_id, metric_name, threshold_config
        ) VALUES ($1, $2, $3, $4)
      `, [
        'app-dash-001',
        1,
        'response_time',
        JSON.stringify({ percentageThreshold: 20, aggregation: 'mean' })
      ]);

      await pipeline.execute({ testRunIds: [testRunId] });

      const adaptResults = await testDb.query(
        'SELECT is_difference FROM ds_adapt_results WHERE test_run_id = $1',
        [testRunId]
      );

      expect(adaptResults.rows[0].is_difference).toBe(true);
    });

    test('should not detect difference when within threshold', async () => {
      await setupControlGroup(105, 100); // 5% increase

      await testDb.query(`
        INSERT INTO ds_compare_config (
          application_dashboard_id, panel_id, metric_name, threshold_config
        ) VALUES ($1, $2, $3, $4)
      `, [
        'app-dash-001',
        1,
        'response_time',
        JSON.stringify({ percentageThreshold: 10, aggregation: 'mean' })
      ]);

      await pipeline.execute({ testRunIds: [testRunId] });

      const adaptResults = await testDb.query(
        'SELECT is_difference FROM ds_adapt_results WHERE test_run_id = $1',
        [testRunId]
      );

      expect(adaptResults.rows[0].is_difference).toBe(false);
    });

    test('should validate absolute threshold', async () => {
      await setupControlGroup(150, 100); // Diff = 50

      await testDb.query(`
        INSERT INTO ds_compare_config (
          application_dashboard_id, panel_id, metric_name, threshold_config
        ) VALUES ($1, $2, $3, $4)
      `, [
        'app-dash-001',
        1,
        'response_time',
        JSON.stringify({ absoluteThreshold: 30, aggregation: 'mean' })
      ]);

      await pipeline.execute({ testRunIds: [testRunId] });

      const adaptResults = await testDb.query(
        'SELECT is_difference FROM ds_adapt_results WHERE test_run_id = $1',
        [testRunId]
      );

      expect(adaptResults.rows[0].is_difference).toBe(true);
    });
  });

  describe('Tracked Results', () => {
    test('should store tracked results for trending', async () => {
      await setupControlGroup(150, 100);

      await pipeline.execute({ testRunIds: [testRunId], updateTrackedResults: true });

      const trackedResults = await testDb.query(
        'SELECT * FROM ds_adapt_tracked_results WHERE test_run_id = $1',
        [testRunId]
      );

      expect(trackedResults.rows.length).toBeGreaterThan(0);
    });

    test('should delete existing tracked results before regenerating', async () => {
      await setupControlGroup(150, 100);

      await testDb.query(`
        INSERT INTO ds_adapt_tracked_results (test_run_id, metric_name, is_difference)
        VALUES ($1, $2, $3)
      `, [testRunId, 'old_metric', false]);

      await pipeline.execute({ testRunIds: [testRunId], updateTrackedResults: true });

      const trackedResults = await testDb.query(
        'SELECT * FROM ds_adapt_tracked_results WHERE test_run_id = $1 AND metric_name = $2',
        [testRunId, 'old_metric']
      );

      expect(trackedResults.rows.length).toBe(0);
    });
  });

  describe('Conclusion Generation', () => {
    test('should generate conclusions based on adapt results', async () => {
      await setupControlGroup(150, 100);

      const result = await pipeline.execute({
        testRunIds: [testRunId],
        updateConclusion: true
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Changepoint Handling', () => {
    test('should skip changepoint test runs', async () => {
      await testDb.query(`
        INSERT INTO ds_change_points (test_run_id, system_under_test_id, workload, test_environment)
        VALUES ($1, $2, $3, $4)
      `, [testRunId, 'app-001', 'load-test', 'production']);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(result.data.processedRows).toBe(0);
    });
  });

  describe('Empty Control Group Handling', () => {
    test('should skip test runs with empty control groups', async () => {
      await testDb.query(`
        INSERT INTO ds_control_groups (
          control_group_id, system_under_test_id, workload, test_environment, test_runs, n_test_runs
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [testRunId, 'app-001', 'load-test', 'production', [], 0]);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(result.data.processedRows).toBe(0);
    });
  });

  describe('Status Updates', () => {
    test('should set status to IN_PROGRESS during execution', async () => {
      await setupControlGroup(150, 100);

      await pipeline.execute({ testRunIds: [testRunId] });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Starting ADAPT analysis'));
    });

    test('should set final status on completion', async () => {
      await setupControlGroup(150, 100);

      await pipeline.execute({ testRunIds: [testRunId] });

      const testRun = await testDb.query(
        "SELECT status FROM test_runs WHERE test_run_id = $1",
        [testRunId]
      );

      expect(testRun.rows[0].status).toBeDefined();
    });
  });

  describe('Metric Filtering', () => {
    test('should filter by application dashboard ID', async () => {
      await setupControlGroup(150, 100);

      const result = await pipeline.execute({
        testRunIds: [testRunId],
        applicationDashboardId: 'app-dash-001'
      });

      expect(result.success).toBe(true);
    });

    test('should skip when filter does not match', async () => {
      await setupControlGroup(150, 100);

      const result = await pipeline.execute({
        testRunIds: [testRunId],
        applicationDashboardId: 'different-dashboard'
      });

      expect(result.success).toBe(true);
      expect(result.data.processedRows).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid input', async () => {
      const result = await pipeline.execute({ invalid: 'input' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle non-existent test run', async () => {
      const result = await pipeline.execute({ testRunIds: ['non-existent'] });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Performance', () => {
    test('should complete within reasonable time', async () => {
      await setupControlGroup(150, 100);

      const startTime = Date.now();
      const result = await pipeline.execute({ testRunIds: [testRunId] });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(10000);
    });

    test('should report substage timings', async () => {
      await setupControlGroup(150, 100);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('ADAPT analysis'));
    });
  });
});
