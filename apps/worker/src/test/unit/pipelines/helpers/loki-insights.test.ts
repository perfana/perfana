import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../config/proxy-resolver.js', () => ({ resolveFetchProxyDispatcher: vi.fn(async () => undefined) }));

import { mergePatterns, pickServices, selectPatterns, serviceTotalsFrom, snapshotLokiInsights, LOKI_TOP_PATTERNS } from '../../../../pipelines/helpers/loki-insights.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

const CONFIG = {
  id: 'cfg', label: 'logs', datasource_uid: 'loki-uid', level_label: 'detected_level', level_parser: 'none', service_label: 'service_name', max_concurrent_queries: 2,
  organization_id: 'org', grafana_label: 'grafana', base_url: 'https://grafana.internal', grafana_org_id: '1',
  api_key: 'k', username: null, password: null, use_proxy: false, grafana_organization_id: 'org',
};
const run = {
  testRunId: 'run-1', systemUnderTestId: 'sut', testEnvironment: 'acc', workload: 'load',
  startTime: new Date('2026-11-27T10:00:00Z'), endTime: new Date('2026-11-27T11:00:00Z'), organizationId: 'org', teamId: null,
};

function makeDb(opts: { services?: boolean; config?: Partial<typeof CONFIG>; stored?: boolean } = {}) {
  const tx = { query: vi.fn(async () => []) };
  const db = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return [{ patterns: true, services: opts.services ?? false }];
      if (sql.includes('FROM loki_queries')) return [{ loki_config_id: 'cfg' }];
      if (sql.includes('FROM loki_stream_mappings')) return [{ loki_config_id: 'cfg', matchers: [{ label: 'app', op: '=', value: 'shop' }], labels: [] }];
      if (sql.includes('FROM loki_configs')) return [{ ...CONFIG, ...opts.config }];
      if (sql.includes('AS present')) return [{ present: opts.stored ?? false }];
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

  it('keeps the stored snapshot when part of a re-analysis fails, and cuts a parsed level to the column', async () => {
    // Value: protects=a partial Loki failure never replaces an earlier snapshot, and a long free-text level cannot fail the write; fails_when=the replace runs with errors present, or level is written uncut; why_new=both are review fixes; seam=none; no_claim=the SQL against Postgres (mocked db)
    const t = run.startTime.getTime();
    const longLevel = 'x'.repeat(80);
    fetchMock.mockImplementation(async (url: string, init: { body?: string }) => {
      // The error-line query answers; every other query fails.
      if (url.includes('/resources/patterns')) return json({ status: 'success', data: [] });
      const expr = JSON.parse(init.body ?? '{}').queries?.[0]?.expr ?? '';
      if (expr.includes('error|err')) {
        return json({ results: { A: { frames: [{
          schema: { fields: [{ name: 'labels', type: 'other' }, { name: 'Time', type: 'time' }, { name: 'Line', type: 'string' }] },
          data: { values: [[{ detected_level: longLevel }], [t + 5000], ['db timeout']] },
        }] } } });
      }
      return new Response('boom', { status: 500 });
    });
    const kept = makeDb({ stored: true });
    const partial = await snapshotLokiInsights(kept.db as never, logger, run);
    expect(partial.errors.length).toBeGreaterThan(0);
    expect(kept.db.transaction).not.toHaveBeenCalled();

    // Nothing stored yet: the partial snapshot is written, its level cut to varchar(50).
    const fresh = makeDb({ stored: false });
    await snapshotLokiInsights(fresh.db as never, logger, run);
    const sample = fresh.tx.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO loki_run_samples')) as unknown as [string, unknown[]] | undefined;
    expect(sample).toBeDefined();
    expect(String(sample![1][4]).length).toBeLessThanOrEqual(50);
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

describe('per-application snapshot', () => {
  const t = run.startTime.getTime();
  const svcFrames = (rows: Array<{ svc: string; level: string; n: number }>) => json({ results: { A: { frames: rows.map((r) => ({
    schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number', labels: { service_name: r.svc, detected_level: r.level } }] },
    data: { values: [[t + 60_000], [r.n]] },
  })) } } });

  it('sums lines per service and level, and picks the applications with most errors first', () => {
    const totals = serviceTotalsFrom([
      { labels: { service_name: 'a', detected_level: 'error' }, points: [{ value: 2 }, { value: 3 }] },
      { labels: { service_name: 'a', detected_level: 'info' }, points: [{ value: 95 }] },
      { labels: { service_name: 'b', detected_level: 'info' }, points: [{ value: 500 }] },
      { labels: { detected_level: 'error' }, points: [{ value: 9 }] },
    ], 'service_name', 'detected_level');
    expect(totals.get('a')).toEqual({ service: 'a', total: 100, errors: 5, warns: 0 });
    expect(pickServices([...totals.values()]).map((s) => s.service)).toEqual(['a', 'b']);
  });

  it('stores lines per application, and its own patterns and lines', async () => {
    fetchMock.mockImplementation(async (url: string, init: { body?: string }) => {
      if (url.includes('/resources/patterns')) {
        const scoped = decodeURIComponent(url).includes('service_name="checkout"');
        return json({ status: 'success', data: [{ pattern: scoped ? 'checkout boom <_>' : 'all boom <_>', level: 'error', samples: [[t / 1000 + 60, 3]] }] });
      }
      const expr = JSON.parse(init.body ?? '{}').queries?.[0]?.expr ?? '';
      if (expr.startsWith('sum by (service_name, detected_level)')) return svcFrames([{ svc: 'checkout', level: 'error', n: 4 }, { svc: 'checkout', level: 'info', n: 96 }]);
      if (expr.includes('service_name="checkout"') && expr.includes('error|err')) {
        return json({ results: { A: { frames: [{
          schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Line', type: 'string' }] },
          data: { values: [[t + 5000], ['checkout boom 1']] },
        }] } } });
      }
      return emptyLogs();
    });
    const { db, tx } = makeDb({ services: true });
    const result = await snapshotLokiInsights(db as never, logger, run);
    expect(result).toMatchObject({ services: 1, errors: [] });
    const calls = tx.query.mock.calls.map((c) => [String(c[0]), c[1] as unknown[]]);
    expect(calls.some(([sql]) => (sql as string).includes('DELETE FROM loki_run_services'))).toBe(true);
    const svc = calls.find(([sql]) => (sql as string).includes('INSERT INTO loki_run_services'))!;
    expect(svc[1]).toEqual(expect.arrayContaining(['checkout', 100, 4, 0]));
    const patterns = calls.filter(([sql]) => (sql as string).includes('INSERT INTO loki_run_patterns')).map(([, v]) => v as unknown[]);
    expect(patterns.map((v) => [v[3], v.at(-1)])).toEqual([['all boom <_>', null], ['checkout boom <_>', 'checkout']]);
    const samples = calls.filter(([sql]) => (sql as string).includes('INSERT INTO loki_run_samples')).map(([, v]) => v as unknown[]);
    expect(samples.map((v) => [v[5], v.at(-1)])).toEqual([['checkout boom 1', 'checkout']]);
  });

  it('writes no service column before migration 1839', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/resources/patterns')
      ? json({ status: 'success', data: [{ pattern: 'x <_>', level: 'error', samples: [[t / 1000 + 60, 1]] }] })
      : emptyLogs()));
    const { db, tx } = makeDb({ services: false });
    await snapshotLokiInsights(db as never, logger, run);
    const sqls = tx.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((q) => q.includes('loki_run_services'))).toBe(false);
    expect(sqls.filter((q) => q.includes('INSERT INTO loki_run_patterns')).every((q) => !q.includes('service'))).toBe(true);
  });

  it('puts the connection\'s level parser in front of every level filter and grouping', async () => {
    const exprs: string[] = [];
    fetchMock.mockImplementation(async (url: string, init: { body?: string }) => {
      if (url.includes('/resources/patterns')) return json({ status: 'success', data: [] });
      exprs.push(JSON.parse(init.body ?? '{}').queries?.[0]?.expr ?? '');
      return emptyLogs();
    });
    const { db } = makeDb({ services: true, config: { level_parser: 'json', level_label: 'level' } });
    await snapshotLokiInsights(db as never, logger, run);
    const levelExprs = exprs.filter((e) => /\blevel\b/.test(e));
    expect(levelExprs.length).toBeGreaterThan(0);
    for (const e of levelExprs.filter((x) => x.includes('level=~'))) expect(e).toMatch(/\| json \| level=~/);
    expect(exprs.find((e) => e.startsWith('sum by (service_name, level)'))).toMatch(/\{app="shop"\} \| json \[\d+s\]/);
  });
});
