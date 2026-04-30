import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataScienceController } from './data-science.controller';
import { BullMQClientService } from '../services/bullmq-client.service';
import { JobProgressService } from '../services/job-progress.service';
import { JobProgressGateway } from '../gateways/job-progress.gateway';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { UserContext } from '../../../common/decorators/user-context.decorator';
import { BatchRefreshDto, BatchReevaluateDto, AvailableSourcesRequestDto } from '../dto/batch-processing.dto';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const mockUserContext: UserContext = {
  userId: 'user-123',
  roles: ['user'],
  organizations: ['org-456'],
  teams: ['team-789'],
  organizationId: 'org-456',
  teamId: 'team-789',
};

const mockAdminContext: UserContext = {
  userId: 'admin-001',
  roles: ['perfana-admin'],
  organizations: [],
  teams: [],
  organizationId: undefined,
  teamId: undefined,
};

const mockJobResult = {
  success: true,
  jobId: 'job-abc123',
  testRunId: 'MyApp-prod-loadTest-001',
  message: 'Analysis initiated',
  estimatedDuration: '5 minutes',
  stages: 7,
  trackingUrl: '/api/data/jobs/job-abc123/status',
};

const mockBatchResult = {
  success: true,
  batchId: 'batch-xyz789',
  totalTestRuns: 2,
  batchesCreated: 1,
  estimatedDuration: '10 minutes',
  trackingUrl: '/api/data/batches/batch-xyz789/status',
  individualJobs: ['job-1', 'job-2'],
};

const mockReevalResult = {
  success: true,
  reevaluationId: 'reeval-qrs456',
  jobId: 'job-def456',
  testRunsProcessed: 2,
  skippedStages: ['data-collection'],
  estimatedDuration: '3 minutes',
  trackingUrl: '/api/data/jobs/job-def456/status',
};

const mockJobProgress = {
  jobId: 'job-abc123',
  testRunId: 'test-run-001',
  type: 'analyze',
  status: 'running',
  progress: 50,
  systemUnderTestId: 'sys-001',
  testEnvironment: 'production',
  workload: 'loadTest',
};

// ---------------------------------------------------------------------------
// Service mock factories
// ---------------------------------------------------------------------------

const makeBullmqClientMock = () => ({
  analyzeTest: jest.fn().mockResolvedValue(mockJobResult),
  refreshBatch: jest.fn().mockResolvedValue(mockBatchResult),
  reevaluateBatch: jest.fn().mockResolvedValue(mockReevalResult),
  getJobStatus: jest.fn().mockResolvedValue({ jobId: 'job-abc123', status: 'completed' }),
});

const makeJobProgressServiceMock = () => ({
  isJobBlocked: jest.fn().mockResolvedValue({ blocked: false }),
  getHealthStatus: jest.fn().mockReturnValue({ status: 'healthy' }),
  getAllActiveJobs: jest.fn().mockReturnValue([]),
  getActiveJobForScope: jest.fn().mockResolvedValue(null),
  getJobProgress: jest.fn().mockResolvedValue(mockJobProgress),
  getLockInfo: jest.fn().mockResolvedValue({ locked: false }),
  releaseLock: jest.fn().mockResolvedValue({ released: true, previousLock: { jobId: 'job-old' } }),
});

const makeJobProgressGatewayMock = () => ({
  emitJobBlocked: jest.fn(),
});

const makeAuthzServiceMock = () => ({
  isGlobalAdmin: jest.fn().mockReturnValue(false),
  getAccessibleOrganizations: jest.fn().mockResolvedValue(['org-456']),
  canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'Mock: access allowed' }),
});

const makeDataSourceMock = () => ({
  query: jest.fn(),
});

// ---------------------------------------------------------------------------
// Helper — build the NestJS testing module
// ---------------------------------------------------------------------------

async function buildModule(overrides?: {
  bullmqClient?: Partial<ReturnType<typeof makeBullmqClientMock>>;
  jobProgressService?: Partial<ReturnType<typeof makeJobProgressServiceMock>>;
  jobProgressGateway?: Partial<ReturnType<typeof makeJobProgressGatewayMock>>;
  authzService?: Partial<ReturnType<typeof makeAuthzServiceMock>>;
  dataSource?: Partial<ReturnType<typeof makeDataSourceMock>>;
}) {
  const bullmqClient = { ...makeBullmqClientMock(), ...overrides?.bullmqClient };
  const jobProgressService = { ...makeJobProgressServiceMock(), ...overrides?.jobProgressService };
  const jobProgressGateway = { ...makeJobProgressGatewayMock(), ...overrides?.jobProgressGateway };
  const authzService = { ...makeAuthzServiceMock(), ...overrides?.authzService };
  const dataSource = { ...makeDataSourceMock(), ...overrides?.dataSource };

  const module: TestingModule = await Test.createTestingModule({
    controllers: [DataScienceController],
    providers: [
      { provide: BullMQClientService, useValue: bullmqClient },
      { provide: JobProgressService, useValue: jobProgressService },
      { provide: JobProgressGateway, useValue: jobProgressGateway },
      { provide: AuthorizationService, useValue: authzService },
      { provide: getDataSourceToken(), useValue: dataSource },
    ],
  }).compile();

  return {
    controller: module.get<DataScienceController>(DataScienceController),
    bullmqClient: bullmqClient as jest.Mocked<typeof bullmqClient>,
    jobProgressService: jobProgressService as jest.Mocked<typeof jobProgressService>,
    jobProgressGateway: jobProgressGateway as jest.Mocked<typeof jobProgressGateway>,
    authzService: authzService as jest.Mocked<typeof authzService>,
    dataSource: dataSource as jest.Mocked<typeof dataSource>,
  };
}

// ===========================================================================
// Test suites
// ===========================================================================

describe('DataScienceController', () => {
  // -------------------------------------------------------------------------
  // analyzeTest
  // -------------------------------------------------------------------------
  describe('analyzeTest', () => {
    describe('Happy Path', () => {
      it('should initiate analysis and return status/data/links on success', async () => {
        // Arrange
        const { controller, bullmqClient, dataSource } = await buildModule();

        // getTestRunScope query
        dataSource.query
          .mockResolvedValueOnce([]) // verifyTestRunAccess — org check (non-admin fast-path skips because isGlobalAdmin=false but getAccessibleOrganizations covers it)
          .mockResolvedValueOnce([]) // getTestRunScope inside verifyTestRunAccess
          .mockResolvedValueOnce([{
            system_under_test_id: 'sys-001',
            test_environment: 'production',
            workload: 'loadTest',
          }]);

        // Arrange: make verifyTestRunAccess pass — org_id is null so no org check fails
        dataSource.query
          .mockReset()
          .mockResolvedValueOnce([{ organization_id: null }])          // verifyTestRunAccess
          .mockResolvedValueOnce([{                                     // getTestRunScope
            system_under_test_id: 'sys-001',
            test_environment: 'production',
            workload: 'loadTest',
          }]);

        // Act
        const result = await controller.analyzeTest(
          'MyApp-prod-loadTest-001',
          mockUserContext,
          'true',
          'false',
        );

        // Assert
        expect(result.status).toBe('initiated');
        expect(result.data).toEqual(mockJobResult);
        expect(result.links).toMatchObject({
          status: expect.stringContaining(mockJobResult.jobId),
          results: expect.stringContaining('MyApp-prod-loadTest-001'),
          cancel: expect.stringContaining(mockJobResult.jobId),
        });
        expect(bullmqClient.analyzeTest).toHaveBeenCalledWith(
          'MyApp-prod-loadTest-001',
          { adapt: true, benchmarksOnly: false },
        );
      });

      it('should pass adapt=false and benchmarksOnly=true correctly', async () => {
        const { controller, bullmqClient, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{
            system_under_test_id: 'sys-001',
            test_environment: 'production',
            workload: 'loadTest',
          }]);

        await controller.analyzeTest(
          'MyApp-prod-loadTest-001',
          mockUserContext,
          'false',
          'true',
        );

        expect(bullmqClient.analyzeTest).toHaveBeenCalledWith(
          'MyApp-prod-loadTest-001',
          { adapt: false, benchmarksOnly: true },
        );
      });

      it('should default adapt and benchmarksOnly to false when not provided', async () => {
        const { controller, bullmqClient, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{
            system_under_test_id: 'sys-001',
            test_environment: 'production',
            workload: 'loadTest',
          }]);

        await controller.analyzeTest('MyApp-prod-loadTest-001', mockUserContext, undefined, undefined);

        expect(bullmqClient.analyzeTest).toHaveBeenCalledWith(
          'MyApp-prod-loadTest-001',
          { adapt: false, benchmarksOnly: false },
        );
      });

      it('should trim whitespace from testRunId before calling service', async () => {
        const { controller, bullmqClient, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{
            system_under_test_id: 'sys-001',
            test_environment: 'production',
            workload: 'loadTest',
          }]);

        await controller.analyzeTest('  MyApp-prod-loadTest-001  ', mockUserContext, undefined, undefined);

        expect(bullmqClient.analyzeTest).toHaveBeenCalledWith(
          'MyApp-prod-loadTest-001',
          expect.any(Object),
        );
      });

      it('should grant access for global admin', async () => {
        // verifyTestRunAccess now always loads the test_runs row, then defers
        // to canAccessResource (which short-circuits for global admins internally).
        const { controller, authzService, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: 'restricted-org', created_by: 'someone' }])
          .mockResolvedValueOnce([{
            system_under_test_id: 'sys-001',
            test_environment: 'production',
            workload: 'loadTest',
          }]);

        await controller.analyzeTest('MyApp-prod-loadTest-001', mockAdminContext, undefined, undefined);

        expect(authzService.canAccessResource).toHaveBeenCalled();
      });
    });

    describe('Error Scenarios', () => {
      it('should throw BadRequestException for empty testRunId', async () => {
        const { controller } = await buildModule();

        await expect(
          controller.analyzeTest('', mockUserContext, undefined, undefined),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException for whitespace-only testRunId', async () => {
        const { controller } = await buildModule();

        await expect(
          controller.analyzeTest('   ', mockUserContext, undefined, undefined),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException wrapping NotFoundException when test run does not exist in verifyTestRunAccess', async () => {
        // The controller's outer catch re-throws NotFoundException as BadRequestException
        // because only ConflictException and ForbiddenException are explicitly re-thrown as-is.
        const { controller, dataSource } = await buildModule();

        // verifyTestRunAccess returns empty — not found
        dataSource.query.mockResolvedValueOnce([]);

        await expect(
          controller.analyzeTest('unknown-run', mockUserContext, undefined, undefined),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw ForbiddenException when user lacks org access', async () => {
        const { controller, dataSource } = await buildModule({
          authzService: {
            canAccessResource: jest.fn().mockResolvedValue({ allowed: false, reason: 'denied' }),
          },
        });

        dataSource.query.mockResolvedValueOnce([{ organization_id: 'restricted-org', created_by: 'someone' }]);

        await expect(
          controller.analyzeTest('MyApp-prod-loadTest-001', mockUserContext, undefined, undefined),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should throw BadRequestException wrapping NotFoundException when getTestRunScope returns null', async () => {
        // NotFoundException from inside the try block is caught and re-thrown as BadRequestException
        // because only ConflictException and ForbiddenException are explicitly passed through.
        const { controller, dataSource } = await buildModule();

        // verifyTestRunAccess passes (null org_id)
        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          // getTestRunScope returns empty — not found
          .mockResolvedValueOnce([]);

        await expect(
          controller.analyzeTest('MyApp-prod-loadTest-001', mockUserContext, undefined, undefined),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw ConflictException when a job is already blocked', async () => {
        const { controller, dataSource, jobProgressGateway } = await buildModule({
          jobProgressService: {
            isJobBlocked: jest.fn().mockResolvedValue({
              blocked: true,
              reason: 'Another job is running',
              existingJobId: 'job-running',
              existingJobProgress: mockJobProgress,
              scopeKey: 'sys-001:production:loadTest',
            }),
          },
        });

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{
            system_under_test_id: 'sys-001',
            test_environment: 'production',
            workload: 'loadTest',
          }]);

        await expect(
          controller.analyzeTest('MyApp-prod-loadTest-001', mockUserContext, undefined, undefined),
        ).rejects.toThrow(ConflictException);

        expect(jobProgressGateway.emitJobBlocked).toHaveBeenCalled();
      });

      it('should wrap unexpected service errors in BadRequestException', async () => {
        const { controller, bullmqClient, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{
            system_under_test_id: 'sys-001',
            test_environment: 'production',
            workload: 'loadTest',
          }]);

        bullmqClient.analyzeTest.mockRejectedValueOnce(new Error('Queue unavailable'));

        await expect(
          controller.analyzeTest('MyApp-prod-loadTest-001', mockUserContext, undefined, undefined),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });

  // -------------------------------------------------------------------------
  // getAvailableSources
  // -------------------------------------------------------------------------
  describe('getAvailableSources', () => {
    describe('Happy Path', () => {
      it('should return both false when scopes array is empty', async () => {
        const { controller } = await buildModule();

        const dto: AvailableSourcesRequestDto = { scopes: [] };
        const result = await controller.getAvailableSources(dto);

        expect(result).toEqual({ grafana: false, dynatrace: false });
      });

      it('should return both false when all scopes have invalid UUIDs', async () => {
        const { controller } = await buildModule();

        const dto: AvailableSourcesRequestDto = {
          scopes: [{ systemUnderTestId: 'not-a-uuid', testEnvironment: 'prod', workload: 'load' }],
        };
        const result = await controller.getAvailableSources(dto);

        expect(result).toEqual({ grafana: false, dynatrace: false });
      });

      it('should return grafana=true when application_dashboards row exists', async () => {
        const { controller, dataSource } = await buildModule();

        // dynatrace query (workload present)
        dataSource.query
          .mockResolvedValueOnce([{ has_rows: false }])   // dynatrace
          .mockResolvedValueOnce([{ has_rows: true }]);   // grafana

        const dto: AvailableSourcesRequestDto = {
          scopes: [{
            systemUnderTestId: '550e8400-e29b-41d4-a716-446655440001',
            testEnvironment: 'production',
            workload: 'loadTest',
          }],
        };
        const result = await controller.getAvailableSources(dto);

        expect(result).toEqual({ grafana: true, dynatrace: false });
      });

      it('should return dynatrace=true when dynatrace_queries row exists', async () => {
        const { controller, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ has_rows: true }])    // dynatrace
          .mockResolvedValueOnce([{ has_rows: false }]);  // grafana

        const dto: AvailableSourcesRequestDto = {
          scopes: [{
            systemUnderTestId: '550e8400-e29b-41d4-a716-446655440001',
            testEnvironment: 'production',
            workload: 'loadTest',
          }],
        };
        const result = await controller.getAvailableSources(dto);

        expect(result).toEqual({ grafana: false, dynatrace: true });
      });

      it('should deduplicate identical scopes before querying', async () => {
        const { controller, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ has_rows: false }])
          .mockResolvedValueOnce([{ has_rows: false }]);

        const dto: AvailableSourcesRequestDto = {
          scopes: [
            { systemUnderTestId: '550e8400-e29b-41d4-a716-446655440001', testEnvironment: 'prod', workload: 'load' },
            { systemUnderTestId: '550e8400-e29b-41d4-a716-446655440001', testEnvironment: 'prod', workload: 'load' },
          ],
        };

        await controller.getAvailableSources(dto);

        // Should only issue 2 DB queries (dt + grafana), not 4
        expect(dataSource.query).toHaveBeenCalledTimes(2);
      });

      it('should skip dynatrace query when no scope has a workload', async () => {
        const { controller, dataSource } = await buildModule();

        dataSource.query.mockResolvedValueOnce([{ has_rows: false }]); // only grafana

        const dto: AvailableSourcesRequestDto = {
          scopes: [{
            systemUnderTestId: '550e8400-e29b-41d4-a716-446655440001',
            testEnvironment: 'production',
            workload: '',
          }],
        };

        await controller.getAvailableSources(dto);

        // Only one query (grafana), no dynatrace query because workload is empty
        expect(dataSource.query).toHaveBeenCalledTimes(1);
      });

      it('should return grafana=true and dynatrace=true on DB error (graceful degradation)', async () => {
        const { controller, dataSource } = await buildModule();

        dataSource.query.mockRejectedValueOnce(new Error('DB connection failed'));

        const dto: AvailableSourcesRequestDto = {
          scopes: [{
            systemUnderTestId: '550e8400-e29b-41d4-a716-446655440001',
            testEnvironment: 'production',
            workload: 'loadTest',
          }],
        };

        const result = await controller.getAvailableSources(dto);

        expect(result).toEqual({ grafana: true, dynatrace: true });
      });
    });
  });

  // -------------------------------------------------------------------------
  // refreshBatch
  // -------------------------------------------------------------------------
  describe('refreshBatch', () => {
    describe('Happy Path', () => {
      it('should initiate batch refresh and return status/data/links', async () => {
        const { controller, bullmqClient, dataSource } = await buildModule();

        // Each testRunId needs: verifyTestRunAccess + getTestRunScope for block check
        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])  // verifyTestRunAccess run-1
          .mockResolvedValueOnce([{ organization_id: null }])  // verifyTestRunAccess run-2
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-1', test_environment: 'prod', workload: 'load' }])  // getTestRunScope run-1
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-2', test_environment: 'prod', workload: 'load' }]); // getTestRunScope run-2

        const dto: BatchRefreshDto = {
          testRunIds: ['run-1', 'run-2'],
          adapt: true,
        };

        const result = await controller.refreshBatch(dto, mockUserContext);

        expect(result.status).toBe('initiated');
        expect(result.data).toEqual(mockBatchResult);
        expect(result.links).toMatchObject({
          status: expect.stringContaining(mockBatchResult.batchId),
          progress: expect.stringContaining(mockBatchResult.batchId),
          cancel: expect.stringContaining(mockBatchResult.batchId),
        });
        expect(bullmqClient.refreshBatch).toHaveBeenCalledWith(
          ['run-1', 'run-2'],
          { adapt: true, sources: undefined, forceRefetch: undefined },
        );
      });

      it('should deduplicate test run IDs before calling service', async () => {
        const { controller, bullmqClient, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-1', test_environment: 'prod', workload: 'load' }])
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-1', test_environment: 'prod', workload: 'load' }]);

        const dto: BatchRefreshDto = {
          testRunIds: ['run-1', 'run-1', 'run-2'],
          adapt: false,
        };

        await controller.refreshBatch(dto, mockUserContext);

        expect(bullmqClient.refreshBatch).toHaveBeenCalledWith(
          ['run-1', 'run-2'],
          expect.any(Object),
        );
      });

      it('should forward sources and forceRefetch options to service', async () => {
        const { controller, bullmqClient, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-1', test_environment: 'prod', workload: 'load' }]);

        const dto: BatchRefreshDto = {
          testRunIds: ['run-1'],
          adapt: true,
          sources: { grafana: true, dynatrace: false, performanceMetrics: false },
          forceRefetch: true,
        };

        await controller.refreshBatch(dto, mockUserContext);

        expect(bullmqClient.refreshBatch).toHaveBeenCalledWith(
          ['run-1'],
          { adapt: true, sources: dto.sources, forceRefetch: true },
        );
      });
    });

    describe('Error Scenarios', () => {
      it('should throw BadRequestException when testRunIds is empty', async () => {
        const { controller } = await buildModule();

        const dto: BatchRefreshDto = { testRunIds: [] };

        await expect(controller.refreshBatch(dto, mockUserContext)).rejects.toThrow(BadRequestException);
      });

      it('should throw ConflictException when a blocked job is found in the batch', async () => {
        const { controller, dataSource } = await buildModule({
          jobProgressService: {
            isJobBlocked: jest.fn().mockResolvedValue({
              blocked: true,
              reason: 'Scope locked',
              existingJobId: 'job-running',
              existingJobProgress: null,
              scopeKey: 'sys-1:prod:load',
            }),
          },
        });

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-1', test_environment: 'prod', workload: 'load' }]);

        const dto: BatchRefreshDto = { testRunIds: ['run-1'] };

        await expect(controller.refreshBatch(dto, mockUserContext)).rejects.toThrow(ConflictException);
      });

      it('should throw ForbiddenException when user lacks access to a test run', async () => {
        const { controller, dataSource } = await buildModule({
          authzService: {
            canAccessResource: jest.fn().mockResolvedValue({ allowed: false, reason: 'denied' }),
          },
        });

        dataSource.query.mockResolvedValueOnce([{ organization_id: 'restricted-org', created_by: 'someone' }]);

        const dto: BatchRefreshDto = { testRunIds: ['run-1'] };

        await expect(controller.refreshBatch(dto, mockUserContext)).rejects.toThrow(ForbiddenException);
      });

      it('should wrap unexpected errors in BadRequestException', async () => {
        const { controller, bullmqClient, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-1', test_environment: 'prod', workload: 'load' }]);

        bullmqClient.refreshBatch.mockRejectedValueOnce(new Error('Queue error'));

        const dto: BatchRefreshDto = { testRunIds: ['run-1'] };

        await expect(controller.refreshBatch(dto, mockUserContext)).rejects.toThrow(BadRequestException);
      });
    });
  });

  // -------------------------------------------------------------------------
  // reevaluateBatch
  // -------------------------------------------------------------------------
  describe('reevaluateBatch', () => {
    describe('Happy Path', () => {
      it('should initiate batch reevaluation and return the service result', async () => {
        const { controller, bullmqClient, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-1', test_environment: 'prod', workload: 'load' }]);

        const dto: BatchReevaluateDto = {
          testRunIds: ['run-1'],
          checks: true,
          adapt: true,
        };

        const result = await controller.reevaluateBatch(dto, mockUserContext);

        expect(result).toEqual(mockReevalResult);
        expect(bullmqClient.reevaluateBatch).toHaveBeenCalledWith(
          ['run-1'],
          { checks: true, adapt: true, applicationDashboardId: undefined, metricsSourceId: undefined, panelId: undefined, metricName: undefined },
        );
      });

      it('should pass optional metric targeting fields to service', async () => {
        const { controller, bullmqClient, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-1', test_environment: 'prod', workload: 'load' }]);

        const dto: BatchReevaluateDto = {
          testRunIds: ['run-1'],
          checks: true,
          adapt: false,
          applicationDashboardId: '550e8400-e29b-41d4-a716-446655440001',
          metricsSourceId: '550e8400-e29b-41d4-a716-446655440002',
          panelId: 42,
          metricName: 'response_time_p90',
        };

        await controller.reevaluateBatch(dto, mockUserContext);

        expect(bullmqClient.reevaluateBatch).toHaveBeenCalledWith(
          ['run-1'],
          {
            checks: true,
            adapt: false,
            applicationDashboardId: '550e8400-e29b-41d4-a716-446655440001',
            metricsSourceId: '550e8400-e29b-41d4-a716-446655440002',
            panelId: 42,
            metricName: 'response_time_p90',
          },
        );
      });

      it('should deduplicate test run IDs before processing', async () => {
        const { controller, bullmqClient, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-1', test_environment: 'prod', workload: 'load' }])
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-1', test_environment: 'prod', workload: 'load' }]);

        const dto: BatchReevaluateDto = {
          testRunIds: ['run-1', 'run-1'],
          checks: true,
          adapt: false,
        };

        await controller.reevaluateBatch(dto, mockUserContext);

        expect(bullmqClient.reevaluateBatch).toHaveBeenCalledWith(
          ['run-1'],
          expect.any(Object),
        );
      });
    });

    describe('Error Scenarios', () => {
      it('should throw BadRequestException when testRunIds is empty', async () => {
        const { controller } = await buildModule();

        const dto: BatchReevaluateDto = { testRunIds: [], checks: true, adapt: true };

        await expect(controller.reevaluateBatch(dto, mockUserContext)).rejects.toThrow(BadRequestException);
      });

      it('should throw ConflictException when batch has blocked jobs', async () => {
        const { controller, dataSource } = await buildModule({
          jobProgressService: {
            isJobBlocked: jest.fn().mockResolvedValue({
              blocked: true,
              reason: 'Already running',
              existingJobId: 'job-x',
              existingJobProgress: null,
              scopeKey: 'sys-1:prod:load',
            }),
          },
        });

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-1', test_environment: 'prod', workload: 'load' }]);

        const dto: BatchReevaluateDto = { testRunIds: ['run-1'], checks: true, adapt: false };

        await expect(controller.reevaluateBatch(dto, mockUserContext)).rejects.toThrow(ConflictException);
      });

      it('should wrap service errors in BadRequestException', async () => {
        const { controller, bullmqClient, dataSource } = await buildModule();

        dataSource.query
          .mockResolvedValueOnce([{ organization_id: null }])
          .mockResolvedValueOnce([{ system_under_test_id: 'sys-1', test_environment: 'prod', workload: 'load' }]);

        bullmqClient.reevaluateBatch.mockRejectedValueOnce(new Error('Worker offline'));

        const dto: BatchReevaluateDto = { testRunIds: ['run-1'], checks: true, adapt: true };

        await expect(controller.reevaluateBatch(dto, mockUserContext)).rejects.toThrow(BadRequestException);
      });
    });
  });

  // -------------------------------------------------------------------------
  // getJobStatus
  // -------------------------------------------------------------------------
  describe('getJobStatus', () => {
    describe('Happy Path', () => {
      it('should return job status from bullmq client', async () => {
        const { controller, bullmqClient } = await buildModule();

        const jobStatus = { jobId: 'job-abc123', status: 'completed', progress: 100 };
        bullmqClient.getJobStatus.mockResolvedValueOnce(jobStatus);

        const result = await controller.getJobStatus('job-abc123');

        expect(result).toEqual(jobStatus);
        expect(bullmqClient.getJobStatus).toHaveBeenCalledWith('job-abc123');
      });
    });

    describe('Error Scenarios', () => {
      it('should throw NotFoundException when error message contains "not found"', async () => {
        const { controller, bullmqClient } = await buildModule();

        bullmqClient.getJobStatus.mockRejectedValueOnce(new Error('job not found in queue'));

        await expect(controller.getJobStatus('missing-job')).rejects.toThrow(NotFoundException);
      });

      it('should throw BadRequestException for other service errors', async () => {
        const { controller, bullmqClient } = await buildModule();

        bullmqClient.getJobStatus.mockRejectedValueOnce(new Error('Redis timeout'));

        await expect(controller.getJobStatus('job-abc123')).rejects.toThrow(BadRequestException);
      });
    });
  });

  // -------------------------------------------------------------------------
  // getTestRunJobs
  // -------------------------------------------------------------------------
  describe('getTestRunJobs', () => {
    it('should throw BadRequestException as the endpoint is not yet implemented', async () => {
      const { controller } = await buildModule();

      await expect(controller.getTestRunJobs('some-test-run-id')).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // healthCheck
  // -------------------------------------------------------------------------
  describe('healthCheck', () => {
    it('should return healthy status with service details', async () => {
      const { controller, jobProgressService } = await buildModule();

      jobProgressService.getHealthStatus.mockReturnValueOnce({ redis: 'connected', activeJobs: 0 });

      const result = await controller.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.services).toMatchObject({
        bullmq: 'connected',
        redis: 'connected',
        jobProgress: { redis: 'connected', activeJobs: 0 },
      });
      expect(result.timestamp).toBeDefined();
    });

    it('should return unhealthy status when getHealthStatus throws', async () => {
      const { controller, jobProgressService } = await buildModule();

      jobProgressService.getHealthStatus.mockImplementationOnce(() => {
        throw new Error('Redis unavailable');
      });

      const result = await controller.healthCheck();

      expect(result.status).toBe('unhealthy');
    });
  });

  // -------------------------------------------------------------------------
  // getActiveJobs
  // -------------------------------------------------------------------------
  describe('getActiveJobs', () => {
    it('should return all active jobs with count', async () => {
      const { controller, jobProgressService } = await buildModule();

      const activeJobs = [mockJobProgress, { ...mockJobProgress, jobId: 'job-2' }];
      jobProgressService.getAllActiveJobs.mockReturnValueOnce(activeJobs);

      const result = await controller.getActiveJobs();

      expect(result.totalActive).toBe(2);
      expect(result.jobs).toEqual(activeJobs);
    });

    it('should return empty list when no jobs are active', async () => {
      const { controller, jobProgressService } = await buildModule();

      jobProgressService.getAllActiveJobs.mockReturnValueOnce([]);

      const result = await controller.getActiveJobs();

      expect(result.totalActive).toBe(0);
      expect(result.jobs).toHaveLength(0);
    });

    it('should throw BadRequestException on service error', async () => {
      const { controller, jobProgressService } = await buildModule();

      jobProgressService.getAllActiveJobs.mockImplementationOnce(() => {
        throw new Error('Cache corrupted');
      });

      await expect(controller.getActiveJobs()).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // getActiveJobForScope
  // -------------------------------------------------------------------------
  describe('getActiveJobForScope', () => {
    it('should return scope and activeJob when a job is running', async () => {
      const { controller, jobProgressService } = await buildModule();

      jobProgressService.getActiveJobForScope.mockResolvedValueOnce(mockJobProgress);

      const result = await controller.getActiveJobForScope('sys-001', 'production', 'loadTest');

      expect(result.scope).toEqual({
        systemUnderTestId: 'sys-001',
        testEnvironment: 'production',
        workload: 'loadTest',
      });
      expect(result.activeJob).toEqual(mockJobProgress);
    });

    it('should return null activeJob when no job is running for the scope', async () => {
      const { controller, jobProgressService } = await buildModule();

      jobProgressService.getActiveJobForScope.mockResolvedValueOnce(null);

      const result = await controller.getActiveJobForScope('sys-001', 'production', 'loadTest');

      expect(result.activeJob).toBeNull();
    });

    it('should throw BadRequestException on service error', async () => {
      const { controller, jobProgressService } = await buildModule();

      jobProgressService.getActiveJobForScope.mockRejectedValueOnce(new Error('Redis error'));

      await expect(controller.getActiveJobForScope('sys-001', 'production', 'loadTest')).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // getJobProgress
  // -------------------------------------------------------------------------
  describe('getJobProgress', () => {
    it('should return jobId and progress for a known job', async () => {
      const { controller, jobProgressService } = await buildModule();

      jobProgressService.getJobProgress.mockResolvedValueOnce(mockJobProgress);

      const result = await controller.getJobProgress('job-abc123');

      expect(result.jobId).toBe('job-abc123');
      expect(result.progress).toEqual(mockJobProgress);
    });

    it('should throw NotFoundException when progress is null', async () => {
      const { controller, jobProgressService } = await buildModule();

      jobProgressService.getJobProgress.mockResolvedValueOnce(null);

      await expect(controller.getJobProgress('missing-job')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException on service error', async () => {
      const { controller, jobProgressService } = await buildModule();

      jobProgressService.getJobProgress.mockRejectedValueOnce(new Error('Storage error'));

      await expect(controller.getJobProgress('job-abc123')).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // getLockInfo
  // -------------------------------------------------------------------------
  describe('getLockInfo', () => {
    it('should return scope and lock info', async () => {
      const { controller, jobProgressService } = await buildModule();

      const lockInfo = { locked: true, jobId: 'job-x', acquiredAt: new Date().toISOString() };
      jobProgressService.getLockInfo.mockResolvedValueOnce(lockInfo);

      const result = await controller.getLockInfo('sys-001', 'production', 'loadTest');

      expect(result.scope).toEqual({
        systemUnderTestId: 'sys-001',
        testEnvironment: 'production',
        workload: 'loadTest',
      });
      expect(result.lock).toEqual(lockInfo);
    });

    it('should return not-locked state when no lock is held', async () => {
      const { controller, jobProgressService } = await buildModule();

      jobProgressService.getLockInfo.mockResolvedValueOnce({ locked: false });

      const result = await controller.getLockInfo('sys-001', 'staging', 'smoke');

      expect(result.lock).toEqual({ locked: false });
    });

    it('should throw BadRequestException on service error', async () => {
      const { controller, jobProgressService } = await buildModule();

      jobProgressService.getLockInfo.mockRejectedValueOnce(new Error('Redis unavailable'));

      await expect(controller.getLockInfo('sys-001', 'production', 'loadTest')).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // releaseLock
  // -------------------------------------------------------------------------
  describe('releaseLock', () => {
    describe('Happy Path - Admin User', () => {
      it('should release lock and return success response for admin', async () => {
        const { controller, jobProgressService } = await buildModule({
          authzService: { isGlobalAdmin: jest.fn().mockReturnValue(true) },
        });

        jobProgressService.releaseLock.mockResolvedValueOnce({
          released: true,
          previousLock: { jobId: 'old-job', testRunId: 'run-1', jobType: 'analyze', acquiredAt: new Date().toISOString() },
        });

        const result = await controller.releaseLock('sys-001', 'production', 'loadTest', mockAdminContext);

        expect(result.success).toBe(true);
        expect(result.message).toContain('released');
        expect(result.scope).toEqual({
          systemUnderTestId: 'sys-001',
          testEnvironment: 'production',
          workload: 'loadTest',
        });
        expect(jobProgressService.releaseLock).toHaveBeenCalledWith('sys-001', 'production', 'loadTest');
      });

      it('should return success=false and informative message when no lock was held', async () => {
        const { controller } = await buildModule({
          authzService: { isGlobalAdmin: jest.fn().mockReturnValue(true) },
          jobProgressService: {
            releaseLock: jest.fn().mockResolvedValue({ released: false, previousLock: null }),
          },
        });

        await expect(
          controller.releaseLock('sys-001', 'production', 'loadTest', mockAdminContext),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('Error Scenarios', () => {
      // Admin-only gate moved to @AdminOnly() decorator — enforced by KeycloakEnhancedAuthGuard.
      // Coverage for that gate lives in keycloak-enhanced-auth.guard.spec.ts.

      it('should throw BadRequestException on service error during release', async () => {
        const { controller, jobProgressService } = await buildModule({
          authzService: { isGlobalAdmin: jest.fn().mockReturnValue(true) },
        });

        jobProgressService.releaseLock.mockRejectedValueOnce(new Error('Lock storage error'));

        await expect(
          controller.releaseLock('sys-001', 'production', 'loadTest', mockAdminContext),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Controller instantiation
  // -------------------------------------------------------------------------
  describe('Controller Instantiation', () => {
    it('should be defined after module compilation', async () => {
      const { controller } = await buildModule();
      expect(controller).toBeDefined();
    });
  });
});
