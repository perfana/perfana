import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SplunkService } from './splunk.service';
import { Capability } from '../../constants/capabilities.constants';

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const SUT = '11111111-1111-1111-1111-111111111111';
const CFG = '22222222-2222-2222-2222-222222222222';

function repo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'new-id', createdAt: new Date(), updatedAt: new Date(), ...x })),
    findOne: jest.fn(),
    find: jest.fn(async () => []),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
    target: 'x',
  };
}

function build(opts: { canModify?: boolean; canAccess?: boolean; caps?: string[] } = {}) {
  const configRepo = repo();
  const mappingRepo = repo();
  const queryRepo = repo();
  const sutRepo = repo();
  const authz = {
    getAccessibleOrganizations: jest.fn(async () => [ORG_A]),
    isGlobalAdmin: jest.fn(() => false),
    getCapabilities: jest.fn(async () => opts.caps ?? Object.values(Capability)),
    canAccessResource: jest.fn(async () => ({ allowed: opts.canAccess ?? true })),
    canModifyResource: jest.fn(async () => ({ allowed: opts.canModify ?? true })),
  };
  const audit = { logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() };
  const proxy = { resolve: jest.fn(async () => null) };
  const testRunRepo = repo();
  const dataSource = { manager: { query: jest.fn(async () => [] as unknown[]) } };
  const service = new SplunkService(
    configRepo as never, mappingRepo as never, queryRepo as never, sutRepo as never,
    repo() as never, testRunRepo as never, dataSource as never,
    authz as never, audit as never, proxy as never,
  );
  sutRepo.findOne.mockResolvedValue({ id: SUT, organization_id: ORG_A, team_id: null });
  configRepo.findOne.mockResolvedValue({ id: CFG, organizationId: ORG_A, host: 'https://splunk.example.com:8089', apiToken: 't' });
  return { service, configRepo, mappingRepo, queryRepo, sutRepo, testRunRepo, dataSource, authz, audit };
}

const baseConfig = { label: 'prod', host: 'https://splunk.example.com:8089', apiToken: 'secret' };

describe('SplunkService configs', () => {
  it('masks credentials in every response', async () => {
    const { service } = build();
    const created = await service.createConfig({ ...baseConfig, password: 'pw', username: 'u' }, 'user', []);
    expect(created.apiToken).toBe('[MASKED]');
    expect(created.password).toBe('[MASKED]');
  });

  it('checks the capability in the organization the body names (RLS does not)', async () => {
    const { service, authz } = build({ caps: [] });
    await expect(service.createConfig({ ...baseConfig, organizationId: ORG_B }, 'user', [])).rejects.toBeInstanceOf(ForbiddenException);
    expect(authz.getCapabilities).toHaveBeenCalledWith('user', [], ORG_B);
  });

  it('refuses Splunk Web on port 8000 and a connection with no credentials', async () => {
    const { service } = build();
    await expect(service.createConfig({ ...baseConfig, host: 'https://splunk.example.com:8000' }, 'u', [])).rejects.toThrow('management port');
    await expect(service.createConfig({ label: 'x', host: 'https://splunk.example.com:8089' }, 'u', [])).rejects.toThrow('token');
  });

  it('leaves a credential alone when the client echoes the mask back', async () => {
    const { service, configRepo } = build();
    configRepo.findOne.mockResolvedValue({ id: CFG, organizationId: ORG_A, host: 'https://s:8089', apiToken: 'keep-me', label: 'x' });
    await service.updateConfig(CFG, { apiToken: '[MASKED]', label: 'renamed' }, 'u', []);
    expect(configRepo.save).toHaveBeenCalledWith(expect.objectContaining({ apiToken: 'keep-me', label: 'renamed' }));
  });

  it('refuses a host change that would carry the stored credentials to the new host', async () => {
    const { service, configRepo } = build();
    configRepo.findOne.mockResolvedValue({ id: CFG, organizationId: ORG_A, host: 'https://splunk.example.com:8089', apiToken: 'keep-me', label: 'x' });
    await expect(service.updateConfig(CFG, { host: 'https://evil.example.net:8089' }, 'u', [])).rejects.toThrow('entered again');
    await expect(service.updateConfig(CFG, { host: 'https://evil.example.net:8089', apiToken: '[MASKED]' }, 'u', [])).rejects.toThrow('entered again');
    await service.updateConfig(CFG, { host: 'https://splunk2.example.com:8089', apiToken: 'new' }, 'u', []);
    expect(configRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'https://splunk2.example.com:8089', apiToken: 'new' }));
  });

  it('requires integration:splunk:update to list what the token can see', async () => {
    const { service } = build({ caps: [] });
    await expect(service.discoverSources(CFG, 'u', [])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.testSavedConnection(CFG, 'u', [])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 404, not 403, for a connection outside the caller organizations', async () => {
    const { service } = build({ canAccess: false });
    await expect(service.getConfig(CFG, 'u', [])).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SplunkService mappings and queries', () => {
  it('needs write access on the system to preview, since a preview runs SPL with the org token', async () => {
    const { service } = build({ canModify: false, canAccess: true });
    await expect(
      service.previewQuery({ splunkConfigId: CFG, systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load', spl: '$entities' }, 'u', []),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to point a system at another organization\'s Splunk connection', async () => {
    const { service, configRepo } = build();
    configRepo.findOne.mockResolvedValue({ id: CFG, organizationId: ORG_B, host: 'https://s:8089', apiToken: 't' });
    await expect(
      service.createMapping({ splunkConfigId: CFG, systemUnderTestId: SUT, level: 'sut', indexName: 'web' }, 'u', []),
    ).rejects.toThrow('another organization');
  });

  it('inherits the organization from the system and nulls the scope a level does not use', async () => {
    const { service, mappingRepo } = build();
    await service.createMapping(
      { splunkConfigId: CFG, systemUnderTestId: SUT, level: 'environment', testEnvironment: 'acc', workload: 'ignored', indexName: ' web ' },
      'u', [],
    );
    expect(mappingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_A, testEnvironment: 'acc', workload: null, indexName: 'web' }),
    );
  });

  it('requires the environment for an environment-level mapping', async () => {
    const { service } = build();
    await expect(
      service.createMapping({ splunkConfigId: CFG, systemUnderTestId: SUT, level: 'environment', indexName: 'web' }, 'u', []),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is a 403 for a system the caller can read but not change', async () => {
    const { service } = build({ canModify: false, canAccess: true });
    await expect(
      service.createMapping({ splunkConfigId: CFG, systemUnderTestId: SUT, level: 'sut', indexName: 'web' }, 'u', []),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['$entities | timechart count', 'timechart'],
    ['$entities earliest=-1h', 'earliest'],
    ['$entities | outputlookup foo', 'outputlookup'],
    ['index=_audit', '$entities'],
    ['$entities [search index=_audit]', 'Subsearches'],
  ])('rejects SPL that Perfana owns or that writes: %s', async (spl, word) => {
    const { service } = build();
    await expect(
      service.createQuery({ splunkConfigId: CFG, systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load', panelTitle: 'p', panelId: 1, spl }, 'u', []),
    ).rejects.toThrow(word);
  });
});

describe('SplunkService listPanelTitles', () => {
  function qb(rows: Array<{ panelTitle: string; metricUnit: string }>) {
    const b: Record<string, jest.Mock> = {};
    for (const m of ['select', 'addSelect', 'orderBy', 'addOrderBy', 'where']) b[m] = jest.fn(() => b);
    b.getRawMany = jest.fn(async () => rows);
    return b;
  }

  it('merges the starter panels with the titles in the caller organizations, scoped and sorted', async () => {
    const { service, queryRepo } = build();
    const b = qb([{ panelTitle: 'Slow requests', metricUnit: 'ms' }, { panelTitle: 'Errors by host', metricUnit: 'none' }]);
    queryRepo.createQueryBuilder.mockReturnValue(b);

    const titles = await service.listPanelTitles('u', []);

    expect(b.where).toHaveBeenCalledWith('q.organization_id IN (:...orgIds)', { orgIds: [ORG_A] });
    expect(titles).toEqual([
      { panelTitle: 'Errors by host', metricUnit: 'none' },
      { panelTitle: 'Exceptions by type', metricUnit: 'short' },
      { panelTitle: 'Log events by level', metricUnit: 'short' },
      { panelTitle: 'Slow requests', metricUnit: 'ms' },
    ]);
  });

  it('returns only the starter panels for a caller with no organization, without querying', async () => {
    const { service, queryRepo, authz } = build();
    authz.getAccessibleOrganizations.mockResolvedValue([]);

    const titles = await service.listPanelTitles('u', []);

    expect(queryRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(titles.map((t) => t.panelTitle)).toEqual(['Errors by host', 'Exceptions by type', 'Log events by level']);
  });
});

describe('SplunkService runSummary', () => {
  const run = {
    testRunId: 'run-1', systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load',
    startTime: new Date('2026-11-17T10:00:00Z'), endTime: new Date('2026-11-17T10:10:00Z'),
  };
  const query = {
    id: 'q1', splunkConfigId: CFG, applicationDashboardId: 'ad-1', panelId: 1, panelTitle: 'Log events by level',
    spl: '$entities', splitBy: 'log_level', aggregation: 'count', metricUnit: 'short', maxSeries: 20, enabled: true,
  };

  function withMappings(ctx: ReturnType<typeof build>) {
    ctx.mappingRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => [{ splunkConfigId: CFG, level: 'environment', indexName: 'app', hostPattern: 'be-*', labels: [] }]),
    });
  }

  it('reports not configured when the workload has no enabled panel, so the card hides', async () => {
    const ctx = build();
    ctx.testRunRepo.findOne.mockResolvedValue(run);
    ctx.queryRepo.find.mockResolvedValue([{ ...query, enabled: false }]);
    await expect(ctx.service.runSummary('run-1', 'u', [])).resolves.toEqual({ configured: false });
  });

  it('is a 404 for a run whose system the caller cannot see', async () => {
    const ctx = build({ canAccess: false });
    ctx.testRunRepo.findOne.mockResolvedValue(run);
    await expect(ctx.service.runSummary('run-1', 'u', [])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('turns per-bucket means into event totals and links to the run window in Splunk Web', async () => {
    const ctx = build();
    withMappings(ctx);
    ctx.testRunRepo.findOne.mockResolvedValue(run);
    ctx.queryRepo.find.mockResolvedValue([query]);
    ctx.configRepo.find.mockResolvedValue([{ id: CFG, label: 'prod', host: 'https://s:8089', clientUrl: 'https://splunk.web', splunkApp: 'search' }]);
    ctx.dataSource.manager.query.mockResolvedValue([
      { application_dashboard_id: 'ad-1', panel_id: 1, metric_name: 'ERROR', mean: 1.5, max_value: 7, count: 100 },
      { application_dashboard_id: 'ad-1', panel_id: 1, metric_name: 'INFO', mean: 32, max_value: 77, count: 100 },
    ]);
    const summary = await ctx.service.runSummary('run-1', 'u', []);
    if (!summary.configured) throw new Error('expected configured');
    expect(summary.panels[0]!.series).toEqual([
      { name: 'INFO', mean: 32, peak: 77, total: 3200 },
      { name: 'ERROR', mean: 1.5, peak: 7, total: 150 },
    ]);
    const url = new URL(summary.openInSplunk!);
    expect(url.origin + url.pathname).toBe('https://splunk.web/en-US/app/search/search');
    expect(url.searchParams.get('earliest')).toBe(String(run.startTime.getTime() / 1000));
    expect(url.searchParams.get('q')).toBe('search (index="app" host="be-*")');
    expect(new URL(summary.panels[0]!.link!).searchParams.get('q')).toContain('| timechart span=60s count by log_level');
    // Value: protects=the per-panel Open-in-Splunk link carries the run window as time-picker params and not
    // inline in q; fails_when=bounds reappear in q (doubled or conflicting with the picker) or the panel link loses
    // its earliest/latest params; why_new=the case above pinned only the system link's earliest and the panel q's
    // timechart tail; seam=none; no_claim=does not check the latest param's ceil on a fractional end time
    const panelLink = new URL(summary.panels[0]!.link!);
    expect(panelLink.searchParams.get('q')).not.toMatch(/earliest|latest/);
    expect(panelLink.searchParams.get('earliest')).toBe(String(Math.floor(run.startTime.getTime() / 1000)));
    expect(panelLink.searchParams.get('latest')).toBe(String(Math.ceil(run.endTime.getTime() / 1000)));
  });

  it('names the dashboard each panel is stored under, so the card can open it in Graphs', async () => {
    // protects: GET /splunk/runs/:id/summary returns each panel's dashboardLabel from its query row
    // fails_when: the field is dropped or taken from the wrong source, so the card's Open in Graphs/Compare/Trends links carry dashboard=undefined
    // seam: none
    // kind: unit
    // no_claim: does not check the label matches a real application_dashboards row
    const ctx = build();
    withMappings(ctx);
    ctx.testRunRepo.findOne.mockResolvedValue(run);
    ctx.queryRepo.find.mockResolvedValue([{ ...query, dashboardLabel: 'Splunk logs' }]);
    ctx.configRepo.find.mockResolvedValue([{ id: CFG, label: 'prod', host: 'https://s:8089', splunkApp: 'search' }]);
    ctx.dataSource.manager.query.mockResolvedValue([]);
    const summary = await ctx.service.runSummary('run-1', 'u', []);
    if (!summary.configured) throw new Error('expected configured');
    expect(summary.panels[0]).toMatchObject({ panelId: 1, dashboardLabel: 'Splunk logs' });
  });
});

describe('SplunkService review regressions', () => {
  it('clears every cached discovery of a connection when it is updated or deleted', async () => {
    const { service } = build();
    const cache = (service as unknown as { discoveryCache: Map<string, unknown> }).discoveryCache;
    cache.set(`${CFG}:24`, { at: Date.now(), sources: [] });
    cache.set(`${CFG}:168`, { at: Date.now(), sources: [] });
    cache.set('other:24', { at: Date.now(), sources: [] });
    await service.updateConfig(CFG, { label: 'renamed' }, 'u', []);
    expect([...cache.keys()]).toEqual(['other:24']);
  });

  it('answers 404, not a skip count, for a mapping the caller cannot write', async () => {
    const { service, mappingRepo } = build({ canModify: false, canAccess: false });
    mappingRepo.findOne.mockResolvedValue({ id: 'm1', systemUnderTestId: SUT, level: 'sut' });
    await expect(
      service.copyMappings({ mappingIds: ['m1'], targetEnvironment: 'prod' } as never, 'u', []),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts a labelled $entities reference in a saved query', async () => {
    const { service } = build();
    expect(() => (service as unknown as { checkSpl(s: string): void }).checkSpl('$entities[backend] level=ERROR')).not.toThrow();
  });
});
