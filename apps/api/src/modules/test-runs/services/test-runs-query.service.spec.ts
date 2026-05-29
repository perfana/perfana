/**
 * Test Suite for TestRunsQueryService
 *
 * This service is a facade that delegates to specialized query services:
 * - TestRunsCrudQueryService: Basic CRUD operations
 * - TestRunsDashboardQueryService: Dashboard statistics
 * - TestRunsPerformanceQueryService: Performance analysis queries
 * - TestRunsTimeSeriesQueryService: Time series data queries
 *
 * Note: This test file uses service-level mocks (not repository mocks) because
 * TestRunsQueryService doesn't interact with repositories directly. For tests
 * that need repository mocks, use createMockRepository from
 * '@/test/helpers/mock-repository.factory'.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { TestRunsQueryService, TestRun } from './test-runs-query.service';
import { TestRunsCrudQueryService } from './test-runs-crud-query.service';
import { TestRunsDashboardQueryService } from './test-runs-dashboard-query.service';
import { TestRunsPerformanceQueryService } from './test-runs-performance-query.service';
import { TestRunsTimeSeriesQueryService } from './test-runs-timeseries-query.service';
import { PaginatedResponseDto } from '../../../common/dto';
import { createAuthorizationServiceMock } from '../../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../../common/services/authorization.service';

/**
 * Type definitions for mocked query services
 */
type MockCrudQueryService = jest.Mocked<Pick<
  TestRunsCrudQueryService,
  | 'findAllPaginated'
  | 'findAll'
  | 'findByTestRunId'
  | 'findOne'
  | 'getTestRunByTestRunId'
  | 'findByTestRunIdAndParams'
  | 'getRelatedTestRuns'
  | 'getSystemsSummary'
  | 'getAllTags'
  | 'getAllAnnotations'
  | 'isTestRunChangepoint'
  | 'isTestRunInControlGroup'
  | 'getBaselineCandidates'
  | 'getRequestNames'
>>;

type MockDashboardQueryService = jest.Mocked<Pick<
  TestRunsDashboardQueryService,
  | 'getDashboardStatistics'
  | 'getRecentFailures'
  | 'getDashboardSystemsSummary'
>>;

type MockPerformanceQueryService = jest.Mocked<Pick<
  TestRunsPerformanceQueryService,
  | 'getTransactionStats'
  | 'getTransactionSamples'
  | 'getTransactionErrors'
  | 'getVirtualUserStats'
  | 'getThroughputStats'
  | 'getAggregatedMetricTimeseries'
>>;

type MockTimeSeriesQueryService = jest.Mocked<Pick<
  TestRunsTimeSeriesQueryService,
  | 'getTransactionTimeSeries'
  | 'getSamplerTimeSeries'
>>;

describe('TestRunsQueryService', () => {
  let service: TestRunsQueryService;
  let crudService: MockCrudQueryService;
  let dashboardService: MockDashboardQueryService;
  let performanceService: MockPerformanceQueryService;
  let timeSeriesService: MockTimeSeriesQueryService;

  const mockUserId = 'test-user-id';
  const mockRoles = ['user'];

  /**
   * Factory function for creating mock test run data
   * Used throughout the test suite for consistent test data
   */
  const createMockTestRun = (overrides?: Partial<TestRun>): TestRun => {
    const now = new Date().toISOString();
    return {
      id: 'test-run-uuid-123',
      test_run_id: 'PaymentService-production-loadTest-001',
      system_under_test_id: 'system-uuid-123',
      test_environment: 'production',
      workload: 'loadTest',
      start_time: now,
      end_time: now,
      duration: 3600,
      planned_duration: 3600,
      analysis_start_offset: 300,
      completed: true,
      abort: false,
      status: { evaluatingAdapt: 'COMPLETED' },
      consolidated_result: { overall: true, meetsRequirement: true },
      annotations: ['baseline test'],
      tags: ['performance', 'baseline'],
      application_release: '1.2.3',
      ci_build_results_url: 'https://ci.example.com/build/123',
      expires: undefined,
      expired: false,
      valid: true,
      reasons_not_valid: [],
      adapt_config: { mode: 'DEFAULT', differencesAccepted: 'TBD' },
      variables: [{ placeholder: 'heap.size', value: '2048m' }],
      deep_links: [{ name: 'Grafana', url: 'https://grafana.example.com' }],
      created_at: now,
      updated_at: now,
      systems_under_test: {
        name: 'PaymentService',
      },
      is_changepoint: false,
      is_control_group: false,
      ...overrides,
    };
  };

  beforeEach(async () => {
    // Create mock services with typed interfaces
    // Note: These are service-level mocks, not repository mocks
    const mockCrudService: MockCrudQueryService = {
      findAllPaginated: jest.fn(),
      findAll: jest.fn(),
      findByTestRunId: jest.fn(),
      findOne: jest.fn(),
      getTestRunByTestRunId: jest.fn(),
      findByTestRunIdAndParams: jest.fn(),
      getRelatedTestRuns: jest.fn(),
      getSystemsSummary: jest.fn(),
      getAllTags: jest.fn(),
      getAllAnnotations: jest.fn(),
      isTestRunChangepoint: jest.fn(),
      isTestRunInControlGroup: jest.fn(),
      getBaselineCandidates: jest.fn(),
      getRequestNames: jest.fn(),
    };

    const mockDashboardService: MockDashboardQueryService = {
      getDashboardStatistics: jest.fn(),
      getRecentFailures: jest.fn(),
      getDashboardSystemsSummary: jest.fn(),
    };

    const mockPerformanceService: MockPerformanceQueryService = {
      getTransactionStats: jest.fn(),
      getTransactionSamples: jest.fn(),
      getTransactionErrors: jest.fn(),
      getVirtualUserStats: jest.fn(),
      getThroughputStats: jest.fn(),
      getAggregatedMetricTimeseries: jest.fn(),
    };

    const mockTimeSeriesService: MockTimeSeriesQueryService = {
      getTransactionTimeSeries: jest.fn(),
      getSamplerTimeSeries: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsQueryService,
        {
          provide: TestRunsCrudQueryService,
          useValue: mockCrudService,
        },
        {
          provide: TestRunsDashboardQueryService,
          useValue: mockDashboardService,
        },
        {
          provide: TestRunsPerformanceQueryService,
          useValue: mockPerformanceService,
        },
        {
          provide: TestRunsTimeSeriesQueryService,
          useValue: mockTimeSeriesService,
        },
        {
          provide: getDataSourceToken(),
          useValue: { query: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
      ],
    }).compile();

    service = module.get<TestRunsQueryService>(TestRunsQueryService);
    crudService = module.get(TestRunsCrudQueryService);
    dashboardService = module.get(TestRunsDashboardQueryService);
    performanceService = module.get(TestRunsPerformanceQueryService);
    timeSeriesService = module.get(TestRunsTimeSeriesQueryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('CRUD Operations (delegated to TestRunsCrudQueryService)', () => {
    // The default authzService mock returns isGlobalAdmin=true, so the parent's
    // resolveOrganizationIds/resolveTeamIds collapse to: isAdmin=true, orgIds=[], userTeamIds=[].

    describe('findAllPaginated', () => {
      it('should delegate to crudService.findAllPaginated with resolved isAdmin/orgIds/userTeamIds', async () => {
        const mockTestRuns = [createMockTestRun()];
        const mockResponse = new PaginatedResponseDto(mockTestRuns, 100, 1, 50);
        crudService.findAllPaginated.mockResolvedValue(mockResponse);

        const result = await service.findAllPaginated(mockUserId, mockRoles, { page: 1, pageSize: 50 });

        expect(crudService.findAllPaginated).toHaveBeenCalledWith(true, [], [], { page: 1, pageSize: 50 }, undefined);
        expect(result.data).toHaveLength(1);
        expect(result.total).toBe(100);
      });

      it('should handle empty results', async () => {
        const mockResponse = new PaginatedResponseDto([], 0, 1, 50);
        crudService.findAllPaginated.mockResolvedValue(mockResponse);

        const result = await service.findAllPaginated(mockUserId, mockRoles);

        expect(result.data).toHaveLength(0);
        expect(result.total).toBe(0);
      });
    });

    describe('findAll', () => {
      it('should delegate to crudService.findAll with resolved isAdmin/orgIds', async () => {
        const mockTestRuns = [createMockTestRun()];
        crudService.findAll.mockResolvedValue(mockTestRuns);

        const result = await service.findAll(mockUserId, mockRoles);

        expect(crudService.findAll).toHaveBeenCalledWith(true, []);
        expect(result).toHaveLength(1);
      });
    });

    describe('findByTestRunId', () => {
      it('should delegate to crudService.findByTestRunId with resolved isAdmin', async () => {
        const mockTestRun = createMockTestRun();
        crudService.findByTestRunId.mockResolvedValue(mockTestRun);

        const result = await service.findByTestRunId('PaymentService-production-loadTest-001', mockUserId, mockRoles);

        expect(crudService.findByTestRunId).toHaveBeenCalledWith('PaymentService-production-loadTest-001', mockUserId, true);
        expect(result.test_run_id).toBe('PaymentService-production-loadTest-001');
      });
    });

    describe('findOne', () => {
      it('should delegate to crudService.findOne with resolved isAdmin', async () => {
        const mockTestRun = createMockTestRun();
        crudService.findOne.mockResolvedValue(mockTestRun);

        const result = await service.findOne('test-run-uuid-123', mockUserId, mockRoles);

        expect(crudService.findOne).toHaveBeenCalledWith('test-run-uuid-123', mockUserId, true);
        expect(result.id).toBe('test-run-uuid-123');
      });
    });

    describe('getTestRunByTestRunId', () => {
      it('should delegate to crudService.getTestRunByTestRunId with resolved isAdmin', async () => {
        const mockTestRun = createMockTestRun();
        crudService.getTestRunByTestRunId.mockResolvedValue(mockTestRun);

        const result = await service.getTestRunByTestRunId('PaymentService-production-loadTest-001', mockUserId, mockRoles);

        expect(crudService.getTestRunByTestRunId).toHaveBeenCalledWith('PaymentService-production-loadTest-001', mockUserId, true);
        expect(result).not.toBeNull();
      });

      it('should return null when test run not found', async () => {
        crudService.getTestRunByTestRunId.mockResolvedValue(null);

        const result = await service.getTestRunByTestRunId('non-existent', mockUserId, mockRoles);

        expect(result).toBeNull();
      });
    });

    describe('findByTestRunIdAndParams', () => {
      it('should delegate to crudService.findByTestRunIdAndParams with resolved isAdmin/orgIds/userTeamIds', async () => {
        const mockTestRun = createMockTestRun();
        crudService.findByTestRunIdAndParams.mockResolvedValue(mockTestRun);

        const result = await service.findByTestRunIdAndParams(
          'PaymentService-production-loadTest-001',
          'PaymentService',
          'production',
          'loadTest',
          mockUserId,
          mockRoles,
        );

        expect(crudService.findByTestRunIdAndParams).toHaveBeenCalledWith(
          'PaymentService-production-loadTest-001',
          'PaymentService',
          'production',
          'loadTest',
          true,
          [],
          [],
          undefined,
        );
        expect(result.test_run_id).toBe('PaymentService-production-loadTest-001');
      });
    });

    describe('getRelatedTestRuns', () => {
      it('should delegate to crudService.getRelatedTestRuns with resolved isAdmin/orgIds/userTeamIds', async () => {
        const mockRelatedRuns = [
          { test_run_id: 'related-001', created_at: new Date().toISOString(), completed: true },
        ];
        crudService.getRelatedTestRuns.mockResolvedValue(mockRelatedRuns);

        const result = await service.getRelatedTestRuns('PaymentService-production-loadTest-001', mockUserId, mockRoles);

        expect(crudService.getRelatedTestRuns).toHaveBeenCalledWith('PaymentService-production-loadTest-001', true, [], [], undefined, undefined, undefined);
        expect(result).toHaveLength(1);
      });
    });

    describe('getSystemsSummary', () => {
      it('should delegate to crudService.getSystemsSummary with resolved isAdmin/orgIds/userTeamIds', async () => {
        const mockSummary = [
          { id: 'system-1', name: 'PaymentService', environments: [], created_at: new Date().toISOString() },
        ];
        crudService.getSystemsSummary.mockResolvedValue(mockSummary);

        const result = await service.getSystemsSummary(mockUserId, mockRoles);

        expect(crudService.getSystemsSummary).toHaveBeenCalledWith(true, [], [], undefined);
        expect(result).toHaveLength(1);
      });
    });

    describe('getAllTags', () => {
      it('should delegate to crudService.getAllTags with resolved isAdmin/orgIds', async () => {
        const mockTags = ['performance', 'baseline', 'regression'];
        crudService.getAllTags.mockResolvedValue(mockTags);

        const result = await service.getAllTags(mockUserId, mockRoles);

        expect(crudService.getAllTags).toHaveBeenCalledWith(true, []);
        expect(result).toEqual(mockTags);
      });
    });

    describe('getAllAnnotations', () => {
      it('should delegate to crudService.getAllAnnotations with resolved isAdmin/orgIds', async () => {
        const mockAnnotations = ['test annotation', 'another annotation'];
        crudService.getAllAnnotations.mockResolvedValue(mockAnnotations);

        const result = await service.getAllAnnotations(mockUserId, mockRoles);

        expect(crudService.getAllAnnotations).toHaveBeenCalledWith(true, []);
        expect(result).toEqual(mockAnnotations);
      });
    });

    describe('isTestRunChangepoint', () => {
      it('should delegate to crudService.isTestRunChangepoint', async () => {
        crudService.isTestRunChangepoint.mockResolvedValue(true);

        const result = await service.isTestRunChangepoint('system-1', 'production', 'loadTest', 'test-run-001');

        expect(crudService.isTestRunChangepoint).toHaveBeenCalledWith('system-1', 'production', 'loadTest', 'test-run-001');
        expect(result).toBe(true);
      });
    });

    describe('isTestRunInControlGroup', () => {
      it('should delegate to crudService.isTestRunInControlGroup', async () => {
        crudService.isTestRunInControlGroup.mockResolvedValue(true);

        const result = await service.isTestRunInControlGroup('system-1', 'production', 'loadTest', 'test-run-001');

        expect(crudService.isTestRunInControlGroup).toHaveBeenCalledWith('system-1', 'production', 'loadTest', 'test-run-001');
        expect(result).toBe(true);
      });
    });

    describe('getBaselineCandidates', () => {
      it('should delegate to crudService.getBaselineCandidates without auth params', async () => {
        const mockCandidates = [createMockTestRun()];
        crudService.getBaselineCandidates.mockResolvedValue(mockCandidates);

        const result = await service.getBaselineCandidates('system-1', 'production', 'loadTest', mockUserId, mockRoles);

        expect(crudService.getBaselineCandidates).toHaveBeenCalledWith('system-1', 'production', 'loadTest', undefined, undefined);
        expect(result).toHaveLength(1);
      });
    });

    describe('getRequestNames', () => {
      it('should delegate to crudService.getRequestNames with resolved isAdmin', async () => {
        const mockNames = ['request-1', 'request-2'];
        crudService.getRequestNames.mockResolvedValue(mockNames);

        const result = await service.getRequestNames('test-run-001', mockUserId, mockRoles);

        expect(crudService.getRequestNames).toHaveBeenCalledWith('test-run-001', mockUserId, true, undefined);
        expect(result).toEqual(mockNames);
      });
    });
  });

  describe('Dashboard Operations (delegated to TestRunsDashboardQueryService)', () => {
    const testUserId = 'test-user-id';
    const testRoles = ['perfana-admin'];

    describe('getDashboardStatistics', () => {
      it('should delegate to dashboardService.getDashboardStatistics (admin, no explicit org)', async () => {
        const mockStats = {
          totalTests: 100,
          passedTests: 80,
          failedTests: 20,
          activeTests: 5,
          sloComplianceRate: 90,
          mostTestedSystem: { name: 'PaymentService', count: 50 },
          timePeriod: '7d',
        };
        dashboardService.getDashboardStatistics.mockResolvedValue(mockStats);

        const result = await service.getDashboardStatistics(testUserId, testRoles, '7d');

        // Admin without explicit org → isAdmin=true, empty organizationIds (no filter), empty teamIds (admin bypass)
        expect(dashboardService.getDashboardStatistics).toHaveBeenCalledWith('7d', undefined, undefined, true, [], []);
        expect(result.totalTests).toBe(100);
      });

      it('should filter by explicit org even for admin', async () => {
        const mockStats = {
          totalTests: 50,
          passedTests: 40,
          failedTests: 10,
          activeTests: 2,
          sloComplianceRate: 80,
          mostTestedSystem: { name: 'PaymentService', count: 25 },
          timePeriod: '7d',
        };
        dashboardService.getDashboardStatistics.mockResolvedValue(mockStats);

        const result = await service.getDashboardStatistics(testUserId, testRoles, '7d', undefined, undefined, 'org-123');

        // Explicit org → organizationIds = ['org-123'] even for admin, isAdmin=true, empty teamIds (admin bypass)
        expect(dashboardService.getDashboardStatistics).toHaveBeenCalledWith('7d', undefined, undefined, true, ['org-123'], []);
        expect(result.totalTests).toBe(50);
      });
    });

    describe('getRecentFailures', () => {
      it('should delegate to dashboardService.getRecentFailures (admin, no explicit org)', async () => {
        const mockFailures = [
          {
            id: 'failure-1',
            test_run_id: 'test-run-001',
            system_name: 'PaymentService',
            test_environment: 'production',
            workload: 'loadTest',
            start_time: null,
            end_time: null,
            consolidated_result: null,
            created_at: new Date().toISOString(),
          },
        ];
        dashboardService.getRecentFailures.mockResolvedValue(mockFailures);

        const result = await service.getRecentFailures(testUserId, testRoles, 10, '7d');

        // Admin without explicit org → isAdmin=true, empty organizationIds (no filter), empty teamIds (admin bypass), userId passed through
        expect(dashboardService.getRecentFailures).toHaveBeenCalledWith(10, '7d', undefined, undefined, true, [], [], testUserId);
        expect(result).toHaveLength(1);
      });

      it('should filter by explicit org even for admin', async () => {
        dashboardService.getRecentFailures.mockResolvedValue([]);

        await service.getRecentFailures(testUserId, testRoles, 10, '7d', undefined, undefined, 'org-456');

        expect(dashboardService.getRecentFailures).toHaveBeenCalledWith(10, '7d', undefined, undefined, true, ['org-456'], [], testUserId);
      });
    });

    describe('getDashboardSystemsSummary', () => {
      it('should delegate to dashboardService.getDashboardSystemsSummary (admin, no explicit org)', async () => {
        const mockSummary = [
          {
            id: 'system-1',
            name: 'PaymentService',
            testRunCount: 100,
            lastTestRun: new Date().toISOString(),
            passFailRatio: { passed: 80, failed: 20 },
          },
        ];
        dashboardService.getDashboardSystemsSummary.mockResolvedValue(mockSummary);

        const result = await service.getDashboardSystemsSummary(testUserId, testRoles);

        // Admin without explicit org → isAdmin=true, empty organizationIds (no filter), empty teamIds (admin bypass)
        expect(dashboardService.getDashboardSystemsSummary).toHaveBeenCalledWith(true, [], []);
        expect(result).toHaveLength(1);
      });

      it('should filter by explicit org even for admin', async () => {
        dashboardService.getDashboardSystemsSummary.mockResolvedValue([]);

        await service.getDashboardSystemsSummary(testUserId, testRoles, 'org-789');

        expect(dashboardService.getDashboardSystemsSummary).toHaveBeenCalledWith(true, ['org-789'], []);
      });
    });
  });

  describe('Performance Analysis (delegated to TestRunsPerformanceQueryService)', () => {
    describe('getTransactionStats', () => {
      it('should delegate to performanceService.getTransactionStats', async () => {
        const mockStats = [
          {
            transaction_name: 'checkout',
            avg_response_time: 150,
            p95_response_time: 300,
            p99_response_time: 500,
            passed_count: 1000,
            failed_count: 10,
            total_count: 1010,
            ranking: 1,
            apdex_score: 0.95,
            active_threshold: 500,
          },
        ];
        performanceService.getTransactionStats.mockResolvedValue(mockStats);

        const result = await service.getTransactionStats('test-run-001', mockUserId, mockRoles, false);

        expect(performanceService.getTransactionStats).toHaveBeenCalledWith('test-run-001', false, true, [], undefined);
        expect(result).toHaveLength(1);
      });
    });

    describe('getTransactionSamples', () => {
      it('should delegate to performanceService.getTransactionSamples', async () => {
        const mockSamples = [
          {
            sampler_name: 'GET /api/checkout',
            avg_response_time: 150,
            min_response_time: 50,
            max_response_time: 500,
            p95_response_time: 300,
            p99_response_time: 450,
            passed_count: 1000,
            failed_count: 10,
            total_count: 1010,
            avg_latency: 100,
            avg_connect_time: 20,
            total_request_size: 10000,
            total_response_size: 50000,
            apdex_score: 0.95,
            active_threshold: 500,
            url_hash: null,
            url_pattern: null,
          },
        ];
        performanceService.getTransactionSamples.mockResolvedValue(mockSamples);

        const result = await service.getTransactionSamples('test-run-001', 'checkout', mockUserId, mockRoles, false);

        expect(performanceService.getTransactionSamples).toHaveBeenCalledWith('test-run-001', 'checkout', false, true, [], undefined);
        expect(result).toHaveLength(1);
      });
    });

    describe('getTransactionErrors', () => {
      it('should delegate to performanceService.getTransactionErrors', async () => {
        const mockErrors = [
          {
            error_type: 'HTTP 500',
            response_code: '500',
            response_message: 'Internal Server Error',
            sampler_name: 'GET /api/checkout',
            url: 'https://api.example.com/checkout',
            url_hash: null,
            url_pattern: null,
            count: 10,
            first_occurrence: new Date().toISOString(),
            last_occurrence: new Date().toISOString(),
            sample_response_data: '',
            total_requests: 1000,
            apdex_score: 0.95,
          },
        ];
        performanceService.getTransactionErrors.mockResolvedValue(mockErrors);

        const result = await service.getTransactionErrors('test-run-001', mockUserId, mockRoles, 'checkout');

        expect(performanceService.getTransactionErrors).toHaveBeenCalledWith('test-run-001', 'checkout', undefined, true, [], undefined);
        expect(result).toHaveLength(1);
      });
    });

    describe('getVirtualUserStats', () => {
      it('should delegate to performanceService.getVirtualUserStats', async () => {
        const mockStats = {
          overall: {
            peak_active_threads: 100,
            avg_active_threads: 50,
            peak_started_threads: 100,
            avg_started_threads: 50,
            peak_finished_threads: 100,
            avg_finished_threads: 50,
            total_data_points: 1000,
          },
          by_scenario: [],
        };
        performanceService.getVirtualUserStats.mockResolvedValue(mockStats);

        const result = await service.getVirtualUserStats('test-run-001', mockUserId, mockRoles);

        expect(performanceService.getVirtualUserStats).toHaveBeenCalledWith('test-run-001', undefined, true, []);
        expect(result.overall.peak_active_threads).toBe(100);
      });
    });

    describe('getThroughputStats', () => {
      it('should delegate to performanceService.getThroughputStats', async () => {
        const mockStats = {
          overall: {
            peak_transactions_per_second: 100,
            peak_requests_per_second: 500,
          },
          by_scenario: [],
        };
        performanceService.getThroughputStats.mockResolvedValue(mockStats);

        const result = await service.getThroughputStats('test-run-001', mockUserId, mockRoles);

        expect(performanceService.getThroughputStats).toHaveBeenCalledWith('test-run-001', undefined, true, []);
        expect(result.overall.peak_transactions_per_second).toBe(100);
      });
    });

    describe('getAggregatedMetricTimeseries', () => {
      it('resolves org IDs and delegates to performanceService', async () => {
        // Arrange
        // Default authz mock returns isGlobalAdmin=true → isAdmin=true, orgIds=[]
        const mockResult = {
          bucketSizeSeconds: 10,
          buckets: [
            { time: '2024-01-01T10:00:00Z', value: 120 },
            { time: '2024-01-01T10:00:10Z', value: 135 },
          ],
        };
        performanceService.getAggregatedMetricTimeseries.mockResolvedValue(mockResult);

        // Act
        const result = await service.getAggregatedMetricTimeseries(
          'test-run-001',
          mockUserId,
          mockRoles,
          'transaction_response_time',
          'p95',
          false,
        );

        // Assert: delegation call includes resolved isAdmin=true and empty orgIds
        expect(performanceService.getAggregatedMetricTimeseries).toHaveBeenCalledWith(
          'test-run-001',
          'transaction_response_time',
          'p95',
          false,
          true,  // isAdmin resolved from global-admin mock
          [],    // orgIds empty for admin
        );
        expect(result.buckets).toHaveLength(2);
        expect(result.bucketSizeSeconds).toBe(10);
      });

      it('passes isAdmin=true when resolveOrganizationIds returns admin=true', async () => {
        // Arrange
        const mockResult = { bucketSizeSeconds: 60, buckets: [] };
        performanceService.getAggregatedMetricTimeseries.mockResolvedValue(mockResult);

        // Act
        await service.getAggregatedMetricTimeseries(
          'test-run-001',
          mockUserId,
          mockRoles,
          'error_percentage',
          'avg',
          true,
        );

        // Assert: isAdmin=true forwarded correctly
        const callArgs = performanceService.getAggregatedMetricTimeseries.mock.calls[0];
        expect(callArgs[4]).toBe(true); // isAdmin is the 5th argument
      });
    });
  });

  describe('Time Series Data (delegated to TestRunsTimeSeriesQueryService)', () => {
    describe('getTransactionTimeSeries', () => {
      it('should delegate to timeSeriesService.getTransactionTimeSeries', async () => {
        const mockData = {
          transaction_data: [
            {
              time_bucket: new Date().toISOString(),
              avg_response_time: 150,
              median_response_time: 140,
              min_response_time: 50,
              max_response_time: 500,
              p90_response_time: 280,
              p95_response_time: 300,
              p99_response_time: 450,
              total_count: 100,
              passed_count: 95,
              failed_count: 5,
            },
          ],
          sampler_data: {},
        };
        timeSeriesService.getTransactionTimeSeries.mockResolvedValue(mockData);

        const result = await service.getTransactionTimeSeries('test-run-001', 'checkout', mockUserId, mockRoles, 5, false);

        expect(timeSeriesService.getTransactionTimeSeries).toHaveBeenCalledWith('test-run-001', 'checkout', mockUserId, mockRoles, 5, false);
        expect(result.transaction_data).toHaveLength(1);
      });
    });

    describe('getSamplerTimeSeries', () => {
      it('should delegate to timeSeriesService.getSamplerTimeSeries', async () => {
        const mockData = [
          {
            time_bucket: new Date().toISOString(),
            avg_response_time: 150,
            median_response_time: 140,
            min_response_time: 50,
            max_response_time: 500,
            p90_response_time: 280,
            p95_response_time: 300,
            p99_response_time: 450,
            total_count: 100,
            passed_count: 95,
            failed_count: 5,
          },
        ];
        timeSeriesService.getSamplerTimeSeries.mockResolvedValue(mockData);

        const result = await service.getSamplerTimeSeries('test-run-001', 'checkout', 'GET /api/checkout', mockUserId, mockRoles, 5, false);

        expect(timeSeriesService.getSamplerTimeSeries).toHaveBeenCalledWith('test-run-001', 'checkout', 'GET /api/checkout', mockUserId, mockRoles, 5, false);
        expect(result).toHaveLength(1);
      });
    });
  });
});
