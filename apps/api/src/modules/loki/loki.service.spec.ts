import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LokiService, describeLevelProbe, errorRateFromServices, levelLabelMissing, levelTotals } from './loki.service';
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
    expect(insert[1]).toEqual(expect.arrayContaining([GI, 'loki-loki-logs']));
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
      if (sql.includes('control-group:for-run')) return [{ control_group_id: 'g', test_runs: ['base-1', 'base-2'], n_test_runs: 2, first_datetime: null, last_datetime: null }];
      if (sql.includes('SELECT DISTINCT')) return rows.baselinePatterns;
      if (sql.includes('FROM loki_run_services WHERE test_run_id = ANY')) return rows.baselineServices;
      return [];
    }) as never);
    return (service as unknown as { runInsights: (...a: unknown[]) => Promise<{
      newPatterns: number | null;
      patterns: Array<{ service: string | null; isNew: boolean | null }>;
      services: Array<{ service: string; errorRatePct: number; baseline: { errorRatePct: number; runs: number } | null; isNew: boolean | null; newPatterns: number | null }>;
    }> }).runInsights('run-1', SUT, 'acc', 'load', new Map(), new Date(0), new Date(1000), []);
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
