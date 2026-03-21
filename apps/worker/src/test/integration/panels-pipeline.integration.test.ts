/**
 * Panels Pipeline Integration Tests
 *
 * Tests panel document creation and bulk insert operations.
 */

import { describe, test, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { PanelsPipeline } from '../../pipelines/PanelsPipeline.js';
import { Pool } from 'pg';
import { createTestScenario, clearTestData } from '../helpers/database.js';

// Mock panel helpers
vi.mock('../../pipelines/panels/helpers.js', () => ({
  getApplicationDashboardsForTestRun: vi.fn().mockResolvedValue([
    { id: 'app-dash-001', name: 'Test Dashboard' }
  ]),
  getGrafanaDashboardsForApplicationDashboards: vi.fn().mockResolvedValue([
    { uid: 'dashboard-001', title: 'Test Grafana Dashboard' }
  ]),
  getBenchmarksForTestRun: vi.fn().mockResolvedValue([
    { id: 'benchmark-001', name: 'Test Benchmark' }
  ]),
  createPanelDocuments: vi.fn().mockResolvedValue([
    {
      test_run_id: 'test-run-001',
      application_dashboard_id: 'app-dash-001',
      dashboard_uid: 'dashboard-001',
      panel_id: 1,
      panel_title: 'Test Panel',
      dashboard_label: 'Test Label',
      benchmark_ids: ['benchmark-001'],
      panel: { id: 1, title: 'Test' },
      query_variables: {},
      datasource_type: 'prometheus',
      requests: [],
      errors: [],
      warnings: [],
      updated_at: new Date()
    }
  ])
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

describe('PanelsPipeline Integration Tests', () => {
  let pipeline: PanelsPipeline;
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
      CREATE TABLE IF NOT EXISTS systems_under_test (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }, 30000);

  afterAll(async () => {
    if (testDb) await testDb.end();
  });

  beforeEach(async () => {
    await clearTestData(testDb);
    await testDb.query('DELETE FROM ds_panels');
    await testDb.query('DELETE FROM systems_under_test');

    const scenario = await createTestScenario(testDb);
    testRunId = scenario.testRun.test_run_id;

    await testDb.query(`
      INSERT INTO systems_under_test (id, name) VALUES ($1, $2)
    `, ['app-001', 'Test Application']);

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const mockDbService = createMockDatabaseService(testDb);
    setTestDatabase(mockDbService);

    pipeline = new PanelsPipeline(mockLogger);
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
      },
      getSystemUnderTestName: async (id: string) => {
        const result = await pool.query('SELECT name FROM systems_under_test WHERE id = $1', [id]);
        return result.rows[0]?.name || null;
      },
      query: (sql: string, params?: any[]) => pool.query(sql, params)
    };
  }

  describe('Complete Panels Processing Flow', () => {
    test('should execute full panels pipeline successfully', async () => {
      const result = await pipeline.execute({ testRunId });

      expect(result.success).toBe(true);
      expect(result.data.panelDocuments).toBeGreaterThan(0);
    });

    test('should store panel documents in database', async () => {
      await pipeline.execute({ testRunId });

      const panels = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_panels WHERE test_run_id = $1',
        [testRunId]
      );

      expect(parseInt(panels.rows[0].count)).toBeGreaterThan(0);
    });

    test('should delete existing panels before inserting new ones', async () => {
      await testDb.query(`
        INSERT INTO ds_panels (
          test_run_id, application_dashboard_id, dashboard_uid, panel_id,
          panel_title, dashboard_label, benchmark_ids, panel, requests
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [testRunId, 'old-dash', 'old-uid', 999, 'Old Panel', 'Old', '[]', '{}', '[]']);

      await pipeline.execute({ testRunId });

      const oldPanels = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_panels WHERE test_run_id = $1 AND panel_id = 999',
        [testRunId]
      );

      expect(parseInt(oldPanels.rows[0].count)).toBe(0);
    });
  });

  describe('Bulk Insert Operations', () => {
    test('should perform bulk insert for multiple panels', async () => {
      const { createPanelDocuments } = await import('../../pipelines/panels/helpers.js');
      
      (createPanelDocuments as any).mockResolvedValue([
        {
          test_run_id: testRunId,
          application_dashboard_id: 'app-dash-001',
          dashboard_uid: 'dash-001',
          panel_id: 1,
          panel_title: 'Panel 1',
          dashboard_label: 'Label',
          benchmark_ids: [],
          panel: {},
          query_variables: {},
          datasource_type: 'prometheus',
          requests: [],
          errors: [],
          warnings: [],
          updated_at: new Date()
        },
        {
          test_run_id: testRunId,
          application_dashboard_id: 'app-dash-001',
          dashboard_uid: 'dash-001',
          panel_id: 2,
          panel_title: 'Panel 2',
          dashboard_label: 'Label',
          benchmark_ids: [],
          panel: {},
          query_variables: {},
          datasource_type: 'prometheus',
          requests: [],
          errors: [],
          warnings: [],
          updated_at: new Date()
        }
      ]);

      await pipeline.execute({ testRunId });

      const panels = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_panels WHERE test_run_id = $1',
        [testRunId]
      );

      expect(parseInt(panels.rows[0].count)).toBe(2);
    });

    test('should handle empty panel documents', async () => {
      const { createPanelDocuments } = await import('../../pipelines/panels/helpers.js');
      (createPanelDocuments as any).mockResolvedValue([]);

      const result = await pipeline.execute({ testRunId });

      expect(result.success).toBe(true);
      expect(result.data.panelDocuments).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid input', async () => {
      const result = await pipeline.execute({ invalid: 'input' } as any);

      expect(result.success).toBe(false);
    });

    test('should handle non-existent test run', async () => {
      const result = await pipeline.execute({ testRunId: 'non-existent' });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('not found');
    });
  });

  describe('Metadata Loading', () => {
    test('should load system under test name', async () => {
      await pipeline.execute({ testRunId });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('System name loaded'));
    });

    test('should load application dashboards', async () => {
      const result = await pipeline.execute({ testRunId });

      expect(result.success).toBe(true);
      expect(result.data.applicationDashboards).toBeGreaterThan(0);
    });

    test('should load grafana dashboards', async () => {
      const result = await pipeline.execute({ testRunId });

      expect(result.success).toBe(true);
      expect(result.data.grafanaDashboards).toBeGreaterThan(0);
    });

    test('should load benchmarks', async () => {
      const result = await pipeline.execute({ testRunId });

      expect(result.success).toBe(true);
      expect(result.data.benchmarks).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    test('should complete within reasonable time', async () => {
      const startTime = Date.now();
      const result = await pipeline.execute({ testRunId });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(10000);
    });

    test('should report performance timing breakdown', async () => {
      await pipeline.execute({ testRunId });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('PERFORMANCE SUMMARY'));
    });
  });
});
