import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../config/proxy-resolver.js', () => ({ resolveFetchProxyDispatcher: vi.fn(async () => undefined) }));

import { mergePatterns, selectPatterns, snapshotLokiInsights, LOKI_TOP_PATTERNS } from '../../../../pipelines/helpers/loki-insights.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

const CONFIG = {
  id: 'cfg', label: 'logs', datasource_uid: 'loki-uid', level_label: 'detected_level', max_concurrent_queries: 2,
  organization_id: 'org', grafana_label: 'grafana', base_url: 'https://grafana.internal', grafana_org_id: '1',
  api_key: 'k', username: null, password: null, use_proxy: false, grafana_organization_id: 'org',
};
const run = {
  testRunId: 'run-1', systemUnderTestId: 'sut', testEnvironment: 'acc', workload: 'load',
  startTime: new Date('2026-11-27T10:00:00Z'), endTime: new Date('2026-11-27T11:00:00Z'), organizationId: 'org', teamId: null,
};

function makeDb() {
  const tx = { query: vi.fn(async () => []) };
  const db = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return [{ present: true }];
      if (sql.includes('FROM loki_queries')) return [{ loki_config_id: 'cfg' }];
      if (sql.includes('FROM loki_stream_mappings')) return [{ loki_config_id: 'cfg', matchers: [{ label: 'app', op: '=', value: 'shop' }], labels: [] }];
      if (sql.includes('FROM loki_configs')) return [CONFIG];
      return [];
    }),
    dataSource: { query: vi.fn(async (sql: string) => (sql.includes('to_regclass') ? [{ present: true }] : [{ loki_config_id: 'cfg' }])) },
    transaction: vi.fn(async (fn: (em: unknown) => Promise<unknown>) => fn(tx)),
  };
  return { db, tx };
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const emptyLogs = () => json({ results: { A: { frames: [] } } });

describe('mergePatterns / selectPatterns', () => {
  it('adds the same pattern from two mappings', () => {
    const p = (count: number) => ({ pattern: '<_> boom <_>', level: 'error', count, firstSeen: null, lastSeen: null });
    expect(mergePatterns([[p(2)], [p(3)]])).toEqual([expect.objectContaining({ count: 5 })]);
  });

  it('keeps the busiest error patterns even when info lines dominate', () => {
    const info = Array.from({ length: LOKI_TOP_PATTERNS + 5 }, (_, i) => ({ pattern: `info ${i}`, level: 'info', count: 1000 - i, firstSeen: null, lastSeen: null }));
    const err = { pattern: 'rare error', level: 'error', count: 1, firstSeen: null, lastSeen: null };
    const picked = selectPatterns([...info, err]);
    expect(picked).toHaveLength(LOKI_TOP_PATTERNS + 1);
    expect(picked.at(-1)).toBe(err);
  });
});

describe('snapshotLokiInsights', () => {
  it('stores patterns from the patterns API and the newest error lines', async () => {
    const t = run.startTime.getTime();
    fetchMock.mockImplementation(async (url: string, init: { body?: string }) => {
      if (url.includes('/resources/patterns')) {
        return json({ status: 'success', data: [{ pattern: '<_> level=error db timeout', level: 'error', samples: [[t / 1000 + 60, 7]] }] });
      }
      const expr = JSON.parse(init.body ?? '{}').queries?.[0]?.expr ?? '';
      if (expr.includes('error|err')) {
        return json({ results: { A: { frames: [{
          schema: { fields: [{ name: 'labels', type: 'other' }, { name: 'Time', type: 'time' }, { name: 'Line', type: 'string' }] },
          data: { values: [[{ detected_level: 'error' }], [t + 5000], ['db timeout']] },
        }] } } });
      }
      return emptyLogs();
    });
    const { db, tx } = makeDb();
    const result = await snapshotLokiInsights(db as never, logger, run);
    expect(result).toMatchObject({ patterns: 1, samples: 1, source: 'patterns', errors: [] });
    const sqls = tx.query.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toContain('DELETE FROM loki_run_patterns');
    expect(sqls.some((s) => s.includes('INSERT INTO loki_run_patterns'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO loki_run_samples'))).toBe(true);
  });

  it('leaves the stored snapshot alone when Loki no longer holds the window', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/resources/patterns') ? json({ status: 'success', data: [] }) : emptyLogs()));
    const { db, tx } = makeDb();
    const result = await snapshotLokiInsights(db as never, logger, run);
    expect(result.patterns).toBe(0);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(tx.query).not.toHaveBeenCalled();
  });

  it('clusters sampled lines when the patterns API is not available', async () => {
    const t = run.startTime.getTime();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/resources/patterns')) return new Response('{"message":"not found"}', { status: 404 });
      return json({ results: { A: { frames: [{
        schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Line', type: 'string' }] },
        data: { values: [[t + 1000, t + 2000], ['ERROR order 1 failed', 'ERROR order 22 failed']] },
      }] } } });
    });
    const { db } = makeDb();
    const result = await snapshotLokiInsights(db as never, logger, run);
    expect(result.source).toBe('sampled');
    expect(result.patterns).toBeGreaterThan(0);
  });
});
