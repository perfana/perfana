/**
 * Simple MetricsPipeline Integration Test
 *
 * This test validates basic MetricsPipeline functionality using the real database
 * but with mocked Grafana responses to avoid external dependencies.
 */

import { describe, test, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { MetricsPipeline } from '../../../pipelines/MetricsPipeline.js';
import { getLogger } from '../../../lib/utils/logger.js';

// Mock axios before importing anything that uses it
vi.mock('axios', () => {
  const mockPost = vi.fn().mockImplementation(async (url: string, data: any) => {
    // Mock successful Grafana response
    return {
      status: 200,
      data: {
        results: data.queries.reduce((acc: any, query: any) => {
          acc[query.refId] = {
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
                    [1726650900000, 1726650960000, 1726651020000], // Times
                    [10.5, 12.3, 8.7] // Values
                  ]
                }
              }
            ]
          };
          return acc;
        }, {})
      }
    };
  });

  return {
    default: {
      create: () => ({
        post: mockPost,
        get: vi.fn(),
        defaults: {},
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() }
        }
      })
    }
  };
});

describe('Simple MetricsPipeline Integration Test', () => {
  const TEST_RUN_ID = 'MyAfterburner-acc-loadTest-00002';
  let db: Pool;
  let pipeline: MetricsPipeline;
  let logger: any;

  beforeAll(async () => {
    // Setup database connection with production database
    db = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres',
      max: 5
    });

    // Setup logger
    logger = getLogger('test');

    // Test database connection
    const client = await db.connect();
    await client.query('SELECT 1');
    client.release();
  });

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(() => {
    // Create fresh pipeline instance for each test
    pipeline = new MetricsPipeline(db, logger);
  });

  test('should successfully load test run and panel data', async () => {
    // Test basic data loading without running the full pipeline
    const client = await db.connect();

    try {
      // Verify test run exists
      const testRunResult = await client.query(
        'SELECT test_run_id, start_time, end_time FROM test_runs WHERE test_run_id = $1',
        [TEST_RUN_ID]
      );

      expect(testRunResult.rows).toHaveLength(1);
      expect(testRunResult.rows[0]!.test_run_id).toBe(TEST_RUN_ID);

      // Verify panels exist
      const panelsResult = await client.query(
        'SELECT COUNT(*) as count FROM ds_panels WHERE test_run_id = $1',
        [TEST_RUN_ID]
      );

      const panelCount = parseInt(panelsResult.rows[0]!.count);
      expect(panelCount).toBeGreaterThan(0);
      console.log(`✅ Found ${panelCount} panels for test run ${TEST_RUN_ID}`);

    } finally {
      client.release();
    }
  });

  test('should execute MetricsPipeline with mock data', async () => {
    // This test will only process a few panels to validate the pipeline works
    const input = {
      testRunId: TEST_RUN_ID,
      benchmarksOnly: false
    };

    try {
      const result = await pipeline.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      if (result.success) {
        console.log(`✅ Pipeline executed successfully`);
        console.log(`   Test Run ID: ${result.data.testRunId}`);
        console.log(`   Metrics Collected: ${result.data.metricsCollected}`);
        console.log(`   Panels Processed: ${result.data.panels}`);
        console.log(`   Duration: ${result.duration}ms`);
      }

    } catch (error) {
      console.error('❌ Pipeline execution failed:', error);
      throw error;
    }
  }, 30000); // 30 second timeout
});