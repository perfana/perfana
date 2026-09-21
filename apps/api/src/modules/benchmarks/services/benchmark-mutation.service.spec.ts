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
            find: jest.fn(),
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
            metricsSourceIdOf: jest.fn().mockResolvedValue('ms-new'),
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

  describe('update() re-pointing the dashboard', () => {
    it('moves application_dashboard_id and metrics_source_id together', async () => {
      const before = buildEntity({ id: 'bm-1', application_dashboard_id: 'ad-old', metrics_source_id: 'ms-old' });
      queryService.findOne.mockResolvedValue(before as never);
      benchmarkRepo.findOne.mockResolvedValue(before);
      benchmarkRepo.update.mockResolvedValue({} as never);

      await service.update('bm-1', userId, roles, { applicationDashboardId: 'ad-new' });

      expect(benchmarkRepo.update).toHaveBeenCalledWith(
        'bm-1',
        expect.objectContaining({ application_dashboard_id: 'ad-new', metrics_source_id: 'ms-new' }),
      );
    });

    it('leaves both untouched when the body names the current dashboard', async () => {
      const before = buildEntity({ id: 'bm-1', application_dashboard_id: 'ad-old', metrics_source_id: 'ms-old' });
      queryService.findOne.mockResolvedValue(before as never);
      benchmarkRepo.findOne.mockResolvedValue(before);
      benchmarkRepo.update.mockResolvedValue({} as never);

      await service.update('bm-1', userId, roles, { applicationDashboardId: 'ad-old', requirementValue: 1 });

      const [, data] = (benchmarkRepo.update as jest.Mock).mock.calls[0];
      expect(data).not.toHaveProperty('application_dashboard_id');
      expect(data).not.toHaveProperty('metrics_source_id');
    });
  });

  // A trend SLO's value is % of the series mean per hour whatever the panel measures, so
  // metric_unit is pinned to '%/h' on create and on every update that leaves it a trend,
  // and put back to the panel's yAxesFormat when the evaluate type moves away again.
  describe('trend SLO forces metric_unit to %/h', () => {
    const updateWith = async (existing: BenchmarkEntity, body: Record<string, unknown>) => {
      queryService.findOne.mockResolvedValue(existing as never);
      benchmarkRepo.findOne.mockResolvedValue(existing);
      benchmarkRepo.update.mockResolvedValue({} as never);
      await service.update(existing.id, userId, roles, body as never);
      return (benchmarkRepo.update as jest.Mock).mock.calls[0][1] as Partial<BenchmarkEntity>;
    };

    it('create() writes %/h for a trend SLO and the panel unit for every other evaluate type', async () => {
      const created = buildEntity({ id: 'bm-trend' });
      benchmarkRepo.create.mockReturnValue(created);
      benchmarkRepo.save.mockResolvedValue(created);
      const base = { systemUnderTestId: 'sut-1', testEnvironment: 'production', workload: 'loadTest', configuration: { yAxesFormat: 'ms' } };

      await service.create(userId, roles, { ...base, evaluateType: 'trend' } as never);
      await service.create(userId, roles, { ...base, evaluateType: 'avg' } as never);

      const [trendPayload, avgPayload] = (benchmarkRepo.create as jest.Mock).mock.calls.map((c) => c[0]);
      expect(trendPayload).toMatchObject({ evaluate_type: 'trend', metric_unit: '%/h' });
      expect(avgPayload).toMatchObject({ evaluate_type: 'avg', metric_unit: 'ms' });
    });

    it('update() switching to trend pins %/h even when the body also posts the panel configuration', async () => {
      const existing = buildEntity({ evaluate_type: 'avg', metric_unit: 'ms', configuration: { yAxesFormat: 'ms' } });

      const data = await updateWith(existing, { evaluateType: 'trend', configuration: { yAxesFormat: 'ms' } });

      expect(data.evaluate_type).toBe('trend');
      expect(data.metric_unit).toBe('%/h');
      expect(data.configuration).toMatchObject({ yAxesFormat: 'ms', evaluateType: 'trend' });
    });

    it('update() of an existing trend SLO keeps %/h when the body does not name an evaluate type', async () => {
      const existing = buildEntity({ evaluate_type: 'trend', metric_unit: '%/h', configuration: { yAxesFormat: 'ms' } });

      const data = await updateWith(existing, { requirementValue: 15, configuration: { yAxesFormat: 'ms' } });

      expect(data).not.toHaveProperty('evaluate_type');
      expect(data.metric_unit).toBe('%/h');
    });

    it('update() switching away from trend restores the stored panel unit, or clears it when there is none', async () => {
      const withUnit = buildEntity({ id: 'bm-a', evaluate_type: 'trend', metric_unit: '%/h', configuration: { yAxesFormat: 'ms' } });
      const dataA = await updateWith(withUnit, { evaluateType: 'avg' });
      expect(dataA).toMatchObject({ evaluate_type: 'avg', metric_unit: 'ms' });

      jest.clearAllMocks();
      const noUnit = buildEntity({ id: 'bm-b', evaluate_type: 'trend', metric_unit: '%/h', configuration: {} });
      const dataB = await updateWith(noUnit, { evaluateType: 'q95' });
      expect(dataB.evaluate_type).toBe('q95');
      // null, not undefined: TypeORM's update() skips undefined and would leave '%/h' behind.
      expect(dataB).toHaveProperty('metric_unit', null);
    });

    it('update() of an SLO that was never a trend leaves metric_unit alone', async () => {
      const existing = buildEntity({ evaluate_type: 'avg', metric_unit: 'ms', configuration: { yAxesFormat: 'ms' } });

      const data = await updateWith(existing, { evaluateType: 'max', requirementValue: 3 });

      expect(data.evaluate_type).toBe('max');
      expect(data).not.toHaveProperty('metric_unit');
    });
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

  // apdexMinSamples is an untyped inline body field (no class-validator DTO), so the
  // service is the only gate between the request and the NOT NULL integer column.
  describe('apdexMinSamples validation and defaulting', () => {
    const baseCreate = {
      systemUnderTestId: 'sut-1',
      testEnvironment: 'production',
      workload: 'loadTest',
      minApdexScore: 0.9,
    };

    beforeEach(() => {
      const created = buildEntity({ id: 'bm-apdex', benchmark_type: 'apdex', min_apdex_score: 0.9, apdex_min_samples: 50 });
      benchmarkRepo.create.mockReturnValue(created);
      benchmarkRepo.save.mockResolvedValue(created);
    });

    it.each([0, -1, 1.5, Number.NaN, 2147483648])('createApdexSlo() rejects apdexMinSamples=%p before touching the repository', async (bad) => {
      await expect(
        service.createApdexSlo(userId, roles, { ...baseCreate, apdexMinSamples: bad } as never),
      ).rejects.toThrow('apdexMinSamples must be an integer of at least 1');
      expect(benchmarkRepo.create).not.toHaveBeenCalled();
      expect(benchmarkRepo.save).not.toHaveBeenCalled();
    });

    it('createApdexSlo() defaults apdex_min_samples to 50 when the body omits it', async () => {
      await service.createApdexSlo(userId, roles, baseCreate as never);

      const payload = (benchmarkRepo.create as jest.Mock).mock.calls[0][0];
      expect(payload.apdex_min_samples).toBe(50);
    });

    it.each([1, 50, 500])('createApdexSlo() persists apdexMinSamples=%p as apdex_min_samples', async (value) => {
      await service.createApdexSlo(userId, roles, { ...baseCreate, apdexMinSamples: value } as never);

      const payload = (benchmarkRepo.create as jest.Mock).mock.calls[0][0];
      expect(payload.apdex_min_samples).toBe(value);
    });

    describe('updateApdexSlo()', () => {
      const arrangeExisting = () => {
        const before = buildEntity({ id: 'bm-apdex', benchmark_type: 'apdex', min_apdex_score: 0.85, apdex_min_samples: 50 });
        const after = buildEntity({ id: 'bm-apdex', benchmark_type: 'apdex', min_apdex_score: 0.85, apdex_min_samples: 10 });
        queryService.findOne.mockResolvedValue({ ...before, benchmark_type: 'apdex' } as never);
        benchmarkRepo.findOne
          .mockResolvedValueOnce(before)
          .mockResolvedValueOnce(after);
        benchmarkRepo.update.mockResolvedValue({} as never);
      };

      it.each([0, 2.5, -3])('rejects apdexMinSamples=%p and does not issue the UPDATE', async (bad) => {
        arrangeExisting();

        await expect(
          service.updateApdexSlo('bm-apdex', userId, roles, { apdexMinSamples: bad } as never),
        ).rejects.toThrow('apdexMinSamples must be an integer of at least 1');
        expect(benchmarkRepo.update).not.toHaveBeenCalled();
        expect(auditService.logUpdate).not.toHaveBeenCalled();
      });

      it('writes apdex_min_samples when the body carries it', async () => {
        arrangeExisting();

        await service.updateApdexSlo('bm-apdex', userId, roles, { apdexMinSamples: 10 } as never);

        const [, data] = (benchmarkRepo.update as jest.Mock).mock.calls[0];
        expect(data.apdex_min_samples).toBe(10);
      });

      it('resets apdex_min_samples to the default when the body sends null (like apdexThresholdMs)', async () => {
        arrangeExisting();

        await service.updateApdexSlo('bm-apdex', userId, roles, { apdexMinSamples: null } as never);

        const [, data] = (benchmarkRepo.update as jest.Mock).mock.calls[0];
        expect(data.apdex_min_samples).toBe(50);
      });

      it('leaves apdex_min_samples untouched when the body omits it (partial update)', async () => {
        arrangeExisting();

        await service.updateApdexSlo('bm-apdex', userId, roles, { minApdexScore: 0.95 } as never);

        const [, data] = (benchmarkRepo.update as jest.Mock).mock.calls[0];
        expect(data).not.toHaveProperty('apdex_min_samples');
        expect(data.min_apdex_score).toBe(0.95);
      });
    });
  });

  describe('copyToScope() conflict key', () => {
    const copyDto = {
      sourceSystemUnderTestId: 'sut-1',
      sourceTestEnvironment: 'production',
      sourceWorkload: 'loadTest',
      targetSystemUnderTestId: 'sut-1',
      targetTestEnvironment: 'production',
      targetWorkload: 'stressTest',
      conflictStrategy: 'skip' as const,
    };

    it('probes an apdex SLO by transaction, not by scope alone', async () => {
      const apdex = buildEntity({ id: 'bm-apdex', benchmark_type: 'apdex', transaction_name: 'login', config_title: undefined });
      (benchmarkRepo.find as jest.Mock).mockResolvedValue([apdex]);
      benchmarkRepo.findOne.mockResolvedValue(null);
      benchmarkRepo.create.mockImplementation((v) => v as BenchmarkEntity);
      benchmarkRepo.save.mockImplementation(async (v) => ({ ...v, id: 'new' }) as BenchmarkEntity);

      await service.copyToScope(userId, roles, copyDto);

      const where = (benchmarkRepo.findOne as jest.Mock).mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ benchmark_type: 'apdex', transaction_name: 'login' }));
    });

    it('carries the aggregated SLO columns onto the copy', async () => {
      const agg = buildEntity({ id: 'bm-agg', benchmark_type: 'aggregated', aggregate_metric: 'response_time', aggregate_stat: 'p95' });
      (benchmarkRepo.find as jest.Mock).mockResolvedValue([agg]);
      benchmarkRepo.findOne.mockResolvedValue(null);
      benchmarkRepo.create.mockImplementation((v) => v as BenchmarkEntity);
      benchmarkRepo.save.mockImplementation(async (v) => ({ ...v, id: 'new' }) as BenchmarkEntity);

      const result = await service.copyToScope(userId, roles, copyDto);

      expect(result).toEqual({ copied: 1, skipped: 0, total: 1 });
      const payload = (benchmarkRepo.create as jest.Mock).mock.calls[0][0];
      expect(payload).toEqual(expect.objectContaining({
        aggregate_metric: 'response_time',
        aggregate_stat: 'p95',
        workload: 'stressTest',
        organizationId: orgId,
      }));
    });
  });

  describe('duplicate()', () => {
    it('clones into the same scope without the golden-path key and audits the create', async () => {
      const source = buildEntity({ id: 'bm-1', generic_check_id: 'gc-1', application_dashboard_id: 'ad-1' });
      queryService.findOne.mockResolvedValue(source as never);
      benchmarkRepo.create.mockImplementation((v) => v as BenchmarkEntity);
      benchmarkRepo.save.mockImplementation(async (v) => ({ ...v, id: 'bm-2', created_at: new Date(), updated_at: new Date() }) as BenchmarkEntity);

      const result = await service.duplicate('bm-1', userId, roles);

      const payload = (benchmarkRepo.create as jest.Mock).mock.calls[0][0];
      expect(payload).toEqual(expect.objectContaining({
        system_under_test_id: 'sut-1',
        test_environment: 'production',
        workload: 'loadTest',
        application_dashboard_id: 'ad-1',
        config_title: 'p95 < 500ms',
        organizationId: orgId,
        created_by: userId,
      }));
      expect(payload.generic_check_id).toBeUndefined();
      expect(payload.id).toBeUndefined();
      expect(result?.id).toBe('bm-2');
      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
    });

    it('returns null when the source is not visible', async () => {
      queryService.findOne.mockResolvedValue(null);
      expect(await service.duplicate('nope', userId, roles)).toBeNull();
      expect(benchmarkRepo.save).not.toHaveBeenCalled();
    });
  });
});
