/**
 * `ds_metrics`' varchar widths, the clamp both JS-binding writers of that table apply, and the
 * dedup that has to follow it.
 *
 * ONE definition, because two hand-kept copies is what shipped the bug: `MetricsPipeline`
 * (full collection) clamped and `MetricProcessor` (incremental collection) did not, so a
 * Grafana panel with no `legendFormat` — whose series Grafana names after the query's whole
 * label set, routinely past 255 characters — collected fine on an analysis and failed the
 * live collection with `22001 value too long for type character varying(255)`. That failure
 * is not recoverable by retrying: the source soft-fails and re-queues every scheduler cycle
 * with 0 data points, for the whole run.
 *
 * Clamping is a lossy repair, not a fix. `metric_name` is part of the primary key, so two
 * series agreeing on their first 255 characters collapse into one row — which is why every
 * caller is expected to report `truncationWarning()`.
 */
export const DS_METRICS_VARCHAR_LIMITS: Readonly<Record<string, number>> = {
  metric_name: 255,
  dashboard_uid: 255,
  dashboard_label: 255,
  panel_title: 500,
  unit: 50,
};

/** Hoisted: the clamp runs once per row of every collection, and `Object.entries` allocates. */
const LIMIT_ENTRIES = Object.entries(DS_METRICS_VARCHAR_LIMITS);

/** How many distinct panel/column pairs a warning names before it stops listing them. */
export const MAX_TRUNCATION_REPORTS = 10;

/**
 * How much of a panel title or dashboard label reaches the log line.
 *
 * Enough to name the panel to fix in Grafana, and no more: both are external strings of
 * unbounded length (`ds_panels.dashboard_label` is bare `character varying`), they are read
 * off the PRE-clamp row, and up to `MAX_TRUNCATION_REPORTS` of them share one message that is
 * re-emitted every collection pass.
 */
const IDENTITY_IN_LOG = 80;

/**
 * C0 controls plus DEL, built from codepoints rather than written as literals so the pattern
 * carries no control character of its own (and needs no lint suppression to say so).
 */
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}]`, 'g');

/**
 * What goes in a report entry. Composed in the clamp because that is where the row is in
 * scope, and sanitised there for the same reason.
 *
 * The production logger is `pino(loggerConfig)`, whose JSON escapes a newline inside `msg` —
 * but in development `logger.ts` attaches pino-pretty, which prints `msg` raw, so a dashboard
 * label carrying `\n` plus a fake level prefix renders as an extra console line. Control
 * characters are stripped rather than escaped: this is a human-facing identifier, not a value
 * anything parses.
 */
function identityForLog(value: unknown): string {
  return clampString(String(value ?? ''), IDENTITY_IN_LOG).replace(CONTROL_CHARS, ' ');
}

/**
 * Cut a string to `limit` without splitting a surrogate pair.
 *
 * Measured in CODE POINTS, because that is what `varchar(n)` counts. `String.length` is UTF-16
 * code units, and UTF-16 is up to two of those per code point, so it over-reports: a
 * 255-code-point name holding 45 astral characters is 300 units, and a width test on `.length`
 * would clamp a value Postgres stores intact — losing characters, warning about a legal name,
 * and (since `metric_name` is in the conflict key) possibly merging two names that differ. The
 * old `substring` cut had the mirror bug at the boundary: it could split a surrogate pair and
 * leave a lone high surrogate, which Node re-encodes as U+FFFD on the way to Postgres. Slicing
 * code points cannot do either. Same trap, other end: see `MAX_RESPONSE_CODE_LENGTH` in
 * `scenario-processors.ts`, where the two units are what halves the budget.
 *
 * `.length > limit` stays in front of this as a cheap pre-filter: it can only over-report, so a
 * string it passes is certainly within the limit and needs no code-point walk.
 */
function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) {count++;}
  return count;
}

function clampString(value: string, limit: number): string {
  return [...value].slice(0, limit).join('');
}

/**
 * What one collection pass had to clamp.
 *
 * `seen` holds every distinct panel/column pair, `named` the first `MAX_TRUNCATION_REPORTS` of
 * them, so the count of unlisted pairs is `seen.size - named.size` — **distinct by
 * construction**. A separate counter was wrong at exactly the number it reported: it was
 * incremented per occurrence, and one offending panel repeats on every timestamp of the window,
 * so a single unlisted panel on a 500-point run told the operator "and 500 more". `seen` is
 * bounded by panels x clamped columns for the pass, not by data points.
 *
 * There is deliberately no "did anything clamp" flag. One existed, to gate the full-collection
 * writer's dedup and spare it a whole-run Map — and it was worse than useless: the answer is yes
 * exactly on the dashboard-with-no-legendFormat run the clamp exists for, so the Map was
 * allocated on the pathological run and skipped on the healthy one. Both writers now dedup
 * unconditionally over a bounded set instead.
 */
export interface TruncationReport {
  seen: Set<string>;
  named: Set<string>;
}

export function newTruncationReport(): TruncationReport {
  return { seen: new Set<string>(), named: new Set<string>() };
}

/**
 * Clamp a `ds_metrics` row's strings to their column widths, recording what was cut.
 *
 * Returns the row unchanged — the same object, no copy — when nothing overflows, which is
 * every row of a healthy collection. A value exactly as wide as its column fits, so it takes
 * no branch: the comparison is `>`, never `>=`.
 *
 * Call this BEFORE any dedup on the conflict key: two names agreeing on their first 255
 * characters have to collapse to one row there, or the batch is rejected outright with
 * "cannot affect row a second time" (21000). See `MAX_RESPONSE_CODE_LENGTH` in
 * `scenario-processors.ts` for the same trap on the perf-test side.
 */
export function clampToDsMetricsWidths<T extends object>(row: T, report: TruncationReport): T {
  let clamped: Record<string, unknown> | undefined;
  for (const [col, limit] of LIMIT_ENTRIES) {
    const value = (row as unknown as Record<string, unknown>)[col];
    // `.length` is a pre-filter that only ever over-reports; the real test is code points.
    if (typeof value === 'string' && value.length > limit && codePointLength(value) > limit) {
      clamped ??= { ...(row as unknown as Record<string, unknown>) };
      clamped[col] = clampString(value, limit);
      // Keyed per panel and column, not per row: one over-long series name repeats on every
      // timestamp of the window, so a per-row count would be in the thousands.
      const r = row as unknown as Record<string, unknown>;
      const entry = `${col} on panel ${r.panel_id ?? '?'} "${identityForLog(r.panel_title)}" of "${identityForLog(r.dashboard_label)}"`;
      if (report.seen.has(entry)) {
        continue;
      }
      report.seen.add(entry);
      if (report.named.size < MAX_TRUNCATION_REPORTS) {
        report.named.add(entry);
      }
    }
  }
  return (clamped as T | undefined) ?? row;
}

/**
 * The warning line for a collection that had to clamp, or `null` when it did not.
 *
 * One string with everything interpolated, on purpose: both shared pino loggers drop a
 * second-argument object, so a structured field would simply not be emitted.
 */
export function truncationWarning(report: TruncationReport): string | null {
  if (report.named.size === 0) {return null;}
  // A `legendFormat` changes the SERIES NAME and nothing else, so it is the remedy for
  // `metric_name` only. Telling an operator to add one for an over-long dashboard label — every
  // 60 s for the life of a live run — sends them somewhere that cannot help.
  const named = [...report.named];
  const series = named.filter(entry => entry.startsWith('metric_name '));
  const others = named.filter(entry => !entry.startsWith('metric_name '));
  const unlisted = report.seen.size - report.named.size;
  return (
    'Truncated over-long ds_metrics values to the column width ' +
    '(series sharing a truncated metric_name merge, so data can be lost).' +
    (series.length > 0 ? ` Give these a legendFormat in Grafana: ${series.join('; ')}.` : '') +
    (others.length > 0 ? ` Shorten these in Grafana: ${others.join('; ')}.` : '') +
    (unlisted > 0 ? ` (and ${unlisted} more, not listed)` : '')
  );
}

/**
 * The `ds_metrics` conflict key, in order.
 *
 * Both writers' statements declare the same tuple in their `ON CONFLICT (...)`, and
 * `uniq_ds_metrics_upsert` is the index behind it. The dedup below builds its key from THIS
 * array, and `ds-metrics-columns.test.ts` reads both writers' SQL off disk and compares their
 * conflict lists to it — a third hand-kept copy of the same tuple is how the clamp drifted in
 * the first place, and a key narrower or wider than the statement's silently keeps a row
 * Postgres rejects, or drops one it would have kept.
 */
export const DS_METRICS_CONFLICT_KEY = [
  'test_run_id',
  'application_dashboard_id',
  'panel_id',
  'metric_name',
  'time',
] as const;

/**
 * Milliseconds for the key's `time` component, without allocating a `Date` per row.
 *
 * `time` is already a `Date` on both writers' paths, so wrapping it in `new Date()` cost a
 * throwaway allocation and ~3.4x the time on every data point of every write (measured over
 * 1M rows: 54.8 ms against 16.0 ms).
 *
 * An unparseable STRING falls back to its own text rather than to `NaN`, which stringifies to
 * one literal and would collapse every point of that metric into a single row. A `NaN` number
 * and an `Invalid Date` carry no distinguishing text, so they still collapse — nothing can keep
 * them apart. In every case the row is unwritable (Postgres rejects it at the `timestamptz`
 * bind), so this only decides which failure the operator sees.
 */
function keyTime(value: unknown): string {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? String(ms) : String(value);
  }
  if (typeof value === 'number') {
    return String(value);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? String(parsed) : String(value);
}

/**
 * One row per `ds_metrics` conflict key, last write winning.
 *
 * A multi-row `INSERT ... ON CONFLICT DO UPDATE` carrying the same key twice is rejected
 * outright with `cannot affect row a second time` (21000), which fails the whole statement.
 * Two sources reach that: two Dynatrace queries on one panel with the same metric name and no
 * group-by, and — since the clamp above exists — two series whose names agree on their first
 * 255 characters, which is what a `topk()` panel looks like when the label that distinguishes
 * its series sits past the cut.
 *
 * So this runs AFTER `clampToDsMetricsWidths` and BEFORE the rows are split into statements:
 * deduplicating raw names would leave the collision to be discovered by Postgres, and
 * deduplicating per statement would leave it to whichever batch happened to hold both rows.
 *
 * The key is joined with NUL, which no component can contain: `metric_name` is free text that
 * routinely holds a `|`, and `panel_id` is typed `number | string` on the incremental path, so
 * a printable delimiter is ambiguous in principle even where the DDL makes it unreachable.
 */
export function dedupeByDsMetricsKey<T extends object>(rows: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const r = row as unknown as Record<string, unknown>;
    byKey.set(
      `${String(r.test_run_id)}\u0000${String(r.application_dashboard_id)}\u0000${String(r.panel_id)}\u0000${String(r.metric_name)}\u0000${keyTime(r.time)}`,
      row
    );
  }
  return [...byKey.values()];
}

/**
 * The note a writer logs when the dedup actually dropped rows, or `null` when it did not.
 *
 * One builder, two levels, because the two paths disagree about how routine it is. On a full
 * collection it is never routine — either the clamp merged two of a panel's series, or the panel
 * has two targets rendering one series name, and in both cases a series is gone — so it is a
 * WARNING naming the panel. On the incremental path two Dynatrace queries on one panel with the
 * same metric name and no group-by produce one on every 60 s tick by design, so it is debug;
 * warning there would be noise for the life of every run.
 *
 * Before this existed, that loss was visible on neither path: the collision used to be a 21000
 * that failed the whole statement, which was at least loud.
 */
export function collapsedKeyNote(before: number, after: number, where?: string): string | null {
  if (after >= before) {return null;}
  return (
    `Collapsed ${before - after} ds_metrics row(s) sharing a conflict key ` +
    `(${DS_METRICS_CONFLICT_KEY.join(', ')})${where ? ` on ${where}` : ''}; ` +
    'the last value of each wins, so a series lost points.'
  );
}
