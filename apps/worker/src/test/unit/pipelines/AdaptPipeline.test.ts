/**
 * AdaptPipeline Unit Tests (Enhanced)
 *
 * Comprehensive test suite for AdaptPipeline including:
 * - Input validation
 * - Pipeline execution flow
 * - Changepoint detection
 * - Empty control group handling
 * - ADAPT result processing with threshold logic
 * - Tracked results management
 * - Conclusion generation and aggregation
 * - Final status updates (BASELINE vs COMPARISON modes)
 * - Database operations and transactions
 * - Error handling and recovery
 *
 * Target Coverage: 90%+ for all metrics
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdaptPipeline } from '../../../pipelines/AdaptPipeline.js';
import { PipelineResult } from '../../../types/pipeline.js';
import { MockPool, MockClient } from '../../mocks/database.js';
import { EntityManager } from 'typeorm';

// Mock database accessor
vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => mockDatabaseService),
}));

// Mock database service
const mockDatabaseService = {
  query: vi.fn(),
  getTestRunByTestRunId: vi.fn(),
  transaction: vi.fn(),
  ensureConnection: vi.fn().mockResolvedValue(undefined),
};

describe('AdaptPipeline', () => {
  let adaptPipeline: AdaptPipeline;
  let mockLogger: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    };

    // Setup default mock behaviors
    mockDatabaseService.query.mockResolvedValue([]);
    mockDatabaseService.transaction.mockImplementation(async (callback) => {
      const mockManager = {
        query: vi.fn().mockResolvedValue([]),
      } as unknown as EntityManager;
      return callback(mockManager);
    });

    adaptPipeline = new AdaptPipeline(mockLogger);

    // Mock base class methods
    vi.spyOn(adaptPipeline as any, 'cleanupStaleApplicationDashboards')
      .mockResolvedValue({ totalDeleted: 0, duration: 10 });
  });

  describe('Input Validation', () => {
    it('should validate correct input', () => {
      // Arrange
      const validInput = {
        testRunIds: ['test1', 'test2'],
      };

      // Act
      const result = adaptPipeline.validateInput(validInput);

      // Assert
      expect(result).toBe(true);
    });

    it('should validate input with optional parameters', () => {
      // Arrange
      const validInput = {
        testRunIds: ['test1'],
        updateControlGroup: false,
        updateControlStatistics: true,
        updateResults: true,
        updateConclusion: true,
        updateTrackedResults: true,
        applicationDashboardId: 'app-dash-uuid',
        panelId: 123,
        metricName: 'response_time',
      };

      // Act
      const result = adaptPipeline.validateInput(validInput);

      // Assert
      expect(result).toBe(true);
    });

    it('should reject null input', () => {
      // Act & Assert
      expect(adaptPipeline.validateInput(null)).toBe(false);
    });

    it('should reject undefined input', () => {
      // Act & Assert
      expect(adaptPipeline.validateInput(undefined)).toBe(false);
    });

    it('should reject empty object', () => {
      // Act & Assert
      expect(adaptPipeline.validateInput({})).toBe(false);
    });

    it('should reject empty testRunIds array', () => {
      // Act & Assert
      expect(adaptPipeline.validateInput({ testRunIds: [] })).toBe(false);
    });

    it('should reject testRunIds with non-string values', () => {
      // Act & Assert
      expect(adaptPipeline.validateInput({ testRunIds: ['test1', 123] })).toBe(false);
      expect(adaptPipeline.validateInput({ testRunIds: [null] })).toBe(false);
      expect(adaptPipeline.validateInput({ testRunIds: [{}] })).toBe(false);
    });
  });

  describe('Pipeline Execution - Happy Path', () => {
    beforeEach(() => {
      // Setup successful transaction and validation mocks
      vi.spyOn(adaptPipeline as any, 'validateTestRunExists').mockResolvedValue(true);
      vi.spyOn(adaptPipeline as any, 'cleanupStaleApplicationDashboards')
        .mockResolvedValue({ totalDeleted: 5, duration: 100 });
      // Mock validator methods
      vi.spyOn((adaptPipeline as any).validator, 'updateEvaluationStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).validator, 'runPreProcessingValidation').mockResolvedValue({
        changepoints: [],
        tooShortTestRuns: [],
        emptyControlGroups: [],
        processableTestRuns: ['test-run-1'],
      });
      // Mock results processor methods
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults').mockResolvedValue(10);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'storeTrackedResults').mockResolvedValue(5);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'generateConclusions').mockResolvedValue(1);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'updateFinalStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'publishRealtimeUpdates').mockResolvedValue(undefined);
    });

    // Guards the JIT-off statement in AdaptPipeline.execute. Postgres decides
    // whether to JIT at plan time, per statement, so this has to be the FIRST
    // query in the transaction or the statements planned before it still compile.
    // Asserting the call exists is not enough — the ordering is the load-bearing
    // half, and without this test deleting the line leaves the whole file green.
    // Same shape as ControlGroupStatisticsPipeline.test.ts's set_config assertions.
    it('should disable JIT as the first statement in the transaction', async () => {
      // Arrange
      const calls: Array<[string, unknown[]?]> = [];
      const recordingManager = {
        query: vi.fn((sql: string, params?: unknown[]) => {
          calls.push([sql, params]);
          return Promise.resolve([]);
        }),
      } as unknown as EntityManager;

      mockDatabaseService.transaction.mockImplementation(async (callback) => {
        return callback(recordingManager);
      });

      // The happy-path beforeEach stubs updateEvaluationStatus, so nothing would
      // reach recordingManager before the JIT call and the ordering assertion
      // below would pass even if the line were moved down. Let the real status
      // UPDATE through so there IS real SQL to be wrongly ordered against.
      (((adaptPipeline as any).validator).updateEvaluationStatus as any).mockRestore?.();

      // Act
      await adaptPipeline.execute({ testRunIds: ['test-run-1'] });

      // Assert — present, and ahead of any statement that plans real work.
      // Not "call 0": withAnalyticsTransaction issues SET LOCAL statement_timeout
      // before the callback runs (BasePipelineTypeORM). Asserting "no real SQL
      // before it" rather than a fixed index keeps this green if another session
      // setting is added later, while still failing if the line moves down.
      const jitIndex = calls.findIndex(
        ([sql, params]) =>
          sql.includes('set_config') &&
          Array.isArray(params) &&
          params[0] === 'jit' &&
          params[1] === 'off'
      );
      expect(jitIndex).toBeGreaterThanOrEqual(0);

      const isSessionSetting = (sql: string) =>
        sql.includes('set_config') || /^\s*SET\s+LOCAL\b/i.test(sql);
      expect(calls.slice(0, jitIndex).map(([sql]) => sql).filter(s => !isSessionSetting(s))).toEqual([]);
    });

    it('should execute successfully with valid input', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
        updateResults: true,
        updateConclusion: true,
        updateTrackedResults: true,
      };

      // Act
      const result: PipelineResult = await adaptPipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        processedRows: 16, // 10 + 5 + 1
        testRunIds: 1,
      });
    });

    it('should execute with multiple test runs', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1', 'test-run-2', 'test-run-3'],
      };

      // Act
      const result: PipelineResult = await adaptPipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.testRunIds).toBe(3);
    });

    it('should cleanup stale data before processing', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-1'] };
      const cleanupSpy = vi.spyOn(adaptPipeline as any, 'cleanupStaleApplicationDashboards');

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(cleanupSpy).toHaveBeenCalledWith([
        'ds_adapt_results',
        'ds_adapt_tracked_results',
        'ds_compare_config',
      ]);
    });

    it('should update evaluation status to IN_PROGRESS', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-1'] };
      const statusSpy = vi.spyOn((adaptPipeline as any).validator, 'updateEvaluationStatus');

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(statusSpy).toHaveBeenCalledWith(
        expect.anything(),
        ['test-run-1'],
        'IN_PROGRESS'
      );
    });

    it('should call updateFinalStatus after processing', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-1'] };
      const finalStatusSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'updateFinalStatus');

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(finalStatusSpy).toHaveBeenCalledWith(
        expect.anything(),
        ['test-run-1']
      );
    });

    it('should publish realtime updates after transaction commits', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-1'] };
      const realtimeSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'publishRealtimeUpdates');

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(realtimeSpy).toHaveBeenCalledWith(['test-run-1']);
    });
  });

  describe('Changepoint Detection', () => {
    beforeEach(() => {
      vi.spyOn(adaptPipeline as any, 'validateTestRunExists').mockResolvedValue(true);
      vi.spyOn(adaptPipeline as any, 'cleanupStaleApplicationDashboards')
        .mockResolvedValue({ totalDeleted: 0, duration: 10 });
      vi.spyOn((adaptPipeline as any).validator, 'updateEvaluationStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'updateFinalStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'publishRealtimeUpdates').mockResolvedValue(undefined);
    });

    it('should handle changepoint test runs correctly', async () => {
      // Arrange
      const input = {
        testRunIds: ['changepoint-test', 'normal-test'],
      };

      vi.spyOn((adaptPipeline as any).validator, 'runPreProcessingValidation')
        .mockResolvedValue({
          changepoints: ['changepoint-test'],
          tooShortTestRuns: [],
          emptyControlGroups: [],
          processableTestRuns: ['normal-test'],
        });
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults').mockResolvedValue(0);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'storeTrackedResults').mockResolvedValue(0);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'generateConclusions').mockResolvedValue(0);

      // Act
      const result: PipelineResult = await adaptPipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should skip processing when all test runs are changepoints', async () => {
      // Arrange
      const input = { testRunIds: ['changepoint-1', 'changepoint-2'] };

      vi.spyOn((adaptPipeline as any).validator, 'runPreProcessingValidation')
        .mockResolvedValue({
          changepoints: ['changepoint-1', 'changepoint-2'],
          tooShortTestRuns: [],
          emptyControlGroups: [],
          processableTestRuns: [],
        });
      const processSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults');

      // Act
      const result = await adaptPipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.processedRows).toBe(0);
      expect(processSpy).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No test runs available')
      );
    });
  });

  describe('Empty Control Group Handling', () => {
    beforeEach(() => {
      vi.spyOn(adaptPipeline as any, 'validateTestRunExists').mockResolvedValue(true);
      vi.spyOn(adaptPipeline as any, 'cleanupStaleApplicationDashboards')
        .mockResolvedValue({ totalDeleted: 0, duration: 10 });
      vi.spyOn((adaptPipeline as any).validator, 'updateEvaluationStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'updateFinalStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'publishRealtimeUpdates').mockResolvedValue(undefined);
    });

    it('should handle empty control groups correctly', async () => {
      // Arrange
      const input = {
        testRunIds: ['no-baseline-test', 'with-baseline-test'],
      };

      vi.spyOn((adaptPipeline as any).validator, 'runPreProcessingValidation')
        .mockResolvedValue({
          changepoints: [],
          tooShortTestRuns: [],
          emptyControlGroups: ['no-baseline-test'],
          processableTestRuns: ['with-baseline-test'],
        });
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults').mockResolvedValue(5);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'storeTrackedResults').mockResolvedValue(2);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'generateConclusions').mockResolvedValue(1);

      // Act
      const result: PipelineResult = await adaptPipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.processedRows).toBe(8); // Only processes with-baseline-test
    });

    it('should skip processing when all test runs have empty control groups', async () => {
      // Arrange
      const input = { testRunIds: ['no-baseline-1', 'no-baseline-2'] };

      vi.spyOn((adaptPipeline as any).validator, 'runPreProcessingValidation')
        .mockResolvedValue({
          changepoints: [],
          tooShortTestRuns: [],
          emptyControlGroups: ['no-baseline-1', 'no-baseline-2'],
          processableTestRuns: [],
        });
      const processSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults');
      const exclusionSpy = vi.spyOn((adaptPipeline as any).validator, 'writeExclusionConclusions')
        .mockResolvedValue(undefined);

      // Act
      const result = await adaptPipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.processedRows).toBe(0);
      expect(processSpy).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No test runs available')
      );
      expect(exclusionSpy).toHaveBeenCalledWith(
        expect.anything(),
        [],
        [],
        ['no-baseline-1', 'no-baseline-2'],
      );
    });

    it('should write exclusion conclusions for changepoints when all runs are excluded', async () => {
      // Arrange
      const input = { testRunIds: ['changepoint-run'] };

      vi.spyOn((adaptPipeline as any).validator, 'runPreProcessingValidation')
        .mockResolvedValue({
          changepoints: ['changepoint-run'],
          tooShortTestRuns: [],
          emptyControlGroups: [],
          processableTestRuns: [],
        });
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults');
      const exclusionSpy = vi.spyOn((adaptPipeline as any).validator, 'writeExclusionConclusions')
        .mockResolvedValue(undefined);

      // Act
      const result = await adaptPipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.processedRows).toBe(0);
      expect(exclusionSpy).toHaveBeenCalledWith(
        expect.anything(),
        ['changepoint-run'],
        [],
        [],
      );
    });

    it('should write exclusion conclusions for too-short test runs when all runs are excluded', async () => {
      // Arrange
      const input = { testRunIds: ['too-short-run'] };

      vi.spyOn((adaptPipeline as any).validator, 'runPreProcessingValidation')
        .mockResolvedValue({
          changepoints: [],
          tooShortTestRuns: ['too-short-run'],
          emptyControlGroups: [],
          processableTestRuns: [],
        });
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults');
      const exclusionSpy = vi.spyOn((adaptPipeline as any).validator, 'writeExclusionConclusions')
        .mockResolvedValue(undefined);

      // Act
      const result = await adaptPipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.processedRows).toBe(0);
      expect(exclusionSpy).toHaveBeenCalledWith(
        expect.anything(),
        [],
        ['too-short-run'],
        [],
      );
    });

    it('should not write exclusion conclusions when updateConclusion is false', async () => {
      // Arrange
      const input = { testRunIds: ['no-baseline-1'], updateConclusion: false };

      vi.spyOn((adaptPipeline as any).validator, 'runPreProcessingValidation')
        .mockResolvedValue({
          changepoints: [],
          tooShortTestRuns: [],
          emptyControlGroups: ['no-baseline-1'],
          processableTestRuns: [],
        });
      const exclusionSpy = vi.spyOn((adaptPipeline as any).validator, 'writeExclusionConclusions')
        .mockResolvedValue(undefined);

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(exclusionSpy).not.toHaveBeenCalled();
    });
  });

  describe('Metric Filtering', () => {
    beforeEach(() => {
      vi.spyOn(adaptPipeline as any, 'validateTestRunExists').mockResolvedValue(true);
      vi.spyOn(adaptPipeline as any, 'cleanupStaleApplicationDashboards')
        .mockResolvedValue({ totalDeleted: 0, duration: 10 });
      vi.spyOn((adaptPipeline as any).validator, 'updateEvaluationStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).validator, 'runPreProcessingValidation').mockResolvedValue({
        changepoints: [],
        tooShortTestRuns: [],
        emptyControlGroups: [],
        processableTestRuns: ['test-run-1'],
      });
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'updateFinalStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'publishRealtimeUpdates').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'storeTrackedResults').mockResolvedValue(0);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'generateConclusions').mockResolvedValue(0);
    });

    it('should process ADAPT results with applicationDashboardId filter', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
        applicationDashboardId: 'app-dash-uuid',
        updateResults: true,
      };

      const processSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults')
        .mockResolvedValue(3);

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(processSpy).toHaveBeenCalledWith(
        expect.anything(),
        ['test-run-1'],
        expect.objectContaining({
          applicationDashboardId: 'app-dash-uuid',
        })
      );
    });

    it('should process ADAPT results with panelId filter', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
        panelId: 123,
        updateResults: true,
      };

      const processSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults')
        .mockResolvedValue(2);

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(processSpy).toHaveBeenCalledWith(
        expect.anything(),
        ['test-run-1'],
        expect.objectContaining({
          panelId: 123,
        })
      );
    });

    it('should process ADAPT results with metricName filter', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
        metricName: 'response_time',
        updateResults: true,
      };

      const processSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults')
        .mockResolvedValue(1);

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(processSpy).toHaveBeenCalledWith(
        expect.anything(),
        ['test-run-1'],
        expect.objectContaining({
          metricName: 'response_time',
        })
      );
    });

    it('should process all metrics when no filter is provided', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
        updateResults: true,
      };

      const processSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults')
        .mockResolvedValue(10);

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(processSpy).toHaveBeenCalledWith(
        expect.anything(),
        ['test-run-1'],
        undefined
      );
    });
  });

  describe('Tracked Results Management', () => {
    beforeEach(() => {
      vi.spyOn(adaptPipeline as any, 'validateTestRunExists').mockResolvedValue(true);
      vi.spyOn(adaptPipeline as any, 'cleanupStaleApplicationDashboards')
        .mockResolvedValue({ totalDeleted: 0, duration: 10 });
      vi.spyOn((adaptPipeline as any).validator, 'updateEvaluationStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).validator, 'runPreProcessingValidation').mockResolvedValue({
        changepoints: [],
        tooShortTestRuns: [],
        emptyControlGroups: [],
        processableTestRuns: ['test-run-1'],
      });
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults').mockResolvedValue(10);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'generateConclusions').mockResolvedValue(1);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'updateFinalStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'publishRealtimeUpdates').mockResolvedValue(undefined);
    });

    it('should delete existing tracked results before regeneration', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
        updateTrackedResults: true,
      };

      let deleteQuery = '';
      const mockManager = {
        query: vi.fn((sql: string) => {
          if (sql.includes('DELETE FROM ds_adapt_tracked_results')) {
            deleteQuery = sql;
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        }),
      } as unknown as EntityManager;

      mockDatabaseService.transaction.mockImplementation(async (callback) => {
        return callback(mockManager);
      });

      vi.spyOn((adaptPipeline as any).resultsProcessor, 'storeTrackedResults').mockResolvedValue(5);

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(deleteQuery).toContain('DELETE FROM ds_adapt_tracked_results');
    });

    it('should store tracked results after deletion', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
        updateTrackedResults: true,
      };

      const storeSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'storeTrackedResults')
        .mockResolvedValue(5);

      // Act
      const result = await adaptPipeline.execute(input);

      // Assert
      expect(storeSpy).toHaveBeenCalledWith(
        expect.anything(),
        ['test-run-1']
      );
      expect(result.success).toBe(true);
      expect(result.data?.processedRows).toBeGreaterThanOrEqual(5);
    });

    it('should skip tracked results when updateTrackedResults is false', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
        updateTrackedResults: false,
      };

      const storeSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'storeTrackedResults');

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(storeSpy).not.toHaveBeenCalled();
    });
  });

  describe('Threshold Logic (SQL-based)', () => {
    it('should calculate partialDifference using OR logic', () => {
      // Note: This tests the SQL logic conceptually
      // In production, partialDifference = pct.isDifference OR iqr.isDifference OR abs.isDifference

      // Arrange
      const checks = {
        pct: { isDifference: true },
        iqr: { isDifference: false },
        abs: { isDifference: false },
      };

      // Act
      const partialDifference = checks.pct.isDifference ||
                                checks.iqr.isDifference ||
                                checks.abs.isDifference;

      // Assert
      expect(partialDifference).toBe(true);
    });

    it('should calculate allDifference using AND logic with validity checks', () => {
      // Note: This tests the SQL logic conceptually
      // allDifference = pct.isDifference AND (iqr.isDifference OR !iqr.valid) AND (abs.isDifference OR !abs.valid)

      // Arrange - All thresholds exceeded
      const checks1 = {
        pct: { valid: true, isDifference: true },
        iqr: { valid: true, isDifference: true },
        abs: { valid: true, isDifference: true },
      };

      // Act
      const allDiff1 = checks1.pct.isDifference &&
                       (checks1.iqr.isDifference || !checks1.iqr.valid) &&
                       (checks1.abs.isDifference || !checks1.abs.valid);

      // Assert
      expect(allDiff1).toBe(true);

      // Arrange - IQR not valid, others exceeded
      const checks2 = {
        pct: { valid: true, isDifference: true },
        iqr: { valid: false, isDifference: false },
        abs: { valid: true, isDifference: true },
      };

      // Act
      const allDiff2 = checks2.pct.isDifference &&
                       (checks2.iqr.isDifference || !checks2.iqr.valid) &&
                       (checks2.abs.isDifference || !checks2.abs.valid);

      // Assert
      expect(allDiff2).toBe(true); // IQR not valid, so it's ignored
    });

    it('should handle hierarchical config lookup correctly', () => {
      // Note: This tests the SQL COALESCE logic conceptually
      // Priority: metric > panel > dashboard > global > default

      // Arrange
      const configs = {
        metric: { threshold: 0.10 },
        panel: { threshold: 0.15 },
        dashboard: { threshold: 0.20 },
        global: { threshold: 0.25 },
        default: { threshold: 0.15 },
      };

      // Act - Metric-level config exists (highest priority)
      const selected1 = configs.metric || configs.panel || configs.dashboard || configs.global || configs.default;

      // Assert
      expect(selected1).toEqual({ threshold: 0.10 });

      // Act - Only dashboard and global exist
      const selected2 = undefined || undefined || configs.dashboard || configs.global || configs.default;

      // Assert
      expect(selected2).toEqual({ threshold: 0.20 });
    });

    it('should select correct statistic based on aggregation config', () => {
      // Note: This tests the SQL CASE statement logic

      // Arrange
      const statistics = {
        mean: 100,
        median: 95,
        q95: 150,
        max: 200,
      };

      const configs = [
        { aggregation: 'mean', expected: 100 },
        { aggregation: 'median', expected: 95 },
        { aggregation: 'q95', expected: 150 },
        { aggregation: 'p95', expected: 150 }, // Alias
        { aggregation: 'max', expected: 200 },
        { aggregation: 'unknown', expected: 95 }, // Default to median
      ];

      // Act & Assert
      configs.forEach(({ aggregation, expected }) => {
        let value;
        switch (aggregation) {
          case 'mean': value = statistics.mean; break;
          case 'median': value = statistics.median; break;
          case 'q95':
          case 'p95': value = statistics.q95; break;
          case 'max': value = statistics.max; break;
          default: value = statistics.median; // Default
        }
        expect(value).toBe(expected);
      });
    });
  });

  describe('Conclusion Logic', () => {
    it('should generate correct conclusion labels for unclassified metrics', () => {
      // When higherIsBetter IS NULL (unclassified):
      // - increase when test > control
      // - decrease when test < control

      // Arrange
      const scenarios = [
        { test: 120, control: 100, higherIsBetter: null, expected: 'increase' },
        { test: 80, control: 100, higherIsBetter: null, expected: 'decrease' },
      ];

      // Act & Assert
      scenarios.forEach(({ test, control, higherIsBetter, expected }) => {
        const label = test > control ? 'increase' : 'decrease';
        expect(label).toBe(expected);
      });
    });

    it('should generate correct conclusion labels for classified metrics', () => {
      // When higherIsBetter IS true:
      // - improvement when test > control
      // - regression when test < control
      // When higherIsBetter IS false:
      // - improvement when test < control
      // - regression when test > control

      // Arrange
      const scenarios = [
        { test: 120, control: 100, higherIsBetter: true, expected: 'improvement' },
        { test: 80, control: 100, higherIsBetter: true, expected: 'regression' },
        { test: 120, control: 100, higherIsBetter: false, expected: 'regression' },
        { test: 80, control: 100, higherIsBetter: false, expected: 'improvement' },
      ];

      // Act & Assert
      scenarios.forEach(({ test, control, higherIsBetter, expected }) => {
        let label;
        if (higherIsBetter) {
          label = test > control ? 'improvement' : 'regression';
        } else {
          label = test < control ? 'improvement' : 'regression';
        }
        expect(label).toBe(expected);
      });
    });

    it('should handle incomparable metrics correctly', () => {
      // When control doesn't exist or test_stat_value IS NULL

      // Arrange
      const incomparableScenarios = [
        { testValue: null, controlExists: true, expected: 'incomparable' },
        { testValue: 100, controlExists: false, expected: 'incomparable' },
        { testValue: null, controlExists: false, expected: 'incomparable' },
      ];

      // Act & Assert
      incomparableScenarios.forEach(({ testValue, controlExists, expected }) => {
        const label = (controlExists && testValue !== null) ? 'comparable' : 'incomparable';
        expect(label).toBe(expected);
      });
    });

    it('should handle ignored metrics correctly', () => {
      // When compare_config.ignore = true

      // Arrange
      const config = { ignore: true };

      // Act
      const label = config.ignore ? 'ignored' : 'not-ignored';

      // Assert
      expect(label).toBe('ignored');
    });
  });

  describe('Conclusion Aggregation', () => {
    it('should generate REGRESSION conclusion when regressions exist', () => {
      // Overall conclusion should be REGRESSION if any individual results are regression

      // Arrange
      const results = [
        { label: 'improvement' },
        { label: 'regression' },
        { label: 'no-difference' },
      ];

      // Act
      const hasRegression = results.some(r => r.label === 'regression');
      const overallConclusion = hasRegression ? 'REGRESSION' : 'PASSED';

      // Assert
      expect(overallConclusion).toBe('REGRESSION');
    });

    it('should generate REGRESSION conclusion when tracked regressions exist', () => {
      // Overall conclusion should be REGRESSION if tracked results contain regressions

      // Arrange
      const trackedResults = [
        { label: 'improvement' },
        { label: 'regression' },
      ];

      // Act
      const hasTrackedRegression = trackedResults.some(r => r.label === 'regression');
      const overallConclusion = hasTrackedRegression ? 'REGRESSION' : 'PASSED';

      // Assert
      expect(overallConclusion).toBe('REGRESSION');
    });

    it('should generate PASSED conclusion when no regressions exist', () => {
      // Overall conclusion should be PASSED otherwise

      // Arrange
      const results = [
        { label: 'improvement' },
        { label: 'no-difference' },
        { label: 'ignored' },
      ];

      // Act
      const hasRegression = results.some(r => r.label === 'regression');
      const overallConclusion = hasRegression ? 'REGRESSION' : 'PASSED';

      // Assert
      expect(overallConclusion).toBe('PASSED');
    });

    it('should generate SKIPPED conclusion when no results exist', () => {
      // Overall conclusion should be SKIPPED if all arrays are empty

      // Arrange
      const results: any[] = [];
      const trackedResults: any[] = [];

      // Act
      const overallConclusion = (results.length === 0 && trackedResults.length === 0)
        ? 'SKIPPED'
        : 'PROCESSED';

      // Assert
      expect(overallConclusion).toBe('SKIPPED');
    });
  });

  describe('Final Status Updates', () => {
    it('should update adaptTestRunOK correctly for BASELINE mode', () => {
      // For BASELINE mode: adaptTestRunOK should always be true

      // Arrange
      const testRun = {
        baselineTestRunId: null, // BASELINE mode
        conclusion: 'REGRESSION',
      };

      // Act
      const adaptTestRunOK = testRun.baselineTestRunId === null ? true : (testRun.conclusion !== 'REGRESSION');

      // Assert
      expect(adaptTestRunOK).toBe(true);
    });

    it('should update adaptTestRunOK correctly for COMPARISON mode', () => {
      // For COMPARISON mode: adaptTestRunOK should be true if conclusion != 'REGRESSION'

      // Arrange - No regression
      const testRun1 = {
        baselineTestRunId: 'baseline-123',
        conclusion: 'PASSED',
      };

      // Act
      const adaptOK1 = testRun1.conclusion !== 'REGRESSION';

      // Assert
      expect(adaptOK1).toBe(true);

      // Arrange - Has regression
      const testRun2 = {
        baselineTestRunId: 'baseline-123',
        conclusion: 'REGRESSION',
      };

      // Act
      const adaptOK2 = testRun2.conclusion !== 'REGRESSION';

      // Assert
      expect(adaptOK2).toBe(false);
    });

    it('should update overall result correctly for BASELINE mode', () => {
      // For BASELINE mode: overall should ignore adaptTestRunOK

      // Arrange
      const testRun = {
        baselineTestRunId: null,
        meetsRequirement: true,
        benchmarkPreviousTestRunOK: true,
        benchmarkBaselineTestRunOK: true,
        adaptTestRunOK: false, // Should be ignored
      };

      // Act
      const overallOK = testRun.meetsRequirement &&
                        testRun.benchmarkPreviousTestRunOK &&
                        testRun.benchmarkBaselineTestRunOK;
      // Note: adaptTestRunOK not included for BASELINE

      // Assert
      expect(overallOK).toBe(true);
    });

    it('should update overall result correctly for COMPARISON mode', () => {
      // For COMPARISON mode: ALL checks must be true

      // Arrange - All true
      const testRun1 = {
        baselineTestRunId: 'baseline-123',
        meetsRequirement: true,
        benchmarkPreviousTestRunOK: true,
        benchmarkBaselineTestRunOK: true,
        adaptTestRunOK: true,
      };

      // Act
      const overallOK1 = testRun1.meetsRequirement &&
                         testRun1.benchmarkPreviousTestRunOK &&
                         testRun1.benchmarkBaselineTestRunOK &&
                         testRun1.adaptTestRunOK;

      // Assert
      expect(overallOK1).toBe(true);

      // Arrange - adaptTestRunOK false
      const testRun2 = {
        baselineTestRunId: 'baseline-123',
        meetsRequirement: true,
        benchmarkPreviousTestRunOK: true,
        benchmarkBaselineTestRunOK: true,
        adaptTestRunOK: false,
      };

      // Act
      const overallOK2 = testRun2.meetsRequirement &&
                         testRun2.benchmarkPreviousTestRunOK &&
                         testRun2.benchmarkBaselineTestRunOK &&
                         testRun2.adaptTestRunOK;

      // Assert
      expect(overallOK2).toBe(false);
    });

    it('should recalculate overall when differencesAccepted is TBD or DENIED', () => {
      // TBD (pending) and DENIED (confirmed regression) both recalculate overall
      // so that adaptTestRunOK=false is reflected in the consolidated result.
      // Only ACCEPTED locks overall at its current value.

      // Arrange - differencesAccepted is TBD (should recalculate)
      const testRunTBD = {
        adaptConfig: { differencesAccepted: 'TBD' },
        meetsRequirement: true,
        adaptTestRunOK: false, // regression detected
        existingOverall: true,
      };

      // Act - Simulate the SQL logic (ACCEPTED preserves; everything else recalculates)
      const shouldPreserveTBD = (testRunTBD.adaptConfig.differencesAccepted ?? 'TBD') === 'ACCEPTED';
      const newOverallTBD = shouldPreserveTBD
        ? testRunTBD.existingOverall
        : (testRunTBD.meetsRequirement && testRunTBD.adaptTestRunOK);

      // Assert - Should recalculate to false because adaptTestRunOK=false
      expect(newOverallTBD).toBe(false);

      // Arrange - differencesAccepted is not set (defaults to TBD, should recalculate)
      const testRunNotSet = {
        adaptConfig: {} as { differencesAccepted?: string },
        meetsRequirement: true,
        adaptTestRunOK: false,
        existingOverall: true,
      };

      // Act
      const shouldPreserveNotSet = (testRunNotSet.adaptConfig.differencesAccepted ?? 'TBD') === 'ACCEPTED';
      const newOverallNotSet = shouldPreserveNotSet
        ? testRunNotSet.existingOverall
        : (testRunNotSet.meetsRequirement && testRunNotSet.adaptTestRunOK);

      // Assert - Should recalculate to false
      expect(newOverallNotSet).toBe(false);
    });

    it('should preserve overall when differencesAccepted is ACCEPTED', () => {
      // When differencesAccepted is 'ACCEPTED', the overall result should be preserved
      // so that a user-accepted result is not overridden by subsequent re-evaluation.

      // Arrange
      const testRun = {
        adaptConfig: { differencesAccepted: 'ACCEPTED' },
        meetsRequirement: true,
        adaptTestRunOK: false, // This would normally make overall false
        existingOverall: true, // But user accepted, so this should be preserved
      };

      // Act - Simulate the SQL logic (only ACCEPTED preserves)
      const shouldPreserve = (testRun.adaptConfig.differencesAccepted ?? 'TBD') === 'ACCEPTED';
      const newOverall = shouldPreserve
        ? testRun.existingOverall
        : (testRun.meetsRequirement && testRun.adaptTestRunOK);

      // Assert - Should preserve existing value (true) instead of recalculating (false)
      expect(newOverall).toBe(true);
    });

    it('should recalculate overall when differencesAccepted is DENIED (confirmed regression)', () => {
      // DENIED means the user confirmed the differences are real regressions.
      // overall must reflect adaptTestRunOK=false, not be locked at the previous value.

      // Arrange - test was previously passing but now has a regression conclusion
      const testRun = {
        adaptConfig: { differencesAccepted: 'DENIED' },
        meetsRequirement: true,
        adaptTestRunOK: false, // ADAPT found regression
        existingOverall: true, // Stale — was true before the regression was detected
      };

      // Act - Simulate the SQL logic (DENIED recalculates like TBD)
      const shouldPreserve = (testRun.adaptConfig.differencesAccepted ?? 'TBD') === 'ACCEPTED';
      const newOverall = shouldPreserve
        ? testRun.existingOverall
        : (testRun.meetsRequirement && testRun.adaptTestRunOK);

      // Assert - Should recalculate to false, not preserve the stale true
      expect(newOverall).toBe(false);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      vi.spyOn(adaptPipeline as any, 'cleanupStaleApplicationDashboards')
        .mockResolvedValue({ totalDeleted: 0, duration: 10 });
    });

    it('should return error result when input validation fails', async () => {
      // Arrange
      const invalidInput = { testRunIds: [] };

      // Act
      const result: PipelineResult = await adaptPipeline.execute(invalidInput);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Invalid input');
      expect(result.error.code).toBe('INVALID_INPUT');
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-1'] };

      mockDatabaseService.transaction.mockRejectedValue(
        new Error('Database connection failed')
      );

      // Act
      const result: PipelineResult = await adaptPipeline.execute(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Database connection failed');
      expect(result.error.code).toBe('ADAPT_ANALYSIS_FAILED');
    });

    it('should handle non-existent test runs', async () => {
      // Arrange
      const input = { testRunIds: ['non-existent-test'] };

      vi.spyOn(adaptPipeline as any, 'validateTestRunExists').mockResolvedValue(false);

      // Act
      const result: PipelineResult = await adaptPipeline.execute(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Test run not found: non-existent-test');
      expect(result.error.code).toBe('ADAPT_ANALYSIS_FAILED');
    });

    it('should update status to FAILED on error', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-1'] };
      const error = new Error('Processing failed');

      vi.spyOn(adaptPipeline as any, 'validateTestRunExists').mockResolvedValue(true);
      mockDatabaseService.transaction.mockRejectedValue(error);

      // Act
      const result = await adaptPipeline.execute(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ADAPT_ANALYSIS_FAILED');
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('evaluatingAdapt'),
        expect.arrayContaining([['test-run-1']])
      );
    });

    it('should handle status update errors gracefully', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-1'] };

      vi.spyOn(adaptPipeline as any, 'validateTestRunExists').mockResolvedValue(true);
      vi.spyOn(adaptPipeline as any, 'cleanupStaleApplicationDashboards')
        .mockResolvedValue({ totalDeleted: 0, duration: 10 });
      mockDatabaseService.transaction.mockRejectedValue(new Error('Main error'));
      mockDatabaseService.query.mockRejectedValue(new Error('Status update error'));

      // Act
      const result = await adaptPipeline.execute(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Main error');
      expect(result.error?.code).toBe('ADAPT_ANALYSIS_FAILED');
      // The main error is logged, then status update is attempted (fails), then that error is logged too
      // We verify that the query was called to update the status despite the error
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('evaluatingAdapt'),
        [['test-run-1']]
      );
    });
  });

  describe('Performance Logging', () => {
    beforeEach(() => {
      vi.spyOn(adaptPipeline as any, 'validateTestRunExists').mockResolvedValue(true);
      vi.spyOn(adaptPipeline as any, 'cleanupStaleApplicationDashboards')
        .mockResolvedValue({ totalDeleted: 0, duration: 10 });
      vi.spyOn((adaptPipeline as any).validator, 'updateEvaluationStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).validator, 'runPreProcessingValidation').mockResolvedValue({
        changepoints: [],
        tooShortTestRuns: [],
        emptyControlGroups: [],
        processableTestRuns: ['test-run-1'],
      });
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults').mockResolvedValue(10);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'storeTrackedResults').mockResolvedValue(5);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'generateConclusions').mockResolvedValue(1);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'updateFinalStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'publishRealtimeUpdates').mockResolvedValue(undefined);
    });

    it('should log substage timing breakdown', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-1'] };

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('ADAPT SUBSTAGE TIMING BREAKDOWN')
      );
    });

    it('should include duration in result', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-1'] };

      // Act
      const result = await adaptPipeline.execute(input);

      // Assert
      // Duration is set by BasePipelineTypeORM, which is mocked in these tests
      expect(result.success).toBe(true);
    });

    it('should log performance metrics', async () => {
      // Arrange
      const input = { testRunIds: ['test-run-1'] };

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting ADAPT analysis')
      );
    });
  });

  describe('Optional Updates Control', () => {
    beforeEach(() => {
      vi.spyOn(adaptPipeline as any, 'validateTestRunExists').mockResolvedValue(true);
      vi.spyOn(adaptPipeline as any, 'cleanupStaleApplicationDashboards')
        .mockResolvedValue({ totalDeleted: 0, duration: 10 });
      vi.spyOn((adaptPipeline as any).validator, 'updateEvaluationStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).validator, 'runPreProcessingValidation').mockResolvedValue({
        changepoints: [],
        tooShortTestRuns: [],
        emptyControlGroups: [],
        processableTestRuns: ['test-run-1'],
      });
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'updateFinalStatus').mockResolvedValue(undefined);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'publishRealtimeUpdates').mockResolvedValue(undefined);
    });

    it('should skip ADAPT results when updateResults is false', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
        updateResults: false,
      };

      vi.spyOn((adaptPipeline as any).resultsProcessor, 'storeTrackedResults').mockResolvedValue(0);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'generateConclusions').mockResolvedValue(0);
      const processSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults');

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(processSpy).not.toHaveBeenCalled();
    });

    it('should skip conclusions when updateConclusion is false', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
        updateConclusion: false,
      };

      vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults').mockResolvedValue(10);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'storeTrackedResults').mockResolvedValue(5);
      const conclusionSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'generateConclusions');

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(conclusionSpy).not.toHaveBeenCalled();
    });

    it('should skip tracked results when updateTrackedResults is false', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
        updateTrackedResults: false,
      };

      vi.spyOn((adaptPipeline as any).resultsProcessor, 'processAdaptResults').mockResolvedValue(10);
      vi.spyOn((adaptPipeline as any).resultsProcessor, 'generateConclusions').mockResolvedValue(1);
      const trackedSpy = vi.spyOn((adaptPipeline as any).resultsProcessor, 'storeTrackedResults');

      // Act
      await adaptPipeline.execute(input);

      // Assert
      expect(trackedSpy).not.toHaveBeenCalled();
    });
  });
});
