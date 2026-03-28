/**
 * Metrics Pipeline Integration Tests
 *
 * Tests end-to-end metrics collection with real database connections,
 * Grafana API mocking, and data persistence validation.
 *
 * Coverage:
 * - Complete metrics collection flow (panels → Grafana → database)
 * - Database transaction handling
 * - Batch insert operations
 * - Error handling and recovery
 * - Benchmark vs non-benchmark panel filtering
 * - Data validation and integrity checks
 */

import { describe, test, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { MetricsPipeline } from '../../pipelines/MetricsPipeline.js';
import { Pool } from 'pg';
import { createTestScenario, clearTestData } from '../helpers/database.js';
import { mockGrafanaAPI } from '../mocks/grafana.js';
import type { PanelDocument } from '../../types/pipeline.js';

// Mock Grafana configuration cache
vi.mock('../../config/grafana-config-cache.js', () => ({
  getGrafanaConfig: vi.fn(async () => ({
    url: 'http://localhost:3000',
    token: 'test-token',
    timeout: 30000
  }))
}));

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

describe('MetricsPipeline Integration Tests', () => {
  let pipeline: MetricsPipeline;
  let testDb: Pool;
  let mockLogger: any;
  let testRunId: string;
  let mockAxios: any;

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

    // Create ds_metrics table for testing
    await testDb.query(`
      CREATE TABLE IF NOT EXISTS ds_metrics (
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
        value DOUBLE PRECISION,
        unit VARCHAR(50),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (test_run_id, application_dashboard_id, panel_id, metric_name, time)
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
    await testDb.query('DELETE FROM ds_metrics');

    // Create test scenario
    const scenario = await createTestScenario(testDb);
    testRunId = scenario.testRun.test_run_id;

    // Create panels for testing
    await createTestPanels(testRunId);

    // Create mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Setup Grafana API mock
    const mock = mockGrafanaAPI();
    mockAxios = mock.mockAxios;

    // Mock database service
    const mockDbService = createMockDatabaseService(testDb);
    setTestDatabase(mockDbService);

    // Create pipeline instance
    pipeline = new MetricsPipeline(mockLogger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper function to create test panels
   */
  async function createTestPanels(testRunId: string): Promise<void> {
    const panels = [
      {
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        dashboard_uid: 'abc123',
        panel_id: 1,
        panel_title: 'Response Time',
        dashboard_label: 'Performance',
        benchmark_ids: ['benchmark-001'],
        panel: {
          id: 1,
          title: 'Response Time',
          targets: [{ expr: 'http_request_duration_seconds', refId: 'A' }]
        },
        requests: [
          {
            endpoint: '/api/ds/query',
            method: 'POST',
            request_body: {
              queries: [
                {
                  refId: 'A',
                  expr: 'http_request_duration_seconds{job="test-app"}',
                  datasource: { type: 'prometheus', uid: 'prometheus-uid' }
                }
              ],
              from_: '2024-01-01T10:00:00Z',
              to: '2024-01-01T11:00:00Z'
            }
          }
        ]
      },
      {
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        dashboard_uid: 'abc123',
        panel_id: 2,
        panel_title: 'Throughput',
        dashboard_label: 'Performance',
        benchmark_ids: null,
        panel: {
          id: 2,
          title: 'Throughput',
          targets: [{ expr: 'http_requests_total', refId: 'B' }]
        },
        requests: [
          {
            endpoint: '/api/ds/query',
            method: 'POST',
            request_body: {
              queries: [
                {
                  refId: 'B',
                  expr: 'rate(http_requests_total[1m])',
                  datasource: { type: 'prometheus', uid: 'prometheus-uid' }
                }
              ],
              from_: '2024-01-01T10:00:00Z',
              to: '2024-01-01T11:00:00Z'
            }
          }
        ]
      },
      {
        test_run_id: testRunId,
        application_dashboard_id: 'app-dash-001',
        dashboard_uid: 'abc123',
        panel_id: 3,
        panel_title: 'Error Rate',
        dashboard_label: 'Errors',
        benchmark_ids: ['benchmark-001'],
        panel: {
          id: 3,
          title: 'Error Rate',
          targets: [{ expr: 'http_errors_total', refId: 'C' }]
        },
        requests: [
          {
            endpoint: '/api/ds/query',
            method: 'POST',
            request_body: {
              queries: [
                {
                  refId: 'C',
                  expr: 'rate(http_errors_total[1m])',
                  datasource: { type: 'prometheus', uid: 'prometheus-uid' }
                }
              ],
              from_: '2024-01-01T10:00:00Z',
              to: '2024-01-01T11:00:00Z'
            }
          }
        ]
      }
    ];

    for (const panel of panels) {
      await testDb.query(`
        INSERT INTO ds_panels (
          test_run_id, application_dashboard_id, dashboard_uid, panel_id,
          panel_title, dashboard_label, benchmark_ids, panel, requests
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        panel.test_run_id,
        panel.application_dashboard_id,
        panel.dashboard_uid,
        panel.panel_id,
        panel.panel_title,
        panel.dashboard_label,
        JSON.stringify(panel.benchmark_ids),
        JSON.stringify(panel.panel),
        JSON.stringify(panel.requests)
      ]);
    }
  }

  /**
   * Helper function to create mock database service
   */
  function createMockDatabaseService(pool: Pool) {
    return {
      getTestRunByTestRunId: async (testRunId: string) => {
        const result = await pool.query(
          'SELECT * FROM test_runs WHERE test_run_id = $1',
          [testRunId]
        );
        if (result.rows.length === 0) return null;

        const row = result.rows[0];
        return {
          testRunId: row.test_run_id,
          systemUnderTestId: row.system_under_test_id,
          workload: row.workload,
          testEnvironment: row.test_environment,
          startTime: row.start_time,
          endTime: row.end_time,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      },

      getDsPanelsByTestRun: async (testRunId: string) => {
        const result = await pool.query(
          'SELECT * FROM ds_panels WHERE test_run_id = $1',
          [testRunId]
        );
        return result.rows;
      },

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

  describe('Complete Metrics Collection Flow', () => {
    test('should execute full metrics pipeline successfully', async () => {
      // Setup Grafana mock to return realistic data
      mockAxios.post.mockImplementation(async (url: string, data: any) => {
        await new Promise(resolve => setTimeout(resolve, 50));

        if (url.includes('/api/ds/query')) {
          return {
            status: 200,
            data: {
              results: Object.fromEntries(
                data.queries.map((q: any) => [
                  q.refId,
                  {
                    status: 200,
                    frames: [
                      {
                        schema: {
                          fields: [
                            { name: 'Time', type: 'time' },
                            { name: 'Value', type: 'number' }
                          ]
                        },
                        data: {
                          values: [
                            [1704110400000, 1704110460000, 1704110520000],
                            [0.125, 0.130, 0.128]
                          ]
                        }
                      }
                    ]
                  }
                ])
              )
            }
          };
        }

        return { status: 200, data: {} };
      });

      // Execute pipeline
      const result = await pipeline.execute({ testRunId });

      // Verify success
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.testRunId).toBe(testRunId);
      expect(result.data.metricsCollected).toBeGreaterThan(0);
      expect(result.data.panels).toBe(3);
      expect(result.data.processedPanels).toBe(3);

      // Verify data was written to database
      const metricsResult = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_metrics WHERE test_run_id = $1',
        [testRunId]
      );
      expect(parseInt(metricsResult.rows[0].count)).toBeGreaterThan(0);
    });

    test('should store metrics with correct data structure', async () => {
      mockAxios.post.mockImplementation(async () => ({
        status: 200,
        data: {
          results: {
            'A': {
              status: 200,
              frames: [
                {
                  schema: {
                    fields: [
                      { name: 'Time', type: 'time' },
                      { name: 'Value', type: 'number' }
                    ]
                  },
                  data: {
                    values: [
                      [1704110400000, 1704110460000],
                      [0.125, 0.130]
                    ]
                  }
                }
              ]
            }
          }
        }
      }));

      await pipeline.execute({ testRunId });

      // Verify stored data structure
      const metricsResult = await testDb.query(
        `SELECT * FROM ds_metrics
         WHERE test_run_id = $1
         ORDER BY panel_id, time
         LIMIT 5`,
        [testRunId]
      );

      expect(metricsResult.rows.length).toBeGreaterThan(0);

      const metric = metricsResult.rows[0];
      expect(metric.test_run_id).toBe(testRunId);
      expect(metric.application_dashboard_id).toBe('app-dash-001');
      expect(metric.panel_id).toBeDefined();
      expect(metric.metric_name).toBeDefined();
      expect(metric.time).toBeInstanceOf(Date);
      expect(typeof metric.value).toBe('number');
      expect(metric.created_at).toBeInstanceOf(Date);
      expect(metric.updated_at).toBeInstanceOf(Date);
    });

    test('should handle benchmark panels correctly', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: {
          results: {
            'A': {
              status: 200,
              frames: [
                {
                  schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number' }] },
                  data: { values: [[1704110400000], [0.125]] }
                }
              ]
            }
          }
        }
      });

      await pipeline.execute({ testRunId });

      // Verify benchmark IDs are stored
      const benchmarkMetrics = await testDb.query(
        `SELECT * FROM ds_metrics
         WHERE test_run_id = $1
         AND benchmark_ids IS NOT NULL
         AND jsonb_array_length(benchmark_ids) > 0`,
        [testRunId]
      );

      expect(benchmarkMetrics.rows.length).toBeGreaterThan(0);
      expect(benchmarkMetrics.rows[0].benchmark_ids).toBeDefined();
    });
  });

  describe('Benchmark Filtering', () => {
    test('should filter only benchmark panels when benchmarksOnly is true', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: {
          results: {
            'A': {
              status: 200,
              frames: [
                {
                  schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number' }] },
                  data: { values: [[1704110400000], [0.125]] }
                }
              ]
            }
          }
        }
      });

      const result = await pipeline.execute({
        testRunId,
        benchmarksOnly: true
      });

      expect(result.success).toBe(true);
      expect(result.data.panels).toBe(3); // Total panels
      expect(result.data.processedPanels).toBe(2); // Only 2 have benchmark_ids

      // Verify only benchmark metrics were stored
      const metricsResult = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_metrics WHERE test_run_id = $1',
        [testRunId]
      );

      // Should have metrics only from panels with benchmark_ids
      expect(parseInt(metricsResult.rows[0].count)).toBeGreaterThan(0);
    });

    test('should process all panels when benchmarksOnly is false', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: {
          results: {
            'A': {
              status: 200,
              frames: [
                {
                  schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number' }] },
                  data: { values: [[1704110400000], [0.125]] }
                }
              ]
            }
          }
        }
      });

      const result = await pipeline.execute({
        testRunId,
        benchmarksOnly: false
      });

      expect(result.success).toBe(true);
      expect(result.data.processedPanels).toBe(3); // All panels processed
    });

    test('should return zero processed panels if no benchmark panels exist with benchmarksOnly', async () => {
      // Delete all benchmark_ids
      await testDb.query(
        'UPDATE ds_panels SET benchmark_ids = NULL WHERE test_run_id = $1',
        [testRunId]
      );

      const result = await pipeline.execute({
        testRunId,
        benchmarksOnly: true
      });

      expect(result.success).toBe(true);
      expect(result.data.processedPanels).toBe(0);
      expect(result.data.metricsCollected).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle Grafana API errors gracefully', async () => {
      mockAxios.post.mockRejectedValue(new Error('Grafana connection failed'));

      const result = await pipeline.execute({ testRunId });

      // Pipeline should complete but with no metrics
      expect(result.success).toBe(true);
      expect(result.data.metricsCollected).toBe(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle empty Grafana response', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: {
          results: {
            'A': {
              status: 200,
              frames: []
            }
          }
        }
      });

      const result = await pipeline.execute({ testRunId });

      expect(result.success).toBe(true);
      expect(result.data.metricsCollected).toBe(0);
    });

    test('should handle panels with errors field set', async () => {
      // Add error to one panel
      await testDb.query(
        `UPDATE ds_panels
         SET errors = $1
         WHERE test_run_id = $2 AND panel_id = 1`,
        [JSON.stringify([{ message: 'Panel error', type: 'error' }]), testRunId]
      );

      mockAxios.post.mockResolvedValue({
        status: 200,
        data: {
          results: {
            'B': {
              status: 200,
              frames: [
                {
                  schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number' }] },
                  data: { values: [[1704110400000], [100]] }
                }
              ]
            }
          }
        }
      });

      const result = await pipeline.execute({ testRunId });

      expect(result.success).toBe(true);
      expect(result.data.processedPanels).toBe(2); // Only panels without errors
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('panels with existing errors'));
    });

    test('should handle invalid input gracefully', async () => {
      const result = await pipeline.execute({});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('testRunId is required');
    });

    test('should handle non-existent test run', async () => {
      const result = await pipeline.execute({
        testRunId: 'non-existent-test-run'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('not found');
    });

    test('should handle database connection errors', async () => {
      // Close the database connection temporarily
      await testDb.end();

      const result = await pipeline.execute({ testRunId });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Reconnect for cleanup
      testDb = new Pool({
        connectionString: process.env.DATABASE_URL || 'postgresql://perfana:perfana123@localhost:5432/perfana_test',
        max: 5
      });
    });
  });

  describe('Batch Insert Operations', () => {
    test('should handle large number of metrics with batch inserts', async () => {
      // Generate large response
      const timestamps = Array.from({ length: 1000 }, (_, i) => 1704110400000 + i * 1000);
      const values = Array.from({ length: 1000 }, () => Math.random() * 100);

      mockAxios.post.mockResolvedValue({
        status: 200,
        data: {
          results: {
            'A': {
              status: 200,
              frames: [
                {
                  schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number' }] },
                  data: { values: [timestamps, values] }
                }
              ]
            }
          }
        }
      });

      const result = await pipeline.execute({ testRunId });

      expect(result.success).toBe(true);
      expect(result.data.metricsCollected).toBeGreaterThan(500);

      // Verify all metrics were stored
      const countResult = await testDb.query(
        'SELECT COUNT(*) as count FROM ds_metrics WHERE test_run_id = $1',
        [testRunId]
      );
      expect(parseInt(countResult.rows[0].count)).toBeGreaterThan(500);
    });

    test('should handle UPSERT correctly for duplicate metrics', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: {
          results: {
            'A': {
              status: 200,
              frames: [
                {
                  schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number' }] },
                  data: { values: [[1704110400000], [0.125]] }
                }
              ]
            }
          }
        }
      });

      // Execute twice
      await pipeline.execute({ testRunId });
      await pipeline.execute({ testRunId });

      // Verify no duplicates (UPSERT should prevent them)
      const countResult = await testDb.query(
        `SELECT test_run_id, panel_id, metric_name, time, COUNT(*) as count
         FROM ds_metrics
         WHERE test_run_id = $1
         GROUP BY test_run_id, panel_id, metric_name, time
         HAVING COUNT(*) > 1`,
        [testRunId]
      );

      expect(countResult.rows.length).toBe(0); // No duplicates
    });
  });

  describe('Data Validation', () => {
    test('should validate metric names are stored correctly', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: {
          results: {
            'A': {
              status: 200,
              frames: [
                {
                  schema: {
                    fields: [
                      { name: 'Time', type: 'time' },
                      { name: 'response_time_p95', type: 'number' }
                    ]
                  },
                  data: { values: [[1704110400000], [0.125]] }
                }
              ]
            }
          }
        }
      });

      await pipeline.execute({ testRunId });

      const metricsResult = await testDb.query(
        'SELECT DISTINCT metric_name FROM ds_metrics WHERE test_run_id = $1',
        [testRunId]
      );

      expect(metricsResult.rows.length).toBeGreaterThan(0);
      metricsResult.rows.forEach(row => {
        expect(row.metric_name).toBeTruthy();
        expect(typeof row.metric_name).toBe('string');
      });
    });

    test('should validate timestamps are within test run time range', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: {
          results: {
            'A': {
              status: 200,
              frames: [
                {
                  schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number' }] },
                  data: { values: [[1704110400000], [0.125]] }
                }
              ]
            }
          }
        }
      });

      await pipeline.execute({ testRunId });

      const testRun = await testDb.query(
        'SELECT start_time, end_time FROM test_runs WHERE test_run_id = $1',
        [testRunId]
      );

      const metricsResult = await testDb.query(
        'SELECT time FROM ds_metrics WHERE test_run_id = $1',
        [testRunId]
      );

      const startTime = new Date(testRun.rows[0].start_time);
      const endTime = new Date(testRun.rows[0].end_time);

      metricsResult.rows.forEach(row => {
        const metricTime = new Date(row.time);
        // Allow some tolerance for time range
        expect(metricTime.getTime()).toBeGreaterThanOrEqual(startTime.getTime() - 3600000);
        expect(metricTime.getTime()).toBeLessThanOrEqual(endTime.getTime() + 3600000);
      });
    });

    test('should validate numeric values are stored correctly', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: {
          results: {
            'A': {
              status: 200,
              frames: [
                {
                  schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number' }] },
                  data: { values: [[1704110400000, 1704110460000], [123.45, 678.90]] }
                }
              ]
            }
          }
        }
      });

      await pipeline.execute({ testRunId });

      const metricsResult = await testDb.query(
        'SELECT value FROM ds_metrics WHERE test_run_id = $1 AND value IS NOT NULL',
        [testRunId]
      );

      expect(metricsResult.rows.length).toBeGreaterThan(0);
      metricsResult.rows.forEach(row => {
        expect(typeof row.value).toBe('number');
        expect(Number.isFinite(row.value)).toBe(true);
      });
    });
  });

  describe('Performance and Timing', () => {
    test('should complete within reasonable time for small dataset', async () => {
      mockAxios.post.mockResolvedValue({
        status: 200,
        data: {
          results: {
            'A': {
              status: 200,
              frames: [
                {
                  schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number' }] },
                  data: { values: [[1704110400000], [0.125]] }
                }
              ]
            }
          }
        }
      });

      const startTime = Date.now();
      const result = await pipeline.execute({ testRunId });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    test('should report accurate execution duration', async () => {
      mockAxios.post.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          status: 200,
          data: {
            results: {
              'A': {
                status: 200,
                frames: [
                  {
                    schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number' }] },
                    data: { values: [[1704110400000], [0.125]] }
                  }
                ]
              }
            }
          }
        };
      });

      const result = await pipeline.execute({ testRunId });

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThan(50);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('completed'));
    });
  });
});
