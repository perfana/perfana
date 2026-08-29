import {
  REPORT_VARIABLES,
  REPORT_VARIABLES_NEEDING_LOOKUP,
  isSecretishConfigKey,
  isSecretishConfigValue,
  escapeMarkdownValue,
  buildPreviousRunVariableValues,
  buildReportVariableValues,
  substituteReportVariables,
} from '../report-variables';

const run = {
  testRunId: 'run-1',
  testEnvironment: 'acc',
  workload: 'peak',
  startTime: new Date('2026-08-25T14:03:00.000Z'),
  endTime: new Date('2026-08-25T14:33:00.000Z'),
  duration: 1800,
  tags: ['a', 'b'],
  applicationRelease: '1.2.3',
  ciBuildResultsUrl: 'https://ci/1',
  systemUnderTest: { name: 'Checkout' },
};

describe('report variables', () => {
  it('resolves every published key except the ones the API looks up', () => {
    const values = buildReportVariableValues(run);
    const lookups: readonly string[] = REPORT_VARIABLES_NEEDING_LOOKUP;
    for (const v of REPORT_VARIABLES) {
      if (lookups.includes(v.key)) continue;
      expect(values[v.key]).toBeDefined();
    }
    expect(values['perfana-system-under-test']).toBe('Checkout');
    expect(values['perfana-start-datetime']).toBe('25 August 2026, 14:03 UTC');
    expect(values['perfana-duration']).toBe('30m 0s');
    expect(values['perfana-tags']).toBe('a, b');
  });

  it('offers no machine timestamp spellings — report prose is read, not parsed', () => {
    const values = buildReportVariableValues(run);
    for (const key of Object.keys(values)) {
      expect(key).not.toMatch(/epoch|iso8601/);
    }
    expect(REPORT_VARIABLES.some((v) => /epoch|iso8601/.test(v.key))).toBe(false);
  });

  it('has no value for keys the API resolves with a query', () => {
    const values = buildReportVariableValues(run);
    expect(values['perfana-previous-test-run-id']).toBeUndefined();
    // …so substitution leaves the placeholder for the API to fill in.
    expect(substituteReportVariables('vs {perfana-previous-test-run-id}', values))
      .toBe('vs {perfana-previous-test-run-id}');
  });

  it('substitutes caller-supplied keys, e.g. test run configuration', () => {
    const values = { ...buildReportVariableValues(run), 'build.number': '42', 'build': 'x' };
    // Longest-first: 'build' must not eat the 'build.number' placeholder.
    expect(substituteReportVariables('{build.number} / {build}', values)).toBe('42 / x');
    // Regex metacharacters in an author-defined key are escaped, not interpreted.
    expect(substituteReportVariables('{a.c}', { 'a.c': 'ok' })).toBe('ok');
    expect(substituteReportVariables('{abc}', { 'a.c': 'ok' })).toBe('{abc}');
  });

  it('substitutes known keys and leaves everything else alone', () => {
    const values = buildReportVariableValues(run);
    expect(substituteReportVariables('{perfana-workload} on {perfana-test-environment}', values))
      .toBe('peak on acc');
    // Unknown placeholders survive so the author can see their typo.
    expect(substituteReportVariables('{perfana-nope} and {literal}', values))
      .toBe('{perfana-nope} and {literal}');
  });

  it('resolves missing test run data to empty, not to the placeholder', () => {
    const values = buildReportVariableValues({});
    expect(substituteReportVariables('release {perfana-application-release}.', values))
      .toBe('release .');
  });

  it('leaves a secret-shaped config key literal instead of resolving it', () => {
    // The rendered report is served unauthenticated over share links, so these
    // never enter the values map — see isSecretishConfigKey.
    expect(isSecretishConfigKey('db.password')).toBe(true);
    expect(isSecretishConfigKey('API_TOKEN')).toBe(true);
    expect(isSecretishConfigKey('private_key')).toBe(true);
    expect(isSecretishConfigKey('java.runtime.version')).toBe(false);
    expect(isSecretishConfigKey('build.number')).toBe(false);
  });

  it('does not swallow ordinary keys that merely contain a secret-ish stem', () => {
    // A bare /auth/ matched `author`, and a bare /pass/ matched `pass_rate` —
    // silently unresolvable and silently missing from the picker, with nothing
    // in the UI to explain why.
    expect(isSecretishConfigKey('author')).toBe(false);
    expect(isSecretishConfigKey('authored_by')).toBe(false);
    expect(isSecretishConfigKey('authoring_tool')).toBe(false);
    expect(isSecretishConfigKey('pass_rate')).toBe(false);
    expect(isSecretishConfigKey('passed_checks')).toBe(false);
    expect(isSecretishConfigKey('certification')).toBe(false);
    // Still caught when it really is the thing.
    expect(isSecretishConfigKey('auth')).toBe(true);
    expect(isSecretishConfigKey('AUTH_HEADER')).toBe(true);
  });

  it('catches a credential hiding inside a benignly-named value', () => {
    // The shapes CI actually leaks: none of these keys look secret-ish.
    expect(isSecretishConfigValue('postgres://svc:hunter2@db.internal:5432/app')).toBe(true);
    // A JDBC url embeds the same scheme://user:pw@host shape, so it is caught too.
    expect(isSecretishConfigValue('jdbc:postgresql://u:p@h/db')).toBe(true);
    expect(isSecretishConfigValue('-Xmx2g -Dspring.datasource.password=hunter2')).toBe(true);
    expect(isSecretishConfigValue('--token=abcdef123456')).toBe(true);
    expect(isSecretishConfigValue('Bearer abcdefghijklmnop0123456789')).toBe(true);
    expect(isSecretishConfigValue('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
    // Ordinary values are untouched.
    expect(isSecretishConfigValue('21.0.6+7-LTS')).toBe(false);
    expect(isSecretishConfigValue('https://ci.example.com/job/123')).toBe(false);
    expect(isSecretishConfigValue('4711')).toBe(false);
  });

  it('neutralises markdown syntax in a substituted value', () => {
    // The value is written by anything with an API key; the rendered report is
    // reachable unauthenticated, so a value must not be able to plant a link.
    const escaped = escapeMarkdownValue('Click [here](https://elsewhere.example) now');
    expect(escaped).not.toMatch(/\[here\]\(/);
    expect(escapeMarkdownValue('**bold**')).toBe('\\*\\*bold\\*\\*');
    expect(escapeMarkdownValue('plain text 1.2.3')).toContain('1\\.2\\.3');
  });

  it('never resolves a placeholder off the prototype chain', () => {
    // `values[key]` walks the prototype, so these used to render JS internals into
    // report HTML and silently broke the typo-passthrough contract.
    const values = buildReportVariableValues(run);
    expect(substituteReportVariables('{toString} {constructor} {__proto__}', values))
      .toBe('{toString} {constructor} {__proto__}');
  });

  it('formats the helper edges', () => {
    const empty = buildReportVariableValues({ completed: true });
    expect(empty['perfana-start-datetime']).toBe('');
    expect(empty['perfana-end-datetime']).toBe('');
    expect(empty['perfana-duration']).toBe('');
    expect(empty['perfana-tags']).toBe('');
    // An unparseable date is dropped, not rendered as "Invalid Date".
    expect(buildReportVariableValues({ startTime: 'not-a-date' })['perfana-start-datetime']).toBe('');
  });

  it('formats durations across the hour boundary', () => {
    const d = (seconds: number) => buildReportVariableValues({ duration: seconds })['perfana-duration'];
    expect(d(45)).toBe('45s');
    expect(d(1800)).toBe('30m 0s');
    expect(d(3725)).toBe('1h 2m 5s');
    expect(d(-10)).toBe('0s');
  });

  it('handles a null source at all', () => {
    expect(buildReportVariableValues(null)['perfana-workload']).toBe('');
    expect(substituteReportVariables(null, {})).toBe('');
    expect(substituteReportVariables('{perfana-workload}', {})).toBe('{perfana-workload}');
  });

  describe('a run that is still going', () => {
    // `end` falls back to the clock while a run is incomplete, matching the
    // deep-link resolver, so the clock has to be pinned to assert it.
    beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-08-25T14:33:00.000Z')));
    afterAll(() => jest.useRealTimers());

    it('reads end-time as now, so a live report says elapsed-so-far', () => {
      const v = buildReportVariableValues({ completed: false, startTime: new Date('2026-08-25T14:03:00.000Z') });
      expect(v['perfana-end-datetime']).toBe('25 August 2026, 14:33 UTC');
    });

    it('leaves end-time blank for a completed run that never recorded one', () => {
      const v = buildReportVariableValues({ completed: true, endTime: null });
      expect(v['perfana-end-datetime']).toBe('');
    });
  });

  describe('the previous run the API looks up', () => {
    it('resolves every Comparison key the catalogue publishes', () => {
      const v = buildPreviousRunVariableValues({
        testRunId: 'run-2026-08-24-01',
        startTime: new Date('2026-08-24T14:03:00.000Z'),
        endTime: new Date('2026-08-24T14:33:00.000Z'),
        applicationRelease: '1.4.2',
      });
      expect(v).toEqual({
        'perfana-previous-test-run-id': 'run-2026-08-24-01',
        'perfana-previous-start-datetime': '24 August 2026, 14:03 UTC',
        'perfana-previous-end-datetime': '24 August 2026, 14:33 UTC',
        'perfana-previous-application-release': '1.4.2',
      });
      for (const key of REPORT_VARIABLES_NEEDING_LOOKUP) {
        expect(v[key]).toBeDefined();
      }
    });

    it('resolves nothing at all when there is no previous run', () => {
      expect(buildPreviousRunVariableValues(null)).toEqual({});
    });
  });
});