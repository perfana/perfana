/**
 * Dynatrace Pipeline Integration Tests
 *
 * Tests Dynatrace DQL metrics collection with real database,
 * mocked Dynatrace API, and multi-instance support.
 */

import { describe, test, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { DynatracePipeline } from '../../pipelines/DynatracePipeline.js';
import { Pool } from 'pg';
import { createTestScenario, clearTestData } from '../helpers/database.js';

// Mock Dynatrace API client
vi.mock('../../services/dynatrace/DynatraceAPIClient.js', () => ({
  DynatraceAPIClient: vi.fn().mockImplementation(() => ({
    executeBatchQueries: vi.fn().mockResolvedValue([
      {
        tileId: 'tile-1',
        tileTitle: 'Response Time',
        result: {
          records: [
            { timestamp: 1704110400000, value: 150 },
            { timestamp: 1704110460000, value: 155 }
          ]
        }
      }
    ]),
    close: vi.fn()
  }))
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

describe('DynatracePipeline Integration Tests', () => {
  let pipeline: DynatracePipeline;
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
      CREATE TABLE IF NOT EXISTS dynatrace_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        label VARCHAR(255) NOT NULL,
        host VARCHAR(255) NOT NULL,
        dynatrace_type VARCHAR(50) NOT NULL,
        api_token VARCHAR(255),
        platform_api_token VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await testDb.query(`
      CREATE TABLE IF NOT EXISTS dynatrace_dql (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dynatrace_config_id UUID NOT NULL,
        system_under_test_id VARCHAR(255) NOT NULL,
        workload VARCHAR(255) NOT NULL,
        test_environment VARCHAR(255) NOT NULL,
        application_dashboard_id VARCHAR(255) NOT NULL,
        panel_id INTEGER NOT NULL,
        query TEXT NOT NULL,
        tile_title VARCHAR(255),
        visualization VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }, 30000);

  afterAll(async () => {
    if (testDb) await testDb.end();
  });

  beforeEach(async () => {
    await clearTestData(testDb);
    await testDb.query('DELETE FROM dynatrace_configs');
    await testDb.query('DELETE FROM dynatrace_dql');
    await testDb.query('DELETE FROM ds_metrics');

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

    pipeline = new DynatracePipeline(mockLogger);
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
        if (result.rows.length === 0) return null;
        const row = result.rows[0];
        return {
          testRunId: row.test_run_id,
          systemUnderTestId: row.system_under_test_id,
          workload: row.workload,
          testEnvironment: row.test_environment,
          startTime: row.start_time,
          endTime: row.end_time
        };
      }
    };
  }

  async function setupDynatraceConfig(type: 'saas' | 'managed' = 'saas') {
    const configResult = await testDb.query(`
      INSERT INTO dynatrace_configs (label, host, dynatrace_type, api_token, platform_api_token)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [
      'Test Dynatrace',
      'https://test.dynatrace.com',
      type,
      'test-api-token',
      type === 'saas' ? 'test-platform-token' : null
    ]);

    return configResult.rows[0].id;
  }

  async function setupDynatraceQuery(configId: string) {
    await testDb.query(`
      INSERT INTO dynatrace_dql (
        dynatrace_config_id, system_under_test_id, workload, test_environment,
        application_dashboard_id, panel_id, query, tile_title, visualization
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      configId,
      'app-001',
      'load-test',
      'production',
      'app-dash-001',
      1,
      'timeseries avg(dt.host.cpu.usage)',
      'CPU Usage',
      'line'
    ]);
  }

  describe('Complete Dynatrace Collection Flow', () => {
    test('should execute full dynatrace pipeline successfully', async () => {
      const configId = await setupDynatraceConfig('saas');
      await setupDynatraceQuery(configId);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(result.data.testRunCount).toBe(1);
      expect(result.data.totalQueries).toBeGreaterThan(0);
    });

    test('should store metrics from Dynatrace queries', async () => {
      const configId = await setupDynatraceConfig('saas');
      await setupDynatraceQuery(configId);

      await pipeline.execute({ testRunIds: [testRunId] });

      const metrics = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_metrics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(parseInt(metrics.rows[0].count)).toBeGreaterThan(0);
    });

    test('should handle multiple queries per test run', async () => {
      const configId = await setupDynatraceConfig('saas');
      await setupDynatraceQuery(configId);

      await testDb.query(`
        INSERT INTO dynatrace_dql (
          dynatrace_config_id, system_under_test_id, workload, test_environment,
          application_dashboard_id, panel_id, query, tile_title
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [configId, 'app-001', 'load-test', 'production', 'app-dash-001', 2, 'timeseries avg(dt.host.memory.usage)', 'Memory Usage']);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(result.data.totalQueries).toBe(2);
    });
  });

  describe('Multi-Instance Support', () => {
    test('should support multiple Dynatrace instances', async () => {
      const config1 = await setupDynatraceConfig('saas');
      const config2 = await setupDynatraceConfig('managed');

      await setupDynatraceQuery(config1);

      await testDb.query(`
        INSERT INTO dynatrace_dql (
          dynatrace_config_id, system_under_test_id, workload, test_environment,
          application_dashboard_id, panel_id, query, tile_title
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [config2, 'app-001', 'load-test', 'production', 'app-dash-002', 1, 'timeseries count(dt.service.requests)', 'Requests']);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Dynatrace instance(s)'));
    });

    test('should handle SaaS vs Managed authentication', async () => {
      const saasConfig = await setupDynatraceConfig('saas');
      await setupDynatraceQuery(saasConfig);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
    });
  });

  describe('No Queries Configured', () => {
    test('should handle test run with no Dynatrace queries', async () => {
      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(result.data.totalQueries).toBe(0);
      expect(result.data.totalMetrics).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid input', async () => {
      const result = await pipeline.execute({ invalid: 'input' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle non-existent test run', async () => {
      const configId = await setupDynatraceConfig();
      await setupDynatraceQuery(configId);

      const result = await pipeline.execute({ testRunIds: ['non-existent'] });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should skip queries with missing config', async () => {
      await testDb.query(`
        INSERT INTO dynatrace_dql (
          dynatrace_config_id, system_under_test_id, workload, test_environment,
          application_dashboard_id, panel_id, query, tile_title
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, ['00000000-0000-0000-0000-000000000000', 'app-001', 'load-test', 'production', 'app-dash-001', 1, 'test query', 'Test']);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('configuration not found'));
    });

    test('should handle missing API token', async () => {
      await testDb.query(`
        INSERT INTO dynatrace_configs (label, host, dynatrace_type)
        VALUES ($1, $2, $3)
        RETURNING id
      `, ['Test', 'https://test.com', 'saas']);

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.success).toBe(true);
    });
  });

  describe('Performance', () => {
    test('should complete within reasonable time', async () => {
      const configId = await setupDynatraceConfig();
      await setupDynatraceQuery(configId);

      const startTime = Date.now();
      const result = await pipeline.execute({ testRunIds: [testRunId] });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(10000);
    });
  });
});
