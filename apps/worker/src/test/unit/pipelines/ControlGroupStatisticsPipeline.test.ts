/**
 * ControlGroupStatisticsPipeline Unit Tests
 *
 * Tests the ControlGroupStatisticsPipeline class functionality including:
 * - Input validation
 * - Pipeline execution flow
 * - Control group statistics calculation
 * - Database operations and transactions
 * - Error handling
 * - Edge cases (no control groups, no metrics, empty control runs)
 *
 * This pipeline calculates statistics for control groups by aggregating metrics
 * from control test runs. It uses TimescaleDB/PostgreSQL aggregations on raw
 * metrics data to compute mean, median, percentiles, and other statistical measures.
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { ControlGroupStatisticsPipeline, ControlGroupStatisticsInput } from '../../../pipelines/ControlGroupStatisticsPipeline.js';
import { EntityManager } from 'typeorm';
import type { Logger } from 'pino';

// Mock the database accessor module
vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => mockDatabaseService)
}));

// Create mock database service
const mockDatabaseService = {
  transaction: vi.fn(),
  query: vi.fn(),
  getTestRunByTestRunId: vi.fn(),
  getSystemUnderTestName: vi.fn()
};

// Create mock logger
const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  silent: vi.fn(),
  child: vi.fn(() => mockLogger as any),
  level: 'info',
  isLevelEnabled: vi.fn(),
  bindings: vi.fn(),
} as any;

describe('ControlGroupStatisticsPipeline', () => {
  let pipeline: ControlGroupStatisticsPipeline;
  let mockEntityManager: Partial<EntityManager>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock entity manager
    mockEntityManager = {
      query: vi.fn()
    };

    // Setup transaction to call the callback with mock entity manager.
    // Use a proxy to intercept SET LOCAL calls from withAnalyticsTransaction
    // so they don't shift mock.calls indices or consume mockResolvedValueOnce chains.
    mockDatabaseService.transaction.mockImplementation(async (callback: any) => {
      const proxy = new Proxy(mockEntityManager as any, {
        get(target: any, prop: string) {
          if (prop === 'query') {
            return (...args: any[]) => {
              if (typeof args[0] === 'string' && args[0].includes('SET LOCAL')) {
                return Promise.resolve(undefined);
              }
              return target.query(...args);
            };
          }
          return target[prop];
        }
      });
      return await callback(proxy);
    });

    // Create pipeline instance
    pipeline = new ControlGroupStatisticsPipeline(mockLogger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Input Validation', () => {
    test('should validate input with controlGroupIds array', () => {
      const validInput: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1', 'control-group-2']
      };

      expect(pipeline.validateInput(validInput)).toBe(true);
    });

    test('should validate input with testRunIds array', () => {
      const validInput: ControlGroupStatisticsInput = {
        testRunIds: ['test-run-1', 'test-run-2']
      };

      expect(pipeline.validateInput(validInput)).toBe(true);
    });

    test('should validate input with both controlGroupIds and testRunIds', () => {
      const validInput: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1'],
        testRunIds: ['test-run-1']
      };

      expect(pipeline.validateInput(validInput)).toBe(true);
    });

    test('should reject null input', () => {
      expect(pipeline.validateInput(null)).toBe(false);
    });

    test('should reject undefined input', () => {
      expect(pipeline.validateInput(undefined)).toBe(false);
    });

    test('should reject non-object input', () => {
      expect(pipeline.validateInput('string')).toBe(false);
      expect(pipeline.validateInput(123)).toBe(false);
      expect(pipeline.validateInput([])).toBe(false);
    });

    test('should reject empty object', () => {
      expect(pipeline.validateInput({})).toBe(false);
    });

    test('should reject input with empty arrays', () => {
      expect(pipeline.validateInput({ controlGroupIds: [] })).toBe(false);
      expect(pipeline.validateInput({ testRunIds: [] })).toBe(false);
      expect(pipeline.validateInput({ controlGroupIds: [], testRunIds: [] })).toBe(false);
    });

    test('should reject input with non-array values', () => {
      expect(pipeline.validateInput({ controlGroupIds: 'not-an-array' })).toBe(false);
      expect(pipeline.validateInput({ testRunIds: 123 })).toBe(false);
    });
  });

  describe('Pipeline Execution - Happy Path', () => {
    test('should execute successfully with controlGroupIds', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control group query
      (mockEntityManager.query as any).mockResolvedValueOnce([
        {
          control_group_id: 'control-group-1',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-1', 'test-run-2'],
          n_test_runs: 2
        }
      ]);

      // Mock metric statistics count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ count: '100' }]);

      // Mock expected rows count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ expected_rows: 50 }]);

      // Mock insert query with rowCount
      (mockEntityManager.query as any).mockResolvedValueOnce({ rowCount: 50 });

      const result = await pipeline.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        statisticsCreated: 50,
        controlGroups: 1
      });
      // Duration is optional in the result
      if (result.duration !== undefined) {
        expect(typeof result.duration).toBe('number');
      }
    });

    test('should execute successfully with testRunIds', async () => {
      const input: ControlGroupStatisticsInput = {
        testRunIds: ['test-run-1', 'test-run-2']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control group queries for 2 test runs
      (mockEntityManager.query as any)
        .mockResolvedValueOnce([{
          control_group_id: 'test-run-1',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-0'],
          n_test_runs: 1
        }])
        .mockResolvedValueOnce([{ count: '50' }])
        .mockResolvedValueOnce([{ expected_rows: 25 }])
        .mockResolvedValueOnce({ rowCount: 25 })
        .mockResolvedValueOnce([{
          control_group_id: 'test-run-2',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-0', 'test-run-1'],
          n_test_runs: 2
        }])
        .mockResolvedValueOnce([{ count: '75' }])
        .mockResolvedValueOnce([{ expected_rows: 30 }])
        .mockResolvedValueOnce({ rowCount: 30 });

      const result = await pipeline.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        statisticsCreated: 55, // 25 + 30
        controlGroups: 2
      });
    });

    test('should log performance metrics', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control group query
      (mockEntityManager.query as any).mockResolvedValueOnce([
        {
          control_group_id: 'control-group-1',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-1'],
          n_test_runs: 1
        }
      ]);

      // Mock metric statistics count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ count: '10' }]);

      // Mock expected rows count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ expected_rows: 5 }]);

      // Mock insert query
      (mockEntityManager.query as any).mockResolvedValueOnce({ rowCount: 5 });

      await pipeline.execute(input);

      // Verify logging calls
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting control group statistics calculation')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Control group statistics completed')
      );
    });
  });

  describe('Pipeline Execution - Edge Cases', () => {
    test('should handle control group not found', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['non-existent-control-group']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock empty control group query result
      (mockEntityManager.query as any).mockResolvedValueOnce([]);

      const result = await pipeline.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        statisticsCreated: 0,
        controlGroups: 1
      });

      // Verify warning was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Control group not found')
      );
    });

    test('should handle control group with no control runs', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-empty']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control group with empty test_runs
      (mockEntityManager.query as any).mockResolvedValueOnce([
        {
          control_group_id: 'control-group-empty',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: [],
          n_test_runs: 0
        }
      ]);

      const result = await pipeline.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        statisticsCreated: 0,
        controlGroups: 1
      });

      // Verify warning was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('has no control runs')
      );
    });

    test('should handle control group with null test_runs', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-null-runs']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control group with null test_runs
      (mockEntityManager.query as any).mockResolvedValueOnce([
        {
          control_group_id: 'control-group-null-runs',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: null,
          n_test_runs: 0
        }
      ]);

      const result = await pipeline.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        statisticsCreated: 0,
        controlGroups: 1
      });
    });

    test('should handle control group with no metric statistics', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-no-metrics']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control group query
      (mockEntityManager.query as any).mockResolvedValueOnce([
        {
          control_group_id: 'control-group-no-metrics',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-1'],
          n_test_runs: 1
        }
      ]);

      // Mock metric statistics count query returning 0
      (mockEntityManager.query as any).mockResolvedValueOnce([{ count: '0' }]);

      const result = await pipeline.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        statisticsCreated: 0,
        controlGroups: 1
      });

      // Verify warning was logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No metric statistics found')
      );
    });

    test('should handle zero statistics inserted due to ON CONFLICT', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control group query
      (mockEntityManager.query as any).mockResolvedValueOnce([
        {
          control_group_id: 'control-group-1',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-1'],
          n_test_runs: 1
        }
      ]);

      // Mock metric statistics count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ count: '100' }]);

      // Mock expected rows count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ expected_rows: 50 }]);

      // Mock insert query with 0 rows inserted (all conflicts)
      (mockEntityManager.query as any).mockResolvedValueOnce({ rowCount: 0 });

      const result = await pipeline.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        statisticsCreated: 0,
        controlGroups: 1
      });

      // Verify info message about conflicts
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('statistics already exist')
      );
    });

    test('should handle partial inserts with some conflicts', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control group query
      (mockEntityManager.query as any).mockResolvedValueOnce([
        {
          control_group_id: 'control-group-1',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-1', 'test-run-2'],
          n_test_runs: 2
        }
      ]);

      // Mock metric statistics count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ count: '200' }]);

      // Mock expected rows count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ expected_rows: 100 }]);

      // Mock insert query with partial inserts (60 new, 40 updated)
      (mockEntityManager.query as any).mockResolvedValueOnce({ rowCount: 60 });

      const result = await pipeline.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        statisticsCreated: 60,
        controlGroups: 1
      });

      // Verify info message about partial inserts
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Inserted 60 new records, updated 40 existing records')
      );
    });
  });

  describe('Error Handling', () => {
    test('should return error result for invalid input', async () => {
      const result = await pipeline.execute({});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Invalid input');
      expect(result.error?.code).toBe('INVALID_INPUT');
    });

    test('should handle database transaction errors', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock transaction failure
      mockDatabaseService.transaction.mockRejectedValueOnce(
        new Error('Database connection lost')
      );

      const result = await pipeline.execute(input);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Database connection lost');
      expect(result.error?.code).toBe('CONTROL_GROUP_STATISTICS_FAILED');
      expect(result.error?.details).toEqual({
        controlGroupIds: ['control-group-1'],
        testRunIds: undefined
      });
    });

    test('should handle query execution errors within transaction', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control group query failure
      (mockEntityManager.query as any).mockRejectedValueOnce(
        new Error('Query execution failed')
      );

      const result = await pipeline.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Query execution failed');
    });

    test('should handle statistics aggregation query errors', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control group query
      (mockEntityManager.query as any).mockResolvedValueOnce([
        {
          control_group_id: 'control-group-1',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-1'],
          n_test_runs: 1
        }
      ]);

      // Mock metric statistics count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ count: '100' }]);

      // Mock expected rows count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ expected_rows: 50 }]);

      // Mock insert query failure
      (mockEntityManager.query as any).mockRejectedValueOnce(
        new Error('Aggregation query timeout')
      );

      const result = await pipeline.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Aggregation query timeout');
    });

    test('should log errors with context', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1'],
        testRunIds: ['test-run-1']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock transaction failure
      const testError = new Error('Test error');
      mockDatabaseService.transaction.mockRejectedValueOnce(testError);

      const result = await pipeline.execute(input);

      // Verify error result was returned
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CONTROL_GROUP_STATISTICS_FAILED');
    });
  });

  describe('Stale Data Cleanup', () => {
    test('should clean up stale application dashboards before processing', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1']
      };

      // Mock cleanup query with deleted rows
      mockDatabaseService.query.mockResolvedValueOnce([[], 5]);

      // Mock control group query
      (mockEntityManager.query as any).mockResolvedValueOnce([
        {
          control_group_id: 'control-group-1',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-1'],
          n_test_runs: 1
        }
      ]);

      // Mock metric statistics count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ count: '10' }]);

      // Mock expected rows count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ expected_rows: 5 }]);

      // Mock insert query
      (mockEntityManager.query as any).mockResolvedValueOnce({ rowCount: 5 });

      await pipeline.execute(input);

      // Verify cleanup was called
      expect(mockDatabaseService.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ds_control_group_statistics')
      );
    });
  });

  describe('Multiple Control Groups Processing', () => {
    test('should process multiple control groups sequentially', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1', 'control-group-2', 'control-group-3']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock queries for 3 control groups
      for (let i = 1; i <= 3; i++) {
        (mockEntityManager.query as any)
          .mockResolvedValueOnce([{
            control_group_id: `control-group-${i}`,
            system_under_test_id: 'system-1',
            workload: 'load-test',
            test_environment: 'production',
            test_runs: [`test-run-${i}`],
            n_test_runs: 1
          }])
          .mockResolvedValueOnce([{ count: `${i * 10}` }])
          .mockResolvedValueOnce([{ expected_rows: i * 5 }])
          .mockResolvedValueOnce({ rowCount: i * 5 });
      }

      const result = await pipeline.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        statisticsCreated: 30, // 5 + 10 + 15
        controlGroups: 3
      });

      // Verify all control groups were processed
      expect(mockEntityManager.query).toHaveBeenCalledTimes(12); // 4 queries per control group
    });

    test('should continue processing after encountering missing control group', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1', 'missing-group', 'control-group-3']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control-group-1
      (mockEntityManager.query as any)
        .mockResolvedValueOnce([{
          control_group_id: 'control-group-1',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-1'],
          n_test_runs: 1
        }])
        .mockResolvedValueOnce([{ count: '10' }])
        .mockResolvedValueOnce([{ expected_rows: 5 }])
        .mockResolvedValueOnce({ rowCount: 5 })
        // Mock missing-group (empty result)
        .mockResolvedValueOnce([])
        // Mock control-group-3
        .mockResolvedValueOnce([{
          control_group_id: 'control-group-3',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-3'],
          n_test_runs: 1
        }])
        .mockResolvedValueOnce([{ count: '15' }])
        .mockResolvedValueOnce([{ expected_rows: 7 }])
        .mockResolvedValueOnce({ rowCount: 7 });

      const result = await pipeline.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        statisticsCreated: 12, // 5 + 0 + 7
        controlGroups: 3
      });
    });
  });

  describe('Statistics Calculation Logic', () => {
    test('should execute correct SQL for statistics aggregation', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control group query
      (mockEntityManager.query as any).mockResolvedValueOnce([
        {
          control_group_id: 'control-group-1',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-1', 'test-run-2'],
          n_test_runs: 2
        }
      ]);

      // Mock metric statistics count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ count: '100' }]);

      // Mock expected rows count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ expected_rows: 50 }]);

      // Mock insert query
      (mockEntityManager.query as any).mockResolvedValueOnce({ rowCount: 50 });

      await pipeline.execute(input);

      // Verify the statistics aggregation query was called with correct parameters
      // The insert query is at index 3 (after control group query, metric count query, and expected rows query)
      const statisticsQueryCall = (mockEntityManager.query as any).mock.calls[3];
      expect(statisticsQueryCall[0]).toContain('INSERT INTO ds_control_group_statistics');
      expect(statisticsQueryCall[0]).toContain('AVG(m.value) as mean');
      expect(statisticsQueryCall[0]).toContain('approx_percentile(0.50'); // Uses TimescaleDB toolkit for percentiles
      expect(statisticsQueryCall[0]).toContain('STDDEV_POP(m.value) as std_dev');
      expect(statisticsQueryCall[1]).toEqual(['control-group-1', ['test-run-1', 'test-run-2'], null, null]);
    });

    test('should calculate statistics from raw metrics data', async () => {
      const input: ControlGroupStatisticsInput = {
        controlGroupIds: ['control-group-1']
      };

      // Mock cleanup query
      mockDatabaseService.query.mockResolvedValueOnce([[], 0]);

      // Mock control group query
      (mockEntityManager.query as any).mockResolvedValueOnce([
        {
          control_group_id: 'control-group-1',
          system_under_test_id: 'system-1',
          workload: 'load-test',
          test_environment: 'production',
          test_runs: ['test-run-1', 'test-run-2'],
          n_test_runs: 2
        }
      ]);

      // Mock metric statistics count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ count: '100' }]);

      // Mock expected rows count query
      (mockEntityManager.query as any).mockResolvedValueOnce([{ expected_rows: 50 }]);

      // Mock insert query
      (mockEntityManager.query as any).mockResolvedValueOnce({ rowCount: 50 });

      await pipeline.execute(input);

      // Verify the query includes raw_metrics CTE
      const statisticsQueryCall = (mockEntityManager.query as any).mock.calls[2];
      expect(statisticsQueryCall[0]).toContain('raw_metrics AS');
      expect(statisticsQueryCall[0]).toContain('FROM ds_metrics');
    });
  });
});
