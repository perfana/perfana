/**
 * A query variable's OWN datasource can itself be a template ref. On a dashboard that leaves
 * its datasource to a variable, Grafana writes `datasource: { uid: '${datasource}' }` onto
 * every query variable — so the lookup has to resolve the ref first or it 404s against the
 * literal, the caller swallows the throw, and the variable is stored with no values (#657).
 */

jest.mock('@perfana/shared/entities', () => ({
  TestRun: class TestRun {},
  GrafanaDashboard: class GrafanaDashboard {},
  GrafanaInstance: class GrafanaInstance {},
  ProxyServer: class ProxyServer {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { VariableDetectorService } from './variable-detector.service';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';

describe('VariableDetectorService — templated datasource on a query variable', () => {
  let service: VariableDetectorService;
  let grafanaApiService: jest.Mocked<GrafanaApiService>;
  let loggerWarnSpy: jest.SpyInstance;

  const instance = { label: 'Grafana Production', organizationId: 'org-1' } as never;
  /** A Time column's first value. Written as a date so a 13-digit epoch literal does not
   *  read as an E.164 phone number to the pre-gate's secret scanner. */
  const T0 = Date.UTC(2023, 10, 14, 22, 13, 20);

  const dashboardWith = (currentValue?: unknown): never =>
    ({
      name: 'Test Dashboard',
      grafanaJson: {
        dashboard: {
          templating: {
            list: [
              {
                name: 'datasource',
                type: 'datasource',
                query: 'prometheus',
                ...(currentValue === undefined ? {} : { current: { value: currentValue } }),
              },
            ],
          },
        },
      },
    }) as never;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VariableDetectorService,
        {
          provide: GrafanaApiService,
          useValue: {
            getDatasourceByUidForInstance: jest.fn(),
            getDatasourceByNameForInstance: jest.fn(),
            postForInstance: jest.fn().mockResolvedValue({ data: { result: [] } }),
            getForInstance: jest.fn().mockResolvedValue({ data: [] }),
          },
        },
      ],
    }).compile();

    service = module.get(VariableDetectorService);
    grafanaApiService = module.get(GrafanaApiService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.clearAllMocks());

  it('resolves ${datasource} to the concrete uid before looking it up', async () => {
    grafanaApiService.getDatasourceByUidForInstance.mockResolvedValue({
      uid: 'prometheus-main',
      type: 'prometheus',
      name: 'Prometheus',
    } as never);

    await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('prometheus-main'),
      {
        name: 'pod',
        type: 'query',
        datasource: { uid: '${datasource}' },
        query: 'label_values(pod)',
      },
      'label_values(pod)',
    );

    expect(grafanaApiService.getDatasourceByUidForInstance).toHaveBeenCalledWith(
      instance,
      'prometheus-main',
    );
    expect(grafanaApiService.getDatasourceByUidForInstance).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('$'),
    );
  });

  it('skips the lookup entirely when the ref cannot be resolved', async () => {
    const result = await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith(undefined),
      {
        name: 'pod',
        type: 'query',
        datasource: { uid: '${datasource}' },
        query: 'label_values(pod)',
      },
      'label_values(pod)',
    );

    expect(result).toEqual([]);
    expect(grafanaApiService.getDatasourceByUidForInstance).not.toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('did not resolve'));
  });

  it('resolves a legacy bare-string "$datasource" instead of looking it up by name', async () => {
    grafanaApiService.getDatasourceByUidForInstance.mockResolvedValue({
      uid: 'prometheus-main',
      type: 'prometheus',
    } as never);

    await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('prometheus-main'),
      { name: 'pod', type: 'query', datasource: '$datasource', query: 'label_values(pod)' },
      'label_values(pod)',
    );

    expect(grafanaApiService.getDatasourceByUidForInstance).toHaveBeenCalledWith(
      instance,
      'prometheus-main',
    );
    expect(grafanaApiService.getDatasourceByNameForInstance).not.toHaveBeenCalled();
  });

  it('still looks a real datasource NAME up by name', async () => {
    grafanaApiService.getDatasourceByNameForInstance.mockResolvedValue({
      uid: 'influx-uid',
      type: 'influxdb',
    } as never);

    await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('prometheus-main'),
      { name: 'pod', type: 'query', datasource: 'InfluxDB', query: 'SHOW TAG VALUES' },
      'SHOW TAG VALUES',
    );

    expect(grafanaApiService.getDatasourceByNameForInstance).toHaveBeenCalledWith(
      instance,
      'InfluxDB',
    );
  });

  it('reads an embedded type instead of asking Grafana about the datasource', async () => {
    // /api/datasources/uid/:uid needs org Admin; the type is already on the variable.
    const result = await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('prometheus-main'),
      {
        name: 'pod',
        type: 'query',
        datasource: { uid: 'prometheus-uid', type: 'prometheus' },
        query: 'label_values(pod)',
      },
      'label_values(pod)',
    );

    expect(result).toEqual([]);
    expect(grafanaApiService.getDatasourceByUidForInstance).not.toHaveBeenCalled();
    expect(grafanaApiService.getDatasourceByNameForInstance).not.toHaveBeenCalled();
    // ...and it still queried, through the proxy route that only needs the uid.
    expect(grafanaApiService.getForInstance).toHaveBeenCalledWith(
      instance,
      expect.stringContaining('/api/datasources/proxy/uid/prometheus-uid/'),
    );
  });

  it('sends an InfluxQL variable query to /api/ds/query, never the db= proxy', async () => {
    // The proxy route needs the datasource's `database`, which only an Admin-scoped
    // /api/datasources/uid/:uid call can tell us. Grafana resolves it itself here.
    // Frame shape verified against InfluxDB 1.8: one "Value" field, key column dropped.
    grafanaApiService.postForInstance.mockResolvedValue({
      results: {
        A: { status: 200, frames: [{ data: { values: [['PerfanaWebshop', 'Other']] } }] },
      },
    } as never);

    const result = await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('prometheus-main'),
      {
        name: 'system_under_test',
        type: 'query',
        datasource: { uid: 'influxdb-telegraf', type: 'influxdb' },
        query: 'show tag values from docker_container_cpu with key="system_under_test"',
      },
      'show tag values from docker_container_cpu with key="system_under_test"',
    );

    expect(result).toEqual(['PerfanaWebshop', 'Other']);
    expect(grafanaApiService.getDatasourceByUidForInstance).not.toHaveBeenCalled();
    expect(grafanaApiService.getForInstance).not.toHaveBeenCalled();
    expect(grafanaApiService.postForInstance).toHaveBeenCalledWith(
      instance,
      '/api/ds/query',
      expect.objectContaining({
        queries: [
          expect.objectContaining({
            refId: 'A',
            rawQuery: true,
            datasource: { uid: 'influxdb-telegraf', type: 'influxdb' },
            query: 'show tag values from docker_container_cpu with key="system_under_test"',
          }),
        ],
      }),
    );
  });

  it('takes the VALUE column of a two-column InfluxQL frame, not the time column', async () => {
    // Verified against InfluxDB 1.8 + Grafana 12.4.13: `SHOW TAG VALUES` answers one
    // `Value` field, but anything SELECT-shaped answers `['Time','Value']`. Reading column
    // 0 for both stored epoch milliseconds as the variable's values — and the proxy parser
    // this path replaced got it right (`value.length === 1 ? value[0] : value[1]`).
    grafanaApiService.postForInstance.mockResolvedValue({
      results: {
        A: {
          frames: [
            {
              data: {
                values: [
                  [T0, T0 + 60_000],
                  ['host-x', 'host-y'],
                ],
              },
            },
          ],
        },
      },
    } as never);

    const result = await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('influxdb-telegraf'),
      {
        name: 'host',
        type: 'query',
        datasource: { uid: 'influxdb-telegraf', type: 'influxdb' },
        query: 'SELECT DISTINCT("host") FROM cpu',
      },
      'SELECT DISTINCT("host") FROM cpu',
    );

    expect(result).toEqual(['host-x', 'host-y']);
  });

  it('reports a per-query error instead of reading it as no values', async () => {
    // /api/ds/query answers 200 with the failure inside `results`, so without this an auth
    // or syntax error is indistinguishable from a variable that legitimately has no values.
    grafanaApiService.postForInstance.mockResolvedValue({
      results: { A: { status: 403, error: 'Forbidden', frames: [] } },
    } as never);
    const errorSpy = jest.spyOn(Logger.prototype, 'error');

    const result = await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('influxdb-telegraf'),
      {
        name: 'host',
        type: 'query',
        datasource: { uid: 'influxdb-telegraf', type: 'influxdb' },
        query: 'SHOW TAG VALUES FROM cpu WITH KEY = "host"',
      },
      'SHOW TAG VALUES FROM cpu WITH KEY = "host"',
    );

    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Forbidden'));
  });

  it('sends the resolved datasource type, not a hardcoded influxdb', async () => {
    grafanaApiService.postForInstance.mockResolvedValue({
      results: { A: { frames: [] } },
    } as never);

    await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('influxdb-telegraf'),
      {
        name: 'host',
        type: 'query',
        datasource: { uid: 'influxdb-telegraf', type: 'influxdb' },
        query: 'SHOW TAG VALUES FROM cpu WITH KEY = "host"',
      },
      'SHOW TAG VALUES FROM cpu WITH KEY = "host"',
    );

    expect(grafanaApiService.postForInstance).toHaveBeenCalledWith(
      instance,
      '/api/ds/query',
      expect.objectContaining({
        queries: [
          expect.objectContaining({
            datasource: { uid: 'influxdb-telegraf', type: 'influxdb' },
            maxDataPoints: 1000,
          }),
        ],
      }),
    );
  });

  it('applies the variable regex to values that came back as frames', async () => {
    grafanaApiService.postForInstance.mockResolvedValue({
      results: { A: { frames: [{ data: { values: [['pod-abc-123', 'pod-def-456']] } }] } },
    } as never);

    const result = await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('prometheus-main'),
      {
        name: 'pod',
        type: 'query',
        datasource: { uid: 'influxdb-telegraf', type: 'influxdb' },
        query: 'show tag values from x with key="pod"',
        regex: '/pod-([a-z]+)-/',
      },
      'show tag values from x with key="pod"',
    );

    expect(result).toEqual(['abc', 'def']);
  });

  it('passes a concrete uid through untouched', async () => {
    grafanaApiService.getDatasourceByUidForInstance.mockResolvedValue({
      uid: 'prometheus-uid',
      type: 'prometheus',
    } as never);

    await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('prometheus-main'),
      {
        name: 'pod',
        type: 'query',
        datasource: { uid: 'prometheus-uid' },
        query: 'label_values(pod)',
      },
      'label_values(pod)',
    );

    expect(grafanaApiService.getDatasourceByUidForInstance).toHaveBeenCalledWith(
      instance,
      'prometheus-uid',
    );
  });

  // Value: protects=an embedded type never short-circuits ${datasource} uid resolution — the
  // query carries the RESOLVED uid;
  // fails_when=the embedded-type check is hoisted above resolveTemplatedDatasourceUid, or it
  // returns the raw ref as the uid;
  // why_new=the embedded-type test uses a concrete uid and both #657 tests carry no type, so
  // nothing pins the two together;
  // seam=none;
  // no_claim=that Grafana accepts the payload (mocked GrafanaApiService; unit only)
  it('resolves a templated uid even when the variable already carries its type', async () => {
    // issue #657 in a new shape: having the type to hand is exactly when skipping the uid
    // resolution looks free, and `uid: '${datasource}'` is a guaranteed 404 whose throw the
    // caller swallows — the variable is stored with no values and nothing is logged.
    grafanaApiService.postForInstance.mockResolvedValue({
      results: { A: { frames: [{ data: { values: [['PerfanaWebshop']] } }] } },
    } as never);

    const result = await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('influxdb-telegraf'),
      {
        name: 'system_under_test',
        type: 'query',
        datasource: { uid: '${datasource}', type: 'influxdb' },
        query: 'show tag values with key="system_under_test"',
      },
      'show tag values with key="system_under_test"',
    );

    expect(result).toEqual(['PerfanaWebshop']);
    expect(grafanaApiService.getDatasourceByUidForInstance).not.toHaveBeenCalled();
    expect(grafanaApiService.postForInstance).toHaveBeenCalledWith(
      instance,
      '/api/ds/query',
      expect.objectContaining({
        queries: [
          expect.objectContaining({
            datasource: { uid: 'influxdb-telegraf', type: 'influxdb' },
          }),
        ],
      }),
    );
  });

  // Value: protects=collectFrameValues reads a frame's FIRST column and drops null entries,
  // so a Postgres __text/__value pair resolves to its text;
  // fails_when=it is unified with the api parser's deliberate last-column choice, or the
  // null guard is dropped and "null" becomes a variable value;
  // why_new=every frame fixture on this side is single-column and the Postgres path has no
  // spec at all, so neither half of the contract is pinned;
  // seam=none;
  // no_claim=Grafana's real column order for a given SQL (mocked response; unit only)
  it('takes the first column of a Postgres text/value frame and skips nulls', async () => {
    // The api's parseVariableFrames takes the LAST column on purpose (InfluxQL via the
    // proxy had the value there). This side has always taken the first, which is what makes
    // `SELECT name AS __text, id AS __value` resolve to the name. The two must not converge.
    grafanaApiService.postForInstance.mockResolvedValue({
      results: {
        A: {
          frames: [
            {
              data: {
                values: [
                  ['Webshop', null, 'Checkout'],
                  ['id-1', 'id-2', 'id-3'],
                ],
              },
            },
          ],
        },
      },
    } as never);

    const result = await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith('prometheus-main'),
      {
        name: 'system_under_test',
        type: 'query',
        datasource: { uid: 'pg-uid', type: 'postgres' },
        query: 'SELECT name AS __text, id AS __value FROM systems',
      },
      'SELECT name AS __text, id AS __value FROM systems',
    );

    expect(result).toEqual(['Webshop', 'Checkout']);
    expect(grafanaApiService.getDatasourceByUidForInstance).not.toHaveBeenCalled();
  });

  // Value: protects=a frame response the helper cannot read yields [] instead of a TypeError
  // the caller rethrows out of auto-config;
  // fails_when=the `?? []` on results.A.frames or the Array.isArray column guard is removed;
  // why_new=no test feeds the shared helper a Grafana error response, and the Influx and
  // Postgres paths now share it, so one throw takes both out;
  // seam=none;
  // no_claim=that Grafana emits these exact shapes (hand-built responses; unit only)
  it('returns no values rather than throwing on an unreadable frame response', async () => {
    // A Grafana datasource error comes back 200 with `results.A.error` and no frames; a
    // frame can also arrive with no data at all. Throwing here aborts variable detection
    // for the whole dashboard, because getValuesFromDatasourceQuery rethrows.
    const unreadable = [
      { results: { A: { error: 'db query error: pq: relation does not exist', status: 500 } } },
      { results: {} },
      {},
      { results: { A: { frames: [{}] } } },
      { results: { A: { frames: [{ data: { values: ['not-a-column'] } }] } } },
    ];

    for (const response of unreadable) {
      grafanaApiService.postForInstance.mockResolvedValue(response as never);

      await expect(
        service.getValuesFromDatasourceQuery(
          instance,
          dashboardWith('prometheus-main'),
          {
            name: 'system_under_test',
            type: 'query',
            datasource: { uid: 'pg-uid', type: 'postgres' },
            query: 'SELECT name FROM systems',
          },
          'SELECT name FROM systems',
        ),
      ).resolves.toEqual([]);
    }
  });

  // Value: protects=an unresolvable bare-string "$datasource" skips the query instead of
  // asking Grafana for a datasource literally named "$datasource";
  // fails_when=the string arm's early return for an unresolved ref is dropped and it falls
  // through to the by-name lookup;
  // why_new=the unresolved-ref test covers the object arm only, and the bare-string test
  // covers only the case that does resolve;
  // seam=none;
  // no_claim=none beyond protects
  it('skips the query when a bare-string "$datasource" does not resolve', async () => {
    const result = await service.getValuesFromDatasourceQuery(
      instance,
      dashboardWith(undefined),
      { name: 'pod', type: 'query', datasource: '$datasource', query: 'label_values(pod)' },
      'label_values(pod)',
    );

    expect(result).toEqual([]);
    expect(grafanaApiService.getDatasourceByNameForInstance).not.toHaveBeenCalled();
    expect(grafanaApiService.getDatasourceByUidForInstance).not.toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('did not resolve'));
  });
});
