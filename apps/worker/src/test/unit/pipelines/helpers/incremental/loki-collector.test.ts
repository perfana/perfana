import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.mock('../../../../../config/proxy-resolver.js', () => ({ resolveFetchProxyDispatcher: vi.fn(async () => undefined) }));

import { LokiCollector, LOKI_INGEST_LOOKBACK_MS } from '../../../../../pipelines/helpers/incremental/loki-collector.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

const QUERY = {
  id: 'q1', loki_config_id: 'cfg', dashboard_label: 'Loki logs', application_dashboard_id: 'ad1',
  metrics_source_id: 'ms1', dashboard_uid: 'loki-loki-logs', panel_title: 'Log lines by level', panel_id: 1,
  logql: '$entities', split_by: 'detected_level', aggregation: 'count', metric_unit: 'short', max_series: 20,
};
const CONFIG = {
  id: 'cfg', label: 'logs', datasource_uid: 'loki-uid', level_label: 'detected_level', max_concurrent_queries: 2,
  organization_id: 'org', grafana_label: 'grafana', base_url: 'https://grafana.internal', grafana_org_id: '1',
  api_key: 'plain-key', username: null, password: null, use_proxy: false, grafana_organization_id: 'org',
};
const MAPPING = { loki_config_id: 'cfg', matchers: [{ label: 'namespace', op: '=', value: 'perf' }], labels: [] };

function makeCollector(overrides: { config?: unknown } = {}) {
  const db = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM loki_queries')) return [QUERY];
      if (sql.includes('FROM loki_stream_mappings')) return [MAPPING];
      if (sql.includes('FROM loki_configs')) return overrides.config === null ? [] : [overrides.config ?? CONFIG];
      return [];
    }),
  };
  const batchProcessor = {
    processLokiDocuments: vi.fn(async (docs: Array<{ data: unknown[] }>) => ({
      totalRecords: docs.reduce((n, d) => n + d.data.length, 0), errors: [], maxDataTimestamp: undefined,
    })),
  };
  return { collector: new LokiCollector(logger, db as never, batchProcessor as never), batchProcessor };
}

const liveRun = {
  testRunId: 'run-1', systemUnderTestId: 's', workload: 'w', testEnvironment: 'e',
  startTime: new Date('2026-11-17T10:00:00Z'), completed: false, organizationId: 'org', plannedDuration: 1800,
};
const from = new Date('2026-11-17T10:30:00Z');
const to = new Date('2026-11-17T10:31:00Z');

/** A Grafana 11 dataplane answer: one frame per series. */
function frames(series: Array<{ level: string; points: Array<[number, number]> }>) {
  return {
    results: {
      A: {
        status: 200,
        frames: series.map((s) => ({
          schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number', labels: { detected_level: s.level } }] },
          data: { values: [s.points.map((p) => p[0]), s.points.map((p) => p[1])] },
        })),
      },
    },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('LokiCollector', () => {
  it('queries through the Grafana instance with its credentials and writes one document per panel', async () => {
    const t = Date.parse('2026-11-17T10:30:00Z');
    fetchMock.mockResolvedValue(new Response(JSON.stringify(frames([{ level: 'error', points: [[t, 3]] }])), { status: 200 }));
    const { collector, batchProcessor } = makeCollector();
    const result = await collector.collect('run-1', liveRun, undefined, from, to);

    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://grafana.internal/api/ds/query');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer plain-key', 'X-Grafana-Org-Id': '1' });
    const body = JSON.parse(init.body);
    expect(body.queries[0].datasource).toEqual({ type: 'loki', uid: 'loki-uid' });
    expect(body.queries[0].expr).toMatch(/^sum by \(detected_level\) \(count_over_time\(\{namespace="perf"\} \[\d+s\]\)\)$/);
    // The live lookback widens the window behind the cursor.
    expect(Number(body.from)).toBeLessThanOrEqual(from.getTime() - LOKI_INGEST_LOOKBACK_MS + 60_000);
    const [docs] = batchProcessor.processLokiDocuments.mock.calls[0];
    expect(docs[0]).toMatchObject({ applicationDashboardId: 'ad1', dashboardUid: 'loki-loki-logs', panelId: 1 });
    expect(docs[0].data.some((d: { metricName: string; value: number }) => d.metricName === 'error' && d.value === 3)).toBe(true);
  });

  it('keeps the tick when one panel fails, but records the error', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ results: { A: { status: 400, error: 'parse error at line 1' } } }), { status: 200 }));
    const { collector } = makeCollector();
    const result = await collector.collect('run-1', liveRun, undefined, from, to);
    expect(result.success).toBe(true);
    expect(result.errors.join()).toContain('parse error');
  });

  it('fails closed on a connection of another organization, or a Grafana instance of another one', async () => {
    const a = await makeCollector({ config: { ...CONFIG, organization_id: 'other' } }).collector.collect('run-1', liveRun, undefined, from, to);
    expect(a.success).toBe(false);
    const b = await makeCollector({ config: { ...CONFIG, grafana_organization_id: 'other' } }).collector.collect('run-1', liveRun, undefined, from, to);
    expect(b.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails the tick when the connection is gone', async () => {
    const result = await makeCollector({ config: null }).collector.collect('run-1', liveRun, undefined, from, to);
    expect(result.success).toBe(false);
  });
});
