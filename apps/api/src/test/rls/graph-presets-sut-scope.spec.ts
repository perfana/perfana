/**
 * The cross-tenant scoping fix, executed against a real Postgres.
 *
 * `graph-presets.findAll.spec.ts` pins the query SHAPE against a mocked builder whose
 * `getMany` returns `[]`, so nothing there proves a foreign system's preset is actually
 * excluded — a typo in the jsonb key (`dashboard_id` for `dashboardId`), the wrong
 * column, or a `-> 0` against a preset with no first series all pass every one of its
 * assertions. Three reviewers flagged that independently. This suite runs the real SQL.
 *
 * What it guards:
 *   1. a global preset belonging to another system is NOT listed (the reported bug);
 *   2. a global preset of THIS system IS listed, through the derived-owner EXISTS;
 *   3. the jsonb path matches what the repository actually persists, by round-tripping
 *      a preset through TypeORM rather than asserting on SQL text;
 *   4. a preset from another organization is NOT listed even with no run id — the
 *      tenant boundary that had no backstop, since DB_ENABLE_RLS_ROLE defaults to off.
 *
 * Runs as the owner role against the local dev DB, like its sibling suites. Everything
 * it writes is rolled back.
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../data-source';
import * as Entities from '../../entities';
import { GraphPreset } from '@perfana/shared/entities';
import { TestRun as TestRunEntity } from '../../entities';
import { GraphPresetsService } from '../../modules/graph-presets/graph-presets.service';

const entityClasses = Object.values(Entities).filter(
  (v): v is new () => unknown => typeof v === 'function',
);

describe('GraphPresetsService.findAll — SUT scoping against a real database', () => {
  const ds = new DataSource({
    ...(AppDataSource.options as Record<string, unknown>),
    entities: entityClasses,
    migrations: [],
  } as never);

  const USER = 'scope-spec-user';
  const ENV = 'acceptatie';

  const orgA = randomUUID();
  const orgB = randomUUID();
  const sutA = randomUUID();
  const sutB = randomUUID();
  const dashA = randomUUID();
  const dashB = randomUUID();
  const runA = `scope-spec-run-a-${Date.now()}`;
  const runB = `scope-spec-run-b-${Date.now()}`;
  const suffix = randomUUID().slice(0, 8);

  let service: GraphPresetsService;

  beforeAll(async () => {
    await ds.initialize();

    service = new GraphPresetsService(
      ds.getRepository(GraphPreset),
      ds.getRepository(TestRunEntity),
      // findAll never dispatches audit events.
      { logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() } as never,
    );

    for (const [org, name] of [[orgA, `scope-spec-a-${suffix}`], [orgB, `scope-spec-b-${suffix}`]]) {
      await ds.query(`INSERT INTO organizations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [org, name]);
    }
    for (const [sut, org, name] of [
      [sutA, orgA, `scope-spec-sut-a-${suffix}`],
      [sutB, orgB, `scope-spec-sut-b-${suffix}`],
    ]) {
      await ds.query(
        `INSERT INTO systems_under_test (id, organization_id, name, description)
         VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [sut, org, name, 'graph preset scoping spec'],
      );
    }
    // The dashboards the presets derive their owning system from.
    for (const [dash, sut, org] of [[dashA, sutA, orgA], [dashB, sutB, orgB]]) {
      await ds.query(
        `INSERT INTO application_dashboards
           (id, system_under_test_id, test_environment, dashboard_name, dashboard_label, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [dash, sut, ENV, 'scope spec dashboard', 'scope spec dashboard', org],
      );
    }
    for (const [run, sut, org] of [[runA, sutA, orgA], [runB, sutB, orgB]]) {
      await ds.query(
        `INSERT INTO test_runs (test_run_id, system_under_test_id, test_environment, workload, organization_id, start_time, end_time)
         VALUES ($1, $2, $3, 'loadTest', $4, now(), now()) ON CONFLICT (test_run_id) DO NOTHING`,
        [run, sut, ENV, org],
      );
    }

    // Round-trip through the repository so the persisted jsonb shape is whatever the
    // entity actually writes — the point of the exercise.
    const repo = ds.getRepository(GraphPreset);
    await repo.save([
      repo.create({
        name: `scope-spec-global-a-${suffix}`,
        testRunId: runA,
        userId: USER,
        createdBy: USER,
        isGlobal: true,
        organizationId: orgA,
        seriesConfig: [{ dashboardId: dashA, panelId: 1, panelTitle: 'p', dashboardLabel: 'd' }] as never,
      }),
      repo.create({
        name: `scope-spec-global-b-${suffix}`,
        testRunId: runB,
        userId: USER,
        createdBy: USER,
        isGlobal: true,
        organizationId: orgB,
        seriesConfig: [{ dashboardId: dashB, panelId: 1, panelTitle: 'p', dashboardLabel: 'd' }] as never,
      }),
    ]);
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM graph_presets WHERE user_id = $1`, [USER]);
    await ds.query(`DELETE FROM test_runs WHERE test_run_id = ANY($1)`, [[runA, runB]]);
    await ds.query(`DELETE FROM application_dashboards WHERE id = ANY($1)`, [[dashA, dashB]]);
    await ds.query(`DELETE FROM systems_under_test WHERE id = ANY($1)`, [[sutA, sutB]]);
    await ds.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgA, orgB]]);
    await ds.destroy();
  });

  const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();

  it("lists this system's global preset and not the other system's", async () => {
    const out = await service.findAll(USER, false, runA, [orgA, orgB]);

    expect(names(out)).toContain(`scope-spec-global-a-${suffix}`);
    expect(names(out)).not.toContain(`scope-spec-global-b-${suffix}`);
  });

  it('is symmetric — asking from the other system flips which one is visible', async () => {
    const out = await service.findAll(USER, false, runB, [orgA, orgB]);

    expect(names(out)).toContain(`scope-spec-global-b-${suffix}`);
    expect(names(out)).not.toContain(`scope-spec-global-a-${suffix}`);
  });

  // A global admin bypasses the ownership and organization predicates, never the
  // system scoping — that was the leak.
  it('scopes a global admin to the system as well', async () => {
    const out = await service.findAll(USER, true, runA, null);

    expect(names(out)).not.toContain(`scope-spec-global-b-${suffix}`);
  });

  // The tenant boundary with no run id to scope by.
  it('excludes other organizations even with no run id supplied', async () => {
    const out = await service.findAll(USER, false, undefined, [orgA]);

    expect(names(out)).toContain(`scope-spec-global-a-${suffix}`);
    expect(names(out)).not.toContain(`scope-spec-global-b-${suffix}`);
  });

  // The by-id routes were the other half of the leak: findAll got a tenant predicate
  // and findOne/update/remove authorized on userId alone, so any authenticated user in
  // any tenant could read any global preset by id. 404, not 403 — a 403 confirms the id
  // exists, which is itself a cross-tenant disclosure.
  describe('by-id routes are tenant-bounded too', () => {
    const idOfB = async () =>
      (await ds.getRepository(GraphPreset).findOneOrFail({
        where: { name: `scope-spec-global-b-${suffix}` },
      })).id;

    it('404s reading another organization\'s global preset by id', async () => {
      await expect(service.findOne(await idOfB(), USER, false, [orgA]))
        .rejects.toThrow('not found');
    });

    it('404s updating another organization\'s preset', async () => {
      await expect(service.update(await idOfB(), { name: 'x' }, USER, false, [orgA]))
        .rejects.toThrow('not found');
    });

    it('404s deleting another organization\'s preset', async () => {
      await expect(service.remove(await idOfB(), USER, false, [orgA]))
        .rejects.toThrow('not found');
    });

    it('still serves a preset inside the caller organizations', async () => {
      const own = await ds.getRepository(GraphPreset).findOneOrFail({
        where: { name: `scope-spec-global-a-${suffix}` },
      });
      await expect(service.findOne(own.id, USER, false, [orgA])).resolves.toMatchObject({
        name: `scope-spec-global-a-${suffix}`,
      });
    });

    it('exempts a global admin', async () => {
      await expect(service.findOne(await idOfB(), USER, true, null)).resolves.toBeDefined();
    });
  });

  // create() inherits its organization from a caller-supplied run id, so that id has to
  // be authorized — otherwise naming another tenant's run writes a preset into their
  // organization, and isGlobal:true puts it in their list.
  it('refuses to create a preset against a run in another organization', async () => {
    await expect(
      service.create(
        {
          name: 'cross-tenant',
          testRunId: runB,
          seriesConfig: [{ dashboardId: dashB, panelId: 1, panelTitle: 'p', dashboardLabel: 'd' }],
        } as never,
        USER,
        [orgA],
      ),
    ).rejects.toThrow('Test run not found');
  });

  it('returns nothing for a user with no accessible organization', async () => {
    await expect(service.findAll(USER, false, runA, [])).resolves.toEqual([]);
  });
});
