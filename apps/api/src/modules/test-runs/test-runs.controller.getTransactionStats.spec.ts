/**
 * Unit tests for TestRunsMetricsController.getTransactionStats endpoint
 *
 * Tests the GET /test-runs/:testRunId/transactions endpoint:
 * - Successful response with transaction data
 * - Proper service delegation
 * - Parameter handling
 * - Empty results handling
 * - Error propagation
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TestRunsMetricsController } from './test-runs-metrics.controller';
import { TestRunsService } from './test-runs.service';
import { TestRunsBaselineApdexService } from './services/test-runs-baseline-apdex.service';
import { UserContext } from '../../common/decorators/user-context.decorator';

describe('TestRunsMetricsController - getTransactionStats', () => {
  let controller: TestRunsMetricsController;
  let service: jest.Mocked<TestRunsService>;

  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  // Mock transaction statistics data
  const mockTransactionStats = [
    {
      transaction_name: 'database_call',
      avg_response_time: 52.48,
      p95_response_time: 70.0,
      p99_response_time: 87.48,
      passed_count: 573,
      failed_count: 12,
      total_count: 585,
      ranking: 30703.08,
      apdex_score: 0.95,
      active_threshold: 500,
    },
    {
      transaction_name: 'api_endpoint',
      avg_response_time: 25.75,
      p95_response_time: 45.3,
      p99_response_time: 62.1,
      passed_count: 1198,
      failed_count: 2,
      total_count: 1200,
      ranking: 30900.0,
      apdex_score: 0.98,
      active_threshold: 500,
    },
    {
      transaction_name: 'external_service',
      avg_response_time: 105.2,
      p95_response_time: 180.5,
      p99_response_time: 220.75,
      passed_count: 450,
      failed_count: 0,
      total_count: 450,
      ranking: 47340.0,
      apdex_score: 0.72,
      active_threshold: 500,
    },
  ];

  const mockServiceFactory = () => ({
    findAllPaginated: jest.fn(),
    findByTestRunId: jest.fn(),
    findByTestRunIdAndParams: jest.fn(),
    getExpectedConfigChanges: jest.fn(),
    createExpectedConfigChange: jest.fn(),
    deleteExpectedConfigChange: jest.fn(),
    getLatestConfigKeys: jest.fn(),
    createOrUpdateDsCompareConfig: jest.fn(),
    getDsCompareConfig: jest.fn(),
    updateDsCompareConfig: jest.fn(),
    deleteDsCompareConfig: jest.fn(),
    getAnomalyDetectionResults: jest.fn(),
    deleteAnomalyData: jest.fn(),
    getDsAdaptResult: jest.fn(),
    getTestRunsAfterMostRecentChangepoint: jest.fn(),
    getTestRunsMoreRecentThan: jest.fn(),
    updateAnnotations: jest.fn(),
    updateTags: jest.fn(),
    removeChangepoint: jest.fn(),
    deleteTestRun: jest.fn(),
    getTestRunConfigs: jest.fn(),
    getRelatedTestRuns: jest.fn(),
    getTestRunCheckResults: jest.fn(),
    updateAdaptConfig: jest.fn(),
    classifyMetric: jest.fn(),
    markAsChangepoint: jest.fn(),
    getTransactionStats: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestRunsMetricsController],
      providers: [
        {
          provide: TestRunsService,
          useValue: mockServiceFactory(),
        },
        {
          provide: TestRunsBaselineApdexService,
          useValue: {
            getBaselineApdexPreview: jest.fn(),
            applyBaselineApdex: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<TestRunsMetricsController>(TestRunsMetricsController);
    service = module.get(TestRunsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy Path Scenarios', () => {
    it('should return transaction statistics for a valid test run UUID', async () => {
      // Arrange
      const testRunId = '550e8400-e29b-41d4-a716-446655440000';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toEqual(mockTransactionStats);
      expect(service.getTransactionStats).toHaveBeenCalledWith(testRunId, mockUserContext.userId, mockUserContext.roles, false);
      expect(service.getTransactionStats).toHaveBeenCalledTimes(1);
    });

    it('should return transaction statistics for a custom test_run_id', async () => {
      // Arrange
      const testRunId = 'PaymentService-production-loadTest-001';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toEqual(mockTransactionStats);
      expect(service.getTransactionStats).toHaveBeenCalledWith(testRunId, mockUserContext.userId, mockUserContext.roles, false);
    });

    it('should return all transaction fields correctly', async () => {
      // Arrange
      const testRunId = 'test-run-123';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result[0]).toHaveProperty('transaction_name');
      expect(result[0]).toHaveProperty('avg_response_time');
      expect(result[0]).toHaveProperty('p95_response_time');
      expect(result[0]).toHaveProperty('p99_response_time');
      expect(result[0]).toHaveProperty('passed_count');
      expect(result[0]).toHaveProperty('failed_count');
      expect(result[0]).toHaveProperty('total_count');
      expect(result[0]).toHaveProperty('ranking');
    });

    it('should return multiple transactions in order', async () => {
      // Arrange
      const testRunId = 'test-run-multi';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0].transaction_name).toBe('database_call');
      expect(result[1].transaction_name).toBe('api_endpoint');
      expect(result[2].transaction_name).toBe('external_service');
    });

    it('should handle single transaction result', async () => {
      // Arrange
      const testRunId = 'test-run-single';
      const singleTransaction = [mockTransactionStats[0]];
      service.getTransactionStats.mockResolvedValue(singleTransaction);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockTransactionStats[0]);
    });
  });

  describe('Empty and Edge Cases', () => {
    it('should return empty array when no transactions exist', async () => {
      // Arrange
      const testRunId = 'test-run-empty';
      service.getTransactionStats.mockResolvedValue([]);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
      expect(service.getTransactionStats).toHaveBeenCalledWith(testRunId, mockUserContext.userId, mockUserContext.roles, false);
    });

    it('should handle test run with only failed transactions', async () => {
      // Arrange
      const testRunId = 'test-run-failed';
      const failedTransactions = [
        {
          transaction_name: 'failing_endpoint',
          avg_response_time: 150.0,
          p95_response_time: 200.0,
          p99_response_time: 250.0,
          passed_count: 0,
          failed_count: 100,
          total_count: 100,
          ranking: 15000.0,
          apdex_score: 0.0,
          active_threshold: 500,
        },
      ];
      service.getTransactionStats.mockResolvedValue(failedTransactions);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toEqual(failedTransactions);
      expect(result[0].failed_count).toBe(100);
      expect(result[0].passed_count).toBe(0);
    });

    it('should handle test run with only successful transactions', async () => {
      // Arrange
      const testRunId = 'test-run-success';
      const successTransactions = [
        {
          transaction_name: 'successful_endpoint',
          avg_response_time: 25.0,
          p95_response_time: 35.0,
          p99_response_time: 45.0,
          passed_count: 1000,
          failed_count: 0,
          total_count: 1000,
          ranking: 25000.0,
          apdex_score: 0.99,
          active_threshold: 500,
        },
      ];
      service.getTransactionStats.mockResolvedValue(successTransactions);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toEqual(successTransactions);
      expect(result[0].passed_count).toBe(1000);
      expect(result[0].failed_count).toBe(0);
    });

    it('should handle very large transaction datasets', async () => {
      // Arrange
      const testRunId = 'test-run-large';
      const largeDataset = Array.from({ length: 100 }, (_, i) => ({
        transaction_name: `transaction_${i}`,
        avg_response_time: i * 10,
        p95_response_time: i * 15,
        p99_response_time: i * 20,
        passed_count: i * 100,
        failed_count: i,
        total_count: i * 100 + i,
        ranking: i * 1000,
        apdex_score: 0.9,
        active_threshold: 500,
      }));
      service.getTransactionStats.mockResolvedValue(largeDataset);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toHaveLength(100);
      expect(result).toEqual(largeDataset);
    });

    it('should handle transactions with zero response times', async () => {
      // Arrange
      const testRunId = 'test-run-zero';
      const zeroTimeTransactions = [
        {
          transaction_name: 'cached_endpoint',
          avg_response_time: 0,
          p95_response_time: 0,
          p99_response_time: 0,
          passed_count: 500,
          failed_count: 0,
          total_count: 500,
          ranking: 0,
          apdex_score: 1.0,
          active_threshold: 500,
        },
      ];
      service.getTransactionStats.mockResolvedValue(zeroTimeTransactions);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toEqual(zeroTimeTransactions);
      expect(result[0].avg_response_time).toBe(0);
    });
  });

  describe('Service Delegation', () => {
    it('should delegate to service.getTransactionStats method', async () => {
      // Arrange
      const testRunId = 'test-run-delegate';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(service.getTransactionStats).toHaveBeenCalled();
    });

    it('should pass testRunId parameter to service unchanged', async () => {
      // Arrange
      const testRunId = 'special-test-run-id-with-dashes';
      service.getTransactionStats.mockResolvedValue([]);

      // Act
      await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(service.getTransactionStats).toHaveBeenCalledWith(testRunId, mockUserContext.userId, mockUserContext.roles, false);
    });

    it('should not modify service response', async () => {
      // Arrange
      const testRunId = 'test-run-unmodified';
      const originalData = [...mockTransactionStats];
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toStrictEqual(originalData);
      expect(result).toBe(mockTransactionStats); // Same reference
    });

    it('should call service exactly once per request', async () => {
      // Arrange
      const testRunId = 'test-run-once';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      await controller.getTransactionStats(testRunId, false, mockUserContext);
      await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(service.getTransactionStats).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Scenarios', () => {
    it('should propagate service errors to caller', async () => {
      // Arrange
      const testRunId = 'test-run-error';
      const serviceError = new Error('Database connection failed');
      service.getTransactionStats.mockRejectedValue(serviceError);

      // Act & Assert
      await expect(controller.getTransactionStats(testRunId, false, mockUserContext)).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should propagate DatabaseException from service', async () => {
      // Arrange
      const testRunId = 'test-run-db-error';
      const dbError = new Error('Failed to retrieve transaction statistics');
      dbError.name = 'DatabaseException';
      service.getTransactionStats.mockRejectedValue(dbError);

      // Act & Assert
      await expect(controller.getTransactionStats(testRunId, false, mockUserContext)).rejects.toThrow(
        'Failed to retrieve transaction statistics'
      );
    });

    it('should handle service timeout errors', async () => {
      // Arrange
      const testRunId = 'test-run-timeout';
      const timeoutError = new Error('Query timeout exceeded');
      service.getTransactionStats.mockRejectedValue(timeoutError);

      // Act & Assert
      await expect(controller.getTransactionStats(testRunId, false, mockUserContext)).rejects.toThrow(
        'Query timeout exceeded'
      );
    });

    it('should handle ResourceNotFoundException from service', async () => {
      // Arrange
      const testRunId = 'non-existent-test-run';
      const notFoundError = new Error('Test run not found');
      notFoundError.name = 'ResourceNotFoundException';
      service.getTransactionStats.mockRejectedValue(notFoundError);

      // Act & Assert
      await expect(controller.getTransactionStats(testRunId, false, mockUserContext)).rejects.toThrow(
        'Test run not found'
      );
    });

    it('should handle unexpected service errors', async () => {
      // Arrange
      const testRunId = 'test-run-unexpected';
      const unexpectedError = new Error('Unexpected error occurred');
      service.getTransactionStats.mockRejectedValue(unexpectedError);

      // Act & Assert
      await expect(controller.getTransactionStats(testRunId, false, mockUserContext)).rejects.toThrow(
        'Unexpected error occurred'
      );
    });
  });

  describe('Parameter Validation', () => {
    it('should accept valid UUID format', async () => {
      // Arrange
      const testRunId = '550e8400-e29b-41d4-a716-446655440000';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toBeDefined();
      expect(service.getTransactionStats).toHaveBeenCalledWith(testRunId, mockUserContext.userId, mockUserContext.roles, false);
    });

    it('should accept custom test_run_id with hyphens', async () => {
      // Arrange
      const testRunId = 'Payment-Service-prod-load-001';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toBeDefined();
      expect(service.getTransactionStats).toHaveBeenCalledWith(testRunId, mockUserContext.userId, mockUserContext.roles, false);
    });

    it('should accept test_run_id with underscores', async () => {
      // Arrange
      const testRunId = 'Payment_Service_prod_load_001';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toBeDefined();
      expect(service.getTransactionStats).toHaveBeenCalledWith(testRunId, mockUserContext.userId, mockUserContext.roles, false);
    });

    it('should handle numeric test_run_id', async () => {
      // Arrange
      const testRunId = '12345';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result).toBeDefined();
      expect(service.getTransactionStats).toHaveBeenCalledWith(testRunId, mockUserContext.userId, mockUserContext.roles, false);
    });
  });

  describe('Response Format Validation', () => {
    it('should return array type', async () => {
      // Arrange
      const testRunId = 'test-run-array';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(Array.isArray(result)).toBe(true);
    });

    it('should return objects with correct property types', async () => {
      // Arrange
      const testRunId = 'test-run-types';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(typeof result[0].transaction_name).toBe('string');
      expect(typeof result[0].avg_response_time).toBe('number');
      expect(typeof result[0].p95_response_time).toBe('number');
      expect(typeof result[0].p99_response_time).toBe('number');
      expect(typeof result[0].passed_count).toBe('number');
      expect(typeof result[0].failed_count).toBe('number');
      expect(typeof result[0].total_count).toBe('number');
      expect(typeof result[0].ranking).toBe('number');
    });

    it('should preserve numeric precision from service', async () => {
      // Arrange
      const testRunId = 'test-run-precision';
      const preciseData = [
        {
          transaction_name: 'precise_transaction',
          avg_response_time: 52.48,
          p95_response_time: 70.0,
          p99_response_time: 87.48,
          passed_count: 573,
          failed_count: 12,
          total_count: 585,
          ranking: 30703.08,
          apdex_score: 0.95,
          active_threshold: 500,
        },
      ];
      service.getTransactionStats.mockResolvedValue(preciseData);

      // Act
      const result = await controller.getTransactionStats(testRunId, false, mockUserContext);

      // Assert
      expect(result[0].avg_response_time).toBe(52.48);
      expect(result[0].p99_response_time).toBe(87.48);
      expect(result[0].ranking).toBe(30703.08);
    });
  });

  describe('Performance Considerations', () => {
    it('should not add processing overhead', async () => {
      // Arrange
      const testRunId = 'test-run-perf';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const startTime = Date.now();
      await controller.getTransactionStats(testRunId, false, mockUserContext);
      const endTime = Date.now();

      // Assert
      expect(endTime - startTime).toBeLessThan(50); // Controller should add minimal overhead
    });

    it('should handle concurrent requests independently', async () => {
      // Arrange
      const testRunId1 = 'test-run-concurrent-1';
      const testRunId2 = 'test-run-concurrent-2';
      service.getTransactionStats.mockResolvedValue(mockTransactionStats);

      // Act
      const [result1, result2] = await Promise.all([
        controller.getTransactionStats(testRunId1, false, mockUserContext),
        controller.getTransactionStats(testRunId2, false, mockUserContext),
      ]);

      // Assert
      expect(result1).toEqual(mockTransactionStats);
      expect(result2).toEqual(mockTransactionStats);
      expect(service.getTransactionStats).toHaveBeenCalledTimes(2);
      // Controller passes userId, roles, excludeRampUp to service
      expect(service.getTransactionStats).toHaveBeenCalledWith(testRunId1, mockUserContext.userId, mockUserContext.roles, false);
      expect(service.getTransactionStats).toHaveBeenCalledWith(testRunId2, mockUserContext.userId, mockUserContext.roles, false);
    });
  });
});
