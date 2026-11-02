/**
 * Which runs a series grouping rule is judged against, and which it is recalculated for.
 *
 * Two jobs, both read-only and both on small tables (nothing here touches `ds_metrics`):
 *
 *  - `resolveBaselineRunIds`: the runs ADAPT compares a run against. The preview and the
 *    suggestions show names from exactly those runs, because a grouping only helps if it makes
 *    the run's names line up with them.
 *  - `planRecalculation`: the runs a "recalculate" re-evaluates. It shares
 *    `partitionWritableCompletedRuns` with the analysis-window apply, so the two bulk
 *    re-evaluates cannot disagree about which runs they may touch.
 *
 * Design: docs/design/2026-11-01-series-grouping-design.md ("Preview", "Applying a rule to
 * runs that already exist").
 */

import {
  partitionWritableCompletedRuns,
  type AnalysisTimeRangeScopeEntry,
  type WritableCompletedRun,
} from '../test-runs/handlers/update-analysis-time-range.handler';
import { MAX_BULK_ANALYSIS_TIME_RANGE_RUNS } from '../test-runs/services/test-runs-mutation.service';

/** Anything with a `query(sql, params)`: an EntityManager or a Repository. */
export interface SqlRunner {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(sql: string, params?: any[]): Promise<any>;
}

/** How many recent completed runs stand in for a baseline when a run has no ADAPT conclusion yet. */
export const BASELINE_FALLBACK_RUN_COUNT = 5;

export type RecalculationScope = 'baseline' | 'recent';

export interface RecalculationTarget extends WritableCompletedRun {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
}

export interface RecalculationPlan {
  /** Canonical `test_run_id` strings, never entity UUIDs. Target first, then newest first. */
  enqueue: string[];
  skipped: AnalysisTimeRangeScopeEntry[];
}

/**
 * The runs of the run's current control group.
 *
 * ADAPT's own answer: the latest `ds_adapt_conclusion` row's `control_group_id`, resolved to
 * `ds_control_groups.test_runs`. (`details.controlRuns` is NOT a general source: it is written
 * only for an INSUFFICIENT_DATA conclusion whose baseline aggregation failed.) Shape copied from
 * `ReportDataFetcherService.getRegressionsData`.
 *
 * With no conclusion at all, the five most recent completed runs of the same workload that
 * started before it. A conclusion that exists but has no usable control group is a finding in
 * itself (NO_BASELINES_FOUND), and substituting recent runs for it would show the caller a
 * baseline ADAPT never used — so that case answers empty.
 *
 * The caller authorizes the run first; this function trusts `testRunId`.
 */
export async function resolveBaselineRunIds(q: SqlRunner, testRunId: string): Promise<string[]> {
  const rows: Array<{ test_runs: string[] | null }> = await q.query(
    `/* sg:baseline */
     SELECT g.test_runs
     FROM (
       SELECT control_group_id
       FROM ds_adapt_conclusion
       WHERE test_run_id = $1
       ORDER BY updated_at DESC
       LIMIT 1
     ) c
     LEFT JOIN ds_control_groups g ON g.control_group_id = c.control_group_id
     ORDER BY g.updated_at DESC NULLS LAST
     LIMIT 1`,
    [testRunId],
  );

  if (rows.length > 0) {
    const members = rows[0]?.test_runs ?? [];
    return members.filter((id) => id !== testRunId).slice(0, MAX_BULK_ANALYSIS_TIME_RANGE_RUNS);
  }

  const recent: Array<{ test_run_id: string }> = await q.query(
    `/* sg:baseline-fallback */
     SELECT r.test_run_id
     FROM test_runs t
     JOIN test_runs r
       ON r.system_under_test_id = t.system_under_test_id
      AND r.test_environment = t.test_environment
      AND r.workload = t.workload
     WHERE t.test_run_id = $1
       AND r.completed = true
       AND r.deletion_status IS NULL
       AND r.test_run_id <> t.test_run_id
       AND r.start_time < t.start_time
     ORDER BY r.start_time DESC
     LIMIT $2`,
    [testRunId, BASELINE_FALLBACK_RUN_COUNT],
  );
  return recent.map((r) => r.test_run_id);
}

/**
 * The control group id of the run's latest conclusion, or null. Suggestions compare a run's names
 * against `ds_control_group_statistics` of exactly this group.
 */
export async function resolveControlGroupId(q: SqlRunner, testRunId: string): Promise<string | null> {
  const rows: Array<{ control_group_id: string | null }> = await q.query(
    `/* sg:control-group */
     SELECT control_group_id
     FROM ds_adapt_conclusion
     WHERE test_run_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [testRunId],
  );
  return rows[0]?.control_group_id ?? null;
}

const CANDIDATE_COLUMNS = `r.id, r.test_run_id AS "testRunId", r.completed,
       r.organization_id AS "organizationId", r.team_id AS "teamId"`;

/**
 * Which runs a recalculation covers, and which it leaves alone.
 *
 *  - `baseline`: the target plus its control group — the runs its ADAPT verdict is judged
 *    against. Pinned to the target's own workload: one batch job is one workload, because the
 *    orchestrator's scope lock is keyed on sut:env:workload.
 *  - `recent`: the target plus the workload's most recent completed runs.
 *
 * Truncating at `MAX_BULK_ANALYSIS_TIME_RANGE_RUNS` (target first, then newest) is correct HERE
 * and wrong for the analysis window, which refuses: an unrecalculated run contributes no row to
 * a group rather than a wrong one, so the baseline gets smaller, not mixed.
 *
 * A running TARGET is reported and left out (the shared partition always keeps the target):
 * re-evaluating a live run is wrong, its own analysis picks the rule up on completion. Its
 * baseline is still recalculated, because that is what it will be compared against.
 */
export async function planRecalculation(
  q: SqlRunner,
  target: RecalculationTarget,
  scope: RecalculationScope,
): Promise<RecalculationPlan> {
  let others: WritableCompletedRun[];
  if (scope === 'baseline') {
    const baselineIds = await resolveBaselineRunIds(q, target.testRunId);
    others =
      baselineIds.length === 0
        ? []
        : await q.query(
            `/* sg:recalc-baseline-runs */
             SELECT ${CANDIDATE_COLUMNS}
             FROM test_runs r
             WHERE r.test_run_id = ANY($1::text[])
               AND r.system_under_test_id = $2
               AND r.test_environment = $3
               AND r.workload = $4
               AND r.deletion_status IS NULL
             ORDER BY r.start_time DESC NULLS LAST`,
            [baselineIds, target.systemUnderTestId, target.testEnvironment, target.workload],
          );
  } else {
    others = await q.query(
      `/* sg:recalc-recent-runs */
       SELECT ${CANDIDATE_COLUMNS}
       FROM test_runs r
       WHERE r.system_under_test_id = $1
         AND r.test_environment = $2
         AND r.workload = $3
         AND r.completed = true
         AND r.deletion_status IS NULL
       ORDER BY r.start_time DESC NULLS LAST
       LIMIT $4`,
      [target.systemUnderTestId, target.testEnvironment, target.workload, MAX_BULK_ANALYSIS_TIME_RANGE_RUNS],
    );
  }

  const candidates: WritableCompletedRun[] = [target, ...others.filter((r) => r.id !== target.id)];
  const { applicable, skipped } = partitionWritableCompletedRuns(candidates, target);

  const enqueue: string[] = [];
  for (const run of applicable) {
    if (run.id === target.id && run.completed !== true) {
      skipped.push({ testRunId: run.testRunId, completed: false, skipped: 'running' });
      continue;
    }
    enqueue.push(run.testRunId);
  }

  return { enqueue: enqueue.slice(0, MAX_BULK_ANALYSIS_TIME_RANGE_RUNS), skipped };
}
