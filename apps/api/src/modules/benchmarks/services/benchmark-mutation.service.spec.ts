/**
 * BenchmarkMutationService — Phase 5a audit-logging assertions.
 *
 * Scope: this spec is intentionally scoped to the audit invariants added in
 * PR13. Broader benchmark CRUD coverage is tracked separately.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, Logger } from '@nestjs/common';
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

  describe('duplicate SLO target (uq_benchmarks_active_metric_target, migration 1812)', () => {
    // What node-postgres hands TypeORM when the partial unique index rejects the row.
    const duplicateTarget = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'uq_benchmarks_active_metric_target',
    });

    it('create() answers 409 with the reason instead of a 500', async () => {
      benchmarkRepo.create.mockReturnValue(buildEntity({ id: 'bm-dup' }));
      benchmarkRepo.save.mockRejectedValue(duplicateTarget);

      await expect(
        service.create(userId, roles, {
          systemUnderTestId: 'sut-1',
          testEnvironment: 'production',
          workload: 'loadTest',
          evaluateType: 'avg',
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('update() answers 409 — the path an unedited clone takes when it is switched on', async () => {
      const existing = buildEntity({ id: 'bm-clone', enabled: false });
      queryService.findOne.mockResolvedValue(existing as never);
      benchmarkRepo.update.mockRejectedValue(duplicateTarget);

      await expect(
        service.update(existing.id, userId, roles, { enabled: true } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('leaves an unrelated failure alone', async () => {
      benchmarkRepo.create.mockReturnValue(buildEntity({ id: 'bm-fk' }));
      const foreignKey = Object.assign(new Error('violates foreign key constraint'), {
        code: '23503',
        constraint: 'FK_2e765498731db929f6c706dc4ab',
      });
      benchmarkRepo.save.mockRejectedValue(foreignKey);

      await expect(
        service.create(userId, roles, {
          systemUnderTestId: 'sut-1',
          testEnvironment: 'production',
          workload: 'loadTest',
          evaluateType: 'avg',
        } as never),
      ).rejects.toBe(foreignKey);
    });

    it('duplicate() clones disabled, so the copy sits outside the index until it is edited', async () => {
      const source = buildEntity({ id: 'bm-source', enabled: true });
      queryService.findOne.mockResolvedValue(source as never);
      benchmarkRepo.create.mockImplementation((payload) => payload as never);
      benchmarkRepo.save.mockImplementation(
        async (entity) => ({ ...buildEntity({ id: 'bm-clone' }), ...(entity as object) }) as never,
      );

      await service.duplicate(source.id, userId, roles);

      const [payload] = (benchmarkRepo.create as jest.Mock).mock.calls[0];
      expect(payload).toMatchObject({ enabled: false });
    });

    // TypeORM wraps the pg error in a QueryFailedError; depending on the driver path the
    // code/constraint may only be on `driverError`. isDuplicateTarget reads both, and if it
    // stopped doing so the user would get a 500 with no explanation instead of the sentence.
    it('recognises the failure when code and constraint are only on driverError', async () => {
      benchmarkRepo.create.mockReturnValue(buildEntity({ id: 'bm-wrapped' }));
      benchmarkRepo.save.mockRejectedValue(
        Object.assign(new Error('QueryFailedError'), {
          driverError: { code: '23505', constraint: 'uq_benchmarks_active_metric_target' },
        }),
      );

      await expect(
        service.create(userId, roles, {
          systemUnderTestId: 'sut-1',
          testEnvironment: 'production',
          workload: 'loadTest',
          evaluateType: 'avg',
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    // 23505 is not on its own enough: uq_benchmarks_unique is a different invariant with a
    // different remedy, and translating it to this sentence would misdirect the user.
    it('leaves a 23505 on a different constraint alone', async () => {
      const otherIndex = Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
        constraint: 'uq_benchmarks_unique',
      });
      benchmarkRepo.create.mockReturnValue(buildEntity({ id: 'bm-other' }));
      benchmarkRepo.save.mockRejectedValue(otherIndex);

      await expect(
        service.create(userId, roles, {
          systemUnderTestId: 'sut-1',
          testEnvironment: 'production',
          workload: 'loadTest',
          evaluateType: 'avg',
        } as never),
      ).rejects.toBe(otherIndex);
    });

    // A rejection that is not an object at all must not make the guard throw on its own.
    it('survives a non-object rejection', async () => {
      benchmarkRepo.create.mockReturnValue(buildEntity({ id: 'bm-string' }));
      benchmarkRepo.save.mockRejectedValue('connection terminated');

      await expect(
        service.create(userId, roles, {
          systemUnderTestId: 'sut-1',
          testEnvironment: 'production',
          workload: 'loadTest',
          evaluateType: 'avg',
        } as never),
      ).rejects.toBe('connection terminated');
    });

    describe('copyToScope', () => {
      const copyDto = {
        sourceSystemUnderTestId: 'sut-1',
        sourceTestEnvironment: 'production',
        sourceWorkload: 'loadTest',
        targetSystemUnderTestId: 'sut-2',
        targetTestEnvironment: 'acceptance',
        targetWorkload: 'loadTest',
        conflictStrategy: 'skip' as const,
      };

      // `conflictKey` probes on config/panel title, so a target row with a different title on
      // the same panel is invisible to it and only the index catches it — a throw here would
      // abandon a bulk copy with audit rows already emitted for the benchmarks that made it.
      // NOTE: these cases run with `getRequestEm() === null`, so they exercise the UNGUARDED
      // path. The SAVEPOINT path that production actually takes is covered separately in
      // benchmark-mutation.savepoint.spec.ts, which mocks the request-EM module.
      it('counts a refused row as skipped and carries on with the rest of the copy', async () => {
        const first = buildEntity({ id: 'bm-copy-1', config_title: 'first' });
        const second = buildEntity({ id: 'bm-copy-2', config_title: 'second' });
        benchmarkRepo.find.mockResolvedValue([first, second]);
        benchmarkRepo.findOne.mockResolvedValue(null); // no title-level conflict in the target
        benchmarkRepo.create.mockImplementation((payload) => payload as never);
        benchmarkRepo.save
          .mockRejectedValueOnce(duplicateTarget)
          .mockImplementationOnce(async (entity) => ({ ...(entity as object), id: 'bm-copy-2-new' }) as never);

        const result = await service.copyToScope(userId, roles, copyDto);

        expect(result).toEqual({ copied: 1, skipped: 1, total: 2 });
        // No audit row for the row that was never persisted.
        expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      });

      it('still rethrows an unrelated failure rather than swallowing it as a skip', async () => {
        const boom = Object.assign(new Error('deadlock detected'), { code: '40P01' });
        benchmarkRepo.find.mockResolvedValue([buildEntity({ id: 'bm-copy-1' })]);
        benchmarkRepo.findOne.mockResolvedValue(null);
        benchmarkRepo.create.mockImplementation((payload) => payload as never);
        benchmarkRepo.save.mockRejectedValue(boom);

        await expect(service.copyToScope(userId, roles, copyDto)).rejects.toBe(boom);
      });
    });
  });

  // The edit dialog gained an Enabled checkbox in v0.2.96.15; it is the only way to bring a
  // disabled Duplicate clone back to life, and it is inert unless buildUpdateData forwards
  // the field. TypeORM's update() skips undefined, so `false` in particular has to survive.
  describe('update() forwards the enabled flag', () => {
    it('writes enabled=false when the body switches the SLO off', async () => {
      const existing = buildEntity({ id: 'bm-enable', enabled: true });
      queryService.findOne.mockResolvedValue(existing as never);
      benchmarkRepo.findOne.mockResolvedValue(existing);
      benchmarkRepo.update.mockResolvedValue({} as never);

      await service.update(existing.id, userId, roles, { enabled: false } as never);

      const [, data] = (benchmarkRepo.update as jest.Mock).mock.calls[0];
      expect(data).toHaveProperty('enabled', false);
    });

    // A new SLO must arrive live. The Duplicate button is the ONLY path that writes
    // enabled:false, and it is what keeps a clone legal under the index — a create that
    // stopped defaulting to true would produce SLOs that silently never evaluate.
    it('create() writes enabled=true, unlike duplicate()', async () => {
      const created = buildEntity({ id: 'bm-new' });
      benchmarkRepo.create.mockReturnValue(created);
      benchmarkRepo.save.mockResolvedValue(created);

      await service.create(userId, roles, {
        systemUnderTestId: 'sut-1',
        testEnvironment: 'production',
        workload: 'loadTest',
        evaluateType: 'avg',
      } as never);

      const [payload] = (benchmarkRepo.create as jest.Mock).mock.calls[0];
      expect(payload).toMatchObject({ enabled: true });
    });

    it('leaves the column alone when the body does not name it', async () => {
      const existing = buildEntity({ id: 'bm-enable-2', enabled: false });
      queryService.findOne.mockResolvedValue(existing as never);
      benchmarkRepo.findOne.mockResolvedValue(existing);
      benchmarkRepo.update.mockResolvedValue({} as never);

      await service.update(existing.id, userId, roles, { requirementValue: 42 } as never);

      const [, data] = (benchmarkRepo.update as jest.Mock).mock.calls[0];
      expect(data).not.toHaveProperty('enabled');
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
