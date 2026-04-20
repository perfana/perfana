import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';

export interface TransactionStatsRollupInput {
  testRunId: string;
}

interface RollupRowCount {
  rows: string | number;
}

/**
 * Transaction Stats Rollup Pipeline (#150, #151)
 *
 * Computes per-(test_run, transaction, [sampler]) aggregates once at test-run
 * finalization and upserts them into `test_run_transaction_stats` and
 * `test_run_sampler_stats`. Dashboard endpoints then read O(N) rollup rows
 * instead of re-scanning O(Nm) rows in `transactions` / `requests_raw` on
 * every refresh.
 *
 * Two rows per group are written (PK includes `ramp_up_excluded`):
 *   - false = full run
 *   - true  = from (start_time + ramp_up) onward
 *
 * The Overview-tab row expand defaults `excludeRampUp=true`, so both variants
 * must exist for the fast path to cover the common case. Editing
 * `analysisStartOffset` on a completed run triggers this pipeline again to
 * recompute the `ramp_up_excluded=true` rows against the new cutoff.
 *
 * Both aggregates are computed in a single pass using `FILTER` clauses, then
 * emitted as two rows via `UNION ALL`. The ramp-up-excluded row is skipped
 * when its group has zero rows (e.g., a test aborted during ramp-up).
 *
 * `pct_agg` is stored as a TimescaleDB toolkit tdigest; p95/p99 and Apdex are
 * computed at read time via `approx_percentile` / `approx_percentile_rank`
 * against the *current* threshold, so threshold edits take effect immediately
 * without any recompute.
 */
export class TransactionStatsRollupPipeline extends BasePipelineTypeORM {

  validateInput(input: unknown): boolean {
    return (
      typeof input === 'object' &&
      input !== null &&
      typeof (input as TransactionStatsRollupInput).testRunId === 'string' &&
      (input as TransactionStatsRollupInput).testRunId.length > 0
    );
  }

  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();
    const { testRunId } = input as TransactionStatsRollupInput;

    try {
      await this.ensureConnection();

      const testRun = await this.db.getTestRunByTestRunId(testRunId);
      if (!testRun) {
        return this.createErrorResult(
          `Test run not found: ${testRunId}`,
          'TEST_RUN_NOT_FOUND',
          { testRunId },
          Date.now() - startTime
        );
      }

      if (!testRun.completed) {
        this.logger.info(
          `Skipping stats rollup for ${testRunId}: test run not completed yet`
        );
        return this.createSuccessResult(
          { testRunId, skipped: 'not-completed' },
          Date.now() - startTime
        );
      }

      if (!testRun.startTime) {
        this.logger.warn(
          `Skipping stats rollup for ${testRunId}: test run has no start_time`
        );
        return this.createSuccessResult(
          { testRunId, skipped: 'no-start-time' },
          Date.now() - startTime
        );
      }

      // Compute ramp-up cutoff. If analysisStartOffset is 0/null, cutoff ==
      // start_time so the FILTER clause matches every row and the
      // ramp_up_excluded=true variant becomes identical to the full-run
      // variant — same semantics the live query has today.
      const rampUpSeconds = testRun.analysisStartOffset ?? 0;
      const cutoff = new Date(
        testRun.startTime.getTime() + rampUpSeconds * 1000
      );

      this.logger.info(
        `🎯 Rolling up transaction stats for ${testRunId} (ramp_up=${rampUpSeconds}s, cutoff=${cutoff.toISOString()})`
      );

      // Use `db.transaction` directly (NOT `withAnalyticsTransaction`): the
      // default 120s analytics budget is LESS than the live query this rollup
      // replaces (measured 135–213s for 11M-row `stream_download_segment`),
      // so the rollup would time out before it finishes on the exact runs
      // that most need it. Give it 10 minutes — it's a background job.
      const rollupTimeoutMs = parseInt(
        process.env.ROLLUP_STATEMENT_TIMEOUT_MS || '600000', 10,
      );

      const result = await this.db.transaction(async (manager) => {
        await manager.query(`SET LOCAL statement_timeout = '${rollupTimeoutMs}'`);
        // work_mem boost matches the current online query (see
        // TestRunsPerformanceQueryService). Needed for the tdigest
        // aggregation over millions of rows per test run.
        await manager.query(`SET LOCAL work_mem = '512MB'`);

        // DELETE before INSERT: UPSERT alone can't evict groups that no
        // longer exist. Two scenarios where stale rows would otherwise
        // survive: (a) updateAnalysisStartOffset increases ramp_up so a
        // group that had filtered rows no longer does — the `WHERE total_excl
        // > 0` clause in the INSERT skips it, and the old row sticks around
        // with pre-edit numbers; (b) a rerun after `transactions` /
        // `requests_raw` rows were deleted or merged. Wiping all rows for
        // this test_run_id first guarantees the rollup reflects current data.
        await manager.query(
          `DELETE FROM test_run_transaction_stats WHERE test_run_id = $1`,
          [testRunId],
        );
        await manager.query(
          `DELETE FROM test_run_sampler_stats WHERE test_run_id = $1`,
          [testRunId],
        );

        const txResult = await manager.query<RollupRowCount[]>(
          TRANSACTION_ROLLUP_SQL,
          [testRunId, cutoff]
        );
        const samplerResult = await manager.query<RollupRowCount[]>(
          SAMPLER_ROLLUP_SQL,
          [testRunId, cutoff]
        );

        // manager.query returns the INSERT's affected count via rowCount,
        // but TypeORM collapses that into the result array. For logging
        // purposes, just re-count from the rollup tables.
        const [{ count: txCount }] = await manager.query<{ count: string }[]>(
          `SELECT COUNT(*)::text AS count FROM test_run_transaction_stats WHERE test_run_id = $1`,
          [testRunId]
        );
        const [{ count: samplerCount }] = await manager.query<
          { count: string }[]
        >(
          `SELECT COUNT(*)::text AS count FROM test_run_sampler_stats WHERE test_run_id = $1`,
          [testRunId]
        );

        return {
          transactionRows: parseInt(txCount, 10),
          samplerRows: parseInt(samplerCount, 10),
          _tx: txResult,
          _sampler: samplerResult,
        };
      });

      const duration = Date.now() - startTime;
      this.logger.info(
        `✅ Rolled up ${testRunId}: ${result.transactionRows} transaction rows, ${result.samplerRows} sampler rows in ${duration}ms`
      );
      this.logPerformance('transaction-stats-rollup', startTime, {
        testRunId,
        rampUpSeconds,
        transactionRows: result.transactionRows,
        samplerRows: result.samplerRows,
      });

      return this.createSuccessResult(
        {
          testRunId,
          transactionRows: result.transactionRows,
          samplerRows: result.samplerRows,
          rampUpSeconds,
        },
        duration
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));
      this.logError(err, { testRunId, stage: 'transaction-stats-rollup' });
      return this.createErrorResult(
        err,
        'TRANSACTION_STATS_ROLLUP_FAILED',
        { testRunId },
        duration
      );
    }
  }
}

/**
 * Transaction-level rollup: one scan over `transactions` per test run.
 * `FILTER (WHERE t.time >= $2)` computes the ramp-up-excluded variant in the
 * same pass. `UNION ALL` emits two rows per group; the excluded row is
 * omitted when its group has zero rows in the measurement window.
 */
const TRANSACTION_ROLLUP_SQL = `
  WITH base AS (
    SELECT
      t.test_run_id,
      t.transaction_name,
      COALESCE(t.scenario_name, '')                                        AS scenario_name,
      tr.system_under_test_id,
      tr.test_environment,
      tr.workload,
      COUNT(*)                                                             AS total_full,
      COUNT(*) FILTER (WHERE t.success)                                    AS passed_full,
      COUNT(*) FILTER (WHERE NOT t.success)                                AS failed_full,
      ROUND(AVG(t.response_time)::numeric, 2)                              AS avg_full,
      ROUND((AVG(t.response_time) * COUNT(*))::numeric, 2)                 AS impact_full,
      percentile_agg(t.response_time::double precision)                    AS pct_full,
      COUNT(*) FILTER (WHERE t.time >= $2)                                 AS total_excl,
      COUNT(*) FILTER (WHERE t.success     AND t.time >= $2)               AS passed_excl,
      COUNT(*) FILTER (WHERE NOT t.success AND t.time >= $2)               AS failed_excl,
      ROUND(AVG(t.response_time) FILTER (WHERE t.time >= $2)::numeric, 2)  AS avg_excl,
      ROUND((
        AVG(t.response_time) FILTER (WHERE t.time >= $2) *
        COUNT(*)             FILTER (WHERE t.time >= $2)
      )::numeric, 2)                                                       AS impact_excl,
      percentile_agg(t.response_time::double precision) FILTER (WHERE t.time >= $2) AS pct_excl
    FROM transactions t
    JOIN test_runs tr ON tr.test_run_id = t.test_run_id
    WHERE t.test_run_id = $1
    GROUP BY
      t.test_run_id, t.transaction_name, COALESCE(t.scenario_name, ''),
      tr.system_under_test_id, tr.test_environment, tr.workload
  )
  INSERT INTO test_run_transaction_stats (
    test_run_id, transaction_name, scenario_name, ramp_up_excluded,
    system_under_test_id, test_environment, workload,
    total_count, passed_count, failed_count,
    avg_response_time, impact_score, pct_agg
  )
  SELECT
    test_run_id, transaction_name, scenario_name, false,
    system_under_test_id, test_environment, workload,
    total_full, passed_full, failed_full, avg_full, impact_full, pct_full
  FROM base
  UNION ALL
  SELECT
    test_run_id, transaction_name, scenario_name, true,
    system_under_test_id, test_environment, workload,
    total_excl, passed_excl, failed_excl, avg_excl, impact_excl, pct_excl
  FROM base
  WHERE total_excl > 0
  ON CONFLICT (test_run_id, transaction_name, scenario_name, ramp_up_excluded)
  DO UPDATE SET
    system_under_test_id = EXCLUDED.system_under_test_id,
    test_environment     = EXCLUDED.test_environment,
    workload             = EXCLUDED.workload,
    total_count          = EXCLUDED.total_count,
    passed_count         = EXCLUDED.passed_count,
    failed_count         = EXCLUDED.failed_count,
    avg_response_time    = EXCLUDED.avg_response_time,
    impact_score         = EXCLUDED.impact_score,
    pct_agg              = EXCLUDED.pct_agg,
    computed_at          = now()
`;

/**
 * Sampler-level rollup: same pattern against `requests_raw`. The
 * `ARRAY_AGG(url_hash ORDER BY time DESC)[1]` trick is done twice — once for
 * the full window and once for the excluded window — because the "latest"
 * url_hash for a sampler can differ when a test saw URL changes near the
 * ramp-up boundary.
 */
const SAMPLER_ROLLUP_SQL = `
  WITH base AS (
    SELECT
      r.test_run_id,
      r.transaction_name,
      r.sampler_name,
      COALESCE(r.scenario_name, '')                                             AS scenario_name,
      r.system_under_test,
      r.test_environment,
      (ARRAY_AGG(r.url_hash ORDER BY r.time DESC)
        FILTER (WHERE r.url_hash IS NOT NULL))[1]                               AS url_hash_full,
      (ARRAY_AGG(r.url_hash ORDER BY r.time DESC)
        FILTER (WHERE r.url_hash IS NOT NULL AND r.time >= $2))[1]              AS url_hash_excl,
      COUNT(*)                                                                  AS total_full,
      SUM(CASE WHEN r.success THEN 1 ELSE 0 END)                                AS passed_full,
      SUM(CASE WHEN NOT r.success THEN 1 ELSE 0 END)                            AS failed_full,
      ROUND(AVG(r.response_time)::numeric, 2)                                   AS avg_full,
      MIN(r.response_time)                                                      AS min_full,
      MAX(r.response_time)                                                      AS max_full,
      ROUND(AVG(r.response_latency)::numeric, 2)                                AS lat_full,
      ROUND(AVG(r.response_connect_time)::numeric, 2)                           AS conn_full,
      SUM(r.request_size)                                                       AS req_size_full,
      SUM(r.response_size)                                                      AS resp_size_full,
      percentile_agg(r.response_time::double precision)                         AS pct_full,
      COUNT(*) FILTER (WHERE r.time >= $2)                                      AS total_excl,
      SUM(CASE WHEN r.success THEN 1 ELSE 0 END)
        FILTER (WHERE r.time >= $2)                                             AS passed_excl,
      SUM(CASE WHEN NOT r.success THEN 1 ELSE 0 END)
        FILTER (WHERE r.time >= $2)                                             AS failed_excl,
      ROUND((AVG(r.response_time) FILTER (WHERE r.time >= $2))::numeric, 2)     AS avg_excl,
      MIN(r.response_time) FILTER (WHERE r.time >= $2)                          AS min_excl,
      MAX(r.response_time) FILTER (WHERE r.time >= $2)                          AS max_excl,
      ROUND((AVG(r.response_latency) FILTER (WHERE r.time >= $2))::numeric, 2)  AS lat_excl,
      ROUND((AVG(r.response_connect_time) FILTER (WHERE r.time >= $2))::numeric, 2) AS conn_excl,
      SUM(r.request_size)  FILTER (WHERE r.time >= $2)                          AS req_size_excl,
      SUM(r.response_size) FILTER (WHERE r.time >= $2)                          AS resp_size_excl,
      percentile_agg(r.response_time::double precision) FILTER (WHERE r.time >= $2) AS pct_excl
    FROM requests_raw r
    WHERE r.test_run_id = $1
      AND r.transaction_name IS NOT NULL
    GROUP BY
      r.test_run_id, r.transaction_name, r.sampler_name,
      COALESCE(r.scenario_name, ''), r.system_under_test, r.test_environment
  )
  INSERT INTO test_run_sampler_stats (
    test_run_id, transaction_name, sampler_name, scenario_name, ramp_up_excluded,
    url_hash, system_under_test, test_environment,
    total_count, passed_count, failed_count,
    avg_response_time, min_response_time, max_response_time,
    avg_latency, avg_connect_time,
    total_request_size, total_response_size, pct_agg
  )
  SELECT
    test_run_id, transaction_name, sampler_name, scenario_name, false,
    url_hash_full, system_under_test, test_environment,
    total_full, passed_full, failed_full,
    avg_full, min_full, max_full,
    lat_full, conn_full,
    req_size_full, resp_size_full, pct_full
  FROM base
  UNION ALL
  SELECT
    test_run_id, transaction_name, sampler_name, scenario_name, true,
    url_hash_excl, system_under_test, test_environment,
    total_excl, passed_excl, failed_excl,
    avg_excl, min_excl, max_excl,
    lat_excl, conn_excl,
    req_size_excl, resp_size_excl, pct_excl
  FROM base
  WHERE total_excl > 0
  ON CONFLICT (test_run_id, transaction_name, sampler_name, scenario_name, ramp_up_excluded)
  DO UPDATE SET
    url_hash             = EXCLUDED.url_hash,
    system_under_test    = EXCLUDED.system_under_test,
    test_environment     = EXCLUDED.test_environment,
    total_count          = EXCLUDED.total_count,
    passed_count         = EXCLUDED.passed_count,
    failed_count         = EXCLUDED.failed_count,
    avg_response_time    = EXCLUDED.avg_response_time,
    min_response_time    = EXCLUDED.min_response_time,
    max_response_time    = EXCLUDED.max_response_time,
    avg_latency          = EXCLUDED.avg_latency,
    avg_connect_time     = EXCLUDED.avg_connect_time,
    total_request_size   = EXCLUDED.total_request_size,
    total_response_size  = EXCLUDED.total_response_size,
    pct_agg              = EXCLUDED.pct_agg,
    computed_at          = now()
`;
