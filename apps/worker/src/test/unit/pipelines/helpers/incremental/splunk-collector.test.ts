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
    expect(query.filter).toBe('(index="web" host="app-*") | search (index="web" host="app-*")');
    expect(query.from.getTime()).toBe(from.getTime() - SPLUNK_INGEST_LOOKBACK_MS);
    const [docs] = batchProcessor.processSplunkDocuments.mock.calls[0];
    expect(docs[0]).toMatchObject({ applicationDashboardId: 'ad1', dashboardUid: 'splunk-splunk-logs', panelId: 1 });
    expect(docs[0].data.map((d: { metricName: string; value: number }) => [d.metricName, d.value])).toEqual([['ERROR', 2], ['OTHER', 0]]);
  });

  // Value: protects=a search that returned rows but no series is logged as a warning naming the split field;
  // fails_when=the collector stops reading onSearch's stats or drops the explanation; why_new=the info line was the
  // only trace and did not say why 485 rows produced nothing; seam=none; no_claim=the real Splunk row shape
  it('warns, naming the split field, when rows come back with no value column', async () => {
    (logger as unknown as { warn: ReturnType<typeof vi.fn> }).warn.mockClear();
    splunkTimechart.mockImplementation(async (_c: unknown, _q: unknown, opts: { onSearch?: (s: string, st: unknown, ms: number) => void }) => {
      opts.onSearch?.('search x', { lines: 485, finalRows: 485, previewRows: 0, usedPreview: false, rows: 485, columns: ['_time', '_span'] }, 1);
      return [];
    });
    const { collector } = makeCollector();
    await collector.collect('run-1', liveRun, undefined, from, to);
    const warned = (logger as unknown as { warn: ReturnType<typeof vi.fn> }).warn.mock.calls.map((c) => String(c[0]));
    expect(warned.some((m) => m.includes('485 rows with only the columns _time, _span'))).toBe(true);
  });

  it('does not look back on a completed run', async () => {
    const { collector } = makeCollector();
    await collector.collect('run-1', { ...liveRun, completed: true }, undefined, from, to);
    expect(splunkTimechart.mock.calls[0][1].from.getTime()).toBe(from.getTime());
  });

  it('keeps the tick when one panel fails and another collects, carrying the error', async () => {
    splunkTimechart
      .mockResolvedValueOnce([{ time: new Date('2026-11-17T10:30:00Z'), series: 'ERROR', value: 1 }])
      .mockRejectedValueOnce(new SplunkError('Unknown search command'));
    const { collector, batchProcessor } = makeCollector({ queries: [QUERY, { ...QUERY, id: 'q2', panel_id: 2, panel_title: 'p2' }] });
    const result = await collector.collect('run-1', liveRun, undefined, from, to);
    // A per-panel error must not fail the range: that would re-search the whole run every tick.
    expect(result.success).toBe(true);
    expect(result.errors.join()).toContain('Unknown search command');
    expect(batchProcessor.processSplunkDocuments.mock.calls[0][0]).toHaveLength(1);
  });

  it('fails the tick when the connection row is gone', async () => {
    const { collector } = makeCollector({ config: null });
    const result = await collector.collect('run-1', liveRun, undefined, from, to);
    expect(result.success).toBe(false);
    expect(splunkTimechart).not.toHaveBeenCalled();
  });

  it('refuses every connection for a run with no organization (fail closed)', async () => {
    const { collector } = makeCollector();
    const result = await collector.collect('run-1', { ...liveRun, organizationId: null }, undefined, from, to);
    expect(result.success).toBe(false);
    expect(splunkTimechart).not.toHaveBeenCalled();
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
  it('comes from planned_duration and does not move as a live run grows', () => {
    const start = new Date('2026-11-17T10:00:00Z');
    const planned = splunkBucketSeconds({ startTime: start, plannedDuration: 3 * 3600 });
    expect(planned).toBeGreaterThanOrEqual(5);
    // end_time is not an input: the keep-alive moves it on every post.
    expect(splunkBucketSeconds({ startTime: start, plannedDuration: 3 * 3600, endTime: new Date('2026-11-17T10:05:00Z') } as never)).toBe(planned);
    expect(splunkBucketSeconds({ startTime: start, plannedDuration: 3 * 3600, endTime: new Date('2026-11-17T13:00:00Z') } as never)).toBe(planned);
  });

  it('falls back to the tick fallback with no planned duration', () => {
    expect(splunkBucketSeconds({ startTime: new Date(), plannedDuration: null })).toBe(60);
  });
});
