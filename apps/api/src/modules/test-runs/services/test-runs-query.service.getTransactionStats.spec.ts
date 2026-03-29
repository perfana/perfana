/**
 * Unit tests for TestRunsQueryService.getTransactionStats method
 *
 * Tests the transaction statistics query functionality:
 * - Successful data retrieval and transformation
 * - Empty results handling
 * - Database error handling
 * - Data parsing and type conversion
 * - Logger behavior
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TestRunsQueryService } from './test-runs-query.service';
import { TestRunsCrudQueryService } from './test-runs-crud-query.service';
import { TestRunsDashboardQueryService } from './test-runs-dashboard-query.service';
import { TestRunsPerformanceQueryService } from './test-runs-performance-query.service';
import { TestRunsTimeSeriesQueryService } from './test-runs-timeseries-query.service';
import { Repository } from 'typeorm';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  TestRun as TestRunEntity,
  SystemUnderTest,
  DsChangePoints,
  DsControlGroups,
} from '../../../entities';
import { DatabaseException } from '../../../common/exceptions/business.exception';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { createAuthorizationServiceMock } from '../../../../test/mocks/authorization-service.mock';

describe('TestRunsQueryService - getTransactionStats', () => {
  let service: TestRunsQueryService;
  let testRunRepo: jest.Mocked<Repository<TestRunEntity>>;
  let performanceQueryService: jest.Mocked<TestRunsPerformanceQueryService>;

  const mockUserId = 'test-user-id';
  const mockRoles = ['user'];

  // Mock transaction data returned from raw SQL query
  const mockRawTransactionData = [
    {
      transaction_name: 'database_call',
      scenario_name: 'load_test',
      total_count: '585',
      passed_count: '573',
      failed_count: '12',
      avg_response_time: '52.48',
      p95_response_time: '70.00',
      p99_response_time: '87.48',
      ranking: '30703.08',
    },
    {
      transaction_name: 'api_endpoint',
      scenario_name: 'stress_test',
      total_count: '1200',
      passed_count: '1198',
      failed_count: '2',
      avg_response_time: '25.75',
      p95_response_time: '45.30',
      p99_response_time: '62.10',
      ranking: '30900.00',
    },
    {
      transaction_name: 'external_service',
      scenario_name: null,
      total_count: '450',
      passed_count: '450',
      failed_count: '0',
      avg_response_time: '105.20',
      p95_response_time: '180.50',
      p99_response_time: '220.75',
      ranking: '47340.00',
    },
  ];

  const expectedTransformedData = [
    {
      transaction_name: 'database_call',
      scenario_name: 'load_test',
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
      scenario_name: 'stress_test',
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
      scenario_name: undefined,
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

  beforeEach(async () => {
    const mockTestRunRepo = {
      query: jest.fn(),
    };

    const mockSystemRepo = {
      findOne: jest.fn(),
    };

    const mockChangePointsRepo = {
      findOne: jest.fn(),
    };

    const mockControlGroupsRepo = {
      findOne: jest.fn(),
    };

    const mockPerformanceQueryService = {
      getTransactionStats: jest.fn(),
      getSamplerStats: jest.fn(),
      getErrorStats: jest.fn(),
    };

    const mockCrudQueryService = {
      findById: jest.fn(),
      findByTestRunId: jest.fn(),
      findByTestRunIdAndParams: jest.fn(),
      findAll: jest.fn(),
      findAllPaginated: jest.fn(),
    };

    const mockDashboardQueryService = {
      getTestCount: jest.fn(),
      getDashboardStatistics: jest.fn(),
      getRecentFailures: jest.fn(),
      getSystemSummary: jest.fn(),
      getSystemsWithSummary: jest.fn(),
    };

    const mockTimeSeriesQueryService = {
      getTransactionTimeSeries: jest.fn(),
      getVirtualUserTimeSeries: jest.fn(),
      getThroughputTimeSeries: jest.fn(),
      getDateBounds: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsQueryService,
        {
          provide: TestRunsCrudQueryService,
          useValue: mockCrudQueryService,
        },
        {
          provide: TestRunsDashboardQueryService,
          useValue: mockDashboardQueryService,
        },
        {
          provide: TestRunsPerformanceQueryService,
          useValue: mockPerformanceQueryService,
        },
        {
          provide: TestRunsTimeSeriesQueryService,
          useValue: mockTimeSeriesQueryService,
        },
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: mockTestRunRepo,
        },
        {
          provide: getRepositoryToken(SystemUnderTest),
          useValue: mockSystemRepo,
        },
        {
          provide: getRepositoryToken(DsChangePoints),
          useValue: mockChangePointsRepo,
        },
        {
          provide: getRepositoryToken(DsControlGroups),
          useValue: mockControlGroupsRepo,
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
        {
          provide: getDataSourceToken(),
          useValue: { query: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    service = module.get<TestRunsQueryService>(TestRunsQueryService);
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    performanceQueryService = module.get(TestRunsPerformanceQueryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy Path Scenarios', () => {
    it('should successfully retrieve and transform transaction statistics', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-123';
      performanceQueryService.getTransactionStats.mockResolvedValue(expectedTransformedData);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(result).toEqual(expectedTransformedData);
      expect(performanceQueryService.getTransactionStats).toHaveBeenCalledTimes(1);
      expect(performanceQueryService.getTransactionStats).toHaveBeenCalledWith(testRunId, undefined, mockRoles, [], undefined);
    });

    it('should delegate to performance query service', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-456';
      performanceQueryService.getTransactionStats.mockResolvedValue(expectedTransformedData);

      // Act
      await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert - Verify delegation to performance service
      expect(performanceQueryService.getTransactionStats).toHaveBeenCalledWith(testRunId, undefined, mockRoles, [], undefined);
    });

    it('should handle single transaction correctly', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-789';
      const singleTransaction = [expectedTransformedData[0]];
      performanceQueryService.getTransactionStats.mockResolvedValue(singleTransaction);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expectedTransformedData[0]);
    });

    it('should handle transactions sorted alphabetically', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-sorted';
      const sortedData = [
        expectedTransformedData[2], // external_service
        expectedTransformedData[0], // database_call
        expectedTransformedData[1], // api_endpoint
      ];
      performanceQueryService.getTransactionStats.mockResolvedValue(sortedData);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert - Result should match the order returned by performance service
      expect(result[0].transaction_name).toBe('external_service');
      expect(result[1].transaction_name).toBe('database_call');
      expect(result[2].transaction_name).toBe('api_endpoint');
    });
  });

  describe('Data Transformation', () => {
    // Note: Data transformation is handled by TestRunsPerformanceQueryService.
    // These tests verify the facade correctly passes through the transformed data.

    it('should correctly return number values from performance service', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-parse';
      performanceQueryService.getTransactionStats.mockResolvedValue([expectedTransformedData[0]]);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(typeof result[0].avg_response_time).toBe('number');
      expect(typeof result[0].p95_response_time).toBe('number');
      expect(typeof result[0].p99_response_time).toBe('number');
      expect(typeof result[0].passed_count).toBe('number');
      expect(typeof result[0].failed_count).toBe('number');
      expect(typeof result[0].total_count).toBe('number');
      expect(typeof result[0].ranking).toBe('number');
    });

    it('should pass through null/zero values from performance service', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-null';
      const dataWithZeros = [
        {
          transaction_name: 'test_transaction',
          scenario_name: undefined,
          total_count: 0,
          passed_count: 0,
          failed_count: 0,
          avg_response_time: 0,
          p95_response_time: 0,
          p99_response_time: 0,
          ranking: 0,
          apdex_score: 0,
          active_threshold: 500,
        },
      ];
      performanceQueryService.getTransactionStats.mockResolvedValue(dataWithZeros);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(result[0].avg_response_time).toBe(0);
      expect(result[0].p95_response_time).toBe(0);
      expect(result[0].p99_response_time).toBe(0);
      expect(result[0].passed_count).toBe(0);
      expect(result[0].failed_count).toBe(0);
      expect(result[0].total_count).toBe(0);
      expect(result[0].ranking).toBe(0);
    });

    it('should preserve transaction_name as string', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-name';
      performanceQueryService.getTransactionStats.mockResolvedValue([expectedTransformedData[0]]);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(typeof result[0].transaction_name).toBe('string');
      expect(result[0].transaction_name).toBe('database_call');
    });
  });

  describe('Edge Cases', () => {
    it('should return empty array when no transactions exist', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-empty';
      performanceQueryService.getTransactionStats.mockResolvedValue([]);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
      expect(performanceQueryService.getTransactionStats).toHaveBeenCalledTimes(1);
    });

    it('should handle test run with UUID format', async () => {
      // Arrange
      const testRunId = '550e8400-e29b-41d4-a716-446655440000';
      performanceQueryService.getTransactionStats.mockResolvedValue(expectedTransformedData);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(result).toEqual(expectedTransformedData);
      expect(performanceQueryService.getTransactionStats).toHaveBeenCalledWith(testRunId, undefined, mockRoles, [], undefined);
    });

    it('should handle test run with custom test_run_id format', async () => {
      // Arrange
      const testRunId = 'PaymentService-production-loadTest-001';
      performanceQueryService.getTransactionStats.mockResolvedValue(expectedTransformedData);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(result).toEqual(expectedTransformedData);
      expect(performanceQueryService.getTransactionStats).toHaveBeenCalledWith(testRunId, undefined, mockRoles, [], undefined);
    });

    it('should handle transactions with zero counts', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-zero';
      const zeroCountData = [
        {
          transaction_name: 'zero_transaction',
          scenario_name: undefined,
          total_count: 0,
          passed_count: 0,
          failed_count: 0,
          avg_response_time: 0,
          p95_response_time: 0,
          p99_response_time: 0,
          ranking: 0,
          apdex_score: 0,
          active_threshold: 500,
        },
      ];
      performanceQueryService.getTransactionStats.mockResolvedValue(zeroCountData);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(result[0]).toEqual({
        transaction_name: 'zero_transaction',
        scenario_name: undefined,
        avg_response_time: 0,
        p95_response_time: 0,
        p99_response_time: 0,
        passed_count: 0,
        failed_count: 0,
        total_count: 0,
        ranking: 0,
        apdex_score: 0,
        active_threshold: 500,
      });
    });

    it('should handle transactions with very large numbers', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-large';
      const largeNumberData = [
        {
          transaction_name: 'high_volume',
          scenario_name: undefined,
          total_count: 999999,
          passed_count: 999998,
          failed_count: 1,
          avg_response_time: 1234.56,
          p95_response_time: 5678.90,
          p99_response_time: 9999.99,
          ranking: 1234567890.12,
          apdex_score: 0.1,
          active_threshold: 500,
        },
      ];
      performanceQueryService.getTransactionStats.mockResolvedValue(largeNumberData);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(result[0].total_count).toBe(999999);
      expect(result[0].passed_count).toBe(999998);
      expect(result[0].failed_count).toBe(1);
      expect(result[0].avg_response_time).toBe(1234.56);
      expect(result[0].p95_response_time).toBe(5678.90);
      expect(result[0].p99_response_time).toBe(9999.99);
      expect(result[0].ranking).toBe(1234567890.12);
    });

    it('should handle transactions with decimal precision', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-decimal';
      const decimalData = [
        {
          transaction_name: 'precise_transaction',
          scenario_name: undefined,
          total_count: 100,
          passed_count: 99,
          failed_count: 1,
          avg_response_time: 12.3456789,
          p95_response_time: 45.6789012,
          p99_response_time: 78.9012345,
          ranking: 1234.5678901,
          apdex_score: 0.92,
          active_threshold: 500,
        },
      ];
      performanceQueryService.getTransactionStats.mockResolvedValue(decimalData);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(result[0].avg_response_time).toBeCloseTo(12.3456789, 7);
      expect(result[0].p95_response_time).toBeCloseTo(45.6789012, 7);
      expect(result[0].p99_response_time).toBeCloseTo(78.9012345, 7);
      expect(result[0].ranking).toBeCloseTo(1234.5678901, 7);
    });
  });

  describe('Error Scenarios', () => {
    it('should propagate DatabaseException from performance service', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-error';
      const dbError = new DatabaseException('Failed to retrieve transaction statistics');
      performanceQueryService.getTransactionStats.mockRejectedValue(dbError);

      // Act & Assert
      await expect(service.getTransactionStats(testRunId, mockUserId, mockRoles)).rejects.toThrow(
        DatabaseException
      );
      await expect(service.getTransactionStats(testRunId, mockUserId, mockRoles)).rejects.toThrow(
        'Failed to retrieve transaction statistics'
      );
    });

    it('should propagate DatabaseException for connection errors', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-connection';
      performanceQueryService.getTransactionStats.mockRejectedValue(new DatabaseException('ECONNREFUSED'));

      // Act & Assert
      await expect(service.getTransactionStats(testRunId, mockUserId, mockRoles)).rejects.toThrow(
        DatabaseException
      );
    });

    it('should propagate DatabaseException for syntax errors', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-syntax';
      performanceQueryService.getTransactionStats.mockRejectedValue(
        new DatabaseException('syntax error at or near "SELECT"')
      );

      // Act & Assert
      await expect(service.getTransactionStats(testRunId, mockUserId, mockRoles)).rejects.toThrow(
        DatabaseException
      );
    });

    it('should propagate DatabaseException for permission errors', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-permission';
      performanceQueryService.getTransactionStats.mockRejectedValue(
        new DatabaseException('permission denied for table transactions')
      );

      // Act & Assert
      await expect(service.getTransactionStats(testRunId, mockUserId, mockRoles)).rejects.toThrow(
        DatabaseException
      );
    });

    it('should propagate DatabaseException for timeout errors', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-timeout';
      performanceQueryService.getTransactionStats.mockRejectedValue(
        new DatabaseException('Query timeout exceeded')
      );

      // Act & Assert
      await expect(service.getTransactionStats(testRunId, mockUserId, mockRoles)).rejects.toThrow(
        DatabaseException
      );
    });
  });

  describe('Delegation Behavior', () => {
    // Note: Logging is handled by TestRunsPerformanceQueryService.
    // These tests verify the facade delegates correctly to the performance service.

    it('should delegate to performance service for retrieval', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-delegate';
      performanceQueryService.getTransactionStats.mockResolvedValue(expectedTransformedData);

      // Act
      await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(performanceQueryService.getTransactionStats).toHaveBeenCalledWith(testRunId, undefined, mockRoles, [], undefined);
    });

    it('should pass excludeRampUp parameter to performance service', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-rampup';
      performanceQueryService.getTransactionStats.mockResolvedValue(expectedTransformedData);

      // Act
      await service.getTransactionStats(testRunId, mockUserId, mockRoles, true);

      // Assert
      expect(performanceQueryService.getTransactionStats).toHaveBeenCalledWith(testRunId, true, mockRoles, [], undefined);
    });

    it('should return result from performance service unchanged', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-passthrough';
      performanceQueryService.getTransactionStats.mockResolvedValue(expectedTransformedData);

      // Act
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(result).toBe(expectedTransformedData);
    });

    it('should propagate errors from performance service', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-error';
      const error = new DatabaseException('Test error');
      performanceQueryService.getTransactionStats.mockRejectedValue(error);

      // Act & Assert
      await expect(service.getTransactionStats(testRunId, mockUserId, mockRoles)).rejects.toThrow(error);
    });
  });

  describe('Input Handling', () => {
    // Note: SQL query validation is handled by TestRunsPerformanceQueryService.
    // These tests verify the facade correctly passes inputs to the performance service.

    it('should pass potentially dangerous inputs to performance service for handling', async () => {
      // Arrange
      const testRunId = "test'; DROP TABLE transactions; --";
      performanceQueryService.getTransactionStats.mockResolvedValue([]);

      // Act
      await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert - Performance service should receive the input and handle SQL injection prevention
      expect(performanceQueryService.getTransactionStats).toHaveBeenCalledWith(testRunId, undefined, mockRoles, [], undefined);
    });

    it('should pass empty testRunId to performance service', async () => {
      // Arrange
      const testRunId = '';
      performanceQueryService.getTransactionStats.mockResolvedValue([]);

      // Act
      await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(performanceQueryService.getTransactionStats).toHaveBeenCalledWith(testRunId, undefined, mockRoles, [], undefined);
    });

    it('should pass excludeRampUp false to performance service', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-filter';
      performanceQueryService.getTransactionStats.mockResolvedValue([]);

      // Act
      await service.getTransactionStats(testRunId, mockUserId, mockRoles, false);

      // Assert
      expect(performanceQueryService.getTransactionStats).toHaveBeenCalledWith(testRunId, false, mockRoles, [], undefined);
    });
  });

  describe('Performance Considerations', () => {
    it('should make only one call to performance service', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-perf';
      performanceQueryService.getTransactionStats.mockResolvedValue(expectedTransformedData);

      // Act
      await service.getTransactionStats(testRunId, mockUserId, mockRoles);

      // Assert
      expect(performanceQueryService.getTransactionStats).toHaveBeenCalledTimes(1);
    });

    it('should handle large result sets from performance service', async () => {
      // Arrange
      const testRunId = 'test-run-uuid-large-set';
      const largeDataSet = Array.from({ length: 1000 }, (_, i) => ({
        transaction_name: `transaction_${i}`,
        scenario_name: undefined,
        total_count: 100,
        passed_count: 99,
        failed_count: 1,
        avg_response_time: i + 0.5,
        p95_response_time: i * 2,
        p99_response_time: i * 3,
        ranking: i * 100,
        apdex_score: 0.9,
        active_threshold: 500,
      }));
      performanceQueryService.getTransactionStats.mockResolvedValue(largeDataSet);

      // Act
      const startTime = Date.now();
      const result = await service.getTransactionStats(testRunId, mockUserId, mockRoles);
      const endTime = Date.now();

      // Assert
      expect(result).toHaveLength(1000);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in less than 1 second
    });
  });
});
