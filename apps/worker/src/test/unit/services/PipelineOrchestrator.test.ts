import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PipelineOrchestrator } from '../../../services/PipelineOrchestrator.js';
import { MetricsPipeline } from '../../../pipelines/MetricsPipeline.js';
import { StatisticsPipeline } from '../../../pipelines/StatisticsPipeline.js';
import { AdaptPipeline } from '../../../pipelines/AdaptPipeline.js';
import { ChecksPipeline } from '../../../pipelines/ChecksPipeline.js';
import { ControlGroupsPipeline } from '../../../pipelines/ControlGroupsPipeline.js';
import { ControlGroupStatisticsPipeline } from '../../../pipelines/ControlGroupStatisticsPipeline.js';
import { PanelsPipeline } from '../../../pipelines/PanelsPipeline.js';
import { DynatracePipeline } from '../../../pipelines/DynatracePipeline.js';
import { PerformanceTestMetricsPipeline } from '../../../pipelines/PerformanceTestMetricsPipeline.js';
import { IncrementalMetricsPipeline } from '../../../pipelines/IncrementalMetricsPipeline.js';
import { MetricCollectionGapService } from '../../../services/MetricCollectionGapService.js';
import type { PipelineResult } from '../../../types/pipeline.js';

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

// Mock NestJS bootstrap to avoid initialization errors
vi.mock('../../../nestjs-bootstrap.js', () => ({
  bootstrapNestJS: vi.fn(),
  getService: vi.fn(),
}));

// Mock all pipeline implementations
vi.mock('../../../pipelines/MetricsPipeline.js');
vi.mock('../../../pipelines/StatisticsPipeline.js');
vi.mock('../../../pipelines/AdaptPipeline.js');
vi.mock('../../../pipelines/ChecksPipeline.js');
vi.mock('../../../pipelines/ControlGroupsPipeline.js');
vi.mock('../../../pipelines/ControlGroupStatisticsPipeline.js');
vi.mock('../../../pipelines/PanelsPipeline.js');
vi.mock('../../../pipelines/DynatracePipeline.js');
vi.mock('../../../pipelines/PerformanceTestMetricsPipeline.js');
vi.mock('../../../pipelines/IncrementalMetricsPipeline.js');
vi.mock('../../../services/MetricCollectionGapService.js');

describe('PipelineOrchestrator', () => {
  let orchestrator: PipelineOrchestrator;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    trace: ReturnType<typeof vi.fn>;
  };
  let mockDatabaseService: {
    getAllCollectionStatuses: ReturnType<typeof vi.fn>;
    getTestRunByTestRunId: ReturnType<typeof vi.fn>;
    updateTestRunByTestRunId: ReturnType<typeof vi.fn>;
    updateCollectedRanges: ReturnType<typeof vi.fn>;
    removeCollectionStatus: ReturnType<typeof vi.fn>;
    markCollectionComplete: ReturnType<typeof vi.fn>;
    testRunRepo: { findOne: ReturnType<typeof vi.fn> };
    dsMetricsRepo: { count: ReturnType<typeof vi.fn> };
    transaction: ReturnType<typeof vi.fn>;
    applicationDashboardRepo: { find: ReturnType<typeof vi.fn> };
    dataSource: { query: ReturnType<typeof vi.fn> };
  };
  let mockGapService: {
    isCollectionComplete: ReturnType<typeof vi.fn>;
    detectGaps: ReturnType<typeof vi.fn>;
    markSourceComplete: ReturnType<typeof vi.fn>;
    getCollectionSummary: ReturnType<typeof vi.fn>;
  };
  let mockPipelines: {
    metrics: { execute: ReturnType<typeof vi.fn> };
    statistics: { execute: ReturnType<typeof vi.fn> };
    adapt: { execute: ReturnType<typeof vi.fn> };
    checks: { execute: ReturnType<typeof vi.fn> };
    controlGroups: { execute: ReturnType<typeof vi.fn> };
    controlGroupStatistics: { execute: ReturnType<typeof vi.fn> };
    panels: { execute: ReturnType<typeof vi.fn> };
    dynatrace: { execute: ReturnType<typeof vi.fn> };
    performanceTestMetrics: { execute: ReturnType<typeof vi.fn> };
    incrementalMetrics: { execute: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    // Create mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    };

    // Create mock database service
    mockDatabaseService = {
      getAllCollectionStatuses: vi.fn().mockResolvedValue([]),
      getTestRunByTestRunId: vi.fn().mockResolvedValue(null),
      updateTestRunByTestRunId: vi.fn().mockResolvedValue(undefined),
      updateCollectedRanges: vi.fn().mockResolvedValue(undefined),
      removeCollectionStatus: vi.fn().mockResolvedValue(undefined),
      markCollectionComplete: vi.fn().mockResolvedValue(undefined),
      testRunRepo: { findOne: vi.fn() },
      dsMetricsRepo: { count: vi.fn() },
      transaction: vi.fn(),
      applicationDashboardRepo: { find: vi.fn().mockResolvedValue([]) },
      dataSource: { query: vi.fn().mockResolvedValue([]) },
    };

    // Create mock gap service
    mockGapService = {
      isCollectionComplete: vi.fn().mockResolvedValue(false),
      detectGaps: vi.fn().mockResolvedValue([]),
      markSourceComplete: vi.fn().mockResolvedValue(undefined),
      getCollectionSummary: vi.fn().mockResolvedValue({
        completeSources: 0,
        totalSources: 1,
        coverage: 50,
      }),
    };

    // Create mock pipeline instances
    mockPipelines = {
      metrics: { execute: vi.fn() },
      statistics: { execute: vi.fn() },
      adapt: { execute: vi.fn() },
      checks: { execute: vi.fn() },
      controlGroups: { execute: vi.fn() },
      controlGroupStatistics: { execute: vi.fn() },
      panels: { execute: vi.fn() },
      dynatrace: { execute: vi.fn() },
      performanceTestMetrics: { execute: vi.fn() },
      incrementalMetrics: { execute: vi.fn() },
    };

    // Mock pipeline constructors
    vi.mocked(MetricsPipeline).mockImplementation(() => mockPipelines.metrics as unknown as MetricsPipeline);
    vi.mocked(StatisticsPipeline).mockImplementation(() => mockPipelines.statistics as unknown as StatisticsPipeline);
    vi.mocked(AdaptPipeline).mockImplementation(() => mockPipelines.adapt as unknown as AdaptPipeline);
    vi.mocked(ChecksPipeline).mockImplementation(() => mockPipelines.checks as unknown as ChecksPipeline);
    vi.mocked(ControlGroupsPipeline).mockImplementation(() => mockPipelines.controlGroups as unknown as ControlGroupsPipeline);
    vi.mocked(ControlGroupStatisticsPipeline).mockImplementation(
      () => mockPipelines.controlGroupStatistics as unknown as ControlGroupStatisticsPipeline
    );
    vi.mocked(PanelsPipeline).mockImplementation(() => mockPipelines.panels as unknown as PanelsPipeline);
    vi.mocked(DynatracePipeline).mockImplementation(() => mockPipelines.dynatrace as unknown as DynatracePipeline);
    vi.mocked(PerformanceTestMetricsPipeline).mockImplementation(
      () => mockPipelines.performanceTestMetrics as unknown as PerformanceTestMetricsPipeline
    );
    vi.mocked(IncrementalMetricsPipeline).mockImplementation(
      () => mockPipelines.incrementalMetrics as unknown as IncrementalMetricsPipeline
    );
    vi.mocked(MetricCollectionGapService).mockImplementation(
      () => mockGapService as unknown as MetricCollectionGapService
    );

    // Create orchestrator instance with database service and explicit gap service
    orchestrator = new PipelineOrchestrator(
      mockLogger,
      mockDatabaseService as never,
      mockGapService as unknown as MetricCollectionGapService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Pipeline Instance Creation
  // ---------------------------------------------------------------------------

  describe('Pipeline Instance Creation', () => {
    it('should initialize all pipeline instances with logger', () => {
      expect(MetricsPipeline).toHaveBeenCalledWith(mockLogger);
      expect(StatisticsPipeline).toHaveBeenCalledWith(mockLogger);
      expect(AdaptPipeline).toHaveBeenCalledWith(mockLogger);
      expect(ChecksPipeline).toHaveBeenCalledWith(mockLogger);
      expect(ControlGroupsPipeline).toHaveBeenCalledWith(mockLogger);
      expect(ControlGroupStatisticsPipeline).toHaveBeenCalledWith(mockLogger);
      expect(PanelsPipeline).toHaveBeenCalledWith(mockLogger);
      expect(DynatracePipeline).toHaveBeenCalledWith(mockLogger);
      expect(PerformanceTestMetricsPipeline).toHaveBeenCalledWith(mockLogger);
      expect(IncrementalMetricsPipeline).toHaveBeenCalledWith(mockLogger);
    });

    it('should create a default MetricCollectionGapService when none provided', () => {
      // Create without explicit gap service — should construct one from databaseService
      const orchWithDefaultGap = new PipelineOrchestrator(
        mockLogger,
        mockDatabaseService as never
      );
      // If constructed without error the default was created
      expect(orchWithDefaultGap).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // executeSequentialPipeline - Happy Path
  // ---------------------------------------------------------------------------

  describe('executeSequentialPipeline - Happy Path', () => {
    it('should execute all stages successfully in sequence', async () => {
      // Arrange
      const testRunId = 'test-run-123';
      const stages = ['metrics-collection', 'statistics-calculation', 'adapt-analysis'];

      mockPipelines.metrics.execute.mockResolvedValue({
        success: true,
        duration: 5000,
        stage: 'metrics-collection',
      });
      mockPipelines.statistics.execute.mockResolvedValue({
        success: true,
        duration: 3000,
        stage: 'statistics-calculation',
      });
      mockPipelines.adapt.execute.mockResolvedValue({
        success: true,
        duration: 4000,
        stage: 'adapt-analysis',
      });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.completedStages).toBe(3);
      expect(result.data.failedStages).toBe(0);
      expect(mockPipelines.metrics.execute).toHaveBeenCalledWith({ testRunId });
      expect(mockPipelines.statistics.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
      expect(mockPipelines.adapt.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
    });

    it('should execute stages with correct input format', async () => {
      // Arrange
      const testRunId = 'test-run-456';
      const stages = ['panels-processing', 'dynatrace-collection'];

      mockPipelines.panels.execute.mockResolvedValue({ success: true, duration: 2000 });
      mockPipelines.dynatrace.execute.mockResolvedValue({ success: true, duration: 6000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert - panels uses single input, dynatrace uses batch input
      expect(mockPipelines.panels.execute).toHaveBeenCalledWith({ testRunId });
      expect(mockPipelines.dynatrace.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
    });

    it('should track stage durations and percentages', async () => {
      // Arrange
      const testRunId = 'test-run-789';
      const stages = ['metrics-collection', 'statistics-calculation'];

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 10000 });
      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 5000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert
      expect(result.data.timings).toHaveLength(2);
      expect(result.data.timings).toEqual([
        { stage: 'metrics-collection', duration: expect.any(Number) },
        { stage: 'statistics-calculation', duration: expect.any(Number) },
      ]);
    });

    it('should return overall duration', async () => {
      // Arrange
      const testRunId = 'test-run-perf';
      const stages = ['metrics-collection'];

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const startTime = Date.now();
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });
      const endTime = Date.now();

      // Assert
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBeLessThanOrEqual(endTime - startTime + 100);
    });

    it('should not include collectionWarnings in result data when none occurred', async () => {
      // Arrange
      const testRunId = 'test-no-warnings';
      const stages = ['statistics-calculation'];

      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert — no collectionWarnings key when array is empty
      expect(result.data.collectionWarnings).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // executeSequentialPipeline - Error Handling
  // ---------------------------------------------------------------------------

  describe('executeSequentialPipeline - Error Handling', () => {
    it('should handle stage failure with "continue" strategy', async () => {
      // Arrange
      const testRunId = 'test-run-fail';
      const stages = ['metrics-collection', 'statistics-calculation', 'adapt-analysis'];

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 5000 });
      mockPipelines.statistics.execute.mockResolvedValue({
        success: false,
        duration: 3000,
        error: { message: 'Statistics calculation failed', code: 'STATS_ERROR' },
      });
      mockPipelines.adapt.execute.mockResolvedValue({ success: true, duration: 4000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.data.completedStages).toBe(2);
      expect(result.data.failedStages).toBe(1);
      expect(mockPipelines.adapt.execute).toHaveBeenCalled();
    });

    it('should abort pipeline on stage failure with "abort" strategy', async () => {
      // Arrange
      const testRunId = 'test-run-abort';
      const stages = ['metrics-collection', 'statistics-calculation', 'adapt-analysis'];

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 5000 });
      mockPipelines.statistics.execute.mockResolvedValue({
        success: false,
        duration: 3000,
        error: { message: 'Statistics failed', code: 'STATS_ERROR' },
      });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'abort',
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.data.completedStages).toBe(1);
      expect(result.data.failedStages).toBe(1);
      expect(mockPipelines.adapt.execute).not.toHaveBeenCalled();
    });

    it('should handle failure with "strict" strategy — stage returns failure result', async () => {
      // Arrange — strict mode + stage returns a failure object (not a throw)
      const testRunId = 'test-run-strict-result';
      const stages = ['metrics-collection', 'statistics-calculation'];

      mockPipelines.metrics.execute.mockResolvedValue({
        success: false,
        duration: 1000,
        error: { message: 'Metrics failed', code: 'ERROR' },
      });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'strict',
      });

      // Assert — strict throws on failed result, caught by outer handler
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SEQUENTIAL_PIPELINE_ERROR');
    });

    it('should handle failure with "strict" strategy — stage throws exception', async () => {
      // Arrange
      const testRunId = 'test-run-strict';
      const stages = ['metrics-collection', 'statistics-calculation'];

      mockPipelines.metrics.execute.mockRejectedValue(new Error('Metrics failed'));

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'strict',
      });

      // Assert — outer catch wraps everything
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Metrics failed');
      expect(result.error?.code).toBe('SEQUENTIAL_PIPELINE_ERROR');
    });

    it('should handle stage exception with "continue" strategy', async () => {
      // Arrange
      const testRunId = 'test-run-exception';
      const stages = ['metrics-collection'];

      const expectedError = new Error('Unexpected pipeline error');
      mockPipelines.metrics.execute.mockRejectedValue(expectedError);

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.data.failedStages).toBe(1);
    });

    it('should handle stage timeout', async () => {
      // Arrange
      const testRunId = 'test-run-timeout';
      const stages = ['metrics-collection'];

      // Mock a slow pipeline that exceeds the timeout
      mockPipelines.metrics.execute.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ success: true, duration: 2000 }), 2000)
          )
      );

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        timeoutMs: 100,
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.data.stages[0].result.error?.message).toContain('timed out');
    }, 10000);

    it('should handle unknown stage name', async () => {
      // Arrange
      const testRunId = 'test-run-unknown';
      const stages = ['invalid-stage-name'];

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert
      expect(result.success).toBe(false);
      expect(result.data.failedStages).toBe(1);
    });

    it('should use default errorHandling ("continue") when not specified', async () => {
      // Arrange
      const testRunId = 'test-run-default';
      const stages = ['metrics-collection', 'statistics-calculation'];

      mockPipelines.metrics.execute.mockResolvedValue({
        success: false,
        duration: 5000,
        error: { message: 'Failed', code: 'ERROR' },
      });
      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert — default 'continue': subsequent stage still runs
      expect(mockPipelines.statistics.execute).toHaveBeenCalled();
      expect(result.data.completedStages).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Stage Mapping
  // ---------------------------------------------------------------------------

  describe('Stage Mapping', () => {
    it('should execute dynatrace-collection stage with batch input', async () => {
      const testRunId = 'test-1';
      mockPipelines.dynatrace.execute.mockResolvedValue({ success: true, duration: 1000 });

      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['dynatrace-collection'],
      });

      expect(mockPipelines.dynatrace.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
    });

    it('should execute panels-processing stage with single input', async () => {
      const testRunId = 'test-1';
      mockPipelines.panels.execute.mockResolvedValue({ success: true, duration: 1000 });

      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['panels-processing'],
      });

      expect(mockPipelines.panels.execute).toHaveBeenCalledWith({ testRunId });
    });

    it('should execute performance-test-metrics stage with single input', async () => {
      const testRunId = 'test-perf';
      mockPipelines.performanceTestMetrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['performance-test-metrics'],
      });

      expect(mockPipelines.performanceTestMetrics.execute).toHaveBeenCalledWith({ testRunId });
    });

    it('should execute metrics-collection stage with single input', async () => {
      const testRunId = 'test-1';
      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection'],
      });

      expect(mockPipelines.metrics.execute).toHaveBeenCalledWith({ testRunId });
    });

    it('should execute statistics-calculation stage with batch input', async () => {
      const testRunId = 'test-1';
      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['statistics-calculation'],
      });

      expect(mockPipelines.statistics.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
    });

    it('should execute control-groups-creation stage with batch input', async () => {
      const testRunId = 'test-1';
      mockPipelines.controlGroups.execute.mockResolvedValue({ success: true, duration: 1000 });

      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['control-groups-creation'],
      });

      expect(mockPipelines.controlGroups.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
    });

    it('should execute control-group-statistics stage with batch input', async () => {
      const testRunId = 'test-1';
      mockPipelines.controlGroupStatistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['control-group-statistics'],
      });

      expect(mockPipelines.controlGroupStatistics.execute).toHaveBeenCalledWith({
        testRunIds: [testRunId],
      });
    });

    it('should execute checks-evaluation stage with batch input', async () => {
      const testRunId = 'test-1';
      mockPipelines.checks.execute.mockResolvedValue({ success: true, duration: 1000 });

      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['checks-evaluation'],
      });

      expect(mockPipelines.checks.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
    });

    it('should execute adapt-analysis stage with batch input', async () => {
      const testRunId = 'test-1';
      mockPipelines.adapt.execute.mockResolvedValue({ success: true, duration: 1000 });

      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['adapt-analysis'],
      });

      expect(mockPipelines.adapt.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
    });

    it('should return UNKNOWN_STAGE error code for unrecognised stage names', async () => {
      // Arrange
      const testRunId = 'test-unknown';

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['not-a-real-stage'],
        errorHandling: 'continue',
      });

      // Assert
      expect(result.success).toBe(false);
      const stageResult = result.data.stages[0].result;
      expect(stageResult.error?.code).toBe('UNKNOWN_STAGE');
      expect(stageResult.error?.message).toContain('Unknown stage: not-a-real-stage');
    });
  });

  // ---------------------------------------------------------------------------
  // Incremental Collection — Skip Logic
  // ---------------------------------------------------------------------------

  describe('Incremental Collection — skip metric collection stages', () => {
    it('should skip all metric collection stages when incremental collection is complete', async () => {
      // Arrange
      const testRunId = 'test-incremental-complete';
      const stages = [
        'dynatrace-collection',
        'panels-processing',
        'performance-test-metrics',
        'metrics-collection',
        'statistics-calculation',
      ];

      // Incremental collection already complete
      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        { source_type: 'grafana', source_id: 'g1', is_complete: true },
      ]);
      mockGapService.isCollectionComplete.mockResolvedValue(true);

      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert — metric collection stages skipped, post-collection stage runs
      expect(mockPipelines.dynatrace.execute).not.toHaveBeenCalled();
      expect(mockPipelines.panels.execute).not.toHaveBeenCalled();
      expect(mockPipelines.performanceTestMetrics.execute).not.toHaveBeenCalled();
      expect(mockPipelines.metrics.execute).not.toHaveBeenCalled();
      expect(mockPipelines.statistics.execute).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should run metric collection stages when incremental collection is not complete', async () => {
      // Arrange
      const testRunId = 'test-incremental-incomplete';
      const stages = ['metrics-collection', 'statistics-calculation'];

      // No incremental statuses — should NOT skip
      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([]);
      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });
      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert — both stages run because getAllCollectionStatuses returned empty
      expect(mockPipelines.metrics.execute).toHaveBeenCalled();
      expect(mockPipelines.statistics.execute).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should not call gap service when no metric collection stages are present', async () => {
      // Arrange
      const testRunId = 'test-no-metric-stages';
      const stages = ['statistics-calculation', 'adapt-analysis'];

      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });
      mockPipelines.adapt.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert — gap service never consulted since no metric stages exist
      expect(mockDatabaseService.getAllCollectionStatuses).not.toHaveBeenCalled();
      expect(mockGapService.isCollectionComplete).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // checkAndFillMetricGaps — gap filling
  // ---------------------------------------------------------------------------

  describe('checkAndFillMetricGaps — gap filling logic', () => {
    it('should proceed with traditional pipeline when no incremental statuses exist', async () => {
      // Arrange
      const testRunId = 'test-no-statuses';
      const stages = ['metrics-collection'];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([]);
      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert — metrics stage runs (not skipped)
      expect(mockPipelines.metrics.execute).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should fill missing ranges and mark source complete when gaps exist', async () => {
      // Arrange
      const testRunId = 'test-gap-fill';
      const stages = ['metrics-collection', 'statistics-calculation'];
      const from = new Date('2024-01-01T10:00:00Z');
      const to = new Date('2024-01-01T10:15:00Z');

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'grafana',
          source_id: 'g1',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      // Need test run for orphan removal
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([
        { grafanaInstanceId: 'g1' },
      ]);

      // isCollectionComplete returns false first, then true after gap fill
      mockGapService.isCollectionComplete.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      mockGapService.detectGaps.mockResolvedValue([
        {
          sourceType: 'grafana',
          sourceId: 'g1',
          missingRanges: [{ from, to }],
          failedRanges: [],
        },
      ]);

      mockPipelines.incrementalMetrics.execute.mockResolvedValue({ success: true, duration: 500 });
      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });
      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — incremental pipeline called to fill the gap
      expect(mockPipelines.incrementalMetrics.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          testRunId,
          collectGrafanaMetrics: true,
          grafanaInstanceId: 'g1',
        })
      );
      // Source marked complete after gap filled
      expect(mockGapService.markSourceComplete).toHaveBeenCalledWith(testRunId, 'grafana', 'g1');
      expect(result.success).toBe(true);
    });

    it('should retry failed ranges up to max attempts (5)', async () => {
      // Arrange
      const testRunId = 'test-retry-max';
      const stages = ['metrics-collection'];
      const from = new Date('2024-01-01T10:00:00Z');
      const to = new Date('2024-01-01T10:15:00Z');

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'grafana',
          source_id: 'g1',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([
        { grafanaInstanceId: 'g1' },
      ]);

      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([
        {
          sourceType: 'grafana',
          sourceId: 'g1',
          missingRanges: [],
          // attempts >= 5 means max retries exceeded — should add warning, not retry
          failedRanges: [{ from: from.toISOString(), to: to.toISOString(), attempts: 5 }],
        },
      ]);
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 0,
        totalSources: 1,
        coverage: 0,
      });

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — incremental pipeline NOT called (max retries exceeded)
      expect(mockPipelines.incrementalMetrics.execute).not.toHaveBeenCalled();
      // Warning added about max retries
      expect(result.data.collectionWarnings).toEqual(
        expect.arrayContaining([expect.stringContaining('Max retries (5) exceeded')])
      );
    });

    it('should add incomplete collection warning when gaps remain after fill attempts', async () => {
      // Arrange
      const testRunId = 'test-incomplete-warning';
      const stages = ['metrics-collection'];
      const from = new Date('2024-01-01T10:00:00Z');
      const to = new Date('2024-01-01T10:15:00Z');

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'grafana',
          source_id: 'g1',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([
        { grafanaInstanceId: 'g1' },
      ]);

      // Collection never completes
      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([
        {
          sourceType: 'grafana',
          sourceId: 'g1',
          missingRanges: [{ from, to }],
          failedRanges: [],
        },
      ]);
      // Retry fails
      mockPipelines.incrementalMetrics.execute.mockResolvedValue({
        success: false,
        error: { message: 'Grafana timeout' },
      });
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 0,
        totalSources: 1,
        coverage: 50,
      });

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — collection warning added about incomplete coverage
      expect(result.data.collectionWarnings).toEqual(
        expect.arrayContaining([expect.stringContaining('Metric collection incomplete')])
      );
    });

    it('should handle error thrown during gap check gracefully', async () => {
      // Arrange
      const testRunId = 'test-gap-error';
      const stages = ['metrics-collection'];

      mockDatabaseService.getAllCollectionStatuses.mockRejectedValue(
        new Error('DB connection lost')
      );
      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — metric stage still runs despite gap check failure, warning attached
      expect(mockPipelines.metrics.execute).toHaveBeenCalled();
      expect(result.data.collectionWarnings).toEqual(
        expect.arrayContaining([expect.stringContaining('Gap filling process failed')])
      );
    });

    it('should mark sources with no gaps as complete', async () => {
      // Arrange
      const testRunId = 'test-mark-no-gap-complete';
      const stages = ['metrics-collection'];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'performance_test',
          source_id: null,
          is_complete: false, // not yet marked complete
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([]);

      // isCollectionComplete: false then true after marking
      mockGapService.isCollectionComplete
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      // detectGaps returns NO gaps for this source — so it should be marked complete
      mockGapService.detectGaps.mockResolvedValue([]);

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — source with no gaps is marked complete
      expect(mockGapService.markSourceComplete).toHaveBeenCalledWith(
        testRunId,
        'performance_test',
        null
      );
      expect(result.success).toBe(true);
    });

    it('should skip already-complete statuses when iterating over sources with no gaps', async () => {
      // Arrange — covers lines 124-125: the `continue` guard for is_complete statuses
      const testRunId = 'test-skip-already-complete';
      const stages = ['metrics-collection'];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'grafana',
          source_id: 'g1',
          is_complete: true, // Already complete — should be skipped
          collected_ranges: [],
          failed_ranges: [],
        },
        {
          source_type: 'performance_test',
          source_id: null,
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([
        { grafanaInstanceId: 'g1' },
      ]);

      // isCollectionComplete: false then true after marking performance_test complete
      mockGapService.isCollectionComplete
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      // No gaps for either source
      mockGapService.detectGaps.mockResolvedValue([]);

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert — only performance_test marked complete (grafana was already complete)
      expect(mockGapService.markSourceComplete).toHaveBeenCalledTimes(1);
      expect(mockGapService.markSourceComplete).toHaveBeenCalledWith(
        testRunId,
        'performance_test',
        null
      );
      expect(result.success).toBe(true);
    });

    it('should log error and continue when markSourceComplete throws for no-gap source', async () => {
      // Arrange — covers lines 140-145: catch in the "no gaps" marking loop
      const testRunId = 'test-no-gap-mark-throws';
      const stages = ['metrics-collection'];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'performance_test',
          source_id: null,
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([]);

      // detectGaps returns empty — performance_test has no gaps, should be marked complete
      // but markSourceComplete throws
      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([]);
      mockGapService.markSourceComplete.mockRejectedValue(new Error('Write failed'));
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 0,
        totalSources: 1,
        coverage: 0,
      });

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act — should not throw despite markSourceComplete failure
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — error logged, pipeline continues
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to mark performance_test/null as complete')
      );
      expect(result.success).toBe(true);
    });

    it('should retry a failed range with fewer than 5 attempts', async () => {
      // Arrange
      const testRunId = 'test-retry-failed-range';
      const stages = ['metrics-collection'];
      const from = new Date('2024-01-01T10:00:00Z');
      const to = new Date('2024-01-01T10:15:00Z');

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'dynatrace',
          source_id: 'dt-1',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([]);
      mockDatabaseService.dataSource.query.mockResolvedValue([
        { dynatrace_config_id: 'dt-1' },
      ]);

      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([
        {
          sourceType: 'dynatrace',
          sourceId: 'dt-1',
          missingRanges: [],
          failedRanges: [
            {
              from: from.toISOString(),
              to: to.toISOString(),
              attempts: 2, // below threshold — should retry
            },
          ],
        },
      ]);
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 1,
        totalSources: 1,
        coverage: 100,
      });

      mockPipelines.incrementalMetrics.execute.mockResolvedValue({ success: true, duration: 500 });
      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — incremental pipeline called with dynatrace flag
      expect(mockPipelines.incrementalMetrics.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          testRunId,
          collectDynatraceMetrics: true,
          dynatraceConfigId: 'dt-1',
        })
      );
      // updateCollectedRanges called to record the filled range
      expect(mockDatabaseService.updateCollectedRanges).toHaveBeenCalledWith(
        testRunId,
        'dynatrace',
        'dt-1',
        expect.objectContaining({ from: expect.any(Date), to: expect.any(Date) })
      );
    });

    it('should log error and continue when markSourceComplete throws after filling all gaps', async () => {
      // Arrange — this covers lines 222-227 (catch for markSourceComplete after gap fill)
      const testRunId = 'test-mark-complete-throws';
      const stages = ['metrics-collection'];
      const from = new Date('2024-01-01T10:00:00Z');
      const to = new Date('2024-01-01T10:15:00Z');

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'grafana',
          source_id: 'g1',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([
        { grafanaInstanceId: 'g1' },
      ]);

      // isCollectionComplete always returns false (so metrics-collection stage runs)
      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([
        {
          sourceType: 'grafana',
          sourceId: 'g1',
          missingRanges: [{ from, to }],
          failedRanges: [],
        },
      ]);
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 0,
        totalSources: 1,
        coverage: 50,
      });

      // Fill succeeds, but markSourceComplete throws
      mockPipelines.incrementalMetrics.execute.mockResolvedValue({ success: true, duration: 500 });
      mockGapService.markSourceComplete.mockRejectedValue(new Error('DB constraint violation'));

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act — should not throw despite markSourceComplete failure
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — error logged but pipeline continues
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to mark grafana/g1 as complete')
      );
      // Stage still runs (collection stays incomplete so metrics-collection is not skipped)
      expect(mockPipelines.metrics.execute).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should add warning when retrying a previously-failed range throws', async () => {
      // Arrange — covers lines 177-186: catch for retryCollectionForRange on failedRanges loop
      const testRunId = 'test-retry-failed-range-throws';
      const stages = ['metrics-collection'];
      const from = new Date('2024-01-01T10:00:00Z');
      const to = new Date('2024-01-01T10:15:00Z');

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'grafana',
          source_id: 'g2',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([
        { grafanaInstanceId: 'g2' },
      ]);

      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([
        {
          sourceType: 'grafana',
          sourceId: 'g2',
          missingRanges: [],
          // attempts < 5 → will be retried, but retry throws
          failedRanges: [{ from: from.toISOString(), to: to.toISOString(), attempts: 1 }],
        },
      ]);
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 0,
        totalSources: 1,
        coverage: 0,
      });

      // The retry call itself throws
      mockPipelines.incrementalMetrics.execute.mockRejectedValue(new Error('Grafana down'));
      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — warning added for the retry failure, source NOT marked complete
      expect(result.data.collectionWarnings).toEqual(
        expect.arrayContaining([expect.stringContaining('Retry failed for grafana/g2')])
      );
      expect(mockGapService.markSourceComplete).not.toHaveBeenCalledWith(testRunId, 'grafana', 'g2');
    });

    it('should add warning and set sourceHasErrors when retryCollectionForRange throws', async () => {
      // Arrange — covers the catch in the missingRanges loop (lines ~204-213)
      const testRunId = 'test-retry-throws';
      const stages = ['metrics-collection'];
      const from = new Date('2024-01-01T10:00:00Z');
      const to = new Date('2024-01-01T10:15:00Z');

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'grafana',
          source_id: 'g1',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([
        { grafanaInstanceId: 'g1' },
      ]);

      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([
        {
          sourceType: 'grafana',
          sourceId: 'g1',
          missingRanges: [{ from, to }],
          failedRanges: [],
        },
      ]);
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 0,
        totalSources: 1,
        coverage: 50,
      });

      // Incremental pipeline throws — simulates real collection error
      mockPipelines.incrementalMetrics.execute.mockRejectedValue(new Error('Network error'));
      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — source NOT marked complete (sourceHasErrors = true)
      expect(mockGapService.markSourceComplete).not.toHaveBeenCalledWith(testRunId, 'grafana', 'g1');
      // Warning added for the failed range
      expect(result.data.collectionWarnings).toEqual(
        expect.arrayContaining([expect.stringContaining('Collection failed for grafana/g1')])
      );
    });
  });

  // ---------------------------------------------------------------------------
  // removeOrphanedCollectionSources
  // ---------------------------------------------------------------------------

  describe('removeOrphanedCollectionSources', () => {
    it('should keep statuses for sources still configured and remove orphans', async () => {
      // Arrange
      const testRunId = 'test-orphan-removal';
      const stages = ['metrics-collection'];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'grafana',
          source_id: 'g1',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
        {
          source_type: 'dynatrace',
          source_id: 'old-dt',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
        {
          source_type: 'performance_test',
          source_id: null,
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);

      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });

      // Only g1 is still configured
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([
        { grafanaInstanceId: 'g1' },
      ]);
      // No dynatrace configs — old-dt is orphaned
      mockDatabaseService.dataSource.query.mockResolvedValue([]);

      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([]);
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 0,
        totalSources: 2,
        coverage: 0,
      });

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — orphaned dynatrace source removed
      expect(mockDatabaseService.removeCollectionStatus).toHaveBeenCalledWith(
        testRunId,
        'dynatrace',
        'old-dt'
      );
      // grafana and performance_test NOT removed
      expect(mockDatabaseService.removeCollectionStatus).not.toHaveBeenCalledWith(
        testRunId,
        'grafana',
        'g1'
      );
      expect(mockDatabaseService.removeCollectionStatus).not.toHaveBeenCalledWith(
        testRunId,
        'performance_test',
        null
      );
    });

    it('should return all statuses unchanged when test run is not found', async () => {
      // Arrange
      const testRunId = 'test-no-testrun';
      const stages = ['metrics-collection'];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'grafana',
          source_id: 'g1',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      // getTestRunByTestRunId returns null
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue(null);

      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([]);
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 0,
        totalSources: 1,
        coverage: 0,
      });

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert — no removal because test run not found
      expect(mockDatabaseService.removeCollectionStatus).not.toHaveBeenCalled();
    });

    it('should return empty list and skip metric stages when all statuses are orphaned', async () => {
      // Arrange
      const testRunId = 'test-all-orphaned';
      const stages = ['metrics-collection', 'statistics-calculation'];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'dynatrace',
          source_id: 'old-dt',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      // No configured sources (old-dt is orphaned)
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([]);
      mockDatabaseService.dataSource.query.mockResolvedValue([]);

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });
      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — after orphan removal all statuses gone → treated as no incremental collection
      // → both stages run as traditional pipeline
      expect(mockDatabaseService.removeCollectionStatus).toHaveBeenCalledWith(
        testRunId,
        'dynatrace',
        'old-dt'
      );
      expect(mockPipelines.metrics.execute).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // addWarningsToTestRun
  // ---------------------------------------------------------------------------

  describe('addWarningsToTestRun', () => {
    it('should append collection warnings to test run annotations', async () => {
      // Arrange
      const testRunId = 'test-warnings';
      const stages = ['metrics-collection'];

      // Simulate collection warnings by triggering incomplete collection
      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'grafana',
          source_id: 'g1',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: ['pre-existing annotation'],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([
        { grafanaInstanceId: 'g1' },
      ]);

      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([
        {
          sourceType: 'grafana',
          sourceId: 'g1',
          missingRanges: [
            {
              from: new Date('2024-01-01T10:00:00Z'),
              to: new Date('2024-01-01T10:15:00Z'),
            },
          ],
          failedRanges: [],
        },
      ]);
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 0,
        totalSources: 1,
        coverage: 50,
      });

      // Collection fails — causes warning
      mockPipelines.incrementalMetrics.execute.mockRejectedValue(
        new Error('Grafana unreachable')
      );
      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — updateTestRunByTestRunId called with warnings in annotations
      expect(mockDatabaseService.updateTestRunByTestRunId).toHaveBeenCalledWith(
        testRunId,
        expect.objectContaining({
          annotations: expect.arrayContaining([
            'pre-existing annotation',
            expect.stringContaining('[COLLECTION WARNING]'),
          ]),
        })
      );
    });

    it('should not call updateTestRunByTestRunId when there are no warnings', async () => {
      // Arrange
      const testRunId = 'test-no-warnings-update';
      const stages = ['statistics-calculation'];

      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert — no annotation update when no warnings
      expect(mockDatabaseService.updateTestRunByTestRunId).not.toHaveBeenCalled();
    });

    it('should handle missing test run gracefully when adding warnings', async () => {
      // Arrange — force collection warning but test run not found for annotation update
      const testRunId = 'test-missing-for-warn';
      const stages = ['metrics-collection'];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'grafana',
          source_id: 'g1',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [{ from: '2024-01-01T10:00:00Z', to: '2024-01-01T10:15:00Z', attempts: 5 }],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId
        // First call (orphan removal)
        .mockResolvedValueOnce({
          systemUnderTestId: 'sut-1',
          testEnvironment: 'prod',
          workload: 'load',
          annotations: [],
        })
        // Second call (addWarningsToTestRun) — not found
        .mockResolvedValueOnce(null);
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([
        { grafanaInstanceId: 'g1' },
      ]);

      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([
        {
          sourceType: 'grafana',
          sourceId: 'g1',
          missingRanges: [],
          failedRanges: [{ from: '2024-01-01T10:00:00Z', to: '2024-01-01T10:15:00Z', attempts: 5 }],
        },
      ]);
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 0,
        totalSources: 1,
        coverage: 0,
      });

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act — should not throw despite test run not found during warning phase
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — graceful handling
      expect(result.success).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Test run not found')
      );
    });

    it('should log error when updateTestRunByTestRunId throws during warning annotation', async () => {
      // Arrange — force a warning then have the DB update throw
      const testRunId = 'test-update-throws';
      const stages = ['metrics-collection'];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        {
          source_type: 'grafana',
          source_id: 'g1',
          is_complete: false,
          collected_ranges: [],
          failed_ranges: [{ from: '2024-01-01T10:00:00Z', to: '2024-01-01T10:15:00Z', attempts: 5 }],
        },
      ]);
      mockDatabaseService.getTestRunByTestRunId
        .mockResolvedValueOnce({
          systemUnderTestId: 'sut-1',
          testEnvironment: 'prod',
          workload: 'load',
          annotations: [],
        })
        .mockResolvedValueOnce({
          annotations: [],
        });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([
        { grafanaInstanceId: 'g1' },
      ]);
      // updateTestRunByTestRunId throws
      mockDatabaseService.updateTestRunByTestRunId.mockRejectedValue(new Error('DB write error'));

      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([
        {
          sourceType: 'grafana',
          sourceId: 'g1',
          missingRanges: [],
          failedRanges: [{ from: '2024-01-01T10:00:00Z', to: '2024-01-01T10:15:00Z', attempts: 5 }],
        },
      ]);
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 0,
        totalSources: 1,
        coverage: 0,
      });

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act — should not throw
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — error logged, pipeline continues normally
      expect(result.success).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to add warnings to test run')
      );
    });
  });

  // ---------------------------------------------------------------------------
  // ProgressReporter integration
  // ---------------------------------------------------------------------------

  describe('ProgressReporter integration', () => {
    it('should call startStage and completeStage for each successful stage', async () => {
      // Arrange
      const testRunId = 'test-progress';
      const stages = ['metrics-collection', 'statistics-calculation'];

      const mockProgressReporter = {
        startStage: vi.fn().mockResolvedValue(undefined),
        completeStage: vi.fn().mockResolvedValue(undefined),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      };

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });
      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(
        testRunId,
        { stages },
        mockProgressReporter as never
      );

      // Assert
      expect(mockProgressReporter.startStage).toHaveBeenCalledTimes(2);
      expect(mockProgressReporter.startStage).toHaveBeenCalledWith('metrics-collection');
      expect(mockProgressReporter.startStage).toHaveBeenCalledWith('statistics-calculation');
      expect(mockProgressReporter.completeStage).toHaveBeenCalledTimes(2);
      expect(mockProgressReporter.complete).toHaveBeenCalledTimes(1);
    });

    it('should call progressReporter.complete after all stages succeed', async () => {
      // Arrange
      const testRunId = 'test-progress-complete';
      const mockProgressReporter = {
        startStage: vi.fn().mockResolvedValue(undefined),
        completeStage: vi.fn().mockResolvedValue(undefined),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      };

      mockPipelines.adapt.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(
        testRunId,
        { stages: ['adapt-analysis'] },
        mockProgressReporter as never
      );

      // Assert
      expect(mockProgressReporter.complete).toHaveBeenCalledTimes(1);
      expect(mockProgressReporter.fail).not.toHaveBeenCalled();
    });

    it('should call progressReporter.fail on pipeline-level exception', async () => {
      // Arrange
      const testRunId = 'test-progress-fail';
      const mockProgressReporter = {
        startStage: vi.fn().mockResolvedValue(undefined),
        completeStage: vi.fn().mockResolvedValue(undefined),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      };

      // strict + exception => outer catch calls progressReporter.fail
      mockPipelines.metrics.execute.mockRejectedValue(new Error('Critical failure'));

      // Act
      await orchestrator.executeSequentialPipeline(
        testRunId,
        { stages: ['metrics-collection'], errorHandling: 'strict' },
        mockProgressReporter as never
      );

      // Assert
      expect(mockProgressReporter.fail).toHaveBeenCalledWith(
        expect.stringContaining('Critical failure')
      );
      expect(mockProgressReporter.complete).not.toHaveBeenCalled();
    });

    it('should not call completeStage when a stage fails', async () => {
      // Arrange
      const testRunId = 'test-progress-no-complete-on-fail';
      const mockProgressReporter = {
        startStage: vi.fn().mockResolvedValue(undefined),
        completeStage: vi.fn().mockResolvedValue(undefined),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      };

      mockPipelines.metrics.execute.mockResolvedValue({
        success: false,
        error: { message: 'Failure', code: 'ERR' },
      });

      // Act
      await orchestrator.executeSequentialPipeline(
        testRunId,
        { stages: ['metrics-collection'], errorHandling: 'continue' },
        mockProgressReporter as never
      );

      // Assert — startStage called but not completeStage
      expect(mockProgressReporter.startStage).toHaveBeenCalledWith('metrics-collection');
      expect(mockProgressReporter.completeStage).not.toHaveBeenCalled();
    });

    it('should not call progressReporter methods when no reporter provided', async () => {
      // Arrange — ensure no errors thrown when progressReporter is omitted
      const testRunId = 'test-no-reporter';
      mockPipelines.adapt.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act / Assert — should not throw
      await expect(
        orchestrator.executeSequentialPipeline(testRunId, { stages: ['adapt-analysis'] })
      ).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------

  describe('Edge Cases', () => {
    it('should handle empty stages array', async () => {
      // Arrange
      const testRunId = 'test-empty';
      const stages: string[] = [];

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.completedStages).toBe(0);
      expect(result.data.failedStages).toBe(0);
    });

    it('should handle very long testRunId', async () => {
      // Arrange
      const testRunId = 'test-' + 'x'.repeat(1000);
      const stages = ['metrics-collection'];

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.testRunId).toBe(testRunId);
    });

    it('should handle multiple consecutive failures', async () => {
      // Arrange
      const testRunId = 'test-multi-fail';
      const stages = ['metrics-collection', 'statistics-calculation', 'adapt-analysis'];

      mockPipelines.metrics.execute.mockResolvedValue({
        success: false,
        duration: 1000,
        error: { message: 'Fail 1', code: 'ERROR_1' },
      });
      mockPipelines.statistics.execute.mockResolvedValue({
        success: false,
        duration: 1000,
        error: { message: 'Fail 2', code: 'ERROR_2' },
      });
      mockPipelines.adapt.execute.mockResolvedValue({
        success: false,
        duration: 1000,
        error: { message: 'Fail 3', code: 'ERROR_3' },
      });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.data.failedStages).toBe(3);
      expect(result.data.completedStages).toBe(0);
    });

    it('should include testRunId in error details when pipeline fails', async () => {
      // Arrange
      const testRunId = 'test-error-details';
      const stages = ['metrics-collection'];

      mockPipelines.metrics.execute.mockRejectedValue(new Error('Fatal'));

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'strict',
      });

      // Assert
      expect(result.error?.details).toMatchObject({ testRunId });
    });

    it('should handle non-Error objects thrown from pipeline', async () => {
      // Arrange — some pipelines may throw plain strings or objects
      const testRunId = 'test-non-error-throw';
      const stages = ['metrics-collection'];

      mockPipelines.metrics.execute.mockRejectedValue('plain string error');

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — gracefully converted to string
      expect(result.success).toBe(false);
      expect(result.data.stages[0].result.error?.message).toBe('plain string error');
    });

    it('should continue remaining stages when a stage throws with "continue" errorHandling', async () => {
      // Arrange — this covers the else branch (overallSuccess = false) in stageError handler
      const testRunId = 'test-continue-on-throw';
      const stages = ['metrics-collection', 'statistics-calculation', 'adapt-analysis'];

      // First stage throws
      mockPipelines.metrics.execute.mockRejectedValue(new Error('Stage threw'));
      // Subsequent stages succeed
      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });
      mockPipelines.adapt.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — overallSuccess false but remaining stages ran
      expect(result.success).toBe(false);
      expect(mockPipelines.statistics.execute).toHaveBeenCalled();
      expect(mockPipelines.adapt.execute).toHaveBeenCalled();
      expect(result.data.completedStages).toBe(2);
      expect(result.data.failedStages).toBe(1);
    });

    it('should continue to next stage when progressReporter.startStage throws with "continue" errorHandling', async () => {
      // Arrange — progressReporter.startStage throws, triggering the catch block at line 503
      // with errorHandling === 'continue', which covers lines 526-527 (else branch)
      const testRunId = 'test-progress-startStage-throws';
      const stages = ['metrics-collection', 'statistics-calculation'];

      const mockProgressReporter = {
        startStage: vi.fn()
          .mockRejectedValueOnce(new Error('Redis connection lost'))
          .mockResolvedValue(undefined),
        completeStage: vi.fn().mockResolvedValue(undefined),
        complete: vi.fn().mockResolvedValue(undefined),
        fail: vi.fn().mockResolvedValue(undefined),
      };

      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      const result = await orchestrator.executeSequentialPipeline(
        testRunId,
        { stages, errorHandling: 'continue' },
        mockProgressReporter as never
      );

      // Assert — first stage errored (startStage threw), second stage succeeded
      // overallSuccess = false because first stage ended in catch block
      expect(result.success).toBe(false);
      expect(mockPipelines.statistics.execute).toHaveBeenCalled();
      expect(result.data.completedStages).toBe(1);
      expect(result.data.failedStages).toBe(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Stage metrics-collection error')
      );
    });

    it('should handle performance-test-metrics stage with single input', async () => {
      // Arrange — this stage was previously uncovered (line ~650 in source)
      const testRunId = 'test-perf-metrics';
      const stages = ['performance-test-metrics'];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        { source_type: 'performance_test', source_id: null, is_complete: false },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([]);

      // Not complete — metric collection stages run
      mockGapService.isCollectionComplete.mockResolvedValue(false);
      mockGapService.detectGaps.mockResolvedValue([]);
      mockGapService.getCollectionSummary.mockResolvedValue({
        completeSources: 0,
        totalSources: 1,
        coverage: 0,
      });

      mockPipelines.performanceTestMetrics.execute.mockResolvedValue({
        success: true,
        duration: 1000,
      });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert
      expect(mockPipelines.performanceTestMetrics.execute).toHaveBeenCalledWith({ testRunId });
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  describe('Logging', () => {
    it('should log pipeline start', async () => {
      // Arrange
      const testRunId = 'test-log';
      const stages = ['metrics-collection'];

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting stage: metrics-collection')
      );
    });

    it('should log stage completion', async () => {
      // Arrange
      const testRunId = 'test-log';
      const stages = ['metrics-collection'];

      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Stage metrics-collection completed')
      );
    });

    it('should log stage failure', async () => {
      // Arrange
      const testRunId = 'test-log';
      const stages = ['metrics-collection'];

      mockPipelines.metrics.execute.mockResolvedValue({
        success: false,
        duration: 1000,
        error: { message: 'Test error', code: 'ERROR' },
      });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Stage metrics-collection failed')
      );
    });

    it('should log stage errors', async () => {
      // Arrange
      const testRunId = 'test-log';
      const stages = ['metrics-collection'];

      mockPipelines.metrics.execute.mockRejectedValue(new Error('Pipeline crash'));

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert — when a pipeline throws, executeStage catches and returns a failed result
      // which flows through the warn path in the outer loop
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Stage metrics-collection failed')
      );
    });

    it('should log incremental collection skip message when complete', async () => {
      // Arrange
      const testRunId = 'test-skip-log';
      const stages = ['metrics-collection', 'statistics-calculation'];

      mockDatabaseService.getAllCollectionStatuses.mockResolvedValue([
        { source_type: 'grafana', source_id: 'g1', is_complete: true },
      ]);
      mockDatabaseService.getTestRunByTestRunId.mockResolvedValue({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'prod',
        workload: 'load',
        annotations: [],
      });
      mockDatabaseService.applicationDashboardRepo.find.mockResolvedValue([
        { grafanaInstanceId: 'g1' },
      ]);

      mockGapService.isCollectionComplete.mockResolvedValue(true);

      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert — skip log for individual stage
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Skipping stage: metrics-collection')
      );
    });
  });
});
