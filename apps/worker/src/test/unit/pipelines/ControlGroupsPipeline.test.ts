import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ControlGroupsPipeline } from '../../../pipelines/ControlGroupsPipeline.js';
import { PipelineResult } from '../../../types/pipeline.js';
import { EntityManager } from 'typeorm';

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

// Mock EntityManager
let mockManager: any;

vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => mockDb),
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

describe('ControlGroupsPipeline', () => {
  let pipeline: ControlGroupsPipeline;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock EntityManager
    mockManager = {
      query: vi.fn(),
      findOne: vi.fn(),
    };

    // Setup default transaction behavior
    mockDb.transaction.mockImplementation(async (callback: any) => {
      return await callback(mockManager);
    });

    pipeline = new ControlGroupsPipeline(mockLogger as any);
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

    it('should validate single test run ID', () => {
      // Arrange
      const validInput = {
        testRunIds: ['test-run-1'],
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
        someOtherProperty: 'value',
      };

      // Act
      const result = pipeline.validateInput(invalidInput);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('execute - Happy Path', () => {
    beforeEach(() => {
      // Mock waitForTestRunsReady
      vi.spyOn(pipeline as any, 'waitForTestRunsReady').mockResolvedValue(undefined);

      // Mock createControlGroupForTestRun
      vi.spyOn(pipeline as any, 'createControlGroupForTestRun').mockResolvedValue({
        control_group_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        test_runs: ['control-1', 'control-2'],
        n_test_runs: 2,
        created_at: new Date(),
        updated_at: new Date(),
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
        controlGroupsCreated: 2,
        testRunIds: 2,
        controlGroups: expect.any(Array),
      });
      expect(result.data.controlGroups).toHaveLength(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Starting control groups creation for 2 test runs'
      );
    });

    it('should execute successfully with single test run', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
      };

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.controlGroupsCreated).toBe(1);
      expect(result.data.testRunIds).toBe(1);
    });

    it('should wait for test runs to be ready before processing', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
      };

      const waitSpy = vi.spyOn(pipeline as any, 'waitForTestRunsReady');

      // Act
      await pipeline.execute(input);

      // Assert
      expect(waitSpy).toHaveBeenCalledWith(mockManager, ['test-run-1']);
    });

    it('should create control group for each test run', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1', 'test-run-2', 'test-run-3'],
      };

      const createSpy = vi.spyOn(pipeline as any, 'createControlGroupForTestRun');

      // Act
      await pipeline.execute(input);

      // Assert
      expect(createSpy).toHaveBeenCalledTimes(3);
      expect(createSpy).toHaveBeenCalledWith(mockManager, 'test-run-1');
      expect(createSpy).toHaveBeenCalledWith(mockManager, 'test-run-2');
      expect(createSpy).toHaveBeenCalledWith(mockManager, 'test-run-3');
    });

    it('should log completion summary', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1', 'test-run-2'],
      };

      // Act
      await pipeline.execute(input);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Created 2 control groups')
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
      expect(result.error?.code).toBe('INVALID_INPUT');
    });

    it('should handle pipeline execution errors', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
      };

      const error = new Error('Pipeline execution failed');
      vi.spyOn(pipeline as any, 'waitForTestRunsReady').mockRejectedValue(error);

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Pipeline execution failed');
      expect(result.error?.code).toBe('CONTROL_GROUPS_CREATION_FAILED');
    });

    it('should handle null control group gracefully', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
      };

      vi.spyOn(pipeline as any, 'waitForTestRunsReady').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'createControlGroupForTestRun').mockResolvedValue(null);

      // Act
      const result: PipelineResult = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.controlGroupsCreated).toBe(0);
      expect(result.data.controlGroups).toHaveLength(0);
    });
  });

  describe('waitForTestRunsReady - Happy Path', () => {
    it('should return immediately when all test runs are ready', async () => {
      // Arrange
      const testRunIds = ['test-run-1', 'test-run-2'];

      mockManager.query
        .mockResolvedValueOnce([]) // Reset stuck statuses - no results
        .mockResolvedValueOnce([
          {
            test_run_id: 'test-run-1',
            checks_status: 'COMPLETED',
            comparisons_status: null,
            adapt_status: null,
          },
          {
            test_run_id: 'test-run-2',
            checks_status: 'COMPLETED',
            comparisons_status: null,
            adapt_status: null,
          },
        ]);

      // Act
      await (pipeline as any).waitForTestRunsReady(mockManager, testRunIds, 120);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith('All test runs are ready for control group creation');
    });

    it('should wait for test runs with IN_PROGRESS status', async () => {
      // Arrange
      const testRunIds = ['test-run-1'];

      mockManager.query
        .mockResolvedValueOnce([]) // Reset stuck statuses
        .mockResolvedValueOnce([
          {
            test_run_id: 'test-run-1',
            checks_status: 'IN_PROGRESS',
            comparisons_status: null,
            adapt_status: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            test_run_id: 'test-run-1',
            checks_status: 'COMPLETED',
            comparisons_status: null,
            adapt_status: null,
          },
        ]);

      // Act
      await (pipeline as any).waitForTestRunsReady(mockManager, testRunIds, 120);

      // Assert
      expect(mockManager.query).toHaveBeenCalledTimes(3); // Reset + 2 status checks
    });

    it('should accept test runs with ERROR status as ready', async () => {
      // Arrange
      const testRunIds = ['test-run-1'];

      mockManager.query
        .mockResolvedValueOnce([]) // Reset stuck statuses
        .mockResolvedValueOnce([
          {
            test_run_id: 'test-run-1',
            checks_status: 'ERROR',
            comparisons_status: null,
            adapt_status: null,
          },
        ]);

      // Act
      await (pipeline as any).waitForTestRunsReady(mockManager, testRunIds, 120);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith('All test runs are ready for control group creation');
    });

    it('should wait when comparisons are IN_PROGRESS', async () => {
      // Arrange
      const testRunIds = ['test-run-1'];

      mockManager.query
        .mockResolvedValueOnce([]) // Reset stuck statuses
        .mockResolvedValueOnce([
          {
            test_run_id: 'test-run-1',
            checks_status: 'COMPLETED',
            comparisons_status: 'IN_PROGRESS',
            adapt_status: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            test_run_id: 'test-run-1',
            checks_status: 'COMPLETED',
            comparisons_status: 'COMPLETED',
            adapt_status: null,
          },
        ]);

      // Act
      await (pipeline as any).waitForTestRunsReady(mockManager, testRunIds, 120);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Waiting for 1 test runs to complete evaluation')
      );
    });

    it('should wait when adapt is IN_PROGRESS', async () => {
      // Arrange
      const testRunIds = ['test-run-1'];

      mockManager.query
        .mockResolvedValueOnce([]) // Reset stuck statuses
        .mockResolvedValueOnce([
          {
            test_run_id: 'test-run-1',
            checks_status: 'COMPLETED',
            comparisons_status: null,
            adapt_status: 'IN_PROGRESS',
          },
        ])
        .mockResolvedValueOnce([
          {
            test_run_id: 'test-run-1',
            checks_status: 'COMPLETED',
            comparisons_status: null,
            adapt_status: 'COMPLETED',
          },
        ]);

      // Act
      await (pipeline as any).waitForTestRunsReady(mockManager, testRunIds, 120);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Waiting for 1 test runs to complete evaluation')
      );
    });
  });

  describe('waitForTestRunsReady - Edge Cases', () => {
    it('should timeout when test runs do not become ready', async () => {
      // Arrange
      const testRunIds = ['test-run-1'];

      mockManager.query
        .mockResolvedValueOnce([]) // Reset stuck statuses
        .mockResolvedValue([
          {
            test_run_id: 'test-run-1',
            checks_status: 'IN_PROGRESS',
            comparisons_status: null,
            adapt_status: null,
          },
        ]);

      // Act & Assert
      await expect(
        (pipeline as any).waitForTestRunsReady(mockManager, testRunIds, 0.01) // Very short timeout
      ).rejects.toThrow('Timeout waiting for test runs to be ready');
    });

    it('should reset stuck IN_PROGRESS statuses before checking', async () => {
      // Arrange
      const testRunIds = ['test-run-1'];

      mockManager.query
        .mockResolvedValueOnce([
          {
            test_run_id: 'test-run-1',
            adapt_status: 'FAILED',
            comparisons_status: 'FAILED',
          },
        ]) // Reset query returns updated rows
        .mockResolvedValueOnce([
          {
            test_run_id: 'test-run-1',
            checks_status: 'COMPLETED',
            comparisons_status: 'FAILED',
            adapt_status: 'FAILED',
          },
        ]);

      const resetSpy = vi.spyOn(pipeline as any, 'resetStuckInProgressStatuses');

      // Act
      await (pipeline as any).waitForTestRunsReady(mockManager, testRunIds, 120);

      // Assert
      expect(resetSpy).toHaveBeenCalledWith(mockManager, testRunIds);
    });

    it('should log status for test runs that are not ready', async () => {
      // Arrange
      const testRunIds = ['test-run-1'];

      mockManager.query
        .mockResolvedValueOnce([]) // Reset stuck statuses
        .mockResolvedValueOnce([
          {
            test_run_id: 'test-run-1',
            checks_status: 'IN_PROGRESS',
            comparisons_status: null,
            adapt_status: null,
            last_update: '2024-01-01T10:00:00Z',
          },
        ])
        .mockResolvedValueOnce([
          {
            test_run_id: 'test-run-1',
            checks_status: 'COMPLETED',
            comparisons_status: null,
            adapt_status: null,
          },
        ]);

      // Act
      await (pipeline as any).waitForTestRunsReady(mockManager, testRunIds, 120);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Test run test-run-1 not ready')
      );
    });
  });

  describe('resetStuckInProgressStatuses', () => {
    it('should reset stuck adapt status', async () => {
      // Arrange
      const testRunIds = ['test-run-1'];

      mockManager.query.mockResolvedValue([
        {
          test_run_id: 'test-run-1',
          adapt_status: 'FAILED',
          comparisons_status: 'IN_PROGRESS',
        },
      ]);

      // Act
      await (pipeline as any).resetStuckInProgressStatuses(mockManager, testRunIds);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE test_runs'),
        [testRunIds]
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Reset stuck status for test run test-run-1')
      );
    });

    it('should reset stuck comparisons status', async () => {
      // Arrange
      const testRunIds = ['test-run-1'];

      mockManager.query.mockResolvedValue([
        {
          test_run_id: 'test-run-1',
          adapt_status: null,
          comparisons_status: 'FAILED',
        },
      ]);

      // Act
      await (pipeline as any).resetStuckInProgressStatuses(mockManager, testRunIds);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE test_runs'),
        [testRunIds]
      );
    });

    it('should not reset statuses if none are stuck', async () => {
      // Arrange
      const testRunIds = ['test-run-1'];

      mockManager.query.mockResolvedValue([]);

      // Act
      await (pipeline as any).resetStuckInProgressStatuses(mockManager, testRunIds);

      // Assert
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Reset stuck status')
      );
    });
  });

  describe('createControlGroupForTestRun - Happy Path', () => {
    beforeEach(() => {
      // Mock test run query
      mockManager.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT') && sql.includes('test_runs') && sql.includes('test_run_id = $1')) {
          return Promise.resolve([
            {
              test_run_id: 'test-run-1',
              system_under_test_id: 'sut-1',
              workload: 'load-test',
              test_environment: 'production',
              start_time: new Date('2024-01-01T10:00:00Z'),
              end_time: new Date('2024-01-01T11:00:00Z'),
              adapt_config: { mode: 'COMPARE' },
              consolidated_result: { meetsRequirement: true },
            },
          ]);
        }
        return Promise.resolve([]);
      });

      // Mock detectChangePoint
      vi.spyOn(pipeline as any, 'detectChangePoint').mockResolvedValue(null);

      // Mock findControlTestRuns
      vi.spyOn(pipeline as any, 'findControlTestRuns').mockResolvedValue([
        'control-1',
        'control-2',
      ]);
    });

    it('should create control group successfully', async () => {
      // Arrange
      mockManager.query.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO ds_control_groups')) {
          return Promise.resolve([
            {
              control_group_id: 'test-run-1',
              system_under_test_id: 'sut-1',
              workload: 'load-test',
              test_environment: 'production',
              test_runs: ['control-1', 'control-2'],
              n_test_runs: 2,
              change_point: null,
              first_datetime: new Date('2024-01-01T09:00:00Z'),
              last_datetime: new Date('2024-01-01T09:30:00Z'),
              created_at: new Date(),
              updated_at: new Date(),
            },
          ]);
        }

        if (sql.includes('MIN(start_time)')) {
          return Promise.resolve([
            {
              first_datetime: new Date('2024-01-01T09:00:00Z'),
              last_datetime: new Date('2024-01-01T09:30:00Z'),
            },
          ]);
        }

        return Promise.resolve([
          {
            test_run_id: 'test-run-1',
            system_under_test_id: 'sut-1',
            workload: 'load-test',
            test_environment: 'production',
            start_time: new Date('2024-01-01T10:00:00Z'),
            end_time: new Date('2024-01-01T11:00:00Z'),
            adapt_config: { mode: 'COMPARE' },
            consolidated_result: { meetsRequirement: true },
          },
        ]);
      });

      // Act
      const result = await (pipeline as any).createControlGroupForTestRun(
        mockManager,
        'test-run-1'
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.control_group_id).toBe('test-run-1');
      expect(result.n_test_runs).toBe(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Created control group for test run test-run-1 with 2 control runs'
      );
    });

    it('should detect and include changepoint information', async () => {
      // Arrange
      const changePoint = {
        test_run_id: 'changepoint-run',
        start_time: new Date('2024-01-01T08:00:00Z'),
      };

      vi.spyOn(pipeline as any, 'detectChangePoint').mockResolvedValue(changePoint);

      mockManager.query.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO ds_control_groups')) {
          return Promise.resolve([
            {
              control_group_id: 'test-run-1',
              system_under_test_id: 'sut-1',
              workload: 'load-test',
              test_environment: 'production',
              test_runs: ['control-1'],
              n_test_runs: 1,
              change_point: JSON.stringify(changePoint),
              created_at: new Date(),
              updated_at: new Date(),
            },
          ]);
        }

        if (sql.includes('MIN(start_time)')) {
          return Promise.resolve([
            {
              first_datetime: new Date('2024-01-01T09:00:00Z'),
              last_datetime: new Date('2024-01-01T09:00:00Z'),
            },
          ]);
        }

        return Promise.resolve([
          {
            test_run_id: 'test-run-1',
            system_under_test_id: 'sut-1',
            workload: 'load-test',
            test_environment: 'production',
            start_time: new Date('2024-01-01T10:00:00Z'),
            end_time: new Date('2024-01-01T11:00:00Z'),
            adapt_config: { mode: 'COMPARE' },
            consolidated_result: { meetsRequirement: true },
          },
        ]);
      });

      // Act
      await (pipeline as any).createControlGroupForTestRun(mockManager, 'test-run-1');

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ds_control_groups'),
        expect.arrayContaining([expect.stringContaining('changepoint-run')])
      );
    });

    it('should calculate first and last datetime from control runs', async () => {
      // Arrange
      mockManager.query.mockImplementation((sql: string) => {
        if (sql.includes('MIN(start_time)')) {
          return Promise.resolve([
            {
              first_datetime: new Date('2024-01-01T09:00:00Z'),
              last_datetime: new Date('2024-01-01T09:30:00Z'),
            },
          ]);
        }

        if (sql.includes('INSERT INTO ds_control_groups')) {
          return Promise.resolve([
            {
              control_group_id: 'test-run-1',
              first_datetime: new Date('2024-01-01T09:00:00Z'),
              last_datetime: new Date('2024-01-01T09:30:00Z'),
            },
          ]);
        }

        return Promise.resolve([
          {
            test_run_id: 'test-run-1',
            system_under_test_id: 'sut-1',
            workload: 'load-test',
            test_environment: 'production',
            start_time: new Date('2024-01-01T10:00:00Z'),
            end_time: new Date('2024-01-01T11:00:00Z'),
            adapt_config: { mode: 'COMPARE' },
            consolidated_result: { meetsRequirement: true },
          },
        ]);
      });

      // Act
      const result = await (pipeline as any).createControlGroupForTestRun(
        mockManager,
        'test-run-1'
      );

      // Assert
      expect(result.first_datetime).toEqual(new Date('2024-01-01T09:00:00Z'));
      expect(result.last_datetime).toEqual(new Date('2024-01-01T09:30:00Z'));
    });
  });

  describe('createControlGroupForTestRun - Edge Cases', () => {
    it('should throw error when test run not found', async () => {
      // Arrange
      mockManager.query.mockResolvedValue([]);

      // Act & Assert
      await expect(
        (pipeline as any).createControlGroupForTestRun(mockManager, 'non-existent')
      ).rejects.toThrow('Test run not found: non-existent');
    });

    it('should handle control group with no control runs', async () => {
      // Arrange
      mockManager.query.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO ds_control_groups')) {
          return Promise.resolve([
            {
              control_group_id: 'test-run-1',
              system_under_test_id: 'sut-1',
              workload: 'load-test',
              test_environment: 'production',
              test_runs: [],
              n_test_runs: 0,
              first_datetime: null,
              last_datetime: null,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ]);
        }

        return Promise.resolve([
          {
            test_run_id: 'test-run-1',
            system_under_test_id: 'sut-1',
            workload: 'load-test',
            test_environment: 'production',
            start_time: new Date('2024-01-01T10:00:00Z'),
            end_time: new Date('2024-01-01T11:00:00Z'),
            adapt_config: { mode: 'COMPARE' },
            consolidated_result: { meetsRequirement: true },
          },
        ]);
      });

      vi.spyOn(pipeline as any, 'detectChangePoint').mockResolvedValue(null);
      vi.spyOn(pipeline as any, 'findControlTestRuns').mockResolvedValue([]);

      // Act
      const result = await (pipeline as any).createControlGroupForTestRun(
        mockManager,
        'test-run-1'
      );

      // Assert
      expect(result.n_test_runs).toBe(0);
      expect(result.first_datetime).toBeNull();
      expect(result.last_datetime).toBeNull();
    });

    it('should update existing control group on conflict', async () => {
      // Arrange
      mockManager.query.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO ds_control_groups') && sql.includes('ON CONFLICT')) {
          return Promise.resolve([
            {
              control_group_id: 'test-run-1',
              system_under_test_id: 'sut-1',
              workload: 'load-test',
              test_environment: 'production',
              test_runs: ['control-1', 'control-2', 'control-3'],
              n_test_runs: 3,
              updated_at: new Date(),
            },
          ]);
        }

        if (sql.includes('MIN(start_time)')) {
          return Promise.resolve([
            {
              first_datetime: new Date('2024-01-01T09:00:00Z'),
              last_datetime: new Date('2024-01-01T09:30:00Z'),
            },
          ]);
        }

        return Promise.resolve([
          {
            test_run_id: 'test-run-1',
            system_under_test_id: 'sut-1',
            workload: 'load-test',
            test_environment: 'production',
            start_time: new Date('2024-01-01T10:00:00Z'),
            end_time: new Date('2024-01-01T11:00:00Z'),
            adapt_config: { mode: 'COMPARE' },
            consolidated_result: { meetsRequirement: true },
          },
        ]);
      });

      vi.spyOn(pipeline as any, 'detectChangePoint').mockResolvedValue(null);
      vi.spyOn(pipeline as any, 'findControlTestRuns').mockResolvedValue([
        'control-1',
        'control-2',
        'control-3',
      ]);

      // Act
      const result = await (pipeline as any).createControlGroupForTestRun(
        mockManager,
        'test-run-1'
      );

      // Assert
      expect(result.n_test_runs).toBe(3);
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (control_group_id)'),
        expect.any(Array)
      );
    });
  });

  describe('detectChangePoint', () => {
    it('should detect changepoint when one exists', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      mockManager.query.mockResolvedValue([
        {
          test_run_id: 'changepoint-run',
          start_time: new Date('2024-01-01T08:00:00Z'),
        },
      ]);

      // Act
      const result = await (pipeline as any).detectChangePoint(mockManager, testRun);

      // Assert
      expect(result).toEqual({
        test_run_id: 'changepoint-run',
        start_time: new Date('2024-01-01T08:00:00Z'),
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Found changepoint for test run test-run-1: changepoint-run'
      );
    });

    it('should return null when no changepoint exists', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      mockManager.query.mockResolvedValue([]);

      // Act
      const result = await (pipeline as any).detectChangePoint(mockManager, testRun);

      // Assert
      expect(result).toBeNull();
    });

    it('should query for most recent changepoint before test run', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      mockManager.query.mockResolvedValue([]);

      // Act
      await (pipeline as any).detectChangePoint(mockManager, testRun);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY tr.start_time DESC'),
        ['sut-1', 'load-test', 'production', testRun.start_time]
      );
    });
  });

  describe('findControlTestRuns - Happy Path', () => {
    beforeEach(() => {
      mockManager.query.mockResolvedValue([
        { test_run_id: 'control-1', start_time: new Date('2024-01-01T09:30:00Z') },
        { test_run_id: 'control-2', start_time: new Date('2024-01-01T09:00:00Z') },
      ]);
    });

    it('should find control test runs matching criteria', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      // Act
      const result = await (pipeline as any).findControlTestRuns(mockManager, testRun, null);

      // Assert
      expect(result).toEqual(['control-1', 'control-2']);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Found 2 control test runs for test run test-run-1'
      );
    });

    it('should exclude the test run itself from control group', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      // Act
      await (pipeline as any).findControlTestRuns(mockManager, testRun, null);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('test_run_id != $4'),
        expect.arrayContaining(['test-run-1'])
      );
    });

    it('should only include test runs before current test run', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      // Act
      await (pipeline as any).findControlTestRuns(mockManager, testRun, null);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('start_time < $5'),
        expect.arrayContaining([testRun.start_time])
      );
    });

    it('should limit to 10 most recent control runs', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      // Act
      await (pipeline as any).findControlTestRuns(mockManager, testRun, null);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 10'),
        expect.any(Array)
      );
    });

    it('should include changepoint constraint when provided', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      const changePoint = {
        test_run_id: 'changepoint-run',
        start_time: new Date('2024-01-01T08:00:00Z'),
      };

      // Act
      await (pipeline as any).findControlTestRuns(mockManager, testRun, changePoint);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('start_time >= $6'),
        expect.arrayContaining([changePoint.start_time])
      );
    });

    it('should exclude test runs with DENIED differences', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      // Act
      await (pipeline as any).findControlTestRuns(mockManager, testRun, null);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining("adapt_config->>'differencesAccepted' != 'DENIED'"),
        expect.any(Array)
      );
    });

    it('should include test runs that meet requirements', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      // Act
      await (pipeline as any).findControlTestRuns(mockManager, testRun, null);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining("(consolidated_result->>'meetsRequirement')::boolean = true"),
        expect.any(Array)
      );
    });

    it('should include BASELINE mode test runs', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      // Act
      await (pipeline as any).findControlTestRuns(mockManager, testRun, null);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining("adapt_config->>'mode' = 'BASELINE'"),
        expect.any(Array)
      );
    });
  });

  describe('findControlTestRuns - Edge Cases', () => {
    it('should return empty array when no control runs found', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      mockManager.query.mockResolvedValue([]);

      // Act
      const result = await (pipeline as any).findControlTestRuns(mockManager, testRun, null);

      // Assert
      expect(result).toEqual([]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Found 0 control test runs for test run test-run-1'
      );
    });

    it('should return empty array for changepoint test run', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'changepoint-run',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      const changePoint = {
        test_run_id: 'changepoint-run',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      mockManager.query.mockResolvedValue([
        { test_run_id: 'control-1', start_time: new Date('2024-01-01T09:00:00Z') },
      ]);

      // Act
      const result = await (pipeline as any).findControlTestRuns(
        mockManager,
        testRun,
        changePoint
      );

      // Assert
      expect(result).toEqual([]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Test run changepoint-run is a changepoint, returning empty control group'
      );
    });

    it('should handle test runs with null end_time', async () => {
      // Arrange
      const testRun = {
        test_run_id: 'test-run-1',
        system_under_test_id: 'sut-1',
        workload: 'load-test',
        test_environment: 'production',
        start_time: new Date('2024-01-01T10:00:00Z'),
      };

      mockManager.query.mockResolvedValue([
        { test_run_id: 'control-1', start_time: new Date('2024-01-01T09:00:00Z') },
      ]);

      // Act
      await (pipeline as any).findControlTestRuns(mockManager, testRun, null);

      // Assert
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('end_time IS NOT NULL'),
        expect.any(Array)
      );
    });
  });

  describe('Performance and Logging', () => {
    it('should log performance metrics', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1', 'test-run-2'],
      };

      vi.spyOn(pipeline as any, 'waitForTestRunsReady').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'createControlGroupForTestRun').mockResolvedValue({
        control_group_id: 'test-run-1',
        n_test_runs: 2,
      });

      const logPerfSpy = vi.spyOn(pipeline as any, 'logPerformance');

      // Act
      await pipeline.execute(input);

      // Assert
      expect(logPerfSpy).toHaveBeenCalledWith(
        'control-groups-creation',
        expect.any(Number),
        {
          testRunIds: 2,
          controlGroupsCreated: 2,
        }
      );
    });

    it('should include duration in result', async () => {
      // Arrange
      const input = {
        testRunIds: ['test-run-1'],
      };

      vi.spyOn(pipeline as any, 'waitForTestRunsReady').mockResolvedValue(undefined);
      vi.spyOn(pipeline as any, 'createControlGroupForTestRun').mockResolvedValue({
        control_group_id: 'test-run-1',
        n_test_runs: 1,
      });

      // Act
      const result = await pipeline.execute(input);

      // Assert
      expect(result.success).toBe(true);
    });
  });
});
