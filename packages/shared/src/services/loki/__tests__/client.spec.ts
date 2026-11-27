import {
  buildMetricExpr,
  buildStreamSelector,
  labelFilter,
  serviceLevelExpr,
  withStreamMatcher,
  clusterLogLines,
  framesToLogLines,
  framesToSeries,
  levelOfLine,
  lineShape,
  lokiAuthHeader,
  lokiExploreUrl,
  lokiPanelPoints,
  lokiPatterns,
  LokiError,
  normalizeLevel,
  parseAggregation,
  selectMappings,
  validateLogqlPipeline,
  validateMatchers,
  type LokiConnection,
} from '../client';
import { grafanaAuthHeader } from '../../grafana/auth';

const conn: LokiConnection = { baseUrl: 'https://grafana.example.com/', apiKey: 'k', datasourceUid: 'loki', grafanaOrgId: '2' };
const shop = { matchers: [{ label: 'app', op: '=' as const, value: 'shop' }], labels: ['backend'] };
const db = { matchers: [{ label: 'app', op: '=' as const, value: 'db' }], labels: ['db'] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function seriesFrame(labels: Record<string, string>, points: Array<[number, number]>) {
  return {
    schema: { fields: [{ name: 'Time', type: 'time' }, { name: 'Value', type: 'number', labels }] },
    data: { values: [points.map((p) => p[0]), points.map((p) => p[1])] },
  };
}

describe('lokiAuthHeader', () => {
  it('agrees with grafanaAuthHeader, the one rule for Grafana credentials', () => {
    for (const creds of [{ apiKey: ' t \n' }, { username: 'u', password: ' p ' }, { username: 'u' }, {}, { apiKey: '', username: 'u', password: 'p' }]) {
      expect(lokiAuthHeader(creds)).toBe(grafanaAuthHeader(creds));
    }
  });
});

describe('validateMatchers / buildStreamSelector', () => {
  it('escapes values, so a value cannot close the selector', () => {
    expect(buildStreamSelector([{ label: 'app', op: '=', value: 'a"} or {x="y' }])).toBe('{app="a\\"} or {x=\\"y"}');
  });

  it('refuses a selector that selects every stream, as Loki does', () => {
    expect(validateMatchers([{ label: 'app', op: '=~', value: '.*' }])).toMatch(/at least one matcher/i);
    expect(validateMatchers([{ label: 'app', op: '!=', value: 'x' }])).toMatch(/at least one matcher/i);
    expect(validateMatchers([{ label: 'app', op: '=~', value: '.+' }])).toBeNull();
  });

  it('refuses invalid label names and regexes', () => {
    expect(validateMatchers([{ label: 'bad-name', op: '=', value: 'x' }])).toMatch(/label name/);
    expect(validateMatchers([{ label: 'app', op: '=~', value: '(' }])).toMatch(/regex/);
    expect(validateMatchers([])).toMatch(/at least one/);
  });
});

describe('validateLogqlPipeline', () => {
  it('accepts $entities with pipeline stages, quoted and raw strings', () => {
    for (const q of [
      '$entities',
      '$entities[backend] |= "ERROR"',
      '$entities | json | level=~"error|warn" | line_format "{{.msg}} [x] {y}"',
      '$entities |~ `(?i)exception` != "healthcheck"',
      '$entities | logfmt | (status >= 500 or level="error")',
      '$entities | perfana_test_run_id = $testRunId',
    ]) {
      expect(validateLogqlPipeline(q)).toBeNull();
    }
  });

  it('refuses anything that would read another stream or set its own range or aggregation', () => {
    expect(validateLogqlPipeline('{app="other"}')).toMatch(/must start with \$entities/);
    expect(validateLogqlPipeline('$entities or {app="other"}')).toMatch(/pipeline stages/);
    expect(validateLogqlPipeline('$entities | json {app="x"}')).toMatch(/Stream selectors/);
    expect(validateLogqlPipeline('$entities | json [5m]')).toMatch(/range/);
    expect(validateLogqlPipeline('$entities | unwrap latency')).toMatch(/unwrap/);
    expect(validateLogqlPipeline('$entities | json) or vector(1')).toMatch(/parenthes/);
    expect(validateLogqlPipeline('$entities |= "x" # comment')).toMatch(/Comments/);
    expect(validateLogqlPipeline('$entities |= "$entities"')).toMatch(/outside a quoted string/);
  });
});

describe('buildMetricExpr', () => {
  it('wraps the mapped selector and pipeline in Perfana\'s aggregation and range', () => {
    expect(buildMetricExpr(shop, { logql: '$entities |= "ERROR"', splitBy: 'level', bucketSeconds: 60 }))
      .toBe('sum by (level) (count_over_time({app="shop"} |= "ERROR" [60s]))');
    expect(buildMetricExpr(shop, { logql: '$entities', bucketSeconds: 30, aggregation: 'bytes' }))
      .toBe('sum(bytes_over_time({app="shop"} [30s]))');
    expect(buildMetricExpr(shop, { logql: '$entities | json', bucketSeconds: 60, aggregation: 'p95(duration_ms)', splitBy: 'route' }))
      .toBe('quantile_over_time(0.95, {app="shop"} | json | unwrap duration_ms | __error__="" [60s]) by (route)');
    expect(buildMetricExpr(shop, { logql: '$entities | json', bucketSeconds: 60, aggregation: 'avg(ms)' }))
      .toBe('avg_over_time({app="shop"} | json | unwrap ms | __error__="" [60s]) by ()');
  });

  it('substitutes $testRunId as an escaped string literal', () => {
    expect(buildMetricExpr(shop, { logql: '$entities | run = $testRunId', bucketSeconds: 60, testRunId: 'a"b' }))
      .toContain('| run = "a\\"b"');
  });

  it('refuses an unknown aggregation and an invalid split label', () => {
    expect(() => parseAggregation('stddev(x)')).toThrow(LokiError);
    expect(() => buildMetricExpr(shop, { logql: '$entities', bucketSeconds: 60, splitBy: 'a-b' })).toThrow(/split-by/);
  });
});

describe('selectMappings', () => {
  it('keeps only the mappings carrying the $entities tag', () => {
    expect(selectMappings('$entities[db] |= "x"', [shop, db])).toEqual([db]);
    expect(selectMappings('$entities', [shop, db])).toEqual([shop, db]);
  });
});

describe('framesToSeries / framesToLogLines', () => {
  it('reads one dataplane frame per series and skips null values', () => {
    const s = framesToSeries([seriesFrame({ level: 'error' }, [[1000, 2], [2000, null as unknown as number]])]);
    expect(s).toEqual([{ labels: { level: 'error' }, points: [{ time: new Date(1000), value: 2 }] }]);
  });

  it('reads log frames in the Grafana 10+ and older field spellings', () => {
    const lines = framesToLogLines([
      { schema: { fields: [{ name: 'labels', type: 'other' }, { name: 'Time', type: 'time' }, { name: 'Line', type: 'string' }] },
        data: { values: [[{ app: 'shop' }], [5000], ['boom']] } },
      { schema: { fields: [{ name: 'ts', type: 'time' }, { name: 'line', type: 'string' }, { name: '__labels', type: 'string' }] },
        data: { values: [[6000], ['bang'], ['{"app":"db"}']] } },
    ]);
    expect(lines.map((l) => [l.line, l.labels.app])).toEqual([['bang', 'db'], ['boom', 'shop']]);
  });
});

describe('lokiPanelPoints', () => {
  const from = new Date('2026-11-27T10:00:00Z');
  const to = new Date('2026-11-27T10:03:00Z');
  const t = (m: number) => Date.parse('2026-11-27T10:00:00Z') + m * 60_000;

  it('sums one series across mappings, moves samples to the bucket start, and zero-fills counts', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ results: { A: { frames: [seriesFrame({ level: 'error' }, [[t(1), 2]])] } } }))
      .mockResolvedValueOnce(jsonResponse({ results: { A: { frames: [seriesFrame({ level: 'error' }, [[t(1), 3]])] } } }));
    const r = await lokiPanelPoints(conn, { logql: '$entities', splitBy: 'level', panelTitle: 'x' }, [shop, db], from, to, 60, undefined, { fetchImpl });
    expect(r.exprs).toHaveLength(2);
    const byTime = Object.fromEntries(r.points.map((p) => [p.time.toISOString(), p.value]));
    expect(byTime).toEqual({
      '2026-11-27T10:00:00.000Z': 5,
      '2026-11-27T10:01:00.000Z': 0,
      '2026-11-27T10:02:00.000Z': 0,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://grafana.example.com/api/ds/query');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer k', 'X-Grafana-Org-Id': '2' });
    expect(JSON.parse(init.body).queries[0]).toMatchObject({ datasource: { type: 'loki', uid: 'loki' }, queryType: 'range', step: '60s' });
  });

  it('keeps avg series apart per mapping, since averages do not add', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ results: { A: { frames: [seriesFrame({}, [[t(1), 10]])] } } }))
      .mockResolvedValueOnce(jsonResponse({ results: { A: { frames: [seriesFrame({}, [[t(1), 20]])] } } }));
    const r = await lokiPanelPoints(conn, { logql: '$entities | json', aggregation: 'avg(ms)', panelTitle: 'Latency' }, [shop, db], from, to, 60, undefined, { fetchImpl });
    expect([...new Set(r.points.map((p) => p.series))].sort()).toEqual(['Latency [app="db"]', 'Latency [app="shop"]']);
  });

  it('caps series and folds the rest into OTHER for counts', async () => {
    const frames = ['a', 'b', 'c'].map((lvl, i) => seriesFrame({ level: lvl }, [[t(1), 10 - i]]));
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ results: { A: { frames } } }));
    const r = await lokiPanelPoints(conn, { logql: '$entities', splitBy: 'level', panelTitle: 'x', maxSeries: 2 }, [shop], from, to, 60, undefined, { fetchImpl });
    const totals: Record<string, number> = {};
    for (const p of r.points) totals[p.series] = (totals[p.series] ?? 0) + p.value;
    expect(totals).toEqual({ a: 10, b: 9, OTHER: 8 });
    expect(r.seriesBeforeCap).toBe(3);
  });

  it('turns a query error inside a 200 into a LokiError, marking load refusals retryable', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ results: { A: { status: 429, error: 'too many outstanding requests' } } }));
    await expect(lokiPanelPoints(conn, { logql: '$entities', panelTitle: 'x' }, [shop], from, to, 60, undefined, { fetchImpl }))
      .rejects.toMatchObject({ name: 'LokiError', retryable: true });
  });
});

describe('lokiPatterns', () => {
  it('sums samples inside the window and reads the level when Loki gives one', async () => {
    const start = new Date('2026-11-27T10:00:00Z');
    const end = new Date('2026-11-27T11:00:00Z');
    const s = start.getTime() / 1000;
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
      status: 'success',
      data: [
        { pattern: '<_> level=error msg="db timeout <_>"', level: 'error', samples: [[s + 60, 4], [s + 120, 1]] },
        { pattern: '<_> GET /health <_>', samples: [[s + 60, 0]] },
      ],
    }));
    const ps = await lokiPatterns(conn, '{app="shop"}', start, end, 60, { fetchImpl });
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ level: 'error', count: 5 });
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/api/datasources/uid/loki/resources/patterns?query=%7Bapp%3D%22shop%22%7D');
  });
});

describe('levels and the sampled-pattern fallback', () => {
  it('normalises level spellings', () => {
    expect(['ERROR', 'err', 'fatal', 'Critical'].map(normalizeLevel)).toEqual(['error', 'error', 'error', 'error']);
    expect(normalizeLevel('WARNING')).toBe('warn');
    expect(normalizeLevel('unknown')).toBeNull();
    expect(levelOfLine('2026-11-27 ERROR [main] boom')).toBe('error');
    expect(levelOfLine('level=warn msg=x')).toBe('warn');
  });

  it('groups lines that differ only in their variable parts', () => {
    expect(lineShape('Timeout after 3000ms for order 1234 at 10.0.0.1:8080'))
      .toBe(lineShape('Timeout after 1500ms for order 98 at 10.0.0.7:8080'));
    const clusters = clusterLogLines([
      { time: new Date(1), line: 'ERROR order 1 failed', labels: {} },
      { time: new Date(2), line: 'ERROR order 22 failed', labels: {} },
      { time: new Date(3), line: 'WARN cache miss', labels: {} },
    ]);
    expect(clusters[0]).toMatchObject({ count: 2, level: 'error' });
  });
});

describe('lokiExploreUrl', () => {
  it('opens Explore on the datasource with the expression and window', () => {
    const url = new URL(lokiExploreUrl('https://grafana.example.com/', '3', 'loki', '{app="shop"}', new Date(1000), new Date(2000)));
    expect(url.pathname).toBe('/explore');
    expect(url.searchParams.get('orgId')).toBe('3');
    const panes = JSON.parse(url.searchParams.get('panes')!);
    expect(panes.a).toMatchObject({ datasource: 'loki', range: { from: '1000', to: '2000' }, queries: [{ expr: '{app="shop"}' }] });
  });
});

describe('per-application helpers', () => {
  it('builds the lines-per-service-and-level expression', () => {
    expect(serviceLevelExpr(shop, 'service_name', 'detected_level', 60))
      .toBe('sum by (service_name, detected_level) (count_over_time({app="shop"} [60s]))');
    expect(() => serviceLevelExpr(shop, 'bad-label', 'detected_level', 60)).toThrow(LokiError);
  });

  it('escapes a service name in a label filter and a stream matcher', () => {
    expect(labelFilter('service_name', 'a"b')).toBe('| service_name="a\\"b"');
    expect(buildStreamSelector(withStreamMatcher(shop, 'service_name', 'checkout').matchers))
      .toBe('{app="shop", service_name="checkout"}');
    // Replaces an existing matcher on the same label instead of AND-ing a contradiction.
    expect(withStreamMatcher({ matchers: [{ label: 'service_name', op: '=~', value: '.+' }] }, 'service_name', 'x').matchers)
      .toEqual([{ label: 'service_name', op: '=', value: 'x' }]);
  });
});
