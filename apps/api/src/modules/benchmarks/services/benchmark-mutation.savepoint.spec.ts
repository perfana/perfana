/**
 * `copyToScope`'s duplicate-target skip, on the path production actually takes.
 *
 * `RlsTransactionInterceptor` wraps every authenticated request in ONE transaction and
 * `POST /benchmarks/copy` carries no `@SkipRls`, so a 23505 aborts that transaction (25P02)
 * and every later statement in the loop fails with "current transaction is aborted".
 * Catching the error without rolling back to a savepoint does not salvage the copy — it
 * guarantees a 500 and loses the rows already written.
 *
 * The sibling spec cannot reach this: `getRequestEm()` returns null whenever ClsService is
 * uninitialised, which is every plain unit test, so `guarded` is always false there. This
 * file mocks the request-EM module so `guarded` is true and the SAVEPOINT / RELEASE /
 * ROLLBACK TO sequencing is asserted directly.
 */
const repoProxy: Record<string, jest.Mock> = {
  save: jest.fn(),
  update: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  // The service issues its SAVEPOINT statements through `withRequestEm(repo).query(...)`,
  // so the bookkeeping lands here.
  query: jest.fn(),
};

// `getRequestEm()` non-null is what flips `guarded` on; `withRequestEm` stays identity so
// each repository the service asks for is still its own (the SUT lookup uses a different one).
jest.mock('../../../common/db/request-em', () => ({
  getRequestEm: () => ({ query: jest.fn() }),
  withRequestEm: (repo: unknown) => repo,
}));

import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { BenchmarkMutationService } from './benchmark-mutation.service';
import { BenchmarkQueryService } from './benchmark-query.service';
import { BenchmarkTagHelper } from './benchmark-tag.helper';
import { Benchmark as BenchmarkEntity, SystemUnderTest } from '../../../entities';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';

describe('BenchmarkMutationService copyToScope — SAVEPOINT guard', () => {
  let service: BenchmarkMutationService;
  let auditService: jest.Mocked<AuditService>;

  const userId = 'user-bm-1';
  const roles = ['admin'];
  const orgId = 'org-bm-1';

  const duplicateTarget = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'uq_benchmarks_active_metric_target',
  });

  const copyDto = {
    sourceSystemUnderTestId: 'sut-1',
    sourceTestEnvironment: 'production',
    sourceWorkload: 'loadTest',
    targetSystemUnderTestId: 'sut-2',
    targetTestEnvironment: 'acceptance',
    targetWorkload: 'loadTest',
    conflictStrategy: 'skip' as const,
  };

  const buildEntity = (overrides?: Partial<BenchmarkEntity>): BenchmarkEntity => ({
    id: 'bm-1',
    system_under_test_id: 'sut-1',
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
    organizationId: orgId,
    created_by: userId,
    updated_by: userId,
    created_at: new Date('2026-05-03T10:00:00Z'),
    updated_at: new Date('2026-05-03T10:00:00Z'),
    ...overrides,
  } as BenchmarkEntity);

  /** Only the SAVEPOINT bookkeeping, in order. */
  const savepointCalls = () => repoProxy.query.mock.calls.map((c) => c[0] as string);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BenchmarkMutationService,
        { provide: getRepositoryToken(BenchmarkEntity), useValue: repoProxy },
        {
          provide: getRepositoryToken(SystemUnderTest),
          useValue: {
            findOne: jest.fn().mockResolvedValue({ id: 'sut-2', organization_id: orgId, created_by: userId }),
          },
        },
        { provide: BenchmarkQueryService, useValue: { findOne: jest.fn() } },
        {
          provide: BenchmarkTagHelper,
          useValue: {
            inheritTagsFromDashboard: jest.fn().mockResolvedValue([]),
            getInheritedTagsForUpdate: jest.fn().mockResolvedValue([]),
            metricsSourceIdOf: jest.fn().mockResolvedValue('ms-new'),
          },
        },
        {
          provide: AuthorizationService,
          useValue: { canAccessResource: jest.fn().mockResolvedValue({ allowed: true }) },
        },
        {
          provide: AuditService,
          useValue: { logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(BenchmarkMutationService);
    auditService = module.get(AuditService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    Object.values(repoProxy).forEach((fn) => fn.mockReset());
    repoProxy.query.mockResolvedValue(undefined);
    repoProxy.create.mockImplementation((payload: unknown) => payload);
  });

  afterEach(() => jest.clearAllMocks());

  it('rolls back to the savepoint on a refusal and keeps copying the rest', async () => {
    repoProxy.find.mockResolvedValue([
      buildEntity({ id: 'bm-a', config_title: 'first' }),
      buildEntity({ id: 'bm-b', config_title: 'second' }),
    ]);
    repoProxy.findOne.mockResolvedValue(null);
    repoProxy.save
      .mockRejectedValueOnce(duplicateTarget)
      .mockImplementationOnce(async (e: object) => ({ ...e, id: 'bm-b-new' }));

    const result = await service.copyToScope(userId, roles, copyDto);

    expect(result).toEqual({ copied: 1, skipped: 1, total: 2 });
    // The refused row must be rolled back, not merely caught — otherwise the second save
    // runs inside an aborted transaction and the whole request 500s.
    expect(savepointCalls()).toEqual([
      'SAVEPOINT copy_benchmark',
      'ROLLBACK TO SAVEPOINT copy_benchmark',
      'SAVEPOINT copy_benchmark',
      'RELEASE SAVEPOINT copy_benchmark',
    ]);
    expect(auditService.logCreate).toHaveBeenCalledTimes(1);
  });

  it('releases the savepoint when the write succeeds, leaving no open nesting', async () => {
    repoProxy.find.mockResolvedValue([buildEntity({ id: 'bm-a' })]);
    repoProxy.findOne.mockResolvedValue(null);
    repoProxy.save.mockImplementation(async (e: object) => ({ ...e, id: 'bm-a-new' }));

    await service.copyToScope(userId, roles, copyDto);

    expect(savepointCalls()).toEqual(['SAVEPOINT copy_benchmark', 'RELEASE SAVEPOINT copy_benchmark']);
  });

  it('rolls back before rethrowing an unrelated failure', async () => {
    const boom = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    repoProxy.find.mockResolvedValue([buildEntity({ id: 'bm-a' })]);
    repoProxy.findOne.mockResolvedValue(null);
    repoProxy.save.mockRejectedValue(boom);

    await expect(service.copyToScope(userId, roles, copyDto)).rejects.toBe(boom);
    expect(savepointCalls()).toContain('ROLLBACK TO SAVEPOINT copy_benchmark');
  });

  // The overwrite arm collides on a THIRD row: cloneColumns carries the source's `enabled`,
  // so switching a disabled target on can land on a row that already holds its target key.
  it('counts a refused overwrite as skipped and emits no audit row', async () => {
    repoProxy.find.mockResolvedValue([buildEntity({ id: 'bm-src' })]);
    repoProxy.findOne.mockResolvedValue(buildEntity({ id: 'bm-tgt' }));
    repoProxy.update.mockRejectedValue(duplicateTarget);

    const result = await service.copyToScope(userId, roles, {
      ...copyDto,
      conflictStrategy: 'overwrite' as const,
    });

    expect(result).toEqual({ copied: 0, skipped: 1, total: 1 });
    expect(savepointCalls()).toEqual([
      'SAVEPOINT copy_benchmark',
      'ROLLBACK TO SAVEPOINT copy_benchmark',
    ]);
    expect(auditService.logUpdate).not.toHaveBeenCalled();
  });

  // A failed ROLLBACK leaves nothing to salvage; the skip must not become a crash.
  it('survives a savepoint rollback that itself fails', async () => {
    repoProxy.find.mockResolvedValue([buildEntity({ id: 'bm-a' })]);
    repoProxy.findOne.mockResolvedValue(null);
    repoProxy.save.mockRejectedValue(duplicateTarget);
    repoProxy.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('ROLLBACK')) throw new Error('connection already closed');
      return undefined;
    });

    const result = await service.copyToScope(userId, roles, copyDto);

    expect(result).toEqual({ copied: 0, skipped: 1, total: 1 });
  });
});
