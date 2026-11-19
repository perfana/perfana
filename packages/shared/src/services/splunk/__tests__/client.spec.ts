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
  splunkFieldSummary,
  explainEmptyTimechart,
  parseExportStream,
  parseSplunkTime,
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
  // Value: protects=rows with a value column become points whatever the Splunk user's time-format prefs;
  // fails_when=output_time_format is no longer sent, or an epoch _time is dropped as unparseable;
  // why_new=a real Splunk returned 485 `_time,count,_span` rows and the worker logged "returned no data"
  it('asks for epoch _time and parses it, and names an unreadable _time instead of "no data"', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('{"preview":false,"result":{"_time":"1795007130","count":"7","_span":"30"}}\n'));
    const points = await splunkTimechart(
      { host: 'https://s:8089', apiToken: 't' },
      { filter: 'index=web', from: new Date('2026-11-18T13:05:00Z'), to: new Date('2026-11-18T14:05:00Z'), bucketSeconds: 30 },
      { fetchImpl },
    );
    expect(new URLSearchParams(String(fetchImpl.mock.calls[0][1].body)).get('output_time_format')).toBe('%s');
    expect(points).toEqual([{ time: new Date(1795007130 * 1000), series: 'count', value: 7 }]);

    const { rows, stats } = parseExportStream('{"preview":false,"result":{"_time":"2026-11-18 14:05:30.000 CET","count":"7"}}\n');
    expect(timechartRowsToPoints(rows)).toEqual([]);
    expect(explainEmptyTimechart(stats, null)).toContain('_time "2026-11-18 14:05:30.000 CET" is not a timestamp');
  });
});

describe('a timechart whose split field the events lack', () => {
  // Value: protects=rows that carry only _time/_span are reported as a missing split field, naming it, instead of
  // a bare "no data"; fails_when=the columns stat or the explanation is dropped, or a real value column is
  // misread as empty; why_new=a real Splunk returned 485 such rows and the log said only "returned no data";
  // seam=none; no_claim=that Splunk produces exactly these columns for a missing field (observed shape, not documented)
  const body = [
    '{"preview":false,"result":{"_time":"2026-11-18T14:05:00.000+01:00","_span":"30"}}',
    '{"preview":false,"result":{"_time":"2026-11-18T14:05:30.000+01:00","_span":"30"}}',
  ].join('\n') + '\n';

  it('yields no points and explains why, naming the field', () => {
    const { rows, stats } = parseExportStream(body);
    expect(timechartRowsToPoints(rows)).toEqual([]);
    expect(stats).toMatchObject({ rows: 2, columns: ['_time', '_span'] });
    expect(explainEmptyTimechart(stats, 'log_level')).toContain('no event in the window has the field "log_level"');
  });

  it('says nothing when there are no rows, or when a value column exists', () => {
    expect(explainEmptyTimechart(parseExportStream('').stats, 'log_level')).toBeNull();
    expect(explainEmptyTimechart(undefined, 'log_level')).toBeNull();
    const withValues = parseExportStream('{"preview":false,"result":{"_time":"2026-11-18T14:05:00Z","NULL":"0"}}\n').stats;
    expect(explainEmptyTimechart(withValues, 'log_level')).toBeNull();
    // Value: protects=an epoch _time (what every export now asks for) is not reported as unreadable when the
    // cells are merely empty, and a row with no _time at all is named rather than printed as "undefined";
    // fails_when=explainEmptyTimechart judges firstTime with `new Date()` instead of parseSplunkTime, or drops the
    // `?? ''`; why_new=the case above uses an ISO _time, which both parsers accept; seam=none;
    // no_claim=that Splunk ever sends value columns without _time (a non-timechart search could)
    const epochEmptyCells = parseExportStream('{"preview":false,"result":{"_time":"1795007130","NULL":""}}\n').stats;
    expect(epochEmptyCells.firstTime).toBe('1795007130');
    expect(explainEmptyTimechart(epochEmptyCells, 'log_level')).toBeNull();
    const noTime = parseExportStream('{"preview":false,"result":{"count":"7"}}\n').stats;
    expect(noTime.firstTime).toBeUndefined();
    expect(explainEmptyTimechart(noTime, null)).toBe('Splunk returned 1 rows with columns count, but _time "" is not a timestamp Perfana can read.');
  });
});

describe('parseSplunkTime', () => {
  // Value: protects=the accepted _time shapes — epoch seconds with a fractional part (Splunk's %s with subseconds),
  // surrounding whitespace, ISO — and that empty/absent/garbage read as null rather than a 1970 or Invalid Date;
  // fails_when=the epoch pattern drops the fraction arm, the trim goes, or '' / null slip through as epoch 0;
  // why_new=the regression test pins only an integer epoch and one locale string; seam=none;
  // no_claim=that every Splunk time format is covered (only the export's %s and ISO are promised)
  it('reads epoch seconds (with a fraction) and ISO, and returns null for empty or unreadable values', () => {
    expect(parseSplunkTime('1795007130.250')).toEqual(new Date(1795007130250));
    expect(parseSplunkTime(' 1795007130 ')).toEqual(new Date(1795007130000));
    expect(parseSplunkTime('2026-11-18T14:05:30.000+01:00')).toEqual(new Date('2026-11-18T13:05:30Z'));
    for (const raw of [null, undefined, '', '   ', 'NaN', '2026-11-18 14:05:30.000 CET']) {
      expect(parseSplunkTime(raw)).toBeNull();
    }
  });
});

describe('splunkTimechart send path', () => {
  // Value: protects=a panel already saved keeps collecting: the send path does not re-check time modifiers (the
  // scoped filter sits after Perfana's own `| search`, where a modifier cannot widen the window); fails_when=the
  // send path starts refusing them, so saved panels silently stop collecting; why_new=the validator cases call
  // validateSplFilter directly; seam=none; no_claim=Splunk's handling of a modifier after a pipe
  it('sends a saved filter that carries a field named like a modifier', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(''));
    const filter = scopeSplFilter('$entities starttime=*', [{ indexName: 'a' }])!;
    await splunkTimechart(
      { host: 'https://s:8089', apiToken: 't' },
      { filter, from: new Date('2026-11-17T10:00:00Z'), to: new Date('2026-11-17T11:00:00Z'), bucketSeconds: 60 },
      { fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('splunkTimechart window precedence', () => {
  // Value: protects=the collection window always comes from the run, whatever a caller passes in opts;
  // fails_when=the spread in splunkTimechart is reversed so a stray earliestTime/latestTime replaces it;
  // why_new=no test passed a range in opts; seam=none; no_claim=none beyond protects
  it('keeps the run window when a caller passes its own earliestTime/latestTime', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(''));
    await splunkTimechart(
      { host: 'https://s:8089', apiToken: 't' },
      { filter: 'index=web', from: new Date('2026-11-17T10:00:00Z'), to: new Date('2026-11-17T11:00:00Z'), bucketSeconds: 60 },
      { fetchImpl, earliestTime: '-1h', latestTime: 'now' },
    );
    const body = new URLSearchParams(String(fetchImpl.mock.calls[0][1].body));
    expect(body.get('earliest_time')).toBe('1794909600');
    expect(body.get('latest_time')).toBe('1794913200');
  });
});

describe('splunkFieldSummary', () => {
  // Value: protects=field discovery searches the last hour via the earliest_time parameter; fails_when=the -1h bound
  // goes back inline into the search text (the shape a real Splunk answered with no rows) or is dropped (unbounded
  // scan); why_new=no test called splunkFieldSummary at all; seam=none; no_claim=does not check fieldsummary parsing
  it('sends the last hour as earliest_time, not inline, and no latest_time', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(
      '{"preview":false,"result":{"field":"log_level","distinct_count":"2","values":"[{\\"value\\":\\"ERROR\\"},{\\"value\\":\\"INFO\\"}]"}}\n'
      + '{"preview":false,"result":{"field":"_raw","distinct_count":"9","values":"[]"}}\n',
    ));
    const fields = await splunkFieldSummary({ host: 'https://s:8089', apiToken: 't' }, 'index=web', { fetchImpl });
    expect(fields).toEqual([{ field: 'log_level', distinctCount: 2, values: ['ERROR', 'INFO'] }]);
    const body = new URLSearchParams(String(fetchImpl.mock.calls[0][1].body));
    expect(body.get('earliest_time')).toBe('-1h');
    expect(body.has('latest_time')).toBe(false);
    expect(body.get('search')).toMatch(/^search index=web \| head 2000 \| fieldsummary/);
    expect(body.get('search')).not.toMatch(/earliest|latest/);
  });
});

describe('validateSplFilter', () => {
  it('accepts the starter panels, including a rex pattern with | and [ inside quotes', () => {
    expect(validateSplFilter('$entities log_level=ERROR')).toBeNull();
    expect(validateSplFilter('$entities "Exception" | rex "(?<exception>[A-Za-z0-9_.]+Exception|Error)"')).toBeNull();
    expect(validateSplFilter('$entities | eval x="a\\"|b" | where x!=""')).toBeNull();
  });

  // Value: protects=a filter saved or previewed with its own time range is refused, naming the modifier;
  // fails_when=the timeModifiers check is dropped or misses a spelling; why_new=the API's old save-time regex
  // covered earliest/latest only; seam=none; no_claim=Splunk's own handling of a modifier after a pipe
  it.each([
    ['$entities earliest=-1h', 'earliest'],
    ['$entities | search latest=now', 'latest'],
    ['$entities _index_earliest=-1d', '_index_earliest'],
    ['$entities starttime=11/18/2026:00:00:00', 'starttime'],
    ['$entities endtimeu=1795007111', 'endtimeu'],
    ['$entities hoursago=48', 'hoursago'],
    ["$entities | search 'a earliest=-1y'", 'earliest'],
  ])('refuses the time modifier in %s when saving', (spl, name) => {
    expect(validateSplFilter(spl, { timeModifiers: true })).toBe(
      `Leave out the time modifier "${name}": Perfana sets the time range from the test run`,
    );
    // The send path does not re-check them.
    expect(validateSplFilter(spl)).toBeNull();
  });

  it('allows quoted text, look-alike names, dotted fields and fields outside search segments', () => {
    for (const spl of [
      '$entities "earliest=-1h"',
      '$entities my_earliest_value=3 latest_build=7',
      '$entities json.latest=1 event.starttime=2',
      '$entities | eval endtime=_time+5 | where starttime=0 | eval earliest=1',
    ]) expect(validateSplFilter(spl, { timeModifiers: true })).toBeNull();
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
    expect(String(init.body)).toBe('search=search+index%3Dx&output_mode=json&output_time_format=%25s');
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

  // Value: protects=the debug log shows the time range now that it is no longer part of the search text;
  // fails_when=the range suffix is dropped from onSearch (a log reader can no longer tell which window ran);
  // why_new=the existing onSearch case passes no range, so it pins only the no-range arm; seam=none;
  // no_claim=does not check the wording the API/worker loggers wrap around it
  it('appends the time range to the search reported to onSearch when one is sent', async () => {
    const fetchImpl = (async () => new Response(line(false, 0, '3'))) as unknown as typeof fetch;
    const seen: string[] = [];
    await splunkExport({ host: 'https://s.example:8089', apiToken: 't' }, 'search index=x | timechart count', {
      fetchImpl, earliestTime: '100', latestTime: '200', onSearch: (s) => seen.push(s),
    });
    // One bound only (the field summary's -1h): no empty "latest_time=" in the log.
    await splunkExport({ host: 'https://s.example:8089', apiToken: 't' }, 'search index=x | timechart count', {
      fetchImpl, earliestTime: '-1h', onSearch: (s) => seen.push(s),
    });
    expect(seen).toEqual([
      'search index=x | timechart count [earliest_time=100 latest_time=200]',
      'search index=x | timechart count [earliest_time=-1h]',
    ]);
  });
});
