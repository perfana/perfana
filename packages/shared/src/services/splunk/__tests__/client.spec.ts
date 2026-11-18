import {
  splunkServerInfo,
  hostForLog,
  buildEntitiesClause,
  buildTimechartSearch,
  expandSplTemplate,
  scopeSplFilter,
  validateSplFilter,
  parseExportLines,
  splunkAuthHeader,
  splunkExport,
  splunkTimechart,
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

describe('scopeSplFilter', () => {
  const mappings = [
    { indexName: 'web', labels: ['frontend'] },
    { indexName: 'java', labels: ['backend'] },
  ];

  it('runs the mapped sources first, so an OR in the user filter cannot widen the search', () => {
    expect(scopeSplFilter('$entities OR index=_audit', mappings)).toBe(
      '((index="web") OR (index="java")) | search ((index="web") OR (index="java")) OR index=_audit',
    );
  });

  it('bounds by the labels the filter names', () => {
    expect(scopeSplFilter('$entities[backend] level=ERROR', mappings)).toBe(
      '(index="java") | search (index="java") level=ERROR',
    );
    expect(scopeSplFilter('$entities[db]', mappings)).toBeNull();
    expect(scopeSplFilter('index=web', mappings)).toBeNull();
  });
});

describe('buildTimechartSearch', () => {
  const base = { filter: 'index=web', from: new Date('2026-11-17T10:00:00Z'), to: new Date('2026-11-17T11:00:00.5Z'), bucketSeconds: 5 };

  it('adds the bucketing, capping series with OTHER, and keeps the run window OUT of the search text', () => {
    expect(buildTimechartSearch({ ...base, splitBy: 'log_level', maxSeries: 20 })).toBe(
      'search index=web | timechart span=5s count by log_level limit=20 useother=t',
    );
  });

  it('rejects an aggregation or split field that could inject SPL', () => {
    expect(() => buildTimechartSearch({ ...base, aggregation: 'count | delete' })).toThrow(SplunkError);
    expect(() => buildTimechartSearch({ ...base, splitBy: 'x | delete' })).toThrow(SplunkError);
    expect(buildTimechartSearch({ ...base, aggregation: 'p95(duration_ms)' })).toContain('timechart span=5s p95(duration_ms)');
  });

  it('validates the EXPANDED filter it is about to send', () => {
    expect(() => buildTimechartSearch({ ...base, filter: 'index=x | outputlookup y' })).toThrow('Refusing');
  });

  it('keeps a piped filter intact', () => {
    expect(buildTimechartSearch({ ...base, filter: '(index="x") | search "Exception" | rex "(?<e>\\w+)"' })).toMatch(
      /^search \(index="x"\) \| search "Exception" \| rex/,
    );
  });
});

describe('splunkTimechart', () => {
  // An inline earliest=<epoch> latest=<epoch> returned nothing from a real Splunk while the same
  // search with the range in the time picker showed data; the range must travel as parameters.
  it('sends the run window as earliest_time / latest_time, not inline', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('{"preview":false,"result":{"_time":"2026-11-17T10:00:00Z","ERROR":"3"}}\n'));
    const points = await splunkTimechart(
      { host: 'https://s:8089', apiToken: 't' },
      { filter: 'index=web', from: new Date('2026-11-17T10:00:00Z'), to: new Date('2026-11-17T11:00:00.5Z'), bucketSeconds: 60, splitBy: 'log_level' },
      { fetchImpl },
    );
    expect(points).toEqual([{ time: new Date('2026-11-17T10:00:00Z'), series: 'ERROR', value: 3 }]);
    const body = new URLSearchParams(String(fetchImpl.mock.calls[0][1].body));
    expect(body.get('earliest_time')).toBe('1794909600');
    expect(body.get('latest_time')).toBe('1794913201');
    expect(body.get('search')).not.toMatch(/earliest|latest/);
  });
});

describe('validateSplFilter', () => {
  it('accepts the starter panels, including a rex pattern with | and [ inside quotes', () => {
    expect(validateSplFilter('$entities log_level=ERROR')).toBeNull();
    expect(validateSplFilter('$entities "Exception" | rex "(?<exception>[A-Za-z0-9_.]+Exception|Error)"')).toBeNull();
    expect(validateSplFilter('$entities | eval x="a\\"|b" | where x!=""')).toBeNull();
  });

  it.each([
    ['index=x | outputlookup foo.csv', 'outputlookup'],
    ['index=x | inputlookup users.csv', 'inputlookup'],
    ['| inputlookup users.csv', 'start with search terms'],
    ['index=x [search index=_audit | fields user]', 'Subsearches'],
    ['`some_macro` index=x', 'macros'],
    ['index=x "unclosed', 'Unbalanced'],
    ['index=x \\" | outputlookup foo "', 'backslash'],
    ['$entities "x $testRunId | outputlookup y"', 'outside a quoted string'],
    ['$entities "$entities"', 'outside a quoted string'],
    ["$entities | eval x='\"' | outputlookup foo | eval y='\"'", 'single-quoted'],
    ["$entities | where 'a|b'=1", 'single-quoted'],
    ["$entities | eval x='unclosed", 'Unbalanced single quote'],
    ['$entities[backend] [search index=_audit]', 'Subsearches'],
    ['$entities [search index=_audit]', 'Subsearches'],
  ])('rejects %s', (spl, message) => {
    expect(validateSplFilter(spl)).toContain(message);
  });

  it('accepts a labelled $entities reference and a plain single-quoted field name', () => {
    expect(validateSplFilter('$entities[backend] level=ERROR')).toBeNull();
    expect(validateSplFilter("$entities[db] | where 'response.time' > 2")).toBeNull();
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

  it('ignores interim preview result sets', () => {
    const rows = parseExportLines(
      [
        '{"preview":true,"result":{"_time":"2026-11-17T10:00:00Z","ERROR":"1"}}',
        '{"preview":false,"result":{"_time":"2026-11-17T10:00:00Z","ERROR":"2"}}',
      ].join('\n'),
    );
    expect(timechartRowsToPoints(rows)).toEqual([{ time: new Date('2026-11-17T10:00:00Z'), series: 'ERROR', value: 2 }]);
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
    expect(init.redirect).toBe('error');
  });

  it('names a 401 as a credential problem', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('', { status: 401 }));
    await expect(splunkExport({ host: 'https://s:8089', apiToken: 't' }, 'search x', { fetchImpl })).rejects.toThrow('credentials');
  });

  it('names missing credentials as such, without calling Splunk', async () => {
    const fetchImpl = jest.fn();
    const err = await splunkExport({ host: 'https://s:8089' }, 'search x', { fetchImpl }).catch((e: Error) => e);
    expect((err as Error).message).toContain('neither a token');
    expect((err as Error).message).not.toContain('Could not reach');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('describeFetchError', () => {
  const { describeFetchError } = jest.requireActual('../client') as typeof import('../client');
  it('surfaces the undici cause and a hint', () => {
    const err = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND x.example'), { code: 'ENOTFOUND' }) });
    expect(describeFetchError(err)).toMatch(/^ENOTFOUND\. The hostname does not resolve/);
  });
  it('never echoes the resolved address', () => {
    const err = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:8089'), { code: 'ECONNREFUSED' }) });
    expect(describeFetchError(err)).not.toMatch(/10\.1\.2\.3/);
  });
  it('keeps the raw cause on the error for server logs only', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:8089 Bearer secret'), { code: 'ECONNREFUSED', syscall: 'connect', address: '10.1.2.3', port: 8089 });
    const fetchImpl = (async () => { throw new TypeError('fetch failed', { cause }); }) as unknown as typeof fetch;
    const err = await splunkServerInfo({ host: 'https://s.example:8089', apiToken: 't' }, { fetchImpl }).catch((e) => e);
    expect(err.message).not.toMatch(/10\.1\.2\.3/);
    expect(err.detail).toMatch(/ECONNREFUSED connect 10\.1\.2\.3:8089/);
    expect(err.detail).not.toContain('secret');
    expect(hostForLog('https://u:p@s.example:8089/x?y=1')).toBe('https://s.example:8089');
  });
  it('maps certificate codes to the CA hint', () => {
    const err = new TypeError('fetch failed', { cause: Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }) });
    expect(describeFetchError(err)).not.toContain('in certificate chain');
    expect(describeFetchError(err)).toMatch(/^SELF_SIGNED_CERT_IN_CHAIN\. .*NODE_EXTRA_CA_CERTS/);
  });
});

describe('parseExportStream preview handling', () => {
  const { parseExportStream, splunkExport } = jest.requireActual('../client') as typeof import('../client');
  const line = (preview: boolean, offset: number, count: string) =>
    JSON.stringify({ preview, offset, result: { _time: `2026-11-18T09:1${offset}:00.000+01:00`, count } });

  it('uses the final rows and ignores interim previews', () => {
    const body = [line(true, 0, '1'), line(false, 0, '5'), line(false, 1, '6')].join('\n');
    const { rows, stats } = parseExportStream(body);
    expect(rows.map((r) => r.count)).toEqual(['5', '6']);
    expect(stats).toMatchObject({ finalRows: 2, previewRows: 1, usedPreview: false });
  });

  it('falls back to the LAST preview set when Splunk sends no final row', () => {
    const body = [line(true, 0, '1'), line(true, 0, '4'), line(true, 1, '7')].join('\n');
    const { rows, stats } = parseExportStream(body);
    expect(rows.map((r) => r.count)).toEqual(['4', '7']);
    expect(stats.usedPreview).toBe(true);
  });

  it('reports the exact search sent to onSearch', async () => {
    const fetchImpl = (async () => new Response(line(false, 0, '3'))) as unknown as typeof fetch;
    const seen: string[] = [];
    await splunkExport({ host: 'https://s.example:8089', apiToken: 't' }, 'search index=x | timechart count', {
      fetchImpl, onSearch: (s, st) => seen.push(`${s} ${st.finalRows}`),
    });
    expect(seen).toEqual(['search index=x | timechart count 1']);
  });
});
