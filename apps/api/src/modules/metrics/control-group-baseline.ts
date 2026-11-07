/**
 * A run's control group as a comparison baseline.
 *
 * The control group is the set of earlier runs ADAPT judges a run against. Its pooled
 * statistics are in `ds_control_group_statistics`, one row per (dashboard, panel, series),
 * which is what the anomaly-detection card's "control" column reads. The Compare card and the
 * report's Comparisons section offer it as a baseline next to the single runs, under the
 * `CONTROL_GROUP_BASELINE` sentinel from `@perfana/shared/types`.
 *
 * Two readers need it (`MetricsService` for the Compare card, `ReportDataFetcherService` for
 * the report), so the SQL lives here once rather than in both.
 *
 * Neither table is an owned resource and neither has an RLS policy of its own: both are keyed
 * on the CURRENT run, so every caller must authorize that run first, exactly as it already
 * does for the run's own `ds_metric_statistics`.
 */

/** Anything with a `query(sql, params)`: an EntityManager, a DataSource or a Repository. */
export interface ControlGroupSqlRunner {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(sql: string, params?: any[]): Promise<any>;
}

/** The runs a run's control group consists of. */
export interface ControlGroupInfo {
  id: string;
  testRuns: string[];
  /** ADAPT's own count — kept separate from testRuns.length, which can lag it. */
  nTestRuns: number;
  firstDatetime: string | null;
  lastDatetime: string | null;
}

/** One series' pooled statistics over the control group's runs. */
export interface ControlGroupStatisticRow {
  application_dashboard_id: string;
  panel_id: number;
  panel_title: string | null;
  dashboard_label: string | null;
  metric_name: string | null;
  unit: string | null;
  metrics_source_id: string | null;
  mean: number | null;
  median: number | null;
  min_value: number | null;
  max_value: number | null;
  q90: number | null;
  q95: number | null;
  q99: number | null;
  count: number | null;
}

/**
 * Which control group a run has.
 *
 * The latest ADAPT conclusion names it, and that is what the anomaly-detection card and the
 * report's Regressions section go by. A run with no conclusion yet (ADAPT failed, or is still
 * queued) falls back to the group keyed on the run's own id, which is the id the worker gives
 * every control group it builds (`ControlGroupsPipeline`: `control_group_id` = test_run_id).
 * `control_group_id` is unique in `ds_control_groups`, so the LIMIT only documents that.
 */
export const CONTROL_GROUP_FOR_RUN_SQL = `/* control-group:for-run */
SELECT g.control_group_id, g.test_runs, g.n_test_runs, g.first_datetime, g.last_datetime
FROM ds_control_groups g
WHERE g.control_group_id = COALESCE(
  (SELECT c.control_group_id
     FROM ds_adapt_conclusion c
    WHERE c.test_run_id = $1 AND c.control_group_id IS NOT NULL
    ORDER BY c.updated_at DESC
    LIMIT 1),
  $1)
LIMIT 1`;

/**
 * Resolve a run's control group, or null when it has none.
 *
 * A group with no runs in it is reported as null too: the first runs of a workload get an
 * empty group, and there is nothing to compare against.
 */
export async function loadControlGroupForRun(
  q: ControlGroupSqlRunner,
  testRunId: string,
): Promise<ControlGroupInfo | null> {
  const rows: Array<{
    control_group_id: string;
    test_runs: string[] | null;
    n_test_runs: number | null;
    first_datetime: Date | string | null;
    last_datetime: Date | string | null;
  }> = await q.query(CONTROL_GROUP_FOR_RUN_SQL, [testRunId]);
  const row = rows?.[0];
  if (!row) return null;
  const testRuns = Array.isArray(row.test_runs) ? row.test_runs : [];
  const nTestRuns = row.n_test_runs ?? testRuns.length;
  if (testRuns.length === 0 && nTestRuns === 0) return null;
  const iso = (v: Date | string | null): string | null =>
    v == null ? null : v instanceof Date ? v.toISOString() : String(v);
  return {
    id: row.control_group_id,
    testRuns,
    nTestRuns,
    firstDatetime: iso(row.first_datetime),
    lastDatetime: iso(row.last_datetime),
  };
}

/**
 * The control group's statistics, optionally narrowed to one panel.
 *
 * `metricsSourceId` wins over `applicationDashboardId`, matching the run-side reads in
 * `MetricsService` (`findDSMetricStatisticsMultiple`), so both sides of a comparison select
 * the same rows. Every value is bound; nothing is interpolated.
 */
export async function loadControlGroupStatistics(
  q: ControlGroupSqlRunner,
  controlGroupId: string,
  scope: { applicationDashboardId?: string; metricsSourceId?: string; panelId?: number } = {},
): Promise<ControlGroupStatisticRow[]> {
  const params: unknown[] = [controlGroupId];
  let filter = '';
  if (scope.metricsSourceId) {
    params.push(scope.metricsSourceId);
    filter += ` AND s.metrics_source_id = $${params.length}::uuid`;
  } else if (scope.applicationDashboardId) {
    params.push(scope.applicationDashboardId);
    filter += ` AND s.application_dashboard_id = $${params.length}::uuid`;
  }
  if (scope.panelId != null) {
    params.push(scope.panelId);
    filter += ` AND s.panel_id = $${params.length}`;
  }
  const rows: ControlGroupStatisticRow[] = await q.query(
    `/* control-group:statistics */
     SELECT s.application_dashboard_id, s.panel_id, s.panel_title, s.dashboard_label,
            s.metric_name, s.unit, s.metrics_source_id,
            s.mean, s.median, s.min_value, s.max_value, s.q90, s.q95, s.q99, s.count
     FROM ds_control_group_statistics s
     WHERE s.control_group_id = $1
       AND s.metric_name IS NOT NULL${filter}`,
    params,
  );
  return rows ?? [];
}
