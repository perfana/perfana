import { Test, TestingModule } from '@nestjs/testing';
import { TestRunsController } from './controllers/test-runs.controller';
import { TestRunsAnalysisController } from './controllers/test-runs-analysis.controller';
import { TestRunsService } from './test-runs.service';
import { ValidationException } from '../../common/exceptions/business.exception';
import { PaginationQueryDto } from '../../common/dto';
import { CreateDsCompareConfigDto, UpdateDsCompareConfigDto } from './dto/ds-compare-config.dto';
import { UpdateAdaptConfigDto } from './dto/update-adapt-config.dto';
import { MarkChangepointDto } from './dto/mark-changepoint.dto';
import { DeleteAnomalyDto } from './dto/delete-anomaly.dto';
import { CreateMetricClassificationDto } from './dto/metric-classification.dto';
import { UserContext } from '../../common/decorators/user-context.decorator';
import { TestRunDeletionProcessor } from './processors/test-run-deletion.processor';

// Shared mock data fixtures
const mockTestRun = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  test_run_id: 'PaymentService-production-loadTest-001',
  system_under_test_id: 'sys-123',
  test_environment: 'production',
  workload: 'loadTest',
  start_time: '2024-01-15T10:00:00Z',
  end_time: '2024-01-15T11:00:00Z',
  duration: 3600,
  planned_duration: 3900,
  ramp_up: 300,
  completed: true,
  abort: false,
  status: { phase: 'completed', progress: 100 },
  consolidated_result: 'pass',
  annotations: ['Performance baseline test'],
  tags: ['performance', 'baseline'],
  application_release: '1.2.3',
  ci_build_results_url: 'https://jenkins.example.com/build/123',
  expires: null,
  expired: false,
  valid: true,
  reasons_not_valid: [],
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T11:00:00Z',
  systems_under_test: { name: 'PaymentService' },
  is_changepoint: false,
  is_control_group: false,
  system_name: 'PaymentService',
} as any;

const mockPaginatedResponse = {
  data: [mockTestRun],
  total: 100,
  page: 1,
  pageSize: 50,
  totalPages: 2,
  hasNextPage: true,
  hasPreviousPage: false,
};

const mockServiceFactory = () => ({
  findAllPaginated: jest.fn(),
  findByTestRunId: jest.fn(),
  findByTestRunIdAndParams: jest.fn(),
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
  findByIds: jest.fn().mockResolvedValue([{ id: '550e8400-e29b-41d4-a716-446655440000', deletionStatus: null }]),
  updateAdaptConfig: jest.fn(),
  classifyMetric: jest.fn(),
  markAsChangepoint: jest.fn(),
  getBaselineCandidates: jest.fn(),
  recordTestRunView: jest.fn().mockResolvedValue(undefined),
  verifyTestRunAccess: jest.fn().mockResolvedValue(undefined),
  abortTestRun: jest.fn(),
  updateAnalysisTimeRange: jest.fn(),
  getSummaryTimeseries: jest.fn(),
  getFilterOptions: jest.fn(),
  updateAnalysisStartOffset: jest.fn(),
});

// =============================================================================
// TestRunsController Tests
// =============================================================================
describe('TestRunsController', () => {
  let controller: TestRunsController;
  let service: jest.Mocked<TestRunsService>;

  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestRunsController],
      providers: [
        {
          provide: TestRunsService,
          useValue: mockServiceFactory(),
        },
        {
          provide: TestRunDeletionProcessor,
          useValue: {
            isAvailable: jest.fn().mockReturnValue(true),
            addJob: jest.fn().mockResolvedValue('job-1'),
            addBulkJobs: jest.fn().mockResolvedValue(['job-1']),
            markQueued: jest.fn().mockResolvedValue(undefined),
            processSync: jest.fn().mockResolvedValue({ success: true, id: 'test-id' }),
          },
        },
      ],
    }).compile();

    controller = module.get<TestRunsController>(TestRunsController);
    service = module.get(TestRunsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy Path - Core Queries', () => {
    describe('findAll', () => {
      it('should return paginated test runs with default parameters', async () => {
        // Arrange
        const paginationDto: PaginationQueryDto = {};
        service.findAllPaginated.mockResolvedValue(mockPaginatedResponse);

        // Act
        const result = await controller.findAll(paginationDto, undefined, mockUserContext);

        // Assert
        expect(result).toEqual(mockPaginatedResponse);
        expect(service.findAllPaginated).toHaveBeenCalledWith(
          mockUserContext.userId,
          mockUserContext.roles,
          paginationDto,
          undefined,
        );
        expect(service.findAllPaginated).toHaveBeenCalledTimes(1);
      });

      it('should return paginated test runs with custom pagination', async () => {
        // Arrange
        const paginationDto: PaginationQueryDto = {
          page: 2,
          pageSize: 25,
          sortBy: 'createdAt',
          sortOrder: 'DESC',
        };
        const customResponse = {
          ...mockPaginatedResponse,
          page: 2,
          pageSize: 25,
          hasPreviousPage: true,
        };
        service.findAllPaginated.mockResolvedValue(customResponse);

        // Act
        const result = await controller.findAll(paginationDto, undefined, mockUserContext);

        // Assert
        expect(result).toEqual(customResponse);
        expect(result.page).toBe(2);
        expect(result.pageSize).toBe(25);
        expect(result.hasPreviousPage).toBe(true);
      });

      it('should handle empty results', async () => {
        // Arrange
        const emptyResponse = {
          data: [],
          total: 0,
          page: 1,
          pageSize: 50,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        };
        service.findAllPaginated.mockResolvedValue(emptyResponse);

        // Act
        const result = await controller.findAll({}, undefined, mockUserContext);

        // Assert
        expect(result.data).toHaveLength(0);
        expect(result.total).toBe(0);
      });
    });

    describe('findOne', () => {
      it('should return test run by UUID without query params', async () => {
        // Arrange
        const testRunId = mockTestRun.id;
        service.findByTestRunId.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.findOne(testRunId, {}, undefined, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(service.findByTestRunId).toHaveBeenCalledWith(
          testRunId,
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });

      it('should return test run by test_run_id with query params', async () => {
        // Arrange
        const testRunId = mockTestRun.test_run_id;
        const query = {
          system: 'PaymentService',
          environment: 'production',
          workload: 'loadTest',
        };
        service.findByTestRunIdAndParams.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.findOne(testRunId, query, undefined, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(service.findByTestRunIdAndParams).toHaveBeenCalledWith(
          testRunId,
          query.system,
          query.environment,
          query.workload,
          mockUserContext.userId,
          mockUserContext.roles,
          undefined,
        );
      });

      it('should fallback to findByTestRunId when query params are incomplete', async () => {
        // Arrange
        const testRunId = mockTestRun.test_run_id;
        const query = { system: 'PaymentService' }; // Missing environment and workload
        service.findByTestRunId.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.findOne(testRunId, query, undefined, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(service.findByTestRunId).toHaveBeenCalledWith(
          testRunId,
          mockUserContext.userId,
          mockUserContext.roles,
        );
        expect(service.findByTestRunIdAndParams).not.toHaveBeenCalled();
      });
    });
  });

  describe('Happy Path - Mutation Operations', () => {
    describe('updateAnnotations', () => {
      it('should update test run annotations', async () => {
        // Arrange
        const id = mockTestRun.id;
        const annotations = ['New annotation', 'Another note'];
        const updatedTestRun = { ...mockTestRun, annotations };
        service.updateAnnotations.mockResolvedValue(updatedTestRun);

        // Act
        const result = await controller.updateAnnotations(id, { annotations }, mockUserContext);

        // Assert
        expect(result).toEqual(updatedTestRun);
        expect(service.updateAnnotations).toHaveBeenCalledWith(
          id,
          annotations,
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });
    });

    describe('updateTags', () => {
      it('should update test run tags', async () => {
        // Arrange
        const id = mockTestRun.id;
        const tags = ['performance', 'production', 'critical'];
        const updatedTestRun = { ...mockTestRun, tags };
        service.updateTags.mockResolvedValue(updatedTestRun);

        // Act
        const result = await controller.updateTags(id, { tags }, mockUserContext);

        // Assert
        expect(result).toEqual(updatedTestRun);
        expect(service.updateTags).toHaveBeenCalledWith(
          id,
          tags,
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });
    });

    describe('deleteTestRun', () => {
      it('should queue a test run for deletion by UUID', async () => {
        // Arrange
        const id = mockTestRun.id;

        // Act
        const result = await controller.deleteTestRun(id, mockUserContext);

        // Assert
        expect(result).toEqual({
          message: 'Test run deletion queued',
          status: 'queued',
        });
      });
    });

    describe('PATCH /test-runs/:id/abort', () => {
      it('should abort a running test run', async () => {
        const mockResult = { id: 'uuid-123', test_run_id: 'run-001', abort: true, abort_message: 'Aborted manually by test@example.com', completed: false };
        jest.spyOn(service, 'abortTestRun').mockResolvedValue(mockResult as any);

        const ctx = { ...mockUserContext, email: 'test@example.com' };
        const result = await controller.abortTestRun('uuid-123', ctx as any);

        expect(service.abortTestRun).toHaveBeenCalledWith('uuid-123', mockUserContext.userId, mockUserContext.roles, 'test@example.com');
        expect(result).toEqual(mockResult);
      });

      it('should fall back to userId when email is not present', async () => {
        const mockResult = { id: 'uuid-123', abort: true, abort_message: 'Aborted manually by test-user-123', completed: false };
        jest.spyOn(service, 'abortTestRun').mockResolvedValue(mockResult as any);

        const ctx = { ...mockUserContext, email: undefined };
        await controller.abortTestRun('uuid-123', ctx as any);

        expect(service.abortTestRun).toHaveBeenCalledWith('uuid-123', mockUserContext.userId, mockUserContext.roles, mockUserContext.userId);
      });

      it('should propagate ForbiddenException when verifyTestRunAccess rejects', async () => {
        const { ForbiddenException } = await import('@nestjs/common');
        jest.spyOn(service, 'verifyTestRunAccess').mockRejectedValue(new ForbiddenException());

        await expect(
          controller.abortTestRun('uuid-123', mockUserContext as any),
        ).rejects.toThrow(ForbiddenException);
        expect(service.abortTestRun).not.toHaveBeenCalled();
      });
    });
  });

  describe('Error Scenarios - Validation', () => {
    describe('updateAnnotations', () => {
      it('should throw ValidationException when annotations is not an array', async () => {
        const id = mockTestRun.id;
        await expect(
          controller.updateAnnotations(id, { annotations: 'not an array' as any }, mockUserContext),
        ).rejects.toThrow(ValidationException);
      });

      it('should throw ValidationException when annotations is missing', async () => {
        const id = mockTestRun.id;
        await expect(
          controller.updateAnnotations(id, {} as any, mockUserContext),
        ).rejects.toThrow(ValidationException);
      });
    });

    describe('updateTags', () => {
      it('should throw ValidationException when tags is not an array', async () => {
        const id = mockTestRun.id;
        await expect(
          controller.updateTags(id, { tags: 'not an array' as any }, mockUserContext),
        ).rejects.toThrow(ValidationException);
      });

      it('should throw ValidationException when tags is missing', async () => {
        const id = mockTestRun.id;
        await expect(controller.updateTags(id, {} as any, mockUserContext)).rejects.toThrow(
          ValidationException,
        );
      });
    });
  });

  describe('Edge Cases', () => {
    describe('findOne', () => {
      it('should handle partial query parameters gracefully', async () => {
        const testRunId = mockTestRun.test_run_id;
        const partialQuery = {
          system: 'PaymentService',
          environment: undefined,
          workload: undefined,
        };
        service.findByTestRunId.mockResolvedValue(mockTestRun);

        const result = await controller.findOne(testRunId, partialQuery, undefined, mockUserContext);

        expect(result).toEqual(mockTestRun);
        expect(service.findByTestRunId).toHaveBeenCalledWith(
          testRunId,
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });
    });
  });

  describe('Boundary Values', () => {
    describe('findAll', () => {
      it('should handle maximum page size', async () => {
        const paginationDto: PaginationQueryDto = {
          page: 1,
          pageSize: 100,
        };
        const largeResponse = {
          data: Array(100).fill(mockTestRun),
          total: 1000,
          page: 1,
          pageSize: 100,
          totalPages: 10,
          hasNextPage: true,
          hasPreviousPage: false,
        };
        service.findAllPaginated.mockResolvedValue(largeResponse);

        const result = await controller.findAll(paginationDto, undefined, mockUserContext);

        expect(result.data).toHaveLength(100);
        expect(result.pageSize).toBe(100);
      });

      it('should handle last page with partial results', async () => {
        const paginationDto: PaginationQueryDto = {
          page: 3,
          pageSize: 50,
        };
        const lastPageResponse = {
          data: Array(7).fill(mockTestRun),
          total: 107,
          page: 3,
          pageSize: 50,
          totalPages: 3,
          hasNextPage: false,
          hasPreviousPage: true,
        };
        service.findAllPaginated.mockResolvedValue(lastPageResponse);

        const result = await controller.findAll(paginationDto, undefined, mockUserContext);

        expect(result.data).toHaveLength(7);
        expect(result.hasNextPage).toBe(false);
        expect(result.hasPreviousPage).toBe(true);
      });
    });

    describe('updateAnnotations', () => {
      it('should handle empty annotations array', async () => {
        const id = mockTestRun.id;
        const annotations: string[] = [];
        const updatedTestRun = { ...mockTestRun, annotations };
        service.updateAnnotations.mockResolvedValue(updatedTestRun);

        const result = await controller.updateAnnotations(id, { annotations }, mockUserContext);

        expect(result).toEqual(updatedTestRun);
        expect(result.annotations).toHaveLength(0);
      });

      it('should handle very long annotations array', async () => {
        const id = mockTestRun.id;
        const annotations = Array(50).fill('Long annotation text');
        const updatedTestRun = { ...mockTestRun, annotations };
        service.updateAnnotations.mockResolvedValue(updatedTestRun);

        const result = await controller.updateAnnotations(id, { annotations }, mockUserContext);

        expect(result.annotations).toHaveLength(50);
      });
    });

    describe('updateTags', () => {
      it('should handle empty tags array', async () => {
        const id = mockTestRun.id;
        const tags: string[] = [];
        const updatedTestRun = { ...mockTestRun, tags };
        service.updateTags.mockResolvedValue(updatedTestRun);

        const result = await controller.updateTags(id, { tags }, mockUserContext);

        expect(result).toEqual(updatedTestRun);
        expect(result.tags).toHaveLength(0);
      });
    });
  });

  describe('Response Formatting', () => {
    it('should return properly formatted success message for deleteTestRun', async () => {
      const id = mockTestRun.id;

      const result = await controller.deleteTestRun(id, mockUserContext);

      expect(result).toHaveProperty('message');
      expect(result.message).toBe('Test run deletion queued');
    });
  });

  // G4: PUT :id/analysis-time-range
  describe('PUT :id/analysis-time-range', () => {
    it('should update analysis time range and return the updated test run (happy path)', async () => {
      const id = mockTestRun.id;
      const updatedTestRun = { ...mockTestRun, analysisStartOffset: 60, analysisEndOffset: 120 };
      service.updateAnalysisTimeRange.mockResolvedValue(updatedTestRun);

      const result = await controller.updateAnalysisTimeRange(
        id,
        { analysisStartOffset: 60, analysisEndOffset: 120 },
        mockUserContext,
      );

      expect(result).toEqual(updatedTestRun);
      expect(service.updateAnalysisTimeRange).toHaveBeenCalledWith(
        id,
        60,
        120,
        mockUserContext.userId,
        mockUserContext.roles,
      );
    });

    it('should accept zero values for both offsets', async () => {
      const id = mockTestRun.id;
      service.updateAnalysisTimeRange.mockResolvedValue(mockTestRun);

      const result = await controller.updateAnalysisTimeRange(
        id,
        { analysisStartOffset: 0, analysisEndOffset: 0 },
        mockUserContext,
      );

      expect(result).toEqual(mockTestRun);
      expect(service.updateAnalysisTimeRange).toHaveBeenCalledWith(id, 0, 0, mockUserContext.userId, mockUserContext.roles);
    });

    it('should throw ValidationException when analysisStartOffset is negative', async () => {
      const id = mockTestRun.id;

      await expect(
        controller.updateAnalysisTimeRange(
          id,
          { analysisStartOffset: -1, analysisEndOffset: 0 },
          mockUserContext,
        ),
      ).rejects.toThrow(ValidationException);

      expect(service.updateAnalysisTimeRange).not.toHaveBeenCalled();
    });

    it('should throw ValidationException when analysisEndOffset is negative', async () => {
      const id = mockTestRun.id;

      await expect(
        controller.updateAnalysisTimeRange(
          id,
          { analysisStartOffset: 0, analysisEndOffset: -5 },
          mockUserContext,
        ),
      ).rejects.toThrow(ValidationException);

      expect(service.updateAnalysisTimeRange).not.toHaveBeenCalled();
    });
  });

  // G5: GET :id/summary-timeseries
  describe('GET :id/summary-timeseries', () => {
    it('should return summary timeseries data when service returns a result', async () => {
      const id = mockTestRun.id;
      const mockTimeseries = {
        buckets: [
          { time: '2024-01-15T10:00:00Z', p95: 250, throughput: 120 },
          { time: '2024-01-15T10:01:00Z', p95: 260, throughput: 115 },
        ],
      };
      service.getSummaryTimeseries.mockResolvedValue(mockTimeseries as any);

      const result = await controller.getSummaryTimeseries(id);

      expect(result).toEqual(mockTimeseries);
      expect(service.getSummaryTimeseries).toHaveBeenCalledWith(id);
    });

    it('should throw NotFoundException when service returns null', async () => {
      const id = mockTestRun.id;
      service.getSummaryTimeseries.mockResolvedValue(null);

      const { NotFoundException } = await import('@nestjs/common');

      await expect(controller.getSummaryTimeseries(id)).rejects.toThrow(NotFoundException);
      expect(service.getSummaryTimeseries).toHaveBeenCalledWith(id);
    });
  });

  describe('DTOs and Validation Pipes', () => {
    it('should use UuidValidationPipe for findOne testRunId parameter', async () => {
      const testRunId = mockTestRun.id;
      service.findByTestRunId.mockResolvedValue(mockTestRun);

      await controller.findOne(testRunId, {}, undefined, mockUserContext);

      expect(service.findByTestRunId).toHaveBeenCalledWith(
        testRunId,
        mockUserContext.userId,
        mockUserContext.roles,
      );
    });

    it('should use ParseUUIDPipe for deleteTestRun id parameter', async () => {
      const id = mockTestRun.id;

      const result = await controller.deleteTestRun(id, mockUserContext);

      expect(result).toHaveProperty('message');
      expect(result.status).toBe('queued');
    });
  });
});

// =============================================================================
// TestRunsAnalysisController Tests
// =============================================================================
describe('TestRunsAnalysisController', () => {
  let controller: TestRunsAnalysisController;
  let service: jest.Mocked<TestRunsService>;

  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestRunsAnalysisController],
      providers: [
        {
          provide: TestRunsService,
          useValue: mockServiceFactory(),
        },
      ],
    }).compile();

    controller = module.get<TestRunsAnalysisController>(TestRunsAnalysisController);
    service = module.get(TestRunsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy Path - DS Compare Config', () => {
    describe('createOrUpdateDsCompareConfig', () => {
      it('should create DS compare configuration', async () => {
        const createDto = {
          systemUnderTestId: 'sys-123',
          testEnvironment: 'production',
          workload: 'loadTest',
          applicationDashboardId: 'dash-123',
          panelId: 'panel-1',
          metricName: 'response_time',
          enabled: true,
          threshold: 0.1,
          configData: {},
        } as unknown as CreateDsCompareConfigDto;
        const mockConfig = {
          id: '1',
          ...createDto,
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
        };
        service.createOrUpdateDsCompareConfig.mockResolvedValue(mockConfig as any);

        const result = await controller.createOrUpdateDsCompareConfig(createDto, mockUserContext);

        expect(result).toEqual(mockConfig);
        expect(service.createOrUpdateDsCompareConfig).toHaveBeenCalledWith(createDto, mockUserContext.userId, mockUserContext.roles);
      });
    });

    describe('getDsCompareConfig', () => {
      it('should get DS compare configuration', async () => {
        const params = {
          systemUnderTestId: 'sys-123',
          testEnvironment: 'production',
          workload: 'loadTest',
          applicationDashboardId: 'dash-123',
          panelId: 'panel-1',
          metricName: 'response_time',
        };
        const mockConfig = {
          id: '1',
          ...params,
          enabled: true,
          threshold: 0.1,
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
        };
        service.getDsCompareConfig.mockResolvedValue(mockConfig as any);

        const result = await controller.getDsCompareConfig(
          params.systemUnderTestId,
          params.testEnvironment,
          params.workload,
          params.applicationDashboardId,
          params.panelId,
          mockUserContext,
          params.metricName,
        );

        expect(result).toEqual(mockConfig);
        expect(service.getDsCompareConfig).toHaveBeenCalledWith(
          params.systemUnderTestId,
          params.testEnvironment,
          params.workload,
          params.applicationDashboardId,
          params.panelId,
          params.metricName,
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });
    });

    describe('updateDsCompareConfig', () => {
      it('should update DS compare configuration', async () => {
        const id = '1';
        const updateDto = {
          enabled: false,
          threshold: 0.2,
          configData: {},
        } as unknown as UpdateDsCompareConfigDto;
        const mockUpdated = {
          id,
          systemUnderTestId: 'sys-123',
          testEnvironment: 'production',
          workload: 'loadTest',
          applicationDashboardId: 'dash-123',
          panelId: 'panel-1',
          metricName: 'response_time',
          ...updateDto,
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T11:00:00Z',
        };
        service.updateDsCompareConfig.mockResolvedValue(mockUpdated as any);

        const result = await controller.updateDsCompareConfig(id, updateDto, mockUserContext);

        expect(result).toEqual(mockUpdated);
        expect(service.updateDsCompareConfig).toHaveBeenCalledWith(id, updateDto, mockUserContext.userId, mockUserContext.roles);
      });
    });

    describe('deleteDsCompareConfig', () => {
      it('should delete DS compare configuration', async () => {
        const id = '1';
        service.deleteDsCompareConfig.mockResolvedValue(undefined);

        const result = await controller.deleteDsCompareConfig(id, mockUserContext);

        expect(result).toEqual({
          message: 'DS compare configuration deleted successfully',
        });
        expect(service.deleteDsCompareConfig).toHaveBeenCalledWith(id, mockUserContext.userId, mockUserContext.roles);
      });
    });
  });

  describe('Happy Path - Anomaly Detection', () => {
    describe('getAnomalyDetectionResults', () => {
      it('should return anomaly detection results', async () => {
        const testRunId = mockTestRun.test_run_id;
        const mockResults = [
          {
            metric: 'response_time',
            anomalies: [
              { timestamp: '2024-01-15T10:30:00Z', value: 1200, expected: 800 },
            ],
          },
        ];
        service.getAnomalyDetectionResults.mockResolvedValue(mockResults as any);

        const result = await controller.getAnomalyDetectionResults(testRunId, mockUserContext);

        expect(result).toEqual(mockResults);
        expect(service.getAnomalyDetectionResults).toHaveBeenCalledWith(
          testRunId,
          undefined,
          undefined,
          undefined,
        );
      });
    });

    describe('deleteAnomalyData', () => {
      it('should delete anomaly data', async () => {
        const testRunId = mockTestRun.test_run_id;
        const deleteDto: DeleteAnomalyDto = {
          scope: 'metric',
          range: 'current-test-run',
          metricName: 'response_time',
          applicationDashboardId: 'dash-123',
          panelId: 'panel-1',
          dashboardLabel: 'Test Dashboard',
          panelTitle: 'Response Time',
        };
        const mockResult = { deletedCount: 5 };
        service.deleteAnomalyData.mockResolvedValue(mockResult);

        const result = await controller.deleteAnomalyData(testRunId, deleteDto, mockUserContext);

        expect(result).toEqual({
          message: 'Anomaly data deleted successfully',
          deletedCount: 5,
          scope: deleteDto.scope,
          range: deleteDto.range,
        });
        expect(service.deleteAnomalyData).toHaveBeenCalledWith(testRunId, deleteDto);
      });
    });

    describe('getDsAdaptResult', () => {
      it('should return DS adapt result', async () => {
        const testRunId = mockTestRun.test_run_id;
        const applicationDashboardId = 'dash-123';
        const panelId = 'panel-1';
        const metricName = 'response_time';
        const mockResult = {
          metric: metricName,
          adaptScore: 0.95,
          recommendation: 'accept',
        };
        service.getDsAdaptResult.mockResolvedValue(mockResult as any);

        const result = await controller.getDsAdaptResult(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName,
          mockUserContext,
        );

        expect(result).toEqual(mockResult);
        expect(service.getDsAdaptResult).toHaveBeenCalledWith(
          testRunId,
          applicationDashboardId,
          panelId,
          metricName,
        );
      });
    });
  });

  describe('Happy Path - Changepoint & Metrics', () => {
    describe('getTestRunsAfterChangepoint', () => {
      it('should return test runs after most recent changepoint', async () => {
        const systemUnderTestId = 'sys-123';
        const testEnvironment = 'production';
        const workload = 'loadTest';
        const mockResponse = {
          changepointTestRunId: 'test-run-001',
          testRunIds: ['test-run-002', 'test-run-003'],
        };
        service.getTestRunsAfterMostRecentChangepoint.mockResolvedValue(mockResponse);

        const result = await controller.getTestRunsAfterChangepoint(
          systemUnderTestId,
          testEnvironment,
          workload,
          mockUserContext,
        );

        expect(result).toEqual(mockResponse);
        expect(service.getTestRunsAfterMostRecentChangepoint).toHaveBeenCalledWith(
          systemUnderTestId,
          testEnvironment,
          workload,
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });
    });

    describe('getTestRunsMoreRecentThan', () => {
      it('should return test runs more recent than base test run', async () => {
        const systemUnderTestId = 'sys-123';
        const testEnvironment = 'production';
        const workload = 'loadTest';
        const baseTestRunId = 'test-run-001';
        const mockResponse = {
          testRunIds: ['test-run-002', 'test-run-003', 'test-run-004'],
        };
        service.getTestRunsMoreRecentThan.mockResolvedValue(mockResponse);

        const result = await controller.getTestRunsMoreRecentThan(
          systemUnderTestId,
          testEnvironment,
          workload,
          baseTestRunId,
          mockUserContext,
        );

        expect(result).toEqual(mockResponse);
        expect(service.getTestRunsMoreRecentThan).toHaveBeenCalledWith(
          systemUnderTestId,
          testEnvironment,
          workload,
          baseTestRunId,
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });
    });

    describe('markAsChangepoint', () => {
      it('should mark a test run as a changepoint', async () => {
        const dto: MarkChangepointDto = {
          systemUnderTestId: 'sys-123',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: mockTestRun.test_run_id,
        };
        const mockResponse = {
          message: 'Test run marked as changepoint successfully',
          jobId: 'job-123',
        };
        service.markAsChangepoint.mockResolvedValue(mockResponse);

        const result = await controller.markAsChangepoint(dto, mockUserContext);

        expect(result).toEqual(mockResponse);
        expect(service.markAsChangepoint).toHaveBeenCalledWith(
          dto.systemUnderTestId,
          dto.testEnvironment,
          dto.workload,
          dto.testRunId,
        );
      });
    });

    describe('removeChangepoint', () => {
      it('should remove a test run changepoint', async () => {
        const dto: MarkChangepointDto = {
          systemUnderTestId: 'sys-123',
          testEnvironment: 'production',
          workload: 'loadTest',
          testRunId: mockTestRun.test_run_id,
        };
        const mockResponse = {
          message: 'Test run changepoint removed successfully',
        };
        service.removeChangepoint.mockResolvedValue(mockResponse);

        const result = await controller.removeChangepoint(dto, mockUserContext);

        expect(result).toEqual(mockResponse);
        expect(service.removeChangepoint).toHaveBeenCalledWith(
          dto.systemUnderTestId,
          dto.testEnvironment,
          dto.workload,
          dto.testRunId,
        );
      });
    });

    describe('classifyMetric', () => {
      it('should classify a metric', async () => {
        const testRunId = mockTestRun.test_run_id;
        const createDto: CreateMetricClassificationDto = {
          applicationDashboardId: 'dash-123',
          panelId: 'panel-1',
          metricName: 'response_time',
          classification: 'higher_is_better',
          higherIsBetter: true,
        };
        const mockClassified = {
          id: '1',
          test_run_id: testRunId,
          ...createDto,
          created_at: '2024-01-15T10:00:00Z',
        };
        service.classifyMetric.mockResolvedValue(mockClassified as any);

        const result = await controller.classifyMetric(testRunId, createDto, mockUserContext);

        expect(result).toEqual(mockClassified);
        expect(service.classifyMetric).toHaveBeenCalledWith(
          testRunId,
          createDto,
          undefined,
          undefined,
          undefined,
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });
    });

    describe('updateAdaptConfig', () => {
      it('should update adapt configuration', async () => {
        const testRunId = mockTestRun.test_run_id;
        const updateDto: UpdateAdaptConfigDto = {
          differencesAccepted: 'ACCEPTED',
        };
        const updatedTestRun = {
          ...mockTestRun,
          adapt_config: { differences_accepted: 'ACCEPTED' },
        };
        service.updateAdaptConfig.mockResolvedValue(updatedTestRun as any);

        const result = await controller.updateAdaptConfig(testRunId, updateDto, mockUserContext);

        expect(result).toEqual(updatedTestRun);
        expect(service.updateAdaptConfig).toHaveBeenCalledWith(
          testRunId,
          updateDto.differencesAccepted,
          mockUserContext.userId,
          mockUserContext.roles,
          undefined,
          undefined,
          undefined,
          undefined,
        );
      });
    });
  });

  describe('Error Scenarios - Validation', () => {
    describe('getDsCompareConfig', () => {
      it('should throw ValidationException when required params are missing', async () => {
        await expect(
          controller.getDsCompareConfig('', '', '', '', '', mockUserContext),
        ).rejects.toThrow(ValidationException);
      });

      it('should throw ValidationException with appropriate message', async () => {
        await expect(
          controller.getDsCompareConfig('', '', '', '', '', mockUserContext),
        ).rejects.toThrow(
          new ValidationException(
            'systemUnderTestId, testEnvironment, workload, applicationDashboardId, and panelId are required',
          ),
        );
      });
    });

    describe('getDsAdaptResult', () => {
      it('should throw ValidationException when required params are missing', async () => {
        await expect(
          controller.getDsAdaptResult('test-run-1', '', '', '', mockUserContext),
        ).rejects.toThrow(ValidationException);
      });

      it('should throw ValidationException with appropriate message', async () => {
        await expect(
          controller.getDsAdaptResult('test-run-1', '', '', '', mockUserContext),
        ).rejects.toThrow(
          new ValidationException(
            'applicationDashboardId, panelId, and metricName are required',
          ),
        );
      });
    });

    describe('getTestRunsAfterChangepoint', () => {
      it('should throw ValidationException when params are missing', async () => {
        await expect(
          controller.getTestRunsAfterChangepoint('', '', '', mockUserContext),
        ).rejects.toThrow(ValidationException);
      });
    });

    describe('getTestRunsMoreRecentThan', () => {
      it('should throw ValidationException when params are missing', async () => {
        await expect(
          controller.getTestRunsMoreRecentThan('', '', '', '', mockUserContext),
        ).rejects.toThrow(ValidationException);
      });
    });
  });

  describe('Edge Cases', () => {
    describe('getDsCompareConfig', () => {
      it('should handle optional metricName parameter', async () => {
        const params = {
          systemUnderTestId: 'sys-123',
          testEnvironment: 'production',
          workload: 'loadTest',
          applicationDashboardId: 'dash-123',
          panelId: 'panel-1',
        };
        const mockConfig = {
          id: '1',
          ...params,
          enabled: true,
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
        };
        service.getDsCompareConfig.mockResolvedValue(mockConfig as any);

        const result = await controller.getDsCompareConfig(
          params.systemUnderTestId,
          params.testEnvironment,
          params.workload,
          params.applicationDashboardId,
          params.panelId,
          mockUserContext,
        );

        expect(result).toEqual(mockConfig);
        expect(service.getDsCompareConfig).toHaveBeenCalledWith(
          params.systemUnderTestId,
          params.testEnvironment,
          params.workload,
          params.applicationDashboardId,
          params.panelId,
          undefined,
          mockUserContext.userId,
          mockUserContext.roles,
        );
      });
    });
  });

  describe('Service Delegation - Query Methods', () => {
    it('should delegate getAnomalyDetectionResults with all optional params', async () => {
      const testRunId = mockTestRun.test_run_id;
      const system = 'PaymentService';
      const environment = 'production';
      const workload = 'loadTest';
      const mockResults = [
        {
          metric: 'response_time',
          anomalies: [],
          dashboard_label: 'Dashboard',
          panel_title: 'Panel',
          metric_name: 'response_time',
          unit: 'ms',
          classification: 'lower_is_better',
        },
      ];
      service.getAnomalyDetectionResults.mockResolvedValue(mockResults as any);

      const result = await controller.getAnomalyDetectionResults(
        testRunId,
        mockUserContext,
        system,
        environment,
        workload,
      );

      expect(result).toEqual(mockResults);
      expect(service.getAnomalyDetectionResults).toHaveBeenCalledWith(
        testRunId,
        system,
        environment,
        workload,
      );
    });

    it('should delegate updateAdaptConfig with all optional params', async () => {
      const testRunId = mockTestRun.test_run_id;
      const updateDto: UpdateAdaptConfigDto = { differencesAccepted: 'DENIED' };
      const systemUnderTestId = 'sys-123';
      const environment = 'production';
      const workload = 'loadTest';
      const updatedTestRun = {
        ...mockTestRun,
        adapt_config: { differences_accepted: 'DENIED' },
      };
      service.updateAdaptConfig.mockResolvedValue(updatedTestRun as any);

      const result = await controller.updateAdaptConfig(
        testRunId,
        updateDto,
        mockUserContext,
        systemUnderTestId,
        environment,
        workload,
      );

      expect(result).toEqual(updatedTestRun);
      expect(service.updateAdaptConfig).toHaveBeenCalledWith(
        testRunId,
        updateDto.differencesAccepted,
        mockUserContext.userId,
        mockUserContext.roles,
        systemUnderTestId,
        environment,
        workload,
        undefined,
      );
    });

    it('should delegate classifyMetric with all optional params', async () => {
      const testRunId = mockTestRun.test_run_id;
      const createDto: CreateMetricClassificationDto = {
        applicationDashboardId: 'dash-123',
        panelId: 'panel-1',
        metricName: 'response_time',
        classification: 'lower_is_better',
        higherIsBetter: false,
      };
      const system = 'PaymentService';
      const environment = 'production';
      const workload = 'loadTest';
      const mockClassified = {
        id: '1',
        test_run_id: testRunId,
        ...createDto,
        created_at: '2024-01-15T10:00:00Z',
      };
      service.classifyMetric.mockResolvedValue(mockClassified as any);

      const result = await controller.classifyMetric(
        testRunId,
        createDto,
        mockUserContext,
        system,
        environment,
        workload,
      );

      expect(result).toEqual(mockClassified);
      expect(service.classifyMetric).toHaveBeenCalledWith(
        testRunId,
        createDto,
        system,
        environment,
        workload,
        mockUserContext.userId,
        mockUserContext.roles,
      );
    });
  });

  describe('Response Formatting', () => {
    it('should return properly formatted success message for deleteDsCompareConfig', async () => {
      const id = '1';
      service.deleteDsCompareConfig.mockResolvedValue(undefined);

      const result = await controller.deleteDsCompareConfig(id, mockUserContext);

      expect(result).toHaveProperty('message');
      expect(result.message).toBe('DS compare configuration deleted successfully');
    });

    it('should return detailed response for deleteAnomalyData', async () => {
      const testRunId = mockTestRun.test_run_id;
      const deleteDto: DeleteAnomalyDto = {
        scope: 'panel',
        range: 'all-test-runs',
        applicationDashboardId: 'dash-123',
        panelId: 'panel-1',
        dashboardLabel: 'Test Dashboard',
        panelTitle: 'Response Time',
      };
      const mockResult = { deletedCount: 42 };
      service.deleteAnomalyData.mockResolvedValue(mockResult);

      const result = await controller.deleteAnomalyData(testRunId, deleteDto, mockUserContext);

      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('deletedCount');
      expect(result).toHaveProperty('scope');
      expect(result).toHaveProperty('range');
      expect(result.message).toBe('Anomaly data deleted successfully');
      expect(result.deletedCount).toBe(42);
      expect(result.scope).toBe('panel');
      expect(result.range).toBe('all-test-runs');
    });
  });
});
