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

describe('PipelineOrchestrator', () => {
  let orchestrator: PipelineOrchestrator;
  let mockLogger: any;
  let mockDatabaseService: any;
  let mockPipelines: {
    metrics: any;
    statistics: any;
    adapt: any;
    checks: any;
    controlGroups: any;
    controlGroupStatistics: any;
    panels: any;
    dynatrace: any;
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
      getAllCollectionStatuses: vi.fn(),
      testRunRepo: { findOne: vi.fn() },
      dsMetricsRepo: { count: vi.fn() },
      transaction: vi.fn(),
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
    };

    // Mock pipeline constructors
    vi.mocked(MetricsPipeline).mockImplementation(() => mockPipelines.metrics);
    vi.mocked(StatisticsPipeline).mockImplementation(() => mockPipelines.statistics);
    vi.mocked(AdaptPipeline).mockImplementation(() => mockPipelines.adapt);
    vi.mocked(ChecksPipeline).mockImplementation(() => mockPipelines.checks);
    vi.mocked(ControlGroupsPipeline).mockImplementation(() => mockPipelines.controlGroups);
    vi.mocked(ControlGroupStatisticsPipeline).mockImplementation(
      () => mockPipelines.controlGroupStatistics
    );
    vi.mocked(PanelsPipeline).mockImplementation(() => mockPipelines.panels);
    vi.mocked(DynatracePipeline).mockImplementation(() => mockPipelines.dynatrace);

    // Create orchestrator instance with database service
    orchestrator = new PipelineOrchestrator(mockLogger, mockDatabaseService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Pipeline Instance Creation', () => {
    it('should initialize all pipeline instances with logger', () => {
      // Assert
      expect(MetricsPipeline).toHaveBeenCalledWith(mockLogger);
      expect(StatisticsPipeline).toHaveBeenCalledWith(mockLogger);
      expect(AdaptPipeline).toHaveBeenCalledWith(mockLogger);
      expect(ChecksPipeline).toHaveBeenCalledWith(mockLogger);
      expect(ControlGroupsPipeline).toHaveBeenCalledWith(mockLogger);
      expect(ControlGroupStatisticsPipeline).toHaveBeenCalledWith(mockLogger);
      expect(PanelsPipeline).toHaveBeenCalledWith(mockLogger);
      expect(DynatracePipeline).toHaveBeenCalledWith(mockLogger);
    });
  });

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

      mockPipelines.panels.execute.mockResolvedValue({
        success: true,
        duration: 2000,
      });

      mockPipelines.dynatrace.execute.mockResolvedValue({
        success: true,
        duration: 6000,
      });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert
      // Panels uses single input format
      expect(mockPipelines.panels.execute).toHaveBeenCalledWith({ testRunId });
      // Dynatrace uses batch input format
      expect(mockPipelines.dynatrace.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
    });

    it('should track stage durations and percentages', async () => {
      // Arrange
      const testRunId = 'test-run-789';
      const stages = ['metrics-collection', 'statistics-calculation'];

      mockPipelines.metrics.execute.mockResolvedValue({
        success: true,
        duration: 10000,
      });

      mockPipelines.statistics.execute.mockResolvedValue({
        success: true,
        duration: 5000,
      });

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

      mockPipelines.metrics.execute.mockResolvedValue({
        success: true,
        duration: 1000,
      });

      // Act
      const startTime = Date.now();
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });
      const endTime = Date.now();

      // Assert
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBeLessThanOrEqual(endTime - startTime + 100);
    });
  });

  describe('executeSequentialPipeline - Error Handling', () => {
    it('should handle stage failure with "continue" strategy', async () => {
      // Arrange
      const testRunId = 'test-run-fail';
      const stages = ['metrics-collection', 'statistics-calculation', 'adapt-analysis'];

      mockPipelines.metrics.execute.mockResolvedValue({
        success: true,
        duration: 5000,
      });

      mockPipelines.statistics.execute.mockResolvedValue({
        success: false,
        duration: 3000,
        error: { message: 'Statistics calculation failed', code: 'STATS_ERROR' },
      });

      mockPipelines.adapt.execute.mockResolvedValue({
        success: true,
        duration: 4000,
      });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'continue',
      });

      // Assert
      expect(result.success).toBe(false); // Overall failure due to one failed stage
      expect(result.data.completedStages).toBe(2); // metrics and adapt succeeded
      expect(result.data.failedStages).toBe(1);
      expect(mockPipelines.adapt.execute).toHaveBeenCalled(); // Should continue despite failure
    });

    it('should abort pipeline on stage failure with "abort" strategy', async () => {
      // Arrange
      const testRunId = 'test-run-abort';
      const stages = ['metrics-collection', 'statistics-calculation', 'adapt-analysis'];

      mockPipelines.metrics.execute.mockResolvedValue({
        success: true,
        duration: 5000,
      });

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
      expect(mockPipelines.adapt.execute).not.toHaveBeenCalled(); // Should NOT continue
    });

    it('should handle failure with "strict" strategy', async () => {
      // Arrange
      const testRunId = 'test-run-strict';
      const stages = ['metrics-collection', 'statistics-calculation'];

      // Mock the pipeline to throw an exception
      mockPipelines.metrics.execute.mockRejectedValue(new Error('Metrics failed'));

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        errorHandling: 'strict',
      });

      // Assert
      // Even in strict mode, the outer catch returns a result instead of throwing
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Metrics failed');
      expect(result.error?.code).toBe('SEQUENTIAL_PIPELINE_ERROR');
    });

    it('should handle stage exception', async () => {
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

      // Mock a slow pipeline that exceeds timeout
      mockPipelines.metrics.execute.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  success: true,
                  duration: 2000,
                }),
              2000
            );
          })
      );

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages,
        timeoutMs: 100, // Very short timeout
      });

      // Assert
      expect(result.success).toBe(false);
      // The timeout error is in the stage result, not the overall error
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

    it('should use default errorHandling when not specified', async () => {
      // Arrange
      const testRunId = 'test-run-default';
      const stages = ['metrics-collection', 'statistics-calculation'];

      mockPipelines.metrics.execute.mockResolvedValue({
        success: false,
        duration: 5000,
        error: { message: 'Failed', code: 'ERROR' },
      });

      // Act
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert - Default is 'continue'
      expect(mockPipelines.statistics.execute).toHaveBeenCalled();
    });
  });

  describe('Stage Mapping', () => {
    it('should execute dynatrace-collection stage', async () => {
      // Arrange
      const testRunId = 'test-1';
      mockPipelines.dynatrace.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['dynatrace-collection'],
      });

      // Assert
      expect(mockPipelines.dynatrace.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
    });

    it('should execute panels-processing stage', async () => {
      // Arrange
      const testRunId = 'test-1';
      mockPipelines.panels.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['panels-processing'],
      });

      // Assert
      expect(mockPipelines.panels.execute).toHaveBeenCalledWith({ testRunId });
    });

    it('should execute metrics-collection stage', async () => {
      // Arrange
      const testRunId = 'test-1';
      mockPipelines.metrics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection'],
      });

      // Assert
      expect(mockPipelines.metrics.execute).toHaveBeenCalledWith({ testRunId });
    });

    it('should execute statistics-calculation stage', async () => {
      // Arrange
      const testRunId = 'test-1';
      mockPipelines.statistics.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['statistics-calculation'],
      });

      // Assert
      expect(mockPipelines.statistics.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
    });

    it('should execute control-groups-creation stage', async () => {
      // Arrange
      const testRunId = 'test-1';
      mockPipelines.controlGroups.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['control-groups-creation'],
      });

      // Assert
      expect(mockPipelines.controlGroups.execute).toHaveBeenCalledWith({
        testRunIds: [testRunId],
      });
    });

    it('should execute control-group-statistics stage', async () => {
      // Arrange
      const testRunId = 'test-1';
      mockPipelines.controlGroupStatistics.execute.mockResolvedValue({
        success: true,
        duration: 1000,
      });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['control-group-statistics'],
      });

      // Assert
      expect(mockPipelines.controlGroupStatistics.execute).toHaveBeenCalledWith({
        testRunIds: [testRunId],
      });
    });

    it('should execute checks-evaluation stage', async () => {
      // Arrange
      const testRunId = 'test-1';
      mockPipelines.checks.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['checks-evaluation'],
      });

      // Assert
      expect(mockPipelines.checks.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
    });

    it('should execute adapt-analysis stage', async () => {
      // Arrange
      const testRunId = 'test-1';
      mockPipelines.adapt.execute.mockResolvedValue({ success: true, duration: 1000 });

      // Act
      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['adapt-analysis'],
      });

      // Assert
      expect(mockPipelines.adapt.execute).toHaveBeenCalledWith({ testRunIds: [testRunId] });
    });
  });

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

      mockPipelines.metrics.execute.mockResolvedValue({
        success: true,
        duration: 1000,
      });

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
  });

  describe('Logging', () => {
    it('should log pipeline start', async () => {
      // Arrange
      const testRunId = 'test-log';
      const stages = ['metrics-collection'];

      mockPipelines.metrics.execute.mockResolvedValue({
        success: true,
        duration: 1000,
      });

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

      mockPipelines.metrics.execute.mockResolvedValue({
        success: true,
        duration: 1000,
      });

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

      // Assert
      // When a pipeline throws an error, executeStage catches it and returns a failed result
      // The error is not logged in the main loop, only the warning about the failure
      // So we should check for the warning log instead
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Stage metrics-collection failed')
      );
    });
  });

  describe('Batch Processing (Not Implemented)', () => {
    it('should throw error for batch processing', async () => {
      // Act & Assert
      await expect(
        orchestrator.executeBatchProcessing(['test-1', 'test-2'])
      ).rejects.toThrow('Batch processing not yet implemented');
    });
  });

  describe('Re-evaluation (Not Implemented)', () => {
    it('should throw error for re-evaluation', async () => {
      // Act & Assert
      await expect(
        orchestrator.executeReevaluationBatch(['test-1', 'test-2'])
      ).rejects.toThrow('Re-evaluation not yet implemented');
    });
  });
});
