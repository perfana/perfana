/**
 * The SQL of StatisticsPipeline's aggregation, split into the pieces series grouping reuses.
 *
 * Moved here verbatim from StatisticsPipeline.aggregateMetricStatistics. With no grouped panels,
 * `buildStatisticsInsertSQL(placeholders)` returns exactly the statement the pipeline issued
 * before series grouping existed — byte for byte, pinned by the "SQL pin" snapshot in
 * test/unit/pipelines/StatisticsPipeline.test.ts. Keep it that way: an edit here changes what
 * every analysis sends to Postgres, grouped or not.
 *
 * The grouped statement (series-grouping-plan.ts) reuses the run scope and the statistics chain
 * over its own per-timestamp input, never `metrics_filtered`: referencing that CTE twice would
 * materialise the run's raw rows into a tuplestore.
 */

/** `WITH run_orgs …, allowed_dashboards …,` — the run and dashboard scope, read once. */
export function buildRunScopeCtes(placeholders: string): string {
  return `
      -- The runs being aggregated, read once. Everything below joins this
      -- instead of test_runs, so the table is scanned a single time.
      WITH run_orgs AS MATERIALIZED (
          SELECT test_run_id, organization_id, team_id, start_time
          FROM test_runs
          WHERE test_run_id IN (${placeholders})
      ),

      -- Dashboards whose metrics belong in this run's statistics, resolved ONCE.
      -- This used to be two correlated IN (...) subqueries on tr.organization_id
      -- inside the ds_metrics filter below, so Postgres re-ran them across the
      -- metric scan — millions of rows against a few hundred dashboards. Both
      -- MATERIALIZED keywords are load-bearing: without them the planner is free
      -- to inline these back into the scan and the correlation returns.
      -- (The organization_id IS NULL arms look dead under Phase 4, but a
      -- deployment mid-backfill still has null-org rows and dropping them here
      -- would silently drop their metrics from every statistic.)
      allowed_dashboards AS MATERIALIZED (
          SELECT ad.id
          FROM application_dashboards ad
          WHERE ad.organization_id IN (SELECT organization_id FROM run_orgs)
             OR ad.organization_id IS NULL
          UNION
          SELECT dq.application_dashboard_id
          FROM dynatrace_queries dq
          WHERE dq.organization_id IN (SELECT organization_id FROM run_orgs)
             OR dq.organization_id IS NULL
      ),

`;
}

/**
 * The run's raw steady-state points. `extraPredicate` is appended to the WHERE clause verbatim;
 * series grouping passes the exclusion of grouped panels, everything else passes nothing.
 */
export function buildMetricsFilteredCte(placeholders: string, extraPredicate = ''): string {
  return `      metrics_filtered AS (
          SELECT
              m.test_run_id,
              m.application_dashboard_id,
              m.panel_id,
              m.metric_name,
              m.value,
              m.time,
              m.dashboard_uid,
              m.panel_title,
              m.dashboard_label,
              m.benchmark_ids[1] as first_benchmark_id,
              m.unit,
              tr.organization_id,
              tr.team_id,
              m.metrics_source_id
          FROM ds_metrics m
          INNER JOIN run_orgs tr ON m.test_run_id = tr.test_run_id
          WHERE m.test_run_id IN (${placeholders})
            AND m.ramp_up = false
            AND m.value IS NOT NULL
            AND m.application_dashboard_id IN (SELECT id FROM allowed_dashboards)${extraPredicate}
      ),

`;
}

/** `statistics_aggregated` and `final_statistics` over `input`, ending at final_statistics' `)`. */
export function buildStatisticsCtes(input: string): string {
  return `      statistics_aggregated AS (
          SELECT
              test_run_id,
              application_dashboard_id,
              panel_id,
              metric_name,

              COUNT(*) as count,
              AVG(value) as mean,
              MIN(value) as min_value,
              MAX(value) as max_value,
              STDDEV_POP(value) as std_dev,

              -- Persisted alongside pct_agg so ControlGroupStatisticsPipeline can
              -- recombine pooled population mean and std_dev exactly across
              -- per-run rows without rescanning ds_metrics (issue #289).
              -- Sketches don't preserve enough info to recover STDDEV_POP across
              -- the pooled distribution, so we keep the two raw moments.
              SUM(value::double precision) as sum_value,
              SUM((value::double precision) * (value::double precision)) as sum_sq_value,

              -- TimescaleDB percentile_agg builds a uddsketch sketch in O(n).
              -- Stored on ds_metric_statistics so ControlGroupStatisticsPipeline
              -- can pool across control runs via rollup(pct_agg) (issue #289)
              -- instead of re-scanning ds_metrics for every re-evaluate.
              percentile_agg(value) as pct_agg,

              -- TimescaleDB last(): value at the greatest time, in the pass that is
              -- already running. This used to be a LEFT JOIN LATERAL on ds_metrics in
              -- final_statistics, one probe per output group. ds_metrics is compressed
              -- with segmentby=test_run_id, so a compressed chunk cannot narrow a probe
              -- by application_dashboard_id/panel_id/metric_name. TimescaleDB does push
              -- ORDER BY time DESC LIMIT 1 into the columnar scan, so a metric still
              -- reporting at the end of the run was found in the first batch (~0.04ms);
              -- the cost is metrics that STOP reporting early, which force a deep
              -- backward walk (~0.97ms, 24x worse). Enough of those and the aggregation
              -- exceeds ANALYTICS_STATEMENT_TIMEOUT_MS: 60.1s measured over 12,370
              -- groups, against 1.19s for the aggregate below.
              --
              -- The FILTER is not decoration: every other aggregate here skips NULLs by
              -- definition, but last() returns the value AT the greatest time even when
              -- that value is NULL. The lateral carried its own "value IS NOT NULL", so
              -- this keeps the predicate local instead of leaning on metrics_filtered
              -- forty lines above.
              last(value, time) FILTER (WHERE value IS NOT NULL) as last_value,

              -- Trend SLO: OLS slope of value against time, normalised to % of the
              -- series mean per hour so one threshold fits fast and slow series alike,
              -- and Pearson r so the check can tell a drift from noise. Core Postgres
              -- aggregates, one pass, same window as everything else here.
              -- date_part, not EXTRACT: on PG14+ EXTRACT returns numeric, and the per-row
              -- numeric divide + cast cost +75% on a 1.66 M-row run (measured); date_part
              -- is float8 and the /3600 is exact after aggregation (slope is linear in x).
              -- A constant zero series (an error count with no errors) is a flat line, not
              -- "no data": emit 0 so it takes the weak-trend path instead of vanishing.
              CASE WHEN AVG(value) <> 0
                   THEN regr_slope(value, date_part('epoch', time)) * 3600 / ABS(AVG(value)) * 100
                   WHEN MIN(value) = MAX(value) THEN 0
              END as trend_pct_per_hour,
              corr(value, date_part('epoch', time)) as trend_corr,

              -- n_missing: always 0 here because WHERE filters out NULLs, but kept
              -- for schema compatibility. Downstream code may re-count from raw data.
              COUNT(CASE WHEN value IS NULL THEN 1 END) as n_missing,
              COUNT(CASE WHEN value > 0 THEN 1 END) as n_non_zero,

              -- These columns are identical within each group; MIN() is just a
              -- deterministic way to pick one value without a window function.
              MIN(unit) as unit,
              MIN(organization_id::text)::uuid as organization_id,
              MIN(team_id::text)::uuid as team_id,
              MIN(dashboard_uid) as dashboard_uid,
              MIN(panel_title) as panel_title,
              MIN(dashboard_label) as dashboard_label,
              MIN(first_benchmark_id::text)::uuid as first_benchmark_id,
              MIN(metrics_source_id::text)::uuid as metrics_source_id

          FROM ${input}
          GROUP BY
              test_run_id,
              application_dashboard_id,
              panel_id,
              metric_name
      ),

      final_statistics AS (
          SELECT
              sa.test_run_id,
              sa.application_dashboard_id,
              sa.panel_id,
              sa.metric_name,

              CASE
                  WHEN sa.first_benchmark_id IS NOT NULL
                  THEN sa.first_benchmark_id::uuid
                  ELSE NULL
              END as benchmark_id,

              sa.dashboard_uid,
              COALESCE(sa.dashboard_label, 'missing') as dashboard_label,
              COALESCE(sa.panel_title, 'missing') as panel_title,
              sa.unit,

              sa.count,
              sa.mean,
              sa.sum_value,
              sa.sum_sq_value,
              sa.pct_agg,
              -- Extract percentiles from single-pass aggregation
              approx_percentile(0.50, sa.pct_agg) as median,
              sa.min_value,
              sa.max_value,
              sa.std_dev,
              sa.last_value,
              sa.trend_pct_per_hour,
              sa.trend_corr,

              sa.n_missing,
              sa.n_non_zero,

              approx_percentile(0.10, sa.pct_agg) as q10,
              approx_percentile(0.25, sa.pct_agg) as q25,
              approx_percentile(0.75, sa.pct_agg) as q75,
              approx_percentile(0.90, sa.pct_agg) as q90,
              approx_percentile(0.95, sa.pct_agg) as q95,
              approx_percentile(0.99, sa.pct_agg) as q99,

              -- Build JSON from same single-pass aggregation (no duplicate computation)
              jsonb_build_object(
                  'p10', approx_percentile(0.10, sa.pct_agg),
                  'p25', approx_percentile(0.25, sa.pct_agg),
                  'p50', approx_percentile(0.50, sa.pct_agg),
                  'p75', approx_percentile(0.75, sa.pct_agg),
                  'p90', approx_percentile(0.90, sa.pct_agg),
                  'p95', approx_percentile(0.95, sa.pct_agg),
                  'p99', approx_percentile(0.99, sa.pct_agg)
              ) as percentiles,

              -- IQR (Interquartile Range): robust measure of spread, less sensitive
              -- to outliers than std_dev. Used by ADAPT's IQR threshold check.
              (approx_percentile(0.75, sa.pct_agg) - approx_percentile(0.25, sa.pct_agg)) as iqr,
              -- IDR (Interdecile Range): captures 80% of the distribution (p10..p90),
              -- useful for understanding tail behavior in response time metrics.
              (approx_percentile(0.90, sa.pct_agg) - approx_percentile(0.10, sa.pct_agg)) as idr,

              -- Constant ⇔ min = max. Derived here from the aggregates already
              -- projected above rather than as a fourth aggregate expression, which
              -- is what COUNT(DISTINCT value) used to be — that needed its own
              -- per-group sort; this needs nothing.
              (sa.min_value = sa.max_value) as is_constant,
              (sa.min_value = sa.max_value) as constant_value,  -- alias kept for backward compat
              (sa.count = sa.n_missing) as all_missing,

              CASE
                  WHEN sa.count > 0 THEN (sa.n_missing::float / sa.count::float) * 100.0
                  ELSE 0.0
              END as pct_missing,

              CASE
                  WHEN sa.count > 0 THEN (sa.n_missing::float / sa.count::float) * 100.0
                  ELSE 0.0
              END as missing_percentage,

              NOW() as updated_at,
              tr.start_time as test_run_start,
              sa.organization_id,
              sa.team_id,
              'worker-pipeline' as created_by,
              'worker-pipeline' as updated_by,
              sa.metrics_source_id

          FROM statistics_aggregated sa
          LEFT JOIN run_orgs tr ON tr.test_run_id = sa.test_run_id
      )`;
}

/** The INSERT that writes `final_statistics` into ds_metric_statistics. */
export const STATISTICS_INSERT = `      INSERT INTO ds_metric_statistics (
          test_run_id,
          application_dashboard_id,
          panel_id,
          metric_name,
          benchmark_id,
          dashboard_uid,
          dashboard_label,
          panel_title,
          unit,
          count,
          mean,
          median,
          min_value,
          max_value,
          std_dev,
          last_value,
          trend_pct_per_hour,
          trend_corr,
          n_missing,
          n_non_zero,
          q10,
          q25,
          q75,
          q90,
          q95,
          q99,
          percentiles,
          iqr,
          idr,
          is_constant,
          constant_value,
          all_missing,
          pct_missing,
          missing_percentage,
          updated_at,
          test_run_start,
          organization_id,
          team_id,
          created_by,
          updated_by,
          metrics_source_id,
          pct_agg,
          sum_value,
          sum_sq_value
      )
      SELECT
          test_run_id,
          application_dashboard_id,
          panel_id,
          metric_name,
          benchmark_id,
          dashboard_uid,
          dashboard_label,
          panel_title,
          unit,
          count,
          mean,
          median,
          min_value,
          max_value,
          std_dev,
          last_value,
          trend_pct_per_hour,
          trend_corr,
          n_missing,
          n_non_zero,
          q10,
          q25,
          q75,
          q90,
          q95,
          q99,
          percentiles,
          iqr,
          idr,
          is_constant,
          constant_value,
          all_missing,
          pct_missing,
          missing_percentage,
          updated_at,
          test_run_start,
          organization_id,
          team_id,
          created_by,
          updated_by,
          metrics_source_id,
          pct_agg,
          sum_value,
          sum_sq_value
      FROM final_statistics
    `;

/** The pipeline's main aggregation statement. */
export function buildStatisticsInsertSQL(placeholders: string, extraPredicate = ''): string {
  return (
    buildRunScopeCtes(placeholders) +
    buildMetricsFilteredCte(placeholders, extraPredicate) +
    buildStatisticsCtes('metrics_filtered') +
    '\n\n' +
    STATISTICS_INSERT
  );
}
