/**
 * Writes performance-test ds_metrics and ds_metric_statistics from SQL.
 *
 * The requests and transactions processors used to pull their whole aggregate into
 * Node and build one `DsMetricsRecord` per (bucket x panel). On a run with a few
 * thousand samplers that is millions of objects — 1.8M buckets x 9 panels = 16M
 * records was a worker OOM (heap limit 2 GB), and the statistics pass then held the
 * same records a second and third time in a filtered array and a grouping Map.
 *
 * Nothing here materialises a row in JS. The caller hands over its aggregate CTE and
 * a SELECT that projects one row per emitted metric; this module joins that to the
 * scenario dashboards (resolved once, a handful) and a constant panel table, and
 * issues a single INSERT ... SELECT.
 */

import type { DataSource } from 'typeorm';
import type { Logger } from 'pino';
import type { DashboardMetadata } from './dashboard-manager.js';
import {
  METRIC_TYPE_PANEL_NAMES,
  METRIC_TYPE_PANEL_UNITS,
} from '../../constants/performance-metrics.js';
import type { TestRunMetadata } from '../../types/performance-metrics.js';

export interface InsertDsMetricsOptions {
  dataSource: DataSource;
  /**
   * Everything that would follow `WITH`, ending with the CTE `rowsSelect` reads.
   * No trailing comma — this module appends its own CTEs.
   */
  aggregateCte: string;
  /**
   * SELECT reading the caller's CTEs and projecting, in this order:
   * scenario_name, metric_name, panel_id, value, bucket_time, timestep.
   */
  rowsSelect: string;
  /** Parameters for `aggregateCte` + `rowsSelect`, numbered from $1. */
  params: unknown[];
  /** Scenario name -> dashboard. A scenario absent here is simply not written. */
  dashboards: Map<string, DashboardMetadata>;
  /** Panel IDs the caller emits; titles and units come from the shared constants. */
  panelIds: number[];
  testRunId: string;
  testRun: TestRunMetadata;
  /** Incremental ticks re-visit a bucket as more samples land, so they must upsert. */
  isIncremental: boolean;
}

/**
 * Row count of an `INSERT ... RETURNING 1` wrapped in a `SELECT count(*) AS n` CTE.
 *
 * The obvious `result[1]` does NOT work here. TypeORM surfaces a write as
 * `[rows, rowCount]` only for DELETE/UPDATE; a bare `INSERT ... SELECT` comes back as
 * the rows array alone, so `result[1]` is undefined and the count silently reads 0.
 * That is not cosmetic: the number becomes `totalDataPoints` -> `testRunsWithNewData`,
 * which gates the statistics-recalculation stage in simple-orchestrate-reevaluate-batch.
 * A force-refetch that wrote 1.9M rows reported 0 and would have skipped rebuilding
 * ds_metric_statistics, landing back on 'No metrics data collected' behind a green job.
 *
 * Counting in Postgres keeps the fix free: the CTE returns one integer row, so nothing
 * materialises per inserted row in JS.
 */
function readInsertedCount(result: unknown): number {
  if (!Array.isArray(result)) {
    return 0;
  }
  const n = (result[0] as { n?: unknown } | undefined)?.n;
  return typeof n === 'number' ? n : Number(n ?? 0) || 0;
}

/**
 * Insert one ds_metrics row per emitted metric, entirely inside Postgres.
 * Returns the number of rows written.
 */
export async function insertDsMetricsFromAggregate(
  opts: InsertDsMetricsOptions
): Promise<number> {
  const {
    dataSource, aggregateCte, rowsSelect, params, dashboards, panelIds,
    testRunId, testRun, isIncremental,
  } = opts;

  if (dashboards.size === 0 || panelIds.length === 0) {
    return 0;
  }

  const values = [...params];
  /** Append a parameter and return its `$n` placeholder. */
  const p = (value: unknown): string => `$${values.push(value)}`;

  const pTestRunId = p(testRunId);
  const pStartTime = p(testRun.start_time);
  // ramp_up_time is typed as a number but arrives from the DB, so treat a missing
  // value as "no ramp-up", exactly as createDsMetricsRecord's guard did.
  const pRampUp = p(testRun.ramp_up_time ?? null);
  const pOrgId = p(testRun.organization_id ?? null);
  const pTeamId = p(testRun.team_id ?? null);

  const dashboardRows = [...dashboards.entries()].map(
    ([scenarioName, d]) =>
      `(${p(scenarioName)}::text, ${p(d.dashboardId)}::uuid, ${p(d.dashboardUid)}::text, ` +
      `${p(d.dashboardLabel)}::text, ${p(d.metricsSourceId ?? null)}::uuid)`
  );

  const panelRows = panelIds.map((panelId) => {
    // getMetricTypePanel threw here before the rewrite. Keep it fail-fast: a panel id
    // with no name is a programming error, and defaulting it writes 'missing' onto
    // every row of that panel instead of failing the run.
    const panelTitle = METRIC_TYPE_PANEL_NAMES[panelId];
    if (!panelTitle) { throw new Error(`Unknown metric type panel ID: ${panelId}`); }
    return `(${p(panelId)}::integer, ${p(panelTitle)}::text, ${p(METRIC_TYPE_PANEL_UNITS[panelId] ?? null)}::text)`;
  });

  // Full collection deletes the run's ds_metrics up front, so a plain INSERT is
  // enough; incremental ticks overlap by design (issue #134) and must upsert.
  //
  // Either arm rejects two emitted rows sharing (dashboard, panel, metric_name, time) —
  // a unique violation here, a cardinality_violation there. That is reachable in
  // principle: the requests metric name collapses ('overall','X'), ('','X') and ('X','X')
  // onto X, which are distinct groups, and grouping set 3's literal 'total' collides with
  // a sampler actually named total. The old 1000-row batches sometimes split such a pair
  // and silently took the last write; one statement always raises. Neither shape exists
  // in any observed data, and the old full-collection path had the same exposure.
  const onConflict = isIncremental
    ? `ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name, time)
       DO UPDATE SET
         value = EXCLUDED.value,
         unit = EXCLUDED.unit,
         metrics_source_id = COALESCE(EXCLUDED.metrics_source_id, ds_metrics.metrics_source_id),
         updated_at = CURRENT_TIMESTAMP,
         organization_id = EXCLUDED.organization_id,
         team_id = EXCLUDED.team_id,
         updated_by = EXCLUDED.updated_by`
    : '';

  const sql = `
    WITH ${aggregateCte},
    scenario_dashboards (scenario_name, application_dashboard_id, dashboard_uid, dashboard_label, metrics_source_id) AS (
      VALUES ${dashboardRows.join(', ')}
    ),
    metric_panels (panel_id, panel_title, unit) AS (
      VALUES ${panelRows.join(', ')}
    ),
    emitted AS (
      ${rowsSelect}
    ),
    ins AS (
    INSERT INTO ds_metrics (
      test_run_id, application_dashboard_id, metrics_source_id, dashboard_uid, panel_id, time,
      metric_name, panel_title, dashboard_label, benchmark_ids, errors,
      timestep, ramp_up, value, unit, created_at,
      organization_id, team_id, created_by, updated_by
    )
    SELECT
      ${pTestRunId},
      d.application_dashboard_id,
      d.metrics_source_id,
      left(d.dashboard_uid, 255),
      e.panel_id,
      e.bucket_time,
      left(e.metric_name, 255),
      left(p.panel_title, 500),
      left(d.dashboard_label, 255),
      NULL, NULL,
      e.timestep,
      CASE
        WHEN ${pRampUp}::double precision IS NULL THEN false
        ELSE EXTRACT(EPOCH FROM (e.bucket_time - ${pStartTime}::timestamptz)) < ${pRampUp}::double precision
      END,
      e.value,
      p.unit,
      NOW(),
      ${pOrgId}::uuid,
      ${pTeamId}::uuid,
      'worker-pipeline',
      'worker-pipeline'
    FROM emitted e
    JOIN scenario_dashboards d ON d.scenario_name = e.scenario_name
    JOIN metric_panels p ON p.panel_id = e.panel_id
    WHERE e.value IS NOT NULL
    ${onConflict}
    RETURNING 1
    )
    SELECT count(*)::int AS n FROM ins
  `;

  const result = await dataSource.query(sql, values);
  return readInsertedCount(result);
}

/**
 * Recompute ds_metric_statistics for the dashboards this pipeline just wrote.
 *
 * Replaces an in-JS pass that filtered every metric record, grouped them in a Map and
 * sorted each group's values to interpolate percentiles — three more copies of the
 * data that caused the OOM. Reading the rows back is cheap: they were written moments
 * ago and `uniq_ds_metrics_upsert` leads with test_run_id.
 *
 * It reads the run, not the tick. The JS pass it replaces was handed only the current
 * increment's records and upserted `count = EXCLUDED.count`, so during a live run
 * `ds_metric_statistics` described the latest tick's slice rather than the run so far.
 * Reading `ds_metrics` back makes the live numbers cumulative and correct, at the cost of
 * a scan that grows with the run instead of with the tick (4.6 s over 2.45 M rows).
 *
 * This puts timescaledb_toolkit (`percentile_agg`, `approx_percentile`, `last`) on the
 * incremental path, where the JS pass needed nothing. `StatisticsPipeline` has always
 * required it at analyze time, so it is not a new dependency for the deployment — but it
 * is a new one for a live run, and the `pg_extension` probe still guarding `time_bucket`
 * in the two aggregates is now inconsistent with it.
 *
 * Percentiles come from `percentile_agg` here rather than exact interpolation. That is
 * deliberate: the analyze-time StatisticsPipeline has always overwritten these rows
 * with the approximate values, so a live run and its final numbers now agree instead
 * of shifting once analysis lands. It also fills `pct_agg`, which the JS pass left
 * NULL and which ADAPT's control-group pooling depends on.
 */
export async function upsertPerfTestStatistics(
  dataSource: DataSource,
  testRunId: string,
  dashboardIds: string[],
  testRun: TestRunMetadata,
  logger: Logger
): Promise<number> {
  if (dashboardIds.length === 0) {
    return 0;
  }

  const sql = `
    WITH grouped AS (
      SELECT
        m.application_dashboard_id,
        m.panel_id,
        left(m.metric_name, 255) AS metric_name,
        COUNT(*) AS count,
        AVG(m.value) AS mean,
        MIN(m.value) AS min_value,
        MAX(m.value) AS max_value,
        STDDEV_POP(m.value) AS std_dev,
        SUM(m.value) AS sum_value,
        SUM(m.value * m.value) AS sum_sq_value,
        percentile_agg(m.value) AS pct_agg,
        -- last() returns the value AT the greatest time even when it is NULL, so it
        -- needs its own FILTER unlike every other aggregate here.
        last(m.value, m.time) FILTER (WHERE m.value IS NOT NULL) AS last_value,
        COUNT(*) FILTER (WHERE m.value > 0) AS n_non_zero,
        MIN(m.unit) AS unit,
        MIN(m.dashboard_uid) AS dashboard_uid,
        MIN(m.dashboard_label) AS dashboard_label,
        MIN(m.panel_title) AS panel_title,
        MIN(m.metrics_source_id::text)::uuid AS metrics_source_id
      FROM ds_metrics m
      WHERE m.test_run_id = $1
        AND m.application_dashboard_id = ANY($2::uuid[])
        AND m.ramp_up = false
        AND m.value IS NOT NULL
      GROUP BY m.application_dashboard_id, m.panel_id, left(m.metric_name, 255)
    ),
    ins AS (
    INSERT INTO ds_metric_statistics (
      test_run_id, application_dashboard_id, panel_id, metric_name, benchmark_id,
      dashboard_uid, dashboard_label, panel_title, unit,
      count, mean, median, min_value, max_value, std_dev, last_value,
      n_missing, n_non_zero,
      q10, q25, q75, q90, q95, q99, percentiles,
      iqr, idr, is_constant, constant_value, all_missing, pct_missing, missing_percentage,
      updated_at, test_run_start, organization_id, team_id,
      metrics_source_id, created_by, updated_by,
      pct_agg, sum_value, sum_sq_value
    )
    SELECT
      $1, g.application_dashboard_id, g.panel_id, g.metric_name, NULL,
      g.dashboard_uid, COALESCE(g.dashboard_label, 'missing'), COALESCE(g.panel_title, 'missing'), g.unit,
      g.count, g.mean, approx_percentile(0.50, g.pct_agg), g.min_value, g.max_value, g.std_dev, g.last_value,
      0, g.n_non_zero,
      approx_percentile(0.10, g.pct_agg), approx_percentile(0.25, g.pct_agg),
      approx_percentile(0.75, g.pct_agg), approx_percentile(0.90, g.pct_agg),
      approx_percentile(0.95, g.pct_agg), approx_percentile(0.99, g.pct_agg),
      jsonb_build_object(
        'p10', approx_percentile(0.10, g.pct_agg),
        'p25', approx_percentile(0.25, g.pct_agg),
        'p50', approx_percentile(0.50, g.pct_agg),
        'p75', approx_percentile(0.75, g.pct_agg),
        'p90', approx_percentile(0.90, g.pct_agg),
        'p95', approx_percentile(0.95, g.pct_agg),
        'p99', approx_percentile(0.99, g.pct_agg)
      ),
      approx_percentile(0.75, g.pct_agg) - approx_percentile(0.25, g.pct_agg),
      approx_percentile(0.90, g.pct_agg) - approx_percentile(0.10, g.pct_agg),
      (g.min_value = g.max_value), (g.min_value = g.max_value), false, 0, 0,
      NOW(), $3::timestamptz, $4::uuid, $5::uuid,
      g.metrics_source_id, 'worker-pipeline', 'worker-pipeline',
      g.pct_agg, g.sum_value, g.sum_sq_value
    FROM grouped g
    ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name)
    DO UPDATE SET
      benchmark_id        = EXCLUDED.benchmark_id,
      dashboard_uid       = EXCLUDED.dashboard_uid,
      dashboard_label     = EXCLUDED.dashboard_label,
      panel_title         = EXCLUDED.panel_title,
      unit                = EXCLUDED.unit,
      count               = EXCLUDED.count,
      mean                = EXCLUDED.mean,
      median              = EXCLUDED.median,
      min_value           = EXCLUDED.min_value,
      max_value           = EXCLUDED.max_value,
      std_dev             = EXCLUDED.std_dev,
      last_value          = EXCLUDED.last_value,
      n_missing           = EXCLUDED.n_missing,
      n_non_zero          = EXCLUDED.n_non_zero,
      q10                 = EXCLUDED.q10,
      q25                 = EXCLUDED.q25,
      q75                 = EXCLUDED.q75,
      q90                 = EXCLUDED.q90,
      q95                 = EXCLUDED.q95,
      q99                 = EXCLUDED.q99,
      percentiles         = EXCLUDED.percentiles,
      iqr                 = EXCLUDED.iqr,
      idr                 = EXCLUDED.idr,
      is_constant         = EXCLUDED.is_constant,
      constant_value      = EXCLUDED.constant_value,
      all_missing         = EXCLUDED.all_missing,
      pct_missing         = EXCLUDED.pct_missing,
      missing_percentage  = EXCLUDED.missing_percentage,
      updated_at          = NOW(),
      test_run_start      = EXCLUDED.test_run_start,
      organization_id     = EXCLUDED.organization_id,
      team_id             = EXCLUDED.team_id,
      metrics_source_id   = EXCLUDED.metrics_source_id,
      updated_by          = EXCLUDED.updated_by,
      pct_agg             = EXCLUDED.pct_agg,
      sum_value           = EXCLUDED.sum_value,
      sum_sq_value        = EXCLUDED.sum_sq_value
    RETURNING 1
    )
    SELECT count(*)::int AS n FROM ins
  `;

  const started = Date.now();
  const result = await dataSource.query(sql, [
    testRunId,
    dashboardIds,
    testRun.start_time,
    testRun.organization_id ?? null,
    testRun.team_id ?? null,
  ]);
  const rowCount = readInsertedCount(result);

  logger.info(
    `✅ Performance-test statistics: ${rowCount} records upserted in ${Date.now() - started}ms`
  );
  return rowCount;
}
