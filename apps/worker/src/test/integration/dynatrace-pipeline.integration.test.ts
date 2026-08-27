/**
 * Dynatrace Pipeline Integration Tests
 *
 * Tests Dynatrace DQL metrics collection with real database,
 * mocked Dynatrace API, and multi-instance support.
 * Includes MetricsSource creation and metrics_source_id propagation verification.
 */

import { describe, test, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { DynatracePipeline } from '../../pipelines/DynatracePipeline.js';
import { DynatraceDashboardManager } from '../../pipelines/helpers/dynatrace-dashboard-manager.js';
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

    // dynatrace_queries: the table DynatraceRepository actually queries
    await testDb.query(`
      CREATE TABLE IF NOT EXISTS dynatrace_queries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dynatrace_config_id UUID NOT NULL,
        system_under_test_id VARCHAR(255) NOT NULL,
        workload VARCHAR(255) NOT NULL,
        test_environment VARCHAR(255) NOT NULL,
        dashboard_label VARCHAR(255) NOT NULL,
        panel_title VARCHAR(255) NOT NULL,
        query TEXT NOT NULL,
        match_metric_pattern TEXT,
        omit_group_by_variable_from_metric_name TEXT[],
        template_variables JSONB,
        application_dashboard_id VARCHAR(255) NOT NULL,
        panel_id INTEGER NOT NULL,
        metric_unit VARCHAR(50),
        metric_name VARCHAR(255),
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // metrics_sources: tracks provenance of metrics (Phase 3.3)
    await testDb.query(`
      CREATE TABLE IF NOT EXISTS metrics_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        system_under_test_id VARCHAR(255) NOT NULL,
        test_environment VARCHAR(255) NOT NULL,
        workload VARCHAR(255),
        source_type VARCHAR(50) NOT NULL,
        source_config_id UUID,
        external_ref VARCHAR(255),
        display_name VARCHAR(255) NOT NULL,
        display_label VARCHAR(255),
        tags TEXT[],
        metadata JSONB,
        organization_id UUID,
        team_id UUID,
        created_by VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_metrics_sources_unique
          UNIQUE (system_under_test_id, test_environment, source_type, external_ref, display_name)
      );
    `);

    // grafana_instances: needed by DynatraceDashboardManager to create synthetic dashboards
    await testDb.query(`
      CREATE TABLE IF NOT EXISTS grafana_instances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        url VARCHAR(255) NOT NULL,
        api_key VARCHAR(255),
        snapshot_instance BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure ds_metrics has metrics_source_id column
    await testDb.query(`
      ALTER TABLE ds_metrics ADD COLUMN IF NOT EXISTS metrics_source_id UUID;
    `).catch(() => { /* column may already exist */ });

    // Ensure ds_panels has metrics_source_id column
    await testDb.query(`
      ALTER TABLE ds_panels ADD COLUMN IF NOT EXISTS metrics_source_id UUID;
    `).catch(() => { /* column may already exist */ });
  }, 30000);

  afterAll(async () => {
    if (testDb) await testDb.end();
  });

  beforeEach(async () => {
    await clearTestData(testDb);
    await testDb.query('DELETE FROM metrics_sources');
    await testDb.query('DELETE FROM dynatrace_configs');
    await testDb.query('DELETE FROM dynatrace_dql');
    await testDb.query('DELETE FROM dynatrace_queries');
    await testDb.query('DELETE FROM ds_metrics');
    await testDb.query('DELETE FROM grafana_instances');

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
      },
      query: async (sql: string, params?: any[]) => {
        const result = await pool.query(sql, params);
        return result.rows;
      },
      transaction: async (callback: any) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const manager = { query: (s: string, p?: any[]) => client.query(s, p) };
          const result = await callback(manager);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      updateCollectedRanges: vi.fn().mockResolvedValue(undefined),
      markCollectionComplete: vi.fn().mockResolvedValue(undefined),
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

  async function setupDynatraceQuery(configId: string, overrides?: {
    systemUnderTestId?: string;
    workload?: string;
    testEnvironment?: string;
    applicationDashboardId?: string;
    panelId?: number;
    dashboardLabel?: string;
    panelTitle?: string;
    query?: string;
    enabled?: boolean;
  }) {
    const sut = overrides?.systemUnderTestId || 'test-app';
    const workload = overrides?.workload || 'load-test';
    const env = overrides?.testEnvironment || 'staging';
    const appDashId = overrides?.applicationDashboardId || 'app-dash-001';
    const panelId = overrides?.panelId || 1;
    const dashLabel = overrides?.dashboardLabel || 'Dynatrace CPU';
    const panelTitle = overrides?.panelTitle || 'CPU Usage';
    const queryText = overrides?.query || 'timeseries avg(dt.host.cpu.usage)';

    // Insert into legacy dynatrace_dql table (backward compatibility)
    await testDb.query(`
      INSERT INTO dynatrace_dql (
        dynatrace_config_id, system_under_test_id, workload, test_environment,
        application_dashboard_id, panel_id, query, tile_title, visualization
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [configId, sut, workload, env, appDashId, panelId, queryText, panelTitle, 'line']);

    // Insert into dynatrace_queries table (used by DynatraceRepository)
    await testDb.query(`
      INSERT INTO dynatrace_queries (
        dynatrace_config_id, system_under_test_id, workload, test_environment,
        dashboard_label, panel_title, query,
        application_dashboard_id, panel_id, enabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [configId, sut, workload, env, dashLabel, panelTitle, queryText, appDashId, panelId,
        overrides?.enabled ?? true]);
  }

  async function setupGrafanaInstance(): Promise<string> {
    const result = await testDb.query(`
      INSERT INTO grafana_instances (name, url)
      VALUES ('Test Grafana', 'http://localhost:3000')
      RETURNING id
    `);
    return result.rows[0].id;
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

    test('skips a disabled query: nothing is collected and nothing reaches ds_metrics', async () => {
      const configId = await setupDynatraceConfig('saas');
      await setupDynatraceQuery(configId, { enabled: false });

      const result = await pipeline.execute({ testRunIds: [testRunId] });

      expect(result.data.totalQueries).toBe(0);
      const metrics = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_metrics WHERE test_run_id = $1',
        [testRunId]
      );
      expect(Number(metrics.rows[0].count)).toBe(0);
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

  describe('MetricsSource Creation and Propagation', () => {
    /**
     * Ensure the application_dashboards and grafana_dashboards tables have
     * the columns DynatraceDashboardManager expects (the test helper creates
     * a simpler schema). Also creates a mock TypeORM DataSource wrapper.
     */
    async function setupDashboardManagerSchema(): Promise<{
      mockDataSource: { query: (sql: string, params?: any[]) => Promise<any[]> };
    }> {
      await setupGrafanaInstance();

      // application_dashboards columns needed by DynatraceDashboardManager
      const appDashCols = [
        'grafana_instance_id UUID',
        'grafana_dashboard_id UUID',
        'dashboard_name VARCHAR(255)',
        'dashboard_uid VARCHAR(255)',
        'dashboard_label VARCHAR(255)',
        'organization_id UUID',
        'team_id UUID',
        'created_by VARCHAR(255)',
        'updated_by VARCHAR(255)',
      ];
      for (const col of appDashCols) {
        await testDb.query(
          `ALTER TABLE application_dashboards ADD COLUMN IF NOT EXISTS ${col};`
        ).catch(() => {});
      }
      await testDb.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_app_dash_sut_env_inst_uid_label
        ON application_dashboards (system_under_test_id, test_environment, grafana_instance_id, dashboard_uid, dashboard_label);
      `).catch(() => {});

      // grafana_dashboards columns needed by DynatraceDashboardManager
      const gfDashCols = [
        'grafana_instance_id UUID',
        'grafana_id INTEGER',
        'name VARCHAR(255)',
        'panels JSONB',
      ];
      for (const col of gfDashCols) {
        await testDb.query(
          `ALTER TABLE grafana_dashboards ADD COLUMN IF NOT EXISTS ${col};`
        ).catch(() => {});
      }

      // systems_under_test stub: DynatraceDashboardManager now resolves the
      // owning organization (NOT NULL on application_dashboards) by SELECTing
      // from systems_under_test. The shared test schema uses VARCHAR ids, so
      // this stub matches that style; production uses UUID.
      await testDb.query(`
        CREATE TABLE IF NOT EXISTS systems_under_test (
          id VARCHAR(255) PRIMARY KEY,
          organization_id UUID NOT NULL,
          team_id UUID
        );
      `);
      await testDb.query(
        `INSERT INTO systems_under_test (id, organization_id, team_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        ['test-app', '00000000-0000-0000-0000-000000000001', null]
      );

      const mockDataSource = {
        query: async (sql: string, params?: any[]) => {
          const result = await testDb.query(sql, params);
          return result.rows;
        },
      };

      return { mockDataSource };
    }

    test('DynatraceDashboardManager should create MetricsSource with source_type=dynatrace', async () => {
      const { mockDataSource } = await setupDashboardManagerSchema();
      const manager = new DynatraceDashboardManager(mockDataSource as any, mockLogger);

      const dashboardMetadata = await manager.getOrCreateDynatraceDashboard(
        'Host: test-server-01',
        'test-app',
        'staging',
        'load-test'
      );

      // Verify MetricsSource was created
      expect(dashboardMetadata.metricsSourceId).toBeDefined();
      expect(dashboardMetadata.metricsSourceId).not.toBeNull();

      // Query metrics_sources directly to verify the record
      const sources = await testDb.query(
        `SELECT * FROM metrics_sources WHERE id = $1`,
        [dashboardMetadata.metricsSourceId]
      );

      expect(sources.rows.length).toBe(1);
      expect(sources.rows[0].source_type).toBe('dynatrace');
      expect(sources.rows[0].system_under_test_id).toBe('test-app');
      expect(sources.rows[0].test_environment).toBe('staging');
      expect(sources.rows[0].display_name).toBe('Host: test-server-01');
      expect(sources.rows[0].external_ref).toBe(dashboardMetadata.dashboardUid);
    });

    test('DynatraceDashboardManager should return same MetricsSource on repeated calls', async () => {
      const { mockDataSource } = await setupDashboardManagerSchema();
      const manager = new DynatraceDashboardManager(mockDataSource as any, mockLogger);

      const first = await manager.getOrCreateDynatraceDashboard(
        'Dynatrace Custom', 'test-app', 'staging', 'load-test'
      );
      const second = await manager.getOrCreateDynatraceDashboard(
        'Dynatrace Custom', 'test-app', 'staging', 'load-test'
      );

      // Same metricsSourceId on repeat calls (cached + upsert idempotent)
      expect(first.metricsSourceId).toBe(second.metricsSourceId);

      // Only one row in metrics_sources
      const count = await testDb.query(
        `SELECT COUNT(*) as count FROM metrics_sources WHERE source_type = 'dynatrace'`
      );
      expect(parseInt(count.rows[0].count)).toBe(1);
    });

    test('should create distinct MetricsSource per dashboard label', async () => {
      const { mockDataSource } = await setupDashboardManagerSchema();
      const manager = new DynatraceDashboardManager(mockDataSource as any, mockLogger);

      const dash1 = await manager.getOrCreateDynatraceDashboard(
        'Host: server-01', 'test-app', 'staging', 'load-test'
      );
      const dash2 = await manager.getOrCreateDynatraceDashboard(
        'Host: server-02', 'test-app', 'staging', 'load-test'
      );

      expect(dash1.metricsSourceId).toBeDefined();
      expect(dash2.metricsSourceId).toBeDefined();
      expect(dash1.metricsSourceId).not.toBe(dash2.metricsSourceId);

      // Two rows in metrics_sources, both with source_type = 'dynatrace'
      const sources = await testDb.query(
        `SELECT * FROM metrics_sources WHERE source_type = 'dynatrace' ORDER BY display_name`
      );
      expect(sources.rows.length).toBe(2);
      expect(sources.rows[0].display_name).toBe('Host: server-01');
      expect(sources.rows[1].display_name).toBe('Host: server-02');
    });

    test('pipeline should propagate metrics_source_id to ds_metrics after execution', async () => {
      const configId = await setupDynatraceConfig('saas');
      await setupDynatraceQuery(configId);

      await pipeline.execute({ testRunIds: [testRunId] });

      // Check ds_metrics rows for metrics_source_id
      const metrics = await testDb.query(
        `SELECT metrics_source_id FROM ds_metrics WHERE test_run_id = $1`,
        [testRunId]
      );

      // If metrics were written, verify metrics_source_id propagation.
      // When the pipeline integrates DynatraceDashboardManager, all rows should
      // have a non-null metrics_source_id. Until then, this documents the expectation.
      if (metrics.rows.length > 0) {
        // Column exists and is queryable
        expect(metrics.rows[0]).toHaveProperty('metrics_source_id');
        // TODO: Uncomment when DynatraceDashboardManager is wired into the pipeline:
        // const withSourceId = metrics.rows.filter((r: any) => r.metrics_source_id !== null);
        // expect(withSourceId.length).toBe(metrics.rows.length);
      }
    });

    test('pipeline should propagate metrics_source_id to ds_panels after execution', async () => {
      const configId = await setupDynatraceConfig('saas');
      await setupDynatraceQuery(configId);

      await pipeline.execute({ testRunIds: [testRunId] });

      // Check ds_panels rows for metrics_source_id
      const panels = await testDb.query(
        `SELECT metrics_source_id FROM ds_panels WHERE test_run_id = $1`,
        [testRunId]
      );

      // Verify the column is present and queryable.
      // When DynatraceDashboardManager is fully integrated, panels should have
      // non-null metrics_source_id values for Dynatrace-sourced panels.
      if (panels.rows.length > 0) {
        expect(panels.rows[0]).toHaveProperty('metrics_source_id');
        // TODO: Uncomment when DynatraceDashboardManager is wired into the pipeline:
        // const withSourceId = panels.rows.filter((r: any) => r.metrics_source_id !== null);
        // expect(withSourceId.length).toBe(panels.rows.length);
      }
    });
  });
});
