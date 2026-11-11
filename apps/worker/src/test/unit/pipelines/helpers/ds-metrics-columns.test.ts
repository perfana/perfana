import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  collapsedKeyNote,
  DS_METRICS_CONFLICT_KEY,
  DS_METRICS_VARCHAR_LIMITS,
  MAX_TRUNCATION_REPORTS,
  clampToDsMetricsWidths,
  dedupeByDsMetricsKey,
  newTruncationReport,
  truncationWarning,
} from '../../../../pipelines/helpers/ds-metrics-columns.js';

/**
 * The clamp both `ds_metrics` writers share. Its callers are tested against the statement
 * they bind (`MetricsPipeline.test.ts`, `metric-processor-upsert.test.ts`); what is tested
 * here is the module's own contract — the quiet path, the report cap, and the widths.
 */

const row = (over: Record<string, unknown> = {}) => ({
  test_run_id: 'tr-1',
  panel_id: 1,
  panel_title: 'Configured Maximum Heap Size',
  dashboard_label: 'JVM',
  dashboard_uid: 'uid-1',
  metric_name: 'memory_maxHeap_bytes',
  unit: 'bytes',
  value: 1,
  ...over,
});

describe('clampToDsMetricsWidths', () => {
  /**
   * Value: protects=a healthy collection allocates no copy and the caller's record is never
   *   mutated, so the clamp can be applied in a hot per-datapoint loop and the pre-clamp
   *   records stay readable by their owner;
   * fails_when=the clamp is "simplified" to spread every row unconditionally, or to assign
   *   the truncated value back onto the input instead of onto a copy;
   * why_new=both caller tests read only the bound parameters, which are identical either way
   *   — nothing observes the identity of the returned object or the state of the input;
   * seam=none;
   * no_claim=says nothing about how much the copy costs, only that there is not one.
   */
  it('returns the very same object when nothing overflows, and never mutates the input', () => {
    const clean = row();
    expect(clampToDsMetricsWidths(clean, newTruncationReport())).toBe(clean);

    // A null in a limited column and a number in an unlimited one are left alone, rather
    // than tripping the string branch.
    const sparse = row({ unit: null, panel_title: null });
    expect(clampToDsMetricsWidths(sparse, newTruncationReport())).toBe(sparse);

    const long = 'a'.repeat(300);
    const overflowing = row({ metric_name: long });
    const clamped = clampToDsMetricsWidths(overflowing, newTruncationReport());
    expect(clamped).not.toBe(overflowing);
    expect(overflowing.metric_name).toBe(long);
    // Every other field survives the copy — a spread that lost one would bind a NULL.
    expect(clamped).toEqual({ ...row(), metric_name: long.slice(0, 255) });
  });

  /**
   * Value: protects=the WARN names at most MAX_TRUNCATION_REPORTS panels and admits when it
   *   stopped listing, so a dashboard with no legendFormat anywhere cannot turn one warning
   *   into an unbounded log line;
   * fails_when=the `report.named.size < MAX_TRUNCATION_REPORTS` guard is dropped (the set then
   *   grows with the dashboard), or the overflow is inferred from the set's size again, so a
   *   pass with exactly MAX offending panels claims a list it did not shorten;
   * why_new=both caller tests overflow a single panel, so the set never reaches 2 entries,
   *   let alone the cap;
   * seam=none;
   * no_claim=does not claim the cap is the right number, nor that entries are ordered.
   */
  it('stops naming panels at the cap, and says the list was capped', () => {
    const report = newTruncationReport();
    for (let panel = 1; panel <= MAX_TRUNCATION_REPORTS + 2; panel++) {
      clampToDsMetricsWidths(row({ panel_id: panel, metric_name: 'z'.repeat(300) }), report);
    }
    expect(report.named.size).toBe(MAX_TRUNCATION_REPORTS);
      expect(report.seen.size).toBe(MAX_TRUNCATION_REPORTS + 2);
    expect(truncationWarning(report)).toContain('and 2 more, not listed');

    // Keyed per panel and column, not per row: the same over-long name on 500 timestamps of
    // one panel is one entry, which is the whole reason the cap is rarely reached.
    const repeated = newTruncationReport();
    for (let i = 0; i < 500; i++) {
      clampToDsMetricsWidths(row({ metric_name: 'z'.repeat(300) }), repeated);
    }
    expect(repeated.named.size).toBe(1);
      expect(repeated.seen.size).toBe(1);

    const warning = truncationWarning(repeated);
    expect(warning).toContain('metric_name on panel 1 "Configured Maximum Heap Size" of "JVM"');
    expect(warning).not.toContain('not listed');
  });

  /**
   * Value: protects=the remedy matches the column — a legendFormat renames a SERIES, so an
   *   over-long dashboard label or unit must not be reported with that advice;
   * fails_when=the message goes back to one unconditional "Give these a legendFormat" sentence,
   *   which sends an operator to a setting that cannot fix the value named beside it;
   * why_new=the clamp reports five columns and every existing case truncates metric_name only;
   * seam=none;
   * no_claim=does not assert the wording of either sentence beyond the verb that distinguishes
   *   them.
   */
  it('asks for a legendFormat only for the series name', () => {
    const report = newTruncationReport();
    clampToDsMetricsWidths(row({ metric_name: 'z'.repeat(300) }), report);
    clampToDsMetricsWidths(row({ panel_id: 2, dashboard_label: 'L'.repeat(300) }), report);

    const warning = truncationWarning(report)!;
    // The legendFormat sentence, bounded at the start of the next one.
    const legend = warning.slice(
      warning.indexOf('legendFormat'),
      warning.indexOf('Shorten these')
    );
    expect(legend).toContain('metric_name on panel 1');
    // The label is reported, but not under the legendFormat advice.
    expect(legend).not.toContain('dashboard_label');
    expect(warning).toContain('Shorten these in Grafana: dashboard_label on panel 2');
  });

  /**
   * Value: protects=the unlisted count is a number of PANELS, not of data points — one offending
   *   panel past the cap reads "and 1 more" however many timestamps it repeats on;
   * fails_when=the count goes back to a per-occurrence counter, which reported "and 500 more"
   *   for a single unlisted panel on a 500-point run (proved on the real module, and invisible
   *   to a fixture whose extra panels each truncate once);
   * why_new=the cap test's extras appear once each, so it reads identically either way;
   * seam=none;
   * no_claim=does not pin WHICH panels are named, only how many are counted as unlisted.
   */
  it('counts unlisted panels, not their data points', () => {
    const report = newTruncationReport();
    for (let panel = 1; panel <= MAX_TRUNCATION_REPORTS; panel++) {
      clampToDsMetricsWidths(row({ panel_id: panel, metric_name: 'z'.repeat(300) }), report);
    }
    // One extra panel, clamped on 500 timestamps.
    for (let i = 0; i < 500; i++) {
      clampToDsMetricsWidths(row({ panel_id: 99, metric_name: 'z'.repeat(300) }), report);
    }

    expect(report.named.size).toBe(MAX_TRUNCATION_REPORTS);
    expect(truncationWarning(report)).toContain('(and 1 more, not listed)');
  });

  /**
   * Value: protects=a value exactly as wide as its column is left alone — same object, and no
   *   panel added to the report — because it fits and nothing was cut;
   * fails_when=the comparison becomes `>=`, which copies the row AND tells the operator to add
   *   a legendFormat to a panel whose names are perfectly legal (mutation-proven: `>` to `>=`
   *   left all 69 tests of this diff green before this case existed);
   * why_new=every other fixture here is 256, 267 or 300 units, so none of them sits ON the
   *   boundary, which is the only place the operator can be wrong;
   * seam=none;
   * no_claim=does not assert what Postgres accepts; `varchar(n)` counts characters while this
   *   counts UTF-16 units, so at-limit is a floor on what fits, not the exact ceiling.
   */
  it('leaves a value that exactly fills its column alone, and reports nothing', () => {
    const report = newTruncationReport();
    const atLimit = row({ metric_name: 'a'.repeat(255), unit: 'u'.repeat(50) });

    expect(clampToDsMetricsWidths(atLimit, report)).toBe(atLimit);
    expect(report.named.size).toBe(0);
    expect(report.seen.size).toBe(0);
    expect(truncationWarning(report)).toBeNull();
  });

  /**
   * Value: protects=an astral character straddling the cut is dropped whole rather than left as
   *   a lone surrogate, which Node re-encodes as U+FFFD, so a stored series name is shortened
   *   and never mangled;
   * fails_when=the cut goes back to a bare `substring(0, limit)`, which splits the pair;
   * why_new=an ASCII fixture cannot reach this — every other clamp test is single-code-unit, so
   *   the boundary case is unreachable from them (prior learning
   *   perfana-metric-name-bound-char-vs-utf16-units, 2026-10-13);
   * seam=none;
   * no_claim=says nothing about what Postgres stores; it asserts the string handed to the
   *   driver, not a round trip.
   */
  it('never cuts an astral character in half', () => {
    // 255 ASCII + one emoji = 256 code points (257 UTF-16 units), so the cut lands exactly on
    // the emoji — which a code-unit `substring` would have split down the middle.
    const name = `${'a'.repeat(255)}\u{1F600}`;
    expect([...name].length).toBe(256);
    expect(name.length).toBe(257);

    const clamped = clampToDsMetricsWidths(row({ metric_name: name }), newTruncationReport()) as Record<
      string,
      unknown
    >;
    const out = clamped.metric_name as string;

    expect(out).toBe('a'.repeat(255));
    expect(out.length).toBeLessThanOrEqual(255);
    // The giveaway for a split pair: a trailing unpaired high surrogate.
    const lastUnit = out.charCodeAt(out.length - 1);
    expect(lastUnit >= 0xd800 && lastUnit <= 0xdbff).toBe(false);
    // And it survives a UTF-8 round trip unchanged — a lone surrogate becomes U+FFFD here.
    expect(Buffer.from(out, 'utf8').toString('utf8')).toBe(out);
  });

  /**
   * Value: protects=a name Postgres would store intact is left alone — the width test counts
   *   CODE POINTS, which is what `varchar(n)` counts, not UTF-16 code units;
   * fails_when=the test goes back to `value.length > limit` alone, which over-reports by up to
   *   2x: this 255-code-point name is 300 units, so it would be truncated to ~210 characters,
   *   warned about, and (metric_name being part of the conflict key) could be merged with a
   *   different legal name;
   * why_new=every other fixture is ASCII, where units and code points are the same number, so
   *   the two measures are indistinguishable from them;
   * seam=none;
   * no_claim=does not prove Postgres accepts exactly 255 code points; it pins the measure this
   *   code uses, which is the one `varchar` documents.
   */
  it('leaves a 255-code-point name alone even though it is 300 UTF-16 units', () => {
    const report = newTruncationReport();
    // 210 ASCII + 45 emoji = 255 code points, 300 UTF-16 units.
    const name = 'a'.repeat(210) + '\u{1F600}'.repeat(45);
    expect([...name].length).toBe(255);
    expect(name.length).toBe(300);

    const atLimit = row({ metric_name: name });
    expect(clampToDsMetricsWidths(atLimit, report)).toBe(atLimit);
    expect(report.seen.size).toBe(0);
    expect(truncationWarning(report)).toBeNull();
  });
});

describe('truncationWarning', () => {
  /**
   * Value: protects=silence on the path every healthy collection takes — no WARN telling an
   *   operator to go add a legendFormat to a panel that is fine;
   * fails_when=the empty-set guard is dropped or inverted, which both writers would turn
   *   into a spurious WARN on every batch and every live tick;
   * why_new=no test calls either writer with rows that all fit AND asserts the logger stayed
   *   quiet; the clamp tests only assert the warning that IS emitted;
   * seam=none;
   * no_claim=does not assert the callers' `if (warning)` guard, which is still untested.
   */
  it('is null when nothing was truncated', () => {
    expect(truncationWarning(newTruncationReport())).toBeNull();
  });
});

describe('DS_METRICS_VARCHAR_LIMITS', () => {
  /**
   * Value: protects=the clamp widths ARE the `ds_metrics` column widths, which is the whole
   *   premise of the module — a hand-kept copy of a schema fact with nothing comparing it to
   *   the schema is a copy that rots;
   * fails_when=a migration changes one of these columns and the constant is not followed —
   *   widening metric_name (the tempting "fix" for the merge this module warns about) leaves
   *   the clamp truncating forever at 255 and merging series that would now fit, and
   *   narrowing any of them puts back the 22001 that killed live collection;
   * why_new=`check:entity-migrations` compares entities to migrations, not a worker constant,
   *   and no test reads the DDL;
   * seam=none — the DDL is read off disk, as `chart-tokens.spec.ts` reads the web tokens,
   *   because `packages/shared/database/migrations/schema-sql` is not in the shared package's
   *   `exports` map and importing it would fail `check:workspace-exports`;
   * no_claim=does NOT claim every varchar column of the table is clamped; test_run_id,
   *   created_by and updated_by are deliberately absent, being Perfana's own values.
   */
  it('matches the ds_metrics column widths in the consolidated schema', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // apps/worker/src/test/unit/pipelines/helpers -> repo root
    const schemaPath = resolve(
      here,
      '../../../../../../../packages/shared/src/database/migrations/schema-sql.ts'
    );
    const schema = readFileSync(schemaPath, 'utf8');

    // Fail loudly on a moved file or a renamed table rather than comparing every width
    // below against undefined.
    const ddl = /CREATE TABLE public\.ds_metrics \(([\s\S]*?)\n\)/.exec(schema);
    expect(ddl, `no ds_metrics DDL found in ${schemaPath}`).not.toBeNull();

    const widths = new Map<string, number>();
    for (const line of ddl![1]!.split('\n')) {
      const col = /^\s*"?([a-z_]+)"?\s+character varying\((\d+)\)/.exec(line);
      if (col) {
        widths.set(col[1]!, Number(col[2]));
      }
    }
    expect(widths.get('metric_name')).toBe(255);

    for (const [column, limit] of Object.entries(DS_METRICS_VARCHAR_LIMITS)) {
      expect(widths.get(column), `ds_metrics.${column} is not a varchar column`).toBeDefined();
      expect(widths.get(column), `ds_metrics.${column} width`).toBe(limit);
    }
  });
});

describe('DS_METRICS_CONFLICT_KEY', () => {
  /**
   * Value: protects=the dedup key IS the tuple both writers' statements declare in their
   *   `ON CONFLICT (...)`, so the dedup can neither keep a row Postgres rejects (key too
   *   narrow, 21000) nor drop one it would have kept distinct (key too wide, silent loss);
   * fails_when=a column is added to or removed from either writer's conflict list, or the key
   *   array is reordered against them (mutation-proven: adding `unit` to the incremental
   *   writer's ON CONFLICT left all 6 tests of that spec green before this case existed);
   * why_new=the widths have a drift guard against the DDL and the key had none, although it is
   *   the premise the whole dedup rests on and was a third hand-kept copy of the same tuple;
   * seam=none — the two writers' SQL is read off disk, as the width guard reads the DDL;
   * no_claim=does not check the Postgres index behind the clause; it compares the two
   *   statements to each other and to the key, not to `uniq_ds_metrics_upsert`.
   */
  it('matches the ON CONFLICT list of both ds_metrics writers', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const writers = {
      'metric-processor.ts': '../../../../pipelines/helpers/incremental/metric-processor.ts',
      'MetricsPipeline.ts': '../../../../pipelines/MetricsPipeline.ts',
    };

    for (const [name, rel] of Object.entries(writers)) {
      const source = readFileSync(resolve(here, rel), 'utf8');
      // EVERY clause, not just the first: a second upsert added to the file would otherwise
      // go unchecked, and an unrelated one placed above would hijack the assertion.
      const clauses = [...source.matchAll(/ON CONFLICT \(([^)]*)\)/g)];
      expect(clauses.length, `no ON CONFLICT clause found in ${name}`).toBeGreaterThan(0);

      for (const clause of clauses) {
        const columns = clause[1]!.split(',').map(c => c.trim());
        expect(columns, `${name} ON CONFLICT list`).toEqual([...DS_METRICS_CONFLICT_KEY]);
      }
    }
  });
});

describe('dedupeByDsMetricsKey', () => {
  const at = '2024-01-01T00:30:00.000Z';
  const point = (over: Record<string, unknown> = {}) => ({
    test_run_id: 'tr-1',
    application_dashboard_id: 'ad-1',
    panel_id: 1,
    metric_name: 'm',
    time: new Date(at),
    value: 1,
    ...over,
  });

  /**
   * Value: protects=one instant is ONE key however the writers spell it — a `Date`, its own ISO
   *   string and the epoch number all collapse together, so re-collecting a window that
   *   previously arrived in the other shape updates the row instead of adding a second one;
   * fails_when=the time component goes back to a plain `String(r.time)`, or an arm of `keyTime`
   *   is changed so the three spellings stop agreeing;
   * why_new=`keyTime` has three arms and both caller specs only ever pass a `Date`, so two of
   *   them were reachable in production and unexercised by any test (the string arm is live:
   *   `FlattenedMetricRecord.time` is `Date | string`);
   * seam=none;
   * no_claim=says nothing about sub-millisecond instants, which this key deliberately cannot
   *   tell apart — see the module comment.
   */
  it('treats a Date, its ISO string and its epoch number as one key', () => {
    const rows = [
      point({ value: 1 }),
      point({ time: at, value: 2 }),
      point({ time: new Date(at).getTime(), value: 3 }),
    ];
    const unique = dedupeByDsMetricsKey(rows);

    expect(unique).toHaveLength(1);
    // Last write wins, so the surviving row is the epoch-number one.
    expect(unique[0]!.value).toBe(3);
  });

  /**
   * Value: protects=each component of the conflict key separates rows, so the dedup can never
   *   merge two rows Postgres would have kept apart;
   * fails_when=a component is dropped from the key, or the NUL join is replaced by a printable
   *   delimiter that a `metric_name` can itself contain;
   * why_new=the drift guard proves the key MATCHES the statement; nothing proved the key
   *   actually discriminates on each of its parts;
   * seam=none;
   * no_claim=does not prove the Postgres index agrees — that is the drift guard's job.
   */
  it('keeps rows that differ in any one key component', () => {
    const rows = [
      point(),
      point({ test_run_id: 'tr-2' }),
      point({ application_dashboard_id: 'ad-2' }),
      point({ panel_id: 2 }),
      point({ metric_name: 'other' }),
      point({ time: new Date('2024-01-01T00:31:00.000Z') }),
    ];
    expect(dedupeByDsMetricsKey(rows)).toHaveLength(rows.length);

    // A `|` inside a metric name cannot forge a neighbour's key: the join is NUL.
    const ambiguous = [
      point({ metric_name: 'a|1' }),
      point({ metric_name: 'a', panel_id: '1|a' as unknown as number }),
    ];
    expect(dedupeByDsMetricsKey(ambiguous)).toHaveLength(2);
  });
});

describe('collapsedKeyNote', () => {
  /**
   * Value: protects=silence when the dedup dropped nothing, which is every healthy collection —
   *   including the full-collection writer's skip arm, which passes the same number twice;
   * fails_when=the guard becomes `after > before` or `!==`, so a clean pass logs
   *   "Collapsed 0 row(s)" on every batch;
   * why_new=no caller test asserts the quiet side of this note, and the equal case is the one
   *   the skip arm always takes;
   * seam=none;
   * no_claim=does not assert the log level, only the message.
   */
  it('is null unless rows were actually dropped', () => {
    expect(collapsedKeyNote(10, 10)).toBeNull();
    expect(collapsedKeyNote(0, 0)).toBeNull();
    expect(collapsedKeyNote(10, 9)).toContain('Collapsed 1 ds_metrics row(s)');
    // It names the key it collapsed on, from the one definition the dedup uses.
    expect(collapsedKeyNote(10, 9)).toContain(DS_METRICS_CONFLICT_KEY.join(', '));
  });
});
