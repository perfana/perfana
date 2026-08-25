import {
  REPORT_VARIABLES,
  REPORT_VARIABLES_NEEDING_LOOKUP,
  isSecretishConfigKey,
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

  it('covers the deep-link timing vocabulary', () => {
    const values = buildReportVariableValues(run);
    expect(values['perfana-start-epoch-milliseconds']).toBe('1787666580000');
    expect(values['perfana-start-epoch-seconds']).toBe('1787666580');
    expect(values['perfana-end-epoch-milliseconds']).toBe('1787668380000');
    // Offset form matches the deep-link resolver except for the URL-encoded '+'.
    // Asserted as an instant, not as a literal local date: the value is rendered in
    // the RUNNER's timezone, so a hardcoded 2026-08-25 fails for anyone at +10 or
    // beyond, where 14:03Z has already rolled over to the 26th.
    expect(values['perfana-start-iso8601-offset']).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/,
    );
    expect(new Date(values['perfana-start-iso8601-offset']!).toISOString()).toBe(
      '2026-08-25T14:03:00.000Z',
    );
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
    expect(empty['perfana-start-iso8601-offset']).toBe('');
    expect(empty['perfana-start-epoch-milliseconds']).toBe('');
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
      expect(v['perfana-end-iso8601-utc']).toBe('2026-08-25T14:33:00.000Z');
    });

    it('leaves end-time blank for a completed run that never recorded one', () => {
      const v = buildReportVariableValues({ completed: true, endTime: null });
      expect(v['perfana-end-iso8601-utc']).toBe('');
    });
  });
});