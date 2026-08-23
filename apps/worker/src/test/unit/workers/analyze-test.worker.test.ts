import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { analyzeTestWorker, validateTestRun, hasExistingMetrics } from '../../../workers/analyze.js';
import { PipelineOrchestrator } from '../../../services/PipelineOrchestrator.js';
import type { JobResult } from '../../../types/jobs.js';

// Mock the logger functions
vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  })),
  logPipelineStart: vi.fn(),
  logPipelineSuccess: vi.fn(),
  logPipelineError: vi.fn(),
}));

// Mock NestJS bootstrap to avoid initialization errors
vi.mock('../../../nestjs-bootstrap.js', () => ({
  bootstrapNestJS: vi.fn(),
  getService: vi.fn(),
}));

// Mock PipelineOrchestrator
vi.mock('../../../services/PipelineOrchestrator.js');

// Mock DataSanityCheckPipeline
vi.mock('../../../pipelines/DataSanityCheckPipeline.js', () => ({
  DataSanityCheckPipeline: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({ success: true, data: { valid: true, reasons: [] } }),
  })),
}));

// Mock database accessor
vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => ({
    testRunRepo: {
      findOne: vi.fn(),
    },
    dsMetricsRepo: {
      count: vi.fn(),
    },
  })),
}));

// Mock Redis pool
vi.mock('../../../config/redis-pool.js', () => ({
  getRedisPool: vi.fn(() => ({
    acquire: vi.fn().mockResolvedValue({
      // Mock Redis client
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      expire: vi.fn(),
    }),
    release: vi.fn(),
  })),
}));

// Mock JobLockService
vi.mock('../../../services/JobLockService.js', () => ({
  JobLockService: vi.fn().mockImplementation(() => ({
    acquireLock: vi.fn().mockResolvedValue({
      acquired: true,
      lockKey: 'test-lock-key',
    }),
    releaseLock: vi.fn().mockResolvedValue(true),
  })),
}));

// Mock ProgressReporter
vi.mock('../../../services/ProgressReporter.js', () => ({
  ProgressReporter: vi.fn().mockImplementation(() => ({
    updateProgress: vi.fn(),
    reportStageStart: vi.fn(),
    reportStageComplete: vi.fn(),
    reportStageFailed: vi.fn(),
    startStage: vi.fn().mockResolvedValue(undefined),
    completeStage: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('analyzeTestWorker', () => {
  let mockOrchestrator: any;
  let mockDb: any;
  let worker: (job: { data: unknown }) => Promise<JobResult>;

  beforeEach(async () => {
    // Import the mocked getDatabaseService
    const { getDatabaseService } = await import('../../../common/database-accessor.js');

    // Create mock database service with test run data
    mockDb = {
      testRunRepo: {
        findOne: vi.fn().mockResolvedValue({
          testRunId: 'test-run-123',
          systemUnderTestId: 'sut-1',
          testEnvironment: 'production',
          workload: 'load-test',
        }),
      },
      dsMetricsRepo: {
        count: vi.fn().mockResolvedValue(100),
      },
    };

    // Configure getDatabaseService to return our mock
    vi.mocked(getDatabaseService).mockReturnValue(mockDb);

    // Create mock orchestrator instance
    mockOrchestrator = {
      executeSequentialPipeline: vi.fn(),
    };

    // Mock the PipelineOrchestrator constructor
    vi.mocked(PipelineOrchestrator).mockImplementation(() => mockOrchestrator);

    // Create the worker function
    worker = analyzeTestWorker();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy Path Scenarios', () => {
    it('should execute full pipeline with ADAPT enabled', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-123',
        adapt: true,
        benchmarksOnly: false,
      };

      const mockPipelineResult = {
        success: true,
        duration: 45000,
        data: {
          testRunId: 'test-run-123',
          stages: [
            { stage: 'dynatrace-collection', result: { success: true }, duration: 5000 },
            { stage: 'panels-processing', result: { success: true }, duration: 3000 },
            { stage: 'metrics-collection', result: { success: true }, duration: 12000 },
            { stage: 'statistics-calculation', result: { success: true }, duration: 8000 },
            { stage: 'checks-evaluation', result: { success: true }, duration: 4000 },
            { stage: 'control-groups-creation', result: { success: true }, duration: 6000 },
            { stage: 'control-group-statistics', result: { success: true }, duration: 3000 },
            { stage: 'adapt-analysis', result: { success: true }, duration: 4000 },
            { stage: 'data-sanity-check', result: { success: true }, duration: 200 },
          ],
          completedStages: 9,
          failedStages: 0,
        },
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue(mockPipelineResult);

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.message).toContain('completed for test run test-run-123');
      expect(result.data).toMatchObject({
        testRunId: 'test-run-123',
        stages: 11, // 9 base stages (incl. transaction-stats-rollup) + ADAPT + data-sanity-check
        adapt: true,
        benchmarksOnly: false,
      });
      expect(mockOrchestrator.executeSequentialPipeline).toHaveBeenCalledWith(
        'test-run-123',
        expect.objectContaining({
          stages: expect.arrayContaining([
            'dynatrace-collection',
            'panels-processing',
            'performance-test-metrics',
            'metrics-collection',
            'statistics-calculation',
            'checks-evaluation',
            'control-groups-creation',
            'control-group-statistics',
            'adapt-analysis',
          ]),
          errorHandling: 'abort',
          timeoutMs: 600000,
        }),
        expect.any(Object) // ProgressReporter
      );
    });

    it('should execute pipeline without ADAPT when disabled', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-456',
        adapt: false,
        benchmarksOnly: false,
      };

      const mockPipelineResult = {
        success: true,
        duration: 35000,
        data: {
          testRunId: 'test-run-456',
          completedStages: 8,
          failedStages: 0,
        },
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue(mockPipelineResult);

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(mockOrchestrator.executeSequentialPipeline).toHaveBeenCalledWith(
        'test-run-456',
        expect.objectContaining({
          stages: expect.not.arrayContaining(['adapt-analysis']),
          errorHandling: 'abort',
          timeoutMs: 600000,
        }),
        expect.any(Object) // ProgressReporter
      );
      expect(result.data.stages).toBe(10); // 9 base stages (incl. transaction-stats-rollup) + data-sanity-check, without ADAPT
    });

    it('should execute with default options when not provided', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-789',
      };

      const mockPipelineResult = {
        success: true,
        duration: 40000,
        data: {
          completedStages: 8,
          failedStages: 0,
        },
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue(mockPipelineResult);

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.data).toMatchObject({
        testRunId: 'test-run-789',
        adapt: true, // Default value from schema
        benchmarksOnly: false, // Default value from schema
      });
    });

    it('should include pipeline performance data in result', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-perf',
        adapt: true,
      };

      const mockPipelineResult = {
        success: true,
        duration: 50000,
        data: {
          testRunId: 'test-run-perf',
          stages: [],
          completedStages: 8,
          failedStages: 0,
          timings: [
            { stage: 'metrics-collection', duration: 15000 },
            { stage: 'adapt-analysis', duration: 8000 },
          ],
        },
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue(mockPipelineResult);

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.data.duration).toBeDefined();
      expect(result.data.duration).toMatch(/\d+ms/);
      expect(result.data.pipeline).toEqual(mockPipelineResult.data);
    });
  });

  describe('Input Validation', () => {
    it('should return failed status for invalid input', async () => {
      // Arrange
      const invalidDataCases = [
        { adapt: true }, // Missing testRunId
        { testRunId: 123, adapt: true }, // Invalid type
        { testRunId: '', adapt: true }, // Empty string
        { testRunId: 'test-run-1', adapt: 'yes' }, // Invalid adapt type
        null, // Null data
      ];

      // Act & Assert
      for (const invalidData of invalidDataCases) {
        const result = await worker({ data: invalidData });
        expect(result.status).toBe('failed');
        expect(result.message).toContain('failed');
      }
    });
  });

  describe('Pipeline Failure Scenarios', () => {
    it('should handle partial pipeline success', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-fail',
        adapt: true,
      };

      const mockPipelineResult = {
        success: false, // Pipeline failed
        duration: 25000,
        data: {
          testRunId: 'test-run-fail',
          stages: [
            { stage: 'metrics-collection', result: { success: true }, duration: 10000 },
            { stage: 'statistics-calculation', result: { success: false }, duration: 5000 },
          ],
          completedStages: 1,
          failedStages: 1,
        },
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue(mockPipelineResult);

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('partial');
      expect(result.message).toContain('completed with some failures');
    });

    it('should handle pipeline error and return failed status', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-error',
        adapt: true,
      };

      const expectedError = new Error('Database connection timeout');
      mockOrchestrator.executeSequentialPipeline.mockRejectedValue(expectedError);

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('failed');
      expect(result.message).toContain('Analysis failed');
      expect(result.message).toContain('Database connection timeout');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        message: 'Database connection timeout',
        code: 'ANALYZE_TEST_ERROR',
        details: {
          testRunId: 'test-run-error',
        },
      });
    });

    it('should handle non-Error exceptions', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-string-error',
        adapt: true,
      };

      mockOrchestrator.executeSequentialPipeline.mockRejectedValue('String error message');

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('failed');
      expect(result.message).toContain('String error message');
    });

    it('should handle orchestrator timeout', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-timeout',
        adapt: true,
      };

      const timeoutError = new Error('Pipeline execution timed out after 600000ms');
      mockOrchestrator.executeSequentialPipeline.mockRejectedValue(timeoutError);

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('failed');
      expect(result.message).toContain('timed out');
    });
  });

  describe('Stage Configuration', () => {
    it('should include all 10 stages when ADAPT is enabled', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-1',
        adapt: true,
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue({
        success: true,
        duration: 40000,
        data: {},
      });

      // Act
      await worker({ data: jobData });

      // Assert
      const callArgs = mockOrchestrator.executeSequentialPipeline.mock.calls[0];
      // data-sanity-check is deliberately absent: the orchestrator has no case for it (it runs
      // after the pipeline returns), so passing it made every run log "Unknown stage" and finish
      // as 'partial'. It stays in the ProgressReporter's list — see the progress test below.
      expect(callArgs[1].stages).toEqual([
        'dynatrace-collection',
        'panels-processing',
        'performance-test-metrics',
        'transaction-stats-rollup',
        'metrics-collection',
        'statistics-calculation',
        'checks-evaluation',
        'control-groups-creation',
        'control-group-statistics',
        'adapt-analysis',
      ]);
    });

    it('should exclude ADAPT stage when disabled', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-1',
        adapt: false,
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue({
        success: true,
        duration: 35000,
        data: {},
      });

      // Act
      await worker({ data: jobData });

      // Assert
      const callArgs = mockOrchestrator.executeSequentialPipeline.mock.calls[0];
      expect(callArgs[1].stages).toEqual([
        'dynatrace-collection',
        'panels-processing',
        'performance-test-metrics',
        'transaction-stats-rollup',
        'metrics-collection',
        'statistics-calculation',
        'checks-evaluation',
        'control-groups-creation',
        'control-group-statistics',
      ]);
      expect(callArgs[1].stages).not.toContain('adapt-analysis');
      expect(callArgs[1].stages).not.toContain('data-sanity-check');
    });

    it('never hands the orchestrator a stage it cannot run, but still shows it in progress', async () => {
      // Regression: analyze.ts used one array for both the execution plan and the progress list.
      // data-sanity-check has no case in PipelineOrchestrator.executeStage, so it came back
      // success:false with "Unknown stage", and errorHandling:'abort' turned that into
      // overallSuccess=false — every analysis reported 'partial' while all ten real stages passed.
      const { ProgressReporter } = await import('../../../services/ProgressReporter.js');
      mockOrchestrator.executeSequentialPipeline.mockResolvedValue({
        success: true,
        duration: 40000,
        data: {},
      });

      await worker({ data: { testRunId: 'test-run-1', adapt: true } });

      const executionStages: string[] = mockOrchestrator.executeSequentialPipeline.mock.calls[0][1].stages;
      const progressStages: string[] = (ProgressReporter as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][4] as string[];

      // Nothing in the execution plan that the orchestrator cannot dispatch.
      expect(executionStages).not.toContain('data-sanity-check');
      // ...but the user still sees the step.
      expect(progressStages).toContain('data-sanity-check');
      // The progress list is the execution plan plus the sanity check, in that order.
      expect(progressStages).toEqual([...executionStages, 'data-sanity-check']);
    });

    it('should use abort error handling strategy', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-1',
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue({
        success: true,
        duration: 40000,
        data: {},
      });

      // Act
      await worker({ data: jobData });

      // Assert
      const callArgs = mockOrchestrator.executeSequentialPipeline.mock.calls[0];
      expect(callArgs[1].errorHandling).toBe('abort');
    });

    it('should use 10 minute timeout', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-1',
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue({
        success: true,
        duration: 40000,
        data: {},
      });

      // Act
      await worker({ data: jobData });

      // Assert
      const callArgs = mockOrchestrator.executeSequentialPipeline.mock.calls[0];
      expect(callArgs[1].timeoutMs).toBe(600000); // 10 minutes
    });
  });

  describe('Performance Tracking', () => {
    it('should track total execution duration', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-perf',
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue({
        success: true,
        duration: 45000,
        data: {},
      });

      // Act
      const startTime = Date.now();
      const result = await worker({ data: jobData });
      const endTime = Date.now();

      // Assert
      expect(result.data.duration).toBeDefined();
      const durationMs = parseInt(result.data.duration.replace('ms', ''));
      expect(durationMs).toBeGreaterThanOrEqual(0);
      expect(durationMs).toBeLessThanOrEqual(endTime - startTime + 100); // Small buffer for test execution
    });
  });

  describe('Orchestrator Instance Creation', () => {
    it('should create PipelineOrchestrator with logger and database service', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-1',
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue({
        success: true,
        duration: 40000,
        data: {},
      });

      // Act
      await worker({ data: jobData });

      // Assert
      expect(PipelineOrchestrator).toHaveBeenCalledTimes(1);
      expect(PipelineOrchestrator).toHaveBeenCalledWith(
        expect.objectContaining({
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
        }),
        expect.objectContaining({
          testRunRepo: expect.any(Object),
          dsMetricsRepo: expect.any(Object),
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long test run IDs', async () => {
      // Arrange
      const longTestRunId = 'test-run-' + 'x'.repeat(1000);
      const jobData = {
        testRunId: longTestRunId,
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue({
        success: true,
        duration: 40000,
        data: {},
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.data.testRunId).toBe(longTestRunId);
    });

    it('should handle benchmarksOnly flag', async () => {
      // Arrange
      const jobData = {
        testRunId: 'test-run-1',
        benchmarksOnly: true,
      };

      mockOrchestrator.executeSequentialPipeline.mockResolvedValue({
        success: true,
        duration: 20000,
        data: {},
      });

      // Act
      const result = await worker({ data: jobData });

      // Assert
      expect(result.status).toBe('success');
      expect(result.data.benchmarksOnly).toBe(true);
    });
  });
});

// NOTE: validateTestRun and hasExistingMetrics are helper functions that access the database
// These would be better tested as integration tests with a real database connection
// Unit tests for these would require complex mocking of the database-accessor module
