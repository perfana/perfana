/**
 * Dynamic values for report prose, spelled the same way deep links spell them:
 * `{perfana-test-run-id}` in the authored text, resolved against the report's
 * test run when the HTML is rendered.
 *
 * Lives in shared for the same reason section-anchors does: the API resolves
 * them and the web editor's picker offers them, and a second list would drift.
 *
 * The vocabulary is the deep-link one (see BASE_VARIABLES in the deep-link
 * editor) plus the values only prose wants — a readable date, a duration, the
 * tags. Two deliberate differences from deep links, both because prose is not
 * a query string:
 *
 *  - The epoch and ISO 8601 spellings are resolved but NOT offered. They exist
 *    so a value survives a query parser; printing `1787664180000` or
 *    `2026-08-25T14:03:00.000Z` in a sentence is machine output in a document
 *    meant to be read, so the picker stopped listing them — but they shipped in
 *    v0.2.78.0 and report text saved against them is still out there, so the
 *    resolver keeps them. See the block at the end of buildReportVariableValues.
 *  - The legacy tool-named aliases (`perfana-start-dynatrace`,
 *    `perfana-start-elasticsearch`) are not offered. They exist so deep links
 *    saved before the rename keep resolving; no report text predates this
 *    feature, so there is nothing to keep working.
 *
 * The Comparison group and any test run configuration key are NOT resolved from
 * the test run row and so are absent from buildReportVariableValues — they are
 * queries. The API adds both to the values map before substituting — see
 * ReportHtmlCompilerService.resolveVariables.
 */

/**
 * Menu groups the picker renders, in order. `Test run configuration` holds the
 * keys this run's CI pipeline posted, which is why it is not part of the static
 * catalogue below — it is assembled at runtime.
 */
export type ReportVariableGroup =
  | 'Test run'
  | 'Timing'
  | 'Comparison'
  | 'Test run configuration';

/** The group heading the runtime-assembled config keys live under. */
export const CONFIG_VARIABLE_GROUP: ReportVariableGroup = 'Test run configuration';

export interface ReportVariable {
  /** Without braces, e.g. `perfana-workload`. */
  key: string;
  label: string;
  /** Shown under the label in the picker — what it resolves to. */
  hint: string;
  /** Menu grouping. */
  group: ReportVariableGroup;
}

export const REPORT_VARIABLES: readonly ReportVariable[] = [
  { key: 'perfana-system-under-test', label: 'System under test', hint: 'e.g. Checkout', group: 'Test run' },
  { key: 'perfana-test-environment', label: 'Test environment', hint: 'e.g. acceptance', group: 'Test run' },
  { key: 'perfana-workload', label: 'Workload', hint: 'e.g. peak-load', group: 'Test run' },
  { key: 'perfana-test-run-id', label: 'Test run ID', hint: 'e.g. run-2026-08-25-01', group: 'Test run' },
  { key: 'perfana-application-release', label: 'Application release', hint: 'Release under test, if recorded', group: 'Test run' },
  { key: 'perfana-build-result-url', label: 'CI build result URL', hint: 'Plain URL, if recorded', group: 'Test run' },
  { key: 'perfana-tags', label: 'Tags', hint: 'Comma-separated', group: 'Test run' },

  { key: 'perfana-start-datetime', label: 'Start time', hint: 'e.g. 25 August 2026, 14:03 UTC', group: 'Timing' },
  { key: 'perfana-end-datetime', label: 'End time', hint: 'e.g. 25 August 2026, 14:33 UTC', group: 'Timing' },
  { key: 'perfana-duration', label: 'Duration', hint: 'e.g. 30m 0s', group: 'Timing' },

  {
    key: 'perfana-previous-test-run-id',
    label: 'Previous test run ID',
    hint: 'The run before this one, same system/environment/workload',
    group: 'Comparison',
  },
  {
    key: 'perfana-previous-start-datetime',
    label: 'Previous start time',
    hint: 'e.g. 24 August 2026, 14:03 UTC',
    group: 'Comparison',
  },
  {
    key: 'perfana-previous-end-datetime',
    label: 'Previous end time',
    hint: 'e.g. 24 August 2026, 14:33 UTC',
    group: 'Comparison',
  },
  {
    key: 'perfana-previous-application-release',
    label: 'Previous application release',
    hint: 'Release of the previous run, if recorded',
    group: 'Comparison',
  },
] as const;

/**
 * Test run configuration keys that must never be resolved into report prose.
 *
 * A rendered report is stored as HTML and served from the PUBLIC share and
 * public-PDF endpoints, with no authentication. Test run configuration is
 * whatever the CI pipeline posted — full environment and system-property dumps
 * are the norm — so without this a single `{some.key}` moves a credential from
 * an org-scoped table onto an anonymously reachable page. The author has to type
 * the placeholder, but the picker lists every key on the run, which makes it an
 * easy accident rather than a deliberate act.
 *
 * Deliberately blunt and deliberately applied in BOTH directions: the picker
 * does not offer these keys and the resolver does not substitute them, so a
 * secret-shaped placeholder stays literal in the output instead of resolving
 * somewhere the author cannot see. Built-in `perfana-*` variables are never
 * matched against this — they are a fixed catalogue with no secrets in it.
 */
const SECRETISH_KEY =
  // Word-ish boundaries on the short, ambiguous stems. A bare /auth/ also matched
  // `author`, `authors`, `authored_by` and `authoring_tool`, and a bare /pass/
  // matched `passengers`, `pass_rate` and `passed_checks` — all silently absent
  // from the picker and silently unresolvable, with nothing in the UI to explain it.
  /password|passwd|passphrase|secret|token|credential|api[-_]?key|private[-_]?key|(^|[^a-z])auth([^a-z]|$)|(^|[^a-z])cert([^a-z]|$)|signing[-_]?key|access[-_]?key/i;

/**
 * Value shapes that carry a credential regardless of what the key is called.
 *
 * The key-name filter alone is a low bar: the standard ways a CI pipeline leaks a
 * secret into test run configuration do not use a secret-shaped key at all —
 * `DATABASE_URL`/`JDBC_URL`/`connection_string` hold `scheme://user:pw@host`,
 * `SENTRY_DSN` and signed webhook URLs embed the token in the URL, and
 * `JAVA_TOOL_OPTIONS`/`jvm_args`/`command_line` carry `-Dspring.datasource.password=…`.
 * Every one of those would have resolved into a report served from the public
 * share and PDF endpoints.
 */
const SECRETISH_VALUE = [
  // scheme://user:password@host
  /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i,
  // -Dfoo.password=… / --token=… / PASSWORD=… inside a longer argument string
  /(?:^|[\s-])(?:-D)?[\w.]*(?:password|passwd|secret|token|apikey|api[-_]key|credential)[\w.]*\s*=\s*\S/i,
  // Bearer / Basic authorization headers pasted into a value
  /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{16,}/i,
  // PEM private key material
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** True when a test run configuration key looks like it carries a secret. */
export function isSecretishConfigKey(key: string): boolean {
  return SECRETISH_KEY.test(key);
}

/**
 * True when a configuration VALUE looks like it carries a credential, whatever
 * its key is called. Checked at resolve time, where the value is in hand — the
 * picker only ever sees keys, so this is the half the picker cannot do.
 */
export function isSecretishConfigValue(value: string): boolean {
  return SECRETISH_VALUE.some((re) => re.test(value));
}

/**
 * Neutralise markdown syntax in a value before it is spliced into prose.
 *
 * Substitution happens on the markdown SOURCE, before renderMarkdown runs, so
 * HTML in a value is escaped but markdown structure in one is interpreted. Report
 * prose is written by an org member; these values are written by anything holding
 * an API key that can POST to /test-runs/:id/configs, and the rendered page is
 * reachable unauthenticated over a share link. Without this a config value of
 * `Click [here](https://elsewhere.example) to view` becomes a real link in a
 * published report — SAFE_HREF permits https, so nothing downstream stops it.
 *
 * Targets the constructs renderMarkdown actually implements, and — just as
 * important — only the ones a backslash can actually break.
 *
 * renderMarkdown does not process backslash escapes. It escapes HTML and then
 * pattern-matches, so a backslash is never consumed; it survives into the output.
 * Two consequences, both measured against the real renderer:
 *
 *  - A backslash is a construct-BREAKER here, not an escape, and it only breaks a
 *    construct whose pattern it splits. `\[here\]\(url\)` is still a link, because
 *    the label group is `[^\]\n]+` and happily matches `here\`. What breaks it is
 *    the backslash between the `]` and the `(`, so that is the only place one goes.
 *    Escaping `` ` `` or `*` does nothing at all — the inline patterns do not look
 *    at the preceding character — so those are deliberately NOT escaped: it printed
 *    stray backslashes around text that still came out bold. Inline emphasis and
 *    code are the residue: they can restyle a phrase but cannot emit an href or any
 *    HTML, so a value can deface a sentence, not plant a link. Closing that needs
 *    renderMarkdown to consume escapes, which is a change to markdown.ts.
 *  - Every backslash shows up in the published report, so escaping ordinary
 *    punctuation is a visible defect, not a harmless precaution. The blunt version
 *    escaped all of CommonMark's, which printed a release of `1.2.3` as `1\.2\.3`
 *    and a test run id as `run\-2026\-08\-25\-01`.
 *
 * So: split `](`, and neutralise the line-leading heading and list markers, which
 * a backslash genuinely does break. Anything a real value contains — dots, dashes,
 * colons, plus signs, parentheses that are not part of a link — comes through
 * untouched.
 */
export function escapeMarkdownValue(value: string): string {
  return (
    value
      // `[label](href)` — split the one join the pattern cannot do without.
      .replace(/](?=\()/g, ']\\')
      // Heading and bullet markers, line-leading only. renderMarkdown trims each
      // line before matching, so leading whitespace does not protect them.
      .replace(/^([ \t]*)(#{1,6}(?=\s)|[-*](?=\s|$))/gm, '$1\\$2')
      // Ordered-list marker. The backslash goes between the number and its
      // delimiter rather than in front of the digit, so the line still starts
      // with the number the author sees.
      .replace(/^([ \t]*\d+)(?=[.)](?:\s|$))/gm, '$1\\')
  );
}

/**
 * Keys the API resolves with a query rather than from the test run row — the whole
 * Comparison group, all four answered by the same previous-run lookup.
 */
export const REPORT_VARIABLES_NEEDING_LOOKUP = [
  'perfana-previous-test-run-id',
  'perfana-previous-start-datetime',
  'perfana-previous-end-datetime',
  'perfana-previous-application-release',
] as const;

/** Shape the resolver needs — a TestRun satisfies it structurally. */
export interface ReportVariableSource {
  testRunId?: string;
  testEnvironment?: string;
  workload?: string;
  startTime?: Date | string | null;
  endTime?: Date | string | null;
  duration?: number | null;
  completed?: boolean | null;
  tags?: string[] | null;
  applicationRelease?: string | null;
  ciBuildResultsUrl?: string | null;
  systemUnderTest?: { name?: string } | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * `23 August 2026, 16:47 UTC` — the form meant to be read in a sentence, and the
 * only timestamp spelling the picker still offers. The ISO and epoch variables
 * below it exist for machines and are resolved-but-unlisted (see the file header).
 *
 * UTC on purpose: the report is read by whoever it is sent to, and there is no
 * reader timezone at render time. Naming the zone beats guessing it. Written out
 * by hand rather than via toLocaleString, so the output does not depend on the
 * locale and ICU data that happen to be in the API container.
 */
function readableUtc(d: Date | null): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/**
 * ISO 8601 at the server's UTC offset, seconds precision — the same value the
 * deep-link resolver produces, minus the `%2B` encoding: the URL-encoding exists
 * so the value survives a query parser, and printing `%2B02:00` in a sentence is
 * just wrong. Resolved but not offered; see the file header.
 */
function iso8601Offset(d: Date | null): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function humanDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h ? `${h}h` : '', h || m ? `${m}m` : '', `${s}s`].filter(Boolean).join(' ');
}

/**
 * Values for every catalogue key derivable from the test run row itself.
 * Missing data resolves to ''; the lookup-only keys are absent entirely, so
 * substitution leaves them untouched until the API fills them in.
 *
 * Free-text fields go through escapeMarkdownValue on the way out; the date and
 * duration fields do not, because they are this file's own formatter output and
 * cannot contain markdown. See escapeMarkdownValue for why, and note that the
 * compiler escapes test run CONFIGURATION values itself — nothing escapes a
 * catalogue value twice.
 */
export function buildReportVariableValues(run: ReportVariableSource | null | undefined): Record<string, string> {
  const r = run ?? {};
  const start = toDate(r.startTime);
  // A running test has no end_time yet — deep links use "now" for it, so the
  // same sentence in a live report reads as elapsed-so-far rather than blank.
  const end = toDate(r.endTime) ?? (r.completed ? null : new Date());

  const epoch = (d: Date | null, unit: 'ms' | 's') =>
    d ? String(unit === 'ms' ? d.getTime() : Math.round(d.getTime() / 1000)) : '';

  return {
    'perfana-system-under-test': escapeMarkdownValue(r.systemUnderTest?.name ?? ''),
    'perfana-test-environment': escapeMarkdownValue(r.testEnvironment ?? ''),
    'perfana-workload': escapeMarkdownValue(r.workload ?? ''),
    'perfana-test-run-id': escapeMarkdownValue(r.testRunId ?? ''),
    'perfana-application-release': escapeMarkdownValue(r.applicationRelease ?? ''),
    // Escaped like the rest, and safe to escape precisely because the escape is
    // narrow: it touches only a `]` immediately followed by `(` and a line-leading
    // heading or list marker, neither of which occurs in a real build URL, so an
    // ordinary one comes through byte-for-byte and `[build]({perfana-build-result-url})`
    // keeps working. A CI-supplied value of `x) see [here](https://evil.example)`
    // still cannot close the author's link and open its own. (The blunt escape
    // would have mangled every `.` and `-` in the URL — see escapeMarkdownValue.)
    'perfana-build-result-url': escapeMarkdownValue(r.ciBuildResultsUrl ?? ''),
    // Each tag separately, so the `, ` joining them stays ours rather than
    // becoming escapable content.
    'perfana-tags': (r.tags ?? []).map(escapeMarkdownValue).join(', '),

    'perfana-start-datetime': readableUtc(start),
    'perfana-end-datetime': readableUtc(end),
    'perfana-duration': humanDuration(r.duration),

    // Resolved but no longer OFFERED — deliberately absent from REPORT_VARIABLES.
    //
    // These eight shipped in v0.2.78.0 and were dropped from the picker because a
    // sentence should not print machine timestamps. Dropping the resolver too is
    // what would actually hurt: substituteReportVariables leaves an unknown key
    // verbatim, so report text authored against v0.2.78.0 would start printing a
    // literal `{perfana-start-epoch-milliseconds}` into HTML that the share link
    // and the public PDF endpoint serve unauthenticated — a customer-visible
    // break in a document that already rendered correctly. Keep resolving them.
    // New prose should use the readable `perfana-start-datetime` spelling.
    'perfana-start-iso8601-utc': start ? start.toISOString() : '',
    'perfana-end-iso8601-utc': end ? end.toISOString() : '',
    'perfana-start-iso8601-offset': iso8601Offset(start),
    'perfana-end-iso8601-offset': iso8601Offset(end),
    'perfana-start-epoch-milliseconds': epoch(start, 'ms'),
    'perfana-start-epoch-seconds': epoch(start, 's'),
    'perfana-end-epoch-milliseconds': epoch(end, 'ms'),
    'perfana-end-epoch-seconds': epoch(end, 's'),
  };
}

/**
 * The Comparison group's values, from the previous run the API looked up.
 *
 * Lives here rather than in the compiler so the readable-UTC spelling is the one
 * the reported run's own timestamps use — two formatters would drift, and the two
 * dates sit in the same sentence.
 */
export function buildPreviousRunVariableValues(
  previous: ReportVariableSource | null | undefined,
): Record<string, string> {
  if (!previous) return {};
  return {
    // Free text, escaped for the same reason the current run's fields are: the id
    // and the release are whatever the CI pipeline posted, and this lands in the
    // markdown SOURCE of a page served unauthenticated. The two timestamps are
    // readableUtc output and need nothing.
    'perfana-previous-test-run-id': escapeMarkdownValue(previous.testRunId ?? ''),
    'perfana-previous-start-datetime': readableUtc(toDate(previous.startTime)),
    'perfana-previous-end-datetime': readableUtc(toDate(previous.endTime)),
    'perfana-previous-application-release': escapeMarkdownValue(previous.applicationRelease ?? ''),
  };
}

/**
 * One placeholder occurrence: `{`, then anything that is not a brace or a
 * newline, then `}`. Deliberately permissive about the inside — a test run
 * configuration key is whatever the CI pipeline posted, spaces included — and
 * deliberately strict about braces and newlines, so an unclosed `{` cannot run
 * away to the end of the document.
 *
 * Exported so callers can cheaply ask "is there anything to resolve here?"
 * without duplicating the shape. Use `.test()` on a fresh copy or reset
 * lastIndex: this literal carries the `g` flag and is therefore stateful.
 */
export const REPORT_VARIABLE_PATTERN = /\{([^{}\n]+)\}/g;

/** True when the text contains at least one placeholder-shaped token. */
export function hasReportVariable(text: string | null | undefined): boolean {
  return Boolean(text) && new RegExp(REPORT_VARIABLE_PATTERN.source).test(text as string);
}

/**
 * Substitute `{…}` placeholders in authored text.
 *
 * Only the keys present in `values` are replaced — everything else, including
 * a mistyped `{perfana-workoad}`, is left exactly as written. A typo staying
 * visible in the draft is how the author finds it, and prose legitimately
 * contains braces.
 *
 * Scans with ONE fixed pattern and looks each key up in `values`, rather than
 * compiling an alternation of the keys. `values` carries test run configuration
 * keys, which are author-defined and unbounded: building a regex out of them
 * cost a sort plus a compile on every call, needed escaping and longest-first
 * ordering to stay correct, and made a pathological key set able to throw out
 * of `new RegExp` — a throw that would have failed the whole report render,
 * since it sits outside the caller's try/catch. A hash lookup has none of
 * that and is linear in the text instead of in the key count.
 *
 * Runs BEFORE markdown rendering, so a resolved value is escaped by the
 * renderer along with everything else — values come from test run data, which
 * is user-supplied (a test run id is whatever the CI pipeline posted).
 */
export function substituteReportVariables(
  text: string | null | undefined,
  values: Record<string, string>,
): string {
  if (!text) return text ?? '';
  return text.replace(
    new RegExp(REPORT_VARIABLE_PATTERN.source, 'g'),
    // Own properties only. `values[key]` walks the prototype chain, so `{toString}`,
    // `{constructor}` and `{__proto__}` in ordinary prose resolved to JS internals and
    // printed them into report HTML that share links serve unauthenticated. It also
    // silently broke the typo-passthrough contract for any sentence mentioning one.
    (match, key: string) =>
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  );
}
