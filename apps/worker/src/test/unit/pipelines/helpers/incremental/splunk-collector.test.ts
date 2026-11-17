import { describe, it, expect, vi, beforeEach } from 'vitest';

const splunkTimechart = vi.fn();
vi.mock('@perfana/shared/services/splunk/client', async (orig) => ({
  ...(await orig<typeof import('@perfana/shared/services/splunk/client')>()),
  splunkTimechart: (...args: unknown[]) => splunkTimechart(...args),
}));
vi.mock('../../../../../config/proxy-resolver.js', () => ({ resolveFetchProxyDispatcher: vi.fn(async () => undefined) }));

import { SplunkError } from '@perfana/shared/services/splunk/client';
import {
  SplunkCollector,
  SPLUNK_INGEST_LOOKBACK_MS,
  splunkBucketSeconds,
} from '../../../../../pipelines/helpers/incremental/splunk-collector.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

const QUERY = {
  id: 'q1', splunk_config_id: 'cfg', dashboard_label: 'Splunk logs', application_dashboard_id: 'ad1',
  metrics_source_id: 'ms1', dashboard_uid: 'splunk-splunk-logs', panel_title: 'Log events by level', panel_id: 1,
  spl: '$entities', split_by: 'log_level', aggregation: 'count', metric_unit: 'short', max_series: 20,
};
const CONFIG = {
  id: 'cfg', label: 'prod', host: 'https://s:8089', api_token: 'plain-token', username: null, password: null,
  splunk_app: 'search', use_proxy: false, organization_id: 'org', max_concurrent_searches: 2,
};
const MAPPING = { splunk_config_id: 'cfg', index_name: 'web', sourcetype: null, host_pattern: 'app-*', labels: [] };

function makeCollector(overrides: { queries?: unknown[]; mappings?: unknown[]; config?: unknown } = {}) {
  const db = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM splunk_queries')) return overrides.queries ?? [QUERY];
      if (sql.includes('FROM splunk_entity_mappings')) return overrides.mappings ?? [MAPPING];
      if (sql.includes('FROM splunk_configs')) return overrides.config === null ? [] : [overrides.config ?? CONFIG];
      return [];
    }),
  };
  const batchProcessor = {
    processSplunkDocuments: vi.fn(async (docs: Array<{ data: unknown[] }>) => ({
      totalRecords: docs.reduce((n, d) => n + d.data.length, 0), errors: [], maxDataTimestamp: undefined,
    })),
  };
  return { collector: new SplunkCollector(logger, db as never, batchProcessor as never), batchProcessor };
}

const liveRun = {
  testRunId: 'run-1', systemUnderTestId: 's', workload: 'w', testEnvironment: 'e',
  startTime: new Date('2026-11-17T10:00:00Z'), completed: false, organizationId: 'org',
};
const from = new Date('2026-11-17T10:30:00Z');
const to = new Date('2026-11-17T10:31:00Z');

beforeEach(() => {
  splunkTimechart.mockReset();
  splunkTimechart.mockResolvedValue([
    { time: new Date('2026-11-17T10:30:00Z'), series: 'ERROR', value: 2 },
    { time: new Date('2026-11-17T10:30:00Z'), series: 'OTHER', value: 0 },
  ]);
});

describe('SplunkCollector', () => {
  it('expands $entities, queries with the ingest lookback, and writes one document per panel', async () => {
    const { collector, batchProcessor } = makeCollector();
    const result = await collector.collect('run-1', liveRun, undefined, from, to);

    expect(result).toMatchObject({ success: true, dataPoints: 2 });
    const [conn, query] = splunkTimechart.mock.calls[0];
    expect(conn).toMatchObject({ host: 'https://s:8089', apiToken: 'plain-token' });
    expect(query.filter).toBe('(index="web" host="app-*")');
    expect(query.from.getTime()).toBe(from.getTime() - SPLUNK_INGEST_LOOKBACK_MS);
    const [docs] = batchProcessor.processSplunkDocuments.mock.calls[0];
    expect(docs[0]).toMatchObject({ applicationDashboardId: 'ad1', dashboardUid: 'splunk-splunk-logs', panelId: 1 });
    expect(docs[0].data.map((d: { metricName: string; value: number }) => [d.metricName, d.value])).toEqual([['ERROR', 2], ['OTHER', 0]]);
  });

  it('does not look back on a completed run', async () => {
    const { collector } = makeCollector();
    await collector.collect('run-1', { ...liveRun, completed: true }, undefined, from, to);
    expect(splunkTimechart.mock.calls[0][1].from.getTime()).toBe(from.getTime());
  });

  it('fails the range when a search fails, so it is retried rather than recorded as collected', async () => {
    splunkTimechart.mockRejectedValue(new SplunkError('Unknown search command'));
    const { collector } = makeCollector();
    const result = await collector.collect('run-1', liveRun, undefined, from, to);
    expect(result.success).toBe(false);
    expect(result.errors.join()).toContain('Unknown search command');
  });

  it('retries a concurrency refusal before giving up', async () => {
    vi.useFakeTimers();
    splunkTimechart
      .mockRejectedValueOnce(new SplunkError('maximum number of concurrent searches', 503, true))
      .mockResolvedValueOnce([]);
    const { collector } = makeCollector();
    const pending = collector.collect('run-1', liveRun, undefined, from, to);
    await vi.runAllTimersAsync();
    expect((await pending).success).toBe(true);
    expect(splunkTimechart).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('refuses a connection from another organization than the run', async () => {
    const { collector } = makeCollector({ config: { ...CONFIG, organization_id: 'other-org' } });
    const result = await collector.collect('run-1', liveRun, undefined, from, to);
    expect(result.success).toBe(false);
    expect(splunkTimechart).not.toHaveBeenCalled();
  });

  it('skips, without failing, a panel whose $entities resolves to nothing', async () => {
    const { collector } = makeCollector({ queries: [{ ...QUERY, spl: '$entities[db]' }] });
    const result = await collector.collect('run-1', liveRun, undefined, from, to);
    expect(result.success).toBe(true);
    expect(splunkTimechart).not.toHaveBeenCalled();
  });
});

describe('splunkBucketSeconds', () => {
  it('is never below 5 s and grows with the run', () => {
    const start = new Date('2026-11-17T10:00:00Z');
    expect(splunkBucketSeconds({ startTime: start, endTime: new Date('2026-11-17T10:10:00Z') }, to)).toBe(5);
    expect(splunkBucketSeconds({ startTime: start, endTime: new Date('2026-11-17T13:00:00Z') }, to)).toBe(15);
  });
});
