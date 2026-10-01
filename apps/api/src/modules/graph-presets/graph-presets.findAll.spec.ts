/**
 * GraphPresetsService.findAll — SUT scoping.
 *
 * REGRESSION: the scoping Brackets carried `.orWhere('preset.testRunId IS NULL')`, so
 * every preset with no run id was returned for every system under test. The save
 * dialog's default "Global" scope sent no run id, which made that *every* global
 * preset: one customer's graph presets were listed on another customer's system.
 *
 * `findAll` had no test at all before this file, so the shape of the query is what is
 * pinned here — jsdom-style unit mocks cannot execute SQL, but the predicates are
 * exactly what a future edit would change.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { GraphPresetsService } from './graph-presets.service';
import { GraphPreset } from '@perfana/shared/entities';
import { TestRun as TestRunEntity } from '../../entities';
import { AuditService } from '../audit/audit.service';

type Recorded = { method: string; sql: string; params?: Record<string, unknown> };

/**
 * A query-builder stub that records every predicate, expanding a `Brackets` in place so
 * the nested `where`/`orWhere` land in the same transcript as the outer calls.
 */
function makeQueryBuilder() {
  const calls: Recorded[] = [];
  const rows: GraphPreset[] = [];

  const record = (method: string) =>
    jest.fn((sql: unknown, params?: Record<string, unknown>) => {
      if (sql instanceof Brackets) {
        calls.push({ method, sql: '<brackets>' });
        (sql as unknown as { whereFactory: (qb: unknown) => void }).whereFactory(qb);
      } else {
        calls.push({ method, sql: String(sql), params });
      }
      return qb;
    });

  const qb = {
    where: record('where'),
    andWhere: record('andWhere'),
    orWhere: record('orWhere'),
    orderBy: jest.fn((field: string, dir: string) => {
      calls.push({ method: 'orderBy', sql: `${field} ${dir}` });
      return qb;
    }),
    getMany: jest.fn(async () => rows),
  };

  return { qb, calls, sql: () => calls.map((c) => c.sql).join(' | ') };
}

describe('GraphPresetsService.findAll', () => {
  let service: GraphPresetsService;
  let testRunRepo: { findOne: jest.Mock };
  let builder: ReturnType<typeof makeQueryBuilder>;

  const USER = 'user-1';
const ORG_A = 'org-a';
const RUN = 'run-1';

  beforeEach(async () => {
    builder = makeQueryBuilder();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GraphPresetsService,
        {
          provide: getRepositoryToken(GraphPreset),
          useValue: { createQueryBuilder: jest.fn(() => builder.qb) },
        },
        { provide: getRepositoryToken(TestRunEntity), useValue: { findOne: jest.fn() } },
        {
          provide: AuditService,
          useValue: { logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(GraphPresetsService);
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));

    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.clearAllMocks());

  const withSut = () =>
    testRunRepo.findOne.mockResolvedValue({
      systemUnderTestId: 'sut-1',
      testEnvironment: 'acc',
    });

  describe('with a resolvable test run', () => {
    beforeEach(withSut);

    it('never returns presets by "no test run" — the leak', async () => {
      await service.findAll(USER, false, RUN, [ORG_A]);

      expect(builder.sql()).not.toContain('IS NULL');
    });

    it('scopes a global preset to the system and environment of the run', async () => {
      await service.findAll(USER, false, RUN, [ORG_A]);

      const globalArm = builder.calls.find((c) => c.sql.includes('application_dashboards'));
      expect(globalArm).toBeDefined();
      expect(globalArm!.sql).toContain('preset.isGlobal = true');
      expect(globalArm!.sql).toContain('ad.system_under_test_id = :sutId');
      expect(globalArm!.sql).toContain('ad.test_environment = :env');
      expect(globalArm!.params).toEqual({ sutId: 'sut-1', env: 'acc' });
    });

    // A `::uuid` cast would abort the whole query on one legacy non-uuid dashboardId
    // instead of simply not matching that row.
    it('compares the dashboard id as text, not as a uuid cast', async () => {
      await service.findAll(USER, false, RUN, [ORG_A]);

      const globalArm = builder.calls.find((c) => c.sql.includes('application_dashboards'))!;
      expect(globalArm.sql).toContain("ad.id::text");
      expect(globalArm.sql).not.toContain("::uuid");
    });

    it('scopes a non-global preset to the exact run', async () => {
      await service.findAll(USER, false, RUN, [ORG_A]);

      const runArm = builder.calls.find((c) => c.sql.includes('preset.isGlobal = false'));
      expect(runArm).toBeDefined();
      expect(runArm!.sql).toContain('preset.testRunId = :testRunId');
      expect(runArm!.params).toEqual({ testRunId: RUN });
    });

    it('applies the ownership predicate for a regular user', async () => {
      await service.findAll(USER, false, RUN, [ORG_A]);

      const own = builder.calls.find((c) => c.sql.includes('preset.userId = :userId'));
      expect(own).toBeDefined();
      expect(own!.params).toMatchObject({ userId: USER, isGlobal: true });
    });

    it('omits the ownership predicate for a global admin but still scopes by SUT', async () => {
      await service.findAll(USER, true, RUN, null);

      expect(builder.sql()).not.toContain('preset.userId = :userId');
      expect(builder.sql()).toContain('application_dashboards');
    });

    it('orders newest first', async () => {
      await service.findAll(USER, false, RUN, [ORG_A]);

      expect(builder.qb.orderBy).toHaveBeenCalledWith('preset.createdAt', 'DESC');
    });

    // The old query joined test_runs to read the workload too; a preset saved from a
    // different workload of the same system must still be listed.
    it('does not scope by workload', async () => {
      await service.findAll(USER, false, RUN, [ORG_A]);

      expect(builder.sql()).not.toContain('workload');
      expect(testRunRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ select: ['systemUnderTestId', 'testEnvironment'] }),
      );
    });
  });

  // A run id that resolves to nothing (pruned run, bad id) must not widen to everything.
  it('falls back to the exact run when the test run cannot be resolved', async () => {
    testRunRepo.findOne.mockResolvedValue(null);

    await service.findAll(USER, false, RUN, [ORG_A]);

    const scope = builder.calls.find((c) => c.sql.includes('preset.testRunId = :testRunId'));
    expect(scope).toBeDefined();
    expect(scope!.params).toEqual({ testRunId: RUN });
    expect(builder.sql()).not.toContain('IS NULL');
    expect(builder.sql()).not.toContain('application_dashboards');
  });

  // Without a run id there is no system to scope to — but the tenant boundary still
  // has to hold. This used to answer with every is_global preset in the database,
  // across every organization, and RLS is not a backstop: DB_ENABLE_RLS_ROLE defaults
  // to 'false' and is set nowhere in the shipped compose files.
  it('still scopes to the caller organizations when no run id is supplied', async () => {
    await service.findAll(USER, false, undefined, [ORG_A]);

    expect(testRunRepo.findOne).not.toHaveBeenCalled();
    expect(builder.sql()).not.toContain('application_dashboards');
    const org = builder.calls.find((c) => c.sql.includes('preset.organizationId IN'));
    expect(org).toBeDefined();
    expect(org!.params).toEqual({ accessibleOrgIds: [ORG_A] });
  });

  it('applies the organization predicate on the scoped path too', async () => {
    withSut();

    await service.findAll(USER, false, RUN, [ORG_A]);

    const org = builder.calls.find((c) => c.sql.includes('preset.organizationId IN'));
    expect(org).toBeDefined();
  });

  // `IN (:...orgs)` on an empty array renders as `IN ()`, which is a syntax error
  // rather than an empty result — so the short-circuit is load-bearing, not an
  // optimisation.
  it('returns nothing, and runs no query, for a user with no accessible organization', async () => {
    const out = await service.findAll(USER, false, RUN, []);

    expect(out).toEqual([]);
    expect(builder.qb.getMany).not.toHaveBeenCalled();
  });

  it('exempts a global admin from the organization predicate', async () => {
    withSut();

    await service.findAll(USER, true, RUN, null);

    expect(builder.sql()).not.toContain('preset.organizationId IN');
    // ...but still scopes to the system under test.
    expect(builder.sql()).toContain('application_dashboards');
  });

  it('wraps a repository failure rather than leaking it', async () => {
    withSut();
    builder.qb.getMany.mockRejectedValue(new Error('connection terminated'));

    await expect(service.findAll(USER, false, RUN, [ORG_A])).rejects.toThrow(
      'Failed to fetch graph presets: connection terminated',
    );
  });
});
