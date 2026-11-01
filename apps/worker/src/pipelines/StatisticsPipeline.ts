import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import { EntityManager } from 'typeorm';
import { buildStatisticsInsertSQL } from './helpers/statistics-sql.js';
import {
  alignmentKey,
  buildGroupedExclusion,
  buildGroupedStatisticsSQL,
  buildMembership,
  DELETE_MEMBERSHIP_SQL,
  groupedPanelTriples,
  groupedStatementParams,
  INSERT_MEMBERSHIP_SQL,
  loadSeriesGroupingContext,
  membersPerGroup,
  membershipInsertParams,
  MISALIGNED_AVG_MEMBERS,
  NO_SERIES_GROUPING,
  SERIES_OF_DASHBOARDS_SQL,
  type MembershipRow,
  type SeriesGroupingContext,
  type SeriesRow,
} from './helpers/series-grouping-plan.js';

export interface StatisticsInput {
  testRunIds: string[];
}

/**
 * StatisticsPipeline — Per-Test-Run Descriptive Statistics
 *
 * Computes descriptive statistics for every (test_run, dashboard, panel, metric)
 * tuple and writes them to `ds_metric_statistics`. These per-run statistics are
 * later aggregated into control group statistics and consumed by the ADAPT
 * regression detection algorithm.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * SQL CTE Chain Overview
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   metrics_filtered          Raw data points from ds_metrics, filtered:
 *        │                      - ramp_up = false  (exclude warm-up period; see below)
 *        │                      - value IS NOT NULL (ignore gaps)
 *        │                      - dashboard org-scoping via application_dashboards / dynatrace_queries
 *        ▼
 *   statistics_aggregated     GROUP BY (test_run, dashboard, panel, metric):
 *        │                      - Classical: COUNT, AVG (mean), MIN, MAX, STDDEV_POP
 *        │                      - TimescaleDB: percentile_agg(value) — single-pass t-digest sketch
 *        │                      - Auxiliary: n_missing, n_non_zero
 *        │                      - last_value: value at the greatest time, via last()
 *        ▼
 *   final_statistics          Derives remaining columns from the aggregates:
 *        │                      - Percentiles via approx_percentile(p, pct_agg):
 *        │                          median (p50), q10, q25, q75, q90, q95, q99
 *        │                      - IQR = q75 - q25  (interquartile range — robust spread)
 *        │                      - IDR = q90 - q10  (interdecile range — wider robust spread)
 *        │                      - is_constant: true when all values are identical (min = max)
 *        │                      - all_missing: true when every observation is NULL
 *        │                      - pct_missing: percentage of NULL observations
 *        ▼
 *   INSERT INTO ds_metric_statistics  (delete-then-insert for idempotent re-runs)
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Ramp-Up Filtering
 * ──────────────────────────────────────────────────────────────────────────────
 * Load tests typically begin with a warm-up / ramp-up phase where virtual users
 * gradually increase. Metrics collected during this phase are non-representative
 * of steady-state behavior. The MetricsPipeline marks these data points with
 * ramp_up = true. This pipeline excludes them so statistics reflect only the
 * steady-state portion of the test.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Percentile Calculation
 * ──────────────────────────────────────────────────────────────────────────────
 * Uses TimescaleDB Toolkit's `percentile_agg()` which builds a t-digest sketch
 * in a single pass over the data, then `approx_percentile(p, sketch)` extracts
 * approximate quantiles. This avoids sorting the full dataset and is O(n) in
 * both time and memory. The t-digest provides high accuracy at the tails (p10,
 * p90, p95, p99) where it matters most for performance analysis.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Quality Flags
 * ──────────────────────────────────────────────────────────────────────────────
 * - is_constant:  All observed values are identical (min = max).
 *                 Downstream ADAPT treats these specially since std_dev = 0
 *                 makes ratio-based thresholds meaningless.
 * - all_missing:  Every observation in the group is NULL (count = n_missing).
 *                 The metric exists in the dashboard definition but produced no
 *                 usable data — ADAPT labels these "incomparable".
 */
/**
 * Whether a metric sample falls in a run's ramp-up or ramp-down window.
 *
 * Module-level so the read-only pre-check, the UPDATE's SET and the UPDATE's
 * change-guard all interpolate one definition and cannot drift apart. Uses the
 * `m` (ds_metrics) and `tr` (test_runs) aliases every consumer supplies.
 */
const RAMP_UP_EXPR = `(
      -- The offsets have to FIT inside the run. When they do not — a run shorter
      -- than analysisStartOffset + analysisEndOffset — the leading and trailing
      -- windows overlap and every sample matches one of them, so the whole run
      -- is flagged outside the analysis window. Nothing downstream survives that:
      -- ds_metric_statistics comes out empty, the Apdex rollup misses on every
      -- transaction, and ADAPT reports INSUFFICIENT_DATA against a run that has
      -- data. It is also the worst case for the UPDATE below, which then rewrites
      -- every row of a compressed run instead of a boundary band.
      --
      -- Analysing the whole run is the honest fallback: the offsets are a request
      -- to trim, not a request to discard. Mirrored in MetricsPipeline so a newly
      -- ingested run is baked the same way.
      EXTRACT(EPOCH FROM (tr.end_time - tr.start_time))
        > COALESCE(tr.ramp_up, 0) + COALESCE(tr.ramp_down, 0)
      AND (
        EXTRACT(EPOCH FROM (m.time - tr.start_time)) < COALESCE(tr.ramp_up, 0)
        OR (
          COALESCE(tr.ramp_down, 0) > 0
          AND EXTRACT(EPOCH FROM (m.time - tr.start_time))
              > EXTRACT(EPOCH FROM (tr.end_time - tr.start_time)) - COALESCE(tr.ramp_down, 0)
        )
      )
    )`;

export class StatisticsPipeline extends BasePipelineTypeORM {

  validateInput(input: unknown): boolean {
    if (!input || typeof input !== 'object') {return false;}
    const typedInput = input as { testRunIds?: unknown[] };
    return Array.isArray(typedInput.testRunIds) &&
           typedInput.testRunIds.length > 0 &&
           typedInput.testRunIds.every((id: unknown) => typeof id === 'string');
  }

  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();

    if (!this.validateInput(input)) {
      return this.createErrorResult('Invalid input: expected { testRunIds: string[] }', 'INVALID_INPUT');
    }

    const { testRunIds } = input as StatisticsInput;

    try {
      this.logger.info(`Starting statistics aggregation for test runs: ${testRunIds.join(', ')}`);

      // Establish ONE set of runs for everything below. The flag refresh, the
      // decompression it needs, and the aggregation must all cover the same runs: a run
      // that gets new ds_metrics.ramp_up flags but keeps the previous window's
      // ds_metric_statistics is silently incoherent, and ADAPT pools it into a control
      // group as if it were current. A bulk analysis-window edit is exactly what
      // produces that combination, so this is not a theoretical ordering concern.
      const runIds = await this.filterRunsWithMetrics(testRunIds);
      const agedOut = testRunIds.filter((id) => !runIds.includes(id));
      if (agedOut.length > 0) {
        this.logger.warn(
          `⚠️ No ds_metrics rows for test run(s): ${agedOut.join(', ')} — leaving their ` +
            `existing statistics and ramp_up flags untouched (nothing could rebuild them)`
        );
      }
      if (runIds.length === 0) {
        this.logger.warn('💡 Nothing to aggregate: MetricsPipeline may not have run for these test runs');
        return this.createSuccessResult({ processedRecords: 0, testRunIds: testRunIds.length }, Date.now() - startTime);
      }

      // Refresh the ds_metrics.ramp_up flag from each run's CURRENT analysis
      // offsets before aggregating. The flag is otherwise baked once at
      // ingestion (MetricsPipeline), so editing the analysis time range on a
      // completed run — which skips metric-collection on re-analysis — would
      // leave ADAPT reading the OLD window (#421-followup / analysis-time-range).
      //
      // Ask with a read before writing: on a compressed chunk the UPDATE's own
      // guard is what triggers the decompression, so "only rows that change are
      // written" does not make it free. See findRunsWithStaleRampUpFlags.
      const staleRuns = await this.findRunsWithStaleRampUpFlags(runIds);

      // Same shape, and the same fix, as the force-refetch guard in
      // simple-orchestrate-reevaluate-batch.ts: decompress up front, outside the
      // transaction, so the UPDATE never has to do it as DML. The compression
      // policy recompresses on its next pass.
      //
      // Per run, over the span of the DISAGREEING rows — not the run's full
      // window, and not one global min/max across every stale run. decompress_chunk
      // works at chunk granularity and a chunk holds every run in its time range,
      // so widening the range is not free: it converts other runs' data to row
      // store too, and every later query over that window scans row store until the
      // compression policy catches up. A stale trailing flag spans minutes; the old
      // run-wide bounds decompressed hours, and a batch of stale runs weeks.
      for (const run of staleRuns) {
        await this.db.decompressChunksForRange('ds_metrics', run.from, run.to);
      }

      // Series grouping rules, loaded on the pooled connection BEFORE the transaction opens: an
      // error inside it would abort the transaction (25P02), and this stage is not softFail.
      // Never throws; a deploy without migration 1819 gets NO_SERIES_GROUPING.
      const grouping = await loadSeriesGroupingContext(this.db, runIds, this.logger);

      const result = await this.withAnalyticsTransaction(async (manager: EntityManager) => {
        // First statement in the transaction, not next to the INSERT: SET LOCAL is
        // transaction-scoped, and refreshRampUpFlags below rewrites a compressed run
        // — it is the statement most likely to blow the 120s analytics cap, and it
        // runs before the aggregation the cap was raised for.
        await this.setAggregationBudget(manager);

        if (staleRuns.length > 0) {
          await this.refreshRampUpFlags(manager, staleRuns);
        } else {
          this.logger.info(
            `🕒 ramp_up flags already match the current analysis offsets for ${runIds.length} run(s) — no update needed`
          );
        }
        return await this.aggregateMetricStatistics(manager, runIds, grouping);
      });

      // Deliberately does NOT recompress here. refreshRampUpFlags guards on `ramp_up`, which
      // is neither segmentby nor orderby, so this pipeline genuinely cannot avoid decompression
      // (that is why it is ruled out of #563's segment-targeting fix) — but it is also called
      // several times per re-evaluate, once per REEVALUATE_CHUNK_SIZE chunk of runs. Putting
      // the chunks back between those calls would make each next chunk decompress them again.
      // The re-evaluate orchestrator recompresses once, after every stage, via the shared
      // WorkerDatabaseService tracking set.

      const duration = Date.now() - startTime;
      this.logPerformance('statistics-aggregation', startTime, {
        testRunIds: testRunIds.length,
        processedRecords: result.rowCount
      });

      return this.createSuccessResult({
        processedRecords: result.rowCount,
        testRunIds: testRunIds.length
      }, duration);

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logError(error as Error, { testRunIds });
      return this.createErrorResult(
        error as Error,
        'STATISTICS_AGGREGATION_FAILED',
        { testRunIds },
        duration
      );
    }
  }

  /**
   * Recompute `ds_metrics.ramp_up` for the given runs from their current analysis
   * offsets (test_runs.ramp_up = analysisStartOffset, test_runs.ramp_down =
   * analysisEndOffset). A point is outside the analysis window — flagged
   * ramp_up=true — when it falls in the leading start-offset window OR the trailing
   * end-offset window: the canonical `[start + startOffset, end - endOffset]` range
   * that the SLO charts, TransactionStatsRollupPipeline, and the incremental
   * collector all use.
   *
   * The `IS DISTINCT FROM` guard writes only rows whose flag actually changes.
   * For incrementally-ingested runs this is a true no-op when offsets are
   * unchanged. Runs originally ingested by the non-incremental MetricsPipeline get
   * their trailing flags corrected once here: that path double-subtracts the end
   * offset (bakes `end - 2*endOffset`; see MetricsPipeline.effectiveEndTime +
   * flattenSingleDocument) — a pre-existing bug this refresh supersedes before ADAPT
   * reads the flag, since statistics-calculation always follows metrics-collection.
   *
   * Runs with a NULL start_time or end_time are skipped (window undefined) — the
   * flag stays as ingested, matching MetricsPipeline's `Infinity` duration branch.
   */
  /**
   * Which of these runs actually have a ramp_up flag that disagrees with the
   * run's current analysis offsets — and over what time range those rows lie.
   *
   * This is a SELECT on purpose. `ramp_up` is neither `compress_segmentby`
   * (test_run_id) nor `compress_orderby` (time), so the UPDATE's guard predicate
   * cannot be pushed into a compressed batch: TimescaleDB decompresses the run's
   * whole segment as DML just to discover nothing needs writing. Measured on a
   * 2.6M-row run whose flags were already correct: 53s, 2,620,348 tuples
   * decompressed, then `tuple decompression limit exceeded by operation`
   * (max_tuples_decompressed_per_dml_transaction defaults to 100k). A read pays
   * none of that — the executor decompresses transiently and rewrites nothing.
   *
   * Every run the ADAPT sketch backfill repairs is older than the 7-day
   * compression policy by construction, so this is the normal path there, not
   * an edge case.
   */
  /**
   * Which of these runs still have raw `ds_metrics` at all?
   *
   * This is the guard on the DELETE in `aggregateMetricStatistics`: a run whose
   * metrics have aged out must KEEP its statistics rather than have them wiped and
   * replaced with nothing, because nothing can rebuild them.
   *
   * It deliberately asks only "do any rows exist", NOT "are any rows steady-state"
   * (`ramp_up = false AND value IS NOT NULL`), for two reasons:
   *
   *  1. `ramp_up` is precisely what `refreshRampUpFlags` is about to rewrite, so a
   *     steady-state probe answers against flags that are one statement from being
   *     stale — and its answer decides whether the run gets new flags at all.
   *  2. "the new window excludes every sample" is a real, correct outcome that should
   *     produce empty statistics, not a reason to skip the run and strand it with new
   *     flags and the previous window's statistics.
   *
   * Everything downstream — the decompression, the flag refresh and the aggregation —
   * runs on exactly this set, which is what keeps the three consistent.
   *
   * Per run rather than once for the batch: a batch-wide answer let one run with live
   * metrics authorise deleting the statistics of every aged-out run beside it. Each
   * probe is an index descent that stops at the first row (`test_run_id` is the
   * `compress_segmentby` key and leads the index), so N probes cost effectively nothing.
   */
  private async filterRunsWithMetrics(testRunIds: string[]): Promise<string[]> {
    const withMetrics: string[] = [];
    for (const testRunId of testRunIds) {
      const probe = await this.db.query(
        'SELECT EXISTS (SELECT 1 FROM ds_metrics WHERE test_run_id = $1) AS has_metrics',
        [testRunId]
      );
      if (probe[0]?.has_metrics) { withMetrics.push(testRunId); }
    }
    return withMetrics;
  }

  private async findRunsWithStaleRampUpFlags(
    testRunIds: string[]
  ): Promise<Array<{ testRunId: string; from: Date; to: Date }>> {
    const placeholders = testRunIds.map((_, i) => `$${i + 1}`).join(', ');

    // MIN/MAX over the disagreeing rows, not the run's own start/end. Those bounds
    // are what the decompression and the UPDATE below are scoped to, and a stale
    // trailing flag typically spans minutes out of a multi-hour run.
    //
    // This costs one full read of the run where the old EXISTS short-circuited on
    // the first disagreeing row. That trade is worth making: a read decompresses
    // transiently and rewrites nothing, while the run-wide bounds it replaces put
    // every chunk of the run into row store for good. The 939ms in apps/worker/CLAUDE.md is the
    // 2.6M-row figure and scales roughly linearly — budget ~8s on a 20M-row run.
    const sql = `
      SELECT tr.test_run_id, MIN(m.time) AS from_time, MAX(m.time) AS to_time
      FROM test_runs tr
      JOIN ds_metrics m ON m.test_run_id = tr.test_run_id
      WHERE tr.test_run_id IN (${placeholders})
        AND tr.start_time IS NOT NULL
        AND tr.end_time IS NOT NULL
        AND m.ramp_up IS DISTINCT FROM ${RAMP_UP_EXPR}
      GROUP BY tr.test_run_id
    `;

    const rows: Array<{ test_run_id: string; from_time: Date; to_time: Date }> =
      await this.db.query(sql, testRunIds);

    // A run with nothing to fix produces no group, so it never reaches the UPDATE.
    //
    // The isFinite filter belongs HERE rather than at the decompression loop: both
    // the decompression and the UPDATE bind these bounds, so skipping only the
    // former would still hand Postgres an Invalid Date as $2/$3 — and with the
    // chunks left compressed. MIN/MAX carry no NOT NULL guarantee of their own
    // (the run's start_time/end_time do, but these are ds_metrics.time), so a
    // malformed row drops the whole run rather than half-processing it.
    return (rows ?? [])
      .map((r) => ({ testRunId: r.test_run_id, from: r.from_time, to: r.to_time }))
      .filter(
        (r) =>
          Number.isFinite(new Date(r.from).getTime()) && Number.isFinite(new Date(r.to).getTime())
      );
  }

  private async refreshRampUpFlags(
    manager: EntityManager,
    staleRuns: Array<{ testRunId: string; from: Date; to: Date }>
  ): Promise<void> {
    // One statement per run, bounded by the disagreeing rows' time span. Both
    // predicates earn their place in the compressed layout: test_run_id is
    // compress_segmentby and time is compress_orderby, so TimescaleDB can skip
    // whole batches by their min/max time metadata instead of decompressing the
    // run's entire segment to evaluate the ramp_up guard.
    //
    // Splitting per run narrows the tuples each statement touches; it does NOT give
    // each run its own decompression budget —
    // max_tuples_decompressed_per_dml_transaction (100k) is charged per TRANSACTION
    // and all N statements share one. What keeps the loop under it is the up-front
    // decompressChunksForRange; if that silently no-ops the limit is still reachable.
    const sql = `
      UPDATE ds_metrics m
      SET ramp_up = ${RAMP_UP_EXPR}
      FROM test_runs tr
      WHERE m.test_run_id = tr.test_run_id
        AND m.test_run_id = $1
        AND m.time >= $2
        AND m.time <= $3
        AND tr.start_time IS NOT NULL
        AND tr.end_time IS NOT NULL
        AND m.ramp_up IS DISTINCT FROM ${RAMP_UP_EXPR}
    `;

    let affected = 0;
    for (const run of staleRuns) {
      const result = await manager.query(sql, [run.testRunId, run.from, run.to]);
      // pg returns [rows, rowCount] for UPDATE via node-postgres; TypeORM's raw
      // query surfaces an array whose affected count we log best-effort.
      affected += (Array.isArray(result) ? (result[1] ?? 0) : 0) as number;
    }

    this.logger.info(
      `🕒 Refreshed ramp_up flags against current analysis offsets for ${staleRuns.length} run(s) (${affected} rows changed)`
    );
  }

  /**
   * The raw -> group membership of these runs' grouped panels. One read per run of the
   * dashboards its rules touch; nothing at all when no rule covers the batch.
   */
  private async buildSeriesMembership(
    manager: EntityManager,
    runIds: string[],
    grouping: SeriesGroupingContext
  ): Promise<MembershipRow[]> {
    if (grouping.rules.length === 0) {return [];}
    const series: SeriesRow[] = [];
    for (const runId of runIds) {
      const dashboards = Array.from(
        new Set(grouping.rules.filter((r) => r.testRunId === runId).map((r) => r.applicationDashboardId))
      );
      if (dashboards.length === 0) {continue;}
      const rows: Array<Omit<SeriesRow, 'test_run_id'>> =
        (await manager.query(SERIES_OF_DASHBOARDS_SQL, [runId, dashboards])) ?? [];
      for (const row of rows) {
        series.push({ ...row, test_run_id: runId, panel_id: Number(row.panel_id) });
      }
    }
    return buildMembership(grouping.rules, series);
  }

  /**
   * Statistics for the grouped panels, in their own statement (the main one skipped them), plus
   * the alignment check: a multi-member group whose members never share a timestamp is not being
   * combined at all, and that must be said rather than stored as a quiet average of one.
   */
  private async aggregateGroupedPanels(
    manager: EntityManager,
    runIds: string[],
    membership: MembershipRow[],
    grouping: SeriesGroupingContext,
    startedAt: number
  ): Promise<void> {
    const alignment: Array<Record<string, unknown>> =
      (await manager.query(
        buildGroupedStatisticsSQL(runIds.length),
        groupedStatementParams(runIds, membership)
      )) ?? [];

    const members = membersPerGroup(membership);
    for (const row of alignment) {
      const count = members.get(alignmentKey(row as never)) ?? 0;
      const avg = Number(row.avg_members);
      if (count >= 2 && Number.isFinite(avg) && avg < MISALIGNED_AVG_MEMBERS) {
        const sample = membership.find((m) => alignmentKey(m) === alignmentKey(row as never));
        this.logger.warn(
          `series-grouping: ${sample?.dashboard_label ?? row.application_dashboard_id}/${sample?.panel_title ?? row.panel_id} ` +
            `group "${String(row.group_name)}" has ${count} members but ${avg.toFixed(2)} per timestamp; ` +
            `timestamps are not aligned, so values are not combined`
        );
      }
    }

    const groups = new Set(membership.map((m) => alignmentKey(m)));
    const memberCountSeries = new Set(
      membership.filter((m) => m.track_member_count && m.member_count_name).map((m) => alignmentKey(m))
    );
    const [panelRuns] = groupedPanelTriples(membership);
    this.logger.info(
      `series-grouping: runs=${new Set(membership.map((m) => m.test_run_id)).size} rules=${grouping.rules.length} ` +
        `panels=${panelRuns.length} rawSeries=${membership.length} groups=${groups.size} ` +
        `memberCountSeries=${memberCountSeries.size} in ${Date.now() - startedAt}ms`
    );
  }

  private async aggregateMetricStatistics(
    manager: EntityManager,
    testRunIds: string[],
    grouping: SeriesGroupingContext = NO_SERIES_GROUPING
  ): Promise<{ success: boolean; rowCount: number }> {

    this.logger.info(`📊 Aggregating statistics for ${testRunIds.length} test run(s): ${testRunIds.join(', ')}`);

    // The caller has already filtered to runs that HAVE ds_metrics (filterRunsWithMetrics,
    // called once in execute). That filter, the decompression, the ramp_up refresh and this
    // aggregation must all cover the SAME set: a run that gets new flags but keeps the
    // previous window's statistics is silently incoherent, and ADAPT pools it into a
    // control group as current. This method therefore does no filtering of its own —
    // `testRunIds` here is already the filtered set, not the original request.
    const targetRunIds = testRunIds;

    // Build parameterized query placeholders
    const placeholders = targetRunIds.map((_, i) => `$${i + 1}`).join(', ');

    // Series grouping: the membership of every grouped panel, computed in JS (one regex dialect)
    // from the series that panel actually has. Empty unless a rule covers these runs.
    const groupingStart = Date.now();
    const membership = await this.buildSeriesMembership(manager, targetRunIds, grouping);
    const [groupedRuns, groupedDashboards, groupedPanels] = groupedPanelTriples(membership);

    // With no grouped panel both the SQL and its parameters are exactly what this pipeline
    // issued before series grouping existed (pinned by the "SQL pin" snapshot test).
    const groupedExclusion = groupedRuns.length > 0 ? buildGroupedExclusion(targetRunIds.length + 1) : '';
    const aggregationParams =
      groupedRuns.length > 0 ? [...targetRunIds, groupedRuns, groupedDashboards, groupedPanels] : targetRunIds;
    const aggregationSQL = buildStatisticsInsertSQL(placeholders, groupedExclusion);

    // Step 1: DELETE existing statistics for these test runs INSIDE the transaction
    // This prevents duplicate key constraint violations when re-analyzing test runs
    this.logger.info(`🧹 Deleting existing statistics for re-analysis...`);

    const deleteSQL = `
      DELETE FROM ds_metric_statistics
      WHERE test_run_id IN (${placeholders})
    `;

    const deleteResult = await manager.query(deleteSQL, targetRunIds);
    // TypeORM surfaces a DELETE as [rows, rowCount]; `.rowCount` on that array is
    // always undefined, so the old log claimed 0 even when rows were removed.
    const deletedRows = Array.isArray(deleteResult) ? (deleteResult[1] ?? undefined) : undefined;

    this.logger.info(
      `✅ Deleted ${deletedRows ?? 'an unknown number of'} existing statistic records for test runs: ${targetRunIds.join(', ')}`
    );

    // Series grouping membership, rewritten with the statistics it describes. Deleted whenever a
    // rule exists or a removed rule left rows behind; skipped entirely otherwise, so a deploy
    // that never uses grouping issues nothing extra here.
    if (grouping.tablesPresent && (grouping.rules.length > 0 || grouping.hasExistingMembership)) {
      await manager.query(DELETE_MEMBERSHIP_SQL(placeholders), targetRunIds);
    }
    if (membership.length > 0) {
      await manager.query(INSERT_MEMBERSHIP_SQL, membershipInsertParams(membership));
    }

    // Step 2: INSERT new statistics (no ON CONFLICT needed since we deleted existing records)
    this.logger.info(`🚀 Executing statistics aggregation INSERT...`);

    await manager.query(aggregationSQL, aggregationParams);

    if (membership.length > 0) {
      await this.aggregateGroupedPanels(manager, targetRunIds, membership, grouping, groupingStart);
    }

    // For CTE-based INSERT...SELECT, TypeORM doesn't return rowCount reliably
    // Verify the actual count from the database
    const actualCountQuery = `
      SELECT COUNT(*)::integer as count
      FROM ds_metric_statistics
      WHERE test_run_id IN (${placeholders})
    `;
    const actualCountResult = await manager.query(actualCountQuery, targetRunIds);
    const actualCount = actualCountResult[0]?.count || 0;

    this.logger.info(
      `✅ Statistics aggregation completed: deleted ${deletedRows ?? 'an unknown number of'}, wrote ${actualCount} statistic records`
    );

    if (actualCount === 0) {
      // The probe only established that the run HAS ds_metrics rows — it deliberately no
      // longer asks whether any are in-window, because that depends on the ramp_up flags
      // this pipeline rewrites. So zero has two causes now, and they are not
      // distinguishable here: org-scoping dropped every dashboard (a real problem), or the
      // new analysis window legitimately excludes every sample (correct, and the reason
      // the caller edited the offsets). Warn rather than assert.
      this.logger.warn('⚠️  Metrics exist for these test runs but no statistics were written - possible data issue');
    }

    return { success: true, rowCount: actualCount };
  }
}