import { DynatraceRepository } from './dynatrace.repository';

/**
 * Regression tests for the ds_compare_config INSERT gaining organization_id
 * (NOT NULL under RLS — a NULL row is invisible to every non-admin).
 * The org is read from the parent application_dashboards row in its own
 * statement, so a missing dashboard fails loudly instead of inserting NULL.
 */
describe('DynatraceRepository — createDsCompareConfigForMetric', () => {
  let manager: { query: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let repository: DynatraceRepository;

  const stubRepo = () => ({}) as never;

  const create = () =>
    repository.createDsCompareConfigForMetric(
      'sut-1',
      'production',
      'loadTest',
      'ad-1',
      42,
      'CPU usage',
      'builtin:host.cpu.usage',
    );

  beforeEach(() => {
    manager = { query: jest.fn().mockResolvedValue([]) };
    dataSource = {
      transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) => fn(manager)),
    };
    repository = new DynatraceRepository(
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      dataSource as never,
    );
  });

  it('inserts with organization_id and team_id read from the application dashboard', async () => {
    manager.query
      .mockResolvedValueOnce([]) // existence check: no config yet
      .mockResolvedValueOnce([{ organization_id: 'org-1', team_id: 'team-1' }]);

    await create();

    expect(manager.query).toHaveBeenCalledTimes(3);
    const [sql, params] = manager.query.mock.calls[2] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO ds_compare_config');
    expect(params).toEqual([
      'sut-1',
      'production',
      'loadTest',
      'ad-1',
      42,
      expect.any(String),
      'org-1',
      'team-1',
    ]);
    // placeholder/param drift guard: distinct placeholders must match the param list
    const distinctPlaceholders = new Set(sql.match(/\$\d+/g) as string[]).size;
    expect(distinctPlaceholders).toBe(params.length);
  });

  it('throws instead of inserting a NULL organization_id when the dashboard is missing', async () => {
    manager.query
      .mockResolvedValueOnce([]) // no config yet
      .mockResolvedValueOnce([]); // dashboard row absent / invisible

    await expect(create()).rejects.toThrow(/application_dashboard ad-1 does not exist/);
    expect(manager.query).toHaveBeenCalledTimes(2);
  });

  it('scopes the existence check by workload, like uniq_ds_compare_config_panel', async () => {
    manager.query.mockResolvedValueOnce([{ id: 'existing' }]);

    await create();

    expect(manager.query).toHaveBeenCalledTimes(1);
    const [sql, params] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('SELECT id FROM ds_compare_config');
    expect(sql).toContain('workload = $3');
    expect(params).toEqual(['sut-1', 'production', 'loadTest', 'ad-1', 42]);
  });

  it('writes the USE_utilization / dynatrace-host config_data for an ordinary host metric', async () => {
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ organization_id: 'org-1', team_id: 'team-1' }]);

    await create();

    const [, params] = manager.query.mock.calls[2] as [string, unknown[]];
    expect(JSON.parse(params[5] as string)).toEqual({
      metricClassification: { classification: 'USE_utilization', higherIsBetter: false },
      thresholds: {
        aggregation: 'mean',
        percentageThreshold: 0.1,
        iqrThreshold: 2.0,
        absoluteThreshold: null,
      },
      ignore: false,
      source: 'dynatrace-host',
    });
  });

  it('marks Network Traffic informational (higherIsBetter null), not lower-is-better', async () => {
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ organization_id: 'org-1', team_id: 'team-1' }]);

    await repository.createDsCompareConfigForMetric(
      'sut-1',
      'production',
      'loadTest',
      'ad-1',
      43,
      'Network Traffic',
      'builtin:host.net.nic.traffic.rx',
    );

    const [, params] = manager.query.mock.calls[2] as [string, unknown[]];
    const configData = JSON.parse(params[5] as string) as {
      metricClassification: { higherIsBetter: boolean | null };
    };
    expect(configData.metricClassification.higherIsBetter).toBeNull();
  });

  // The API's application_dashboards insert has no team_id column, so every dashboard it
  // writes is team-less and every compare config under it inherits that. The worker's twin
  // (dynatrace-dashboard-manager.ts) DOES stamp the SUT's team. That divergence predates
  // this fix and is pinned here, not endorsed — see the TODOS.md entry. It costs nothing to
  // an org member (can_access_resource checks the org first and team is an extra grant, not
  // a restriction); it only shows for a user in a team but not in its organization.
  it('forwards a NULL team_id unchanged — the API path never sets one (see TODOS.md)', async () => {
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ organization_id: 'org-1', team_id: null }]);

    await create();

    const [, params] = manager.query.mock.calls[2] as [string, unknown[]];
    expect(params[6]).toBe('org-1');
    expect(params[7]).toBeNull();
  });
});

/**
 * `dynatrace_queries` has only a PK — no unique on dashboard_label — and copyQueries
 * deliberately writes the same label into another scope. Keyed on the label alone this
 * reused another system's or workload's application_dashboard_id, and short-circuited
 * the deterministic id in createQuerySmart, which is the artificial dashboard's only
 * dedupe since it stopped carrying grafana_instance_id.
 */
describe('DynatraceRepository — findDashboardByLabel', () => {
  const stubRepo = () => ({}) as never;

  it('scopes the lookup to system, environment and workload, not the label alone', async () => {
    const queryRepo = { findOne: jest.fn().mockResolvedValue({ applicationDashboardId: 'ad-1' }) };
    const repository = new DynatraceRepository(
      stubRepo(),
      queryRepo as never,
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      { transaction: jest.fn() } as never,
    );

    const id = await repository.findDashboardByLabel(
      'Dynatrace host metrics host-a',
      'sut-1',
      'acc',
      'combitest',
    );

    expect(id).toBe('ad-1');
    const [args] = queryRepo.findOne.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).toEqual({
      dashboardLabel: 'Dynatrace host metrics host-a',
      systemUnderTestId: 'sut-1',
      testEnvironment: 'acc',
      workload: 'combitest',
    });
  });

  it('returns null when this scope has no query with that label', async () => {
    const queryRepo = { findOne: jest.fn().mockResolvedValue(null) };
    const repository = new DynatraceRepository(
      stubRepo(),
      queryRepo as never,
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      { transaction: jest.fn() } as never,
    );

    await expect(
      repository.findDashboardByLabel('unseen', 'sut-1', 'acc', 'combitest'),
    ).resolves.toBeNull();
  });
});

/**
 * A Dynatrace application_dashboard is per-workload (its id hashes the workload in),
 * but uq_application_dashboards_unique is
 * (system, environment, grafana_instance_id, dashboard_uid, dashboard_label) — no
 * workload, and a uid built from the label alone. Setting grafana_instance_id made the
 * second workload collide with the first, ON CONFLICT swallowed the insert, and the
 * ds_compare_config that reads the row's organization_id then failed the NOT NULL.
 */
describe('DynatraceRepository — ensureArtificialDashboardExists', () => {
  const stubRepo = () => ({}) as never;

  const makeRepository = (manager: { query: jest.Mock }) =>
    new DynatraceRepository(
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      {
        transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) => fn(manager)),
      } as never,
    );

  const ensure = (repository: DynatraceRepository, label = 'Dynatrace host metrics host-a') =>
    repository.ensureArtificialDashboardExists(
      'sut-1',
      'production',
      'combitest',
      label,
      'ad-combitest',
      'org-1',
    );

  /** The happy path: both parents resolved, the application_dashboard still to write. */
  const managerWithDashboardAbsent = () => ({
    query: jest
      .fn()
      .mockResolvedValueOnce([{ id: 'gi-1' }]) // grafana_instances LIMIT 1
      .mockResolvedValueOnce([{ id: 'gd-1' }]) // synthetic grafana_dashboard exists
      .mockResolvedValueOnce([]) // application_dashboard absent
      .mockResolvedValueOnce([]),
  });

  it('leaves grafana_instance_id NULL so a second workload gets its own row', async () => {
    const manager = managerWithDashboardAbsent();

    await ensure(makeRepository(manager));

    const [sql, params] = manager.query.mock.calls[3] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO application_dashboards');
    expect(sql).not.toContain('grafana_instance_id');
    expect(params).not.toContain('gi-1');
    expect(params[0]).toBe('ad-combitest');
    // The clause must survive, and must stay targeted: the check-then-insert above is
    // not atomic, so a racing second caller has to be tolerated — but only on the id.
    // A bare DO NOTHING would swallow every other constraint instead.
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
  });

  it('keeps the application_dashboards placeholder and parameter lists in step', async () => {
    const manager = managerWithDashboardAbsent();

    await ensure(makeRepository(manager));

    const [sql, params] = manager.query.mock.calls[3] as [string, unknown[]];
    const distinctPlaceholders = new Set(sql.match(/\$\d+/g) as string[]).size;
    expect(distinctPlaceholders).toBe(params.length);
    expect(params).toHaveLength(8);
    // id, sut, env, grafana_dashboard_id, name, uid, label, organization_id
    expect(params[3]).toBe('gd-1');
    expect(params[7]).toBe('org-1');
  });

  it('throws when the deployment has no Grafana instance at all', async () => {
    const manager = { query: jest.fn().mockResolvedValueOnce([]) };

    await expect(ensure(makeRepository(manager))).rejects.toThrow(/No Grafana instances found/);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('creates the synthetic grafana_dashboard when the uid is unseen, and links its new id', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'gi-1' }]) // grafana_instances LIMIT 1
        .mockResolvedValueOnce([]) // no synthetic grafana_dashboard yet
        .mockResolvedValueOnce([{ id: 'gd-new' }]) // INSERT ... RETURNING id
        .mockResolvedValueOnce([]) // application_dashboard absent
        .mockResolvedValueOnce([]),
    };

    await ensure(makeRepository(manager));

    const [gdSql, gdParams] = manager.query.mock.calls[2] as [string, unknown[]];
    expect(gdSql).toContain('INSERT INTO grafana_dashboards');
    expect(gdParams[0]).toBe('gi-1');
    // the 800000+ range that marks a Dynatrace placeholder
    expect(gdParams[1]).toBeGreaterThanOrEqual(800000);
    expect(gdParams[1]).toBeLessThan(900000);
    expect(gdParams[4]).toBe('[]'); // empty panels, so it is never pushed to Grafana
    expect(gdParams[5]).toBe('org-1');

    // the application_dashboard must point at the row just created, not at the instance
    const [adSql, adParams] = manager.query.mock.calls[4] as [string, unknown[]];
    expect(adSql).toContain('INSERT INTO application_dashboards');
    expect(adParams[3]).toBe('gd-new');
  });

  it('does not insert an application_dashboard when the workload already has one', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'gi-1' }])
        .mockResolvedValueOnce([{ id: 'gd-1' }]) // synthetic dashboard reused, not recreated
        .mockResolvedValueOnce([{ id: 'ad-combitest' }]), // row already present
    };

    await ensure(makeRepository(manager));

    expect(manager.query).toHaveBeenCalledTimes(3);
    const sqls = manager.query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((sql) => sql.includes('INSERT INTO application_dashboards'))).toBe(false);
    expect(sqls.some((sql) => sql.includes('INSERT INTO grafana_dashboards'))).toBe(false);
  });

  it('derives the dashboard uid from the label alone — which is why it cannot carry an instance id', async () => {
    const manager = managerWithDashboardAbsent();

    await ensure(makeRepository(manager), 'Dynatrace Host: host-a.example.com!');

    const expectedUid = 'dynatrace-dynatrace-host-host-a-example-com';
    const [, lookupParams] = manager.query.mock.calls[1] as [string, unknown[]];
    expect(lookupParams).toEqual([expectedUid, 'gi-1']);

    const [, insertParams] = manager.query.mock.calls[3] as [string, unknown[]];
    // dashboard_name and dashboard_label keep the raw label; only the uid is sanitised
    expect(insertParams[4]).toBe('Dynatrace Host: host-a.example.com!');
    expect(insertParams[5]).toBe(expectedUid);
    expect(insertParams[6]).toBe('Dynatrace Host: host-a.example.com!');
  });
});

/**
 * `client_url` (the repository's snake_case input) must be mapped onto the
 * entity's camelCase `clientUrl` property. TypeORM silently drops unknown
 * properties, so a snake_case key here would compile, run, and persist nothing —
 * the field would just never save, with no error anywhere.
 *
 * `withRequestEm` returns the repository unchanged when no request-scoped
 * EntityManager is bound, so a plain mock repo is enough here.
 */
describe('DynatraceRepository — clientUrl column mapping', () => {
  let configRepo: { create: jest.Mock; save: jest.Mock; update: jest.Mock; findOne: jest.Mock };
  let repository: DynatraceRepository;

  const stubRepo = () => ({}) as never;

  beforeEach(() => {
    configRepo = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue({ id: 'config-1' }),
    };
    repository = new DynatraceRepository(
      configRepo as never,
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      { transaction: jest.fn() } as never,
    );
  });

  it('create() maps client_url onto the camelCase clientUrl property', async () => {
    await repository.create({
      host: 'https://example.live.dynatrace.com',
      client_url: 'https://dynatrace.example.com',
      api_token: 'dt0c01.test',
      label: 'Production',
    });

    const created = configRepo.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(created.clientUrl).toBe('https://dynatrace.example.com');
    // The snake_case key must NOT survive — TypeORM would drop it without a word
    expect(created).not.toHaveProperty('client_url');
  });

  it('update() normalises an empty string to NULL, so the field has one unset value', async () => {
    await repository.update('config-1', { client_url: '' });

    const [, updateData] = configRepo.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(updateData).toHaveProperty('clientUrl', null);
  });

  it('update() omits clientUrl entirely when the caller did not send one', async () => {
    await repository.update('config-1', { label: 'Renamed' });

    const [, updateData] = configRepo.update.mock.calls[0] as [string, Record<string, unknown>];
    // Present-but-undefined would be harmless for TypeORM, but absent is the
    // contract the service relies on to distinguish "leave it" from "clear it".
    expect(updateData).not.toHaveProperty('clientUrl');
    expect(updateData).toHaveProperty('label', 'Renamed');
  });
});
