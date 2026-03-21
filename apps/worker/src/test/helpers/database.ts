/**
 * Database Test Helpers
 *
 * Provides utilities for setting up test databases, creating test data,
 * and managing database state during tests.
 */

import { Pool, PoolClient } from 'pg';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { IMemoryDb, newDb } from 'pg-mem';
import { TestRun, PanelDocument } from '../../types/pipeline.js';

// In-memory database for unit tests
let memDb: IMemoryDb | null = null;

/**
 * Get test database pool configuration from environment variables
 * Uses same DB_* env vars as API and grafana-sync services
 */
export function getTestPoolConfig(maxConnections = 5) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'perfana',
    password: process.env.DB_PASSWORD || 'perfana123',
    database: process.env.DB_NAME || 'perfana_test',
    max: maxConnections,
  };
}

/**
 * Create an in-memory PostgreSQL database for unit tests
 */
export function createInMemoryDatabase(): Pool {
  if (!memDb) {
    memDb = newDb();

    // Create test tables
    memDb.public.none(`
      CREATE TABLE test_runs (
        test_run_id VARCHAR(255) PRIMARY KEY,
        system_under_test_id VARCHAR(255) NOT NULL,
        workload VARCHAR(255) NOT NULL,
        test_environment VARCHAR(255) NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE application_dashboards (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        system_under_test_id VARCHAR(255) NOT NULL,
        test_environment VARCHAR(255),
        workload VARCHAR(255)
      );

      CREATE TABLE grafana_dashboards (
        id VARCHAR(255) PRIMARY KEY,
        uid VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        dashboard JSONB NOT NULL,
        application_dashboard_id VARCHAR(255) NOT NULL
      );

      CREATE TABLE benchmarks (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        system_under_test_id VARCHAR(255) NOT NULL,
        test_environment VARCHAR(255),
        workload VARCHAR(255),
        requirements JSONB
      );

      CREATE TABLE ds_panels (
        id SERIAL PRIMARY KEY,
        test_run_id VARCHAR(255) NOT NULL,
        application_dashboard_id VARCHAR(255) NOT NULL,
        dashboard_uid VARCHAR(255) NOT NULL,
        panel_id INTEGER NOT NULL,
        panel_title VARCHAR(255) NOT NULL,
        dashboard_label VARCHAR(255) NOT NULL,
        benchmark_ids JSONB,
        panel JSONB NOT NULL,
        query_variables JSONB,
        datasource_type VARCHAR(255),
        requests JSONB DEFAULT '[]',
        errors JSONB,
        warnings JSONB,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE ds_panel_metrics (
        id SERIAL PRIMARY KEY,
        test_run_id VARCHAR(255) NOT NULL,
        application_dashboard_id VARCHAR(255) NOT NULL,
        dashboard_uid VARCHAR(255) NOT NULL,
        panel_id INTEGER NOT NULL,
        panel_title VARCHAR(255) NOT NULL,
        dashboard_label VARCHAR(255) NOT NULL,
        benchmark_ids JSONB,
        errors JSONB,
        metric_name VARCHAR(255) NOT NULL,
        time TIMESTAMP NOT NULL,
        timestep INTEGER,
        ramp_up BOOLEAN DEFAULT FALSE,
        value DOUBLE PRECISION NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  return memDb.adapters.createPg().Pool as any;
}

/**
 * Setup a real PostgreSQL test container for integration tests
 */
export async function setupTestDatabase(): Promise<StartedTestContainer> {
  const container = await new GenericContainer('postgres:15-alpine')
    .withEnvironment({
      POSTGRES_DB: 'perfana_test',
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test'
    })
    .withExposedPorts(5432)
    .withWaitStrategy({
      type: 'log',
      message: 'database system is ready to accept connections',
      times: 2
    })
    .start();

  const port = container.getMappedPort(5432);
  const host = container.getHost();

  // Update environment variables (matches API and grafana-sync services)
  process.env.DB_HOST = host;
  process.env.DB_PORT = port.toString();
  process.env.DB_USERNAME = 'test';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_NAME = 'perfana_test';

  // Wait for database to be ready and run migrations
  await initializeTestDatabase();

  return container;
}

/**
 * Initialize test database with schema
 */
async function initializeTestDatabase(): Promise<void> {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    max: 1
  });

  try {
    const client = await pool.connect();

    // Create test schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_runs (
        test_run_id VARCHAR(255) PRIMARY KEY,
        system_under_test_id VARCHAR(255) NOT NULL,
        workload VARCHAR(255) NOT NULL,
        test_environment VARCHAR(255) NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS application_dashboards (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        system_under_test_id VARCHAR(255) NOT NULL,
        test_environment VARCHAR(255),
        workload VARCHAR(255)
      );

      CREATE TABLE IF NOT EXISTS grafana_dashboards (
        id VARCHAR(255) PRIMARY KEY,
        uid VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        dashboard JSONB NOT NULL,
        application_dashboard_id VARCHAR(255) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS benchmarks (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        system_under_test_id VARCHAR(255) NOT NULL,
        test_environment VARCHAR(255),
        workload VARCHAR(255),
        requirements JSONB
      );

      CREATE TABLE IF NOT EXISTS ds_panels (
        id SERIAL PRIMARY KEY,
        test_run_id VARCHAR(255) NOT NULL,
        application_dashboard_id VARCHAR(255) NOT NULL,
        dashboard_uid VARCHAR(255) NOT NULL,
        panel_id INTEGER NOT NULL,
        panel_title VARCHAR(255) NOT NULL,
        dashboard_label VARCHAR(255) NOT NULL,
        benchmark_ids JSONB,
        panel JSONB NOT NULL,
        query_variables JSONB,
        datasource_type VARCHAR(255),
        requests JSONB DEFAULT '[]',
        errors JSONB,
        warnings JSONB,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ds_panel_metrics (
        id SERIAL PRIMARY KEY,
        test_run_id VARCHAR(255) NOT NULL,
        application_dashboard_id VARCHAR(255) NOT NULL,
        dashboard_uid VARCHAR(255) NOT NULL,
        panel_id INTEGER NOT NULL,
        panel_title VARCHAR(255) NOT NULL,
        dashboard_label VARCHAR(255) NOT NULL,
        benchmark_ids JSONB,
        errors JSONB,
        metric_name VARCHAR(255) NOT NULL,
        time TIMESTAMP NOT NULL,
        timestep INTEGER,
        ramp_up BOOLEAN DEFAULT FALSE,
        value DOUBLE PRECISION NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    client.release();
  } finally {
    await pool.end();
  }
}

/**
 * Cleanup test database container
 */
export async function cleanupTestDatabase(container: StartedTestContainer): Promise<void> {
  await container.stop();
}

/**
 * Clear all test data from database
 */
export async function clearTestData(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM ds_panel_metrics');
    await client.query('DELETE FROM ds_panels');
    await client.query('DELETE FROM benchmarks');
    await client.query('DELETE FROM grafana_dashboards');
    await client.query('DELETE FROM application_dashboards');
    await client.query('DELETE FROM test_runs');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Insert test data for a complete test run scenario
 */
export async function createTestScenario(pool: Pool): Promise<{
  testRun: TestRun;
  applicationDashboards: any[];
  grafanaDashboards: any[];
  benchmarks: any[];
}> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create test run
    const testRun: TestRun = {
      test_run_id: 'test-run-001',
      system_under_test_id: 'test-app',
      workload: 'load-test',
      test_environment: 'staging',
      start_time: new Date('2024-01-01T10:00:00Z'),
      end_time: new Date('2024-01-01T11:00:00Z')
    };

    await client.query(`
      INSERT INTO test_runs (test_run_id, system_under_test_id, workload, test_environment, start_time, end_time)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [testRun.test_run_id, testRun.system_under_test_id, testRun.workload, testRun.test_environment, testRun.start_time, testRun.end_time]);

    // Create application dashboards
    const applicationDashboards = [
      {
        id: 'app-dash-001',
        name: 'Application Overview',
        system_under_test_id: 'test-app',
        test_environment: 'staging',
        workload: 'load-test'
      }
    ];

    for (const appDash of applicationDashboards) {
      await client.query(`
        INSERT INTO application_dashboards (id, name, system_under_test_id, test_environment, workload)
        VALUES ($1, $2, $3, $4, $5)
      `, [appDash.id, appDash.name, appDash.system_under_test_id, appDash.test_environment, appDash.workload]);
    }

    // Create grafana dashboards
    const grafanaDashboards = [
      {
        id: 'grafana-dash-001',
        uid: 'abc123',
        title: 'Performance Dashboard',
        application_dashboard_id: 'app-dash-001',
        dashboard: {
          id: 1,
          title: 'Performance Dashboard',
          panels: [
            {
              id: 1,
              title: 'Response Time',
              type: 'graph',
              datasource: { type: 'prometheus', uid: 'prometheus-uid' },
              targets: [
                {
                  expr: 'http_request_duration_seconds{job="test-app"}',
                  refId: 'A'
                }
              ]
            }
          ],
          templating: {
            list: [
              { name: 'instance', type: 'query', query: 'label_values(instance)' }
            ]
          }
        }
      }
    ];

    for (const grafanaDash of grafanaDashboards) {
      await client.query(`
        INSERT INTO grafana_dashboards (id, uid, title, dashboard, application_dashboard_id)
        VALUES ($1, $2, $3, $4, $5)
      `, [grafanaDash.id, grafanaDash.uid, grafanaDash.title, JSON.stringify(grafanaDash.dashboard), grafanaDash.application_dashboard_id]);
    }

    // Create benchmarks
    const benchmarks = [
      {
        id: 'benchmark-001',
        name: 'Performance Baseline',
        system_under_test_id: 'test-app',
        test_environment: 'staging',
        workload: 'load-test',
        requirements: {
          response_time_p95: 500,
          throughput_min: 100
        }
      }
    ];

    for (const benchmark of benchmarks) {
      await client.query(`
        INSERT INTO benchmarks (id, name, system_under_test_id, test_environment, workload, requirements)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [benchmark.id, benchmark.name, benchmark.system_under_test_id, benchmark.test_environment, benchmark.workload, JSON.stringify(benchmark.requirements)]);
    }

    await client.query('COMMIT');

    return {
      testRun,
      applicationDashboards,
      grafanaDashboards,
      benchmarks
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}