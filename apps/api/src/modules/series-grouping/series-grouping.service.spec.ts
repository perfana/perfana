import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SeriesGroupingRule } from '@perfana/shared/entities';
import { SeriesGroupingService } from './series-grouping.service';
import type { CreateSeriesGroupingRuleDto } from './dto/create-series-grouping-rule.dto';

/**
 * Series grouping rules CRUD (docs/design/2026-11-01-series-grouping-plan.md, Task 5).
 *
 * The request-scoped entity manager is absent in unit tests, so withRequestEm() hands back the
 * repositories below unchanged and getRequestEm() is null — the savepoint branch is exercised by
 * forcing a request manager in its own block.
 */
jest.mock('../../common/db/request-em', () => {
  const actual = jest.requireActual('../../common/db/request-em');
  return { ...actual, getRequestEm: jest.fn(() => null), withRequestEm: jest.fn((repo: unknown) => repo) };
});
import { getRequestEm } from '../../common/db/request-em';

const SUT = '00000000-0000-0000-0000-00000000005a';
const ORG = '00000000-0000-0000-0000-0000000000a1';
const OTHER_ORG = '00000000-0000-0000-0000-0000000000b2';
const DASH = '11111111-1111-1111-1111-111111111111';
const DASH_OTHER_ENV = '22222222-2222-2222-2222-222222222222';
const INSTANCE = '33333333-3333-3333-3333-333333333333';

const dashboard = (overrides: Record<string, unknown> = {}) => ({
  id: DASH,
  systemUnderTestId: SUT,
  testEnvironment: 'acc',
  dashboardUid: 'k8s-resources',
  grafanaInstanceId: INSTANCE,
  dashboardLabel: 'K8s resources',
  organizationId: ORG,
  teamId: undefined,
  ...overrides,
});

const dto = (overrides: Partial<CreateSeriesGroupingRuleDto> = {}): CreateSeriesGroupingRuleDto => ({
  systemUnderTestId: SUT,
  testEnvironment: 'acc',
  workload: 'peak',
  applicationDashboardId: DASH,
  panelId: 7,
  preset: 'k8s-pod',
  aggregation: 'avg',
  trackMemberCount: false,
  ...overrides,
});

const duplicateSlot = () =>
  Object.assign(new Error('duplicate key value violates unique constraint "uq_series_grouping_rules_slot"'), {
    code: '23505',
    constraint: 'uq_series_grouping_rules_slot',
  });

describe('SeriesGroupingService', () => {
  let service: SeriesGroupingService;
  let ruleRepo: any;
  let appDashRepo: any;
  let audit: { logCreate: jest.Mock; logUpdate: jest.Mock; logDelete: jest.Mock };
  let authz: { getCapabilities: jest.Mock };
  let saved: SeriesGroupingRule[];
  let knownWorkloads: Set<string>;

  beforeEach(() => {
    saved = [];
    knownWorkloads = new Set(['acc/peak', 'acc/soak', 'prod/peak']);
    ruleRepo = {
      create: jest.fn((fields: Partial<SeriesGroupingRule>) => Object.assign(new SeriesGroupingRule(), fields)),
      save: jest.fn(async (rule: SeriesGroupingRule) => {
        const withId = Object.assign(rule, { id: rule.id ?? `rule-${saved.length + 1}` });
        saved.push(withId);
        return withId;
      }),
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
      remove: jest.fn(async (rule: SeriesGroupingRule) => rule),
      query: jest.fn(async (_sql: string, params: unknown[]) => [
        { known: knownWorkloads.has(`${params[1]}/${params[2]}`) },
      ]),
    };
    appDashRepo = {
      findOne: jest.fn(async ({ where }: any) => (where.id === DASH ? dashboard() : null)),
      find: jest.fn(async () => []),
    };
    audit = { logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() };
    authz = { getCapabilities: jest.fn(async () => ['benchmark:manage']) };
    (getRequestEm as jest.Mock).mockReturnValue(null);
    service = new SeriesGroupingService(ruleRepo, appDashRepo, audit as any, authz as any);
  });

  describe('create', () => {
    it('inherits organization and team from the application dashboard, in camelCase', async () => {
      appDashRepo.findOne.mockResolvedValue(dashboard({ teamId: 'team-1' }));
      const result = await service.create(dto(), 'user-1', ['user'], [ORG]);

      expect(ruleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG, teamId: 'team-1', createdBy: 'user-1', updatedBy: 'user-1' }),
      );
      expect(result.rule).toMatchObject({ applicationDashboardId: DASH, panelId: 7, preset: 'k8s-pod', origin: 'manual' });
      expect(result.copies).toEqual({ created: [], skipped: [] });
    });

    it('audits with an entity instance, so the audit row carries its field diff', async () => {
      await service.create(dto(), 'user-1', ['user'], [ORG]);
      expect(audit.logCreate).toHaveBeenCalledTimes(1);
      expect(audit.logCreate.mock.calls[0][0]).toBeInstanceOf(SeriesGroupingRule);
      expect(audit.logCreate.mock.calls[0][1]).toEqual({ organizationIdOverride: ORG });
    });

    it('stores a preset without a pattern, and a custom rule with its pattern and replacement', async () => {
      await service.create(dto({ preset: 'k8s-pod', pattern: '.*', replacement: 'x' }), 'user-1', ['user'], [ORG]);
      expect(saved[0]).toMatchObject({ pattern: null, replacement: '' });

      await service.create(dto({ preset: 'custom', pattern: '^(\\w+)-\\d+$', replacement: '$1', panelId: 8 }), 'user-1', ['user'], [ORG]);
      expect(saved[1]).toMatchObject({ preset: 'custom', pattern: '^(\\w+)-\\d+$', replacement: '$1' });
    });

    it('records a dashboard-wide rule as panelId null', async () => {
      await service.create(dto({ panelId: undefined }), 'user-1', ['user'], [ORG]);
      expect(saved[0]!.panelId).toBeNull();
    });

    it('stores origin=suggestion when the dialog says so', async () => {
      await service.create(dto({ origin: 'suggestion' }), 'user-1', ['user'], [ORG]);
      expect(saved[0]!.origin).toBe('suggestion');
    });

    it.each([
      ['another organization', () => appDashRepo.findOne.mockResolvedValue(dashboard({ organizationId: OTHER_ORG }))],
      ['another system', () => appDashRepo.findOne.mockResolvedValue(dashboard({ systemUnderTestId: 'other-sut' }))],
      ['another environment', () => appDashRepo.findOne.mockResolvedValue(dashboard({ testEnvironment: 'prod' }))],
      ['a dashboard that does not exist', () => appDashRepo.findOne.mockResolvedValue(null)],
    ])('answers 404, indistinguishable from not-found, for %s', async (_label, arrange) => {
      arrange();
      await expect(service.create(dto(), 'user-1', ['user'], [ORG])).rejects.toThrow(NotFoundException);
      expect(ruleRepo.save).not.toHaveBeenCalled();
    });

    it('lets a global admin (null org scope) create on any organization', async () => {
      appDashRepo.findOne.mockResolvedValue(dashboard({ organizationId: OTHER_ORG }));
      const result = await service.create(dto(), 'admin', ['perfana-admin'], null);
      expect(result.rule.applicationDashboardId).toBe(DASH);
    });

    it('refuses a perf-test dashboard with 400', async () => {
      appDashRepo.findOne.mockResolvedValue(dashboard({ dashboardUid: 'performance-test-metrics-checkout' }));
      await expect(service.create(dto(), 'user-1', ['user'], [ORG])).rejects.toThrow(BadRequestException);
    });

    it.each([
      ['an unsafe pattern', { preset: 'custom' as const, pattern: '(a+)+' }, /ReDoS/],
      ['a custom rule without a pattern', { preset: 'custom' as const, pattern: undefined }, /pattern/i],
    ])('refuses %s with the guard message', async (_label, overrides, message) => {
      await expect(service.create(dto(overrides), 'user-1', ['user'], [ORG])).rejects.toThrow(message);
      expect(ruleRepo.save).not.toHaveBeenCalled();
    });

    it('answers 409 on a duplicate slot, including two dashboard-wide rules', async () => {
      ruleRepo.save.mockRejectedValueOnce(duplicateSlot());
      await expect(service.create(dto({ panelId: null }), 'user-1', ['user'], [ORG])).rejects.toThrow(ConflictException);
      expect(audit.logCreate).not.toHaveBeenCalled();
    });

    it('reads the constraint name from a nested driverError too', async () => {
      ruleRepo.save.mockRejectedValueOnce(
        Object.assign(new Error('x'), { driverError: { code: '23505', constraint: 'uq_series_grouping_rules_slot' } }),
      );
      await expect(service.create(dto(), 'user-1', ['user'], [ORG])).rejects.toThrow(ConflictException);
    });

    it('does not turn an unrelated database error into a 409', async () => {
      ruleRepo.save.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '23503' }));
      await expect(service.create(dto(), 'user-1', ['user'], [ORG])).rejects.toThrow('boom');
    });
  });

  describe('create with copyTo', () => {
    it('keeps the dashboard and panel within the same environment and stores origin=copy', async () => {
      const result = await service.create(dto({ copyTo: [{ testEnvironment: 'acc', workload: 'soak' }] }), 'user-1', ['user'], [ORG]);

      expect(result.copies.skipped).toEqual([]);
      expect(result.copies.created).toHaveLength(1);
      expect(saved[1]).toMatchObject({ workload: 'soak', applicationDashboardId: DASH, panelId: 7, origin: 'copy' });
      expect(audit.logCreate).toHaveBeenCalledTimes(2);
    });

    it('resolves another environment\'s dashboard by uid AND Grafana instance', async () => {
      appDashRepo.find.mockResolvedValue([dashboard({ id: DASH_OTHER_ENV, testEnvironment: 'prod' })]);
      await service.create(dto({ copyTo: [{ testEnvironment: 'prod', workload: 'peak' }] }), 'user-1', ['user'], [ORG]);

      const where = appDashRepo.find.mock.calls[0][0].where;
      expect(where).toMatchObject({
        systemUnderTestId: SUT,
        testEnvironment: 'prod',
        dashboardUid: 'k8s-resources',
        grafanaInstanceId: INSTANCE,
      });
      // Refuse on ambiguity, do not pick (apps/api/CLAUDE.md, "The first-row class").
      expect(appDashRepo.find.mock.calls[0][0].take).toBe(2);
      expect(saved[1]).toMatchObject({ testEnvironment: 'prod', applicationDashboardId: DASH_OTHER_ENV, origin: 'copy' });
    });

    it.each([
      ['no-dashboard', () => appDashRepo.find.mockResolvedValue([])],
      [
        'ambiguous-dashboard',
        () =>
          appDashRepo.find.mockResolvedValue([
            dashboard({ id: 'a', testEnvironment: 'prod' }),
            dashboard({ id: 'b', testEnvironment: 'prod' }),
          ]),
      ],
      [
        'not-writable',
        () => appDashRepo.find.mockResolvedValue([dashboard({ id: DASH_OTHER_ENV, testEnvironment: 'prod', organizationId: OTHER_ORG })]),
      ],
    ])('skips a target as %s', async (reason, arrange) => {
      arrange();
      const result = await service.create(dto({ copyTo: [{ testEnvironment: 'prod', workload: 'peak' }] }), 'user-1', ['user'], [ORG]);
      expect(result.copies).toEqual({ created: [], skipped: [{ testEnvironment: 'prod', workload: 'peak', reason }] });
    });

    it('skips a workload the system has never configured or run', async () => {
      const result = await service.create(dto({ copyTo: [{ testEnvironment: 'acc', workload: 'nope' }] }), 'user-1', ['user'], [ORG]);
      expect(result.copies.skipped).toEqual([{ testEnvironment: 'acc', workload: 'nope', reason: 'unknown-workload' }]);
    });

    it('skips a slot that already has a rule, never overwriting it', async () => {
      ruleRepo.findOne.mockImplementation(async ({ where }: any) => (where.workload === 'soak' ? new SeriesGroupingRule() : null));
      const result = await service.create(dto({ copyTo: [{ testEnvironment: 'acc', workload: 'soak' }] }), 'user-1', ['user'], [ORG]);
      expect(result.copies.skipped).toEqual([{ testEnvironment: 'acc', workload: 'soak', reason: 'exists' }]);
      expect(saved).toHaveLength(1);
    });

    it('skips the primary rule\'s own slot and duplicate targets', async () => {
      const result = await service.create(
        dto({ copyTo: [{ testEnvironment: 'acc', workload: 'peak' }, { testEnvironment: 'acc', workload: 'soak' }, { testEnvironment: 'acc', workload: 'soak' }] }),
        'user-1',
        ['user'],
        [ORG],
      );
      expect(result.copies.skipped).toEqual([{ testEnvironment: 'acc', workload: 'peak', reason: 'same-slot' }]);
      expect(result.copies.created).toHaveLength(1);
    });

    it('turns a racing 23505 on a copy into "exists" inside a savepoint, and keeps going', async () => {
      const em = { query: jest.fn(async () => undefined) };
      (getRequestEm as jest.Mock).mockReturnValue(em);
      ruleRepo.save
        .mockImplementationOnce(async (rule: SeriesGroupingRule) => Object.assign(rule, { id: 'primary' }))
        .mockRejectedValueOnce(duplicateSlot())
        .mockImplementationOnce(async (rule: SeriesGroupingRule) => Object.assign(rule, { id: 'copy-2' }));

      const result = await service.create(
        dto({ copyTo: [{ testEnvironment: 'acc', workload: 'soak' }, { testEnvironment: 'prod', workload: 'peak' }] }),
        'user-1',
        ['user'],
        [ORG],
      );
      // prod has no matching dashboard (find() defaults to []), so it is skipped after the race.
      const statements = em.query.mock.calls.map((c: any[]) => c[0]);
      expect(statements).toContain('SAVEPOINT copy_series_grouping_rule');
      expect(statements).toContain('ROLLBACK TO SAVEPOINT copy_series_grouping_rule');
      expect(result.copies.skipped).toContainEqual({ testEnvironment: 'acc', workload: 'soak', reason: 'exists' });
    });
  });

  describe('read', () => {
    it('returns [] early on an empty organization list, without querying', async () => {
      expect(await service.findAll({ systemId: SUT }, [])).toEqual([]);
      expect(ruleRepo.find).not.toHaveBeenCalled();
    });

    it('scopes the list to the caller\'s organizations, and not for a global admin', async () => {
      await service.findAll({ systemId: SUT, environment: 'acc', workload: 'peak', applicationDashboardId: DASH }, [ORG]);
      const where = ruleRepo.find.mock.calls[0][0].where;
      expect(where).toMatchObject({ systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'peak', applicationDashboardId: DASH });
      expect(where.organizationId).toBeDefined();

      await service.findAll({ systemId: SUT }, null);
      expect(ruleRepo.find.mock.calls[1][0].where.organizationId).toBeUndefined();
    });

    it('findOne answers 404 for a rule in another organization', async () => {
      ruleRepo.findOne.mockResolvedValue(Object.assign(new SeriesGroupingRule(), { id: 'r1', organizationId: OTHER_ORG }));
      await expect(service.findOne('r1', [ORG])).rejects.toThrow(NotFoundException);
    });

    it('remove answers 404 for a rule in another organization', async () => {
      ruleRepo.findOne.mockResolvedValue(Object.assign(new SeriesGroupingRule(), { id: 'r1', organizationId: OTHER_ORG }));
      await expect(service.remove('r1', 'user-1', ['user'], [ORG])).rejects.toThrow(NotFoundException);
      expect(ruleRepo.remove).not.toHaveBeenCalled();
    });

    it('update answers 404 for a rule in another organization', async () => {
      ruleRepo.findOne.mockResolvedValue(Object.assign(new SeriesGroupingRule(), { id: 'r1', organizationId: OTHER_ORG }));
      await expect(service.update('r1', { aggregation: 'sum' }, 'user-1', ['user'], [ORG])).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const existing = () =>
      Object.assign(new SeriesGroupingRule(), {
        id: 'r1',
        organizationId: ORG,
        systemUnderTestId: SUT,
        testEnvironment: 'acc',
        workload: 'peak',
        applicationDashboardId: DASH,
        panelId: 7,
        preset: 'k8s-pod',
        pattern: null,
        replacement: '',
        aggregation: 'avg',
        trackMemberCount: false,
        enabled: true,
        origin: 'manual',
      });

    it('changes rule fields, keeps the slot, audits before and after as entity instances', async () => {
      ruleRepo.findOne.mockResolvedValue(existing());
      const result = await service.update('r1', { aggregation: 'sum', trackMemberCount: true, enabled: false }, 'user-2', ['user'], [ORG]);

      expect(result).toMatchObject({ aggregation: 'sum', trackMemberCount: true, enabled: false, panelId: 7, workload: 'peak' });
      expect(saved[0]!.updatedBy).toBe('user-2');
      const [before, after] = audit.logUpdate.mock.calls[0];
      expect(before).toBeInstanceOf(SeriesGroupingRule);
      expect(before.aggregation).toBe('avg');
      expect(after.aggregation).toBe('sum');
    });

    it('treats an explicit null like an absent key', async () => {
      ruleRepo.findOne.mockResolvedValue(existing());
      await service.update('r1', { aggregation: null as never, enabled: null as never }, 'user-2', ['user'], [ORG]);
      expect(saved[0]).toMatchObject({ aggregation: 'avg', enabled: true });
    });

    it('ignores slot fields even if a client sends them', async () => {
      ruleRepo.findOne.mockResolvedValue(existing());
      await service.update('r1', { panelId: 99, workload: 'other' } as never, 'user-2', ['user'], [ORG]);
      expect(saved[0]).toMatchObject({ panelId: 7, workload: 'peak' });
    });

    it('switching to custom requires a valid pattern, switching away clears it', async () => {
      ruleRepo.findOne.mockResolvedValue(existing());
      await expect(service.update('r1', { preset: 'custom' }, 'user-2', ['user'], [ORG])).rejects.toThrow(BadRequestException);

      ruleRepo.findOne.mockResolvedValue(existing());
      await service.update('r1', { preset: 'custom', pattern: '-\\d+$' }, 'user-2', ['user'], [ORG]);
      expect(saved[0]).toMatchObject({ preset: 'custom', pattern: '-\\d+$' });

      ruleRepo.findOne.mockResolvedValue(Object.assign(existing(), { preset: 'custom', pattern: '-\\d+$', replacement: 'x' }));
      await service.update('r1', { preset: 'ip-port' }, 'user-2', ['user'], [ORG]);
      expect(saved[1]).toMatchObject({ preset: 'ip-port', pattern: null, replacement: '' });
    });

    it('refuses an unsafe pattern on update', async () => {
      ruleRepo.findOne.mockResolvedValue(Object.assign(existing(), { preset: 'custom', pattern: 'a' }));
      await expect(service.update('r1', { pattern: '(a+)+' }, 'user-2', ['user'], [ORG])).rejects.toThrow(/ReDoS/);
    });
  });

  // A rule changes ADAPT verdicts like an SLO does, so writing one needs the SLO capability
  // (`benchmark:manage`: org admins and members, not viewers). Checked after the 404 scoping, so a
  // 403 only ever reaches someone who can already read the rule.
  describe('write capability', () => {
    const existingRule = () =>
      Object.assign(new SeriesGroupingRule(), {
        id: 'r1', organizationId: ORG, teamId: 'team-1', preset: 'k8s-pod', pattern: null, replacement: '',
        aggregation: 'avg', trackMemberCount: false, enabled: true,
      });

    it.each([
      ['create', () => service.create(dto(), 'viewer', ['user'], [ORG])],
      ['update', () => { ruleRepo.findOne.mockResolvedValue(existingRule()); return service.update('r1', { enabled: false }, 'viewer', ['user'], [ORG]); }],
      ['remove', () => { ruleRepo.findOne.mockResolvedValue(existingRule()); return service.remove('r1', 'viewer', ['user'], [ORG]); }],
    ])('%s is refused with 403 without benchmark:manage', async (_name, call) => {
      authz.getCapabilities.mockResolvedValue(['test-run:read']);
      await expect(call()).rejects.toThrow(ForbiddenException);
      expect(ruleRepo.save).not.toHaveBeenCalled();
      expect(ruleRepo.remove).not.toHaveBeenCalled();
    });

    it('checks the capability against the resource organization and team', async () => {
      ruleRepo.findOne.mockResolvedValue(existingRule());
      await service.update('r1', { enabled: false }, 'user-1', ['user'], [ORG]);
      expect(authz.getCapabilities).toHaveBeenCalledWith('user-1', ['user'], ORG, 'team-1');
    });

    it('lets an API-key principal through, since its organization scope is the key itself', async () => {
      authz.getCapabilities.mockResolvedValue([]);
      await service.create(dto(), 'api-key:abc', [], [ORG]);
      expect(authz.getCapabilities).not.toHaveBeenCalled();
      expect(saved).toHaveLength(1);
    });

    it('skips a copy target in an organization where the caller lacks the capability', async () => {
      appDashRepo.find.mockResolvedValue([dashboard({ id: DASH_OTHER_ENV, testEnvironment: 'prod', organizationId: OTHER_ORG })]);
      authz.getCapabilities.mockImplementation(async (_u: string, _r: string[], org: string) => (org === ORG ? ['benchmark:manage'] : []));
      const result = await service.create(dto({ copyTo: [{ testEnvironment: 'prod', workload: 'peak' }] }), 'user-1', ['user'], [ORG, OTHER_ORG]);
      expect(result.copies.skipped).toEqual([{ testEnvironment: 'prod', workload: 'peak', reason: 'not-writable' }]);
    });
  });

  describe('remove', () => {
    it('deletes and audits', async () => {
      ruleRepo.findOne.mockResolvedValue(Object.assign(new SeriesGroupingRule(), { id: 'r1', organizationId: ORG }));
      await service.remove('r1', 'user-1', ['user'], [ORG]);
      expect(ruleRepo.remove).toHaveBeenCalledTimes(1);
      expect(audit.logDelete.mock.calls[0][0]).toBeInstanceOf(SeriesGroupingRule);
    });

    it('answers 404 for an unknown id', async () => {
      await expect(service.remove('missing', 'user-1', ['user'], [ORG])).rejects.toThrow(NotFoundException);
    });
  });
});
