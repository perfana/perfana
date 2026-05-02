import { Test, TestingModule } from '@nestjs/testing';
import { TestRunsService, TestRun } from './test-runs.service';
import { TestRunsQueryService } from './services/test-runs-query.service';
import { TestRunsMutationService } from './services/test-runs-mutation.service';
import { TestRunsConfigService } from './services/test-runs-config.service';
import { TestRunsAnomalyService } from './services/test-runs-anomaly.service';
import { TestRunsChangepointService } from './services/test-runs-changepoint.service';
import { TestRunsMetricsService } from './services/test-runs-metrics.service';
import { TestRunsApdexService } from './services/test-runs-apdex.service';
import { UpdateRunningTestDto } from './dto/update-running-test.dto';
import { PaginatedResponseDto } from '../../common/dto';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../common/services/authorization.service';

// Test user context
const testUserId = 'test-user-id';
const testRoles = ['user'];

/**
 * Creates a mock TestRun entity for testing
 */
function createMockTestRun(overrides?: Partial<TestRun>): TestRun {
  return {
    id: 'test-uuid-123',
    test_run_id: 'PaymentService-production-loadTest-001',
    system_under_test_id: 'system-uuid-456',
    test_environment: 'production',
    workload: 'loadTest',
    start_time: '2024-01-15T10:00:00Z',
    end_time: '2024-01-15T11:00:00Z',
    duration: 3600,
    completed: true,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T11:00:00Z',
    systems_under_test: {
      name: 'PaymentService',
    },
    ...overrides,
  };
}

/**
 * Creates mock service with all methods stubbed
 */
function createMockQueryService(): jest.Mocked<Partial<TestRunsQueryService>> {
  return {
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
    getTransactionStats: jest.fn(),
    getTransactionSamples: jest.fn(),
    getTransactionErrors: jest.fn(),
    getTransactionTimeSeries: jest.fn(),
    getSamplerTimeSeries: jest.fn(),
    getVirtualUserStats: jest.fn(),
    getThroughputStats: jest.fn(),
    getDashboardStatistics: jest.fn(),
    getRecentFailures: jest.fn(),
    getDashboardSystemsSummary: jest.fn(),
    getBaselineCandidates: jest.fn(),
    getRequestNames: jest.fn(),
  };
}

function createMockMutationService(): jest.Mocked<Partial<TestRunsMutationService>> {
  return {
    updateRunningTest: jest.fn(),
    initTest: jest.fn(),
    deleteTestRun: jest.fn(),
    updateTags: jest.fn(),
    updateAnnotations: jest.fn(),
    updateAdaptConfig: jest.fn(),
  };
}

function createMockConfigService(): jest.Mocked<Partial<TestRunsConfigService>> {
  return {
    getTestRunConfigs: jest.fn(),
    addTestRunConfig: jest.fn(),
    addTestRunConfigs: jest.fn(),
    addTestRunConfigJson: jest.fn(),
    getLatestConfigKeys: jest.fn(),
    getExpectedConfigChanges: jest.fn(),
    createExpectedConfigChange: jest.fn(),
    deleteExpectedConfigChange: jest.fn(),
    associateStringBasedConfigs: jest.fn(),
  };
}

function createMockAnomalyService(): jest.Mocked<Partial<TestRunsAnomalyService>> {
  return {
    getTestRunCheckResults: jest.fn(),
    getAnomalyDetectionResults: jest.fn(),
    deleteAnomalyData: jest.fn(),
    getDsAdaptResult: jest.fn(),
  };
}

function createMockChangepointService(): jest.Mocked<Partial<TestRunsChangepointService>> {
  return {
    isTestRunChangepoint: jest.fn(),
    getTestRunsMoreRecentThan: jest.fn(),
    markAsChangepoint: jest.fn(),
    removeChangepoint: jest.fn(),
    getTestRunsAfterMostRecentChangepoint: jest.fn(),
  };
}

function createMockMetricsService(): jest.Mocked<Partial<TestRunsMetricsService>> {
  return {
    classifyMetric: jest.fn(),
    createOrUpdateDsCompareConfig: jest.fn(),
    getDsCompareConfig: jest.fn(),
    updateDsCompareConfig: jest.fn(),
    deleteDsCompareConfig: jest.fn(),
  };
}

function createMockApdexService(): jest.Mocked<Partial<TestRunsApdexService>> {
  return {
    getWorkloadApdexThreshold: jest.fn(),
    setWorkloadApdexThreshold: jest.fn(),
    getWorkloadTransactionApdexThresholds: jest.fn(),
    setWorkloadTransactionApdexThreshold: jest.fn(),
    deleteWorkloadTransactionApdexThreshold: jest.fn(),
  };
}

describe('TestRunsService', () => {
  let service: TestRunsService;
  let mockQueryService: jest.Mocked<Partial<TestRunsQueryService>>;
  let mockMutationService: jest.Mocked<Partial<TestRunsMutationService>>;
  let mockConfigService: jest.Mocked<Partial<TestRunsConfigService>>;
  let mockAnomalyService: jest.Mocked<Partial<TestRunsAnomalyService>>;
  let mockChangepointService: jest.Mocked<Partial<TestRunsChangepointService>>;
  let mockMetricsService: jest.Mocked<Partial<TestRunsMetricsService>>;
  let mockApdexService: jest.Mocked<Partial<TestRunsApdexService>>;

  beforeEach(async () => {
    mockQueryService = createMockQueryService();
    mockMutationService = createMockMutationService();
    mockConfigService = createMockConfigService();
    mockAnomalyService = createMockAnomalyService();
    mockChangepointService = createMockChangepointService();
    mockMetricsService = createMockMetricsService();
    mockApdexService = createMockApdexService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsService,
        {
          provide: TestRunsQueryService,
          useValue: mockQueryService,
        },
        {
          provide: TestRunsMutationService,
          useValue: mockMutationService,
        },
        {
          provide: TestRunsConfigService,
          useValue: mockConfigService,
        },
        {
          provide: TestRunsAnomalyService,
          useValue: mockAnomalyService,
        },
        {
          provide: TestRunsChangepointService,
          useValue: mockChangepointService,
        },
        {
          provide: TestRunsMetricsService,
          useValue: mockMetricsService,
        },
        {
          provide: TestRunsApdexService,
          useValue: mockApdexService,
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
      ],
    }).compile();

    service = module.get<TestRunsService>(TestRunsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Query Methods (delegated to QueryService)', () => {
    const mockTestRun = createMockTestRun();
    const mockTestRuns = [mockTestRun];

    describe('findAllPaginated', () => {
      it('should delegate to queryService.findAllPaginated', async () => {
        const paginatedResult: PaginatedResponseDto<TestRun> = {
          data: mockTestRuns,
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        };
        mockQueryService.findAllPaginated!.mockResolvedValue(paginatedResult);

        const result = await service.findAllPaginated(testUserId, testRoles, { page: 1, limit: 10 });

        expect(mockQueryService.findAllPaginated).toHaveBeenCalledWith(testUserId, testRoles, { page: 1, limit: 10 }, undefined);
        expect(result).toEqual(paginatedResult);
      });
    });

    describe('findAll', () => {
      it('should delegate to queryService.findAll', async () => {
        mockQueryService.findAll!.mockResolvedValue(mockTestRuns);

        const result = await service.findAll(testUserId, testRoles);

        expect(mockQueryService.findAll).toHaveBeenCalledWith(testUserId, testRoles);
        expect(result).toEqual(mockTestRuns);
      });
    });

    describe('findByTestRunId', () => {
      it('should delegate to queryService.findByTestRunId', async () => {
        mockQueryService.findByTestRunId!.mockResolvedValue(mockTestRun);

        const result = await service.findByTestRunId('PaymentService-production-loadTest-001', testUserId, testRoles);

        expect(mockQueryService.findByTestRunId).toHaveBeenCalledWith('PaymentService-production-loadTest-001', testUserId, testRoles);
        expect(result).toEqual(mockTestRun);
      });
    });

    describe('findOne', () => {
      it('should delegate to queryService.findOne', async () => {
        mockQueryService.findOne!.mockResolvedValue(mockTestRun);

        const result = await service.findOne('test-uuid-123', testUserId, testRoles);

        expect(mockQueryService.findOne).toHaveBeenCalledWith('test-uuid-123', testUserId, testRoles);
        expect(result).toEqual(mockTestRun);
      });
    });

    describe('getTestRunByTestRunId', () => {
      it('should delegate to queryService.getTestRunByTestRunId', async () => {
        mockQueryService.getTestRunByTestRunId!.mockResolvedValue(mockTestRun);

        const result = await service.getTestRunByTestRunId('PaymentService-production-loadTest-001', testUserId, testRoles);

        expect(mockQueryService.getTestRunByTestRunId).toHaveBeenCalledWith('PaymentService-production-loadTest-001', testUserId, testRoles);
        expect(result).toEqual(mockTestRun);
      });

      it('should return null when test run not found', async () => {
        mockQueryService.getTestRunByTestRunId!.mockResolvedValue(null);

        const result = await service.getTestRunByTestRunId('non-existent', testUserId, testRoles);

        expect(result).toBeNull();
      });
    });

    describe('findByTestRunIdAndParams', () => {
      it('should delegate to queryService.findByTestRunIdAndParams', async () => {
        mockQueryService.findByTestRunIdAndParams!.mockResolvedValue(mockTestRun);

        const result = await service.findByTestRunIdAndParams(
          'test-run-001',
          'PaymentService',
          'production',
          'loadTest',
          testUserId,
          testRoles
        );

        expect(mockQueryService.findByTestRunIdAndParams).toHaveBeenCalledWith(
          'test-run-001',
          'PaymentService',
          'production',
          'loadTest',
          testUserId,
          testRoles,
          undefined
        );
        expect(result).toEqual(mockTestRun);
      });
    });

    describe('getRelatedTestRuns', () => {
      it('should delegate to queryService.getRelatedTestRuns', async () => {
        const relatedRuns = [{ test_run_id: 'run-1', created_at: '2024-01-15' }];
        mockQueryService.getRelatedTestRuns!.mockResolvedValue(relatedRuns);

        const result = await service.getRelatedTestRuns('run-1', testUserId, testRoles, 'system', 'env', 'workload');

        expect(mockQueryService.getRelatedTestRuns).toHaveBeenCalledWith('run-1', testUserId, testRoles, 'system', 'env', 'workload');
        expect(result).toEqual(relatedRuns);
      });
    });

    describe('getSystemsSummary', () => {
      it('should delegate to queryService.getSystemsSummary', async () => {
        const summary = [{
          id: 'system-1',
          name: 'PaymentService',
          environments: [{ environment: 'prod', workloads: ['load'] }],
          created_at: '2024-01-15',
        }];
        mockQueryService.getSystemsSummary!.mockResolvedValue(summary);

        const result = await service.getSystemsSummary(testUserId, testRoles);

        expect(mockQueryService.getSystemsSummary).toHaveBeenCalledWith(testUserId, testRoles, undefined);
        expect(result).toEqual(summary);
      });
    });

    describe('getAllTags', () => {
      it('should delegate to queryService.getAllTags', async () => {
        const tags = ['important', 'regression'];
        mockQueryService.getAllTags!.mockResolvedValue(tags);

        const result = await service.getAllTags(testUserId, testRoles);

        expect(mockQueryService.getAllTags).toHaveBeenCalledWith(testUserId, testRoles);
        expect(result).toEqual(tags);
      });
    });

    describe('getAllAnnotations', () => {
      it('should delegate to queryService.getAllAnnotations', async () => {
        const annotations = ['baseline', 'release-1.0'];
        mockQueryService.getAllAnnotations!.mockResolvedValue(annotations);

        const result = await service.getAllAnnotations(testUserId, testRoles);

        expect(mockQueryService.getAllAnnotations).toHaveBeenCalledWith(testUserId, testRoles);
        expect(result).toEqual(annotations);
      });
    });

    describe('getTransactionStats', () => {
      it('should delegate to queryService.getTransactionStats', async () => {
        const stats = [{
          transaction_name: 'checkout',
          avg_response_time: 150,
          p95_response_time: 200,
          p99_response_time: 250,
          passed_count: 1000,
          failed_count: 10,
          total_count: 1010,
          ranking: 1,
          apdex_score: 0.95,
          active_threshold: 500,
        }];
        mockQueryService.getTransactionStats!.mockResolvedValue(stats);

        const result = await service.getTransactionStats('test-run-id', testUserId, testRoles, true);

        expect(mockQueryService.getTransactionStats).toHaveBeenCalledWith('test-run-id', testUserId, testRoles, true, undefined);
        expect(result).toEqual(stats);
      });
    });

    describe('getBaselineCandidates', () => {
      it('should delegate to queryService.getBaselineCandidates', async () => {
        mockQueryService.getBaselineCandidates!.mockResolvedValue(mockTestRuns);

        const result = await service.getBaselineCandidates('system-id', 'prod', 'load', testUserId, testRoles, 'exclude-id', 10);

        expect(mockQueryService.getBaselineCandidates).toHaveBeenCalledWith(
          'system-id', 'prod', 'load', testUserId, testRoles, 'exclude-id', 10
        );
        expect(result).toEqual(mockTestRuns);
      });
    });

    describe('getDashboardStatistics', () => {
      it('should delegate to queryService.getDashboardStatistics', async () => {
        const stats = { totalRuns: 100, completedRuns: 95 };
        mockQueryService.getDashboardStatistics!.mockResolvedValue(stats);

        const result = await service.getDashboardStatistics(testUserId, testRoles, '7d');

        expect(mockQueryService.getDashboardStatistics).toHaveBeenCalledWith(testUserId, testRoles, '7d', undefined, undefined, undefined);
        expect(result).toEqual(stats);
      });
    });
  });

  describe('Mutation Methods (delegated to MutationService)', () => {
    const mockTestRun = createMockTestRun();

    describe('updateRunningTest', () => {
      it('should delegate to mutationService and call configService.associateStringBasedConfigs', async () => {
        const updateDto: UpdateRunningTestDto = {
          testRunId: 'PaymentService-production-loadTest-001',
          completed: true,
          duration: 3600,
        };
        mockMutationService.updateRunningTest!.mockResolvedValue(mockTestRun);
        mockConfigService.associateStringBasedConfigs!.mockResolvedValue(undefined);

        const result = await service.updateRunningTest(updateDto, testUserId, testRoles, 'org-123');

        expect(mockMutationService.updateRunningTest).toHaveBeenCalledWith(updateDto, testUserId, testRoles, 'org-123');
        expect(mockConfigService.associateStringBasedConfigs).toHaveBeenCalledWith(
          updateDto.testRunId,
          mockTestRun.id
        );
        expect(result).toEqual(mockTestRun);
      });

      it('should not call associateStringBasedConfigs when testRun is null', async () => {
        const updateDto: UpdateRunningTestDto = {
          testRunId: 'non-existent',
          completed: false,
        };
        mockMutationService.updateRunningTest!.mockResolvedValue(null as any);

        await service.updateRunningTest(updateDto, testUserId, testRoles, 'org-123');

        expect(mockMutationService.updateRunningTest).toHaveBeenCalledWith(updateDto, testUserId, testRoles, 'org-123');
        expect(mockConfigService.associateStringBasedConfigs).not.toHaveBeenCalled();
      });
    });

    describe('initTest', () => {
      it('should delegate to mutationService.initTest', async () => {
        const initDto = { testRunId: 'new-test-run', systemUnderTest: 'PaymentService' };
        const response = { testRunId: 'new-test-run', id: 'uuid-123' };
        mockMutationService.initTest!.mockResolvedValue(response);

        const result = await service.initTest(initDto as any, testUserId, testRoles, 'org-123');

        expect(mockMutationService.initTest).toHaveBeenCalledWith(initDto, testUserId, testRoles, 'org-123');
        expect(result).toEqual(response);
      });
    });

    describe('deleteTestRun', () => {
      it('should delegate to mutationService.deleteTestRun', async () => {
        mockMutationService.deleteTestRun!.mockResolvedValue(undefined);

        await service.deleteTestRun('test-uuid-123', testUserId, testRoles);

        expect(mockMutationService.deleteTestRun).toHaveBeenCalledWith('test-uuid-123', testUserId, testRoles);
      });
    });

    describe('updateTags', () => {
      it('should delegate to mutationService.updateTags', async () => {
        const tags = ['important', 'v1.0'];
        mockMutationService.updateTags!.mockResolvedValue({ ...mockTestRun, tags });

        const result = await service.updateTags('test-uuid-123', tags, testUserId, testRoles);

        expect(mockMutationService.updateTags).toHaveBeenCalledWith('test-uuid-123', tags, testUserId, testRoles);
        expect(result.tags).toEqual(tags);
      });
    });

    describe('updateAnnotations', () => {
      it('should delegate to mutationService.updateAnnotations', async () => {
        const annotations = ['baseline', 'release'];
        mockMutationService.updateAnnotations!.mockResolvedValue({ ...mockTestRun, annotations });

        const result = await service.updateAnnotations('test-uuid-123', annotations, testUserId, testRoles);

        expect(mockMutationService.updateAnnotations).toHaveBeenCalledWith('test-uuid-123', annotations, testUserId, testRoles);
        expect(result.annotations).toEqual(annotations);
      });
    });

    describe('updateAdaptConfig', () => {
      it('should delegate to mutationService.updateAdaptConfig', async () => {
        mockMutationService.updateAdaptConfig!.mockResolvedValue(mockTestRun);

        const result = await service.updateAdaptConfig('test-run-id', 'ACCEPTED', testUserId, testRoles, 'system', 'env', 'workload');

        expect(mockMutationService.updateAdaptConfig).toHaveBeenCalledWith(
          'test-run-id', 'ACCEPTED', testUserId, testRoles, 'system', 'env', 'workload', undefined
        );
        expect(result).toEqual(mockTestRun);
      });
    });
  });

  describe('Config Methods (delegated to ConfigService)', () => {
    describe('getTestRunConfigs', () => {
      it('should delegate to configService.getTestRunConfigs', async () => {
        const configs = [{ key: 'setting1', value: 'value1', tags: [] }];
        mockConfigService.getTestRunConfigs!.mockResolvedValue(configs);

        const result = await service.getTestRunConfigs('test-run-id', testUserId, testRoles, 'system', 'env', 'workload');

        expect(mockConfigService.getTestRunConfigs).toHaveBeenCalledWith('test-run-id', testUserId, testRoles, 'system', 'env', 'workload');
        expect(result).toEqual(configs);
      });
    });

    describe('addTestRunConfig', () => {
      it('should delegate to configService.addTestRunConfig', async () => {
        const configDto = { testRunId: 'test-run-id', key: 'setting', value: 'value' };
        mockConfigService.addTestRunConfig!.mockResolvedValue(undefined);

        await service.addTestRunConfig(configDto as any);

        expect(mockConfigService.addTestRunConfig).toHaveBeenCalledWith(configDto);
      });
    });

    describe('getExpectedConfigChanges', () => {
      it('should delegate to configService.getExpectedConfigChanges', async () => {
        const changes = [{ configKey: 'key1', expectedValue: 'value1' }];
        mockConfigService.getExpectedConfigChanges!.mockResolvedValue(changes as any);

        const result = await service.getExpectedConfigChanges('system', 'env', 'workload');

        expect(mockConfigService.getExpectedConfigChanges).toHaveBeenCalledWith('system', 'env', 'workload', undefined, []);
        expect(result).toEqual(changes);
      });
    });
  });

  describe('Anomaly Methods (delegated to AnomalyService)', () => {
    describe('getTestRunCheckResults', () => {
      it('should delegate to anomalyService.getTestRunCheckResults', async () => {
        const results = [{ checkName: 'latency', passed: true }];
        mockAnomalyService.getTestRunCheckResults!.mockResolvedValue(results);

        const result = await service.getTestRunCheckResults('test-run-id', 'system', 'env', 'workload');

        expect(mockAnomalyService.getTestRunCheckResults).toHaveBeenCalledWith('test-run-id', 'system', 'env', 'workload');
        expect(result).toEqual(results);
      });
    });

    describe('deleteAnomalyData', () => {
      it('should delegate to anomalyService.deleteAnomalyData', async () => {
        const deleteDto = { panelId: 'panel-1', metricName: 'latency' };
        mockAnomalyService.deleteAnomalyData!.mockResolvedValue({ deletedCount: 5 });

        const result = await service.deleteAnomalyData('test-run-id', deleteDto as any);

        expect(mockAnomalyService.deleteAnomalyData).toHaveBeenCalledWith('test-run-id', deleteDto);
        expect(result).toEqual({ deletedCount: 5 });
      });
    });
  });

  describe('Changepoint Methods (delegated to ChangepointService)', () => {
    describe('isTestRunChangepoint', () => {
      it('should delegate to changepointService.isTestRunChangepoint', async () => {
        mockChangepointService.isTestRunChangepoint!.mockResolvedValue(true);

        const result = await service.isTestRunChangepoint('system-id', 'env', 'workload', 'test-run-id');

        expect(mockChangepointService.isTestRunChangepoint).toHaveBeenCalledWith(
          'system-id', 'env', 'workload', 'test-run-id'
        );
        expect(result).toBe(true);
      });
    });

    describe('markAsChangepoint', () => {
      it('should delegate to changepointService.markAsChangepoint', async () => {
        const response = { message: 'Marked as changepoint', jobId: 'job-123' };
        mockChangepointService.markAsChangepoint!.mockResolvedValue(response);

        const result = await service.markAsChangepoint('system-id', 'env', 'workload', 'test-run-id');

        expect(mockChangepointService.markAsChangepoint).toHaveBeenCalledWith(
          'system-id', 'env', 'workload', 'test-run-id'
        );
        expect(result).toEqual(response);
      });
    });

    describe('removeChangepoint', () => {
      it('should delegate to changepointService.removeChangepoint', async () => {
        const response = { message: 'Removed changepoint' };
        mockChangepointService.removeChangepoint!.mockResolvedValue(response);

        const result = await service.removeChangepoint('system-id', 'env', 'workload', 'test-run-id');

        expect(mockChangepointService.removeChangepoint).toHaveBeenCalledWith(
          'system-id', 'env', 'workload', 'test-run-id'
        );
        expect(result).toEqual(response);
      });
    });
  });

  describe('Metrics Methods (delegated to MetricsService)', () => {
    describe('classifyMetric', () => {
      it('should delegate to metricsService.classifyMetric', async () => {
        const createDto = { metricName: 'latency', classification: 'IMPORTANT' };
        const response = { id: '1', ...createDto };
        mockMetricsService.classifyMetric!.mockResolvedValue(response as any);

        const result = await service.classifyMetric('test-run-id', createDto as any, 'system', 'env', 'workload');

        expect(mockMetricsService.classifyMetric).toHaveBeenCalledWith(
          'test-run-id', createDto, 'system', 'env', 'workload', undefined, true
        );
        expect(result).toEqual(response);
      });
    });

    describe('getDsCompareConfig', () => {
      it('should delegate to metricsService.getDsCompareConfig', async () => {
        const config = { id: '1', applicationDashboardId: 'dash-1' };
        mockMetricsService.getDsCompareConfig!.mockResolvedValue(config as any);

        const result = await service.getDsCompareConfig('system-id', 'env', 'workload', 'dash-id', 'panel-id', 'metric');

        expect(mockMetricsService.getDsCompareConfig).toHaveBeenCalledWith(
          'system-id', 'env', 'workload', 'dash-id', 'panel-id', 'metric', undefined, true
        );
        expect(result).toEqual(config);
      });
    });
  });

  describe('Apdex Methods (delegated to ApdexService via QueryService)', () => {
    const mockTestRun = createMockTestRun();

    describe('getTestApdexThreshold', () => {
      it('should fetch test run and delegate to apdexService.getWorkloadApdexThreshold', async () => {
        const threshold = { threshold: 500, system: 'PaymentService', environment: 'production', workload: 'loadTest' };
        mockQueryService.findByTestRunId!.mockResolvedValue(mockTestRun);
        mockApdexService.getWorkloadApdexThreshold!.mockResolvedValue(threshold as any);

        const result = await service.getTestApdexThreshold('test-run-id', testUserId, testRoles);

        expect(mockQueryService.findByTestRunId).toHaveBeenCalledWith('test-run-id', testUserId, testRoles);
        expect(mockApdexService.getWorkloadApdexThreshold).toHaveBeenCalledWith(
          'system-uuid-456',
          'production',
          'loadTest',
          testUserId,
          testRoles
        );
        expect(result).toEqual(threshold);
      });

      it('should throw error when system_under_test_id not found', async () => {
        const testRunWithoutSystem = { ...mockTestRun, system_under_test_id: undefined };
        mockQueryService.findByTestRunId!.mockResolvedValue(testRunWithoutSystem);

        await expect(service.getTestApdexThreshold('test-run-id', testUserId, testRoles)).rejects.toThrow(
          'System under test ID not found for test run'
        );
      });
    });

    describe('setTestApdexThreshold', () => {
      it('should fetch test run and delegate to apdexService.setWorkloadApdexThreshold', async () => {
        const dto = { threshold: 600 };
        const response = { threshold: 600, system: 'PaymentService' };
        mockQueryService.findByTestRunId!.mockResolvedValue(mockTestRun);
        mockApdexService.setWorkloadApdexThreshold!.mockResolvedValue(response as any);

        const result = await service.setTestApdexThreshold('test-run-id', dto as any, testUserId, testRoles);

        expect(mockQueryService.findByTestRunId).toHaveBeenCalledWith('test-run-id', testUserId, testRoles);
        expect(mockApdexService.setWorkloadApdexThreshold).toHaveBeenCalledWith(
          'system-uuid-456',
          'production',
          'loadTest',
          dto,
          testUserId,
          testRoles
        );
        expect(result).toEqual(response);
      });
    });

    describe('getTransactionApdexThresholds', () => {
      it('should fetch test run and delegate to apdexService.getWorkloadTransactionApdexThresholds', async () => {
        const thresholds = [{ transactionName: 'checkout', threshold: 500 }];
        mockQueryService.findByTestRunId!.mockResolvedValue(mockTestRun);
        mockApdexService.getWorkloadTransactionApdexThresholds!.mockResolvedValue(thresholds as any);

        const result = await service.getTransactionApdexThresholds('test-run-id', testUserId, testRoles);

        expect(mockQueryService.findByTestRunId).toHaveBeenCalledWith('test-run-id', testUserId, testRoles);
        expect(mockApdexService.getWorkloadTransactionApdexThresholds).toHaveBeenCalledWith(
          'system-uuid-456',
          'production',
          'loadTest',
          testUserId,
          testRoles
        );
        expect(result).toEqual(thresholds);
      });
    });

    describe('setTransactionApdexThreshold', () => {
      it('should fetch test run and delegate to apdexService.setWorkloadTransactionApdexThreshold', async () => {
        const dto = { threshold: 300 };
        const response = { transactionName: 'checkout', threshold: 300 };
        mockQueryService.findByTestRunId!.mockResolvedValue(mockTestRun);
        mockApdexService.setWorkloadTransactionApdexThreshold!.mockResolvedValue(response as any);

        const result = await service.setTransactionApdexThreshold('test-run-id', 'checkout', dto as any, testUserId, testRoles);

        expect(mockQueryService.findByTestRunId).toHaveBeenCalledWith('test-run-id', testUserId, testRoles);
        expect(mockApdexService.setWorkloadTransactionApdexThreshold).toHaveBeenCalledWith(
          'system-uuid-456',
          'production',
          'loadTest',
          'checkout',
          dto,
          testUserId,
          testRoles
        );
        expect(result).toEqual(response);
      });
    });

    describe('deleteTransactionApdexThreshold', () => {
      it('should fetch test run and delegate to apdexService.deleteWorkloadTransactionApdexThreshold', async () => {
        const response = { message: 'Deleted successfully' };
        mockQueryService.findByTestRunId!.mockResolvedValue(mockTestRun);
        mockApdexService.deleteWorkloadTransactionApdexThreshold!.mockResolvedValue(response);

        const result = await service.deleteTransactionApdexThreshold('test-run-id', 'checkout', testUserId, testRoles);

        expect(mockQueryService.findByTestRunId).toHaveBeenCalledWith('test-run-id', testUserId, testRoles);
        expect(mockApdexService.deleteWorkloadTransactionApdexThreshold).toHaveBeenCalledWith(
          'system-uuid-456',
          'production',
          'loadTest',
          'checkout',
          testUserId,
          testRoles
        );
        expect(result).toEqual(response);
      });
    });
  });

  describe('Additional Query Methods', () => {
    describe('getRequestNames', () => {
      it('should delegate to queryService.getRequestNames', async () => {
        const requestNames = ['GET /api/users', 'POST /api/orders'];
        mockQueryService.getRequestNames!.mockResolvedValue(requestNames);

        const result = await service.getRequestNames('test-run-id', testUserId, testRoles, 'panel-description');

        expect(mockQueryService.getRequestNames).toHaveBeenCalledWith('test-run-id', testUserId, testRoles, 'panel-description');
        expect(result).toEqual(requestNames);
      });
    });
  });
});
