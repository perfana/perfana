/**
 * BenchmarksController — controller-level audit chain verification
 * (Phase 5a, PR18, no-op verification).
 *
 * `benchmarks.service.ts` is a thin facade. PR13 audited every mutation in
 * `BenchmarkMutationService`. PR18 adds no new `auditService.log*` call sites;
 * its purpose is to lock in the chain by exercising the controller-level
 * methods through the real `BenchmarksService` + real `BenchmarkMutationService`
 * (with the repos / `AuthorizationService` / `BenchmarkQueryService` /
 * `BenchmarkTagHelper` / `AuditService` mocked) and asserting the expected
 * audit call materializes.
 *
 * Covers the 6 controller CRUD paths named in the audit-burndown PR18 row:
 *   create, update, delete, copyBenchmarks, createApdexSlo, updateApdexSlo.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BenchmarksController } from '../benchmarks.controller';
import { BenchmarksService } from '../benchmarks.service';
import {
  BenchmarkCalculatorService,
  BenchmarkMutationService,
  BenchmarkQueryService,
  BenchmarkTagHelper,
} from '../services';
import {
  Benchmark as BenchmarkEntity,
  SystemUnderTest,
} from '../../../entities';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';
import { UserContext } from '../../../common/decorators/user-context.decorator';

const ORG_ID = 'org-bm-int';
const USER_ID = 'user-bm-int';
const ROLES = ['admin'];
const SUT_ID = 'sut-bm-int';

const ctx: UserContext = {
  userId: USER_ID,
  roles: ROLES,
  organizations: [ORG_ID],
  teams: [],
  organizationId: ORG_ID,
  teamId: undefined,
};

const buildEntity = (overrides?: Partial<BenchmarkEntity>): BenchmarkEntity =>
  ({
    id: 'bm-int-1',
    system_under_test_id: SUT_ID,
    test_environment: 'production',
    workload: 'loadTest',
    source: 'grafana',
    panel_title: 'p95 latency',
    config_title: 'p95 < 500ms',
    benchmark_type: 'metric',
    evaluate_type: 'avg',
    requirement_operator: 'lt',
    requirement_value: 500,
    enabled: true,
    valid: true,
    tags: [],
    description: 'desc',
    configuration: {},
    metadata: {},
    organizationId: ORG_ID,
    teamId: undefined,
    created_by: USER_ID,
    updated_by: USER_ID,
    created_at: new Date('2026-05-04T10:00:00Z'),
    updated_at: new Date('2026-05-04T10:00:00Z'),
    ...overrides,
  } as BenchmarkEntity);

describe('BenchmarksController — audit chain (Phase 5a, PR18)', () => {
  let controller: BenchmarksController;
  let benchmarkRepo: jest.Mocked<Repository<BenchmarkEntity>>;
  let queryService: { findOne: jest.Mock };
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BenchmarksController],
      providers: [
        BenchmarksService,
        BenchmarkMutationService,
        {
          provide: getRepositoryToken(BenchmarkEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            manager: { query: jest.fn() },
          },
        },
        {
          provide: getRepositoryToken(SystemUnderTest),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: SUT_ID,
              organization_id: ORG_ID,
              created_by: USER_ID,
              team_id: undefined,
            } as Partial<SystemUnderTest>),
          },
        },
        {
          provide: BenchmarkQueryService,
          useValue: { findOne: jest.fn() },
        },
        {
          provide: BenchmarkCalculatorService,
          useValue: {},
        },
        {
          provide: BenchmarkTagHelper,
          useValue: {
            inheritTagsFromDashboard: jest.fn().mockResolvedValue([]),
            getInheritedTagsForUpdate: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: AuthorizationService,
          useValue: {
            canAccessResource: jest.fn().mockResolvedValue({ allowed: true }),
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

    controller = module.get(BenchmarksController);
    benchmarkRepo = module.get(getRepositoryToken(BenchmarkEntity));
    queryService = module.get(BenchmarkQueryService);
    auditService = module.get(AuditService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('POST /benchmarks → logCreate fires through controller → facade → mutation', async () => {
    const created = buildEntity({ id: 'bm-int-create' });
    benchmarkRepo.create.mockReturnValue(created);
    benchmarkRepo.save.mockResolvedValue(created);

    await controller.create(ctx, {
      systemUnderTestId: SUT_ID,
      testEnvironment: 'production',
      workload: 'loadTest',
      source: 'grafana',
      configTitle: 'p95 < 500ms',
      panelTitle: 'p95 latency',
      evaluateType: 'avg',
      requirementOperator: 'lt',
      requirementValue: 500,
    });

    expect(auditService.logCreate).toHaveBeenCalledTimes(1);
    expect(auditService.logCreate).toHaveBeenCalledWith(created, {
      organizationIdOverride: ORG_ID,
    });
  });

  it('PUT /benchmarks/:id → logUpdate fires with before/after through full chain', async () => {
    const before = buildEntity({ id: 'bm-int-update', requirement_value: 500 });
    const after = buildEntity({ id: 'bm-int-update', requirement_value: 1000 });
    queryService.findOne.mockResolvedValue(before as never);
    benchmarkRepo.findOne.mockResolvedValue(after);
    benchmarkRepo.update.mockResolvedValue({} as never);

    await controller.update('bm-int-update', ctx, { requirementValue: 1000 });

    expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
    const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
    expect(beforeArg).toEqual(
      expect.objectContaining({ id: 'bm-int-update', requirement_value: 500 }),
    );
    expect(afterArg).toEqual(
      expect.objectContaining({ id: 'bm-int-update', requirement_value: 1000 }),
    );
    expect(opts).toEqual({ organizationIdOverride: ORG_ID });
  });

  it('DELETE /benchmarks/:id → logDelete fires before repository.delete', async () => {
    const entity = buildEntity({ id: 'bm-int-delete' });
    queryService.findOne.mockResolvedValue(entity as never);
    benchmarkRepo.delete.mockResolvedValue({ affected: 1 } as never);

    await controller.delete('bm-int-delete', ctx);

    expect(auditService.logDelete).toHaveBeenCalledTimes(1);
    const [refArg, opts] = (auditService.logDelete as jest.Mock).mock.calls[0];
    expect(refArg).toEqual(expect.objectContaining({ id: 'bm-int-delete' }));
    expect(opts).toEqual({ organizationIdOverride: ORG_ID });
    expect(
      (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (benchmarkRepo.delete as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it('POST /benchmarks/copy → logCreate fires per copied row through full chain', async () => {
    const source = buildEntity({ id: 'bm-int-src' });
    benchmarkRepo.find.mockResolvedValue([source]);
    benchmarkRepo.findOne.mockResolvedValue(null); // no conflict in target
    const newCopy = buildEntity({ id: 'bm-int-copy' });
    benchmarkRepo.create.mockReturnValue(newCopy);
    benchmarkRepo.save.mockResolvedValue(newCopy);

    await controller.copyBenchmarks(ctx, {
      sourceSystemUnderTestId: SUT_ID,
      sourceTestEnvironment: 'production',
      sourceWorkload: 'loadTest',
      targetSystemUnderTestId: SUT_ID,
      targetTestEnvironment: 'staging',
      targetWorkload: 'loadTest',
      conflictStrategy: 'skip',
    });

    expect(auditService.logCreate).toHaveBeenCalledTimes(1);
    expect(auditService.logCreate).toHaveBeenCalledWith(newCopy, {
      organizationIdOverride: ORG_ID,
    });
  });

  it('POST /benchmarks/apdex → logCreate fires through controller → facade → mutation', async () => {
    const created = buildEntity({
      id: 'bm-int-apdex-create',
      benchmark_type: 'apdex',
      min_apdex_score: 0.9,
    });
    benchmarkRepo.create.mockReturnValue(created);
    benchmarkRepo.save.mockResolvedValue(created);

    await controller.createApdexSlo(ctx, {
      systemUnderTestId: SUT_ID,
      testEnvironment: 'production',
      workload: 'loadTest',
      minApdexScore: 0.9,
    });

    expect(auditService.logCreate).toHaveBeenCalledTimes(1);
    expect(auditService.logCreate).toHaveBeenCalledWith(created, {
      organizationIdOverride: ORG_ID,
    });
  });

  it('PUT /benchmarks/apdex/:id → logUpdate fires with before/after through full chain', async () => {
    const before = buildEntity({
      id: 'bm-int-apdex-update',
      benchmark_type: 'apdex',
      min_apdex_score: 0.85,
    });
    const after = buildEntity({
      id: 'bm-int-apdex-update',
      benchmark_type: 'apdex',
      min_apdex_score: 0.95,
    });
    queryService.findOne.mockResolvedValue(
      { ...before, benchmark_type: 'apdex' } as never,
    );
    benchmarkRepo.findOne
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    benchmarkRepo.update.mockResolvedValue({} as never);

    await controller.updateApdexSlo('bm-int-apdex-update', ctx, {
      minApdexScore: 0.95,
    });

    expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
    const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
    expect(beforeArg).toEqual(
      expect.objectContaining({ id: 'bm-int-apdex-update', min_apdex_score: 0.85 }),
    );
    expect(afterArg).toEqual(
      expect.objectContaining({ id: 'bm-int-apdex-update', min_apdex_score: 0.95 }),
    );
    expect(opts).toEqual({ organizationIdOverride: ORG_ID });
  });
});
