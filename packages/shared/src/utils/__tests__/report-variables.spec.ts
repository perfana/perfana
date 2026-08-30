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
    // The picker half only. The resolver deliberately still answers them; see below.
    expect(REPORT_VARIABLES.some((v) => /epoch|iso8601/.test(v.key))).toBe(false);
  });

  it('still resolves the machine timestamp spellings it no longer offers', () => {
    // They shipped in v0.2.78.0. Report text saved against them is still out there,
    // and substitution leaves an unknown key verbatim — so dropping the resolver
    // would print `{perfana-start-epoch-milliseconds}` into HTML that the share link
    // and the public PDF endpoint serve unauthenticated.
    const values = buildReportVariableValues(run);
    expect(values['perfana-start-iso8601-utc']).toBe('2026-08-25T14:03:00.000Z');
    expect(values['perfana-end-iso8601-utc']).toBe('2026-08-25T14:33:00.000Z');
    expect(values['perfana-start-epoch-milliseconds']).toBe('1787666580000');
    expect(values['perfana-end-epoch-milliseconds']).toBe('1787668380000');
    expect(values['perfana-start-epoch-seconds']).toBe('1787666580');
    expect(values['perfana-end-epoch-seconds']).toBe('1787668380');
    // Local-offset spelling: same instant, formatted at the server's offset, with a
    // literal `+` rather than the deep link's `%2B`.
    expect(values['perfana-start-iso8601-offset']).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    );
    expect(values['perfana-end-iso8601-offset']).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    );
    // All eight, and every one blank rather than absent when there is no timestamp.
    const blank = buildReportVariableValues({ completed: true });
    for (const key of [
      'perfana-start-iso8601-utc', 'perfana-end-iso8601-utc',
      'perfana-start-iso8601-offset', 'perfana-end-iso8601-offset',
      'perfana-start-epoch-milliseconds', 'perfana-start-epoch-seconds',
      'perfana-end-epoch-milliseconds', 'perfana-end-epoch-seconds',
    ]) {
      expect(values[key]).toBeDefined();
      expect(blank[key]).toBe('');
    }
  });

  it('substitutes a saved epoch placeholder rather than leaving it literal', () => {
    // The whole point of keeping the resolver: prose authored against v0.2.78.0
    // must keep rendering a number, not its own placeholder.
    const values = buildReportVariableValues(run);
    expect(substituteReportVariables('started at {perfana-start-epoch-milliseconds}', values))
      .toBe('started at 1787666580000');
    expect(substituteReportVariables('{perfana-end-iso8601-utc}', values))
      .toBe('2026-08-25T14:33:00.000Z');
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
    // Line-leading block markers only, and only at the start of a line.
    expect(escapeMarkdownValue('# Heading')).toBe('\\# Heading');
    expect(escapeMarkdownValue('- item')).toBe('\\- item');
    expect(escapeMarkdownValue('1. item')).toBe('1\\. item');
    expect(escapeMarkdownValue('* star')).toBe('\\* star');
    expect(escapeMarkdownValue('build 1 of 3')).toBe('build 1 of 3');
    // Inline emphasis and code are left alone on purpose: a backslash does not
    // break those patterns (renderMarkdown never looks at the preceding
    // character), so escaping them printed stray backslashes around text that
    // still came out bold. They emit no href and no HTML.
    expect(escapeMarkdownValue('**bold** and `code`')).toBe('**bold** and `code`');
  });

  it('leaves an ordinary value byte-for-byte alone', () => {
    // renderMarkdown does NOT consume backslash escapes — it escapes HTML and then
    // pattern-matches — so a backslash here is a construct-breaker that survives
    // into the output. Escaping every piece of punctuation printed a release as
    // `1\.2\.3` in the published report, which is why this is narrow.
    for (const value of [
      '1.2.3',
      'run-2026-08-25-01',
      '21.0.6+7-LTS',
      'https://ci.example.com/job/123',
      'Checkout (EU)',
      'peak_load',
    ]) {
      expect(escapeMarkdownValue(value)).toBe(value);
    }
  });

  it('escapes the free-text fields it reads off the test run row', () => {
    // applicationRelease, the test run id, the environment, the workload, the system
    // name and the tags are all CI-supplied free text, and substitution feeds the
    // markdown SOURCE of a page served unauthenticated over a share link.
    const values = buildReportVariableValues({
      ...run,
      applicationRelease: 'Click [x](http://e) now',
      testRunId: 'run [x](http://e)',
      testEnvironment: '[x](http://e)',
      workload: '[x](http://e)',
      tags: ['[x](http://e)'],
      systemUnderTest: { name: '[x](http://e)' },
      ciBuildResultsUrl: 'https://ci/1 [x](http://e)',
    });
    for (const key of [
      'perfana-application-release', 'perfana-test-run-id', 'perfana-tags',
      'perfana-system-under-test', 'perfana-build-result-url',
      'perfana-test-environment', 'perfana-workload',
    ]) {
      expect(values[key]).not.toMatch(/\[x\]\(/);
    }
    // A real build URL is still untouched, so `[build]({perfana-build-result-url})`
    // keeps working.
    expect(buildReportVariableValues(run)['perfana-build-result-url']).toBe('https://ci/1');
    // Formatter output is not escaped — it cannot carry markdown.
    expect(values['perfana-start-datetime']).toBe('25 August 2026, 14:03 UTC');
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

    it('escapes the previous run\'s free-text fields too', () => {
      // Same trust level as the current run's: whatever the CI pipeline posted,
      // spliced into the markdown source of a publicly-served page.
      const v = buildPreviousRunVariableValues({
        testRunId: 'run [x](http://e)',
        startTime: new Date('2026-08-24T14:03:00.000Z'),
        applicationRelease: 'Click [x](http://e) now',
      });
      expect(v['perfana-previous-application-release']).not.toMatch(/\[x\]\(/);
      expect(v['perfana-previous-test-run-id']).not.toMatch(/\[x\]\(/);
      // Ordinary values are untouched, and the timestamps are formatter output.
      expect(
        buildPreviousRunVariableValues({ testRunId: 'run-41', applicationRelease: '1.4.2' }),
      ).toMatchObject({
        'perfana-previous-test-run-id': 'run-41',
        'perfana-previous-application-release': '1.4.2',
      });
      expect(v['perfana-previous-start-datetime']).toBe('24 August 2026, 14:03 UTC');
    });

    it('resolves nothing at all when there is no previous run', () => {
      // The builder stays a pure "here is the row" mapper. Blanking the four keys
      // when there is no row is the compiler's job — it seeds them before the
      // query so a first-ever run prints a blank, not a literal placeholder. See
      // ReportHtmlCompilerService.lookupVariableValues.
      expect(buildPreviousRunVariableValues(null)).toEqual({});
      expect(buildPreviousRunVariableValues(undefined)).toEqual({});
    });

    it('blanks the keys the previous run never recorded, rather than printing undefined', () => {
      // The compiler selects four columns; three of them are nullable. A blank in the
      // sentence is survivable, the literal "undefined" is not.
      const v = buildPreviousRunVariableValues({
        testRunId: 'run-2026-08-24-01',
        startTime: new Date('2026-08-24T14:03:00.000Z'),
        endTime: null,
        applicationRelease: null,
      });
      expect(v['perfana-previous-end-datetime']).toBe('');
      expect(v['perfana-previous-application-release']).toBe('');
      // Every catalogue key is still present, so nothing falls through to a literal placeholder.
      for (const key of REPORT_VARIABLES_NEEDING_LOOKUP) {
        expect(typeof v[key]).toBe('string');
      }
    });

    it('does not read a missing end time as "now" the way a live run does', () => {
      // buildReportVariableValues falls back to now for an unfinished run; the previous
      // run is completed by construction, so the same fallback here would invent an end.
      const v = buildPreviousRunVariableValues({ testRunId: 'run-1', completed: false });
      expect(v['perfana-previous-end-datetime']).toBe('');
      expect(v['perfana-previous-start-datetime']).toBe('');
    });

    it('accepts the string timestamps a driver may hand back instead of Dates', () => {
      const v = buildPreviousRunVariableValues({
        testRunId: 'run-1',
        startTime: '2026-08-24T14:03:00.000Z',
        endTime: '2026-08-24T14:33:00.000Z',
      });
      expect(v['perfana-previous-start-datetime']).toBe('24 August 2026, 14:03 UTC');
      expect(v['perfana-previous-end-datetime']).toBe('24 August 2026, 14:33 UTC');
    });

    it('drops an unparseable timestamp instead of rendering "Invalid Date"', () => {
      const v = buildPreviousRunVariableValues({ testRunId: 'run-1', startTime: 'not-a-date' });
      expect(v['perfana-previous-start-datetime']).toBe('');
    });

    it('substitutes into prose exactly as the compiler will use it', () => {
      const values = buildPreviousRunVariableValues({
        testRunId: 'run-41',
        startTime: new Date('2026-08-24T14:03:00.000Z'),
        endTime: new Date('2026-08-24T14:33:00.000Z'),
        applicationRelease: '1.4.2',
      });
      expect(
        substituteReportVariables(
          'Compared with {perfana-previous-test-run-id} ({perfana-previous-application-release}), ' +
            'which ran {perfana-previous-start-datetime} to {perfana-previous-end-datetime}.',
          values,
        ),
      ).toBe(
        'Compared with run-41 (1.4.2), which ran 24 August 2026, 14:03 UTC to 24 August 2026, 14:33 UTC.',
      );
    });
  });
});