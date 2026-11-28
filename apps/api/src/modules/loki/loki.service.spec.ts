import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LokiService, describeLevelProbe, errorRateFromServices, levelLabelMissing, levelTotals, mergeLevelLines } from './loki.service';
import { validateLogqlPipeline } from '@perfana/shared/services/loki/client';
import { Capability } from '../../constants/capabilities.constants';

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const SUT = '11111111-1111-1111-1111-111111111111';
const CFG = '22222222-2222-2222-2222-222222222222';
const GI = '33333333-3333-3333-3333-333333333333';

function repo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'new-id', createdAt: new Date(), updatedAt: new Date(), ...x })),
    findOne: jest.fn(),
    find: jest.fn(async () => []),
    delete: jest.fn(),
    upsert: jest.fn(),
    findOneOrFail: jest.fn(async () => ({ id: 'source-id' })),
    createQueryBuilder: jest.fn(),
    target: 'x',
  };
}

const grafana = { id: GI, label: 'grafana-prod', client_url: 'https://grafana.example.com', server_url: null, orgId: '1', apiKey: 'k', organizationId: ORG_A, useProxy: false };

function build(opts: { canModify?: boolean; canAccess?: boolean; caps?: string[] } = {}) {
  const configRepo = repo();
  const mappingRepo = repo();
  const queryRepo = repo();
  const grafanaRepo = repo();
  const sutRepo = repo();
  const metricsSourceRepo = repo();
  const testRunRepo = repo();
  const authz = {
    getAccessibleOrganizations: jest.fn(async () => [ORG_A]),
    isGlobalAdmin: jest.fn(() => false),
    getCapabilities: jest.fn(async () => opts.caps ?? Object.values(Capability)),
    canAccessResource: jest.fn(async () => ({ allowed: opts.canAccess ?? true })),
    canModifyResource: jest.fn(async () => ({ allowed: opts.canModify ?? true })),
  };
  const audit = { logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() };
  const proxy = { resolve: jest.fn(async () => null) };
  const dataSource = { manager: { query: jest.fn(async () => [] as unknown[]) } };
  const service = new LokiService(
    configRepo as never, mappingRepo as never, queryRepo as never, grafanaRepo as never, sutRepo as never,
    metricsSourceRepo as never, testRunRepo as never, dataSource as never,
    authz as never, audit as never, proxy as never,
  );
  sutRepo.findOne.mockResolvedValue({ id: SUT, organization_id: ORG_A, team_id: null });
  grafanaRepo.findOne.mockResolvedValue(grafana);
  configRepo.findOne.mockResolvedValue({ id: CFG, organizationId: ORG_A, grafanaInstanceId: GI, datasourceUid: 'loki', levelLabel: 'detected_level', label: 'logs', grafanaInstance: grafana });
  return { service, configRepo, mappingRepo, queryRepo, grafanaRepo, sutRepo, testRunRepo, dataSource, authz, audit };
}

describe('LokiService connections', () => {
  it('takes the organization from the Grafana instance and checks the capability there', async () => {
    const { service, configRepo, authz } = build();
    const created = await service.createConfig({ label: 'logs', grafanaInstanceId: GI, datasourceUid: 'loki' }, 'u', []);
    expect(authz.getCapabilities).toHaveBeenCalledWith('u', [], ORG_A);
    expect(configRepo.save).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A, levelLabel: 'detected_level' }));
    expect(created).toMatchObject({ grafanaInstanceLabel: 'grafana-prod', datasourceUid: 'loki' });
    // Never exposes the instance's credentials.
    expect(JSON.stringify(created)).not.toContain('"k"');
  });

  it('refuses without integration:loki:create', async () => {
    const { service } = build({ caps: [] });
    await expect(service.createConfig({ label: 'x', grafanaInstanceId: GI, datasourceUid: 'loki' }, 'u', [])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 404 for a Grafana instance or connection outside the caller organizations', async () => {
    const { service } = build({ canAccess: false });
    await expect(service.createConfig({ label: 'x', grafanaInstanceId: GI, datasourceUid: 'loki' }, 'u', [])).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getConfig(CFG, 'u', [])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires integration:loki:update to list labels', async () => {
    const { service } = build({ caps: [] });
    await expect(service.listLabels(CFG, 'u', [])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.testSavedConnection(CFG, 'u', [])).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('LokiService mappings and panels', () => {
  it('refuses to point a system at another organization\'s Loki connection', async () => {
    const { service, configRepo } = build();
    configRepo.findOne.mockResolvedValue({ id: CFG, organizationId: ORG_B, grafanaInstance: grafana });
    await expect(service.createMapping({
      lokiConfigId: CFG, systemUnderTestId: SUT, level: 'sut', matchers: [{ label: 'app', op: '=', value: 'shop' }],
    }, 'u', [])).rejects.toThrow('another organization');
  });

  it('stores the canonical selector and inherits the system organization', async () => {
    const { service, mappingRepo } = build();
    await service.createMapping({
      lokiConfigId: CFG, systemUnderTestId: SUT, level: 'environment', testEnvironment: 'acc', workload: 'ignored',
      matchers: [{ label: 'namespace', op: '=', value: 'perf' }, { label: 'app', op: '=~', value: 'shop-.*' }],
    }, 'u', []);
    expect(mappingRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_A, testEnvironment: 'acc', workload: null, selector: '{namespace="perf", app=~"shop-.*"}',
    }));
  });

  it('refuses a mapping whose matchers would select every stream', async () => {
    const { service } = build();
    await expect(service.createMapping({
      lokiConfigId: CFG, systemUnderTestId: SUT, level: 'sut', matchers: [{ label: 'app', op: '=~', value: '.*' }],
    }, 'u', [])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a panel that brings its own selector or range', async () => {
    const { service } = build();
    const base = { lokiConfigId: CFG, systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load', panelTitle: 'x' };
    await expect(service.createQuery({ ...base, logql: '{app="other"}' }, 'u', [])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createQuery({ ...base, logql: '$entities | json [5m]' }, 'u', [])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createQuery({ ...base, logql: '$entities', aggregation: 'stddev(x)' }, 'u', [])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a taken panel id before it writes any dashboard row', async () => {
    // Value: protects=a 409 on createQuery leaves no orphan dashboard rows; fails_when=the conflict check moves after ensureArtificialDashboard; why_new=review fix; seam=none; no_claim=the unique index race (saveUnique still backstops it)
    const { service, queryRepo, dataSource } = build();
    queryRepo.findOne.mockResolvedValue({ id: 'existing' });
    await expect(service.createQuery({
      lokiConfigId: CFG, systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load', panelTitle: 'x', panelId: 1, logql: '$entities',
    }, 'u', [])).rejects.toBeInstanceOf(ConflictException);
    expect(dataSource.manager.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO'))).toBe(false);
  });

  it('needs write access on the system to preview, since a preview runs LogQL with the org credentials', async () => {
    const { service } = build({ canModify: false, canAccess: true });
    await expect(service.previewQuery({
      lokiConfigId: CFG, systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load', logql: '$entities',
    }, 'u', [])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates the artificial dashboard on the connection\'s Grafana instance with a deterministic id', async () => {
    const { service, queryRepo, dataSource } = build();
    queryRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), getRawOne: jest.fn(async () => ({ max: 2 })),
    });
    dataSource.manager.query
      .mockResolvedValueOnce([])              // application_dashboards probe
      .mockResolvedValueOnce([])              // grafana_dashboards probe
      .mockResolvedValueOnce([{ id: 'gd' }])  // grafana_dashboards insert
      .mockResolvedValueOnce([]);             // application_dashboards insert
    const saved = await service.createQuery({
      lokiConfigId: CFG, systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load', panelTitle: 'Errors', logql: '$entities |= "ERROR"',
    }, 'u', []);
    expect(saved).toMatchObject({ panelId: 3, dashboardLabel: 'Loki logs', metricsSourceId: 'source-id' });
    const insert = dataSource.manager.query.mock.calls[2] as unknown as [string, unknown[]];
    expect(insert[1]).toEqual(expect.arrayContaining([GI, 'perfana-loki-loki-logs']));
  });
});

describe('level parser', () => {
  it('puts the connection\'s parser in front of the starter panels\' level grouping and filter', async () => {
    const { service, configRepo } = build();
    configRepo.findOne.mockResolvedValue({
      id: CFG, organizationId: ORG_A, grafanaInstanceId: GI, datasourceUid: 'loki', levelLabel: 'level', levelParser: 'json', label: 'logs', grafanaInstance: grafana,
    });
    const created: Array<{ panelTitle: string; logql: string; splitBy: string }> = [];
    jest.spyOn(service, 'listQueries').mockResolvedValue([]);
    jest.spyOn(service, 'createQuery').mockImplementation(async (dto) => { created.push(dto as never); return dto as never; });
    await service.createStarterQueries({ lokiConfigId: CFG, systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load' }, 'u', []);
    expect(created.map((q) => [q.panelTitle, q.logql, q.splitBy])).toEqual([
      ['Log lines by level', '$entities | json', 'level'],
      ['Error lines by service', '$entities | json | level=~"(?i)(error|err|fatal|critical|crit|panic|emerg|alert|severe)"', 'service_name'],
      ['Log volume by service', '$entities', 'service_name'],
    ]);
    for (const q of created) expect(validateLogqlPipeline(q.logql)).toBeNull();
  });

  it('stores the parser on create and update, defaulting to none', async () => {
    const { service, configRepo } = build();
    await service.createConfig({ label: 'logs', grafanaInstanceId: GI, datasourceUid: 'loki' }, 'u', []);
    expect(configRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ levelParser: 'none' }));
    await service.updateConfig(CFG, { levelParser: 'logfmt', levelLabel: 'level' }, 'u', []);
    expect(configRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ levelParser: 'logfmt', levelLabel: 'level' }));
  });

  it('says whether the configured level works, what would, or that nothing does', () => {
    const configured = { parser: 'none', label: 'detected_level' };
    expect(describeLevelProbe(configured, { parser: 'none', label: 'detected_level', levels: ['error', 'info'], coverage: 1 }))
      .toBe('Levels found with the label "detected_level": error, info.');
    expect(describeLevelProbe(configured, { parser: 'none', label: 'detected_level', levels: ['info'], coverage: 0.3 }))
      .toBe('Levels found with the label "detected_level": info, on 30% of lines.');
    expect(describeLevelProbe(configured, { parser: 'json', label: 'level', levels: ['error'], coverage: 1 }))
      .toBe('the label "detected_level" carries no level on most of these lines, but "| json" with the field "level" does (error): set the level parser to "json" and the level label to "level".');
    expect(describeLevelProbe(configured, null)).toMatch(/^No log level found with the label "detected_level", nor with \| json or \| logfmt/);
  });

  it('calls the level label missing only when every series of the level panel is (none)', () => {
    expect(levelLabelMissing([{ name: '(none)' }])).toBe(true);
    expect(levelLabelMissing([{ name: '(none)' }, { name: 'error' }])).toBe(false);
    expect(levelLabelMissing([])).toBe(false);
  });
});

describe('levelTotals', () => {
  it('counts every error spelling as error lines', () => {
    expect(levelTotals([
      { name: 'info', total: 900 }, { name: 'ERROR', total: 40 }, { name: 'fatal', total: 10 }, { name: 'warn', total: 50 },
    ])).toEqual({ total: 1000, errors: 50 });
  });

  it('is null when no series has a total', () => {
    expect(levelTotals([{ name: 'error', total: null }])).toBeNull();
  });
});

describe('errorRateFromServices', () => {
  it('pools the run, and weights each application\'s baseline by its lines in this run', () => {
    const rate = errorRateFromServices([
      { totalLines: 900, errorLines: 90, baseline: { errorRatePct: 1, runs: 3 } },
      { totalLines: 100, errorLines: 0, baseline: null },
    ]);
    expect(rate).toMatchObject({ totalLines: 1000, errorLines: 90, errorRatePct: 9 });
    // Only the application with a baseline counts towards it: 1% of its 900 lines.
    expect(rate!.baseline).toEqual({ errorRatePct: 1, runs: 3 });
  });

  it('is null with no lines', () => {
    expect(errorRateFromServices([])).toBeNull();
  });
});

describe('LokiService run insights per application', () => {
  function insights(rows: { baselinePatterns: Array<{ scope: string; pattern_key: string }>; baselineServices: Array<{ test_run_id: string; service: string; total: string; errors: string }> }) {
    const { service, dataSource } = build();
    dataSource.manager.query.mockImplementation((async (sql: string) => {
      if (sql.includes('to_regclass')) return [{ patterns: true, services: true }];
      if (sql.includes('FROM loki_run_patterns WHERE test_run_id = $1')) {
        return [
          { loki_config_id: CFG, pattern: 'all <_>', pattern_key: 'all <_>', level: 'error', count: '9', first_seen: null, last_seen: null, source: 'patterns', service: null },
          { loki_config_id: CFG, pattern: 'pay <_>', pattern_key: 'pay <_>', level: 'error', count: '4', first_seen: null, last_seen: null, source: 'patterns', service: 'payments' },
        ];
      }
      if (sql.includes('FROM loki_run_samples')) return [];
      if (sql.includes('FROM loki_run_services WHERE test_run_id = $1')) {
        return [
          { service: 'payments', total: '1000', errors: '50', warns: '0', loki_config_id: CFG },
          { service: 'checkout', total: '3000', errors: '30', warns: '5', loki_config_id: CFG },
        ];
      }
      if (sql.includes('SELECT DISTINCT')) return rows.baselinePatterns;
      if (sql.includes('FROM loki_run_services WHERE test_run_id = ANY')) return rows.baselineServices;
      return [];
    }) as never);
    return (service as unknown as { runInsights: (...a: unknown[]) => Promise<{
      newPatterns: number | null;
      patterns: Array<{ service: string | null; isNew: boolean | null }>;
      services: Array<{ service: string; errorRatePct: number; baseline: { errorRatePct: number; runs: number } | null; isNew: boolean | null; newPatterns: number | null }>;
    }> }).runInsights('run-1', new Map(), new Date(0), new Date(1000), [], ['base-1', 'base-2']);
  }

  it('gives each application its error rate, pooled baseline and new patterns, worst first', async () => {
    const r = await insights({
      baselinePatterns: [{ scope: '', pattern_key: 'all <_>' }, { scope: 'checkout', pattern_key: 'x' }],
      baselineServices: [
        { test_run_id: 'base-1', service: 'checkout', total: '1000', errors: '5' },
        { test_run_id: 'base-2', service: 'checkout', total: '1000', errors: '15' },
      ],
    });
    expect(r.services.map((s) => s.service)).toEqual(['payments', 'checkout']);
    const checkout = r.services.find((s) => s.service === 'checkout')!;
    expect(checkout.errorRatePct).toBe(1);
    expect(checkout.baseline).toEqual({ errorRatePct: 1, runs: 2 });
    expect(checkout.isNew).toBe(false);
    // payments is in no baseline run: the application and its patterns are new.
    const payments = r.services.find((s) => s.service === 'payments')!;
    expect(payments).toMatchObject({ isNew: true, baseline: null, newPatterns: 1 });
    expect(r.patterns.find((p) => p.service === 'payments')!.isNew).toBe(true);
    expect(r.newPatterns).toBe(0);
  });

  it('does not claim anything is new when the baseline runs have no per-application snapshot', async () => {
    const r = await insights({ baselinePatterns: [{ scope: '', pattern_key: 'old' }], baselineServices: [] });
    expect(r.services.every((s) => s.isNew === null && s.newPatterns === null)).toBe(true);
    expect(r.patterns.find((p) => p.service === 'payments')!.isNew).toBeNull();
    expect(r.newPatterns).toBe(1);
  });
});

describe('LokiService run summary', () => {
  // Value: protects=a level panel holding only (none) yields no error rate, never the per-application fallback, and a workload with no enabled panel is unconfigured; fails_when=the levelMissing guard is dropped so errorRateFromServices reports a rate the lines cannot support, or disabled panels count; why_new=runSummary itself had no test; seam=none; no_claim=the SQL (mocked query runner and repositories)
  const RUN = { testRunId: 'run-1', systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load', startTime: new Date('2026-11-27T10:00:00Z'), endTime: new Date('2026-11-27T11:00:00Z') };
  const LEVEL_PANEL = {
    lokiConfigId: CFG, applicationDashboardId: 'dash', metricsSourceId: 'ms', panelId: 1, dashboardLabel: 'Loki logs',
    panelTitle: 'Log lines by level', logql: '$entities', splitBy: 'detected_level', aggregation: 'count', metricUnit: 'short', enabled: true,
  };

  function setup(queries: unknown[]) {
    const b = build();
    b.testRunRepo.findOne.mockResolvedValue(RUN);
    b.queryRepo.find.mockResolvedValue(queries as never);
    b.mappingRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => [{ id: 'm1', lokiConfigId: CFG, level: 'sut', selector: '{app="shop"}', matchers: [{ label: 'app', op: '=', value: 'shop' }], labels: [] }]),
    });
    b.configRepo.find.mockResolvedValue([{ id: CFG, organizationId: ORG_A, datasourceUid: 'loki', levelLabel: 'detected_level', levelParser: 'none', serviceLabel: 'service_name', label: 'logs', grafanaInstance: grafana }] as never);
    b.dataSource.manager.query.mockImplementation((async (sql: string) => {
      if (sql.includes('FROM test_runs WHERE test_run_id = $1')) return [{ start_time: RUN.startTime, end_time: RUN.endTime }];
      if (sql.includes('FROM ds_metrics')) return [{ test_run_id: 'run-1', application_dashboard_id: 'dash', panel_id: 1, metric_name: '(none)', mean: 100, max_value: 120, total: 6000 }];
      if (sql.includes('to_regclass')) return [{ patterns: true, services: true }];
      if (sql.includes('FROM loki_run_services WHERE test_run_id = $1')) return [{ service: 'checkout', total: '1000', errors: '50', warns: '0', loki_config_id: CFG }];
      return [];
    }) as never);
    return b;
  }

  it('shows no error rate when the level label is on none of the lines, even with a per-application snapshot', async () => {
    const summary = await setup([LEVEL_PANEL]).service.runSummary('run-1', 'u', []);
    expect(summary).toMatchObject({ configured: true, levelLabelMissing: true, errorRate: null });
    expect((summary as { panels: Array<{ isLevelPanel: boolean; series: Array<{ total: number | null }> }> }).panels[0])
      .toMatchObject({ isLevelPanel: true, series: [{ name: '(none)', total: 6000 }] });
  });

  it('reads the panels over the whole run, bounded by its window, never the ramp-up-excluded statistics', async () => {
    // Value: protects=the card shows the full test run everywhere; fails_when=the panels go back to ds_metric_statistics (ramp-up excluded) or the ds_metrics read loses its time bound; why_new=full-run card; seam=none; no_claim=the SQL against Postgres (mocked)
    const b = setup([LEVEL_PANEL]);
    await b.service.runSummary('run-1', 'u', []);
    const sqls = b.dataSource.manager.query.mock.calls.map((c) => [c[0] as string, c[1] as unknown[]] as const);
    expect(sqls.some(([q]) => q.includes('ds_metric_statistics'))).toBe(false);
    const read = sqls.find(([q]) => q.includes('FROM ds_metrics'))!;
    expect(read[0]).toMatch(/time >= \$3::timestamptz AND time <= \$4::timestamptz/);
    expect(read[1]).toEqual(['run-1', ['dash'], new Date('2026-11-27T09:00:00Z'), new Date('2026-11-27T12:00:00Z')]);
  });

  it('reads no ds_metrics at all for a run with no start time', async () => {
    // Value: protects=a run without a window never sends an unbounded ds_metrics read (it would lock every chunk); fails_when=the start_time guard is removed and the read goes out with no time predicate; why_new=review finding; seam=none; no_claim=Postgres locking itself
    const b = setup([LEVEL_PANEL]);
    const base = b.dataSource.manager.query.getMockImplementation()!;
    b.dataSource.manager.query.mockImplementation((async (sql: string, params?: unknown[]) =>
      sql.includes('FROM test_runs WHERE test_run_id = $1') ? [{ start_time: null, end_time: null }] : base(sql, params)) as never);
    await b.service.runSummary('run-1', 'u', []);
    expect(b.dataSource.manager.query.mock.calls.some((c) => String(c[0]).includes('FROM ds_metrics'))).toBe(false);
  });

  it('links the header to every stream of the connection when the selectors combine, and to nothing when they do not', async () => {
    // Value: protects=the header Explore link spans all streams of the first connection (mergeMappings), null when they cannot combine; fails_when=it reverts to sources[0] or ignores the merge result; why_new=only the web side read exploreUrl; seam=none; no_claim=multi-connection runs
    const withMappings = (rows: Array<Array<[string, string]>>) => {
      const b = setup([LEVEL_PANEL]);
      b.mappingRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => rows.map((pairs, i) => ({
          id: `m${i}`, lokiConfigId: CFG, level: 'sut', selector: '', matchers: pairs.map(([label, value]) => ({ label, op: '=', value })), labels: [],
        }))),
      });
      return b.service.runSummary('run-1', 'u', []) as Promise<{ exploreUrl: string | null }>;
    };
    const exprOf = (url: string | null) => JSON.parse(new URL(url!).searchParams.get('panes')!).a.queries[0].expr as string;
    expect(exprOf((await withMappings([[['service_name', 'be']], [['service_name', 'fe']]])).exploreUrl)).toBe('{service_name=~"be|fe"}');
    expect((await withMappings([[['ns', 'a'], ['app', 'x']], [['ns', 'b'], ['app', 'y']]])).exploreUrl).toBeNull();
  });

  it('reportSummary serves the report job (no user) and authorizes a preview (a user) like the card', async () => {
    // Value: protects=a background-generated report gets the Loki summary while a user-carried preview stays access-checked; fails_when=the userId guard is dropped (every generated report section 404s) or inverted (a preview skips authorization); why_new=Loki report section; seam=none; no_claim=the report request's own authorization
    const job = setup([LEVEL_PANEL]);
    await expect(job.service.reportSummary('run-1', '', [])).resolves.toMatchObject({ configured: true });
    expect(job.authz.canAccessResource).not.toHaveBeenCalled();

    const denied = setup([LEVEL_PANEL]);
    denied.authz.canAccessResource.mockResolvedValue({ allowed: false });
    await expect(denied.service.reportSummary('run-1', 'u', [])).rejects.toThrow('Test run not found');
  });

  it('is unconfigured when every panel of the workload is disabled', async () => {
    await expect(setup([{ ...LEVEL_PANEL, enabled: false }]).service.runSummary('run-1', 'u', [])).resolves.toEqual({ configured: false });
  });
});

describe('LokiService panel Explore links', () => {
  // Value: protects=a panel's Explore link queries the streams on screen: every stream on All, the application's own stream (or a label filter) on its tab; fails_when=the link goes back to the first stream, or ignores the selected application; why_new=per-application panel links; seam=none; no_claim=Explore itself
  const query = { lokiConfigId: CFG, logql: '$entities', aggregation: 'count', splitBy: 'detected_level' };
  const config = { id: CFG, datasourceUid: 'loki', serviceLabel: 'service_name', grafanaInstance: grafana };
  const mapping = (v: string) => ({ lokiConfigId: CFG, matchers: [{ label: 'service_name', op: '=', value: v }], labels: [] });
  const exprOf = (url: string | null) => JSON.parse(new URL(url!).searchParams.get('panes')!).a.queries[0].expr as string;
  const link = (mappings: unknown[], service?: string) => (build().service as unknown as { panelExploreLink: (...a: unknown[]) => string | null })
    .panelExploreLink(query, config, mappings, 'run-1', new Date(0), new Date(60_000), service);

  it('takes every stream on All, and the application\'s own stream on its tab', () => {
    const both = [mapping('be'), mapping('fe')];
    expect(exprOf(link(both))).toBe('sum by (detected_level) (count_over_time({service_name=~"be|fe"} [60s]))');
    expect(exprOf(link(both, 'be'))).toBe('sum by (detected_level) (count_over_time({service_name="be"} [60s]))');
  });

  it('narrows by a label filter when the application has no stream of its own', () => {
    const one = [{ lokiConfigId: CFG, matchers: [{ label: 'namespace', op: '=', value: 'shop' }], labels: [] }];
    expect(exprOf(link(one, 'be'))).toBe('sum by (detected_level) (count_over_time({namespace="shop"} | service_name="be" [60s]))');
    expect(exprOf(link(one, '(none)'))).toBe('sum by (detected_level) (count_over_time({namespace="shop"} | service_name="" [60s]))');
  });
});

describe('LokiService baseline resolution', () => {
  // Value: protects=which runs every "vs baseline" figure on the Loki card compares against; fails_when=a pinned run outside the workload is accepted, or the default stops preferring the control group; why_new=resolveBaseline is new; seam=none; no_claim=the SQL itself (mocked query runner)
  const RUN = { testRunId: 'run-9', systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load' };
  type Resolved = { kind: string; testRunIds: string[]; errorRateRunIds: string[] };
  function resolve(param: string | undefined, opts: { group?: boolean; previous?: string[]; pinned?: boolean } = {}) {
    const { service, dataSource, testRunRepo } = build();
    dataSource.manager.query.mockImplementation((async (sql: string) => {
      if (sql.includes('control-group:for-run')) {
        return opts.group ? [{ control_group_id: 'g', test_runs: ['a', 'b', 'run-9', 'c', 'd', 'e', 'f'], n_test_runs: 7, first_datetime: null, last_datetime: null }] : [];
      }
      if (sql.includes('FROM test_runs')) return (opts.previous ?? []).map((test_run_id) => ({ test_run_id }));
      return [];
    }) as never);
    testRunRepo.findOne.mockResolvedValue(opts.pinned ? { testRunId: 'run-5' } : null);
    const call = (service as unknown as { resolveBaseline: (r: unknown, s: Date | null, p?: string) => Promise<Resolved> })
      .resolveBaseline(RUN, new Date(1000), param);
    return { call, testRunRepo };
  }

  it('defaults to the control group: all its other runs for the error rate, its newest 5 for patterns', async () => {
    const { call } = resolve(undefined, { group: true });
    expect(await call).toEqual({ kind: 'control-group', testRunIds: ['b', 'c', 'd', 'e', 'f'], errorRateRunIds: ['a', 'b', 'c', 'd', 'e', 'f'] });
  });

  it('falls back to the previous runs only when nothing was picked', async () => {
    expect(await resolve(undefined, { previous: ['p1', 'p2'] }).call).toMatchObject({ kind: 'previous-runs', testRunIds: ['p1', 'p2'] });
    expect(await resolve('control-group', { previous: ['p1'] }).call).toMatchObject({ kind: 'none', testRunIds: [] });
  });

  it('takes a pinned run only from the same workload', async () => {
    const { call, testRunRepo } = resolve('run-5', { pinned: true, group: true });
    expect(await call).toMatchObject({ kind: 'run', testRunIds: ['run-5'], errorRateRunIds: ['run-5'] });
    expect(testRunRepo.findOne).toHaveBeenCalledWith({ where: { testRunId: 'run-5', systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load' } });
  });

  it('refuses a pinned run it cannot find in the workload, and the run itself', async () => {
    await expect(resolve('elsewhere').call).rejects.toThrow('Baseline run not found in this workload');
    await expect(resolve('run-9', { pinned: true }).call).rejects.toThrow('Baseline run not found in this workload');
  });

  it('averages the previous runs\' own error ratios, so a run with longer buckets does not weigh more', async () => {
    // Value: protects=the previous-runs baseline is the mean of each run's ratio; fails_when=per-bucket means are pooled across runs; why_new=only one-run baselines were tested; seam=none; no_claim=the SQL (mocked query runner)
    const { service, dataSource } = build();
    const rows = [
      // 1% errors over 100 lines
      { test_run_id: 'p1', metric_name: 'error', total: 1 }, { test_run_id: 'p1', metric_name: 'info', total: 99 },
      // 3% errors over 200 lines
      { test_run_id: 'p2', metric_name: 'error', total: 6 }, { test_run_id: 'p2', metric_name: 'info', total: 194 },
    ];
    const reads: unknown[] = [];
    dataSource.manager.query.mockImplementation((async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM test_runs WHERE test_run_id = $1')) return [{ start_time: new Date('2026-11-01T10:00:00Z'), end_time: new Date('2026-11-01T11:00:00Z') }];
      // One bounded read per baseline run, never one ANY() over the whole group.
      if (sql.includes('FROM ds_metrics')) { reads.push(params[0]); return rows.filter((r) => r.test_run_id === params[0]); }
      return [];
    }) as never);
    const panels = [{ isLevelPanel: true, panelId: 1, applicationDashboardId: 'dash', metricsSourceId: null, series: [{ name: 'info', total: 100, mean: 1 }] }];
    const rate = await (service as unknown as { errorRate: (...a: unknown[]) => Promise<{ baseline: { errorRatePct: number; runs: number } | null }> })
      .errorRate('run-9', panels, { kind: 'previous-runs', testRunIds: ['p1', 'p2'], errorRateRunIds: ['p1', 'p2'] });
    // Mean of 1% and 3%; pooling would give 7/300 = 2.33%.
    expect(rate.baseline!.errorRatePct).toBeCloseTo(2, 10);
    expect(rate.baseline!.runs).toBe(2);
    expect(reads).toEqual(['p1', 'p2']);
  });

  it('compares the error rate with a pinned run\'s own level panel, pooled per level', async () => {
    const { service, dataSource } = build();
    const sqls: string[] = [];
    dataSource.manager.query.mockImplementation((async (sql: string) => {
      sqls.push(sql);
      if (sql.includes('FROM test_runs WHERE test_run_id = $1')) return [{ start_time: new Date('2026-11-01T10:00:00Z'), end_time: null }];
      if (sql.includes('FROM ds_metrics')) {
        return [
          { test_run_id: 'run-5', metric_name: 'error', total: 2 },
          { test_run_id: 'run-5', metric_name: 'info', total: 98 },
        ];
      }
      return [];
    }) as never);
    const panels = [{
      isLevelPanel: true, panelId: 1, applicationDashboardId: 'dash', metricsSourceId: null,
      series: [{ name: 'error', total: 10, mean: 1 }, { name: 'info', total: 990, mean: 99 }],
    }];
    const rate = await (service as unknown as { errorRate: (...a: unknown[]) => Promise<{ errorRatePct: number; baseline: { errorRatePct: number; runs: number } | null }> })
      .errorRate('run-9', panels, { kind: 'run', testRunIds: ['run-5'], errorRateRunIds: ['run-5'] });
    expect(rate.errorRatePct).toBe(1);
    expect(rate.baseline).toEqual({ errorRatePct: 2, runs: 1 });
    expect(sqls.some((q) => q.includes('ds_control_group_statistics'))).toBe(false);
  });
});

describe('LokiService label cache and synthetic dashboards', () => {
  // Value: protects=the label cache stays bounded and a Loki dashboard never hangs off a real Grafana dashboard that shares its uid; fails_when=the cap or the sweep is removed, or a real loki-* row is reused; why_new=both are review fixes; seam=none; no_claim=the SQL against Postgres (mocked)
  it('keeps at most 500 label lookups, oldest first out', async () => {
    const { service } = build();
    const cached = (service as unknown as { cached: (k: string, r: boolean, l: () => Promise<string[]>) => Promise<string[]> }).cached.bind(service);
    for (let i = 0; i < 600; i++) await cached(`cfg:values:l${i}`, false, async () => [`v${i}`]);
    const cache = (service as unknown as { labelCache: Map<string, unknown> }).labelCache;
    expect(cache.size).toBe(500);
    expect(cache.has('cfg:values:l0')).toBe(false);
    expect(cache.has('cfg:values:l599')).toBe(true);
  });

  it('takes a uid of its own when a real Grafana dashboard already holds its uid', async () => {
    const { service, dataSource } = build();
    const sqls: Array<{ sql: string; params: unknown[] }> = [];
    dataSource.manager.query.mockImplementation((async (sql: string, params: unknown[] = []) => {
      sqls.push({ sql, params });
      if (sql.includes('FROM application_dashboards WHERE id')) return [];
      // A real (synced) dashboard holds perfana-loki-reads; nothing holds the suffixed uid yet.
      if (sql.includes('FROM grafana_dashboards WHERE uid')) return params[0] === 'perfana-loki-reads' ? [{ id: 'real', synthetic: false }] : [];
      if (sql.includes('INSERT INTO grafana_dashboards')) return [{ id: 'synthetic' }];
      return [];
    }) as never);
    const ensure = (service as unknown as { ensureArtificialDashboard: (...a: unknown[]) => Promise<unknown> }).ensureArtificialDashboard.bind(service);
    await ensure({ id: SUT, organization_id: ORG_A, team_id: null }, { systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load' }, 'Reads', { id: CFG, grafanaInstanceId: GI, label: 'logs' }).catch(() => undefined);
    const insert = sqls.find((q) => q.sql.includes('INSERT INTO grafana_dashboards'))!;
    expect(insert.params[2]).toMatch(/^perfana-loki-reads-[0-9a-f]{8}$/);
    const app = sqls.find((q) => q.sql.includes('INSERT INTO application_dashboards'))!;
    expect(app.params[3]).toBe('synthetic');
    expect(app.params[5]).toBe(insert.params[2]);
  });
});


describe('mergeLevelLines', () => {
  // Value: protects=an application's levels add up over its connections, and a pre-1841 snapshot reads as null (card falls back); fails_when=one connection's counts win, or all-null rows give {} so the card shows no levels; why_new=helper untested; seam=none; no_claim=the jsonb_agg SQL
  it.each([
    ['no rows', undefined, null],
    ['only pre-1841 rows', [null, null], null],
    ['one connection', [{ info: 5 }], { info: 5 }],
    ['two connections, one pre-1841', [{ info: 5, error: 1 }, null, { info: 2, warn: 3 }], { info: 7, error: 1, warn: 3 }],
    ['a non-numeric count is skipped, a numeric string counts', [{ info: 'x' as unknown as number, error: '2' as unknown as number }], { error: 2 }],
  ])('%s', (_name, rows, expected) => {
    expect(mergeLevelLines(rows as never)).toEqual(expected);
  });
});

describe('LokiService.runPanelLinks', () => {
  // Value: protects=GET /loki/runs/:id/panel-links checks the run's system before building links, and narrows each enabled panel to the app; fails_when=the loadSut check is dropped, a missing run is not 404, or disabled panels/service are ignored; why_new=route untested; seam=none; no_claim=controller validation
  const RUN = { testRunId: 'run-1', systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load', startTime: new Date('2026-11-27T10:00:00Z'), endTime: new Date('2026-11-27T11:00:00Z') };
  const panel = (panelId: number, enabled = true) => ({ lokiConfigId: CFG, panelId, panelTitle: `P${panelId}`, logql: '$entities', splitBy: 'detected_level', aggregation: 'count', enabled });
  function setup(opts: { run?: unknown; canAccess?: boolean } = {}) {
    const b = build({ canAccess: opts.canAccess });
    b.testRunRepo.findOne.mockResolvedValue(('run' in opts ? opts.run : RUN) as never);
    b.queryRepo.find.mockResolvedValue([panel(1), panel(2, false)] as never);
    b.mappingRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => [
        { id: 'm1', lokiConfigId: CFG, level: 'workload', matchers: [{ label: 'service_name', op: '=', value: 'be' }], labels: [] },
        { id: 'm2', lokiConfigId: CFG, level: 'workload', matchers: [{ label: 'service_name', op: '=', value: 'fe' }], labels: [] },
      ]),
    });
    b.configRepo.find.mockResolvedValue([{ id: CFG, organizationId: ORG_A, datasourceUid: 'loki', serviceLabel: 'service_name', grafanaInstance: grafana }] as never);
    return b;
  }
  const exprOf = (url: string | null) => JSON.parse(new URL(url!).searchParams.get('panes')!).a.queries[0].expr as string;

  it("gives every enabled panel the application's own stream", async () => {
    const links = await setup().service.runPanelLinks('run-1', 'fe', 'u', []);
    expect(links.map((l) => [l.panelId, l.title])).toEqual([[1, 'P1']]);
    expect(exprOf(links[0]!.link)).toBe('sum by (detected_level) (count_over_time({service_name="fe"} [60s]))');
  });

  it('answers 404 for a missing run and for a run whose system the caller cannot read, before reading any panel', async () => {
    const missing = setup({ run: null });
    await expect(missing.service.runPanelLinks('run-x', 'fe', 'u', [])).rejects.toBeInstanceOf(NotFoundException);
    const hidden = setup({ canAccess: false });
    await expect(hidden.service.runPanelLinks('run-1', 'fe', 'u', [])).rejects.toBeInstanceOf(NotFoundException);
    expect(hidden.queryRepo.find).not.toHaveBeenCalled();
  });
});

describe('LokiService run insights: levels and pattern links', () => {
  // Value: protects=services carry their merged level_lines, and a sampled pattern links with a regex (|~) while a patterns-API one keeps |>; fails_when=levels is dropped from the mapping, or every pattern link uses |> (never matches a sampled shape); why_new=both are new in runInsights; seam=none; no_claim=Explore's parsing
  it('maps levels per application and picks the line filter by pattern source', async () => {
    const { service, dataSource } = build();
    dataSource.manager.query.mockImplementation((async (sql: string) => {
      if (sql.includes('to_regclass')) return [{ patterns: true, services: true }];
      if (sql.includes('FROM loki_run_patterns WHERE test_run_id = $1')) {
        return [
          { loki_config_id: CFG, pattern: 'db timeout <_> ms', pattern_key: 'a', level: 'error', count: '9', first_seen: null, last_seen: null, source: 'sampled', service: null },
          { loki_config_id: CFG, pattern: 'pay <_>', pattern_key: 'b', level: 'error', count: '4', first_seen: null, last_seen: null, source: 'patterns', service: null },
        ];
      }
      if (sql.includes('FROM loki_run_services WHERE test_run_id = $1')) {
        return [
          { service: 'be', total: '10', errors: '1', warns: '0', loki_config_id: CFG, levels: [{ info: 6, error: 1 }, { info: 3 }] },
          { service: 'fe', total: '5', errors: '0', warns: '0', loki_config_id: CFG, levels: [null] },
        ];
      }
      return [];
    }) as never);
    const configById = new Map([[CFG, { id: CFG, datasourceUid: 'loki', serviceLabel: 'service_name', grafanaInstance: grafana }]]);
    const mappings = [{ lokiConfigId: CFG, matchers: [{ label: 'namespace', op: '=', value: 'shop' }], labels: [] }];
    const r = await (service as unknown as { runInsights: (...a: unknown[]) => Promise<{
      patterns: Array<{ source: string; exploreUrl: string | null }>;
      services: Array<{ service: string; levels: Record<string, number> | null }>;
    }> }).runInsights('run-1', configById, new Date(0), new Date(60_000), mappings, []);
    expect(Object.fromEntries(r.services.map((s) => [s.service, s.levels]))).toEqual({ be: { info: 9, error: 1 }, fe: null });
    const exprOf = (url: string | null) => JSON.parse(new URL(url!).searchParams.get('panes')!).a.queries[0].expr as string;
    expect(exprOf(r.patterns.find((p) => p.source === 'sampled')!.exploreUrl)).toBe('{namespace="shop"} |~ "(?s)db\\\\s+timeout.*?ms"');
    expect(exprOf(r.patterns.find((p) => p.source === 'patterns')!.exploreUrl)).toBe('{namespace="shop"} |> "pay <_>"');
  });

  it("links an application row to its own stream, else every stream narrowed by a label filter, and (none) to service_name=\"\"", async () => {
    // Value: protects=application row links find that app's lines: own stream, else merged streams + label filter, (none) as label=""; fails_when=narrowing goes back to the first stream only, or (none) gets no link/filter; why_new=only panel links covered this; seam=none; no_claim=Explore
    const { service, dataSource } = build();
    dataSource.manager.query.mockImplementation((async (sql: string) => {
      if (sql.includes('to_regclass')) return [{ patterns: true, services: true }];
      if (sql.includes('FROM loki_run_services WHERE test_run_id = $1')) {
        return ['be', 'checkout', '(none)'].map((svc, i) => ({ service: svc, total: String(10 + i), errors: '0', warns: '0', loki_config_id: CFG, levels: null }));
      }
      return [];
    }) as never);
    const configById = new Map([[CFG, { id: CFG, datasourceUid: 'loki', serviceLabel: 'service_name', grafanaInstance: grafana }]]);
    const mappings = ['be', 'fe'].map((v) => ({ lokiConfigId: CFG, matchers: [{ label: 'service_name', op: '=', value: v }], labels: [] }));
    const r = await (service as unknown as { runInsights: (...a: unknown[]) => Promise<{ services: Array<{ service: string; exploreUrl: string | null }> }> })
      .runInsights('run-1', configById, new Date(0), new Date(60_000), mappings, []);
    const exprOf = (url: string | null) => JSON.parse(new URL(url!).searchParams.get('panes')!).a.queries[0].expr as string;
    const linkOf = (svc: string) => exprOf(r.services.find((s) => s.service === svc)!.exploreUrl);
    expect(linkOf('be')).toBe('{service_name="be"}');
    expect(linkOf('checkout')).toBe('{service_name=~"be|fe"} | service_name="checkout"');
    expect(linkOf('(none)')).toBe('{service_name=~"be|fe"} | service_name=""');
  });
});
