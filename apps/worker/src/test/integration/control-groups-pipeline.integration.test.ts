/**
 * Control Groups Pipeline Integration Tests
 *
 * Tests end-to-end control group creation with real database connections,
 * validates changepoint detection, control run selection, and wait logic.
 */

import { describe, test, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { ControlGroupsPipeline } from '../../pipelines/ControlGroupsPipeline.js';
import { Pool } from 'pg';
import { createTestScenario, clearTestData } from '../helpers/database.js';

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

describe('ControlGroupsPipeline Integration Tests', () => {
  let pipeline: ControlGroupsPipeline;
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
      CREATE TABLE IF NOT EXISTS ds_control_groups (
        control_group_id VARCHAR(255) PRIMARY KEY,
        system_under_test_id VARCHAR(255) NOT NULL,
        workload VARCHAR(255) NOT NULL,
        test_environment VARCHAR(255) NOT NULL,
        test_runs TEXT[],
        n_test_runs INTEGER,
        change_point JSONB,
        first_datetime TIMESTAMP,
        last_datetime TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await testDb.query(`
      CREATE TABLE IF NOT EXISTS ds_change_points (
        id SERIAL PRIMARY KEY,
        test_run_id VARCHAR(255) NOT NULL,
        system_under_test_id VARCHAR(255) NOT NULL,
        workload VARCHAR(255) NOT NULL,
        test_environment VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }, 30000);

  afterAll(async () => {
    if (testDb) await testDb.end();
  });

  beforeEach(async () => {
    await clearTestData(testDb);
    await testDb.query('DELETE FROM ds_control_groups');
    await testDb.query('DELETE FROM ds_change_points');

    const scenario = await createTestScenario(testDb);
    testRunId = scenario.testRun.test_run_id;

    // Set status to ready (evaluatingChecks = COMPLETED)
    await testDb.query(`
      UPDATE test_runs
      SET status = jsonb_build_object('evaluatingChecks', 'COMPLETED')
      WHERE test_run_id = $1
    `, [testRunId]);

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const mockDbService = createMockDatabaseService(testDb);
    setTestDatabase(mockDbService);

    pipeline = new ControlGroupsPipeline(mockLogger);
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
      }
    };
  }

  async function createHistoricalTestRuns(count: number) {
    const baseTime = new Date('2024-01-01T00:00:00Z');
    const testRunIds = [];

    for (let i = 0; i < count; i++) {
      const startTime = new Date(baseTime.getTime() - (count - i) * 3600000);
      const endTime = new Date(startTime.getTime() + 1800000);

      const result = await testDb.query(`
        INSERT INTO test_runs (
          test_run_id, system_under_test_id, workload, test_environment,
          start_time, end_time, consolidated_result, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING test_run_id
      `, [
        `historical-run-${i}`,
        'app-001',
        'load-test',
        'production',
        startTime,
        endTime,
        JSON.stringify({ meetsRequirement: true }),
        JSON.stringify({ evaluatingChecks: 'COMPLETED' })
      ]);

      testRunIds.push(result.rows[0].test_run_id);
    }

    return testRunIds;
  }

  describe('Complete Control Group Creation Flow', () => {
    test('should create control group for single test run', async () => {
      await createHistoricalTestRuns(5);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(result.data.controlGroupsCreated).toBe(1);

      const controlGroup = await testDb.query(
        'SELECT * FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      expect(controlGroup.rows.length).toBe(1);
      expect(controlGroup.rows[0].test_runs.length).toBe(5);
    });

    test('should create control groups for multiple test runs', async () => {
      await createHistoricalTestRuns(10);

      const testRun2 = await testDb.query(`
        INSERT INTO test_runs (
          test_run_id, system_under_test_id, workload, test_environment, start_time, end_time, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING test_run_id
      `, [
        'test-run-002',
        'app-001',
        'load-test',
        'production',
        new Date(),
        new Date(),
        JSON.stringify({ evaluatingChecks: 'COMPLETED' })
      ]);

      const result = await pipeline.execute({
        testRunIds: [testRunId, testRun2.rows[0].test_run_id]
      });

      expect(result.success).toBe(true);
      expect(result.data.controlGroupsCreated).toBe(2);

      const controlGroups = await testDb.query('SELECT COUNT(*) as count FROM ds_control_groups');
      expect(parseInt(controlGroups.rows[0].count)).toBe(2);
    });

    test('should store control group with correct metadata', async () => {
      await createHistoricalTestRuns(3);

      await pipeline.execute({ testRunIds: [testRunId] });

      const controlGroup = await testDb.query(
        'SELECT * FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      const cg = controlGroup.rows[0];
      expect(cg.system_under_test_id).toBe('app-001');
      expect(cg.workload).toBe('load-test');
      expect(cg.test_environment).toBe('production');
      expect(cg.n_test_runs).toBe(3);
      expect(cg.first_datetime).toBeDefined();
      expect(cg.last_datetime).toBeDefined();
    });
  });

  describe('Control Run Selection', () => {
    test('should select up to 10 most recent control runs', async () => {
      await createHistoricalTestRuns(15);

      await pipeline.execute({ testRunIds: [testRunId] });

      const controlGroup = await testDb.query(
        'SELECT test_runs FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      expect(controlGroup.rows[0].test_runs.length).toBe(10);
    });

    test('should only select runs that meet requirements', async () => {
      await createHistoricalTestRuns(5);

      // Create some runs that don't meet requirements
      await testDb.query(`
        INSERT INTO test_runs (
          test_run_id, system_under_test_id, workload, test_environment,
          start_time, end_time, consolidated_result, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        'failed-run',
        'app-001',
        'load-test',
        'production',
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T01:00:00Z'),
        JSON.stringify({ meetsRequirement: false }),
        JSON.stringify({ evaluatingChecks: 'COMPLETED' })
      ]);

      await pipeline.execute({ testRunIds: [testRunId] });

      const controlGroup = await testDb.query(
        'SELECT test_runs FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      // Should not include the failed run
      expect(controlGroup.rows[0].test_runs).not.toContain('failed-run');
    });

    test('should exclude runs with DENIED differences', async () => {
      await createHistoricalTestRuns(5);

      await testDb.query(`
        INSERT INTO test_runs (
          test_run_id, system_under_test_id, workload, test_environment,
          start_time, end_time, consolidated_result, adapt_config, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        'denied-run',
        'app-001',
        'load-test',
        'production',
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T01:00:00Z'),
        JSON.stringify({ meetsRequirement: true }),
        JSON.stringify({ differencesAccepted: 'DENIED' }),
        JSON.stringify({ evaluatingChecks: 'COMPLETED' })
      ]);

      await pipeline.execute({ testRunIds: [testRunId] });

      const controlGroup = await testDb.query(
        'SELECT test_runs FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      expect(controlGroup.rows[0].test_runs).not.toContain('denied-run');
    });

    test('should include BASELINE mode runs', async () => {
      await testDb.query(`
        INSERT INTO test_runs (
          test_run_id, system_under_test_id, workload, test_environment,
          start_time, end_time, consolidated_result, adapt_config, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        'baseline-run',
        'app-001',
        'load-test',
        'production',
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T01:00:00Z'),
        JSON.stringify({ meetsRequirement: false }),
        JSON.stringify({ mode: 'BASELINE' }),
        JSON.stringify({ evaluatingChecks: 'COMPLETED' })
      ]);

      await pipeline.execute({ testRunIds: [testRunId] });

      const controlGroup = await testDb.query(
        'SELECT test_runs FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      expect(controlGroup.rows[0].test_runs).toContain('baseline-run');
    });

    test('should include runs with no SLOs configured (NULL consolidated_result)', async () => {
      // Create a run with no consolidated_result (no SLOs/benchmarks configured)
      await testDb.query(`
        INSERT INTO test_runs (
          test_run_id, system_under_test_id, workload, test_environment,
          start_time, end_time, consolidated_result, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        'no-slo-run',
        'app-001',
        'load-test',
        'production',
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T01:00:00Z'),
        null,
        JSON.stringify({ evaluatingChecks: 'NOT_CONFIGURED' })
      ]);

      await pipeline.execute({ testRunIds: [testRunId] });

      const controlGroup = await testDb.query(
        'SELECT test_runs FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      // Runs without SLOs should be included in control group
      expect(controlGroup.rows[0].test_runs).toContain('no-slo-run');
    });
  });

  describe('Changepoint Detection', () => {
    test('should detect changepoint when present', async () => {
      await createHistoricalTestRuns(5);

      await testDb.query(`
        INSERT INTO ds_change_points (test_run_id, system_under_test_id, workload, test_environment)
        VALUES ($1, $2, $3, $4)
      `, ['historical-run-2', 'app-001', 'load-test', 'production']);

      await pipeline.execute({ testRunIds: [testRunId] });

      const controlGroup = await testDb.query(
        'SELECT change_point FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      expect(controlGroup.rows[0].change_point).toBeDefined();
      expect(controlGroup.rows[0].change_point.test_run_id).toBe('historical-run-2');
    });

    test('should only select control runs after changepoint', async () => {
      await createHistoricalTestRuns(10);

      await testDb.query(`
        INSERT INTO ds_change_points (test_run_id, system_under_test_id, workload, test_environment)
        VALUES ($1, $2, $3, $4)
      `, ['historical-run-5', 'app-001', 'load-test', 'production']);

      await pipeline.execute({ testRunIds: [testRunId] });

      const controlGroup = await testDb.query(
        'SELECT test_runs FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      // Should only include runs 5-9 (after changepoint, excluding current run)
      expect(controlGroup.rows[0].test_runs.length).toBeLessThanOrEqual(5);
    });

    test('should return empty control group for changepoint run itself', async () => {
      await createHistoricalTestRuns(5);

      await testDb.query(`
        INSERT INTO ds_change_points (test_run_id, system_under_test_id, workload, test_environment)
        VALUES ($1, $2, $3, $4)
      `, [testRunId, 'app-001', 'load-test', 'production']);

      await pipeline.execute({ testRunIds: [testRunId] });

      const controlGroup = await testDb.query(
        'SELECT test_runs FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      expect(controlGroup.rows[0].test_runs.length).toBe(0);
    });
  });

  describe('Wait for Ready Logic', () => {
    test('should wait for test runs to be ready', async () => {
      await createHistoricalTestRuns(3);

      await testDb.query(`
        UPDATE test_runs
        SET status = jsonb_build_object('evaluatingChecks', 'IN_PROGRESS')
        WHERE test_run_id = $1
      `, [testRunId]);

      setTimeout(async () => {
        await testDb.query(`
          UPDATE test_runs
          SET status = jsonb_build_object('evaluatingChecks', 'COMPLETED')
          WHERE test_run_id = $1
        `, [testRunId]);
      }, 500);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
    }, 10000);

    test('should reset stuck IN_PROGRESS statuses', async () => {
      await testDb.query(`
        UPDATE test_runs
        SET status = jsonb_build_object(
          'evaluatingAdapt', 'IN_PROGRESS',
          'lastUpdate', (NOW() - INTERVAL '15 minutes')::text
        )
        WHERE test_run_id = $1
      `, [testRunId]);

      // Set evaluatingChecks to COMPLETED so it can proceed
      await testDb.query(`
        UPDATE test_runs
        SET status = jsonb_set(status, '{evaluatingChecks}', '"COMPLETED"')
        WHERE test_run_id = $1
      `, [testRunId]);

      await createHistoricalTestRuns(3);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
    }, 10000);
  });

  describe('UPSERT Pattern', () => {
    test('should create new control group on first execution', async () => {
      await createHistoricalTestRuns(3);

      await pipeline.execute({ testRunIds: [testRunId] });

      const controlGroups = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      expect(parseInt(controlGroups.rows[0].count)).toBe(1);
    });

    test('should update existing control group on re-execution', async () => {
      await createHistoricalTestRuns(3);

      await pipeline.execute({ testRunIds: [testRunId] });

      const firstResult = await testDb.query(
        'SELECT n_test_runs FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      // Add more historical runs
      await createHistoricalTestRuns(2);

      await pipeline.execute({ testRunIds: [testRunId] });

      const secondResult = await testDb.query(
        'SELECT n_test_runs FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );

      expect(secondResult.rows[0].n_test_runs).toBeGreaterThan(firstResult.rows[0].n_test_runs);

      // Should still be only one record
      const count = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_control_groups WHERE control_group_id = $1',
        [testRunId]
      );
      expect(parseInt(count.rows[0].count)).toBe(1);
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

    test('should handle timeout waiting for ready state', async () => {
      await testDb.query(`
        UPDATE test_runs
        SET status = jsonb_build_object('evaluatingChecks', 'IN_PROGRESS')
        WHERE test_run_id = $1
      `, [testRunId]);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Timeout');
    }, 130000);
  });

  describe('Performance', () => {
    test('should complete within reasonable time', async () => {
      await createHistoricalTestRuns(10);

      const startTime = Date.now();
      const result = await pipeline.execute({ testRunIds: [testRunId] });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(10000);
    });
  });
});
