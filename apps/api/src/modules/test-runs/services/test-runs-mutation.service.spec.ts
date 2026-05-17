import { Test, TestingModule } from '@nestjs/testing';
import { TestRunsMutationService } from './test-runs-mutation.service';
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
import { UpdateAnalysisStartOffsetHandler } from '../handlers/update-analysis-start-offset.handler';
import { UpdateAdaptConfigHandler } from '../handlers/update-adapt-config.handler';
import { InitTestHandler } from '../handlers/init-test.handler';
import { TestRunLookupService } from './test-run-lookup.service';
import { TestRunsMetricsService } from './test-runs-metrics.service';
import { createMockRepository, MockRepository } from '../../../../test/helpers/mock-repository.factory';
import { createAuthorizationServiceMock } from '../../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

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
    };
    const mockCreateHandler = { execute: jest.fn() };
    const mockUpdateHandler = { execute: jest.fn() };
    const mockDeleteHandler = { execute: jest.fn() };
    const mockUpdateTagsHandler = { execute: jest.fn() };
    const mockUpdateAnnotationsHandler = { execute: jest.fn() };
    const mockUpdateAnalysisStartOffsetHandler = { execute: jest.fn() };
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
        { provide: UpdateAnalysisStartOffsetHandler, useValue: mockUpdateAnalysisStartOffsetHandler },
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
      ],
    }).compile();

    service = module.get<TestRunsMutationService>(TestRunsMutationService);
    auditService = module.get(AuditService);
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    bullmqClientService = module.get(BullMQClientService);
    createTestRunHandler = module.get(CreateTestRunHandler);
    updateTestRunHandler = module.get(UpdateTestRunHandler);
    deleteTestRunHandler = module.get(DeleteTestRunHandler);
    updateTagsHandler = module.get(UpdateTagsHandler);
    updateAnnotationsHandler = module.get(UpdateAnnotationsHandler);
    updateAdaptConfigHandler = module.get(UpdateAdaptConfigHandler);
    initTestHandler = module.get(InitTestHandler);
    lookupService = module.get(TestRunLookupService);
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

    it('should abort a running test run', async () => {
      const entity = createMockTestRunEntity({ completed: false, abort: false });
      testRunRepo.findOne.mockResolvedValue(entity);
      testRunRepo.save.mockResolvedValue({ ...entity, abort: true, abortMessage: `Aborted manually by ${userIdentifier}` });

      const result = await service.abortTestRun(entity.id, userId, [], userIdentifier);

      expect(testRunRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ abort: true, abortMessage: `Aborted manually by ${userIdentifier}`, updatedBy: userId }),
      );
      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      expect(result.abort).toBe(true);
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
});
