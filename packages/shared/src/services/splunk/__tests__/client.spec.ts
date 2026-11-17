import {
  buildEntitiesClause,
  buildTimechartSearch,
  expandSplTemplate,
  findForbiddenSplCommand,
  parseExportLines,
  splunkAuthHeader,
  splunkExport,
  SplunkError,
  timechartRowsToPoints,
} from '../client';

describe('splunkAuthHeader', () => {
  it('prefers the token, falls back to basic, and returns null with neither', () => {
    expect(splunkAuthHeader({ apiToken: ' t\n', username: 'u', password: 'p' })).toBe('Bearer t');
    expect(splunkAuthHeader({ username: 'u', password: ' p ' })).toBe(`Basic ${Buffer.from('u: p ').toString('base64')}`);
    expect(splunkAuthHeader({ apiToken: '  ' })).toBeNull();
  });
});

describe('$entities', () => {
  const mappings = [
    { indexName: 'web', sourcetype: 'nginx', hostPattern: 'app-*', labels: ['frontend'] },
    { indexName: 'java', hostPattern: 'svc-"01', labels: ['backend'] },
  ];

  it('ORs one clause per mapping and escapes every value', () => {
    expect(buildEntitiesClause(mappings)).toBe(
      '((index="web" sourcetype="nginx" host="app-*") OR (index="java" host="svc-\\"01"))',
    );
  });

  it('filters by label and returns null when nothing is in scope', () => {
    expect(buildEntitiesClause(mappings, 'backend')).toBe('(index="java" host="svc-\\"01")');
    expect(buildEntitiesClause(mappings, 'db')).toBeNull();
    expect(buildEntitiesClause([])).toBeNull();
  });

  it('expands the template, and refuses when a reference resolves to nothing', () => {
    expect(expandSplTemplate('$entities[frontend] level=ERROR perfana_test_run_id=$testRunId', mappings, 'run"1')).toBe(
      '(index="web" sourcetype="nginx" host="app-*") level=ERROR perfana_test_run_id="run\\"1"',
    );
    expect(expandSplTemplate('$entities[db] level=ERROR', mappings)).toBeNull();
  });
});

describe('buildTimechartSearch', () => {
  const base = { filter: 'index=web', from: new Date('2026-11-17T10:00:00Z'), to: new Date('2026-11-17T11:00:00.5Z'), bucketSeconds: 5 };

  it('adds the run window and the bucketing, capping series with OTHER', () => {
    expect(buildTimechartSearch({ ...base, splitBy: 'log_level', maxSeries: 20 })).toBe(
      'search index=web earliest=1794909600 latest=1794913201 | timechart span=5s count by log_level limit=20 useother=t',
    );
  });

  it('rejects an aggregation or split field that could inject SPL', () => {
    expect(() => buildTimechartSearch({ ...base, aggregation: 'count | delete' })).toThrow(SplunkError);
    expect(() => buildTimechartSearch({ ...base, splitBy: 'x | delete' })).toThrow(SplunkError);
    expect(buildTimechartSearch({ ...base, aggregation: 'p95(duration_ms)' })).toContain('timechart span=5s p95(duration_ms)');
  });
});

describe('findForbiddenSplCommand', () => {
  it('flags commands that write or execute', () => {
    expect(findForbiddenSplCommand('index=x | outputlookup foo.csv')).toBe('outputlookup');
    expect(findForbiddenSplCommand('index=x "delete" | rex "(?<e>\\w+Exception)"')).toBeNull();
  });
});

describe('export stream parsing', () => {
  it('turns timechart rows into points, keeping zeros and OTHER', () => {
    const rows = parseExportLines(
      [
        '{"preview":false,"result":{"_time":"2026-11-17T10:00:00.000+00:00","ERROR":"2","OTHER":"0","_span":"5"}}',
        '{"preview":false,"result":{"_time":"2026-11-17T10:00:05.000+00:00","ERROR":"","OTHER":"1"}}',
        '',
      ].join('\n'),
    );
    expect(timechartRowsToPoints(rows)).toEqual([
      { time: new Date('2026-11-17T10:00:00Z'), series: 'ERROR', value: 2 },
      { time: new Date('2026-11-17T10:00:00Z'), series: 'OTHER', value: 0 },
      { time: new Date('2026-11-17T10:00:05Z'), series: 'OTHER', value: 1 },
    ]);
  });

  it('fails on a FATAL message instead of returning no rows', () => {
    expect(() => parseExportLines('{"messages":[{"type":"FATAL","text":"Unknown search command \'foo\'."}]}')).toThrow(
      "Unknown search command 'foo'.",
    );
  });

  it('marks a concurrency refusal retryable', () => {
    try {
      parseExportLines('{"messages":[{"type":"ERROR","text":"The maximum number of concurrent historical searches has been reached."}]}');
      fail('expected a throw');
    } catch (err) {
      expect((err as SplunkError).retryable).toBe(true);
    }
  });

  it('fails on a stream cut mid-record', () => {
    expect(() => parseExportLines('{"result":{"_time":"2026')).toThrow('ended mid-record');
  });
});

describe('splunkExport', () => {
  it('posts to the v2 export endpoint in the configured app with the auth header', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('{"result":{"_time":"2026-11-17T10:00:00Z","x":"1"}}\n'));
    const rows = await splunkExport({ host: 'https://s:8089/', apiToken: 't', splunkApp: 'perf app' }, 'search index=x', { fetchImpl });
    expect(rows).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://s:8089/servicesNS/-/perf%20app/search/v2/jobs/export');
    expect(init.headers.Authorization).toBe('Bearer t');
    expect(String(init.body)).toBe('search=search+index%3Dx&output_mode=json');
  });

  it('names a 401 as a credential problem', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('', { status: 401 }));
    await expect(splunkExport({ host: 'https://s:8089', apiToken: 't' }, 'search x', { fetchImpl })).rejects.toThrow('credentials');
  });
});
