/**
 * Time bounds for the raw sample hypertables (`requests_raw`, `transactions`,
 * `requests_error`, `virtual_users`).
 *
 * A query filtering on `test_run_id` alone locks **every chunk** of the table,
 * plus every compressed twin, plus the indexes on both — ~11 relation locks per
 * chunk. With daily chunks and no retention policy that count grows ~365 per
 * table per year, forever, and the failure mode at the end is a hard
 * `out of shared memory`, not degradation. Measured on the dev database: 136
 * relation locks with no `time` predicate against 21 with one, same rows.
 * Issue #674.
 *
 * **The obvious refactor makes it worse.** Joining or subquerying `test_runs`
 * for `start_time` / `end_time` in the same statement gives *no* chunk
 * exclusion — exclusion for locking purposes happens at plan time, and a
 * correlated subquery is not available then — and adds the `test_runs`
 * relations on top: 150 locks, worse than no predicate at all. The window has
 * to be fetched first and passed as bind parameters, which is what
 * `TEST_RUN_TIMES_SQL` + `analysisBoundsFromRow` are for.
 */

/** `$1` is the test_run_id. Fetch this first, then bind the result. */
export const TEST_RUN_TIMES_SQL =
  `SELECT start_time, ramp_up, end_time, ramp_down FROM test_runs WHERE test_run_id = $1`;

/**
 * Slack either side of the recorded run window. Ingest lags: `requests_raw`
 * rows have been observed arriving up to 36s past `end_time`, and a load
 * generator's clock can run ahead of the recorded `start_time`. An hour costs
 * at most one extra daily chunk per side and keeps the bound from silently
 * dropping rows the unbounded query returned.
 */
export const RUN_WINDOW_PAD_MS = 60 * 60 * 1000;

export interface TestRunTimesRow {
  start_time?: string | Date | null;
  end_time?: string | Date | null;
  ramp_up?: string | number | null;
  ramp_down?: string | number | null;
}

export interface AnalysisBounds {
  startCutoff: Date | null;
  endCutoff: Date | null;
}

const seconds = (v: string | number | null | undefined): number => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Resolve the `time` bounds for a run from its `test_runs` row.
 *
 * Always returns the padded run window when the timestamps are there — that is
 * the lock bound, and it is not optional. `excludeRampUp` narrows it further to
 * the analysis timerange (the Performance Analysis card's toggle): start after
 * ramp-up, end before ramp-down. Ramp-down only applies to completed runs.
 *
 * A null cutoff means "no bound" — an in-flight run has no `end_time`, and
 * there are no chunks past now() to exclude anyway.
 */
export function analysisBoundsFromRow(
  row: TestRunTimesRow | null | undefined,
  excludeRampUp: boolean,
): AnalysisBounds {
  const startTime = row?.start_time ? new Date(row.start_time) : null;
  const endTime = row?.end_time ? new Date(row.end_time) : null;

  let startCutoff = startTime ? new Date(startTime.getTime() - RUN_WINDOW_PAD_MS) : null;
  let endCutoff = endTime ? new Date(endTime.getTime() + RUN_WINDOW_PAD_MS) : null;

  if (excludeRampUp) {
    const rampUp = seconds(row?.ramp_up);
    const rampDown = seconds(row?.ramp_down);
    if (startTime && rampUp > 0) startCutoff = new Date(startTime.getTime() + rampUp * 1000);
    if (endTime && rampDown > 0) endCutoff = new Date(endTime.getTime() - rampDown * 1000);
  }

  return { startCutoff, endCutoff };
}

/** The same shape as `TestRunTimesRow`, as the `TestRun` entity spells it. */
export interface TestRunTimesEntity {
  startTime?: string | Date | null;
  endTime?: string | Date | null;
  /** `ramp_up` / `ramp_down` on the row; the analysis time range dialog's seconds. */
  analysisStartOffset?: string | number | null;
  analysisEndOffset?: string | number | null;
}

/** `analysisBoundsFromRow` for a caller that already holds the entity — no round trip. */
export function analysisBoundsFromEntity(
  run: TestRunTimesEntity | null | undefined,
  excludeRampUp = false,
): AnalysisBounds {
  return analysisBoundsFromRow(
    {
      start_time: run?.startTime ?? null,
      end_time: run?.endTime ?? null,
      ramp_up: run?.analysisStartOffset ?? null,
      ramp_down: run?.analysisEndOffset ?? null,
    },
    excludeRampUp,
  );
}

/**
 * One window covering several runs: earliest start, latest end. A query over
 * `test_run_id = ANY(...)` needs this rather than per-run bounds, and one run
 * with no `end_time` leaves the whole span open-ended — it is still in flight.
 */
export function spanBounds(all: AnalysisBounds[]): AnalysisBounds {
  if (all.length === 0) return { startCutoff: null, endCutoff: null };
  let startCutoff: Date | null = null;
  let endCutoff: Date | null = null;
  for (const b of all) {
    if (!b.startCutoff) return { startCutoff: null, endCutoff: null };
    if (!startCutoff || b.startCutoff < startCutoff) startCutoff = b.startCutoff;
  }
  for (const b of all) {
    if (!b.endCutoff) return { startCutoff, endCutoff: null };
    if (!endCutoff || b.endCutoff > endCutoff) endCutoff = b.endCutoff;
  }
  return { startCutoff, endCutoff };
}

/**
 * The `time` predicates themselves, numbered from `startIndex`. Emits only the
 * ends that exist, so a bound is never a `$n IS NULL OR …` the planner has to
 * fold — and never a `<= NULL` that silently returns nothing.
 */
export function timeBoundsSql(
  bounds: AnalysisBounds,
  column: string,
  startIndex: number,
): { clause: string; params: Date[]; nextIndex: number } {
  const conditions: string[] = [];
  const params: Date[] = [];
  let idx = startIndex;
  if (bounds.startCutoff) {
    conditions.push(`${column} >= $${idx++}::timestamptz`);
    params.push(bounds.startCutoff);
  }
  if (bounds.endCutoff) {
    conditions.push(`${column} <= $${idx++}::timestamptz`);
    params.push(bounds.endCutoff);
  }
  return {
    clause: conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '',
    params,
    nextIndex: idx,
  };
}
