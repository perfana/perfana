/**
 * Pipeline Orchestrator Integration Tests
 *
 * Tests end-to-end pipeline execution with real database connections,
 * validates orchestration logic, error handling, and data flow between pipelines.
 *
 * Coverage:
 * - Sequential pipeline execution (Metrics → Statistics → Checks → Adapt)
 * - Error propagation between pipeline stages
 * - Partial failure handling with different error strategies
 * - Pipeline timeout handling
 * - Stage timing and performance tracking
 * - Unknown stage handling
 */

import { describe, test, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { PipelineOrchestrator } from '../../services/PipelineOrchestrator.js';
import { MetricsPipeline } from '../../pipelines/MetricsPipeline.js';
import { StatisticsPipeline } from '../../pipelines/StatisticsPipeline.js';
import { AdaptPipeline } from '../../pipelines/AdaptPipeline.js';
import { ChecksPipeline } from '../../pipelines/ChecksPipeline.js';
import { ControlGroupsPipeline } from '../../pipelines/ControlGroupsPipeline.js';
import { ControlGroupStatisticsPipeline } from '../../pipelines/ControlGroupStatisticsPipeline.js';
import { PanelsPipeline } from '../../pipelines/PanelsPipeline.js';
import { DynatracePipeline } from '../../pipelines/DynatracePipeline.js';
import type { PipelineResult } from '../../types/pipeline.js';
import { Pool } from 'pg';
import { createTestScenario, clearTestData } from '../helpers/database.js';

// Mock logger utilities
vi.mock('../../lib/utils/logger.js', () => ({
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

describe('PipelineOrchestrator Integration Tests', () => {
  let orchestrator: PipelineOrchestrator;
  let mockLogger: any;
  let testDb: Pool;
  let testRunId: string;

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
  }, 30000);

  afterAll(async () => {
    if (testDb) {
      await testDb.end();
    }
  });

  beforeEach(async () => {
    // Clear test data
    await clearTestData(testDb);

    // Create test scenario
    const scenario = await createTestScenario(testDb);
    testRunId = scenario.testRun.test_run_id;

    // Create mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    };

    // Create orchestrator instance
    orchestrator = new PipelineOrchestrator(mockLogger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Sequential Pipeline Execution - Happy Path', () => {
    test('should execute single stage successfully', async () => {
      // Mock metrics pipeline to return success
      const metricsPipelineSpy = vi.spyOn(MetricsPipeline.prototype, 'execute')
        .mockResolvedValue({
          success: true,
          duration: 1000,
          stage: 'metrics-collection',
          data: {
            testRunId,
            metricsCollected: 100,
            panels: 5
          }
        });

      // Execute single stage
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection']
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.completedStages).toBe(1);
      expect(result.data.failedStages).toBe(0);
      expect(result.data.testRunId).toBe(testRunId);
      expect(metricsPipelineSpy).toHaveBeenCalledWith({ testRunId });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Starting stage: metrics-collection'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('completed'));
    });

    test('should execute multiple stages in correct sequence', async () => {
      const stages = ['metrics-collection', 'statistics-calculation', 'adapt-analysis'];
      const executionOrder: string[] = [];

      // Mock all pipelines
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockImplementation(async () => {
        executionOrder.push('metrics-collection');
        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true, duration: 1000, stage: 'metrics-collection' };
      });

      vi.spyOn(StatisticsPipeline.prototype, 'execute').mockImplementation(async () => {
        executionOrder.push('statistics-calculation');
        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true, duration: 800, stage: 'statistics-calculation' };
      });

      vi.spyOn(AdaptPipeline.prototype, 'execute').mockImplementation(async () => {
        executionOrder.push('adapt-analysis');
        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true, duration: 1200, stage: 'adapt-analysis' };
      });

      // Execute
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert execution order
      expect(executionOrder).toEqual(['metrics-collection', 'statistics-calculation', 'adapt-analysis']);
      expect(result.success).toBe(true);
      expect(result.data.completedStages).toBe(3);
      expect(result.data.failedStages).toBe(0);
      expect(result.data.stages).toHaveLength(3);

      // Verify each stage has timing data
      result.data.stages.forEach((stage: any) => {
        expect(stage.duration).toBeGreaterThan(0);
        expect(stage.result.success).toBe(true);
      });
    });

    test('should execute all standard stages in correct order', async () => {
      const stages = [
        'dynatrace-collection',
        'panels-processing',
        'metrics-collection',
        'statistics-calculation',
        'control-groups-creation',
        'control-group-statistics',
        'checks-evaluation',
        'adapt-analysis'
      ];

      // Mock all pipelines
      const mockSuccess = { success: true, duration: 100 };
      vi.spyOn(DynatracePipeline.prototype, 'execute').mockResolvedValue(mockSuccess);
      vi.spyOn(PanelsPipeline.prototype, 'execute').mockResolvedValue(mockSuccess);
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockResolvedValue(mockSuccess);
      vi.spyOn(StatisticsPipeline.prototype, 'execute').mockResolvedValue(mockSuccess);
      vi.spyOn(ControlGroupsPipeline.prototype, 'execute').mockResolvedValue(mockSuccess);
      vi.spyOn(ControlGroupStatisticsPipeline.prototype, 'execute').mockResolvedValue(mockSuccess);
      vi.spyOn(ChecksPipeline.prototype, 'execute').mockResolvedValue(mockSuccess);
      vi.spyOn(AdaptPipeline.prototype, 'execute').mockResolvedValue(mockSuccess);

      // Execute
      const result = await orchestrator.executeSequentialPipeline(testRunId, { stages });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.completedStages).toBe(8);
      expect(result.data.failedStages).toBe(0);
    });

    test('should pass correct input format to each pipeline', async () => {
      const metricsSpy = vi.spyOn(MetricsPipeline.prototype, 'execute').mockResolvedValue({ success: true, duration: 100 });
      const statisticsSpy = vi.spyOn(StatisticsPipeline.prototype, 'execute').mockResolvedValue({ success: true, duration: 100 });
      const checksSpy = vi.spyOn(ChecksPipeline.prototype, 'execute').mockResolvedValue({ success: true, duration: 100 });

      await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection', 'statistics-calculation', 'checks-evaluation']
      });

      // Verify correct input formats
      expect(metricsSpy).toHaveBeenCalledWith({ testRunId }); // Single testRunId
      expect(statisticsSpy).toHaveBeenCalledWith({ testRunIds: [testRunId] }); // Array of testRunIds
      expect(checksSpy).toHaveBeenCalledWith({ testRunIds: [testRunId] }); // Array of testRunIds
    });

    test('should track stage timing accurately', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true, duration: 100 };
      });

      const startTime = Date.now();
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection']
      });
      const endTime = Date.now();

      expect(result.duration).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);
      expect(result.duration).toBeLessThanOrEqual(endTime - startTime + 50); // Allow some overhead
      expect(result.data.stages[0].duration).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Error Handling - Continue Strategy', () => {
    test('should continue execution after stage failure with continue strategy', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockResolvedValue({
        success: false,
        duration: 100,
        error: { message: 'Metrics collection failed', code: 'METRICS_ERROR' }
      });

      vi.spyOn(StatisticsPipeline.prototype, 'execute').mockResolvedValue({
        success: true,
        duration: 100
      });

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection', 'statistics-calculation'],
        errorHandling: 'continue'
      });

      expect(result.success).toBe(false); // Overall failure due to one failed stage
      expect(result.data.completedStages).toBe(1); // Only statistics completed successfully
      expect(result.data.failedStages).toBe(1);
      expect(result.data.stages).toHaveLength(2);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Continuing to next stage'));
    });

    test('should continue through multiple failures with continue strategy', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockResolvedValue({
        success: false,
        error: { message: 'Error 1' }
      });

      vi.spyOn(StatisticsPipeline.prototype, 'execute').mockResolvedValue({
        success: false,
        error: { message: 'Error 2' }
      });

      vi.spyOn(AdaptPipeline.prototype, 'execute').mockResolvedValue({
        success: true,
        duration: 100
      });

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection', 'statistics-calculation', 'adapt-analysis'],
        errorHandling: 'continue'
      });

      expect(result.success).toBe(false);
      expect(result.data.completedStages).toBe(1); // Only adapt succeeded
      expect(result.data.failedStages).toBe(2);
    });
  });

  describe('Error Handling - Abort Strategy', () => {
    test('should abort execution immediately after first failure with abort strategy', async () => {
      const metricsSpy = vi.spyOn(MetricsPipeline.prototype, 'execute').mockResolvedValue({
        success: false,
        error: { message: 'Metrics failed' }
      });

      const statisticsSpy = vi.spyOn(StatisticsPipeline.prototype, 'execute').mockResolvedValue({
        success: true,
        duration: 100
      });

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection', 'statistics-calculation'],
        errorHandling: 'abort'
      });

      expect(result.success).toBe(false);
      expect(result.data.stages).toHaveLength(1); // Only first stage executed
      expect(metricsSpy).toHaveBeenCalled();
      expect(statisticsSpy).not.toHaveBeenCalled(); // Second stage should not execute
    });

    test('should abort on first failure in multi-stage pipeline', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockResolvedValue({ success: true, duration: 100 });
      vi.spyOn(StatisticsPipeline.prototype, 'execute').mockResolvedValue({
        success: false,
        error: { message: 'Statistics failed' }
      });
      const adaptSpy = vi.spyOn(AdaptPipeline.prototype, 'execute').mockResolvedValue({ success: true, duration: 100 });

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection', 'statistics-calculation', 'adapt-analysis'],
        errorHandling: 'abort'
      });

      expect(result.success).toBe(false);
      expect(result.data.stages).toHaveLength(2); // First two stages executed
      expect(adaptSpy).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling - Strict Strategy', () => {
    test('should throw error immediately with strict strategy', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockResolvedValue({
        success: false,
        error: { message: 'Critical failure', code: 'CRITICAL_ERROR' }
      });

      const statisticsSpy = vi.spyOn(StatisticsPipeline.prototype, 'execute');

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection', 'statistics-calculation'],
        errorHandling: 'strict'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Critical failure');
      expect(statisticsSpy).not.toHaveBeenCalled();
    });

    test('should handle thrown exceptions with strict strategy', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockRejectedValue(
        new Error('Pipeline crashed')
      );

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection'],
        errorHandling: 'strict'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Pipeline crashed');
    });
  });

  describe('Timeout Handling', () => {
    test('should timeout long-running stage', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return { success: true, duration: 2000 };
      });

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection'],
        timeoutMs: 500
      });

      expect(result.success).toBe(false);
      expect(result.data.stages[0].result.error?.message).toContain('timed out');
      expect(result.data.stages[0].result.error?.code).toBe('TIMEOUT');
    }, 10000);

    test('should complete before timeout for fast stages', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true, duration: 100 };
      });

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection'],
        timeoutMs: 5000
      });

      expect(result.success).toBe(true);
      expect(result.duration).toBeLessThan(5000);
    });

    test('should timeout only the slow stage in multi-stage pipeline', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true, duration: 100 };
      });

      vi.spyOn(StatisticsPipeline.prototype, 'execute').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return { success: true, duration: 2000 };
      });

      vi.spyOn(AdaptPipeline.prototype, 'execute').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true, duration: 100 };
      });

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection', 'statistics-calculation', 'adapt-analysis'],
        errorHandling: 'continue',
        timeoutMs: 500
      });

      expect(result.success).toBe(false); // One stage timed out
      expect(result.data.stages[0].result.success).toBe(true); // First stage succeeded
      expect(result.data.stages[1].result.error?.code).toBe('TIMEOUT'); // Second stage timed out
      expect(result.data.stages[2].result.success).toBe(true); // Third stage succeeded (continue strategy)
    }, 10000);
  });

  describe('Unknown Stage Handling', () => {
    test('should handle unknown stage name gracefully', async () => {
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['unknown-stage'],
        errorHandling: 'continue'
      });

      expect(result.success).toBe(false);
      expect(result.data.stages[0].result.error?.message).toContain('Unknown stage');
      expect(result.data.stages[0].result.error?.code).toBe('UNKNOWN_STAGE');
    });

    test('should continue after unknown stage with continue strategy', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockResolvedValue({
        success: true,
        duration: 100
      });

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['unknown-stage', 'metrics-collection'],
        errorHandling: 'continue'
      });

      expect(result.success).toBe(false); // One stage failed
      expect(result.data.stages).toHaveLength(2);
      expect(result.data.stages[1].result.success).toBe(true); // Second stage succeeded
    });
  });

  describe('Stage Timing and Performance Tracking', () => {
    test('should log stage breakdown with timing percentages', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true, duration: 100 };
      });

      vi.spyOn(StatisticsPipeline.prototype, 'execute').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return { success: true, duration: 200 };
      });

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection', 'statistics-calculation']
      });

      expect(result.data.timings).toBeDefined();
      expect(result.data.timings).toHaveLength(2);
      expect(result.data.timings[0]).toEqual({
        stage: 'metrics-collection',
        duration: expect.any(Number)
      });
      expect(result.data.timings[1]).toEqual({
        stage: 'statistics-calculation',
        duration: expect.any(Number)
      });

      // Verify logger was called with timing breakdown
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('STAGE TIMING BREAKDOWN'));
    });

    test('should track total pipeline duration accurately', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true, duration: 50 };
      });

      vi.spyOn(StatisticsPipeline.prototype, 'execute').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true, duration: 50 };
      });

      vi.spyOn(AdaptPipeline.prototype, 'execute').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true, duration: 50 };
      });

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection', 'statistics-calculation', 'adapt-analysis']
      });

      // Total duration should be sum of all stages plus overhead
      const totalStageDuration = result.data.timings.reduce((sum: number, t: any) => sum + t.duration, 0);
      expect(result.duration).toBeGreaterThanOrEqual(totalStageDuration);
      expect(result.duration).toBeLessThan(totalStageDuration + 1000); // Allow max 1s overhead
    });
  });

  describe('Batch Processing', () => {
    test('should throw not implemented error for batch processing', async () => {
      await expect(
        orchestrator.executeBatchProcessing(['test-run-1', 'test-run-2'])
      ).rejects.toThrow('Batch processing not yet implemented');
    });

    test('should throw not implemented error for re-evaluation', async () => {
      await expect(
        orchestrator.executeReevaluationBatch(['test-run-1', 'test-run-2'])
      ).rejects.toThrow('Re-evaluation not yet implemented');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty stages array', async () => {
      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: []
      });

      expect(result.success).toBe(true);
      expect(result.data.completedStages).toBe(0);
      expect(result.data.failedStages).toBe(0);
      expect(result.data.stages).toHaveLength(0);
    });

    test('should handle pipeline returning undefined stage', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockResolvedValue({
        success: true,
        duration: 100
        // No stage property
      } as any);

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection']
      });

      expect(result.success).toBe(true);
    });

    test('should handle pipeline returning partial result', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockResolvedValue({
        success: true
        // Missing duration and other fields
      } as any);

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection']
      });

      expect(result.success).toBe(true);
      expect(result.data.completedStages).toBe(1);
    });

    test('should handle very fast pipeline execution', async () => {
      vi.spyOn(MetricsPipeline.prototype, 'execute').mockResolvedValue({
        success: true,
        duration: 0
      });

      const result = await orchestrator.executeSequentialPipeline(testRunId, {
        stages: ['metrics-collection']
      });

      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
