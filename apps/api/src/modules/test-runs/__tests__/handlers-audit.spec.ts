/**
 * Audit-logging assertions for the 7 user-facing TestRun mutation handlers
 * (Phase 5a, PR8 — bucket 1).
 *
 * Scope:
 *   create-test-run, update-test-run, update-adapt-config, update-tags,
 *   update-annotations, update-analysis-start-offset, delete-test-run.
 *
 * `init-test` is intentionally excluded — it generates a unique test_run_id
 * string and may create a SystemUnderTest via TestRunLookupService; it does
 * not mutate TestRun directly.
 *
 * Every TestRun audit call must pass `organizationIdOverride:
 * testRun.organizationId` because TestRun's `organization_id` column maps
 * to the camelCase property `organizationId`, which AuditService.dispatch
 * does not pick up automatically.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  TestRun as TestRunEntity,
  DsChangePoints,
} from '@perfana/shared';
import { CreateTestRunHandler } from '../handlers/create-test-run.handler';
import { UpdateTestRunHandler } from '../handlers/update-test-run.handler';
import { UpdateAdaptConfigHandler } from '../handlers/update-adapt-config.handler';
import { UpdateTagsHandler } from '../handlers/update-tags.handler';
import { UpdateAnnotationsHandler } from '../handlers/update-annotations.handler';
import { UpdateAnalysisStartOffsetHandler } from '../handlers/update-analysis-start-offset.handler';
import { DeleteTestRunHandler } from '../handlers/delete-test-run.handler';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { AuditService } from '../../audit/audit.service';
import {
  ResourceNotFoundException,
  DatabaseException,
} from '../../../common/exceptions/business.exception';

const ORG_ID = 'org-123';

const mockTestRun = (
  overrides?: Partial<TestRunEntity>,
): TestRunEntity =>
  ({
    id: 'test-run-uuid-1',
    testRunId: 'svc-prod-load-00001',
    systemUnderTestId: 'sut-1',
    testEnvironment: 'prod',
    workload: 'load',
    applicationRelease: '1.0.0',
    annotations: [],
    tags: [],
    abort: false,
    completed: false,
    ciBuildResultsUrl: '',
    adaptConfig: { mode: 'DEFAULT', differencesAccepted: 'TBD' },
    organizationId: ORG_ID,
    teamId: 'team-1',
    createdBy: 'user-1',
    updatedBy: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    systemUnderTest: undefined,
    configurations: [],
    ...overrides,
  }) as TestRunEntity;

// ---------------------------------------------------------------------------

describe('CreateTestRunHandler — audit (Phase 5a, PR8)', () => {
  let handler: CreateTestRunHandler;
  let testRunRepo: jest.Mocked<Repository<TestRunEntity>>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateTestRunHandler,
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            count: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: getRepositoryToken(DsChangePoints),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: TestRunsGateway,
          useValue: {
            emitTestRunCreated: jest.fn(),
            emitTestRunUpdated: jest.fn(),
            emitTestRunDeleted: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get(CreateTestRunHandler);
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    auditService = module.get(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  it('logs CREATE with organizationIdOverride from the persisted entity', async () => {
    const saved = mockTestRun();
    testRunRepo.create.mockReturnValue(saved);
    testRunRepo.save.mockResolvedValue(saved);
    testRunRepo.findOne.mockResolvedValue(saved);

    await handler.execute({
      data: {
        testRunId: saved.testRunId,
        systemUnderTestId: saved.systemUnderTestId,
        testEnvironment: saved.testEnvironment,
        workload: saved.workload,
        duration: 60,
        plannedDuration: 60,
        completed: false,
        organizationId: ORG_ID,
      },
    } as never);

    expect(auditService.logCreate).toHaveBeenCalledTimes(1);
    expect(auditService.logCreate).toHaveBeenCalledWith(saved, {
      organizationIdOverride: ORG_ID,
    });
  });

  it('does NOT log CREATE if persist throws', async () => {
    testRunRepo.create.mockReturnValue(mockTestRun());
    testRunRepo.save.mockRejectedValue(new Error('boom'));

    await expect(
      handler.execute({
        data: {
          testRunId: 'x',
          systemUnderTestId: 'sut-1',
          testEnvironment: 'prod',
          workload: 'load',
          duration: 60,
          plannedDuration: 60,
          completed: false,
        },
      } as never),
    ).rejects.toThrow('boom');

    expect(auditService.logCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('UpdateTestRunHandler — audit (Phase 5a, PR8)', () => {
  let handler: UpdateTestRunHandler;
  let testRunRepo: jest.Mocked<Repository<TestRunEntity>>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateTestRunHandler,
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: TestRunsGateway,
          useValue: { emitTestRunUpdated: jest.fn() },
        },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get(UpdateTestRunHandler);
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    auditService = module.get(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  it('logs UPDATE when completed transitions false → true', async () => {
    const before = mockTestRun({ tags: ['old'], applicationRelease: '1.0.0', completed: false });
    const after = mockTestRun({ tags: ['old'], applicationRelease: '1.0.0', completed: true });
    testRunRepo.findOne
      .mockResolvedValueOnce(before) // initial snapshot
      .mockResolvedValueOnce(after); // post-update fetchWithRelations
    testRunRepo.update.mockResolvedValue({} as never);

    await handler.execute({
      data: {
        testRunId: before.testRunId,
        systemUnderTestId: before.systemUnderTestId,
        testEnvironment: before.testEnvironment,
        workload: before.workload,
        duration: 60,
        plannedDuration: 60,
        completed: true,
        applicationRelease: '1.0.0',
        tags: ['old'],
      },
    } as never);

    expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
    const [beforeArg, afterArg, opts] = (
      auditService.logUpdate as jest.Mock
    ).mock.calls[0];
    expect(beforeArg.completed).toBe(false);
    expect(afterArg.completed).toBe(true);
    expect(opts).toEqual({ organizationIdOverride: ORG_ID });
  });

  it('logs UPDATE when abort transitions false → true', async () => {
    const before = mockTestRun({ abort: false });
    const after = mockTestRun({ abort: true });
    testRunRepo.findOne
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    testRunRepo.update.mockResolvedValue({} as never);

    await handler.execute({
      data: {
        testRunId: before.testRunId,
        systemUnderTestId: before.systemUnderTestId,
        testEnvironment: before.testEnvironment,
        workload: before.workload,
        duration: 60,
        plannedDuration: 60,
        completed: false,
        abort: true,
      },
    } as never);

    expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
  });

  it('does NOT log UPDATE for routine duration-tick updates on running tests', async () => {
    const before = mockTestRun({ completed: false, abort: false });
    const after = mockTestRun({ completed: false, abort: false, duration: 120 });
    testRunRepo.findOne
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    testRunRepo.update.mockResolvedValue({} as never);

    await handler.execute({
      data: {
        testRunId: before.testRunId,
        systemUnderTestId: before.systemUnderTestId,
        testEnvironment: before.testEnvironment,
        workload: before.workload,
        duration: 120,
        plannedDuration: 60,
        completed: false,
      },
    } as never);

    expect(auditService.logUpdate).not.toHaveBeenCalled();
  });

  it('does NOT log UPDATE when before-snapshot fetch returns null', async () => {
    // Pre-mutation row missing → audit skipped (downstream throws).
    testRunRepo.findOne
      .mockResolvedValueOnce(null) // initial snapshot
      .mockResolvedValueOnce(null); // post-update fetchWithRelations
    testRunRepo.update.mockResolvedValue({} as never);

    await expect(
      handler.execute({
        data: {
          testRunId: 'missing',
          systemUnderTestId: 'sut-1',
          testEnvironment: 'prod',
          workload: 'load',
          duration: 60,
          plannedDuration: 60,
          completed: false,
        },
      } as never),
    ).rejects.toThrow();

    expect(auditService.logUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('UpdateAdaptConfigHandler — audit (Phase 5a, PR8)', () => {
  let handler: UpdateAdaptConfigHandler;
  let testRunRepo: jest.Mocked<Repository<TestRunEntity>>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateAdaptConfigHandler,
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: { findOne: jest.fn(), update: jest.fn() },
        },
        {
          provide: TestRunsGateway,
          useValue: { emitTestRunUpdated: jest.fn() },
        },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get(UpdateAdaptConfigHandler);
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    auditService = module.get(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  it('logs UPDATE on adaptConfig change with before snapshot and override', async () => {
    const before = mockTestRun({
      adaptConfig: { mode: 'DEFAULT', differencesAccepted: 'TBD' },
    });
    const after = mockTestRun({
      adaptConfig: { mode: 'DEFAULT', differencesAccepted: 'ACCEPTED' },
    });
    testRunRepo.findOne
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    testRunRepo.update.mockResolvedValue({} as never);

    await handler.execute({
      testRunId: before.testRunId,
      differencesAccepted: 'ACCEPTED',
    });

    expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
    const [beforeArg, afterArg, opts] = (
      auditService.logUpdate as jest.Mock
    ).mock.calls[0];
    expect(beforeArg.adaptConfig.differencesAccepted).toBe('TBD');
    expect(afterArg.adaptConfig.differencesAccepted).toBe('ACCEPTED');
    expect(opts).toEqual({ organizationIdOverride: ORG_ID });
  });

  it('does NOT log UPDATE when test run is not found', async () => {
    testRunRepo.findOne.mockResolvedValue(null);

    await expect(
      handler.execute({
        testRunId: 'missing',
        differencesAccepted: 'ACCEPTED',
      }),
    ).rejects.toThrow(ResourceNotFoundException);

    expect(auditService.logUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('UpdateTagsHandler — audit (Phase 5a, PR8)', () => {
  let handler: UpdateTagsHandler;
  let testRunRepo: jest.Mocked<Repository<TestRunEntity>>;
  let auditService: jest.Mocked<AuditService>;
  let dataSource: jest.Mocked<Pick<DataSource, 'query'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateTagsHandler,
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: { findOne: jest.fn() },
        },
        { provide: DataSource, useValue: { query: jest.fn() } },
        {
          provide: TestRunsGateway,
          useValue: { emitTestRunUpdated: jest.fn() },
        },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get(UpdateTagsHandler);
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    auditService = module.get(AuditService);
    dataSource = module.get(DataSource);
  });

  afterEach(() => jest.clearAllMocks());

  it('logs UPDATE with raw-SQL update path and override', async () => {
    const before = mockTestRun({ tags: ['stale'] });
    const after = mockTestRun({ tags: ['fresh'] });
    testRunRepo.findOne
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    (dataSource.query as jest.Mock).mockResolvedValue([]);

    await handler.execute({ id: before.id, tags: ['fresh'] });

    expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
    const [beforeArg, afterArg, opts] = (
      auditService.logUpdate as jest.Mock
    ).mock.calls[0];
    expect(beforeArg.tags).toEqual(['stale']);
    expect(afterArg.tags).toEqual(['fresh']);
    expect(opts).toEqual({ organizationIdOverride: ORG_ID });
  });

  it('does NOT log UPDATE when test run is not found', async () => {
    testRunRepo.findOne.mockResolvedValue(null);

    await expect(
      handler.execute({ id: 'missing', tags: ['x'] }),
    ).rejects.toThrow(ResourceNotFoundException);

    expect(auditService.logUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('UpdateAnnotationsHandler — audit (Phase 5a, PR8)', () => {
  let handler: UpdateAnnotationsHandler;
  let testRunRepo: jest.Mocked<Repository<TestRunEntity>>;
  let auditService: jest.Mocked<AuditService>;
  let dataSource: jest.Mocked<Pick<DataSource, 'query'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateAnnotationsHandler,
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: { findOne: jest.fn() },
        },
        { provide: DataSource, useValue: { query: jest.fn() } },
        {
          provide: TestRunsGateway,
          useValue: { emitTestRunUpdated: jest.fn() },
        },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get(UpdateAnnotationsHandler);
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    auditService = module.get(AuditService);
    dataSource = module.get(DataSource);
  });

  afterEach(() => jest.clearAllMocks());

  it('logs UPDATE with override on annotations change', async () => {
    const before = mockTestRun({ annotations: ['note 1'] });
    const after = mockTestRun({ annotations: ['note 1', 'note 2'] });
    testRunRepo.findOne
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    (dataSource.query as jest.Mock).mockResolvedValue([]);

    await handler.execute({ id: before.id, annotations: ['note 1', 'note 2'] });

    expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
    const [, , opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
    expect(opts).toEqual({ organizationIdOverride: ORG_ID });
  });

  it('does NOT log UPDATE when test run is not found', async () => {
    testRunRepo.findOne.mockResolvedValue(null);

    await expect(
      handler.execute({ id: 'missing', annotations: [] }),
    ).rejects.toThrow(ResourceNotFoundException);

    expect(auditService.logUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('UpdateAnalysisStartOffsetHandler — audit (Phase 5a, PR8)', () => {
  let handler: UpdateAnalysisStartOffsetHandler;
  let testRunRepo: jest.Mocked<Repository<TestRunEntity>>;
  let auditService: jest.Mocked<AuditService>;
  let dataSource: jest.Mocked<Pick<DataSource, 'query'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateAnalysisStartOffsetHandler,
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: { findOne: jest.fn() },
        },
        { provide: DataSource, useValue: { query: jest.fn() } },
        {
          provide: TestRunsGateway,
          useValue: { emitTestRunUpdated: jest.fn() },
        },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get(UpdateAnalysisStartOffsetHandler);
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    auditService = module.get(AuditService);
    dataSource = module.get(DataSource);
  });

  afterEach(() => jest.clearAllMocks());

  it('logs UPDATE with override on analysisStartOffset change', async () => {
    const before = mockTestRun({ analysisStartOffset: 30 });
    const after = mockTestRun({ analysisStartOffset: 60 });
    testRunRepo.findOne
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    (dataSource.query as jest.Mock).mockResolvedValue([]);

    await handler.execute({ id: before.id, analysisStartOffset: 60 });

    expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
    const [beforeArg, afterArg, opts] = (
      auditService.logUpdate as jest.Mock
    ).mock.calls[0];
    expect(beforeArg.analysisStartOffset).toBe(30);
    expect(afterArg.analysisStartOffset).toBe(60);
    expect(opts).toEqual({ organizationIdOverride: ORG_ID });
  });

  it('does NOT log UPDATE when test run is not found', async () => {
    testRunRepo.findOne.mockResolvedValue(null);

    await expect(
      handler.execute({ id: 'missing', analysisStartOffset: 1 }),
    ).rejects.toThrow(ResourceNotFoundException);

    expect(auditService.logUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('DeleteTestRunHandler — audit (Phase 5a, PR8)', () => {
  let handler: DeleteTestRunHandler;
  let testRunRepo: jest.Mocked<Repository<TestRunEntity>>;
  let auditService: jest.Mocked<AuditService>;
  let dataSource: jest.Mocked<Pick<DataSource, 'transaction'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeleteTestRunHandler,
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) =>
              fn({ query: jest.fn().mockResolvedValue([]) }),
            ),
          },
        },
        {
          provide: TestRunsGateway,
          useValue: { emitTestRunDeleted: jest.fn() },
        },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get(DeleteTestRunHandler);
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    auditService = module.get(AuditService);
    dataSource = module.get(DataSource);
  });

  afterEach(() => jest.clearAllMocks());

  it('logs DELETE before the cascade transaction runs', async () => {
    const tr = mockTestRun({ id: 'tr-del' });
    testRunRepo.findOne.mockResolvedValue(tr);

    await handler.execute({
      data: { id: tr.id },
    } as never);

    expect(auditService.logDelete).toHaveBeenCalledTimes(1);
    expect(auditService.logDelete).toHaveBeenCalledWith(tr, {
      organizationIdOverride: ORG_ID,
    });

    // logDelete must be invoked before dataSource.transaction.
    const logDeleteOrder = (auditService.logDelete as jest.Mock).mock
      .invocationCallOrder[0];
    const txOrder = (dataSource.transaction as jest.Mock).mock
      .invocationCallOrder[0];
    expect(logDeleteOrder).toBeLessThan(txOrder);
  });

  it('does NOT log DELETE when test run is not found', async () => {
    testRunRepo.findOne.mockResolvedValue(null);

    await expect(
      handler.execute({ data: { id: 'missing' } } as never),
    ).rejects.toThrow(ResourceNotFoundException);

    expect(auditService.logDelete).not.toHaveBeenCalled();
  });

  it('does NOT log DELETE when the existence check itself errors', async () => {
    testRunRepo.findOne.mockRejectedValue(new Error('db down'));

    await expect(
      handler.execute({ data: { id: 'x' } } as never),
    ).rejects.toThrow(DatabaseException);

    expect(auditService.logDelete).not.toHaveBeenCalled();
  });
});
