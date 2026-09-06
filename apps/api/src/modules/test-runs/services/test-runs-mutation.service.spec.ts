import { Test, TestingModule } from '@nestjs/testing';
import { TestRunsMutationService, MAX_BULK_ANALYSIS_TIME_RANGE_RUNS } from './test-runs-mutation.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TestRun as TestRunEntity } from '../../../entities';
import { UpdateRunningTestDto } from '../dto/update-running-test.dto';
import { InitTestDto } from '../dto/init-test.dto';
import {
  ResourceExistsException,
} from '../../../common/exceptions/business.exception';
import { BullMQClientService } from '../../data-science/services/bullmq-client.service';
import { CreateTestRunHandler } from '../handlers/create-test-run.handler';
import { UpdateTestRunHandler } from '../handlers/update-test-run.handler';
import { DeleteTestRunHandler } from '../handlers/delete-test-run.handler';
import { UpdateTagsHandler } from '../handlers/update-tags.handler';
import { UpdateAnnotationsHandler } from '../handlers/update-annotations.handler';
import { UpdateApplicationReleaseHandler } from '../handlers/update-application-release.handler';
import { UpdateAnalysisStartOffsetHandler } from '../handlers/update-analysis-start-offset.handler';
import { UpdateAnalysisTimeRangeHandler } from '../handlers/update-analysis-time-range.handler';
import { UpdateAdaptConfigHandler } from '../handlers/update-adapt-config.handler';
import { InitTestHandler } from '../handlers/init-test.handler';
import { TestRunLookupService } from './test-run-lookup.service';
import { TestRunsMetricsService } from './test-runs-metrics.service';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { createMockRepository, MockRepository } from '../../../../test/helpers/mock-repository.factory';
import { createAuthorizationServiceMock } from '../../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Capability } from '../../../constants/capabilities.constants';

describe('TestRunsMutationService', () => {
  let service: TestRunsMutationService;
  let testRunRepo: MockRepository<TestRunEntity>;
  let bullmqClientService: jest.Mocked<BullMQClientService>;
  let createTestRunHandler: jest.Mocked<CreateTestRunHandler>;
  let updateTestRunHandler: jest.Mocked<UpdateTestRunHandler>;
  let deleteTestRunHandler: jest.Mocked<DeleteTestRunHandler>;
  let updateTagsHandler: jest.Mocked<UpdateTagsHandler>;
  let updateAnnotationsHandler: jest.Mocked<UpdateAnnotationsHandler>;
  let updateAdaptConfigHandler: jest.Mocked<UpdateAdaptConfigHandler>;
  let initTestHandler: jest.Mocked<InitTestHandler>;
  let lookupService: jest.Mocked<TestRunLookupService>;
  let auditService: jest.Mocked<AuditService>;
  let testRunsGateway: jest.Mocked<TestRunsGateway>;
  let authzService: ReturnType<typeof createAuthorizationServiceMock>;

  const createMockTestRunEntity = (overrides?: Partial<TestRunEntity>): TestRunEntity => {
    const now = new Date();
    return {
      id: 'test-run-uuid-123',
      testRunId: 'PaymentService-production-loadTest-001',
      systemUnderTestId: 'system-uuid-123',
      testEnvironment: 'production',
      workload: 'loadTest',
      startTime: now,
      endTime: new Date(now.getTime() + 3600000),
      duration: 3600,
      plannedDuration: 3600,
      analysisStartOffset: 300,
      completed: true,
      abort: false,
      status: { evaluatingAdapt: 'COMPLETED' },
      consolidatedResult: { requirementResultsValid: true, adaptResultValid: true },
      annotations: ['baseline test'],
      tags: ['performance'],
      applicationRelease: '1.2.3',
      ciBuildResultsUrl: 'https://ci.example.com',
      expires: undefined,
      expired: false,
      valid: true,
      reasonsNotValid: [],
      adaptConfig: { mode: 'DEFAULT', differencesAccepted: 'TBD' },
      variables: [],
      deepLinks: [],
      createdAt: now,
      updatedAt: now,
      systemUnderTest: {
        id: 'system-uuid-123',
        name: 'PaymentService',
        team_id: 'team-uuid-123',
      } as any,
      ...overrides,
    } as TestRunEntity;
  };

  const createMockTestRun = (entity: TestRunEntity) => ({
    id: entity.id,
    test_run_id: entity.testRunId,
    system_under_test_id: entity.systemUnderTestId,
    test_environment: entity.testEnvironment,
    workload: entity.workload,
    start_time: entity.startTime?.toISOString(),
    end_time: entity.endTime?.toISOString(),
    duration: entity.duration,
    planned_duration: entity.plannedDuration,
    analysis_start_offset: entity.analysisStartOffset,
    completed: entity.completed || false,
    abort: entity.abort,
    status: entity.status,
    consolidated_result: entity.consolidatedResult,
    annotations: entity.annotations,
    tags: entity.tags,
    application_release: entity.applicationRelease,
    ci_build_results_url: entity.ciBuildResultsUrl,
    adapt_config: entity.adaptConfig,
    variables: entity.variables,
    deep_links: entity.deepLinks,
    created_at: entity.createdAt.toISOString(),
    updated_at: entity.updatedAt.toISOString(),
    systems_under_test: entity.systemUnderTest ? { name: entity.systemUnderTest.name } : undefined,
  });

  beforeEach(async () => {
    const mockTestRunRepo = createMockRepository<TestRunEntity>();

    const mockBullmqClientService = {
      analyzeTest: jest.fn(),
      enqueueTransactionStatsRollup: jest.fn(),
      enqueueTransactionStatsRollupBulk: jest.fn().mockResolvedValue([]),
      reevaluateBatch: jest.fn(),
    };
    const mockCreateHandler = { execute: jest.fn() };
    const mockUpdateHandler = { execute: jest.fn() };
    const mockDeleteHandler = { execute: jest.fn() };
    const mockUpdateTagsHandler = { execute: jest.fn() };
    const mockUpdateAnnotationsHandler = { execute: jest.fn() };
    const mockUpdateApplicationReleaseHandler = { execute: jest.fn() };
    const mockUpdateAnalysisStartOffsetHandler = { execute: jest.fn() };
    const mockUpdateAnalysisTimeRangeHandler = { execute: jest.fn() };
    const mockUpdateAdaptConfigHandler = { execute: jest.fn() };
    const mockInitTestHandler = { execute: jest.fn() };
    const mockLookupService = {
      findOrCreateSystemUnderTest: jest.fn(),
      findOrCreateTestEnvironment: jest.fn(),
      findOrCreateWorkload: jest.fn(),
      getDefaultTeam: jest.fn(),
    };
    const mockMetricsService = {
      applyGoldenPathClassifications: jest.fn().mockResolvedValue({ classificationsCreated: 0, compareConfigsCreated: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsMutationService,
        { provide: getRepositoryToken(TestRunEntity), useValue: mockTestRunRepo },
        { provide: BullMQClientService, useValue: mockBullmqClientService },
        { provide: CreateTestRunHandler, useValue: mockCreateHandler },
        { provide: UpdateTestRunHandler, useValue: mockUpdateHandler },
        { provide: DeleteTestRunHandler, useValue: mockDeleteHandler },
        { provide: UpdateTagsHandler, useValue: mockUpdateTagsHandler },
        { provide: UpdateAnnotationsHandler, useValue: mockUpdateAnnotationsHandler },
        { provide: UpdateApplicationReleaseHandler, useValue: mockUpdateApplicationReleaseHandler },
        { provide: UpdateAnalysisStartOffsetHandler, useValue: mockUpdateAnalysisStartOffsetHandler },
        { provide: UpdateAnalysisTimeRangeHandler, useValue: mockUpdateAnalysisTimeRangeHandler },
        { provide: UpdateAdaptConfigHandler, useValue: mockUpdateAdaptConfigHandler },
        { provide: InitTestHandler, useValue: mockInitTestHandler },
        { provide: TestRunLookupService, useValue: mockLookupService },
        { provide: TestRunsMetricsService, useValue: mockMetricsService },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
        {
          provide: AuditService,
          useValue: { logUpdate: jest.fn(), logCreate: jest.fn(), logDelete: jest.fn() },
        },
        {
          provide: TestRunsGateway,
          useValue: { emitTestRunUpdated: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<TestRunsMutationService>(TestRunsMutationService);
    auditService = module.get(AuditService);
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    bullmqClientService = module.get(BullMQClientService);
    testRunsGateway = module.get(TestRunsGateway);
    createTestRunHandler = module.get(CreateTestRunHandler);
    updateTestRunHandler = module.get(UpdateTestRunHandler);
    deleteTestRunHandler = module.get(DeleteTestRunHandler);
    updateTagsHandler = module.get(UpdateTagsHandler);
    updateAnnotationsHandler = module.get(UpdateAnnotationsHandler);
    updateAdaptConfigHandler = module.get(UpdateAdaptConfigHandler);
    initTestHandler = module.get(InitTestHandler);
    lookupService = module.get(TestRunLookupService);
    authzService = module.get(AuthorizationService);

    // Every mutation of an existing run now loads it through the write gate first.
    // Default to a visible, writable run so each test only overrides what it is about.
    testRunRepo.findOne.mockResolvedValue(createMockTestRunEntity());
  });

  const mockUserId = 'test-user-id';
  const mockRoles = ['user'];
  const mockOrganizationId = 'org-123';

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findOrCreateSystemUnderTest', () => {
    it('should delegate to lookup service', async () => {
      const mockSystem = { id: 'sys-123', name: 'PaymentService', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      lookupService.findOrCreateSystemUnderTest.mockResolvedValue(mockSystem);

      const result = await service.findOrCreateSystemUnderTest('PaymentService', mockUserId, mockOrganizationId);

      expect(result.id).toBe('sys-123');
      expect(lookupService.findOrCreateSystemUnderTest).toHaveBeenCalledWith('PaymentService', mockUserId, mockOrganizationId);
    });
  });

  describe('findOrCreateTestEnvironment', () => {
    it('should delegate to lookup service', async () => {
      const mockEnv = { id: 'env-123', name: 'production', system_under_test_id: 'sys-123', created_at: new Date().toISOString() };
      lookupService.findOrCreateTestEnvironment.mockResolvedValue(mockEnv);

      const result = await service.findOrCreateTestEnvironment('sys-123', 'production');

      expect(result.name).toBe('production');
      expect(lookupService.findOrCreateTestEnvironment).toHaveBeenCalledWith('sys-123', 'production');
    });
  });

  describe('findOrCreateWorkload', () => {
    it('should delegate to lookup service', async () => {
      const mockWorkload = { id: 'work-123', name: 'loadTest', system_under_test_test_environment_id: 'env-123', created_at: new Date().toISOString() };
      lookupService.findOrCreateWorkload.mockResolvedValue(mockWorkload);

      const result = await service.findOrCreateWorkload('env-123', 'loadTest');

      expect(result.name).toBe('loadTest');
    });
  });

  describe('updateRunningTest', () => {
    const createMockUpdateDto = (): UpdateRunningTestDto => ({
      systemUnderTest: 'PaymentService',
      workload: 'loadTest',
      testEnvironment: 'production',
      testRunId: 'PaymentService-production-loadTest-001',
      completed: false,
      version: '1.2.3',
      start: '2024-01-15T10:00:00Z',
      duration: '3600',
      analysisStartOffset: '300',
      tags: ['performance'],
      annotations: 'baseline test',
    });

    it('should create new test run when not exists', async () => {
      const updateDto = createMockUpdateDto();
      const mockSystem = { id: 'sys-123', name: 'PaymentService', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const mockEnv = { id: 'env-123', name: 'production', system_under_test_id: 'sys-123', created_at: new Date().toISOString() };
      const mockWorkload = { id: 'work-123', name: 'loadTest', system_under_test_test_environment_id: 'env-123', created_at: new Date().toISOString() };
      const mockNewTestRun = createMockTestRun(createMockTestRunEntity({ completed: false }));

      lookupService.findOrCreateSystemUnderTest.mockResolvedValue(mockSystem);
      lookupService.findOrCreateTestEnvironment.mockResolvedValue(mockEnv);
      lookupService.findOrCreateWorkload.mockResolvedValue(mockWorkload);
      testRunRepo.findOne.mockResolvedValue(null);
      createTestRunHandler.execute.mockResolvedValue({ success: true, data: mockNewTestRun, testRunId: mockNewTestRun.test_run_id, isNew: true });

      const result = await service.updateRunningTest(updateDto, mockUserId, mockRoles, mockOrganizationId);

      expect(result.test_run_id).toBe(mockNewTestRun.test_run_id);
      expect(createTestRunHandler.execute).toHaveBeenCalled();
    });

    it('should update existing test run', async () => {
      const updateDto = { ...createMockUpdateDto(), completed: true };
      const mockSystem = { id: 'sys-123', name: 'PaymentService', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const mockEnv = { id: 'env-123', name: 'production', system_under_test_id: 'sys-123', created_at: new Date().toISOString() };
      const mockWorkload = { id: 'work-123', name: 'loadTest', system_under_test_test_environment_id: 'env-123', created_at: new Date().toISOString() };
      const mockExistingEntity = createMockTestRunEntity({ completed: false });
      const mockUpdatedTestRun = createMockTestRun(createMockTestRunEntity({ completed: true }));

      lookupService.findOrCreateSystemUnderTest.mockResolvedValue(mockSystem);
      lookupService.findOrCreateTestEnvironment.mockResolvedValue(mockEnv);
      lookupService.findOrCreateWorkload.mockResolvedValue(mockWorkload);
      testRunRepo.findOne.mockResolvedValue(mockExistingEntity);
      updateTestRunHandler.execute.mockResolvedValue({ success: true, data: mockUpdatedTestRun, testRunId: mockUpdatedTestRun.test_run_id, isNew: false });
      bullmqClientService.analyzeTest.mockResolvedValue({ jobId: 'job-123' });

      const result = await service.updateRunningTest(updateDto, mockUserId, mockRoles, mockOrganizationId);

      expect(result.completed).toBe(true);
      expect(updateTestRunHandler.execute).toHaveBeenCalled();
    });

    it('should throw ResourceExistsException when test run is already completed', async () => {
      const updateDto = createMockUpdateDto();
      const mockSystem = { id: 'sys-123', name: 'PaymentService', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const mockEnv = { id: 'env-123', name: 'production', system_under_test_id: 'sys-123', created_at: new Date().toISOString() };
      const mockWorkload = { id: 'work-123', name: 'loadTest', system_under_test_test_environment_id: 'env-123', created_at: new Date().toISOString() };
      const mockCompletedEntity = createMockTestRunEntity({ completed: true });

      lookupService.findOrCreateSystemUnderTest.mockResolvedValue(mockSystem);
      lookupService.findOrCreateTestEnvironment.mockResolvedValue(mockEnv);
      lookupService.findOrCreateWorkload.mockResolvedValue(mockWorkload);
      testRunRepo.findOne.mockResolvedValue(mockCompletedEntity);

      await expect(service.updateRunningTest(updateDto, mockUserId, mockRoles, mockOrganizationId)).rejects.toThrow(ResourceExistsException);
    });

    it('should trigger ADAPT analysis when test is completed', async () => {
      const updateDto = { ...createMockUpdateDto(), completed: true };
      const mockSystem = { id: 'sys-123', name: 'PaymentService', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const mockEnv = { id: 'env-123', name: 'production', system_under_test_id: 'sys-123', created_at: new Date().toISOString() };
      const mockWorkload = { id: 'work-123', name: 'loadTest', system_under_test_test_environment_id: 'env-123', created_at: new Date().toISOString() };
      const mockNewTestRun = createMockTestRun(createMockTestRunEntity({ completed: true }));

      lookupService.findOrCreateSystemUnderTest.mockResolvedValue(mockSystem);
      lookupService.findOrCreateTestEnvironment.mockResolvedValue(mockEnv);
      lookupService.findOrCreateWorkload.mockResolvedValue(mockWorkload);
      testRunRepo.findOne.mockResolvedValue(null);
      createTestRunHandler.execute.mockResolvedValue({ success: true, data: mockNewTestRun, testRunId: mockNewTestRun.test_run_id, isNew: true });
      bullmqClientService.analyzeTest.mockResolvedValue({ jobId: 'job-123' });

      await service.updateRunningTest(updateDto, mockUserId, mockRoles, mockOrganizationId);

      expect(bullmqClientService.analyzeTest).toHaveBeenCalledWith(mockNewTestRun.test_run_id, { adapt: true, benchmarksOnly: false });
    });

    it('should not break flow if ADAPT analysis fails', async () => {
      const updateDto = { ...createMockUpdateDto(), completed: true };
      const mockSystem = { id: 'sys-123', name: 'PaymentService', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const mockEnv = { id: 'env-123', name: 'production', system_under_test_id: 'sys-123', created_at: new Date().toISOString() };
      const mockWorkload = { id: 'work-123', name: 'loadTest', system_under_test_test_environment_id: 'env-123', created_at: new Date().toISOString() };
      const mockNewTestRun = createMockTestRun(createMockTestRunEntity({ completed: true }));

      lookupService.findOrCreateSystemUnderTest.mockResolvedValue(mockSystem);
      lookupService.findOrCreateTestEnvironment.mockResolvedValue(mockEnv);
      lookupService.findOrCreateWorkload.mockResolvedValue(mockWorkload);
      testRunRepo.findOne.mockResolvedValue(null);
      createTestRunHandler.execute.mockResolvedValue({ success: true, data: mockNewTestRun, testRunId: mockNewTestRun.test_run_id, isNew: true });
      bullmqClientService.analyzeTest.mockRejectedValue(new Error('Queue error'));

      const result = await service.updateRunningTest(updateDto, mockUserId, mockRoles, mockOrganizationId);
      expect(result.completed).toBe(true);
    });

    it('should pass analysisEndOffset from DTO to CreateTestRunCommand', async () => {
      const updateDto = { ...createMockUpdateDto(), analysisEndOffset: 120 };
      const mockSystem = { id: 'sys-123', name: 'PaymentService', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const mockEnv = { id: 'env-123', name: 'production', system_under_test_id: 'sys-123', created_at: new Date().toISOString() };
      const mockWorkload = { id: 'work-123', name: 'loadTest', system_under_test_test_environment_id: 'env-123', created_at: new Date().toISOString() };
      const mockNewTestRun = createMockTestRun(createMockTestRunEntity({ completed: false }));

      lookupService.findOrCreateSystemUnderTest.mockResolvedValue(mockSystem);
      lookupService.findOrCreateTestEnvironment.mockResolvedValue(mockEnv);
      lookupService.findOrCreateWorkload.mockResolvedValue(mockWorkload);
      testRunRepo.findOne.mockResolvedValue(null);
      createTestRunHandler.execute.mockResolvedValue({ success: true, data: mockNewTestRun, testRunId: mockNewTestRun.test_run_id, isNew: true });

      await service.updateRunningTest(updateDto, mockUserId, mockRoles, mockOrganizationId);

      const [command] = createTestRunHandler.execute.mock.calls[0];
      expect(command.data.analysisEndOffset).toBe(120);
    });

    it('should preserve analysisEndOffset of 0 (not coerce to undefined)', async () => {
      const updateDto = { ...createMockUpdateDto(), analysisEndOffset: 0 };
      const mockSystem = { id: 'sys-123', name: 'PaymentService', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const mockEnv = { id: 'env-123', name: 'production', system_under_test_id: 'sys-123', created_at: new Date().toISOString() };
      const mockWorkload = { id: 'work-123', name: 'loadTest', system_under_test_test_environment_id: 'env-123', created_at: new Date().toISOString() };
      const mockNewTestRun = createMockTestRun(createMockTestRunEntity({ completed: false }));

      lookupService.findOrCreateSystemUnderTest.mockResolvedValue(mockSystem);
      lookupService.findOrCreateTestEnvironment.mockResolvedValue(mockEnv);
      lookupService.findOrCreateWorkload.mockResolvedValue(mockWorkload);
      testRunRepo.findOne.mockResolvedValue(null);
      createTestRunHandler.execute.mockResolvedValue({ success: true, data: mockNewTestRun, testRunId: mockNewTestRun.test_run_id, isNew: true });

      await service.updateRunningTest(updateDto, mockUserId, mockRoles, mockOrganizationId);

      const [command] = createTestRunHandler.execute.mock.calls[0];
      expect(command.data.analysisEndOffset).toBe(0);
    });
  });

  describe('deleteTestRun', () => {
    it('should delegate to delete handler', async () => {
      deleteTestRunHandler.execute.mockResolvedValue({ success: true, testRunId: 'test-001', id: 'test-uuid-123' });

      await service.deleteTestRun('test-uuid-123', mockUserId, mockRoles);

      expect(deleteTestRunHandler.execute).toHaveBeenCalled();
    });
  });

  describe('initTest', () => {
    it('should delegate to init handler', async () => {
      const initDto: InitTestDto = { systemUnderTest: 'PaymentService', testEnvironment: 'production', workload: 'loadTest' };
      initTestHandler.execute.mockResolvedValue({ testRunId: 'PaymentService-production-loadTest-00001' });

      const result = await service.initTest(initDto, mockUserId, mockRoles, mockOrganizationId);

      expect(result.testRunId).toBe('PaymentService-production-loadTest-00001');
      expect(initTestHandler.execute).toHaveBeenCalledWith(initDto, mockUserId, mockOrganizationId);
    });
  });

  describe('updateTags', () => {
    it('should delegate to update tags handler', async () => {
      const mockTestRun = createMockTestRun(createMockTestRunEntity());
      updateTagsHandler.execute.mockResolvedValue(mockTestRun);

      const result = await service.updateTags('test-uuid-123', ['tag1', 'tag2'], mockUserId, mockRoles);

      expect(updateTagsHandler.execute).toHaveBeenCalledWith({ id: 'test-uuid-123', tags: ['tag1', 'tag2'] });
      expect(result).toBeDefined();
    });
  });

  describe('updateAnnotations', () => {
    it('should delegate to update annotations handler', async () => {
      const mockTestRun = createMockTestRun(createMockTestRunEntity());
      updateAnnotationsHandler.execute.mockResolvedValue(mockTestRun);

      const result = await service.updateAnnotations('test-uuid-123', ['annotation1'], mockUserId, mockRoles);

      expect(updateAnnotationsHandler.execute).toHaveBeenCalledWith({ id: 'test-uuid-123', annotations: ['annotation1'] });
      expect(result).toBeDefined();
    });
  });

  describe('updateAnalysisStartOffset', () => {
    // The rollup re-enqueue hook here is the whole point of issue #150/#151
    // invalidation logic: editing ramp-up on a completed run invalidates the
    // `ramp_up_excluded=true` rows in test_run_transaction_stats.

    let updateAnalysisStartOffsetHandler: jest.Mocked<{ execute: jest.Mock }>;

    beforeEach(() => {
      updateAnalysisStartOffsetHandler = (service as unknown as {
        updateAnalysisStartOffsetHandler: jest.Mocked<{ execute: jest.Mock }>;
      }).updateAnalysisStartOffsetHandler;
    });

    it('delegates to the handler with { id, analysisStartOffset }', async () => {
      const mockTestRun = createMockTestRun(createMockTestRunEntity());
      updateAnalysisStartOffsetHandler.execute.mockResolvedValue(mockTestRun);
      bullmqClientService.enqueueTransactionStatsRollup.mockResolvedValue('job-1');

      await service.updateAnalysisStartOffset('test-uuid-123', 60, mockUserId, mockRoles);

      expect(updateAnalysisStartOffsetHandler.execute).toHaveBeenCalledWith({
        id: 'test-uuid-123',
        analysisStartOffset: 60,
      });
    });

    it('re-enqueues the rollup job when the updated test run is completed', async () => {
      const mockTestRun = createMockTestRun(
        createMockTestRunEntity({ completed: true, testRunId: 'run-42' }),
      );
      updateAnalysisStartOffsetHandler.execute.mockResolvedValue(mockTestRun);
      bullmqClientService.enqueueTransactionStatsRollup.mockResolvedValue('job-1');

      await service.updateAnalysisStartOffset('test-uuid-123', 60, mockUserId, mockRoles);

      expect(bullmqClientService.enqueueTransactionStatsRollup).toHaveBeenCalledWith('run-42');
    });

    it('does NOT re-enqueue rollup when the run is not completed', async () => {
      const mockTestRun = createMockTestRun(
        createMockTestRunEntity({ completed: false }),
      );
      updateAnalysisStartOffsetHandler.execute.mockResolvedValue(mockTestRun);

      await service.updateAnalysisStartOffset('test-uuid-123', 60, mockUserId, mockRoles);

      expect(bullmqClientService.enqueueTransactionStatsRollup).not.toHaveBeenCalled();
    });

    it('swallows enqueue failures so the mutation still returns (dashboard falls back)', async () => {
      const mockTestRun = createMockTestRun(
        createMockTestRunEntity({ completed: true, testRunId: 'run-99' }),
      );
      updateAnalysisStartOffsetHandler.execute.mockResolvedValue(mockTestRun);
      bullmqClientService.enqueueTransactionStatsRollup.mockRejectedValue(
        new Error('Redis unreachable'),
      );

      // Must not throw — the mutation itself succeeded.
      const result = await service.updateAnalysisStartOffset(
        'test-uuid-123', 60, mockUserId, mockRoles,
      );

      expect(result).toBeDefined();
      expect(result.test_run_id).toBe('run-99');
      expect(bullmqClientService.enqueueTransactionStatsRollup).toHaveBeenCalledWith('run-99');
    });
  });

  describe('updateAnalysisTimeRange', () => {
    /**
     * The handler's contract is `{ testRun, affectedTestRunIds, completedTestRunIds, skipped }`.
     * `completedTestRunIds` defaults to the affected list so the common "everything the
     * write touched was already finished" case stays short.
     */
    const handlerResult = (
      testRun: Record<string, unknown>,
      affectedTestRunIds: string[],
      completedTestRunIds: string[] = affectedTestRunIds,
      skipped: Array<Record<string, unknown>> = [],
    ) => ({ testRun, affectedTestRunIds, completedTestRunIds, skipped });

    /**
     * The queue work now runs in `enqueueAnalysisTimeRangeFollowUp`, dispatched through
     * `runAfterRequestCommit`. Outside a request context that is
     * `void Promise.resolve().then(fn)`, so the hook is still pending when
     * `updateAnalysisTimeRange` resolves. A bare `await Promise.resolve()` only advances
     * one microtask; the hook awaits several. Drain to the end of the microtask queue.
     */
    const flushDeferred = async () => {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    };

    const installMocks = (
      result: Record<string, unknown>,
      affected: string[],
      completed: string[] = affected,
      skipped: Array<Record<string, unknown>> = [],
      bullmqOverrides: Record<string, jest.Mock> = {},
    ) => {
      const mockHandler = {
        execute: jest.fn().mockResolvedValue(handlerResult(result, affected, completed, skipped)),
      };
      const mockBullmq = {
        enqueueTransactionStatsRollup: jest.fn().mockResolvedValue(undefined),
        enqueueTransactionStatsRollupBulk: jest.fn().mockResolvedValue([]),
        analyzeTest: jest.fn().mockResolvedValue(undefined),
        reevaluateBatch: jest.fn().mockResolvedValue(undefined),
        ...bullmqOverrides,
      };
      (service as any).updateAnalysisTimeRangeHandler = mockHandler;
      (service as any).bullmqClientService = mockBullmq;
      return { mockHandler, mockBullmq };
    };

    it('calls handler and enqueues rollup when test run is completed', async () => {
      const mockResult = {
        id: 'uuid-1',
        test_run_id: 'run-001',
        completed: true,
        analysis_start_offset: 30,
        analysis_end_offset: 60,
      };
      const { mockHandler, mockBullmq } = installMocks(mockResult, ['run-001']);

      const result = await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', []);
      await flushDeferred();

      expect(mockHandler.execute).toHaveBeenCalledWith({ id: 'uuid-1', analysisStartOffset: 30, analysisEndOffset: 60, applyToAll: false });
      // ONE round trip, not one per run: the RLS interceptor awaits after-commit hooks
      // before the response is emitted, so these sit on the request's critical path.
      expect(mockBullmq.enqueueTransactionStatsRollupBulk).toHaveBeenCalledWith(['run-001']);
      expect(mockBullmq.enqueueTransactionStatsRollup).not.toHaveBeenCalled();
      expect(result).toBe(mockResult);
    });

    it('does not enqueue rollup when test run is not completed', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: false };
      const { mockBullmq } = installMocks(mockResult, ['run-001'], []);

      await service.updateAnalysisTimeRange('uuid-1', 0, 0, 'user-1', []);
      await flushDeferred();

      expect(mockBullmq.enqueueTransactionStatsRollupBulk).not.toHaveBeenCalled();
    });

    it('re-analyses only the edited run when applyToAll is not set', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: true };
      const { mockBullmq } = installMocks(mockResult, ['run-001']);

      await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', []);
      await flushDeferred();

      expect(mockBullmq.analyzeTest).toHaveBeenCalledWith('run-001', { adapt: true, benchmarksOnly: false });
      expect(mockBullmq.reevaluateBatch).not.toHaveBeenCalled();
    });

    it('re-evaluates the whole workload with recalculateStatistics when applyToAll is set', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: true };
      const affected = ['run-001', 'run-002', 'run-003'];
      const { mockHandler, mockBullmq } = installMocks(mockResult, affected);

      await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', [], true);
      await flushDeferred();

      expect(mockHandler.execute).toHaveBeenCalledWith({ id: 'uuid-1', analysisStartOffset: 30, analysisEndOffset: 60, applyToAll: true });
      // analyze-test would re-hit Grafana once per run; the batch path skips collection
      // but still has to rebuild statistics for the new window.
      expect(mockBullmq.reevaluateBatch).toHaveBeenCalledWith(affected, {
        checks: true,
        adapt: true,
        recalculateStatistics: true,
      });
      expect(mockBullmq.analyzeTest).not.toHaveBeenCalled();
    });

    // ---- Finding 6: branch on applyToAll ALONE -------------------------------------
    //
    // The pulled release gated the batch arm on `affectedTestRunIds.length > 1`, so a
    // workload holding a single run fell through to analyzeTest. analyze-test runs
    // metrics collection and re-hits Grafana — the exact cost this path exists to avoid,
    // and on an old run whose Grafana window has expired it can also collect nothing and
    // overwrite good data. The user asked for "apply to all"; one run is still all of them.
    it('uses reevaluateBatch for a single-run workload when applyToAll is set', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: true };
      const { mockBullmq } = installMocks(mockResult, ['run-001']);

      await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', [], true);
      await flushDeferred();

      expect(mockBullmq.reevaluateBatch).toHaveBeenCalledWith(['run-001'], {
        checks: true,
        adapt: true,
        recalculateStatistics: true,
      });
      expect(mockBullmq.analyzeTest).not.toHaveBeenCalled();
    });

    // The other half of the same gate: the old code's else-arm was `target.completed`, so
    // an applyToAll edit on a RUNNING target enqueued nothing at all while the UI still
    // reported that re-analysis had started.
    it('re-evaluates the workload even when the edited run is not completed', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: false };
      const affected = ['run-001', 'run-002'];
      const { mockBullmq } = installMocks(mockResult, affected, ['run-002']);

      await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', [], true);
      await flushDeferred();

      expect(mockBullmq.reevaluateBatch).toHaveBeenCalledWith(affected, {
        checks: true,
        adapt: true,
        recalculateStatistics: true,
      });
      expect(mockBullmq.analyzeTest).not.toHaveBeenCalled();
    });

    it('still uses analyzeTest for a completed run when applyToAll is not set', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: true };
      const { mockBullmq } = installMocks(mockResult, ['run-001']);

      await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', []);
      await flushDeferred();

      expect(mockBullmq.analyzeTest).toHaveBeenCalledWith('run-001', { adapt: true, benchmarksOnly: false });
      expect(mockBullmq.reevaluateBatch).not.toHaveBeenCalled();
    });

    it('enqueues nothing when applyToAll wrote no runs at all', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: true };
      const { mockBullmq } = installMocks(mockResult, [], []);

      await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', [], true);
      await flushDeferred();

      expect(mockBullmq.reevaluateBatch).not.toHaveBeenCalled();
      expect(mockBullmq.analyzeTest).not.toHaveBeenCalled();
    });

    // ---- Finding 7: the rollup follows completedTestRunIds, not just the target -----
    //
    // The rollup recomputes ramp_up_excluded from the offsets. getRollupStatus reads a
    // populated table and answers `ready` forever, so a sibling that is never re-enqueued
    // serves previous-window numbers in Performance Analysis indefinitely with nothing
    // logged. Rolling up only the target is therefore silent, permanent staleness.
    it('enqueues a stats rollup for every completed run that was written', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: true };
      const affected = ['run-001', 'run-002', 'run-003'];
      const completed = ['run-001', 'run-003'];
      const { mockBullmq } = installMocks(mockResult, affected, completed);

      await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', [], true);
      await flushDeferred();

      // One bulk call carrying exactly the completed runs. run-002 was still running,
      // so it has no rollup to refresh.
      expect(mockBullmq.enqueueTransactionStatsRollupBulk).toHaveBeenCalledTimes(1);
      expect(mockBullmq.enqueueTransactionStatsRollupBulk).toHaveBeenCalledWith(['run-001', 'run-003']);
    });

    it('rolls up a completed sibling even when the edited run itself is still running', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: false };
      const { mockBullmq } = installMocks(mockResult, ['run-001', 'run-002'], ['run-002']);

      await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', [], true);
      await flushDeferred();

      expect(mockBullmq.enqueueTransactionStatsRollupBulk).toHaveBeenCalledTimes(1);
      expect(mockBullmq.enqueueTransactionStatsRollupBulk).toHaveBeenCalledWith(['run-002']);
    });

    it('still enqueues the re-evaluation when one sibling rollup fails', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: true };
      // addBulk is not atomic, so a rejection can leave some jobs queued. The
      // re-evaluation must still be enqueued — losing it is the visible failure.
      const rollup = jest.fn().mockRejectedValue(new Error('redis blip'));
      const { mockBullmq } = installMocks(
        mockResult,
        ['run-001', 'run-002'],
        ['run-001', 'run-002'],
        [],
        { enqueueTransactionStatsRollupBulk: rollup },
      );

      await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', [], true);
      await flushDeferred();

      expect(rollup).toHaveBeenCalledTimes(1);
      expect(mockBullmq.reevaluateBatch).toHaveBeenCalled();
    });

    // ---- Finding 8: the deferred hook must never reject -----------------------------
    //
    // runAfterRequestCommit dispatches as `void Promise.resolve().then(fn)` when there is
    // no request EM, so an escaping rejection is an unhandled rejection — which terminates
    // the process on this Node version. (The response is NOT already sent: under
    // DB_ENABLE_RLS_ROLE=true the interceptor awaits every hook before re-emitting. What
    // deferring buys is releasing the pooled Postgres connection first.) Nothing in the
    // follow-up is worth taking the API down for.
    it('returns the updated run even when the re-evaluation enqueue fails', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: true };
      installMocks(mockResult, ['run-001', 'run-002'], ['run-001', 'run-002'], [], {
        reevaluateBatch: jest.fn().mockRejectedValue(new Error('redis down')),
      });

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        const result = await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', [], true);
        expect(result).toEqual({ ...mockResult, affectedCount: 2, skipped: [] });
        await flushDeferred();
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }

      expect(unhandled).toEqual([]);
    });

    it('does not reject when analyzeTest fails on the single-run path', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: true };
      installMocks(mockResult, ['run-001'], ['run-001'], [], {
        analyzeTest: jest.fn().mockRejectedValue(new Error('redis down')),
      });

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        await expect(service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', [])).resolves.toBe(mockResult);
        await flushDeferred();
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }

      expect(unhandled).toEqual([]);
    });

    it('surfaces the blast radius to the caller on an applyToAll edit', async () => {
      const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: true };
      const skipped = [{ testRunId: 'run-009', completed: false, skipped: 'running' }];
      installMocks(mockResult, ['run-001', 'run-002'], ['run-001', 'run-002'], skipped);

      const result = await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', [], true);
      await flushDeferred();

      expect(result).toEqual({ ...mockResult, affectedCount: 2, skipped });
    });
  });

  /**
   * `previewAnalysisTimeRangeScope` — the read-only twin of the bulk write.
   *
   * It had no service-level test at all, so nothing asserted that the authorization gate
   * runs, that a missing run 404s, or that the shape the dialog renders is what the
   * method returns. All three are load-bearing: this preview is what the user confirms
   * before a workload-wide rewrite.
   */
  describe('previewAnalysisTimeRangeScope', () => {
    const scopeRun = (overrides?: Partial<TestRunEntity>): TestRunEntity =>
      createMockTestRunEntity({
        organizationId: mockOrganizationId,
        teamId: 'team-uuid-123',
        ...overrides,
      });

    beforeEach(() => {
      // The shared fixture has no organizationId / teamId, and the partition compares
      // both against the target — give every run in this block the same pair so the
      // scope questions under test are the only ones being answered.
      testRunRepo.findOne.mockResolvedValue(scopeRun());
      testRunRepo.find.mockResolvedValue([]);
    });

    it('refuses a caller holding test-run:read but not test-run:update', async () => {
      authzService.getCapabilities.mockResolvedValue([Capability.TestRunRead]);

      await expect(
        service.previewAnalysisTimeRangeScope('test-run-uuid-123', 30, 60, mockUserId, mockRoles),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // The gate must run BEFORE the workload is read, or the preview leaks the size and
      // composition of a workload the caller cannot touch.
      expect(testRunRepo.find).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the run does not exist', async () => {
      testRunRepo.findOne.mockResolvedValue(null);

      await expect(
        service.previewAnalysisTimeRangeScope('missing-uuid', 30, 60, mockUserId, mockRoles),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns { total, applicable, skipped, exceedsCap } for the workload', async () => {
      const target = scopeRun({ id: 'uuid-target', testRunId: 'run-target' });
      const running = scopeRun({ id: 'uuid-2', testRunId: 'run-002', completed: false });
      // 100s long, so a 60 + 60 trim leaves no analysis window at all.
      const tooShort = scopeRun({
        id: 'uuid-3',
        testRunId: 'run-003',
        startTime: new Date('2024-01-15T10:00:00Z'),
        endTime: new Date('2024-01-15T10:01:40Z'),
        duration: 100,
      });
      const otherTeam = scopeRun({ id: 'uuid-4', testRunId: 'run-004', teamId: 'team-other' });
      testRunRepo.findOne.mockResolvedValue(target);
      testRunRepo.find.mockResolvedValue([target, running, tooShort, otherTeam]);

      const result = await service.previewAnalysisTimeRangeScope(
        'uuid-target', 60, 60, mockUserId, mockRoles,
      );

      expect(result).toEqual({
        total: 4,
        applicable: 1,
        skipped: [
          { testRunId: 'run-002', completed: false, skipped: 'running' },
          { testRunId: 'run-003', completed: true, skipped: 'too-short' },
          { testRunId: 'run-004', completed: true, skipped: 'not-writable' },
        ],
        exceedsCap: false,
      });
    });

    it('projects the read instead of hydrating every column of every run', async () => {
      await service.previewAnalysisTimeRangeScope('uuid-target', 30, 60, mockUserId, mockRoles);

      const findArgs = testRunRepo.find.mock.calls.at(0)?.[0] as Record<string, unknown> | undefined;
      // startTime/endTime are what offsetsFitRun measures; dropping them would make the
      // preview answer the fit question from client-supplied `duration` while the write
      // answers it from the timestamps.
      expect(findArgs?.select).toEqual(
        expect.objectContaining({
          id: true,
          testRunId: true,
          completed: true,
          startTime: true,
          endTime: true,
          duration: true,
          organizationId: true,
          teamId: true,
        }),
      );
    });

    const workloadOf = (size: number) => {
      const target = scopeRun({ id: 'uuid-0', testRunId: 'run-000' });
      return [
        target,
        ...Array.from({ length: size - 1 }, (_, i) =>
          scopeRun({ id: `uuid-${i + 1}`, testRunId: `run-${i + 1}` }),
        ),
      ];
    };

    it('reports exceedsCap when the applicable set is over the limit', async () => {
      const runs = workloadOf(MAX_BULK_ANALYSIS_TIME_RANGE_RUNS + 1);
      testRunRepo.findOne.mockResolvedValue(runs[0]!);
      testRunRepo.find.mockResolvedValue(runs);

      const result = await service.previewAnalysisTimeRangeScope(
        'uuid-0', 30, 60, mockUserId, mockRoles,
      );

      expect(result.applicable).toBe(MAX_BULK_ANALYSIS_TIME_RANGE_RUNS + 1);
      expect(result.exceedsCap).toBe(true);
    });

    it('does not report exceedsCap exactly at the limit', async () => {
      const runs = workloadOf(MAX_BULK_ANALYSIS_TIME_RANGE_RUNS);
      testRunRepo.findOne.mockResolvedValue(runs[0]!);
      testRunRepo.find.mockResolvedValue(runs);

      const result = await service.previewAnalysisTimeRangeScope(
        'uuid-0', 30, 60, mockUserId, mockRoles,
      );

      expect(result.applicable).toBe(MAX_BULK_ANALYSIS_TIME_RANGE_RUNS);
      expect(result.exceedsCap).toBe(false);
    });

    // The write has to refuse exactly what the preview flags, or the dialog promises a
    // blast radius the PUT then rejects.
    it('the write path refuses an over-cap apply before the handler runs', async () => {
      const runs = workloadOf(MAX_BULK_ANALYSIS_TIME_RANGE_RUNS + 1);
      testRunRepo.findOne.mockResolvedValue(runs[0]!);
      testRunRepo.find.mockResolvedValue(runs);
      const mockHandler = { execute: jest.fn() };
      (service as any).updateAnalysisTimeRangeHandler = mockHandler;

      await expect(
        service.updateAnalysisTimeRange('uuid-0', 30, 60, mockUserId, mockRoles, true),
      ).rejects.toThrow(
        new RegExp(
          `${MAX_BULK_ANALYSIS_TIME_RANGE_RUNS + 1} test runs.*limit of ${MAX_BULK_ANALYSIS_TIME_RANGE_RUNS}`,
        ),
      );

      expect(mockHandler.execute).not.toHaveBeenCalled();
    });

    it('does not read the workload at all on a single-run edit', async () => {
      const mockHandler = {
        execute: jest.fn().mockResolvedValue({
          testRun: { id: 'uuid-0', test_run_id: 'run-000', completed: false },
          affectedTestRunIds: ['run-000'],
          completedTestRunIds: [],
          skipped: [],
        }),
      };
      (service as any).updateAnalysisTimeRangeHandler = mockHandler;

      await service.updateAnalysisTimeRange('uuid-0', 30, 60, mockUserId, mockRoles, false);

      expect(testRunRepo.find).not.toHaveBeenCalled();
      expect(mockHandler.execute).toHaveBeenCalled();
    });
  });

  describe('updateAdaptConfig', () => {
    it('should delegate to update adapt config handler', async () => {
      const mockTestRun = createMockTestRun(createMockTestRunEntity({ adaptConfig: { mode: 'DEFAULT', differencesAccepted: 'ACCEPTED' } }));
      updateAdaptConfigHandler.execute.mockResolvedValue(mockTestRun);

      const result = await service.updateAdaptConfig('test-run-001', 'ACCEPTED', mockUserId, mockRoles);

      expect(updateAdaptConfigHandler.execute).toHaveBeenCalledWith({
        testRunId: 'test-run-001',
        differencesAccepted: 'ACCEPTED',
        systemUnderTestId: undefined,
        environment: undefined,
        workload: undefined,
      });
      expect(result).toBeDefined();
    });

    it('should pass all parameters to handler', async () => {
      const mockTestRun = createMockTestRun(createMockTestRunEntity());
      updateAdaptConfigHandler.execute.mockResolvedValue(mockTestRun);

      await service.updateAdaptConfig('test-run-001', 'DENIED', mockUserId, mockRoles, 'sys-123', 'production', 'loadTest');

      expect(updateAdaptConfigHandler.execute).toHaveBeenCalledWith({
        testRunId: 'test-run-001',
        differencesAccepted: 'DENIED',
        systemUnderTestId: 'sys-123',
        environment: 'production',
        workload: 'loadTest',
      });
    });
  });

  describe('getDefaultTeam', () => {
    it('should delegate to lookup service', async () => {
      const mockTeam = { id: 'team-123', name: 'Default Team' };
      lookupService.getDefaultTeam.mockResolvedValue(mockTeam);

      const result = await service.getDefaultTeam();

      expect(result).toEqual(mockTeam);
      expect(lookupService.getDefaultTeam).toHaveBeenCalled();
    });
  });

  describe('mapEntityToTestRun', () => {
    it('should map entity to API format', () => {
      const mockEntity = createMockTestRunEntity();

      const result = service.mapEntityToTestRun(mockEntity);

      expect(result.id).toBe(mockEntity.id);
      expect(result.test_run_id).toBe(mockEntity.testRunId);
      expect(result.system_under_test_id).toBe(mockEntity.systemUnderTestId);
      expect(result.completed).toBe(mockEntity.completed);
    });
  });

  describe('findTestRun', () => {
    it('should find and map test run', async () => {
      const mockEntity = createMockTestRunEntity();
      testRunRepo.findOne.mockResolvedValue(mockEntity);

      const result = await service.findTestRun('test-001', 'sys-123', 'production', 'loadTest');

      expect(result).toBeDefined();
      expect(result?.test_run_id).toBe(mockEntity.testRunId);
    });

    it('should return null when not found', async () => {
      testRunRepo.findOne.mockResolvedValue(null);

      const result = await service.findTestRun('test-001', 'sys-123', 'production', 'loadTest');

      expect(result).toBeNull();
    });
  });

  describe('abortTestRun', () => {
    const userId = 'user-uuid-123';
    const userIdentifier = 'test@example.com';

    it('should abort a running test run and trigger analysis', async () => {
      const entity = createMockTestRunEntity({ completed: false, abort: false });
      testRunRepo.findOne.mockResolvedValue(entity);
      testRunRepo.save.mockResolvedValue({ ...entity, abort: true, completed: true, abortMessage: `Aborted manually by ${userIdentifier}` });
      bullmqClientService.analyzeTest.mockResolvedValue({ jobId: 'job-abort-123' });

      const result = await service.abortTestRun(entity.id, userId, [], userIdentifier);

      expect(testRunRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ abort: true, completed: true, abortMessage: `Aborted manually by ${userIdentifier}`, updatedBy: userId, endTime: expect.any(Date) }),
      );
      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      expect(testRunsGateway.emitTestRunUpdated).toHaveBeenCalledTimes(1);
      expect(result.abort).toBe(true);
      expect(bullmqClientService.analyzeTest).toHaveBeenCalledWith(entity.testRunId, { adapt: true, benchmarksOnly: false });
    });

    it('should still abort successfully if analysis job fails to enqueue', async () => {
      const entity = createMockTestRunEntity({ completed: false, abort: false });
      testRunRepo.findOne.mockResolvedValue(entity);
      testRunRepo.save.mockResolvedValue({ ...entity, abort: true, completed: true, abortMessage: `Aborted manually by ${userIdentifier}` });
      bullmqClientService.analyzeTest.mockRejectedValue(new Error('Queue unavailable'));

      const result = await service.abortTestRun(entity.id, userId, [], userIdentifier);

      expect(result.abort).toBe(true);
      expect(bullmqClientService.analyzeTest).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException when test run does not exist', async () => {
      testRunRepo.findOne.mockResolvedValue(null);

      await expect(service.abortTestRun('no-such-id', userId, [], userIdentifier))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when test run is already completed', async () => {
      const entity = createMockTestRunEntity({ completed: true, abort: false });
      testRunRepo.findOne.mockResolvedValue(entity);

      await expect(service.abortTestRun(entity.id, userId, [], userIdentifier))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when test run is already aborted', async () => {
      const entity = createMockTestRunEntity({ completed: false, abort: true });
      testRunRepo.findOne.mockResolvedValue(entity);

      await expect(service.abortTestRun(entity.id, userId, [], userIdentifier))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('write gate', () => {
    // Every mutation of an existing run. RLS does not cover this: its
    // `can_modify_resource` backstop grants modify to any member of the org, so
    // an org-viewer could otherwise edit every run they can read.
    const mutations: Array<[string, (userId: string) => Promise<unknown>]> = [
      ['updateTags', (u) => service.updateTags('test-run-uuid-123', ['t'], u, mockRoles)],
      ['updateAnnotations', (u) => service.updateAnnotations('test-run-uuid-123', ['a'], u, mockRoles)],
      ['updateApplicationRelease', (u) => service.updateApplicationRelease('test-run-uuid-123', '2.0', u, mockRoles)],
      ['updateAnalysisStartOffset', (u) => service.updateAnalysisStartOffset('test-run-uuid-123', 60, u, mockRoles)],
      ['updateAnalysisTimeRange', (u) => service.updateAnalysisTimeRange('test-run-uuid-123', 60, 30, u, mockRoles)],
      ['updateAdaptConfig', (u) => service.updateAdaptConfig('run-001', 'ACCEPTED', u, mockRoles)],
      ['deleteTestRun', (u) => service.deleteTestRun('test-run-uuid-123', u, mockRoles)],
      ['abortTestRun', (u) => service.abortTestRun('test-run-uuid-123', u, mockRoles, 'someone@example.com')],
    ];

    /**
     * Asserts only that the write gate let the call through. Some of these
     * mutations then fail on unrelated business rules against the shared
     * fixture (abort rejects an already-completed run), which is not what this
     * test is about.
     */
    const expectNotForbidden = async (p: Promise<unknown>) => {
      await p.catch((err) => {
        if (err instanceof ForbiddenException) throw err;
      });
    };

    const mutationHandlers = () => [
      updateTagsHandler.execute,
      updateAnnotationsHandler.execute,
      updateAdaptConfigHandler.execute,
      deleteTestRunHandler.execute,
    ];

    describe.each(mutations)('%s', (_name, call) => {
      it('refuses a caller holding test-run:read but not test-run:update', async () => {
        authzService.getCapabilities.mockResolvedValue([Capability.TestRunRead]);

        await expect(call(mockUserId)).rejects.toBeInstanceOf(ForbiddenException);
        for (const handler of mutationHandlers()) expect(handler).not.toHaveBeenCalled();
      });

      it('allows a caller holding test-run:update', async () => {
        authzService.getCapabilities.mockResolvedValue([
          Capability.TestRunRead,
          Capability.TestRunUpdate,
        ]);

        await expectNotForbidden(call(mockUserId));
      });

      it('exempts API-key principals from the capability lookup', async () => {
        // A key has no organization_members row, so getCapabilities returns an
        // empty set for every key — gating on it would deny all CI writes.
        authzService.getCapabilities.mockResolvedValue([]);

        await expectNotForbidden(call('api-key:abc-123'));
        expect(authzService.getCapabilities).not.toHaveBeenCalled();
      });
    });

    it('refuses a run the caller cannot see as not-found, without mutating', async () => {
      testRunRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateTags('invisible-uuid', ['t'], mockUserId, mockRoles),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(updateTagsHandler.execute).not.toHaveBeenCalled();
    });
  });

});
