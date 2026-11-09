/**
 * An SLO's `applicationDashboardId` comes from the request body. Until this spec, create and update
 * looked the dashboard up by id alone and handed its Grafana instance label, tags and metrics source
 * back to the caller, so naming another tenant's dashboard id read them out — with no RLS backstop on
 * a default deploy (`DB_ENABLE_RLS_ROLE` is false).
 *
 * The real `BenchmarkTagHelper` runs here against an in-memory table whose `findOne` applies the
 * `where` the way TypeORM does, including dropping an undefined key. Removing the system or
 * environment from that `where` makes the foreign row match, and these cases fail.
 */
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { BenchmarkMutationService } from './benchmark-mutation.service';
import { BenchmarkQueryService } from './benchmark-query.service';
import { BenchmarkTagHelper } from './benchmark-tag.helper';
import {
  ApplicationDashboard as ApplicationDashboardEntity,
  Benchmark as BenchmarkEntity,
  SystemUnderTest,
} from '../../../entities';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';

const ORG_A = 'org-a';
const SUT_A = '0a000000-0000-4000-8000-00000000000a';
const SUT_A2 = '0a000000-0000-4000-8000-0000000000a2';
const SUT_B = '0b000000-0000-4000-8000-00000000000b';
const SUT_MISSING = '0c000000-0000-4000-8000-00000000000c';

const OWN = {
  id: '1d000000-0000-4000-8000-000000000001',
  systemUnderTestId: SUT_A,
  testEnvironment: 'acc',
  tags: ['own-tag'],
  metricsSourceId: 'ms-own',
  grafanaInstance: { id: 'gi-own', label: 'Own Grafana' },
};
const OWN_OTHER_ENV = { ...OWN, id: '1d000000-0000-4000-8000-000000000002', testEnvironment: 'prod' };
const OWN_A2 = { ...OWN, id: '1d000000-0000-4000-8000-000000000003', systemUnderTestId: SUT_A2 };
const FOREIGN = {
  id: '1d000000-0000-4000-8000-0000000000ff',
  systemUnderTestId: SUT_B,
  testEnvironment: 'acc',
  tags: ['their-tag'],
  metricsSourceId: 'ms-theirs',
  grafanaInstance: { id: 'gi-theirs', label: 'Their Grafana' },
};
const MISSING_ID = '1d000000-0000-4000-8000-0000000000ee';

type Row = Record<string, unknown>;
const matches = (row: Row, where: Row) =>
  // TypeORM leaves an undefined key out of the WHERE clause, so the fake does too.
  Object.entries(where).every(([key, value]) => value === undefined || row[key] === value);

describe('benchmark dashboard lookups are scoped to the authorized system', () => {
  let service: BenchmarkMutationService;
  let helper: BenchmarkTagHelper;
  let dashboardFindOne: jest.Mock;
  let benchmarkRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let queryService: { findOne: jest.Mock };

  const existing = {
    id: 'bm-1',
    system_under_test_id: SUT_A,
    test_environment: 'acc',
    workload: 'load',
    application_dashboard_id: OWN.id,
    configuration: {},
    organizationId: ORG_A,
    created_at: new Date('2026-11-01T00:00:00Z'),
    updated_at: new Date('2026-11-01T00:00:00Z'),
  };

  const createBody = (applicationDashboardId: string) => ({
    systemUnderTestId: SUT_A,
    testEnvironment: 'acc',
    workload: 'load',
    source: 'grafana',
    grafanaInstance: 'Default',
    applicationDashboardId,
    configTitle: 'p95',
    panelTitle: 'p95',
    evaluateType: 'avg',
    requirementOperator: 'lt',
    requirementValue: 500,
    tags: ['user-tag'],
  });

  const refusal = async (promise: Promise<unknown>) => {
    const error = await promise.then(() => undefined, (e: unknown) => e);
    expect(error).toBeDefined();
    return error as Error & { getStatus?: () => number };
  };

  beforeEach(async () => {
    const dashboards: Row[] = [OWN, OWN_OTHER_ENV, OWN_A2, FOREIGN];
    const systems = [
      { id: SUT_A, organization_id: ORG_A, team_id: null, created_by: 'someone' },
      { id: SUT_A2, organization_id: ORG_A, team_id: 'team-a2', created_by: 'someone' },
      { id: SUT_B, organization_id: 'org-b', team_id: null, created_by: 'someone-else' },
    ];
    dashboardFindOne = jest.fn(async ({ where }: { where: Row }) => dashboards.find((r) => matches(r, where)) ?? null);
    benchmarkRepo = {
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => ({ ...row, id: 'bm-new', created_at: new Date(), updated_at: new Date() })),
      findOne: jest.fn(async () => existing),
      update: jest.fn(async () => ({})),
    };
    queryService = { findOne: jest.fn(async () => existing) };

    const module = await Test.createTestingModule({
      providers: [
        BenchmarkMutationService,
        BenchmarkTagHelper,
        { provide: getRepositoryToken(BenchmarkEntity), useValue: benchmarkRepo },
        { provide: getRepositoryToken(ApplicationDashboardEntity), useValue: { findOne: dashboardFindOne } },
        {
          provide: getRepositoryToken(SystemUnderTest),
          useValue: { findOne: jest.fn(async ({ where }: { where: { id: string } }) => systems.find((s) => s.id === where.id) ?? null) },
        },
        { provide: BenchmarkQueryService, useValue: queryService },
        {
          provide: AuthorizationService,
          useValue: {
            canAccessResource: jest.fn(async (_u: string, _r: string[], res: { organization_id: string }) => ({
              allowed: res.organization_id === ORG_A,
            })),
          },
        },
        { provide: AuditService, useValue: { logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() } },
      ],
    }).compile();

    service = module.get(BenchmarkMutationService);
    helper = module.get(BenchmarkTagHelper);
    for (const level of ['log', 'error', 'warn', 'debug'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation();
    }
  });

  afterEach(() => jest.restoreAllMocks());

  describe('create', () => {
    it('takes the instance label, tags and id from a dashboard of the authorized system and environment', async () => {
      await service.create('user-a', [], createBody(OWN.id));

      expect(dashboardFindOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: OWN.id, systemUnderTestId: SUT_A, testEnvironment: 'acc' } }),
      );
      expect(benchmarkRepo.create.mock.calls[0][0]).toMatchObject({
        application_dashboard_id: OWN.id,
        grafana_instance: 'Own Grafana',
        tags: expect.arrayContaining(['own-tag', 'user-tag']),
      });
    });

    it('answers another tenant\'s dashboard exactly as it answers a missing one, and stores nothing', async () => {
      const foreign = await refusal(service.create('user-a', [], createBody(FOREIGN.id)));
      const missing = await refusal(service.create('user-a', [], createBody(MISSING_ID)));

      expect(foreign).toBeInstanceOf(BadRequestException);
      expect(foreign.getStatus?.()).toBe(missing.getStatus?.());
      expect(foreign.message).toBe(missing.message);
      expect(benchmarkRepo.create).not.toHaveBeenCalled();
      expect(benchmarkRepo.save).not.toHaveBeenCalled();
    });

    it('refuses a dashboard of another environment of the same system', async () => {
      const error = await refusal(service.create('user-a', [], createBody(OWN_OTHER_ENV.id)));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(benchmarkRepo.save).not.toHaveBeenCalled();
    });

    it('stores a metricsSourceId only when it is the metrics source of the SLO\'s own dashboard', async () => {
      await service.create('user-a', [], { ...createBody(OWN.id), metricsSourceId: OWN.metricsSourceId });

      expect(benchmarkRepo.create.mock.calls[0][0]).toMatchObject({ metrics_source_id: OWN.metricsSourceId });
    });

    // Stored as given, another tenant's id would be readable back, and the NO ACTION foreign key would
    // refuse that tenant's delete of its own metrics source.
    it('answers another tenant\'s metrics source exactly as it answers a missing one, and stores nothing', async () => {
      const foreign = await refusal(
        service.create('user-a', [], { ...createBody(OWN.id), metricsSourceId: FOREIGN.metricsSourceId }),
      );
      const missing = await refusal(
        service.create('user-a', [], { ...createBody(OWN.id), metricsSourceId: 'ms-does-not-exist' }),
      );
      const withoutDashboard = await refusal(
        service.create('user-a', [], { ...createBody(''), metricsSourceId: FOREIGN.metricsSourceId }),
      );

      expect(foreign).toBeInstanceOf(BadRequestException);
      expect(foreign.message).toBe(missing.message);
      expect(withoutDashboard.message).toBe(missing.message);
      expect(benchmarkRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('refuses to re-point an SLO at another tenant\'s dashboard', async () => {
      const error = await refusal(service.update('bm-1', 'user-a', [], { applicationDashboardId: FOREIGN.id }));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(benchmarkRepo.update).not.toHaveBeenCalled();
    });

    // Without this the body could name the other tenant's system next to its dashboard, and the
    // scoped lookup would scope itself to the caller's choice.
    it('refuses to move an SLO into another tenant\'s system before looking at any dashboard', async () => {
      const error = await refusal(
        service.update('bm-1', 'user-a', [], { systemUnderTestId: SUT_B, applicationDashboardId: FOREIGN.id }),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(dashboardFindOne).not.toHaveBeenCalled();
      expect(benchmarkRepo.update).not.toHaveBeenCalled();
    });

    it('answers another tenant\'s system exactly as it answers a missing one', async () => {
      const foreign = await refusal(service.update('bm-1', 'user-a', [], { systemUnderTestId: SUT_B }));
      const missing = await refusal(service.update('bm-1', 'user-a', [], { systemUnderTestId: SUT_MISSING }));

      expect(foreign).toBeInstanceOf(ForbiddenException);
      // The message names the id the caller sent, and nothing else may differ.
      expect(foreign.message.replace(SUT_B, '<id>')).toBe(missing.message.replace(SUT_MISSING, '<id>'));
    });

    it('moves an SLO to another system the caller may access, under that system\'s organization and team', async () => {
      await service.update('bm-1', 'user-a', [], { systemUnderTestId: SUT_A2, applicationDashboardId: OWN_A2.id });

      expect(benchmarkRepo.update).toHaveBeenCalledWith(
        'bm-1',
        expect.objectContaining({
          system_under_test_id: SUT_A2,
          application_dashboard_id: OWN_A2.id,
          organizationId: ORG_A,
          teamId: 'team-a2',
        }),
      );
    });
  });

  describe('findInScope', () => {
    it('never widens to every system when a scope value is missing', async () => {
      const found = await helper.findInScope(FOREIGN.id, {
        systemUnderTestId: undefined as unknown as string,
        testEnvironment: undefined as unknown as string,
      });

      expect(found).toBeNull();
      expect(dashboardFindOne).not.toHaveBeenCalled();
    });

    it('does not send a non-uuid id to Postgres, where it would abort the request transaction', async () => {
      expect(await helper.findInScope('not-a-uuid', { systemUnderTestId: SUT_A, testEnvironment: 'acc' })).toBeNull();
      expect(dashboardFindOne).not.toHaveBeenCalled();
    });
  });
});
