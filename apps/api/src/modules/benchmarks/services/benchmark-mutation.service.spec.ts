/**
 * BenchmarkMutationService — Phase 5a audit-logging assertions.
 *
 * Scope: this spec is intentionally scoped to the audit invariants added in
 * PR13. Broader benchmark CRUD coverage is tracked separately.
 */

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

describe('BenchmarkMutationService', () => {
  let service: BenchmarkMutationService;
  let benchmarkRepo: jest.Mocked<Repository<BenchmarkEntity>>;
  let queryService: { findOne: jest.Mock };
  let auditService: jest.Mocked<AuditService>;

  const userId = 'user-bm-1';
  const roles = ['admin'];
  const orgId = 'org-bm-1';

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
    teamId: undefined,
    created_by: userId,
    updated_by: userId,
    created_at: new Date('2026-05-03T10:00:00Z'),
    updated_at: new Date('2026-05-03T10:00:00Z'),
    ...overrides,
  } as BenchmarkEntity);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BenchmarkMutationService,
        {
          provide: getRepositoryToken(BenchmarkEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
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
              id: 'sut-1',
              organization_id: orgId,
              created_by: userId,
            }),
          },
        },
        {
          provide: BenchmarkQueryService,
          useValue: { findOne: jest.fn() },
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

    service = module.get(BenchmarkMutationService);
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

  describe('audit logging (Phase 5a, PR13)', () => {
    it('logs CREATE on create() with organizationIdOverride from the persisted benchmark', async () => {
      const created = buildEntity({ id: 'bm-create' });
      benchmarkRepo.create.mockReturnValue(created);
      benchmarkRepo.save.mockResolvedValue(created);

      await service.create(userId, roles, {
        systemUnderTestId: 'sut-1',
        testEnvironment: 'production',
        workload: 'loadTest',
      } as never);

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(created, { organizationIdOverride: orgId });
    });

    it('logs UPDATE on update() with cloned before-snapshot and organizationIdOverride', async () => {
      const before = buildEntity({ id: 'bm-update', requirement_value: 500 });
      const after = buildEntity({ id: 'bm-update', requirement_value: 1000 });
      // queryService.findOne returns the DTO, which we rehydrate via Object.assign
      // for the audit before-snapshot — no extra benchmarkRepo.findOne needed.
      queryService.findOne.mockResolvedValue(before as never);
      benchmarkRepo.findOne.mockResolvedValue(after); // refetch after update
      benchmarkRepo.update.mockResolvedValue({} as never);

      await service.update('bm-update', userId, roles, { requirementValue: 1000 } as never);

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg).toEqual(expect.objectContaining({ id: 'bm-update', requirement_value: 500 }));
      expect(afterArg).toEqual(expect.objectContaining({ id: 'bm-update', requirement_value: 1000 }));
      expect(opts).toEqual({ organizationIdOverride: orgId });
    });

    it('logs DELETE before repository.delete on delete()', async () => {
      const entity = buildEntity({ id: 'bm-delete' });
      queryService.findOne.mockResolvedValue(entity as never);
      benchmarkRepo.delete.mockResolvedValue({ affected: 1 } as never);

      await service.delete('bm-delete', userId, roles);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      const [refArg, opts] = (auditService.logDelete as jest.Mock).mock.calls[0];
      expect(refArg).toEqual(expect.objectContaining({ id: 'bm-delete' }));
      expect(opts).toEqual({ organizationIdOverride: orgId });
      expect(
        (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (benchmarkRepo.delete as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('logs CREATE on createApdexSlo()', async () => {
      const created = buildEntity({ id: 'bm-apdex', benchmark_type: 'apdex', min_apdex_score: 0.9 });
      benchmarkRepo.create.mockReturnValue(created);
      benchmarkRepo.save.mockResolvedValue(created);

      await service.createApdexSlo(userId, roles, {
        systemUnderTestId: 'sut-1',
        testEnvironment: 'production',
        workload: 'loadTest',
        minApdexScore: 0.9,
      } as never);

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(created, { organizationIdOverride: orgId });
    });

    it('logs UPDATE on updateApdexSlo() with cloned before-snapshot', async () => {
      const before = buildEntity({ id: 'bm-apdex', benchmark_type: 'apdex', min_apdex_score: 0.85 });
      const after = buildEntity({ id: 'bm-apdex', benchmark_type: 'apdex', min_apdex_score: 0.95 });
      queryService.findOne.mockResolvedValue({ ...before, benchmark_type: 'apdex' } as never);
      benchmarkRepo.findOne
        .mockResolvedValueOnce(before) // before-snapshot load
        .mockResolvedValueOnce(after); // refetch after update
      benchmarkRepo.update.mockResolvedValue({} as never);

      await service.updateApdexSlo('bm-apdex', userId, roles, { minApdexScore: 0.95 } as never);

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg).toEqual(expect.objectContaining({ id: 'bm-apdex', min_apdex_score: 0.85 }));
      expect(afterArg).toEqual(expect.objectContaining({ id: 'bm-apdex', min_apdex_score: 0.95 }));
      expect(opts).toEqual({ organizationIdOverride: orgId });
    });
  });

  // Regression: NOT NULL violation on benchmarks.organization_id when creating
  // SLOs via the UI. Root cause: snake_case `organization_id` keys were silently
  // dropped by TypeORM (the entity property is camelCase `organizationId`).
  // Mirrors the grafana-sync fix in commit 57b40fd.
  describe('benchmark create payload uses camelCase organizationId (regression)', () => {
    it('create() sets organizationId from the parent system, not snake_case', async () => {
      const created = buildEntity({ id: 'bm-create-org' });
      benchmarkRepo.create.mockReturnValue(created);
      benchmarkRepo.save.mockResolvedValue(created);

      await service.create(userId, roles, {
        systemUnderTestId: 'sut-1',
        testEnvironment: 'production',
        workload: 'loadTest',
      } as never);

      expect(benchmarkRepo.create).toHaveBeenCalledTimes(1);
      const payload = (benchmarkRepo.create as jest.Mock).mock.calls[0][0];
      expect(payload.organizationId).toBe(orgId);
      expect(payload).not.toHaveProperty('organization_id');
    });

    it('createApdexSlo() sets organizationId from the parent system, not snake_case', async () => {
      const created = buildEntity({ id: 'bm-apdex-org', benchmark_type: 'apdex', min_apdex_score: 0.9 });
      benchmarkRepo.create.mockReturnValue(created);
      benchmarkRepo.save.mockResolvedValue(created);

      await service.createApdexSlo(userId, roles, {
        systemUnderTestId: 'sut-1',
        testEnvironment: 'production',
        workload: 'loadTest',
        minApdexScore: 0.9,
      } as never);

      expect(benchmarkRepo.create).toHaveBeenCalledTimes(1);
      const payload = (benchmarkRepo.create as jest.Mock).mock.calls[0][0];
      expect(payload.organizationId).toBe(orgId);
      expect(payload).not.toHaveProperty('organization_id');
    });
  });
});
