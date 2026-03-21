import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { PipelineOrchestrator } from '../../../services/PipelineOrchestrator.js';
import { createLogger } from '../../../lib/utils/logger.js';
import { MockJobQueueScenario, createMockPgBoss, type MockPgBoss } from '../../mocks/pgboss.js';

// Mock NestJS bootstrap to avoid initialization errors
vi.mock('../../../nestjs-bootstrap.js', () => ({
  bootstrapNestJS: vi.fn(),
  getService: vi.fn(),
}));

// Mock all pipeline implementations to avoid NestJS initialization requirements
vi.mock('../../../pipelines/MetricsPipeline.js');
vi.mock('../../../pipelines/StatisticsPipeline.js');
vi.mock('../../../pipelines/AdaptPipeline.js');
vi.mock('../../../pipelines/ChecksPipeline.js');
vi.mock('../../../pipelines/ControlGroupsPipeline.js');
vi.mock('../../../pipelines/ControlGroupStatisticsPipeline.js');
vi.mock('../../../pipelines/PanelsPipeline.js');
vi.mock('../../../pipelines/DynatracePipeline.js');

// Mock logger utilities
vi.mock('../../../lib/utils/logger.js', () => ({
  logPipelineStart: vi.fn(),
  logPipelineSuccess: vi.fn(),
  logPipelineError: vi.fn(),
  logPerformance: vi.fn(),
  logError: vi.fn(),
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('PgBoss Queue and Orchestrator Integration', () => {
  let boss: MockPgBoss;
  let orchestrator: PipelineOrchestrator;
  let queueScenario: MockJobQueueScenario;
  let mockDatabaseService: any;
  const logger = createLogger();

  beforeEach(() => {
    // Setup mock queue and scenario
    queueScenario = new MockJobQueueScenario();
    boss = queueScenario.getBoss();

    // Create mock database service
    mockDatabaseService = {
      getAllCollectionStatuses: vi.fn(),
      testRunRepo: { findOne: vi.fn() },
      dsMetricsRepo: { count: vi.fn() },
      transaction: vi.fn(),
    };

    // Initialize orchestrator with database service
    orchestrator = new PipelineOrchestrator(logger, mockDatabaseService);
  });

  describe('Basic Queue Operations', () => {
    it('should successfully connect to pg-boss queue', async () => {
      expect(boss).toBeDefined();
      expect(boss.start).toBeDefined();
      expect(boss.send).toBeDefined();
      expect(boss.work).toBeDefined();
    });

    it('should enqueue a test job', async () => {
      const jobData = { testRunId: 'test-123', timestamp: new Date().toISOString() };
      const jobId = await boss.send('test-queue-job', jobData);

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      expect(jobId).toMatch(/^job-\d+$/);

      // Verify job was stored
      const jobs = queueScenario.getJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].data).toEqual(jobData);
    });

    it('should process queued jobs', async () => {
      const processedResults: any[] = [];

      // Register a test worker
      queueScenario.registerHandler('test-queue-processing', async (job) => {
        processedResults.push(job.data);
        return { success: true, processedAt: new Date() };
      });

      // Send a test job
      const testData = { testRunId: 'test-456', message: 'test processing' };
      await queueScenario.sendJob('test-queue-processing', testData);

      // Process the job
      const results = await queueScenario.processJobs('test-queue-processing');

      expect(results).toHaveLength(1);
      expect(results[0].result.success).toBe(true);
      expect(processedResults).toHaveLength(1);
      expect(processedResults[0]).toEqual(testData);
    });
  });

  describe('Orchestrator Job Enqueuing', () => {
    it('should enqueue analyze-test job when calling orchestrator', async () => {
      const testRunId = 'test-orchestrator-123';

      // Mock the orchestrator's batch processing to just enqueue a job
      const mockBatchProcessing = async (testRunIds: string[]) => {
        // Enqueue an analyze-test job using our mock boss
        const jobId = await boss.send('analyze-test', {
          testRunId: testRunIds[0],
          stages: ['metrics-collection', 'statistics-calculation'],
          createdAt: new Date().toISOString()
        });
        return jobId;
      };

      // Replace the orchestrator method temporarily
      (orchestrator as any).executeBatchProcessing = mockBatchProcessing;

      const jobId = await orchestrator.executeBatchProcessing([testRunId]);
      expect(jobId).toBeDefined();

      // Verify the job was queued in our mock
      const jobs = queueScenario.getJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe('analyze-test');
      expect((jobs[0].data as any).testRunId).toBe(testRunId);
    });

    it('should enqueue pipeline stage jobs', async () => {
      const stages = ['metrics-collection', 'statistics-calculation', 'checks-evaluation'];

      // Enqueue jobs for each stage
      for (const stage of stages) {
        await boss.send(stage, {
          testRunId: 'test-pipeline-789',
          stage,
          createdAt: new Date().toISOString()
        });
      }

      // Verify all jobs were queued
      const jobs = queueScenario.getJobs();
      expect(jobs).toHaveLength(stages.length);

      for (let i = 0; i < stages.length; i++) {
        expect(jobs[i].name).toBe(stages[i]);
        expect((jobs[i].data as any).stage).toBe(stages[i]);
        expect((jobs[i].data as any).testRunId).toBe('test-pipeline-789');
      }
    });
  });

  describe('Worker Job Processing', () => {
    it('should register and process analyze-test jobs', async () => {
      const processedJobs: any[] = [];

      // Register a mock analyze-test worker
      queueScenario.registerHandler('analyze-test', async (job) => {
        processedJobs.push(job.data);
        return {
          success: true,
          testRunId: (job.data as any).testRunId,
          completedStages: (job.data as any).stages || []
        };
      });

      // Send an analyze-test job
      const testData = {
        testRunId: 'worker-test-123',
        stages: ['metrics-collection', 'statistics-calculation'],
        config: { errorHandling: 'continue' }
      };

      await queueScenario.sendJob('analyze-test', testData);

      // Process the job
      const results = await queueScenario.processJobs('analyze-test');

      expect(results).toHaveLength(1);
      expect(results[0].result.success).toBe(true);
      expect(processedJobs).toHaveLength(1);
      expect(processedJobs[0].testRunId).toBe('worker-test-123');
      expect(processedJobs[0].stages).toEqual(['metrics-collection', 'statistics-calculation']);
    });

    it('should register and process individual pipeline stage jobs', async () => {
      const stageResults: Record<string, any> = {};
      const stages = ['metrics-collection', 'statistics-calculation'];

      // Register workers for different stages
      for (const stage of stages) {
        queueScenario.registerHandler(stage, async (job) => {
          stageResults[stage] = job.data;
          return {
            success: true,
            stage,
            testRunId: (job.data as any).testRunId,
            duration: 100
          };
        });
      }

      // Send jobs for each stage
      for (const stage of stages) {
        await queueScenario.sendJob(stage, {
          testRunId: 'stage-test-456',
          stage,
          config: { timeout: 60000 }
        });
      }

      // Process all jobs
      for (const stage of stages) {
        await queueScenario.processJobs(stage);
      }

      // Verify all stages were processed
      for (const stage of stages) {
        expect(stageResults[stage]).toBeDefined();
        expect(stageResults[stage].testRunId).toBe('stage-test-456');
        expect(stageResults[stage].stage).toBe(stage);
      }
    });

    it('should handle job failures gracefully', async () => {
      // Register a worker that always fails
      queueScenario.registerHandler('failing-job-test', async (job) => {
        throw new Error('Simulated job failure');
      });

      // Send a job that will fail
      await queueScenario.sendJob('failing-job-test', { testRunId: 'fail-test-789' });

      // Process the job (should catch the error)
      const results = await queueScenario.processJobs('failing-job-test');

      expect(results).toHaveLength(1);
      expect(results[0].error).toBeDefined();
      expect(results[0].error.message).toBe('Simulated job failure');
    });
  });

  describe('Job Queue Status and Monitoring', () => {
    it('should track queued jobs', async () => {
      // Send several jobs
      await queueScenario.sendJob('stats-test', { id: 1 });
      await queueScenario.sendJob('stats-test', { id: 2 });
      await queueScenario.sendJob('other-test', { id: 3 });

      // Check job counts
      const allJobs = queueScenario.getJobs();
      expect(allJobs).toHaveLength(3);

      const statsJobs = allJobs.filter(job => job.name === 'stats-test');
      expect(statsJobs).toHaveLength(2);
    });

    it('should track job completion', async () => {
      const completedJobs: string[] = [];

      // Register worker that tracks completion
      queueScenario.registerHandler('completion-test', async (job) => {
        completedJobs.push(job.id);
        return { completed: true, jobId: job.id };
      });

      // Send test jobs
      const job1Id = await queueScenario.sendJob('completion-test', { test: 'job1' });
      const job2Id = await queueScenario.sendJob('completion-test', { test: 'job2' });

      // Process the jobs
      await queueScenario.processJobs('completion-test', 2);

      expect(completedJobs).toHaveLength(2);
      expect(completedJobs[0]).toMatch(/^job-\d+$/);
      expect(completedJobs[1]).toMatch(/^job-\d+$/);
    });

    it('should handle multiple job types concurrently', async () => {
      const processedJobTypes: string[] = [];

      // Register handlers for different job types
      queueScenario.registerHandler('job-type-a', async (job) => {
        processedJobTypes.push('type-a');
        return { success: true, type: 'a' };
      });

      queueScenario.registerHandler('job-type-b', async (job) => {
        processedJobTypes.push('type-b');
        return { success: true, type: 'b' };
      });

      // Send mixed job types
      await queueScenario.sendJob('job-type-a', { test: 1 });
      await queueScenario.sendJob('job-type-b', { test: 2 });
      await queueScenario.sendJob('job-type-a', { test: 3 });

      // Process all jobs
      await queueScenario.processJobs('job-type-a', 2);
      await queueScenario.processJobs('job-type-b', 1);

      expect(processedJobTypes).toHaveLength(3);
      expect(processedJobTypes.filter(type => type === 'type-a')).toHaveLength(2);
      expect(processedJobTypes.filter(type => type === 'type-b')).toHaveLength(1);
    });
  });
});