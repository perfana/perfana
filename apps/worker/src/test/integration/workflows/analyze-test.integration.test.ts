/**
 * Analyze Test Workflow Integration Tests
 *
 * Tests the complete analyze-test workflow including:
 * - Full pipeline orchestration
 * - Database operations with real PostgreSQL
 * - Job queue integration with pg-boss
 * - End-to-end data flow
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import PgBoss from 'pg-boss';
import { PerfanaWorkerApp } from '../../../worker.js';
import { clearTestData, createTestScenario } from '../../helpers/database.js';
import { MockJobQueueScenario } from '../../mocks/pgboss.js';
import { mockGrafanaAPI } from '../../mocks/grafana.js';
import { testRunFixtures } from '../../fixtures/test-data.js';

describe('Analyze Test Workflow Integration', () => {
  let db: Pool;
  let app: PerfanaWorkerApp;
  let jobQueue: MockJobQueueScenario;

  beforeEach(async () => {
    // Use real database connection from environment
    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5
    });

    // Clear test data
    await clearTestData(db);

    // Setup mock job queue
    jobQueue = new MockJobQueueScenario();

    // Mock Grafana API
    const { mockAxios } = mockGrafanaAPI();
    vi.mock('axios', () => ({ default: { create: () => mockAxios } }));

    // Initialize worker app with mocked dependencies
    app = new PerfanaWorkerApp();

    // Replace the real pg-boss with our mock
    (app as any).boss = jobQueue.getBoss();
    (app as any).db = db;
  }, 60000); // Extended timeout for integration setup

  afterEach(async () => {
    if (app) {
      await (app as any).cleanup();
    }
    if (db) {
      await clearTestData(db);
      await db.end();
    }
  });

  describe('Complete Pipeline Execution', () => {
    test('should execute full analyze-test workflow successfully', async () => {
      // Create complete test scenario
      const scenario = await createTestScenario(db);

      // Register mock handlers for all pipeline stages
      await registerAllPipelineHandlers(jobQueue);

      // Submit analyze-test job
      const jobId = await jobQueue.sendJob('analyze-test', {
        testRunId: scenario.testRun.test_run_id,
        options: {
          includeDynatrace: false,
          skipCache: true
        }
      });

      expect(jobId).toBeDefined();

      // Process the analyze-test job
      const analyzeResults = await jobQueue.processJobs('analyze-test', 1);
      expect(analyzeResults).toHaveLength(1);
      expect(analyzeResults[0].result.status).toBe('success');

      // Verify that downstream jobs were created
      const allJobs = jobQueue.getJobs();
      const pipelineJobs = allJobs.filter(job =>
        ['panels-processing', 'metrics-collection', 'statistics-pipeline'].includes(job.name)
      );

      expect(pipelineJobs.length).toBeGreaterThan(0);

      // Process all pipeline jobs
      for (const jobType of ['panels-processing', 'metrics-collection', 'statistics-pipeline']) {
        const jobResults = await jobQueue.processJobs(jobType);
        jobResults.forEach(result => {
          expect(result.result?.status).toBe('success');
        });
      }

      // Verify final database state
      await verifyPipelineResults(db, scenario.testRun.test_run_id);
    }, 120000); // 2 minute timeout for full workflow

    test('should handle pipeline failures gracefully', async () => {
      const scenario = await createTestScenario(db);

      // Register handlers with one failing stage
      await registerAllPipelineHandlers(jobQueue, {
        'metrics-collection': 'error' // Simulate metrics collection failure
      });

      const jobId = await jobQueue.sendJob('analyze-test', {
        testRunId: scenario.testRun.test_run_id
      });

      // Process analyze-test job
      const analyzeResults = await jobQueue.processJobs('analyze-test', 1);
      expect(analyzeResults[0].result.status).toBe('success');

      // Process panels (should succeed)
      const panelsResults = await jobQueue.processJobs('panels-processing');
      panelsResults.forEach(result => {
        expect(result.result?.status).toBe('success');
      });

      // Process metrics (should fail)
      const metricsResults = await jobQueue.processJobs('metrics-collection');
      metricsResults.forEach(result => {
        expect(result.error).toBeDefined();
      });

      // Verify partial completion
      const panelCount = await db.query('SELECT COUNT(*) FROM ds_panels WHERE test_run_id = $1', [scenario.testRun.test_run_id]);
      expect(Number(panelCount.rows[0].count)).toBeGreaterThan(0);

      const metricsCount = await db.query('SELECT COUNT(*) FROM ds_panel_metrics WHERE test_run_id = $1', [scenario.testRun.test_run_id]);
      expect(Number(metricsCount.rows[0].count)).toBe(0); // Should be 0 due to failure
    });

    test('should handle missing test run data', async () => {
      const jobId = await jobQueue.sendJob('analyze-test', {
        testRunId: 'non-existent-test-run'
      });

      await registerAllPipelineHandlers(jobQueue);

      const results = await jobQueue.processJobs('analyze-test', 1);
      expect(results).toHaveLength(1);
      expect(results[0].result.status).toBe('failed');
      expect(results[0].result.message).toContain('not found');
    });
  });

  describe('Pipeline Stage Dependencies', () => {
    test('should execute stages in correct order', async () => {
      const scenario = await createTestScenario(db);
      const executionOrder: string[] = [];

      // Create handlers that track execution order
      const trackingHandlers = {
        'panels-processing': createTrackingHandler('panels-processing', executionOrder),
        'metrics-collection': createTrackingHandler('metrics-collection', executionOrder),
        'statistics-pipeline': createTrackingHandler('statistics-pipeline', executionOrder),
        'adapt-pipeline': createTrackingHandler('adapt-pipeline', executionOrder),
        'checks-evaluation': createTrackingHandler('checks-evaluation', executionOrder)
      };

      // Register tracking handlers
      for (const [jobName, handler] of Object.entries(trackingHandlers)) {
        jobQueue.registerHandler(jobName, handler);
      }

      // Submit analyze-test job
      await jobQueue.sendJob('analyze-test', {
        testRunId: scenario.testRun.test_run_id
      });

      // Process all jobs in sequence
      await jobQueue.processJobs('analyze-test', 1);

      // Process pipeline jobs as they become available
      for (let i = 0; i < 10; i++) { // Max 10 iterations to prevent infinite loop
        let processedAny = false;

        for (const jobType of Object.keys(trackingHandlers)) {
          const results = await jobQueue.processJobs(jobType);
          if (results.length > 0) {
            processedAny = true;
          }
        }

        if (!processedAny) break;

        // Small delay to allow job creation
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Verify execution order
      expect(executionOrder).toContain('panels-processing');
      expect(executionOrder).toContain('metrics-collection');

      // Panels should come before metrics
      const panelsIndex = executionOrder.indexOf('panels-processing');
      const metricsIndex = executionOrder.indexOf('metrics-collection');
      expect(panelsIndex).toBeLessThan(metricsIndex);
    });

    test('should handle concurrent pipeline stages', async () => {
      const scenario = await createTestScenario(db);
      await registerAllPipelineHandlers(jobQueue);

      // Submit multiple jobs concurrently
      const jobPromises = Array(3).fill(null).map(async (_, i) => {
        const testRunId = `concurrent-test-${i}`;

        // Create test data for each run
        const client = await db.connect();
        await client.query(`
          INSERT INTO test_runs (test_run_id, system_under_test_id, workload, test_environment, start_time, end_time)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [testRunId, 'test-app', 'load-test', 'staging', new Date(), new Date()]);
        client.release();

        return jobQueue.sendJob('analyze-test', { testRunId });
      });

      const jobIds = await Promise.all(jobPromises);
      expect(jobIds).toHaveLength(3);

      // Process all jobs concurrently
      const results = await jobQueue.processJobs('analyze-test', 3);
      expect(results).toHaveLength(3);

      // All jobs should complete successfully
      results.forEach(result => {
        expect(result.result?.status).toBe('success');
      });
    });
  });

  describe('Error Recovery and Resilience', () => {
    test('should retry failed pipeline stages', async () => {
      const scenario = await createTestScenario(db);
      let attemptCount = 0;

      // Create a handler that fails twice then succeeds
      const retryHandler = vi.fn().mockImplementation(async (job: any) => {
        attemptCount++;
        if (attemptCount <= 2) {
          throw new Error(`Attempt ${attemptCount} failed`);
        }
        return { status: 'success', message: `Succeeded on attempt ${attemptCount}` };
      });

      jobQueue.registerHandler('metrics-collection', retryHandler);
      await registerAllPipelineHandlers(jobQueue, { 'metrics-collection': 'custom' });

      await jobQueue.sendJob('analyze-test', {
        testRunId: scenario.testRun.test_run_id
      });

      // Process analyze-test and panels
      await jobQueue.processJobs('analyze-test', 1);
      await jobQueue.processJobs('panels-processing');

      // Process metrics with retries
      for (let i = 0; i < 3; i++) {
        await jobQueue.processJobs('metrics-collection');
      }

      expect(attemptCount).toBe(3);
      expect(retryHandler).toHaveBeenCalledTimes(3);
    });

    test('should isolate failures between test runs', async () => {
      // Create two test scenarios
      const scenario1 = await createTestScenario(db);
      const scenario2 = await createTestScenario(db);
      scenario2.testRun.test_run_id = 'test-run-002';

      await registerAllPipelineHandlers(jobQueue, {
        'metrics-collection': 'error' // Simulate failure in metrics
      });

      // Submit jobs for both test runs
      await jobQueue.sendJob('analyze-test', { testRunId: scenario1.testRun.test_run_id });
      await jobQueue.sendJob('analyze-test', { testRunId: scenario2.testRun.test_run_id });

      // Process both workflows
      await jobQueue.processJobs('analyze-test', 2);
      await jobQueue.processJobs('panels-processing');
      await jobQueue.processJobs('metrics-collection');

      // Both should have panels created despite metrics failure
      const panels1 = await db.query('SELECT COUNT(*) FROM ds_panels WHERE test_run_id = $1', [scenario1.testRun.test_run_id]);
      const panels2 = await db.query('SELECT COUNT(*) FROM ds_panels WHERE test_run_id = $1', [scenario2.testRun.test_run_id]);

      expect(Number(panels1.rows[0].count)).toBeGreaterThan(0);
      expect(Number(panels2.rows[0].count)).toBeGreaterThan(0);

      // Neither should have metrics due to failure
      const metrics1 = await db.query('SELECT COUNT(*) FROM ds_panel_metrics WHERE test_run_id = $1', [scenario1.testRun.test_run_id]);
      const metrics2 = await db.query('SELECT COUNT(*) FROM ds_panel_metrics WHERE test_run_id = $1', [scenario2.testRun.test_run_id]);

      expect(Number(metrics1.rows[0].count)).toBe(0);
      expect(Number(metrics2.rows[0].count)).toBe(0);
    });
  });
});

/**
 * Register mock handlers for all pipeline stages
 */
async function registerAllPipelineHandlers(
  jobQueue: MockJobQueueScenario,
  overrides: Record<string, 'success' | 'error' | 'timeout' | 'custom'> = {}
) {
  const defaultHandlers = {
    'analyze-test': createMockAnalyzeTestHandler(),
    'panels-processing': createMockPipelineHandler('panels-processing'),
    'metrics-collection': createMockPipelineHandler('metrics-collection'),
    'statistics-pipeline': createMockPipelineHandler('statistics-pipeline'),
    'control-groups-pipeline': createMockPipelineHandler('control-groups-pipeline'),
    'adapt-pipeline': createMockPipelineHandler('adapt-pipeline'),
    'checks-evaluation': createMockPipelineHandler('checks-evaluation')
  };

  for (const [jobName, handler] of Object.entries(defaultHandlers)) {
    if (overrides[jobName] && overrides[jobName] !== 'custom') {
      // Create specific handler type
      const specificHandler = createMockJobHandler(overrides[jobName] as any);
      jobQueue.registerHandler(jobName, specificHandler);
    } else if (!overrides[jobName]) {
      // Use default handler
      jobQueue.registerHandler(jobName, handler);
    }
    // If override is 'custom', assume handler is already registered externally
  }
}

/**
 * Create mock analyze-test handler that spawns pipeline jobs
 */
function createMockAnalyzeTestHandler() {
  return vi.fn().mockImplementation(async (job: any) => {
    const { testRunId } = job.data;

    // Simulate spawning pipeline jobs
    await jobQueue.sendJob('panels-processing', { testRunId });

    // Add small delay to simulate processing time
    await new Promise(resolve => setTimeout(resolve, 50));

    return {
      status: 'success',
      message: 'Analyze test workflow initiated',
      data: { testRunId, pipelineStages: 1 }
    };
  });
}

/**
 * Create mock pipeline handler for specific stage
 */
function createMockPipelineHandler(stageName: string) {
  return vi.fn().mockImplementation(async (job: any) => {
    const { testRunId } = job.data;

    // Simulate processing time based on stage complexity
    const processingTime = {
      'panels-processing': 100,
      'metrics-collection': 200,
      'statistics-pipeline': 150,
      'control-groups-pipeline': 100,
      'adapt-pipeline': 300,
      'checks-evaluation': 100
    }[stageName] || 100;

    await new Promise(resolve => setTimeout(resolve, processingTime));

    // Spawn next stage jobs based on dependency chain
    if (stageName === 'panels-processing') {
      await jobQueue.sendJob('metrics-collection', { testRunId });
    } else if (stageName === 'metrics-collection') {
      await jobQueue.sendJob('statistics-pipeline', { testRunId });
    } else if (stageName === 'statistics-pipeline') {
      await jobQueue.sendJob('adapt-pipeline', { testRunId });
      await jobQueue.sendJob('checks-evaluation', { testRunId });
    }

    return {
      status: 'success',
      message: `${stageName} completed successfully`,
      data: { testRunId, stage: stageName }
    };
  });
}

/**
 * Create handler that tracks execution order
 */
function createTrackingHandler(stageName: string, executionOrder: string[]) {
  return vi.fn().mockImplementation(async (job: any) => {
    executionOrder.push(stageName);

    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 50));

    return {
      status: 'success',
      message: `${stageName} completed`,
      data: { stage: stageName, executedAt: Date.now() }
    };
  });
}

/**
 * Verify pipeline results in database
 */
async function verifyPipelineResults(db: Pool, testRunId: string) {
  // Verify panels were created
  const panelsResult = await db.query('SELECT COUNT(*) FROM ds_panels WHERE test_run_id = $1', [testRunId]);
  expect(Number(panelsResult.rows[0].count)).toBeGreaterThan(0);

  // Verify basic data structure
  const panelData = await db.query('SELECT * FROM ds_panels WHERE test_run_id = $1 LIMIT 1', [testRunId]);
  expect(panelData.rows).toHaveLength(1);

  const panel = panelData.rows[0];
  expect(panel.test_run_id).toBe(testRunId);
  expect(panel.panel_id).toBeTypeOf('number');
  expect(panel.panel_title).toBeTypeOf('string');
  expect(panel.updated_at).toBeInstanceOf(Date);
}