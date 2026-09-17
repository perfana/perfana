import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ChecksPipeline } from '../../../pipelines/ChecksPipeline.js';
import { PipelineResult } from '../../../types/pipeline.js';
import { EntityManager } from 'typeorm';
import { BenchmarkNotFoundError } from '../../../pipelines/checks/BaseCheckService.js';

// Mock dependencies
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
};

// Mock database service
const mockDb = {
  transaction: vi.fn(),
  query: vi.fn(),
  getTestRunByTestRunId: vi.fn(),
};

// Mock realtime publisher
const mockRealtimePublisher = {
  triggerTestRunUpdated: vi.fn(),
};

// Mock EntityManager
let mockManager: any;

vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => mockDb),
}));

vi.mock('../../../common/realtime-accessor.js', () => ({
  getRealtimePublisher: vi.fn(() => mockRealtimePublisher),
}));

vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
  logPerformance: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../../lib/utils/timing.js', () => ({
  createPerformanceTimer: vi.fn(() => ({
    logSummary: vi.fn(),
  })),
}));

// Mock check services
vi.mock('../../../pipelines/checks/BenchmarkMatcher.js', () => ({
  BenchmarkMatcher: vi.fn().mockImplementation(() => ({
    findMatchingBenchmarks: vi.fn(),
  })),
}));

vi.mock('../../../pipelines/checks/DataAggregator.js', () => ({
  DataAggregator: vi.fn().mockImplementation(() => ({
    aggregateMetricsForBenchmark: vi.fn(),
  })),
}));

vi.mock('../../../pipelines/checks/RequirementChecker.js', () => ({
  RequirementChecker: vi.fn().mockImplementation(() => ({
    createCheckResult: vi.fn(),
    saveCheckResult: vi.fn(),
  })),
}));

const mockRollupExecute = vi.fn();
// A plain class, not vi.fn().mockImplementation: the afterEach restoreAllMocks
// would strip the implementation after the first test.
vi.mock('../../../pipelines/TransactionStatsRollupPipeline.js', () => ({
  TransactionStatsRollupPipeline: class {
    execute = mockRollupExecute;
  },
}));

describe('ChecksPipeline', () => {
  let pipeline: ChecksPipeline;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock EntityManager with all necessary methods
    mockManager = {
      query: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ testRunId: 'test-run-1', status: {} }),
      save: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      delete: vi.fn().mockResolvedValue({ affected: 0 }),
    };

    // Setup default transaction behavior
    mockDb.transaction.mockImplementation(async (callback: any) => {
      return await callback(mockManager);
    });

    pipeline = new ChecksPipeline(mockLogger as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateInput', () => {
    it('should validate correct input with testRunIds array', () => {
      // Arrange
      const validInput = {
        testRunIds: ['test-run-1', 'test-run-2'],
      };

      // Act
      const result = pipeline.validateInput(validInput);

      // Assert
      expect(result).toBe(true);
    });

    it('should validate input with optional parameters', () => {
      // Arrange
      const validInput = {
        testRunIds: ['test-run-1'],
        forceReprocess: true,
        snapshotId: 'snapshot-123',
        grafanaInfo: 'grafana info',
        applicationDashboardId: 'dash-123',
        panelId: 42,
        metricName: 'cpu_usage',
      };

      // Act
      const result = pipeline.validateInput(validInput);

      // Assert
      expect(result).toBe(true);
    });

    it('should reject null or undefined input', () => {
      // Act & Assert
      expect(pipeline.validateInput(null)).toBe(false);
      expect(pipeline.validateInput(undefined)).toBe(false);
    });

    it('should reject non-object input', () => {
      // Act & Assert
      expect(pipeline.validateInput('string')).toBe(false);
      expect(pipeline.validateInput(123)).toBe(false);
      expect(pipeline.validateInput(true)).toBe(false);
    });

    it('should reject empty testRunIds array', () => {
      // Arrange
      const invalidInput = {
        testRunIds: [],
      };

      // Act
      const result = pipeline.validateInput(invalidInput);

      // Assert
      expect(result).toBe(false);
    });

    it('should reject testRunIds with non-string elements', () => {
      // Arrange
      const invalidInput = {
        testRunIds: ['test-run-1', 123, 'test-run-3'],
      };

      // Act
      const result = pipeline.validateInput(invalidInput);

      // Assert
      expect(result).toBe(false);
    });

    it('should reject missing testRunIds property', () => {
      // Arrange
      const invalidInput = {
        forceReprocess: true,
      };

      // Act
      const result = pipeline.validateInput(invalidInput);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('execute - Happy Path', () => {
    beforeEach(() => {
      // Mock cleanup stale dashboards
      vi.spyOn(pipeline as any, 'cleanupStaleApplicationDashboards').mockResolvedValue({
        duration: 100,
        totalDeleted: 0,
        deletedByTable: {},
      });

      // Mock runCheckPipeline to return success
      vi.spyOn(pipeline as any, 'runCheckPipeline').mockResolvedValue({
        processed_test_runs: 2,
        processed_benchmarks: 5,
        created_check_results: 5,
        failed_test_runs: [],
        execution_time_seconds: 1.5,
      });
    });

    it('should execute successfully with valid input', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1', 'test-run-2'],
      };

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        processed_test_runs: 2,
        processed_benchmarks: 5,
        created_check_results: 5,
        failed_test_runs: [],
        execution_time_seconds: 1.5,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting check pipeline for 2 test runs')
      );
    });

    it('should execute with metric filter and log appropriately', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
        applicationDashboardId: 'dash-123',
        panelId: 42,
        metricName: 'cpu_usage',
      };

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('with metric filter: metricsSource=undefined, dashboard=dash-123, panel=42, metric=cpu_usage')
      );
    });

    it('should clean up stale application dashboards before processing', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
      };

      const cleanupSpy = vi.spyOn(pipeline as any, 'cleanupStaleApplicationDashboards');

      // Act
      await pipeline.execute(input);

      // Assert
      expect(cleanupSpy).toHaveBeenCalledWith(['check_results']);
    });

    it('should log completion summary', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
      };

      // Act
      await pipeline.execute(input);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/✅ Check pipeline completed successfully/)
      );
    });
  });

  describe('execute - Error Handling', () => {
    it('should return error result for invalid input', async () => {
      // Arrange
      const invalidInput = {
        testRunIds: [],
      };

      // Act
      const result: PipelineResult = await pipeline.execute(invalidInput);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid input');
      expect(result.error?.code).toBe('CHECKS_PIPELINE_FAILED');
    });

    it('should handle pipeline execution errors', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
      };

      const error = new Error('Pipeline execution failed');
      vi.spyOn(pipeline as any, 'cleanupStaleApplicationDashboards').mockRejectedValue(error);

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Pipeline execution failed');
      expect(result.error?.code).toBe('CHECKS_PIPELINE_FAILED');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should log errors with context', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
      };

      vi.spyOn(pipeline as any, 'cleanupStaleApplicationDashboards').mockRejectedValue(
        new Error('DB error')
      );

      // Act
      await pipeline.execute(input);

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('❌ Check pipeline failed')
      );
    });
  });

  describe('processSingleTestRun - Happy Path', () => {
    let mockBenchmarkMatcher: any;
    let mockDataAggregator: any;
    let mockRequirementChecker: any;
    let mockApdexCalculator: any;
    let mockAggregatedEvaluator: any;

    beforeEach(() => {
      mockBenchmarkMatcher = {
        findMatchingBenchmarks: vi.fn(),
      };

      mockDataAggregator = {
        aggregateMetricsForBenchmark: vi.fn(),
      };

      mockRequirementChecker = {
        createCheckResult: vi.fn(),
        saveCheckResult: vi.fn(),
      };

      mockApdexCalculator = {
        calculateApdexScores: vi.fn(),
        saveApdexResults: vi.fn(),
      };

      mockAggregatedEvaluator = {
        evaluate: vi.fn(),
      };

      // Mock update methods
      vi.spyOn(pipeline as any, 'updateTestRunStatus').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'publishRealtimeUpdate').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'markTestRunValid').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'updateConsolidatedResult').mockResolvedValue(undefined);
    });

    it('should process test run with matching benchmarks successfully', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      const mockBenchmarks = [
        { id: 'benchmark-1', requirement_operator: 'gte', requirement_value: 100 },
        { id: 'benchmark-2', requirement_operator: 'lte', requirement_value: 500 },
      ];

      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue(mockBenchmarks);

      mockDataAggregator.aggregateMetricsForBenchmark.mockResolvedValue({
        value: 95,
        data_points: 100,
      });

      mockRequirementChecker.createCheckResult.mockResolvedValue({
        id: 'check-1',
        status: 'PASS',
        meets_requirement: true,
      });

      // Act
      const result = await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
      );

      // Assert
      expect(result.processed_benchmarks).toBe(2);
      expect(result.created_check_results).toBe(2);
      expect(result.failed_benchmarks).toHaveLength(0);
      expect(mockBenchmarkMatcher.findMatchingBenchmarks).toHaveBeenCalledWith(testRun, undefined);
      expect(mockRequirementChecker.saveCheckResult).toHaveBeenCalledTimes(2);
    });

    it('forwards apdex_min_samples from the matched benchmark to the Apdex calculator and stores its result', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
        organization_id: 'org-1',
      };
      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue([
        {
          id: 'apdex-1',
          benchmark_type: 'apdex',
          system_under_test_id: 'sut-1',
          test_environment: 'production',
          workload: 'load-test',
          transaction_name: null,
          apdex_threshold_ms: 500,
          min_apdex_score: 0.8,
          include_failed_requests: false,
          exclude_ramp_up_time: true,
          apdex_min_samples: 25,
        },
      ]);
      mockApdexCalculator.evaluateApdexBenchmark = vi.fn().mockResolvedValue({
        benchmark_id: 'apdex-1',
        test_run_id: 'test-run-1',
        status: 'COMPLETE',
        message: 'ok',
        meets_requirement: true,
        requirement: { min_score: 0.8, threshold_ms: 500 },
        apdex_result: { apdex_score: 0.9, transaction_name: null, satisfied_count: 9, tolerating_count: 0, frustrated_count: 1, total_count: 10, avg_response_time_ms: null },
        transaction_results: [],
      });
      const saveSpy = vi.spyOn(pipeline as any, 'saveApdexCheckResult').mockResolvedValue(undefined);

      // Act
      const result = await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
      );

      // Assert
      expect(result.processed_benchmarks).toBe(1);
      expect(result.created_check_results).toBe(1);
      expect(mockApdexCalculator.evaluateApdexBenchmark).toHaveBeenCalledWith(
        testRun,
        expect.objectContaining({ id: 'apdex-1', apdex_min_samples: 25, min_apdex_score: 0.8 }),
      );
      expect(saveSpy).toHaveBeenCalledWith(
        mockManager,
        testRun,
        expect.objectContaining({ id: 'apdex-1', apdex_min_samples: 25 }),
        expect.objectContaining({ meets_requirement: true }),
      );
    });

    it('should update test run status to COMPLETE when no errors', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue([
        { id: 'benchmark-1', requirement_operator: 'gte' },
      ]);

      mockDataAggregator.aggregateMetricsForBenchmark.mockResolvedValue({
        value: 95,
        data_points: 100,
      });

      mockRequirementChecker.createCheckResult.mockResolvedValue({
        id: 'check-1',
        status: 'PASS',
        meets_requirement: true,
      });

      const updateStatusSpy = vi.spyOn(pipeline as any, 'updateTestRunStatus');

      // Act
      await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
      );

      // Assert
      expect(updateStatusSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(Function),
          findOne: expect.any(Function),
        }),
        'test-run-1',
        {
          evaluatingChecks: 'COMPLETED',
          lastUpdate: expect.any(String),
        }
      );
    });

    it('should update test run status to ERROR when check results have errors', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue([
        { id: 'benchmark-1', requirement_operator: 'gte' },
      ]);

      mockDataAggregator.aggregateMetricsForBenchmark.mockResolvedValue({
        value: 95,
        data_points: 100,
      });

      mockRequirementChecker.createCheckResult.mockResolvedValue({
        id: 'check-1',
        status: 'ERROR',
        meets_requirement: false,
      });

      const updateStatusSpy = vi.spyOn(pipeline as any, 'updateTestRunStatus');
      const markInvalidSpy = vi.spyOn(pipeline as any, 'markTestRunInvalid');

      // Act
      await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
      );

      // Assert
      expect(updateStatusSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(Function),
          findOne: expect.any(Function),
        }),
        'test-run-1',
        {
        evaluatingChecks: 'ERROR',
        lastUpdate: expect.any(String),
      });
      expect(markInvalidSpy).toHaveBeenCalledWith(
        mockManager,
        'test-run-1',
        'evaluatingChecks has ERROR status'
      );
    });

    it('should mark test run as valid when all checks pass', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue([
        { id: 'benchmark-1', requirement_operator: 'gte' },
      ]);

      mockDataAggregator.aggregateMetricsForBenchmark.mockResolvedValue({
        value: 95,
        data_points: 100,
      });

      mockRequirementChecker.createCheckResult.mockResolvedValue({
        id: 'check-1',
        status: 'PASS',
        meets_requirement: true,
      });

      const markValidSpy = vi.spyOn(pipeline as any, 'markTestRunValid');

      // Act
      await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
      );

      // Assert
      expect(markValidSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(Function),
          findOne: expect.any(Function),
        }),
        'test-run-1'
      );
    });

    it('should update consolidated result after processing', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue([
        { id: 'benchmark-1', requirement_operator: 'gte' },
      ]);

      mockDataAggregator.aggregateMetricsForBenchmark.mockResolvedValue({
        value: 95,
        data_points: 100,
      });

      mockRequirementChecker.createCheckResult.mockResolvedValue({
        id: 'check-1',
        status: 'PASS',
        meets_requirement: true,
      });

      const updateConsolidatedSpy = vi.spyOn(pipeline as any, 'updateConsolidatedResult');

      // Act
      await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
      );

      // Assert
      expect(updateConsolidatedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(Function),
          findOne: expect.any(Function),
        }),
        'test-run-1',
        false,
      );
    });

    it('should NOT call publishRealtimeUpdate (publish is done by runCheckPipeline after commit)', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue([
        { id: 'benchmark-1', requirement_operator: 'gte' },
      ]);

      mockDataAggregator.aggregateMetricsForBenchmark.mockResolvedValue({
        value: 95,
        data_points: 100,
      });

      mockRequirementChecker.createCheckResult.mockResolvedValue({
        id: 'check-1',
        status: 'PASS',
        meets_requirement: true,
      });

      const publishSpy = vi.spyOn(pipeline as any, 'publishRealtimeUpdate');

      // Act
      await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
      );

      // Assert: publish is now the caller's responsibility (after withTransaction commits)
      expect(publishSpy).not.toHaveBeenCalled();
    });

    it('should route aggregated benchmark to aggregatedEvaluator and count result', async () => {
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      const aggregatedBenchmark = {
        id: 'agg-benchmark-1',
        benchmark_type: 'aggregated',
        aggregate_metric: 'transaction_response_time',
        aggregate_stat: 'p95',
        requirement_operator: '<=',
        requirement_value: 2000,
        exclude_ramp_up_time: true,
      };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue([aggregatedBenchmark]);
      mockAggregatedEvaluator.evaluate.mockResolvedValue({
        benchmark_id: 'agg-benchmark-1',
        test_run_id: 'test-run-1',
        actual_value: 1500,
        meets_requirement: true,
        status: 'COMPLETE',
        message: 'P95 1500.00ms <= 2000ms: PASS',
      });

      const saveAggSpy = vi.spyOn(pipeline as any, 'saveAggregatedCheckResult').mockResolvedValue(undefined);

      const result = await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
      );

      expect(result.processed_benchmarks).toBe(1);
      expect(result.created_check_results).toBe(1);
      expect(mockAggregatedEvaluator.evaluate).toHaveBeenCalledWith(
        testRun,
        expect.objectContaining({
          id: 'agg-benchmark-1',
          aggregate_metric: 'transaction_response_time',
          aggregate_stat: 'p95',
          requirement_operator: '<=',
          requirement_value: 2000,
        })
      );
      expect(saveAggSpy).toHaveBeenCalledWith(
        mockManager, testRun, aggregatedBenchmark,
        expect.objectContaining({ meets_requirement: true, status: 'COMPLETE' })
      );
      expect(mockRequirementChecker.saveCheckResult).not.toHaveBeenCalled();
    });

    it('should include aggregated ERROR result in check results and mark run invalid', async () => {
      const testRun = { test_run_id: 'test-run-1', system_under_test_id: 'sut-1', test_environment: 'production', workload: 'load-test' };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue([
        { id: 'agg-1', benchmark_type: 'aggregated', aggregate_metric: 'error_percentage', requirement_operator: '<=', requirement_value: 1, exclude_ramp_up_time: false },
      ]);
      mockAggregatedEvaluator.evaluate.mockResolvedValue({
        benchmark_id: 'agg-1', test_run_id: 'test-run-1',
        actual_value: null, meets_requirement: null, status: 'ERROR', message: 'DB error',
      });
      vi.spyOn(pipeline as any, 'saveAggregatedCheckResult').mockResolvedValue(undefined);
      const markInvalidSpy = vi.spyOn(pipeline as any, 'markTestRunInvalid').mockResolvedValue(undefined);

      await (pipeline as any).processSingleTestRun(
        testRun, mockBenchmarkMatcher, mockDataAggregator, mockRequirementChecker,
        mockApdexCalculator, mockAggregatedEvaluator, mockManager
      );

      expect(markInvalidSpy).toHaveBeenCalledWith(mockManager, 'test-run-1', expect.any(String));
    });
  });

  describe('processSingleTestRun - Edge Cases', () => {
    let mockBenchmarkMatcher: any;
    let mockDataAggregator: any;
    let mockRequirementChecker: any;
    let mockApdexCalculator: any;
    let mockAggregatedEvaluator: any;

    beforeEach(() => {
      mockBenchmarkMatcher = {
        findMatchingBenchmarks: vi.fn(),
      };

      mockDataAggregator = {
        aggregateMetricsForBenchmark: vi.fn(),
      };

      mockRequirementChecker = {
        createCheckResult: vi.fn(),
        saveCheckResult: vi.fn(),
      };

      mockApdexCalculator = {
        calculateApdexScores: vi.fn(),
        saveApdexResults: vi.fn(),
      };

      mockAggregatedEvaluator = {
        evaluate: vi.fn(),
      };

      vi.spyOn(pipeline as any, 'updateTestRunStatus').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'publishRealtimeUpdate').mockResolvedValue(undefined);
    });

    it('should handle no matching benchmarks (NOT_CONFIGURED)', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue([]);

      const updateStatusSpy = vi.spyOn(pipeline as any, 'updateTestRunStatus');

      // Act
      const result = await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
      );

      // Assert
      expect(result.processed_benchmarks).toBe(0);
      expect(result.created_check_results).toBe(0);
      expect(updateStatusSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(Function),
          findOne: expect.any(Function),
        }),
        'test-run-1',
        {
        evaluatingChecks: 'NOT_CONFIGURED',
        lastUpdate: expect.any(String),
      });
    });

    it('should handle BenchmarkNotFoundError', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockRejectedValue(
        new BenchmarkNotFoundError('No benchmarks found')
      );

      const updateStatusSpy = vi.spyOn(pipeline as any, 'updateTestRunStatus');

      // Act
      const result = await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
      );

      // Assert
      expect(result.processed_benchmarks).toBe(0);
      expect(updateStatusSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(Function),
          findOne: expect.any(Function),
        }),
        'test-run-1',
        {
        evaluatingChecks: 'NOT_CONFIGURED',
        lastUpdate: expect.any(String),
      });
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle null check result from RequirementChecker', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue([
        { id: 'benchmark-1', requirement_operator: 'gte' },
      ]);

      mockDataAggregator.aggregateMetricsForBenchmark.mockResolvedValue({
        value: 95,
        data_points: 100,
      });

      mockRequirementChecker.createCheckResult.mockResolvedValue(null);

      // Act
      const result = await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
      );

      // Assert
      expect(result.processed_benchmarks).toBe(1);
      expect(result.created_check_results).toBe(0);
      expect(mockRequirementChecker.saveCheckResult).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No check result created')
      );
    });

    it('should continue processing when individual benchmark fails', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue([
        { id: 'benchmark-1', requirement_operator: 'gte' },
        { id: 'benchmark-2', requirement_operator: 'lte' },
      ]);

      mockDataAggregator.aggregateMetricsForBenchmark
        .mockRejectedValueOnce(new Error('Aggregation failed'))
        .mockResolvedValueOnce({ value: 100, data_points: 50 });

      mockRequirementChecker.createCheckResult.mockResolvedValue({
        id: 'check-2',
        status: 'PASS',
        meets_requirement: true,
      });

      vi.spyOn(pipeline as any, 'markTestRunValid').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'updateConsolidatedResult').mockResolvedValue(undefined);

      // Act
      const result = await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
      );

      // Assert
      expect(result.processed_benchmarks).toBe(1);
      expect(result.created_check_results).toBe(1);
      expect(result.failed_benchmarks).toHaveLength(1);
      expect(result.failed_benchmarks[0].benchmarkId).toBe('benchmark-1');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should apply metric filter when provided', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      const metricFilter = {
        applicationDashboardId: 'dash-123',
        panelId: 42,
        metricName: 'cpu_usage',
      };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockResolvedValue([
        { id: 'benchmark-1', requirement_operator: 'gte' },
      ]);

      mockDataAggregator.aggregateMetricsForBenchmark.mockResolvedValue({
        value: 95,
        data_points: 100,
      });

      mockRequirementChecker.createCheckResult.mockResolvedValue({
        id: 'check-1',
        status: 'PASS',
        meets_requirement: true,
      });

      vi.spyOn(pipeline as any, 'markTestRunValid').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'updateConsolidatedResult').mockResolvedValue(undefined);

      // Act
      await (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager,
        undefined,
        undefined,
        metricFilter
      );

      // Assert
      expect(mockBenchmarkMatcher.findMatchingBenchmarks).toHaveBeenCalledWith(
        testRun,
        metricFilter
      );
      expect(mockDataAggregator.aggregateMetricsForBenchmark).toHaveBeenCalledWith(
        testRun,
        expect.anything(),
        'cpu_usage'
      );
    });
  });

  describe('processSingleTestRun - Error Handling', () => {
    let mockBenchmarkMatcher: any;
    let mockDataAggregator: any;
    let mockRequirementChecker: any;
    let mockApdexCalculator: any;
    let mockAggregatedEvaluator: any;

    beforeEach(() => {
      mockBenchmarkMatcher = {
        findMatchingBenchmarks: vi.fn(),
      };

      mockDataAggregator = {
        aggregateMetricsForBenchmark: vi.fn(),
      };

      mockRequirementChecker = {
        createCheckResult: vi.fn(),
        saveCheckResult: vi.fn(),
      };

      mockApdexCalculator = {
        calculateApdexScores: vi.fn(),
        saveApdexResults: vi.fn(),
      };

      mockAggregatedEvaluator = {
        evaluate: vi.fn(),
      };

      vi.spyOn(pipeline as any, 'updateTestRunStatus').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'publishRealtimeUpdate').mockResolvedValue(undefined);
    });

    it('should set status to ERROR and throw on general pipeline error', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      };

      mockBenchmarkMatcher.findMatchingBenchmarks.mockRejectedValue(
        new Error('Database connection lost')
      );

      const updateStatusSpy = vi.spyOn(pipeline as any, 'updateTestRunStatus');

      // Act & Assert
      await expect(
        (pipeline as any).processSingleTestRun(
        testRun,
        mockBenchmarkMatcher,
        mockDataAggregator,
        mockRequirementChecker,
        mockApdexCalculator,
        mockAggregatedEvaluator,
        mockManager
        )
      ).rejects.toThrow('Failed to process test run test-run-1');

      expect(updateStatusSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(Function),
          findOne: expect.any(Function),
        }),
        'test-run-1',
        {
        evaluatingChecks: 'ERROR',
        lastUpdate: expect.any(String),
      });
    });
  });

  describe('ensureTransactionRollup', () => {
    const needsRollup = { has_rollup: false, has_transactions: true };

    it('rolls up when the run has transactions but no test_run_transaction_stats rows', async () => {
      mockDb.query.mockResolvedValue([needsRollup]);
      mockRollupExecute.mockResolvedValue({ success: true, data: {} });

      await (pipeline as any).ensureTransactionRollup('test-run-1');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM test_run_transaction_stats'),
        ['test-run-1'],
      );
      expect(mockRollupExecute).toHaveBeenCalledWith({ testRunId: 'test-run-1' });
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('leaves a populated rollup alone', async () => {
      mockDb.query.mockResolvedValue([{ has_rollup: true, has_transactions: true }]);

      await (pipeline as any).ensureTransactionRollup('test-run-1');

      expect(mockRollupExecute).not.toHaveBeenCalled();
    });

    it('does not roll up a run with no transactions rows (it would wipe the sampler half for nothing)', async () => {
      mockDb.query.mockResolvedValue([{ has_rollup: false, has_transactions: false }]);

      await (pipeline as any).ensureTransactionRollup('test-run-1');

      expect(mockRollupExecute).not.toHaveBeenCalled();
    });

    it('warns when the rollup pipeline skipped the run without writing', async () => {
      mockDb.query.mockResolvedValue([needsRollup]);
      mockRollupExecute.mockResolvedValue({ success: true, data: { testRunId: 'test-run-1', skipped: 'not-completed' } });

      await (pipeline as any).ensureTransactionRollup('test-run-1');

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('skipped (not-completed)'));
    });

    it('is best-effort: a rollup failure only warns', async () => {
      mockDb.query.mockResolvedValue([needsRollup]);
      mockRollupExecute.mockRejectedValue(new Error('boom'));

      await expect((pipeline as any).ensureTransactionRollup('test-run-1')).resolves.toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });

    it('warns and continues when the rollup reports failure instead of throwing', async () => {
      mockDb.query.mockResolvedValue([needsRollup]);
      mockRollupExecute.mockResolvedValueOnce({
        success: false,
        error: { message: 'rollup broke', code: 'TRANSACTION_STATS_ROLLUP_FAILED' },
      });

      await expect((pipeline as any).ensureTransactionRollup('test-run-1')).resolves.toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Transaction rollup for test-run-1 failed; Apdex falls back to raw scans: rollup broke'),
      );

      // A failure result with no error object still warns, with the placeholder message.
      mockLogger.warn.mockClear();
      mockRollupExecute.mockResolvedValueOnce({ success: false });

      await expect((pipeline as any).ensureTransactionRollup('test-run-1')).resolves.toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown error'));
    });

    it('warns and skips the rollup when the probe query itself throws', async () => {
      mockDb.query.mockRejectedValue(new Error('db down'));

      await expect((pipeline as any).ensureTransactionRollup('test-run-1')).resolves.toBe(true);

      expect(mockRollupExecute).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Transaction rollup probe for test-run-1 failed; Apdex falls back to raw scans: db down'),
      );
    });

    it('returns false when nothing was attempted so the caller does not spend its budget', async () => {
      mockDb.query.mockResolvedValue([{ has_rollup: true, has_transactions: true }]);

      await expect((pipeline as any).ensureTransactionRollup('test-run-1')).resolves.toBe(false);
    });

    it('is never attempted on the analyze path (repairRollup unset)', async () => {
      const rollupSpy = vi.spyOn(pipeline as any, 'ensureTransactionRollup').mockResolvedValue(true);
      vi.spyOn(pipeline as any, 'loadTestRunForChecks').mockResolvedValue({ test_run_id: 'test-run-1' });
      vi.spyOn(pipeline as any, 'deleteExistingCheckResults').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'updateTestRunStatus').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'publishRealtimeUpdate').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'processSingleTestRun').mockResolvedValue({ processed_benchmarks: 0, created_check_results: 0, failed_benchmarks: [] });

      await (pipeline as any).runCheckPipeline(['test-run-1', 'test-run-2'], false);

      expect(rollupSpy).not.toHaveBeenCalled();
    });

    it('attempts at most one rollup per job on the re-evaluate path, after the IN_PROGRESS publish and before the check work', async () => {
      vi.spyOn(pipeline as any, 'loadTestRunForChecks').mockResolvedValue({
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      });
      vi.spyOn(pipeline as any, 'deleteExistingCheckResults').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'updateTestRunStatus').mockResolvedValue(undefined);
      const publishSpy = vi.spyOn(pipeline as any, 'publishRealtimeUpdate').mockResolvedValue(undefined);
      const processSpy = vi.spyOn(pipeline as any, 'processSingleTestRun').mockResolvedValue({
        processed_benchmarks: 1,
        created_check_results: 1,
        failed_benchmarks: [],
      });
      // First run: populated (nothing attempted, budget kept). Second: attempted. Third: budget gone.
      const rollupSpy = vi.spyOn(pipeline as any, 'ensureTransactionRollup')
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const result = await (pipeline as any).runCheckPipeline(['test-run-1', 'test-run-2', 'test-run-3'], false, undefined, undefined, undefined, true);

      expect(result.processed_test_runs).toBe(3);
      expect(rollupSpy).toHaveBeenCalledTimes(2);
      expect(rollupSpy).toHaveBeenNthCalledWith(1, 'test-run-1');
      expect(rollupSpy).toHaveBeenNthCalledWith(2, 'test-run-2');

      // Ordering for the first run: IN_PROGRESS publish -> rollup -> check work.
      const firstPublish = publishSpy.mock.invocationCallOrder[0];
      const firstRollup = rollupSpy.mock.invocationCallOrder[0];
      const firstProcess = processSpy.mock.invocationCallOrder[0];
      expect(firstPublish).toBeLessThan(firstRollup);
      expect(firstRollup).toBeLessThan(firstProcess);
    });
  });

  describe('loadTestRunForChecks', () => {
    it('should load test run data successfully', async () => {
      // Arrange
      const mockTestRunData = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
        start_time: new Date('2024-01-01T10:00:00Z'),
        end_time: new Date('2024-01-01T11:00:00Z'),
        ramp_up: 300,
      };

      mockManager.query.mockResolvedValue([mockTestRunData]);

      // Act
      const result = await (pipeline as any).loadTestRunForChecks(mockManager, 'test-run-1');

      // Assert
      expect(result).toEqual(mockTestRunData);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['test-run-1']
      );
    });

    it('should return null when test run not found', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([]);

      // Act
      const result = await (pipeline as any).loadTestRunForChecks(mockManager, 'non-existent');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('deleteExistingCheckResults', () => {
    it('should delete check results without metric filter', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([]);

      // Act
      await (pipeline as any).deleteExistingCheckResults(mockManager, 'test-run-1');

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        'DELETE FROM check_results WHERE test_run_id = $1',
        ['test-run-1']
      );
    });

    it('should delete check results with application dashboard filter', async () => {
      // Arrange
      const metricFilter = {
        applicationDashboardId: 'dash-123',
      };

      mockManager.query.mockResolvedValue([]);

      // Act
      await (pipeline as any).deleteExistingCheckResults(
        mockManager,
        'test-run-1',
        metricFilter
      );

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('application_dashboard_id = $2'),
        ['test-run-1', 'dash-123']
      );
    });

    it('should delete check results with panel ID filter', async () => {
      // Arrange
      const metricFilter = {
        panelId: 42,
      };

      mockManager.query.mockResolvedValue([]);

      // Act
      await (pipeline as any).deleteExistingCheckResults(
        mockManager,
        'test-run-1',
        metricFilter
      );

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('panel_id = $2'),
        ['test-run-1', 42]
      );
    });

    it('should delete check results with both filters', async () => {
      // Arrange
      const metricFilter = {
        applicationDashboardId: 'dash-123',
        panelId: 42,
      };

      mockManager.query.mockResolvedValue([]);

      // Act
      await (pipeline as any).deleteExistingCheckResults(
        mockManager,
        'test-run-1',
        metricFilter
      );

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('application_dashboard_id = $2'),
        ['test-run-1', 'dash-123', 42]
      );
    });
  });

  describe('updateTestRunStatus', () => {
    it('should update single status field', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([]);

      const statusUpdates = {
        evaluatingChecks: 'IN_PROGRESS',
      };

      // Act
      await (pipeline as any).updateTestRunStatus(mockManager, 'test-run-1', statusUpdates);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining("jsonb_set(COALESCE(status, '{}'::jsonb), '{evaluatingChecks}'"),
        ['test-run-1', '"IN_PROGRESS"']
      );
    });

    it('should update multiple status fields', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([]);

      const statusUpdates = {
        evaluatingChecks: 'COMPLETED',
        lastUpdate: '2024-01-01T12:00:00Z',
      };

      // Act
      await (pipeline as any).updateTestRunStatus(mockManager, 'test-run-1', statusUpdates);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('jsonb_set'),
        ['test-run-1', '"COMPLETED"', '"2024-01-01T12:00:00Z"']
      );
    });
  });

  describe('updateConsolidatedResult', () => {
    it('should update consolidated result based on check results', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([]);

      // Act
      await (pipeline as any).updateConsolidatedResult(mockManager, 'test-run-1');

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE test_runs'),
        ['test-run-1']
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('consolidated_result = jsonb_build_object'),
        ['test-run-1']
      );
    });
  });

  describe('markTestRunInvalid', () => {
    it('should mark test run as invalid', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([]);

      // Act
      await (pipeline as any).markTestRunInvalid(mockManager, 'test-run-1', 'Error in checks');

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SET valid = false'),
        ['test-run-1']
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Marked test run test-run-1 as invalid: Error in checks'
      );
    });
  });

  describe('markTestRunValid', () => {
    it('should mark test run as valid', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([]);

      // Act
      await (pipeline as any).markTestRunValid(mockManager, 'test-run-1');

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SET valid = true'),
        ['test-run-1']
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Marked test run test-run-1 as valid (checks completed successfully)'
      );
    });
  });

  describe('publishRealtimeUpdate', () => {
    it('should publish realtime update successfully', async () => {
      // Arrange
      const mockTestRun = {
        testRunId: 'test-run-1',
        status: { evaluatingChecks: 'COMPLETED' },
      };

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);

      // Act
      await (pipeline as any).publishRealtimeUpdate('test-run-1');

      // Assert
      expect(mockRealtimePublisher.triggerTestRunUpdated).toHaveBeenCalledWith(mockTestRun);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Published realtime update')
      );
    });

    it('should handle missing test run gracefully', async () => {
      // Arrange
      mockDb.getTestRunByTestRunId.mockResolvedValue(null);

      // Act
      await (pipeline as any).publishRealtimeUpdate('non-existent');

      // Assert
      expect(mockRealtimePublisher.triggerTestRunUpdated).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Test run not found for realtime update: non-existent'
      );
    });

    it('should handle realtime publisher errors gracefully', async () => {
      // Arrange
      const mockTestRun = {
        testRunId: 'test-run-1',
        status: { evaluatingChecks: 'COMPLETED' },
      };

      mockDb.getTestRunByTestRunId.mockResolvedValue(mockTestRun);
      mockRealtimePublisher.triggerTestRunUpdated.mockRejectedValue(
        new Error('Connection failed')
      );

      // Act (should not throw)
      await expect(
        (pipeline as any).publishRealtimeUpdate('test-run-1')
      ).resolves.not.toThrow();

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('Failed to publish realtime update')
      );
    });
  });

  describe('Integration - runCheckPipeline', () => {
    beforeEach(() => {
      vi.spyOn(pipeline as any, 'loadTestRunForChecks').mockResolvedValue({
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'load-test',
      });

      vi.spyOn(pipeline as any, 'deleteExistingCheckResults').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'updateTestRunStatus').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'publishRealtimeUpdate').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'processSingleTestRun').mockResolvedValue({
        processed_benchmarks: 2,
        created_check_results: 2,
        failed_benchmarks: [],
      });
    });

    it('should process multiple test runs', async () => {
      // Arrange
      const testRunIds = ['test-run-1', 'test-run-2'];

      // Act
      const result = await (pipeline as any).runCheckPipeline(testRunIds, false);

      // Assert
      expect(result.processed_test_runs).toBe(2);
      expect(result.processed_benchmarks).toBe(4);
      expect(result.created_check_results).toBe(4);
      expect(result.failed_test_runs).toHaveLength(0);
    });

    it('should handle test run not found', async () => {
      // Arrange
      vi.spyOn(pipeline as any, 'loadTestRunForChecks').mockResolvedValue(null);

      // Act
      const result = await (pipeline as any).runCheckPipeline(['non-existent'], false);

      // Assert
      expect(result.processed_test_runs).toBe(0);
      // Note: The pipeline doesn't add to failed_test_runs when test run is not found, just logs error
      expect(mockLogger.error).toHaveBeenCalledWith('Test run non-existent not found');
    });

    it('should update status to IN_PROGRESS before processing', async () => {
      // Arrange
      const updateStatusSpy = vi.spyOn(pipeline as any, 'updateTestRunStatus');

      // Act
      await (pipeline as any).runCheckPipeline(['test-run-1'], false);

      // Assert
      expect(updateStatusSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.any(Function),
          findOne: expect.any(Function),
        }),
        'test-run-1',
        {
        evaluatingChecks: 'IN_PROGRESS',
        lastUpdate: expect.any(String),
      });
    });

    it('should continue processing when one test run fails', async () => {
      // Arrange
      const testRunIds = ['test-run-1', 'test-run-2'];

      vi.spyOn(pipeline as any, 'processSingleTestRun')
        .mockRejectedValueOnce(new Error('Processing failed'))
        .mockResolvedValueOnce({
          processed_benchmarks: 2,
          created_check_results: 2,
          failed_benchmarks: [],
        });

      // Act
      const result = await (pipeline as any).runCheckPipeline(testRunIds, false);

      // Assert
      expect(result.processed_test_runs).toBe(1);
      expect(result.failed_test_runs).toHaveLength(1);
      expect(result.failed_test_runs[0].test_run_id).toBe('test-run-1');
    });
  });

  // ─── check_results organization_id (RLS NOT NULL) ──────────────────────────

  describe('check_results organization_id', () => {
    const testRun = {
      test_run_id: 'run-1',
      system_under_test_id: 'sut-1',
      test_environment: 'production',
      workload: 'load-test',
      ramp_up: 30,
      organization_id: 'org-1',
    } as any;

    // guards against column/placeholder/param drift (organization_id is NOT NULL)
    const expectOrgAndNoDrift = (sql: string, params: unknown[]) => {
      expect(sql).toContain('INSERT INTO check_results');
      expect(sql).toContain('organization_id');
      expect(params).toContain('org-1');
      const columns = sql.split('(')[1].split(')')[0].split(',').length;
      const placeholders = (sql.match(/\$\d+/g) as string[]).length;
      expect(columns).toBe(placeholders + 2); // created_at, updated_at use NOW()
      expect(params).toHaveLength(placeholders);
    };

    it('saveApdexCheckResult writes the test run organization_id', async () => {
      // Arrange
      const benchmark = {
        id: 'bench-1',
        transaction_name: 'homepage',
        exclude_ramp_up_time: true,
        include_failed_requests: false,
      } as any;
      const apdexResult = {
        status: 'COMPLETE',
        message: 'ok',
        meets_requirement: true,
        requirement: { min_score: 0.9, threshold_ms: 500 },
        apdex_result: {
          apdex_score: 0.95,
          transaction_name: 'homepage',
          satisfied_count: 9,
          tolerating_count: 1,
          frustrated_count: 0,
          total_count: 10,
          avg_response_time_ms: 120,
        },
      } as any;

      // Act
      await (pipeline as any).saveApdexCheckResult(mockManager, testRun, benchmark, apdexResult);

      // Assert
      expect(mockManager.query).toHaveBeenCalledOnce();
      const [sql, params] = mockManager.query.mock.calls[0];
      expectOrgAndNoDrift(sql, params);
    });

    it('saveApdexCheckResult persists below_min_samples on the single target and min_samples in the requirement', async () => {
      // Arrange — a transaction-level SLO whose transaction had fewer than apdex_min_samples samples
      const benchmark = {
        id: 'bench-1',
        transaction_name: 'rare-tx',
        exclude_ramp_up_time: true,
        include_failed_requests: false,
        apdex_min_samples: 50,
      } as any;
      const apdexResult = {
        status: 'COMPLETE',
        message: 'Apdex not evaluated for rare-tx: 2 samples, minimum 50',
        meets_requirement: null,
        below_min_samples: true,
        requirement: { min_score: 0.9, threshold_ms: 500 },
        apdex_result: {
          apdex_score: 0,
          transaction_name: 'rare-tx',
          satisfied_count: 0,
          tolerating_count: 0,
          frustrated_count: 2,
          total_count: 2,
          avg_response_time_ms: 5000,
        },
      } as any;

      // Act
      await (pipeline as any).saveApdexCheckResult(mockManager, testRun, benchmark, apdexResult);

      // Assert
      const [sql, params] = mockManager.query.mock.calls[0];
      expectOrgAndNoDrift(sql, params);
      const requirement = JSON.parse(params[21]);
      expect(requirement).toEqual({ type: 'apdex', min_score: 0.9, threshold_ms: 500, include_failed_requests: false, min_samples: 50 });
      expect(params[23]).toBeNull(); // meets_requirement column
      const targets = JSON.parse(params[24]);
      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject({ target: 'rare-tx', meets_requirement: null, below_min_samples: true, total_count: 2 });
    });

    it('saveApdexCheckResult persists below_min_samples per transaction for a workload-level SLO', async () => {
      // Arrange — one judged transaction, one below the floor
      const benchmark = {
        id: 'bench-wl',
        transaction_name: null,
        exclude_ramp_up_time: true,
        include_failed_requests: false,
        apdex_min_samples: 50,
      } as any;
      const apdexResult = {
        status: 'COMPLETE',
        message: 'ok',
        meets_requirement: true,
        requirement: { min_score: 0.8, threshold_ms: 500 },
        apdex_result: { apdex_score: 0.9, transaction_name: null, satisfied_count: 90, tolerating_count: 5, frustrated_count: 7, total_count: 102, avg_response_time_ms: null },
        transaction_results: [
          { transaction_name: 'login', scenario_name: 'default', apdex_score: 0.925, threshold_ms: 500, meets_requirement: true, below_min_samples: false, satisfied_count: 90, tolerating_count: 5, frustrated_count: 5, total_count: 100, avg_response_time_ms: 200 },
          { transaction_name: 'rare', scenario_name: 'default', apdex_score: 0, threshold_ms: 500, meets_requirement: null, below_min_samples: true, satisfied_count: 0, tolerating_count: 0, frustrated_count: 2, total_count: 2, avg_response_time_ms: 5000 },
        ],
      } as any;

      // Act
      await (pipeline as any).saveApdexCheckResult(mockManager, testRun, benchmark, apdexResult);

      // Assert
      const [sql, params] = mockManager.query.mock.calls[0];
      expectOrgAndNoDrift(sql, params);
      expect(JSON.parse(params[21]).min_samples).toBe(50);
      const targets = JSON.parse(params[24]);
      expect(targets.map((t: any) => [t.target, t.meets_requirement, t.below_min_samples])).toEqual([
        ['login', true, false],
        ['rare', null, true],
      ]);
    });

    it('saveAggregatedCheckResult writes the test run organization_id', async () => {
      // Arrange
      const benchmark = {
        id: 'bench-2',
        exclude_ramp_up_time: false,
        aggregate_metric: 'error_percentage',
        aggregate_stat: 'mean',
        requirement_operator: '<=',
        requirement_value: 1,
        panel_title: 'Error rate',
      } as any;
      const aggResult = {
        status: 'COMPLETE',
        message: 'ok',
        meets_requirement: true,
        actual_value: 0.4,
      } as any;

      // Act
      await (pipeline as any).saveAggregatedCheckResult(mockManager, testRun, benchmark, aggResult);

      // Assert
      expect(mockManager.query).toHaveBeenCalledOnce();
      const [sql, params] = mockManager.query.mock.calls[0];
      expectOrgAndNoDrift(sql, params);
    });
  });

});
