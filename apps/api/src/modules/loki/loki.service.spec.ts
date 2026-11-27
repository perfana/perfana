import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LokiService, levelTotals } from './loki.service';
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
