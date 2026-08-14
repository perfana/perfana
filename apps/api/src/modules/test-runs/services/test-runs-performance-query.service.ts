import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import { TestRun as TestRunEntity } from '../../../entities';
import { DatabaseException } from '../../../common/exceptions/business.exception';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { JobProgressService } from '../../data-science/services/job-progress.service';
import { RollupPendingResult } from './test-runs-performance-query.types';
import {
  TransactionStats,
  SamplerStats,
  ErrorStats,
  VirtualUserStats,
  ThroughputStats,
} from '../types/test-run.types';

interface SummaryTimeseriesBucket {
  timeSeconds: number;
  throughput: number;
  avgResponseTime: number;
  errorsPerSecond: number;
}

export interface SummaryTimeseriesResponse {
  duration: number;
  bucketSizeSeconds: number;
  buckets: SummaryTimeseriesBucket[];
}

/**
 * Boundary-safe Apdex score SQL fragment. Apdex = satisfied + 0.5·tolerating
 * (see worker `ApdexCalculator`), approximated from a t-digest as
 * `rank(T) + (rank(4T) - rank(T)) / 2`.
 *
 * `approx_percentile_rank(v, digest)` returns `NaN` when `v` is exactly the
 * digest's max centroid, which poisons the whole expression to `NaN`
 * (issue #416). `T == max` is common because thresholds are often auto-derived
 * near the observed max. `NULLIF(rank, 'NaN')` + `COALESCE(_, 1.0)` maps that
 * boundary to 1.0 (every sample ≤ v ⇒ all satisfied), matching the raw counts.
 *
 * `thresholdExpr` and `aggExpr` are SQL fragments built from trusted column
 * references, not user input.
 */
export function apdexScoreSql(thresholdExpr: string, aggExpr: string): string {
  const rank = (v: string) =>
    `LEAST(1.0, COALESCE(NULLIF(approx_percentile_rank(${v}, ${aggExpr}), 'NaN'), 1.0))`;
  const t = rank(`(${thresholdExpr})::double precision`);
  const t4 = rank(`((${thresholdExpr}) * 4)::double precision`);
  return `${t}\n              + (${t4}\n                 - ${t}) / 2`;
}

/**
 * Service responsible for performance analysis queries
 * Handles: transaction stats, sampler stats, error analysis, virtual users, throughput
 */
@Injectable()
export class TestRunsPerformanceQueryService {
  private readonly logger = new Logger(TestRunsPerformanceQueryService.name);

  /**
   * Maximum sinceMinutes accepted on the live-aggregation paths (over raw
   * `transactions` / `requests_raw`). On 10M-row tests, an unbounded window
   * scans the whole hypertable and pins a connection — clamping caps the
   * worst case. The rollup-pending gate covers the `null` case for completed
   * runs; live-path null pass-through is handled separately (see callers).
   */
  private static readonly LIVE_WINDOW_MAX_MINUTES = 60;

  /**
   * Per-statement timeout applied to the live-aggregation paths via
   * `SET LOCAL statement_timeout`. Postgres aborts the query if it exceeds
   * the budget — the connection is released cleanly rather than held
   * indefinitely.
   */
  private static readonly LIVE_QUERY_STATEMENT_TIMEOUT_MS = 10_000;

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly mapper: TestRunsMapperService,
    private readonly jobProgressService: JobProgressService,
  ) {}

  /**
   * Resolve UUID or test_run_id to the actual test_run_id string
   * Supports both UUID (e.g., "e8f37dc1-9d9c-4e25-837d-14aa69ac4b17")
   * and test_run_id string (e.g., "PerfanaWebshop-acc-loadTest-00012")
   */
  private async resolveTestRunId(testRunIdOrUuid: string): Promise<string> {
    // Check if it's a UUID (contains dashes in UUID format)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(testRunIdOrUuid);

    if (isUuid) {
      // Look up test_run_id by UUID
      const query = `SELECT test_run_id FROM test_runs WHERE id = $1`;
      const result = await withRequestEm(this.testRunRepo).query(query, [testRunIdOrUuid]);
      if (!result || result.length === 0) {
        throw new DatabaseException(`Test run not found with UUID: ${testRunIdOrUuid}`);
      }
      return result[0].test_run_id;
    }

    // Already a test_run_id string
    return testRunIdOrUuid;
  }

  /**
   * Get analysis bounds (start cutoff from ramp_up, end cutoff from ramp_down) for a test run.
   * When excludeRampUp is false both values are null.
   * For running tests (end_time IS NULL) the end cutoff is not applied — only completed tests
   * have a tail to trim.
   */
  private async getAnalysisBounds(
    testRunId: string,
    excludeRampUp: boolean,
  ): Promise<{ startCutoff: Date | null; endCutoff: Date | null }> {
    if (!excludeRampUp) return { startCutoff: null, endCutoff: null };

    const query = `SELECT start_time, ramp_up, end_time, ramp_down FROM test_runs WHERE test_run_id = $1`;
    const result = await withRequestEm(this.testRunRepo).query(query, [testRunId]);

    let startCutoff: Date | null = null;
    let endCutoff: Date | null = null;

    if (result[0]?.start_time && result[0]?.ramp_up) {
      const startTime = new Date(result[0].start_time);
      const rampUpSeconds = this.mapper.parseInt(result[0].ramp_up);
      if (rampUpSeconds > 0) startCutoff = new Date(startTime.getTime() + rampUpSeconds * 1000);
    }

    if (result[0]?.end_time && result[0]?.ramp_down) {
      const endTime = new Date(result[0].end_time);
      const rampDownSeconds = this.mapper.parseInt(result[0].ramp_down);
      if (rampDownSeconds > 0) endCutoff = new Date(endTime.getTime() - rampDownSeconds * 1000);
    }

    return { startCutoff, endCutoff };
  }

  /**
   * Determine whether the rollup-backed Apdex fast path can be served, or
   * whether the post-test analyze-test job is still running, or whether
   * we're in the soft-failure case (no rollup, no active job).
   *
   * - 'ready'           → rollup rows exist; callers should use the fast path.
   * - 'rollup-pending'  → rollup empty AND an active analyze-test job is
   *                       running for the run's scope (sut/env/workload).
   * - 'unavailable'     → rollup empty AND no active job (soft-failure).
   *
   * **Status alone does NOT determine the HTTP outcome.** Callers also probe
   * the live-Apdex CAGGs via `loadCaggApdexScope` before deciding whether to
   * return 202 vs. 200. The decision tree at the call site is:
   *
   *   ready                       → return rollup-table result (200)
   *   rollup-pending + CAGG ready → return CAGG result (200, live numbers)
   *   rollup-pending + CAGG empty → return rollup-pending (controller maps to 202)
   *   unavailable    + CAGG ready → return CAGG result (200)
   *   unavailable    + CAGG empty → fall through to raw-scan with safety net
   *
   * The CAGG arms were added by migration `1779100000000` and the live-Apdex
   * fast path in `getTransactionStatsFromCagg` / `getTransactionSamplesFromCagg`.
   * Before that change, `'rollup-pending'` always resolved to 202 (PR #302).
   *
   * Note: between the rollup-existence check and the active-job lookup the
   * rollup pipeline could complete, returning 'rollup-pending' for a run that
   * is now 'ready'. Benign — the next client poll resolves it.
   *
   * Org-scope guarantee: the scope lookup joins `systems_under_test` and (for
   * non-admins) filters on `sut.organization_id`, so a caller without
   * membership in the run's org collapses to `'unavailable'` (live-agg
   * fallback also org-filters → `[]`) rather than leaking that the run exists
   * or what analyze-stage it is in via the `rollup-pending` payload.
   *
   * @internal
   */
  private async getRollupStatus(
    testRunId: string,
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<{ status: 'ready' } | RollupPendingResult | { status: 'unavailable' }> {
    const rollupRows = await withRequestEm(this.testRunRepo).query(
      `SELECT 1 FROM test_run_transaction_stats WHERE test_run_id = $1 LIMIT 1`,
      [testRunId],
    );
    if (rollupRows.length > 0) return { status: 'ready' };

    // Scope lookup with org-scoping. Non-admin callers without membership in
    // the run's org receive zero rows → 'unavailable' → live-agg fallback
    // (which also org-filters) → []. This prevents the 'rollup-pending'
    // response from leaking analyze-stage progress for runs the caller can't
    // see.
    const orgFilterClause = !isAdmin
      ? 'AND sut.organization_id = ANY($2::uuid[])'
      : '';
    const scopeParams: unknown[] = !isAdmin ? [testRunId, organizationIds] : [testRunId];
    const scopeRows: Array<{
      system_under_test_id: string;
      test_environment: string;
      workload: string;
    }> = await withRequestEm(this.testRunRepo).query(
      `SELECT tr.system_under_test_id, tr.test_environment, tr.workload
         FROM test_runs tr
         JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        WHERE tr.test_run_id = $1
          ${orgFilterClause}
        LIMIT 1`,
      scopeParams,
    );
    const scope = scopeRows[0];
    if (!scope) return { status: 'unavailable' };

    const activeJob = await this.jobProgressService.getActiveJobForScope(
      scope.system_under_test_id,
      scope.test_environment,
      scope.workload,
    );
    if (!activeJob) return { status: 'unavailable' };

    return {
      status: 'rollup-pending',
      stage: 'transaction-stats-rollup',
      progress: {
        stageName: activeJob.stageName,
        stageIndex: activeJob.stageIndex,
        totalStages: activeJob.totalStages,
      },
    };
  }

  /**
   * Clamp sinceMinutes to a server-side maximum. Prevents accidentally huge
   * windows from triggering unbounded raw-data scans during a running test
   * (the live path can't be served from the rollup until analyze-test runs
   * post-completion). Pass-through for null/undefined.
   */
  private clampSinceMinutes(sinceMinutes: number | undefined): number | undefined {
    if (sinceMinutes == null) return sinceMinutes;
    return Math.min(sinceMinutes, TestRunsPerformanceQueryService.LIVE_WINDOW_MAX_MINUTES);
  }

  /**
   * Run a query with a per-statement timeout. Postgres aborts the query if it
   * exceeds the budget (the connection is released, not held). Used for the
   * live-aggregation paths over raw transactions / requests_raw.
   */
  private async withStatementTimeout<T>(
    fn: (em: import('typeorm').EntityManager) => Promise<T>,
  ): Promise<T> {
    return withRequestEm(this.testRunRepo).manager.transaction(async (txEm) => {
      await txEm.query(
        `SET LOCAL statement_timeout = '${TestRunsPerformanceQueryService.LIVE_QUERY_STATEMENT_TIMEOUT_MS}ms'`,
      );
      return fn(txEm);
    });
  }

  /**
   * Check whether pre-computed sampler stats exist for a (test_run, transaction)
   * pair. When false, the live-aggregation path over requests_raw runs instead.
   */
  private async hasSamplerRollup(testRunId: string, transactionName: string): Promise<boolean> {
    const result = await withRequestEm(this.testRunRepo).query(
      `SELECT 1 FROM test_run_sampler_stats
       WHERE test_run_id = $1 AND transaction_name = $2 LIMIT 1`,
      [testRunId, transactionName],
    );
    return result.length > 0;
  }

  /**
   * Check whether ANY pre-computed sampler stats exist for a test run.
   * Used by the errors overview to pick the rollup-based sampler_stats CTE
   * when transactionName may be omitted (errors view aggregates by sampler_name
   * across all transactions). #287.
   */
  private async hasAnySamplerRollup(testRunId: string): Promise<boolean> {
    const result = await withRequestEm(this.testRunRepo).query(
      `SELECT 1 FROM test_run_sampler_stats WHERE test_run_id = $1 LIMIT 1`,
      [testRunId],
    );
    return result.length > 0;
  }

  /**
   * Fast-path transaction stats read: pull pre-computed tdigest + counts from
   * test_run_transaction_stats, then join current thresholds and compute
   * Apdex / p95 / p99 at read time. Threshold edits take effect immediately;
   * no rollup recompute needed.
   *
   * See: issues #150, #151.
   */
  private async getTransactionStatsFromRollup(
    resolvedTestRunId: string,
    excludeRampUp: boolean,
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<TransactionStats[]> {
    const orgFilterClause = !isAdmin
      ? `AND sut.organization_id = ANY($3::uuid[])`
      : '';

    const query = `
      WITH agg AS (
        SELECT
          trs.transaction_name,
          NULLIF(trs.scenario_name, '')              AS scenario_name,
          trs.system_under_test_id,
          trs.test_environment,
          trs.workload,
          trs.total_count,
          trs.passed_count,
          trs.failed_count,
          trs.avg_response_time,
          trs.pct_agg,
          trs.impact_score
        FROM test_run_transaction_stats trs
        JOIN test_runs tr ON tr.test_run_id = trs.test_run_id
        JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        WHERE trs.test_run_id = $1
          AND trs.ramp_up_excluded = $2
          AND trs.total_count > 0
          ${orgFilterClause}
      ),
      thresholds AS (
        SELECT
          a.transaction_name,
          a.scenario_name,
          COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
        FROM agg a
        LEFT JOIN workload_apdex_thresholds wat
          ON  wat.system_under_test_id = a.system_under_test_id
          AND wat.test_environment     = a.test_environment
          AND wat.workload             = a.workload
        LEFT JOIN workload_transaction_apdex_thresholds wtat
          ON  wtat.system_under_test_id = a.system_under_test_id
          AND wtat.test_environment     = a.test_environment
          AND wtat.workload             = a.workload
          AND wtat.transaction_name     = a.transaction_name
      ),
      scored AS (
        SELECT
          a.transaction_name,
          a.scenario_name,
          a.total_count,
          a.passed_count,
          a.failed_count,
          a.avg_response_time,
          ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95_response_time,
          ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99_response_time,
          a.impact_score,
          th.active_threshold,
          ROUND(
            (
              ${apdexScoreSql('th.active_threshold', 'a.pct_agg')}
            )::numeric,
            3
          ) AS apdex_score
        FROM agg a
        JOIN thresholds th
          ON  th.transaction_name = a.transaction_name
          AND th.scenario_name IS NOT DISTINCT FROM a.scenario_name
      )
      SELECT
        transaction_name,
        scenario_name,
        total_count,
        passed_count,
        failed_count,
        avg_response_time,
        p95_response_time,
        p99_response_time,
        impact_score,
        active_threshold,
        apdex_score,
        RANK() OVER (ORDER BY impact_score DESC) AS ranking
      FROM scored
      ORDER BY transaction_name ASC
    `;

    const params: unknown[] = !isAdmin
      ? [resolvedTestRunId, excludeRampUp, organizationIds]
      : [resolvedTestRunId, excludeRampUp];

    const result = await withRequestEm(this.testRunRepo).query(query, params);

    this.logger.log(
      `Retrieved ${result.length} transaction stats (rollup) for test run: ${resolvedTestRunId} (excludeRampUp: ${excludeRampUp})`,
    );

    return result.map((row: Record<string, unknown>) => ({
      transaction_name: row.transaction_name as string,
      scenario_name: (row.scenario_name as string) || undefined,
      avg_response_time: this.mapper.parseFloat(row.avg_response_time),
      p95_response_time: this.mapper.parseFloat(row.p95_response_time),
      p99_response_time: this.mapper.parseFloat(row.p99_response_time),
      passed_count: this.mapper.parseInt(row.passed_count),
      failed_count: this.mapper.parseInt(row.failed_count),
      total_count: this.mapper.parseInt(row.total_count),
      ranking: this.mapper.parseFloat(row.ranking),
      apdex_score: this.mapper.parseFloat(row.apdex_score),
      active_threshold: this.mapper.parseInt(row.active_threshold, 500),
    }));
  }

  /**
   * CAGG-backed live aggregation for transaction stats. Reads from
   * `transactions_5s` (counts + all-rows percentile sketch) joined with
   * `transactions_passed_5s` (success-filtered percentile sketch added in
   * migration 1779100000000) instead of scanning raw `transactions`.
   *
   * Apdex correctness: uses `rollup(pct_agg_passed)` for the
   * `approx_percentile_rank` inputs — same shape as the rollup-table fast
   * path post-#298. p95/p99 still come from `rollup(pct_agg)` (all rows),
   * matching the rollup behaviour: percentile reporting includes failures
   * because slow failures are still slow.
   *
   * Threshold lookup: workload is read once from `test_runs` in the
   * scope-loader (`loadCaggApdexScope`) and passed through here as
   * `scope.workload`. CAGGs are not workload-keyed (one row in scope =
   * one workload per test_run), so the workload-level / per-transaction
   * threshold tables are joined post-aggregation against the small
   * per-transaction result. The threshold tables are keyed by
   * `system_under_test_id` (UUID), which we read once from `test_runs`
   * in the scope-loader and pass through as `scope.systemUnderTestId`
   * — a UUID match (cross-org safe) rather than a name match (which is
   * not unique across orgs).
   *
   * Precision tradeoff vs. the rollup table: the rollup table sketches
   * are over the exact ramp-up cutoff (per-row `t.time >= cutoff`); the
   * CAGG path filters on 5 s bucket boundaries
   * (`c.bucket >= time_bucket('5s', cutoff)`), so up to one 5 s bucket of
   * ramp-up data may be included or excluded. Negligible for full-test
   * Apdex; documented for transparency.
   *
   * Wrapped in `withStatementTimeout` for consistency with the raw-scan
   * fallback. CAGG reads are typically <500 ms even for 10M-row runs, but
   * the wrap is cheap insurance and matches the project pattern.
   */
  private async getTransactionStatsFromCagg(
    scope: {
      sut: string;
      systemUnderTestId: string;
      env: string;
      workload: string | null;
      startTime: Date;
      endTime: Date;
      cutoffTime: Date | null;
    },
    excludeRampUp: boolean,
  ): Promise<TransactionStats[]> {
    const params: unknown[] = [
      scope.sut, scope.env,                                          // $1, $2
      scope.startTime, scope.endTime,                                // $3, $4
      excludeRampUp, scope.cutoffTime,                               // $5, $6
      scope.workload,                                                // $7 (for threshold join)
      scope.systemUnderTestId,                                       // $8 (FK for threshold join — cross-org safe)
    ];

    const query = `
      WITH agg AS (
        SELECT
          c.transaction_name,
          c.scenario_name,
          SUM(c.n)::bigint                                          AS total_count,
          SUM(c.n_ok)::bigint                                       AS passed_count,
          SUM(c.n_err)::bigint                                      AS failed_count,
          ROUND((SUM(c.avg_rt * c.n) / NULLIF(SUM(c.n),0))::numeric, 2)  AS avg_response_time,
          rollup(c.pct_agg)                                         AS pct_agg_all,
          rollup(p.pct_agg_passed)                                  AS pct_agg_passed,
          ROUND((SUM(c.avg_rt * c.n))::numeric, 2)                  AS impact_score
        FROM transactions_5s c
        JOIN transactions_passed_5s p
          ON  c.bucket            = p.bucket
          AND c.system_under_test = p.system_under_test
          AND c.test_environment  = p.test_environment
          AND c.scenario_name IS NOT DISTINCT FROM p.scenario_name
          AND c.transaction_name  = p.transaction_name
        WHERE c.system_under_test = $1
          AND c.test_environment  = $2
          AND c.bucket >= $3::timestamptz
          AND c.bucket <  $4::timestamptz + interval '5 seconds'
          AND ($5::boolean = false OR $6::timestamptz IS NULL
               OR c.bucket >= time_bucket('5 seconds'::interval, $6::timestamptz))
        GROUP BY c.transaction_name, c.scenario_name
      ),
      threshold_per_tx AS (
        SELECT
          a.transaction_name,
          a.scenario_name,
          COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
        FROM agg a
        LEFT JOIN workload_apdex_thresholds wat
          ON  wat.system_under_test_id = $8::uuid
          AND wat.test_environment     = $2
          AND wat.workload             = $7
        LEFT JOIN workload_transaction_apdex_thresholds wtat
          ON  wtat.system_under_test_id = $8::uuid
          AND wtat.test_environment     = $2
          AND wtat.workload             = $7
          AND wtat.transaction_name     = a.transaction_name
      ),
      scored AS (
        SELECT
          a.transaction_name, a.scenario_name,
          a.total_count, a.passed_count, a.failed_count,
          a.avg_response_time,
          ROUND(approx_percentile(0.95, a.pct_agg_all)::numeric, 2) AS p95_response_time,
          ROUND(approx_percentile(0.99, a.pct_agg_all)::numeric, 2) AS p99_response_time,
          a.impact_score, t.active_threshold,
          ROUND(
            (
              ${apdexScoreSql('t.active_threshold', 'a.pct_agg_passed')}
            )::numeric, 3
          ) AS apdex_score
        FROM agg a
        JOIN threshold_per_tx t
          ON  t.transaction_name = a.transaction_name
          AND t.scenario_name IS NOT DISTINCT FROM a.scenario_name
      )
      SELECT
        transaction_name, scenario_name,
        total_count, passed_count, failed_count,
        avg_response_time, p95_response_time, p99_response_time,
        impact_score, active_threshold, apdex_score,
        RANK() OVER (ORDER BY impact_score DESC) AS ranking
      FROM scored
      ORDER BY transaction_name ASC
    `;

    const result = await this.withStatementTimeout(async (em) => {
      await em.query(`SET LOCAL work_mem = '256MB'`);
      return em.query(query, params);
    });

    this.logger.log(
      `Retrieved ${result.length} transaction stats (CAGG) for sut=${scope.sut} env=${scope.env}`,
    );

    return result.map((row: Record<string, unknown>) => ({
      transaction_name: row.transaction_name as string,
      scenario_name: (row.scenario_name as string) || undefined,
      avg_response_time: this.mapper.parseFloat(row.avg_response_time),
      p95_response_time: this.mapper.parseFloat(row.p95_response_time),
      p99_response_time: this.mapper.parseFloat(row.p99_response_time),
      passed_count: this.mapper.parseInt(row.passed_count),
      failed_count: this.mapper.parseInt(row.failed_count),
      total_count: this.mapper.parseInt(row.total_count),
      ranking: this.mapper.parseFloat(row.ranking),
      apdex_score: this.mapper.parseFloat(row.apdex_score),
      active_threshold: this.mapper.parseInt(row.active_threshold, 500),
    }));
  }

  /**
   * Fast-path sampler stats read: pulls pre-computed tdigest + counts from
   * test_run_sampler_stats filtered by `ramp_up_excluded`, joins current
   * threshold + url_patterns, and computes Apdex / p95 / p99 at read time.
   *
   * Replaces the 140s live query for `stream_download_segment` (#151).
   */
  private async getTransactionSamplesFromRollup(
    resolvedTestRunId: string,
    transactionName: string,
    excludeRampUp: boolean,
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<SamplerStats[]> {
    const orgFilterClause = !isAdmin
      ? `AND sut.organization_id = ANY($4::uuid[])`
      : '';

    const query = `
      WITH threshold_config AS (
        SELECT COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
        FROM test_runs tr
        JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        LEFT JOIN workload_apdex_thresholds wat
          ON  wat.system_under_test_id = sut.id
          AND wat.test_environment     = tr.test_environment
          AND wat.workload             = tr.workload
        LEFT JOIN workload_transaction_apdex_thresholds wtat
          ON  wtat.system_under_test_id = sut.id
          AND wtat.test_environment     = tr.test_environment
          AND wtat.workload             = tr.workload
          AND wtat.transaction_name     = $2
        WHERE tr.test_run_id = $1
          ${orgFilterClause}
        LIMIT 1
      ),
      agg AS (
        SELECT
          trss.sampler_name,
          NULLIF(trss.scenario_name, '')  AS scenario_name,
          trss.system_under_test,
          trss.test_environment,
          trss.url_hash,
          trss.avg_response_time,
          trss.min_response_time,
          trss.max_response_time,
          trss.pct_agg,
          trss.passed_count,
          trss.failed_count,
          trss.total_count,
          trss.avg_latency,
          trss.avg_connect_time,
          trss.total_request_size,
          trss.total_response_size
        FROM test_run_sampler_stats trss
        WHERE trss.test_run_id = $1
          AND trss.transaction_name = $2
          AND trss.ramp_up_excluded = $3
          AND trss.total_count > 0
      )
      SELECT
        a.sampler_name,
        a.scenario_name,
        a.url_hash,
        LOWER(up.normalized_url) AS url_pattern,
        a.avg_response_time,
        a.min_response_time,
        a.max_response_time,
        ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95_response_time,
        ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99_response_time,
        a.passed_count,
        a.failed_count,
        a.total_count,
        a.avg_latency,
        a.avg_connect_time,
        a.total_request_size,
        a.total_response_size,
        tc.active_threshold,
        ROUND(
          (
            ${apdexScoreSql('tc.active_threshold', 'a.pct_agg')}
          )::numeric,
          3
        ) AS apdex_score
      FROM agg a
      CROSS JOIN threshold_config tc
      LEFT JOIN url_patterns up
        ON  a.url_hash         = up.url_hash
        AND a.system_under_test = up.system_under_test
        AND a.test_environment  = up.test_environment
      ORDER BY a.total_count DESC
    `;

    const params: unknown[] = !isAdmin
      ? [resolvedTestRunId, transactionName, excludeRampUp, organizationIds]
      : [resolvedTestRunId, transactionName, excludeRampUp];

    const result = await withRequestEm(this.testRunRepo).query(query, params);

    this.logger.log(
      `Retrieved ${result.length} aggregated samplers (rollup) for transaction: ${transactionName} (excludeRampUp: ${excludeRampUp})`,
    );

    return result.map((row: Record<string, unknown>) => ({
      sampler_name: row.sampler_name as string,
      scenario_name: (row.scenario_name as string) || undefined,
      avg_response_time: this.mapper.parseFloat(row.avg_response_time),
      min_response_time: this.mapper.parseInt(row.min_response_time),
      max_response_time: this.mapper.parseInt(row.max_response_time),
      p95_response_time: this.mapper.parseFloat(row.p95_response_time),
      p99_response_time: this.mapper.parseFloat(row.p99_response_time),
      passed_count: this.mapper.parseInt(row.passed_count),
      failed_count: this.mapper.parseInt(row.failed_count),
      total_count: this.mapper.parseInt(row.total_count),
      avg_latency: this.mapper.parseFloat(row.avg_latency),
      avg_connect_time: this.mapper.parseFloat(row.avg_connect_time),
      total_request_size: this.mapper.parseInt(row.total_request_size),
      total_response_size: this.mapper.parseInt(row.total_response_size),
      apdex_score: this.mapper.parseFloat(row.apdex_score),
      active_threshold: this.mapper.parseInt(row.active_threshold, 500),
      url_hash: (row.url_hash as string) || null,
      url_pattern: (row.url_pattern as string) || null,
    }));
  }

  /**
   * CAGG-backed sampler stats — the live-Apdex companion to
   * `getTransactionSamplesFromRollup`. Reads from `requests_raw_5s` JOINed
   * with `requests_raw_passed_5s` (added in migration 1779100000000) instead
   * of scanning the raw `requests_raw` hypertable. For a 10M-row run this
   * drops wall time from 60s+ to <500ms, with the same Apdex correctness
   * guarantee as the rollup-table fast path.
   *
   * Apdex correctness (post-#298): the success-filtered sketch
   * (`pct_agg_passed`) lives in the new sibling CAGG and is JOINed on the
   * full bucket key tuple — `(bucket, system_under_test, test_environment,
   * scenario_name, sampler_name, transaction_name, location)` — with two
   * `IS NOT DISTINCT FROM` matchers for the nullable columns
   * (`scenario_name`, `location`). Apdex feeds `pct_agg_passed` to
   * `approx_percentile_rank`; p95/p99 still come from `rollup(c.pct_agg)`
   * (all rows) so percentiles include failures (slow failures are still
   * slow). Same shape as `getTransactionStatsFromCagg`'s join.
   *
   * Threshold lookup uses `system_under_test_id` (UUID, FK from
   * `test_runs`) — cross-org safe — rather than `systems_under_test.name`
   * (which is not unique across orgs). The UUID is loaded once by
   * `loadCaggApdexScope` and passed through here as `scope.systemUnderTestId`.
   *
   * Documented limitation (resolved as accept + document, #303): `url_hash`
   * and `url_pattern` come back as `null`. The CAGGs don't carry per-row
   * `url_hash` — adding it as a GROUP BY column would either inflate
   * cardinality (sampler × transaction × url_hash) or require a per-request
   * side-lookup against `requests_raw`, which would defeat the CAGG fast
   * path's <500ms target. The rollup pipeline itself uses the same shape
   * (no url_hash in GROUP BY; it materializes "last-seen url_hash per
   * sampler" via `(ARRAY_AGG ORDER BY time DESC)[1]` post-test). The UI
   * falls back to `sampler_name` (`Top10ListsUrls`) and conditionally
   * renders the URL chip in detail / errors views, so the live-window
   * regression is bounded: the URL pattern reappears once the test ends
   * and the rollup runs. `Top10ListsUrls` shows an info hint when any
   * sampler in the response has a null `url_pattern`.
   *
   * Wrapped in `withStatementTimeout` for consistency with the raw-scan
   * fallback. CAGG reads are typically <500ms even for 10M-row runs, but
   * the wrap is cheap insurance and matches the project pattern.
   */
  private async getTransactionSamplesFromCagg(
    scope: {
      sut: string;
      systemUnderTestId: string;
      env: string;
      workload: string | null;
      startTime: Date;
      endTime: Date;
      cutoffTime: Date | null;
    },
    transactionName: string,
    excludeRampUp: boolean,
  ): Promise<SamplerStats[]> {
    // $1=sut, $2=env, $3=startTime, $4=endTime, $5=excludeRampUp,
    // $6=cutoffTime, $7=workload, $8=transactionName, $9=systemUnderTestId
    const params: unknown[] = [
      scope.sut, scope.env, scope.startTime, scope.endTime,
      excludeRampUp, scope.cutoffTime, scope.workload,
      transactionName, scope.systemUnderTestId,
    ];

    const query = `
      WITH threshold_config AS (
        SELECT COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
        FROM (SELECT $9::uuid AS sut_id) ids
        LEFT JOIN workload_apdex_thresholds wat
          ON  wat.system_under_test_id = ids.sut_id
          AND wat.test_environment     = $2
          AND wat.workload             = $7
        LEFT JOIN workload_transaction_apdex_thresholds wtat
          ON  wtat.system_under_test_id = ids.sut_id
          AND wtat.test_environment     = $2
          AND wtat.workload             = $7
          AND wtat.transaction_name     = $8
        LIMIT 1
      ),
      agg AS (
        SELECT
          c.sampler_name,
          c.scenario_name,
          SUM(c.n)::bigint                                          AS total_count,
          SUM(c.n_ok)::bigint                                       AS passed_count,
          SUM(c.n_err)::bigint                                      AS failed_count,
          ROUND((SUM(c.avg_rt * c.n) / NULLIF(SUM(c.n),0))::numeric, 2) AS avg_response_time,
          MIN(c.min_rt)                                             AS min_response_time,
          MAX(c.max_rt)                                             AS max_response_time,
          rollup(c.pct_agg)                                         AS pct_agg_all,
          rollup(p.pct_agg_passed)                                  AS pct_agg_passed,
          ROUND((SUM(c.avg_latency * c.n) / NULLIF(SUM(c.n),0))::numeric, 2) AS avg_latency,
          ROUND((SUM(c.avg_connect * c.n) / NULLIF(SUM(c.n),0))::numeric, 2) AS avg_connect_time,
          SUM(c.bytes_out)::bigint                                  AS total_request_size,
          SUM(c.bytes_in)::bigint                                   AS total_response_size
        FROM requests_raw_5s c
        JOIN requests_raw_passed_5s p
          ON  c.bucket            = p.bucket
          AND c.system_under_test = p.system_under_test
          AND c.test_environment  = p.test_environment
          AND c.scenario_name IS NOT DISTINCT FROM p.scenario_name
          AND c.sampler_name      = p.sampler_name
          AND c.transaction_name  = p.transaction_name
          AND c.location IS NOT DISTINCT FROM p.location
        WHERE c.system_under_test = $1
          AND c.test_environment  = $2
          AND c.transaction_name  = $8
          AND c.bucket >= $3::timestamptz
          AND c.bucket <  $4::timestamptz + interval '5 seconds'
          AND ($5::boolean = false OR $6::timestamptz IS NULL
               OR c.bucket >= time_bucket('5 seconds'::interval, $6::timestamptz))
        GROUP BY c.sampler_name, c.scenario_name
      )
      SELECT
        a.sampler_name, a.scenario_name,
        NULL::text       AS url_hash,
        NULL::text       AS url_pattern,
        a.avg_response_time, a.min_response_time, a.max_response_time,
        ROUND(approx_percentile(0.95, a.pct_agg_all)::numeric, 2) AS p95_response_time,
        ROUND(approx_percentile(0.99, a.pct_agg_all)::numeric, 2) AS p99_response_time,
        a.passed_count, a.failed_count, a.total_count,
        a.avg_latency, a.avg_connect_time,
        a.total_request_size, a.total_response_size,
        tc.active_threshold,
        ROUND(
          (
            ${apdexScoreSql('tc.active_threshold', 'a.pct_agg_passed')}
          )::numeric, 3
        ) AS apdex_score
      FROM agg a CROSS JOIN threshold_config tc
      ORDER BY a.total_count DESC
    `;

    const result = await this.withStatementTimeout(async (em) => {
      await em.query(`SET LOCAL work_mem = '256MB'`);
      return em.query(query, params);
    });

    this.logger.log(
      `Retrieved ${result.length} aggregated samplers (CAGG) for transaction: ${transactionName} sut=${scope.sut} env=${scope.env}`,
    );

    return result.map((row: Record<string, unknown>) => ({
      sampler_name: row.sampler_name as string,
      scenario_name: (row.scenario_name as string) || undefined,
      avg_response_time: this.mapper.parseFloat(row.avg_response_time),
      min_response_time: this.mapper.parseInt(row.min_response_time),
      max_response_time: this.mapper.parseInt(row.max_response_time),
      p95_response_time: this.mapper.parseFloat(row.p95_response_time),
      p99_response_time: this.mapper.parseFloat(row.p99_response_time),
      passed_count: this.mapper.parseInt(row.passed_count),
      failed_count: this.mapper.parseInt(row.failed_count),
      total_count: this.mapper.parseInt(row.total_count),
      avg_latency: this.mapper.parseFloat(row.avg_latency),
      avg_connect_time: this.mapper.parseFloat(row.avg_connect_time),
      total_request_size: this.mapper.parseInt(row.total_request_size),
      total_response_size: this.mapper.parseInt(row.total_response_size),
      apdex_score: this.mapper.parseFloat(row.apdex_score),
      active_threshold: this.mapper.parseInt(row.active_threshold, 500),
      url_hash: null,
      url_pattern: null,
    }));
  }

  /**
   * Get transaction performance statistics for a test run.
   *
   * Percentiles (p95/p99) and Apdex are computed via TimescaleDB toolkit's
   * `percentile_agg` (uddsketch) + `approx_percentile` / `approx_percentile_rank`.
   * Expected error vs exact `PERCENTILE_CONT`: <1% at p95/p99 for the response-time
   * distribution shapes Perfana sees. The tradeoff buys us a single-pass O(n)
   * aggregation instead of an O(n log n) full sort that spilled to disk on large runs.
   *
   * @param testRunId - Test run ID (UUID or test_run_id string)
   * @param excludeRampUp - Whether to exclude ramp-up period from statistics
   * @param isAdmin - Whether the caller bypasses organization filtering (resolved at the facade)
   * @param organizationIds - User's accessible organization IDs (ignored when isAdmin)
   */
  async getTransactionStats(
    testRunId: string,
    excludeRampUp: boolean = false,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
    sinceMinutes?: number,
  ): Promise<TransactionStats[] | RollupPendingResult> {
    try {
      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && organizationIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty transaction stats');
        return [];
      }

      this.logger.log(`Getting transaction stats for test run: ${testRunId} (excludeRampUp: ${excludeRampUp}${sinceMinutes != null ? `, sinceMinutes: ${sinceMinutes}` : ''})${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      // Resolve UUID to test_run_id if necessary
      const resolvedTestRunId = await this.resolveTestRunId(testRunId);
      this.logger.debug(`Resolved test run ID: ${testRunId} -> ${resolvedTestRunId}`);

      // Server-side safety net: clamp the live-window so a huge `sinceMinutes`
      // can't accidentally scan the whole hypertable. Null passes through
      // (the rollup-pending gate covers that case for completed runs).
      const clampedSinceMinutes = this.clampSinceMinutes(sinceMinutes);

      // Fast path: if the rollup stage has written rows for this test run
      // (completed runs only) AND sinceMinutes is not set (the rollup is
      // whole-test-run only), read from the rollup table. Dashboard latency
      // drops from seconds-to-minutes to <100ms.
      // See: issues #150, #151.
      //
      // Three-arm gate (rollup-pending plan), with CAGG fast path inserted:
      //   ready           → fast-path read from rollup
      //   rollup-pending  → defer 202 until we've also probed the CAGG; if
      //                     CAGG has data we serve a live 200 instead.
      //   unavailable     → try CAGG; else fall through to live aggregation
      let pendingRollup: RollupPendingResult | null = null;
      if (clampedSinceMinutes == null) {
        const rollupStatus = await this.getRollupStatus(resolvedTestRunId, isAdmin, organizationIds);
        if (rollupStatus.status === 'ready') {
          return await this.getTransactionStatsFromRollup(
            resolvedTestRunId,
            excludeRampUp,
            isAdmin,
            organizationIds,
          );
        }
        if (rollupStatus.status === 'rollup-pending') {
          // Hold the pending result; CAGG may serve a live 200 below. If the
          // CAGG is empty too we'll return this and the controller maps it
          // to HTTP 202 (preserves the pending-gate plan's cold-start
          // behaviour).
          pendingRollup = rollupStatus;
        }
        // status === 'unavailable' → try CAGG below, else fall through to
        // live aggregation
      }

      // CAGG fast path: live-Apdex path that avoids the raw transactions
      // hypertable scan by reading from transactions_5s + transactions_passed_5s.
      // Used when:
      //   (a) clampedSinceMinutes == null AND rollup is 'rollup-pending' or
      //       'unavailable' AND the CAGG has data for this run's window —
      //       preferred over both 202 (better UX: live numbers) and raw scan
      //       (faster + more correct Apdex since pct_agg_passed is
      //       success-filtered post-#298 / migration 1779100000000)
      //   (b) clampedSinceMinutes != null — live windows during a running
      //       test (the pre-CAGG raw scan was clamped to 60 min +
      //       statement_timeout 10s; CAGG reads typically <500 ms even for
      //       10M-row runs)
      //
      // Note (rollup-pending plan interaction): when the rollup status was
      // 'rollup-pending' and we now serve from CAGG, we override the 202.
      const caggScope = await this.loadCaggApdexScope(
        resolvedTestRunId,
        excludeRampUp,
        isAdmin,
        organizationIds,
      );
      if (caggScope?.hasTransactionsCagg) {
        // For live windows, narrow the scope's startTime to NOW() - sinceMinutes
        // (or keep scope.startTime if it's later than the live cutoff).
        // Apply endCutoffTime (ramp_down) as the upper bound for completed runs;
        // for in-flight runs endCutoffTime is null so endTime (NOW()) is used as-is.
        const effectiveEndTime = caggScope.endCutoffTime ?? caggScope.endTime;
        const adjustedScope = clampedSinceMinutes != null
          ? {
              ...caggScope,
              endTime: effectiveEndTime,
              startTime: new Date(Math.max(
                caggScope.startTime.getTime(),
                Date.now() - clampedSinceMinutes * 60_000,
              )),
            }
          : { ...caggScope, endTime: effectiveEndTime };
        return await this.getTransactionStatsFromCagg(adjustedScope, excludeRampUp);
      }
      // No CAGG: if rollup was 'rollup-pending', return that pending result
      // (controller maps it to 202). Otherwise fall through to the raw-scan
      // safety net below.
      if (pendingRollup) {
        this.logger.debug(
          `Rollup pending for ${resolvedTestRunId} and CAGG empty; returning rollup-pending result`,
        );
        return pendingRollup;
      }

      const { startCutoff: cutoffTime, endCutoff } = await this.getAnalysisBounds(resolvedTestRunId, excludeRampUp);

      // Param layout (1-indexed):
      //   $1 = resolvedTestRunId
      //   $2 = excludeRampUp
      //   $3 = cutoffTime (start cutoff)
      //   $4 = endCutoff  (end cutoff)
      //   $5 = sinceMinutes  (only when provided)
      //   $5 or $6 = organizationIds (non-admin only; index shifts when sinceMinutes present)
      const windowParamIndex = 5;
      const orgParamIndex = clampedSinceMinutes != null ? 6 : 5;

      const windowFilter = clampedSinceMinutes != null
        ? `AND t.time >= NOW() - ($${windowParamIndex}::numeric * interval '1 minute')`
        : '';

      const orgFilterClause = !isAdmin
        ? `AND sut.organization_id = ANY($${orgParamIndex}::uuid[])`
        : '';

      // Aggregate transactions FIRST, then join threshold tables against the
      // post-group result (tens of rows) instead of the ungrouped row stream.
      // p95/p99 come from a single percentile_agg tdigest per group; Apdex uses
      // approx_percentile_rank on the same sketch — one pass, no full sort.
      const query = `
        WITH agg AS (
          SELECT
            t.transaction_name,
            t.scenario_name,
            tr.system_under_test_id,
            tr.test_environment,
            tr.workload,
            COUNT(*)                                              AS total_count,
            COUNT(*) FILTER (WHERE t.success)                     AS passed_count,
            COUNT(*) FILTER (WHERE NOT t.success)                 AS failed_count,
            ROUND(AVG(t.response_time)::numeric, 2)               AS avg_response_time,
            percentile_agg(t.response_time::double precision)     AS pct_agg,
            ROUND((AVG(t.response_time) * COUNT(*))::numeric, 2)  AS impact_score
          FROM transactions t
          JOIN test_runs tr ON tr.test_run_id = t.test_run_id
          JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          WHERE t.test_run_id = $1
            AND ($2::boolean = false OR $3::timestamptz IS NULL OR t.time >= $3::timestamptz)
            AND ($2::boolean = false OR $4::timestamptz IS NULL OR t.time <= $4::timestamptz)
            ${windowFilter}
            ${orgFilterClause}
          GROUP BY t.transaction_name, t.scenario_name, tr.system_under_test_id, tr.test_environment, tr.workload
        ),
        thresholds AS (
          SELECT
            a.transaction_name,
            a.scenario_name,
            COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
          FROM agg a
          LEFT JOIN workload_apdex_thresholds wat
            ON  wat.system_under_test_id = a.system_under_test_id
            AND wat.test_environment     = a.test_environment
            AND wat.workload             = a.workload
          LEFT JOIN workload_transaction_apdex_thresholds wtat
            ON  wtat.system_under_test_id = a.system_under_test_id
            AND wtat.test_environment     = a.test_environment
            AND wtat.workload             = a.workload
            AND wtat.transaction_name     = a.transaction_name
        ),
        scored AS (
          SELECT
            a.transaction_name,
            a.scenario_name,
            a.total_count,
            a.passed_count,
            a.failed_count,
            a.avg_response_time,
            ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95_response_time,
            ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99_response_time,
            a.impact_score,
            th.active_threshold,
            ROUND(
              (
                ${apdexScoreSql('th.active_threshold', 'a.pct_agg')}
              )::numeric,
              3
            ) AS apdex_score
          FROM agg a
          JOIN thresholds th
            ON  th.transaction_name = a.transaction_name
            AND th.scenario_name IS NOT DISTINCT FROM a.scenario_name
        )
        SELECT
          transaction_name,
          scenario_name,
          total_count,
          passed_count,
          failed_count,
          avg_response_time,
          p95_response_time,
          p99_response_time,
          impact_score,
          active_threshold,
          apdex_score,
          RANK() OVER (ORDER BY impact_score DESC) AS ranking
        FROM scored
        ORDER BY transaction_name ASC
      `;

      // Param layout: $1=testRunId, $2=excludeRampUp, $3=cutoffTime, $4=endCutoff,
      //   $5=sinceMinutes (when provided), $6=orgIds (non-admin)
      //   OR $5=orgIds (non-admin, no window)
      let queryParams: unknown[];
      if (clampedSinceMinutes != null) {
        queryParams = !isAdmin
          ? [resolvedTestRunId, excludeRampUp, cutoffTime, endCutoff, clampedSinceMinutes, organizationIds]
          : [resolvedTestRunId, excludeRampUp, cutoffTime, endCutoff, clampedSinceMinutes];
      } else {
        queryParams = !isAdmin
          ? [resolvedTestRunId, excludeRampUp, cutoffTime, endCutoff, organizationIds]
          : [resolvedTestRunId, excludeRampUp, cutoffTime, endCutoff];
      }
      // Wrap in a transaction so SET LOCAL applies only to this query
      // (reverts at COMMIT — global default unaffected). Manager comes from
      // the request-scoped EM via withRequestEm so this nested transaction
      // (savepoint when RLS is on) inherits the outer request transaction's GUCs.
      // statement_timeout caps a runaway query so the connection is released
      // cleanly rather than pinned indefinitely.
      const result = await this.withStatementTimeout(async (em) => {
        await em.query(`SET LOCAL work_mem = '512MB'`);
        return em.query(query, queryParams);
      });

      this.logger.log(`Retrieved ${result.length} transaction stats for test run: ${resolvedTestRunId}`);

      return result.map((row: Record<string, unknown>) => ({
        transaction_name: row.transaction_name as string,
        scenario_name: (row.scenario_name as string) || undefined,
        avg_response_time: this.mapper.parseFloat(row.avg_response_time),
        p95_response_time: this.mapper.parseFloat(row.p95_response_time),
        p99_response_time: this.mapper.parseFloat(row.p99_response_time),
        passed_count: this.mapper.parseInt(row.passed_count),
        failed_count: this.mapper.parseInt(row.failed_count),
        total_count: this.mapper.parseInt(row.total_count),
        ranking: this.mapper.parseFloat(row.ranking),
        apdex_score: this.mapper.parseFloat(row.apdex_score),
        active_threshold: this.mapper.parseInt(row.active_threshold, 500),
      }));
    } catch (error) {
      this.logger.error(`Failed to get transaction stats for test run ${testRunId}:`, error);
      throw new DatabaseException('Failed to retrieve transaction statistics', error);
    }
  }

  /**
   * Get sampler statistics for a specific transaction.
   *
   * Same precision tradeoff as `getTransactionStats`: percentiles and Apdex use
   * the TimescaleDB toolkit tdigest sketch (<1% expected error at p95/p99).
   *
   * @param testRunId - Test run ID (UUID or test_run_id string)
   * @param transactionName - Transaction name to get samples for
   * @param excludeRampUp - Whether to exclude ramp-up period from statistics
   * @param isAdmin - Whether the caller bypasses organization filtering (resolved at the facade)
   * @param organizationIds - User's accessible organization IDs (ignored when isAdmin)
   */
  async getTransactionSamples(
    testRunId: string,
    transactionName: string,
    excludeRampUp: boolean = false,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
    sinceMinutes?: number,
  ): Promise<SamplerStats[] | RollupPendingResult> {
    const samples = await this.getTransactionSamplesInternal(
      testRunId,
      transactionName,
      excludeRampUp,
      isAdmin,
      organizationIds,
      sinceMinutes,
    );
    // Decorate here rather than in each fetch path (rollup / CAGG / raw fallback), so all of
    // them report parallel groups identically.
    if (Array.isArray(samples) && samples.length > 0) {
      await this.attachParallelGroups(testRunId, transactionName, samples);
    }
    return samples;
  }

  /**
   * Labels each sampler with the Parallel Controller it ran under.
   *
   * The sampler rollup is keyed by (test_run_id, transaction_name, sampler_name, scenario_name,
   * ramp_up_excluded) and does not carry the group, so this is a separate lookup against
   * requests_raw rather than a change to the rollup or its populating job.
   *
   * Every failure mode degrades to "no groups", which renders exactly as before this existed:
   * a database without the column (rolling deploy ahead of the migration), a run recorded by a
   * load test tool that does not report the tag, or a query error.
   */
  private async attachParallelGroups(
    testRunId: string,
    transactionName: string,
    samples: SamplerStats[],
  ): Promise<void> {
    try {
      const resolvedTestRunId = await this.resolveTestRunId(testRunId);
      const rows = await withRequestEm(this.testRunRepo).query(
        `SELECT DISTINCT sampler_name, parallel_group
           FROM requests_raw
          WHERE test_run_id = $1
            AND transaction_name = $2
            AND parallel_group IS NOT NULL
            AND parallel_group <> ''`,
        [resolvedTestRunId, transactionName],
      );
      if (!rows || rows.length === 0) {
        return;
      }
      const groupBySampler = new Map<string, string>();
      for (const row of rows as Array<Record<string, unknown>>) {
        const sampler = row.sampler_name as string;
        const group = row.parallel_group as string;
        // A sampler that appears in more than one group across iterations has no single
        // answer; leave it unlabelled rather than picking one arbitrarily.
        if (groupBySampler.has(sampler) && groupBySampler.get(sampler) !== group) {
          groupBySampler.set(sampler, '');
        } else {
          groupBySampler.set(sampler, group);
        }
      }
      for (const sample of samples) {
        sample.parallel_group = groupBySampler.get(sample.sampler_name) || null;
      }
    } catch (error) {
      this.logger.warn(
        `Could not resolve parallel groups for transaction ${transactionName}: ${
          error instanceof Error ? error.message : String(error)
        }. Rendering without them.`,
      );
    }
  }

  private async getTransactionSamplesInternal(
    testRunId: string,
    transactionName: string,
    excludeRampUp: boolean = false,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
    sinceMinutes?: number,
  ): Promise<SamplerStats[] | RollupPendingResult> {
    try {
      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && organizationIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty sampler stats');
        return [];
      }

      this.logger.log(`Getting aggregated sampler stats for transaction: ${transactionName} in test run: ${testRunId}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      const resolvedTestRunId = await this.resolveTestRunId(testRunId);

      // Server-side safety net: clamp the live-window so a huge `sinceMinutes`
      // can't accidentally scan the whole hypertable. Null passes through
      // (the rollup-pending gate covers that case for completed runs).
      const clampedSinceMinutes = this.clampSinceMinutes(sinceMinutes);

      // Fast path: rollup (#150, #151). Covers the common case hit by the
      // Overview-tab row expand and the Top 10 Requests tab — exactly the
      // 140s query case captured in #151 for `stream_download_segment`.
      //
      // Gate by upstream `transaction-stats-rollup` job (same as
      // getTransactionStats): a pending job means we should bubble a
      // RollupPendingResult so the controller can map to HTTP 202 instead
      // of stalling on the live-aggregation fallback. The sampler rollup
      // table (test_run_sampler_stats) is populated by the same upstream
      // analyze-test pipeline that backfills test_run_transaction_stats —
      // so getRollupStatus's check against test_run_transaction_stats is
      // the correct upstream gate here too.
      //
      // Three fall-through cases land in the CAGG fast path below:
      //   1. status='ready' BUT hasSamplerRollup(testRunId, txName)=false
      //      (unsampled high-cardinality sampler — sampler rollup didn't
      //      record a row for this exact transaction)
      //   2. status='rollup-pending'  → CAGG present serves a live 200
      //      instead of a 202; CAGG empty falls back to pending (then 202)
      //   3. status='unavailable'     → CAGG present serves a live 200;
      //      CAGG empty falls through to the raw-scan safety net
      let pendingRollup: RollupPendingResult | null = null;
      let needsLivePath = clampedSinceMinutes != null;
      if (clampedSinceMinutes == null) {
        const rollupStatus = await this.getRollupStatus(resolvedTestRunId, isAdmin, organizationIds);
        if (rollupStatus.status === 'ready') {
          // Sampler rollup may still not have a row for this exact transaction
          // (e.g. an unsampled high-cardinality sampler). Fall back to the
          // CAGG fast path / live aggregation in that case rather than
          // serving an empty rollup read.
          const hasSamplerRow = await this.hasSamplerRollup(resolvedTestRunId, transactionName);
          if (hasSamplerRow) {
            return await this.getTransactionSamplesFromRollup(
              resolvedTestRunId,
              transactionName,
              excludeRampUp,
              isAdmin,
              organizationIds,
            );
          }
          // status='ready' but no per-transaction sampler row → fall through
          needsLivePath = true;
        } else if (rollupStatus.status === 'rollup-pending') {
          // Hold the pending result; CAGG may still serve a live 200.
          pendingRollup = rollupStatus;
          needsLivePath = true;
        } else {
          // status === 'unavailable' → try CAGG, else fall through
          needsLivePath = true;
        }
      }

      // CAGG fast path: live-Apdex path that avoids the raw requests_raw
      // hypertable scan by reading from requests_raw_5s + requests_raw_passed_5s.
      // Used when:
      //   (a) clampedSinceMinutes == null AND we landed here via one of the
      //       three fall-through cases above — preferred over both 202
      //       (better UX: live numbers) and raw scan (faster + correct Apdex
      //       since pct_agg_passed is success-filtered post-#298).
      //   (b) clampedSinceMinutes != null — live windows during a running
      //       test (the pre-CAGG raw scan was clamped to 60 min +
      //       statement_timeout 10s; CAGG reads typically <500 ms even for
      //       10M-row runs).
      if (needsLivePath) {
        const caggScope = await this.loadCaggApdexScope(
          resolvedTestRunId,
          excludeRampUp,
          isAdmin,
          organizationIds,
        );
        if (caggScope?.hasRequestsRawCagg) {
          // Apply endCutoffTime (ramp_down) as the upper bound for completed runs;
          // for in-flight runs endCutoffTime is null so endTime (NOW()) is used as-is.
          const effectiveEndTime = caggScope.endCutoffTime ?? caggScope.endTime;
          const adjustedScope = clampedSinceMinutes != null
            ? {
                ...caggScope,
                endTime: effectiveEndTime,
                startTime: new Date(Math.max(
                  caggScope.startTime.getTime(),
                  Date.now() - clampedSinceMinutes * 60_000,
                )),
              }
            : { ...caggScope, endTime: effectiveEndTime };
          return await this.getTransactionSamplesFromCagg(
            adjustedScope,
            transactionName,
            excludeRampUp,
          );
        }
        // No CAGG: if rollup was 'rollup-pending', return the pending result
        // (controller maps it to HTTP 202). Otherwise fall through to the
        // raw-scan safety net below.
        if (pendingRollup) {
          this.logger.debug(
            `Rollup pending for ${resolvedTestRunId} and CAGG empty; returning rollup-pending result for samples`,
          );
          return pendingRollup;
        }
      }

      const { startCutoff: cutoffTime, endCutoff } = await this.getAnalysisBounds(resolvedTestRunId, excludeRampUp);

      // Param layout: $1=testRunId, $2=transactionName, $3=excludeRampUp, $4=cutoffTime, $5=endCutoff,
      //   $6=sinceMinutes (when provided), $6 or $7=orgIds (non-admin)
      const windowParamIndexSamples = 6;
      const orgParamIndexSamples = clampedSinceMinutes != null ? 7 : 6;

      const windowFilterSamples = clampedSinceMinutes != null
        ? `AND r.time >= NOW() - ($${windowParamIndexSamples}::numeric * interval '1 minute')`
        : '';

      const orgFilterClause = !isAdmin
        ? `AND sut.organization_id = ANY($${orgParamIndexSamples}::uuid[])`
        : '';

      // Aggregate requests_raw FIRST per (sampler_name, scenario_name, SUT, env)
      // using a percentile_agg tdigest. p95/p99 come from approx_percentile on
      // the sketch; Apdex uses approx_percentile_rank on the same sketch so the
      // threshold join happens exactly once (threshold_config CTE) and is
      // CROSS JOINed onto the post-group result.
      const query = `
        WITH threshold_config AS (
          SELECT COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
          FROM test_runs tr
          JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN workload_apdex_thresholds wat
            ON  wat.system_under_test_id = sut.id
            AND wat.test_environment     = tr.test_environment
            AND wat.workload             = tr.workload
          LEFT JOIN workload_transaction_apdex_thresholds wtat
            ON  wtat.system_under_test_id = sut.id
            AND wtat.test_environment     = tr.test_environment
            AND wtat.workload             = tr.workload
            AND wtat.transaction_name     = $2
          WHERE tr.test_run_id = $1
            ${orgFilterClause}
          LIMIT 1
        ),
        agg AS (
          SELECT
            r.sampler_name,
            r.scenario_name,
            r.system_under_test,
            r.test_environment,
            (ARRAY_AGG(r.url_hash ORDER BY r.time DESC) FILTER (WHERE r.url_hash IS NOT NULL))[1] AS url_hash,
            AVG(r.response_time)::numeric(10,2)               AS avg_response_time,
            MIN(r.response_time)                              AS min_response_time,
            MAX(r.response_time)                              AS max_response_time,
            percentile_agg(r.response_time::double precision) AS pct_agg,
            SUM(CASE WHEN r.success THEN 1 ELSE 0 END)        AS passed_count,
            SUM(CASE WHEN NOT r.success THEN 1 ELSE 0 END)    AS failed_count,
            COUNT(*)                                          AS total_count,
            AVG(r.response_latency)::numeric(10,2)            AS avg_latency,
            AVG(r.response_connect_time)::numeric(10,2)       AS avg_connect_time,
            SUM(r.request_size)                               AS total_request_size,
            SUM(r.response_size)                              AS total_response_size
          FROM requests_raw r
          WHERE r.test_run_id = $1
            AND r.transaction_name = $2
            AND ($3::boolean = false OR $4::timestamptz IS NULL OR r.time >= $4::timestamptz)
            AND ($3::boolean = false OR $5::timestamptz IS NULL OR r.time <= $5::timestamptz)
            ${windowFilterSamples}
          GROUP BY r.sampler_name, r.scenario_name, r.system_under_test, r.test_environment
        )
        SELECT
          a.sampler_name,
          a.scenario_name,
          a.url_hash,
          LOWER(up.normalized_url) AS url_pattern,
          a.avg_response_time,
          a.min_response_time,
          a.max_response_time,
          ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95_response_time,
          ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99_response_time,
          a.passed_count,
          a.failed_count,
          a.total_count,
          a.avg_latency,
          a.avg_connect_time,
          a.total_request_size,
          a.total_response_size,
          tc.active_threshold,
          ROUND(
            (
              ${apdexScoreSql('tc.active_threshold', 'a.pct_agg')}
            )::numeric,
            3
          ) AS apdex_score
        FROM agg a
        CROSS JOIN threshold_config tc
        LEFT JOIN url_patterns up
          ON  a.url_hash         = up.url_hash
          AND a.system_under_test = up.system_under_test
          AND a.test_environment  = up.test_environment
        ORDER BY a.total_count DESC
      `;

      let queryParams: unknown[];
      if (clampedSinceMinutes != null) {
        queryParams = !isAdmin
          ? [resolvedTestRunId, transactionName, excludeRampUp, cutoffTime, endCutoff, clampedSinceMinutes, organizationIds]
          : [resolvedTestRunId, transactionName, excludeRampUp, cutoffTime, endCutoff, clampedSinceMinutes];
      } else {
        queryParams = !isAdmin
          ? [resolvedTestRunId, transactionName, excludeRampUp, cutoffTime, endCutoff, organizationIds]
          : [resolvedTestRunId, transactionName, excludeRampUp, cutoffTime, endCutoff];
      }
      // Wrap in a transaction so SET LOCAL applies only to this query.
      // Manager comes from the request-scoped EM via withRequestEm so this nested
      // transaction (savepoint when RLS is on) inherits the outer request
      // transaction's GUCs. statement_timeout caps a runaway query so the
      // connection is released cleanly rather than pinned indefinitely.
      const result = await this.withStatementTimeout(async (em) => {
        await em.query(`SET LOCAL work_mem = '512MB'`);
        return em.query(query, queryParams);
      });

      this.logger.log(`Retrieved ${result.length} aggregated samplers for transaction: ${transactionName}`);

      return result.map((row: Record<string, unknown>) => ({
        sampler_name: row.sampler_name as string,
        scenario_name: (row.scenario_name as string) || undefined,
        avg_response_time: this.mapper.parseFloat(row.avg_response_time),
        min_response_time: this.mapper.parseInt(row.min_response_time),
        max_response_time: this.mapper.parseInt(row.max_response_time),
        p95_response_time: this.mapper.parseFloat(row.p95_response_time),
        p99_response_time: this.mapper.parseFloat(row.p99_response_time),
        passed_count: this.mapper.parseInt(row.passed_count),
        failed_count: this.mapper.parseInt(row.failed_count),
        total_count: this.mapper.parseInt(row.total_count),
        avg_latency: this.mapper.parseFloat(row.avg_latency),
        avg_connect_time: this.mapper.parseFloat(row.avg_connect_time),
        total_request_size: this.mapper.parseInt(row.total_request_size),
        total_response_size: this.mapper.parseInt(row.total_response_size),
        apdex_score: this.mapper.parseFloat(row.apdex_score),
        active_threshold: this.mapper.parseInt(row.active_threshold, 500),
        url_hash: (row.url_hash as string) || null,
        url_pattern: (row.url_pattern as string) || null,
      }));
    } catch (error) {
      this.logger.error(`Failed to get aggregated samplers for transaction ${transactionName}:`, error);
      throw new DatabaseException('Failed to retrieve transaction sampler statistics', error);
    }
  }

  /**
   * Get grouped errors for a transaction or sampler
   *
   * @param testRunId - Test run ID (UUID or test_run_id string)
   * @param transactionName - Optional transaction name to filter by
   * @param samplerName - Optional sampler name to filter by
   * @param isAdmin - Whether the caller bypasses organization filtering (resolved at the facade)
   * @param organizationIds - User's accessible organization IDs (ignored when isAdmin)
   */
  async getTransactionErrors(
    testRunId: string,
    transactionName?: string,
    samplerName?: string,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
    excludeRampUp: boolean = true,
  ): Promise<ErrorStats[]> {
    try {
      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && organizationIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty error stats');
        return [];
      }

      this.logger.log(`Getting errors for test run: ${testRunId}, transaction: ${transactionName || 'all'}, sampler: ${samplerName || 'all'} (excludeRampUp: ${excludeRampUp})${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      // Resolve UUID to test_run_id if necessary
      const resolvedTestRunId = await this.resolveTestRunId(testRunId);

      // Three-arm fast-path gate for the `sampler_stats` CTE:
      //   1. Rollup arm (#287): when test_run_sampler_stats has rows for this run,
      //      compute Apdex from rollup(pct_agg) on the pre-aggregated tdigest. ~µs.
      //      Wins for completed runs that have already been backfilled.
      //   2. CAGG arm (#304): for in-flight runs (no rollup yet) — read from
      //      requests_raw_5s + requests_raw_passed_5s and compute Apdex via
      //      rollup(pct_agg_passed). O(buckets) instead of O(rows). Drops Errors
      //      Overview wall time from ~38s to <1s on populated TimescaleDB.
      //   3. Raw arm: legacy scan over requests_raw, kept as a last-resort
      //      fallback when neither the rollup nor the CAGG covers the run.
      const useSamplerRollup = await this.hasAnySamplerRollup(resolvedTestRunId);
      const caggScope = !useSamplerRollup
        ? await this.loadCaggApdexScope(resolvedTestRunId, excludeRampUp, isAdmin, organizationIds)
        : null;
      const useCagg = !useSamplerRollup && caggScope?.hasRequestsRawCagg === true;

      const params: unknown[] = [resolvedTestRunId];
      let paramIndex = 2;

      // Build organization filter clause - parameter index depends on other optional params
      let orgParamIndex = paramIndex;
      if (transactionName) orgParamIndex++;
      if (samplerName) orgParamIndex++;
      if (useSamplerRollup) orgParamIndex++; // ramp_up_excluded param
      if (useCagg) orgParamIndex += 6; // sut, env, startTime, endTime, excludeRampUp, cutoffTime

      const orgFilterClause = !isAdmin
        ? `AND sut.organization_id = ANY($${orgParamIndex}::uuid[])`
        : '';

      let transactionFilter = '';
      if (transactionName) {
        transactionFilter = ` AND re.transaction_name = $${paramIndex}`;
        params.push(transactionName);
        paramIndex++;
      }

      let samplerFilter = '';
      if (samplerName) {
        samplerFilter = ` AND re.sampler_name = $${paramIndex}`;
        params.push(samplerName);
        paramIndex++;
      }

      // ramp_up_excluded param sits between the optional transaction/sampler
      // filters and the org-ids tail (rollup path only).
      let rampUpParamIndex = -1;
      if (useSamplerRollup) {
        rampUpParamIndex = paramIndex;
        params.push(excludeRampUp);
        paramIndex++;
      }

      // CAGG arm params: sut name, env, start/end window, ramp-up flag, cutoff.
      // Slot in between optional filters and the orgIds tail so $orgParamIndex
      // computed above stays correct.
      let caggSutParamIdx = -1;
      let caggEnvParamIdx = -1;
      let caggStartParamIdx = -1;
      let caggEndParamIdx = -1;
      let caggRampUpParamIdx = -1;
      let caggCutoffParamIdx = -1;
      if (useCagg && caggScope) {
        caggSutParamIdx = paramIndex; params.push(caggScope.sut); paramIndex++;
        caggEnvParamIdx = paramIndex; params.push(caggScope.env); paramIndex++;
        caggStartParamIdx = paramIndex; params.push(caggScope.startTime); paramIndex++;
        // Use endCutoffTime (ramp_down trimmed) as the upper bound for completed runs;
        // for in-flight runs endCutoffTime is null so endTime (NOW()) is used as-is.
        caggEndParamIdx = paramIndex; params.push(caggScope.endCutoffTime ?? caggScope.endTime); paramIndex++;
        caggRampUpParamIdx = paramIndex; params.push(excludeRampUp); paramIndex++;
        caggCutoffParamIdx = paramIndex; params.push(caggScope.cutoffTime); paramIndex++;
      }

      // Add organization IDs as the last parameter for non-admin users
      if (!isAdmin) {
        params.push(organizationIds);
      }

      // Build threshold_config CTE — reuses $1 (test_run_id) and optionally $2 (transaction_name).
      // When a transaction filter is present ($2 = transactionName), include the per-transaction
      // threshold join so Apdex in the errors modal reflects the configured threshold, not hardcoded 500ms.
      const thresholdTransactionJoin = transactionName
        ? `LEFT JOIN workload_transaction_apdex_thresholds wtat
            ON  wtat.system_under_test_id = sut.id
            AND wtat.test_environment    = tr.test_environment
            AND wtat.workload            = tr.workload
            AND wtat.transaction_name    = $2`
        : '';
      const thresholdCoalesce = transactionName
        ? 'COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500)'
        : 'COALESCE(wat.apdex_threshold, 500)';

      // sampler_stats CTE — three shapes:
      //   - Rollup path (#287): read pre-aggregated tdigests from
      //     test_run_sampler_stats, grouping by sampler_name with rollup(pct_agg)
      //     to merge sketches across transactions/scenarios. ~µs.
      //   - CAGG path (#304): read requests_raw_5s + requests_raw_passed_5s for
      //     in-flight tests, computing Apdex via rollup(pct_agg_passed). O(buckets).
      //   - Legacy path: scan requests_raw and compute Apdex from raw response_time.
      //     Slow on populated DBs (~38s); kept as a last-resort fallback when
      //     neither rollup nor CAGG covers the run.
      let samplerStatsCte: string;
      if (useSamplerRollup) {
        const transactionFilterRollup = transactionName
          ? ` AND trss.transaction_name = $2`
          : '';
        // samplerName param index depends on whether transactionName was added.
        const samplerParamIdx = transactionName ? 3 : 2;
        const samplerFilterRollup = samplerName
          ? ` AND trss.sampler_name = $${samplerParamIdx}`
          : '';
        samplerStatsCte = `
          sampler_stats AS (
            SELECT
              trss.sampler_name,
              SUM(trss.total_count) AS total_count,
              ROUND(
                (
                  ${apdexScoreSql('tc.active_threshold', 'rollup(trss.pct_agg)')}
                )::numeric,
                3
              ) AS apdex_score
            FROM test_run_sampler_stats trss
            CROSS JOIN threshold_config tc
            WHERE trss.test_run_id = $1
              AND trss.ramp_up_excluded = $${rampUpParamIndex}
              ${transactionFilterRollup}
              ${samplerFilterRollup}
            GROUP BY trss.sampler_name, tc.active_threshold
          )
        `;
      } else if (useCagg) {
        const transactionFilterCagg = transactionName
          ? ` AND c.transaction_name = $2`
          : '';
        const samplerParamIdx = transactionName ? 3 : 2;
        const samplerFilterCagg = samplerName
          ? ` AND c.sampler_name = $${samplerParamIdx}`
          : '';
        samplerStatsCte = `
          sampler_stats AS (
            SELECT
              c.sampler_name,
              SUM(c.n)::bigint AS total_count,
              ROUND(
                (
                  ${apdexScoreSql('tc.active_threshold', 'rollup(p.pct_agg_passed)')}
                )::numeric,
                3
              ) AS apdex_score
            FROM requests_raw_5s c
            JOIN requests_raw_passed_5s p
              ON  c.bucket            = p.bucket
              AND c.system_under_test = p.system_under_test
              AND c.test_environment  = p.test_environment
              AND c.scenario_name IS NOT DISTINCT FROM p.scenario_name
              AND c.sampler_name      = p.sampler_name
              AND c.transaction_name  = p.transaction_name
              AND c.location IS NOT DISTINCT FROM p.location
            CROSS JOIN threshold_config tc
            WHERE c.system_under_test = $${caggSutParamIdx}
              AND c.test_environment  = $${caggEnvParamIdx}
              AND c.bucket >= $${caggStartParamIdx}::timestamptz
              AND c.bucket <  $${caggEndParamIdx}::timestamptz + interval '5 seconds'
              AND ($${caggRampUpParamIdx}::boolean = false
                   OR $${caggCutoffParamIdx}::timestamptz IS NULL
                   OR c.bucket >= time_bucket('5 seconds'::interval, $${caggCutoffParamIdx}::timestamptz))
              ${transactionFilterCagg}
              ${samplerFilterCagg}
            GROUP BY c.sampler_name, tc.active_threshold
          )
        `;
      } else {
        samplerStatsCte = `
          sampler_stats AS (
            SELECT
              rr.sampler_name,
              COUNT(*) as total_count,
              ROUND(
                (
                  SUM(CASE WHEN rr.response_time <= tc.active_threshold THEN 1 ELSE 0 END) +
                  SUM(CASE WHEN rr.response_time > tc.active_threshold AND rr.response_time <= (tc.active_threshold * 4) THEN 0.5 ELSE 0 END)
                ) / NULLIF(COUNT(*), 0),
                3
              ) as apdex_score
            FROM requests_raw rr
            CROSS JOIN threshold_config tc
            LEFT JOIN test_runs tr ON tr.test_run_id = rr.test_run_id
            LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
            LEFT JOIN teams team ON team.id = sut.team_id
            WHERE rr.test_run_id = $1
              ${transactionFilter ? transactionFilter.replace('re.', 'rr.') : ''}
              ${samplerFilter ? samplerFilter.replace('re.', 'rr.') : ''}
              ${orgFilterClause}
            GROUP BY rr.sampler_name
          )
        `;
      }

      const query = `
        WITH threshold_config AS (
          SELECT ${thresholdCoalesce} as active_threshold
          FROM test_runs tr
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN workload_apdex_thresholds wat
            ON  wat.system_under_test_id = sut.id
            AND wat.test_environment    = tr.test_environment
            AND wat.workload            = tr.workload
          ${thresholdTransactionJoin}
          WHERE tr.test_run_id = $1
          LIMIT 1
        ),
        error_groups AS (
          SELECT
            CASE
              WHEN re.response_code IS NOT NULL THEN CONCAT('HTTP ', re.response_code)
              WHEN re.response_message ~ '^(java\\.|org\\.|com\\.)' THEN REGEXP_REPLACE(re.response_message, '^([^:]+).*', '\\1')
              ELSE 'Other Error'
            END as error_type,
            COALESCE(re.response_code, 'N/A') as response_code,
            COALESCE(SUBSTRING(re.response_message, 1, 200), 'No message') as response_message,
            re.sampler_name,
            re.system_under_test,
            re.test_environment,
            (ARRAY_AGG(re.url_hash ORDER BY re.time DESC) FILTER (WHERE re.url_hash IS NOT NULL))[1] as url_hash,
            SPLIT_PART(COALESCE(re.url, 'N/A'), '?', 1) as normalized_url,
            (ARRAY_AGG(re.url ORDER BY re.time DESC))[1] as sample_url,
            COUNT(*) as count,
            MIN(re.time) as first_occurrence,
            MAX(re.time) as last_occurrence,
            (ARRAY_AGG(re.response_data ORDER BY re.time DESC))[1] as sample_response_data
          FROM requests_error re
          LEFT JOIN test_runs tr ON tr.test_run_id = re.test_run_id
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN teams team ON team.id = sut.team_id
          WHERE re.test_run_id = $1
            ${transactionFilter}
            ${samplerFilter}
            ${orgFilterClause}
          GROUP BY error_type, re.response_code, re.response_message, re.sampler_name, re.system_under_test, re.test_environment, normalized_url, re.url_hash
        ),
        ${samplerStatsCte}
        SELECT
          eg.error_type,
          eg.response_code,
          eg.response_message,
          eg.sampler_name,
          LOWER(eg.normalized_url) as url,
          LOWER(eg.sample_url) as sample_url,
          eg.url_hash,
          LOWER(up.normalized_url) as url_pattern,
          eg.count,
          eg.first_occurrence,
          eg.last_occurrence,
          eg.sample_response_data,
          COALESCE(ss.total_count, eg.count) as total_requests,
          COALESCE(ss.apdex_score, 0) as apdex_score
        FROM error_groups eg
        LEFT JOIN sampler_stats ss
          ON eg.sampler_name = ss.sampler_name
        LEFT JOIN url_patterns up
          ON eg.url_hash = up.url_hash
          AND eg.system_under_test = up.system_under_test
          AND eg.test_environment = up.test_environment
        ORDER BY eg.count DESC, eg.last_occurrence DESC
        LIMIT 100
      `;

      const result = await withRequestEm(this.testRunRepo).query(query, params);

      this.logger.log(`Retrieved ${result.length} error groups for test run: ${resolvedTestRunId}`);

      return result.map((row: Record<string, unknown>) => ({
        error_type: row.error_type as string,
        response_code: row.response_code as string,
        response_message: row.response_message as string,
        sampler_name: row.sampler_name as string,
        url: (row.sample_url as string) || (row.url as string),
        url_hash: (row.url_hash as string) || null,
        url_pattern: (row.url_pattern as string) || null,
        count: this.mapper.parseInt(row.count),
        first_occurrence: row.first_occurrence as string,
        last_occurrence: row.last_occurrence as string,
        sample_response_data: (row.sample_response_data as string) || '',
        total_requests: this.mapper.parseInt(row.total_requests),
        apdex_score: this.mapper.parseFloat(row.apdex_score),
      }));
    } catch (error) {
      this.logger.error(`Failed to get errors for test run ${testRunId}:`, error);
      throw new DatabaseException('Failed to retrieve transaction errors', error);
    }
  }

  /**
   * Get virtual user statistics for a test run
   *
   * @param testRunId - Test run ID (UUID or test_run_id string)
   * @param excludeRampUp - Whether to exclude ramp-up period from statistics
   * @param isAdmin - Whether the caller bypasses organization filtering (resolved at the facade)
   * @param organizationIds - User's accessible organization IDs (ignored when isAdmin)
   */
  async getVirtualUserStats(
    testRunId: string,
    excludeRampUp: boolean = false,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
  ): Promise<VirtualUserStats> {
    try {
      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && organizationIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty virtual user stats');
        return {
          overall: {
            peak_active_threads: 0,
            avg_active_threads: 0,
            peak_started_threads: 0,
            avg_started_threads: 0,
            peak_finished_threads: 0,
            avg_finished_threads: 0,
            total_data_points: 0,
          },
          by_scenario: [],
        };
      }

      this.logger.log(`Getting virtual user stats for test run: ${testRunId} (excludeRampUp: ${excludeRampUp})${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      // Resolve UUID to test_run_id if necessary
      const resolvedTestRunId = await this.resolveTestRunId(testRunId);

      const { startCutoff: cutoffTime, endCutoff } = await this.getAnalysisBounds(resolvedTestRunId, excludeRampUp);

      // Build organization filter clause
      // Param layout: $1=testRunId, $2=excludeRampUp, $3=cutoffTime, $4=endCutoff, $5=orgIds (non-admin)
      const orgFilterClause = !isAdmin
        ? 'AND sut.organization_id = ANY($5::uuid[])'
        : '';

      const overallQuery = `
        SELECT
          MAX(vu.active_threads) as peak_active_threads,
          AVG(vu.active_threads)::numeric(10,2) as avg_active_threads,
          MAX(vu.started_threads) as peak_started_threads,
          AVG(vu.started_threads)::numeric(10,2) as avg_started_threads,
          MAX(vu.finished_threads) as peak_finished_threads,
          AVG(vu.finished_threads)::numeric(10,2) as avg_finished_threads,
          COUNT(*) as total_data_points
        FROM virtual_users vu
        LEFT JOIN test_runs tr ON tr.test_run_id = vu.test_run_id
        LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        LEFT JOIN teams team ON team.id = sut.team_id
        WHERE vu.test_run_id = $1
          AND ($2::boolean = false OR $3::timestamptz IS NULL OR vu.time >= $3::timestamptz)
          AND ($2::boolean = false OR $4::timestamptz IS NULL OR vu.time <= $4::timestamptz)
          ${orgFilterClause}
      `;

      const scenarioQuery = `
        SELECT
          vu.scenario_name,
          MAX(vu.active_threads) as peak_active_threads,
          AVG(vu.active_threads)::numeric(10,2) as avg_active_threads,
          MAX(vu.started_threads) as peak_started_threads,
          AVG(vu.started_threads)::numeric(10,2) as avg_started_threads,
          MAX(vu.finished_threads) as peak_finished_threads,
          AVG(vu.finished_threads)::numeric(10,2) as avg_finished_threads,
          COUNT(*) as total_data_points
        FROM virtual_users vu
        LEFT JOIN test_runs tr ON tr.test_run_id = vu.test_run_id
        LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        LEFT JOIN teams team ON team.id = sut.team_id
        WHERE vu.test_run_id = $1
          AND vu.scenario_name IS NOT NULL
          AND ($2::boolean = false OR $3::timestamptz IS NULL OR vu.time >= $3::timestamptz)
          AND ($2::boolean = false OR $4::timestamptz IS NULL OR vu.time <= $4::timestamptz)
          ${orgFilterClause}
        GROUP BY vu.scenario_name
        ORDER BY vu.scenario_name ASC
      `;

      const queryParams = !isAdmin
        ? [resolvedTestRunId, excludeRampUp, cutoffTime, endCutoff, organizationIds]
        : [resolvedTestRunId, excludeRampUp, cutoffTime, endCutoff];

      const [overallResult, scenarioResult] = await Promise.all([
        withRequestEm(this.testRunRepo).query(overallQuery, queryParams),
        withRequestEm(this.testRunRepo).query(scenarioQuery, queryParams),
      ]);

      this.logger.log(`Retrieved virtual user stats: overall + ${scenarioResult.length} scenarios for test run: ${resolvedTestRunId}`);

      const overall = overallResult[0] || {};

      return {
        overall: {
          peak_active_threads: this.mapper.parseInt(overall.peak_active_threads),
          avg_active_threads: this.mapper.parseFloat(overall.avg_active_threads),
          peak_started_threads: this.mapper.parseInt(overall.peak_started_threads),
          avg_started_threads: this.mapper.parseFloat(overall.avg_started_threads),
          peak_finished_threads: this.mapper.parseInt(overall.peak_finished_threads),
          avg_finished_threads: this.mapper.parseFloat(overall.avg_finished_threads),
          total_data_points: this.mapper.parseInt(overall.total_data_points),
        },
        by_scenario: scenarioResult.map((row: Record<string, unknown>) => ({
          scenario_name: row.scenario_name as string,
          peak_active_threads: this.mapper.parseInt(row.peak_active_threads),
          avg_active_threads: this.mapper.parseFloat(row.avg_active_threads),
          peak_started_threads: this.mapper.parseInt(row.peak_started_threads),
          avg_started_threads: this.mapper.parseFloat(row.avg_started_threads),
          peak_finished_threads: this.mapper.parseInt(row.peak_finished_threads),
          avg_finished_threads: this.mapper.parseFloat(row.avg_finished_threads),
          total_data_points: this.mapper.parseInt(row.total_data_points),
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get virtual user stats for test run ${testRunId}:`, error);
      throw new DatabaseException('Failed to retrieve virtual user statistics', error);
    }
  }

  /**
   * Single round-trip lookup that:
   *   - resolves (sut.name, test_environment) needed to read the 5 s CAGGs
   *     (`requests_raw_5s` / `transactions_5s` are keyed by SUT name + env, not test_run_id)
   *   - applies the org filter on `sut.organization_id` (returns null if the user
   *     can't see this run; matches the existing "empty result" semantics)
   *   - computes the ramp-up cutoff inline so we don't need a second round-trip
   *   - probes `transactions_5s` for any rows in this run's window so we can pick
   *     the CAGG fast path vs. the legacy raw-scan fallback (in-flight runs that
   *     pre-date the next CAGG refresh, or stacks where the CAGG never ran).
   *
   * Returns null when the run doesn't exist or the user lacks access — callers
   * map that to the empty-stats response.
   *
   * Issue: #288.
   */
  private async loadThroughputRunInfo(
    resolvedTestRunId: string,
    excludeRampUp: boolean,
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<{
    sut: string;
    env: string;
    startTime: Date;
    endTime: Date;
    cutoffTime: Date | null;
    endCutoffTime: Date | null;
    hasCagg: boolean;
  } | null> {
    const orgFilterClause = !isAdmin ? 'AND sut.organization_id = ANY($2::uuid[])' : '';

    const query = `
      SELECT
        sut.name           AS sut,
        tr.test_environment AS env,
        tr.start_time      AS start_time,
        tr.end_time        AS end_time,
        tr.ramp_up         AS ramp_up,
        tr.ramp_down       AS ramp_down,
        (
          EXISTS (
            SELECT 1
            FROM transactions_5s c
            WHERE c.system_under_test = sut.name
              AND c.test_environment  = tr.test_environment
              AND c.bucket >= tr.start_time
              AND c.bucket <  COALESCE(tr.end_time, NOW()) + interval '5 seconds'
          )
          OR EXISTS (
            SELECT 1
            FROM requests_raw_5s c
            WHERE c.system_under_test = sut.name
              AND c.test_environment  = tr.test_environment
              AND c.bucket >= tr.start_time
              AND c.bucket <  COALESCE(tr.end_time, NOW()) + interval '5 seconds'
          )
        ) AS has_cagg
      FROM test_runs tr
      JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
      WHERE tr.test_run_id = $1
        ${orgFilterClause}
      LIMIT 1
    `;

    const params: unknown[] = !isAdmin
      ? [resolvedTestRunId, organizationIds]
      : [resolvedTestRunId];

    const rows = await withRequestEm(this.testRunRepo).query(query, params);
    if (!rows || rows.length === 0) return null;

    const row = rows[0] as {
      sut: string;
      env: string;
      start_time: string | Date | null;
      end_time: string | Date | null;
      ramp_up: string | number | null;
      ramp_down: string | number | null;
      has_cagg: boolean;
    };

    if (!row.start_time || !row.end_time) return null;

    const startTime = new Date(row.start_time);
    const endTime = new Date(row.end_time);

    let cutoffTime: Date | null = null;
    if (excludeRampUp && row.ramp_up != null) {
      const rampUpSeconds = this.mapper.parseInt(row.ramp_up);
      if (rampUpSeconds > 0) {
        cutoffTime = new Date(startTime.getTime() + rampUpSeconds * 1000);
      }
    }

    let endCutoffTime: Date | null = null;
    if (excludeRampUp && row.ramp_down != null) {
      const rampDownSeconds = this.mapper.parseInt(row.ramp_down);
      if (rampDownSeconds > 0) {
        endCutoffTime = new Date(endTime.getTime() - rampDownSeconds * 1000);
      }
    }

    return {
      sut: row.sut,
      env: row.env,
      startTime,
      endTime,
      cutoffTime,
      endCutoffTime,
      hasCagg: row.has_cagg === true,
    };
  }

  /**
   * Single round-trip scope lookup for the live-Apdex CAGG fast path.
   *
   * Mirrors `loadThroughputRunInfo`, but:
   *   - returns the `workload` string (workload is NOT a CAGG dimension, but
   *     the live Apdex query joins workload-level thresholds against the
   *     post-aggregation result later — and a single test_run has a single
   *     workload, so we resolve it here in the same round-trip)
   *   - probes the new success-filtered CAGGs (`transactions_passed_5s` and
   *     `requests_raw_passed_5s`, added in migration `1779100000000`) rather
   *     than the existing all-rows `_5s` CAGGs. The `_passed_5s` CAGGs are the
   *     authoritative signal for "is the live Apdex CAGG path viable?" — a
   *     non-empty `_5s` CAGG without a matching `_passed_5s` row would yield a
   *     wrong Apdex (we'd treat all hits as passing).
   *   - reports the two probe results separately so the caller can pick the
   *     right CAGG family per request type (transaction vs sampler/request)
   *
   * Returns null when the run doesn't exist or the org filter excludes the
   * caller — matches the empty-result semantics of `loadThroughputRunInfo`.
   *
   * For in-flight runs (`tr.end_time IS NULL`), the upper bucket bound is
   * clamped to `NOW() + 5 seconds` so the EXISTS probes still see freshly
   * refreshed CAGG buckets during a running test.
   */
  private async loadCaggApdexScope(
    resolvedTestRunId: string,
    excludeRampUp: boolean,
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<{
    sut: string;
    systemUnderTestId: string;
    env: string;
    workload: string | null;
    startTime: Date;
    endTime: Date;
    cutoffTime: Date | null;
    endCutoffTime: Date | null;
    hasTransactionsCagg: boolean;
    hasRequestsRawCagg: boolean;
  } | null> {
    const orgFilterClause = !isAdmin ? 'AND sut.organization_id = ANY($2::uuid[])' : '';

    const query = `
      SELECT
        sut.name                AS sut,
        tr.system_under_test_id AS system_under_test_id,
        tr.test_environment     AS env,
        tr.workload             AS workload,
        tr.start_time           AS start_time,
        tr.end_time             AS end_time,
        tr.ramp_up              AS ramp_up,
        tr.ramp_down            AS ramp_down,
        EXISTS (
          SELECT 1 FROM transactions_passed_5s c
          WHERE c.system_under_test = sut.name
            AND c.test_environment  = tr.test_environment
            AND c.bucket >= tr.start_time
            AND c.bucket <  COALESCE(tr.end_time, NOW()) + interval '5 seconds'
        ) AS has_transactions_cagg,
        EXISTS (
          SELECT 1 FROM requests_raw_passed_5s c
          WHERE c.system_under_test = sut.name
            AND c.test_environment  = tr.test_environment
            AND c.bucket >= tr.start_time
            AND c.bucket <  COALESCE(tr.end_time, NOW()) + interval '5 seconds'
        ) AS has_requests_raw_cagg
      FROM test_runs tr
      JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
      WHERE tr.test_run_id = $1
        ${orgFilterClause}
      LIMIT 1
    `;

    const params: unknown[] = !isAdmin
      ? [resolvedTestRunId, organizationIds]
      : [resolvedTestRunId];

    const rows = await withRequestEm(this.testRunRepo).query(query, params);
    if (!rows || rows.length === 0) return null;

    const row = rows[0] as {
      sut: string;
      system_under_test_id: string;
      env: string;
      workload: string | null;
      start_time: string | Date | null;
      end_time: string | Date | null;
      ramp_up: string | number | null;
      ramp_down: string | number | null;
      has_transactions_cagg: boolean;
      has_requests_raw_cagg: boolean;
    };

    if (!row.start_time) return null;

    const startTime = new Date(row.start_time);
    // For an in-flight run, end_time is null; clamp to NOW() so the
    // bucket-window query above works and live windows during a running
    // test go through the same path.
    const endTime = row.end_time ? new Date(row.end_time) : new Date();

    let cutoffTime: Date | null = null;
    if (excludeRampUp && row.ramp_up != null) {
      const rampUpSeconds = this.mapper.parseInt(row.ramp_up);
      if (rampUpSeconds > 0) {
        cutoffTime = new Date(startTime.getTime() + rampUpSeconds * 1000);
      }
    }

    // ramp_down only applies to completed tests (end_time IS NOT NULL).
    // For in-flight runs we clamp endTime to NOW() above but intentionally
    // leave endCutoffTime null — there is no tail to trim on a running test.
    let endCutoffTime: Date | null = null;
    if (excludeRampUp && row.end_time && row.ramp_down != null) {
      const rampDownSeconds = this.mapper.parseInt(row.ramp_down);
      if (rampDownSeconds > 0) {
        endCutoffTime = new Date(endTime.getTime() - rampDownSeconds * 1000);
      }
    }

    return {
      sut: row.sut,
      systemUnderTestId: row.system_under_test_id,
      env: row.env,
      workload: row.workload,
      startTime,
      endTime,
      cutoffTime,
      endCutoffTime,
      hasTransactionsCagg: row.has_transactions_cagg === true,
      hasRequestsRawCagg: row.has_requests_raw_cagg === true,
    };
  }

  /**
   * CAGG-backed throughput. Reads from the 5 s continuous aggregates
   * (`transactions_5s`, `requests_raw_5s`) instead of scanning the raw
   * hypertables. The CAGG already carries `n` (count per 5 s bucket per
   * sampler/transaction/scenario tuple); we SUM(n) per bucket and take MAX.
   *
   * Same shape the UI expects today — `peak_*_per_second = CEIL(MAX(SUM(n))/5)`.
   * The "actual 1-second peak vs. 5-second mean" labelling discrepancy noted
   * in #288 is not addressed here (would be a UI-facing change).
   */
  private async getThroughputStatsFromCagg(
    runInfo: { sut: string; env: string; startTime: Date; endTime: Date; cutoffTime: Date | null; endCutoffTime?: Date | null },
    excludeRampUp: boolean,
  ): Promise<ThroughputStats> {
    // Apply endCutoffTime (ramp_down) as the upper bound for completed runs;
    // for in-flight runs endCutoffTime is null/undefined so endTime (NOW()) is used.
    const effectiveEndTime = runInfo.endCutoffTime ?? runInfo.endTime;
    const params: unknown[] = [
      runInfo.sut,
      runInfo.env,
      runInfo.startTime,
      effectiveEndTime,
      excludeRampUp,
      runInfo.cutoffTime,
    ];

    const transactionsQuery = `
      WITH per_bucket AS (
        SELECT c.bucket, SUM(c.n)::bigint AS total
        FROM transactions_5s c
        WHERE c.system_under_test = $1
          AND c.test_environment  = $2
          AND c.bucket >= $3::timestamptz
          AND c.bucket <  $4::timestamptz + interval '5 seconds'
          AND ($5::boolean = false OR $6::timestamptz IS NULL
               OR c.bucket >= time_bucket('5 seconds'::interval, $6::timestamptz))
        GROUP BY c.bucket
      )
      SELECT CEIL(COALESCE(MAX(total), 0)::numeric / 5) AS peak_transactions_per_second
      FROM per_bucket
    `;

    const requestsQuery = `
      WITH per_bucket AS (
        SELECT c.bucket, SUM(c.n)::bigint AS total
        FROM requests_raw_5s c
        WHERE c.system_under_test = $1
          AND c.test_environment  = $2
          AND c.bucket >= $3::timestamptz
          AND c.bucket <  $4::timestamptz + interval '5 seconds'
          AND ($5::boolean = false OR $6::timestamptz IS NULL
               OR c.bucket >= time_bucket('5 seconds'::interval, $6::timestamptz))
        GROUP BY c.bucket
      )
      SELECT CEIL(COALESCE(MAX(total), 0)::numeric / 5) AS peak_requests_per_second
      FROM per_bucket
    `;

    // Per-scenario: SUM(n) per (scenario, bucket) → MAX per scenario → CEIL(/5)
    // CAGG rows whose source scenario_name was NULL come through as NULL here too;
    // we exclude them to match the legacy raw-scan WHERE scenario_name IS NOT NULL.
    const scenarioQuery = `
      WITH tx_per AS (
        SELECT c.scenario_name, c.bucket, SUM(c.n)::bigint AS total
        FROM transactions_5s c
        WHERE c.system_under_test = $1
          AND c.test_environment  = $2
          AND c.bucket >= $3::timestamptz
          AND c.bucket <  $4::timestamptz + interval '5 seconds'
          AND ($5::boolean = false OR $6::timestamptz IS NULL
               OR c.bucket >= time_bucket('5 seconds'::interval, $6::timestamptz))
          AND c.scenario_name IS NOT NULL
        GROUP BY c.scenario_name, c.bucket
      ),
      req_per AS (
        SELECT c.scenario_name, c.bucket, SUM(c.n)::bigint AS total
        FROM requests_raw_5s c
        WHERE c.system_under_test = $1
          AND c.test_environment  = $2
          AND c.bucket >= $3::timestamptz
          AND c.bucket <  $4::timestamptz + interval '5 seconds'
          AND ($5::boolean = false OR $6::timestamptz IS NULL
               OR c.bucket >= time_bucket('5 seconds'::interval, $6::timestamptz))
          AND c.scenario_name IS NOT NULL
        GROUP BY c.scenario_name, c.bucket
      ),
      tx_peaks AS (
        SELECT scenario_name, CEIL(MAX(total)::numeric / 5) AS peak_transactions_per_second
        FROM tx_per GROUP BY scenario_name
      ),
      req_peaks AS (
        SELECT scenario_name, CEIL(MAX(total)::numeric / 5) AS peak_requests_per_second
        FROM req_per GROUP BY scenario_name
      )
      SELECT
        COALESCE(t.scenario_name, r.scenario_name) AS scenario_name,
        COALESCE(t.peak_transactions_per_second, 0) AS peak_transactions_per_second,
        COALESCE(r.peak_requests_per_second, 0)     AS peak_requests_per_second
      FROM tx_peaks t
      FULL OUTER JOIN req_peaks r ON t.scenario_name = r.scenario_name
      ORDER BY scenario_name ASC
    `;

    const [transactionsResult, requestsResult, scenarioResult] = await Promise.all([
      withRequestEm(this.testRunRepo).query(transactionsQuery, params),
      withRequestEm(this.testRunRepo).query(requestsQuery, params),
      withRequestEm(this.testRunRepo).query(scenarioQuery, params),
    ]);

    const transactions = transactionsResult[0] || { peak_transactions_per_second: 0 };
    const requests = requestsResult[0] || { peak_requests_per_second: 0 };

    return {
      overall: {
        peak_transactions_per_second: this.mapper.parseInt(transactions.peak_transactions_per_second),
        peak_requests_per_second: this.mapper.parseInt(requests.peak_requests_per_second),
      },
      by_scenario: scenarioResult.map((row: Record<string, unknown>) => ({
        scenario_name: row.scenario_name as string,
        peak_transactions_per_second: this.mapper.parseInt(row.peak_transactions_per_second),
        peak_requests_per_second: this.mapper.parseInt(row.peak_requests_per_second),
      })),
    };
  }

  /**
   * Get peak throughput per second for transactions and requests
   *
   * @param testRunId - Test run ID (UUID or test_run_id string)
   * @param excludeRampUp - Whether to exclude ramp-up period from statistics
   * @param isAdmin - Whether the caller bypasses organization filtering (resolved at the facade)
   * @param organizationIds - User's accessible organization IDs (ignored when isAdmin)
   */
  async getThroughputStats(
    testRunId: string,
    excludeRampUp: boolean = false,
    isAdmin: boolean = false,
    organizationIds: string[] = [],
  ): Promise<ThroughputStats> {
    try {
      // Non-admin users with no organization memberships see empty results
      if (!isAdmin && organizationIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty throughput stats');
        return {
          overall: {
            peak_transactions_per_second: 0,
            peak_requests_per_second: 0,
          },
          by_scenario: [],
        };
      }

      this.logger.log(`Getting throughput stats for test run: ${testRunId} (excludeRampUp: ${excludeRampUp})${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      // Resolve UUID to test_run_id if necessary
      const resolvedTestRunId = await this.resolveTestRunId(testRunId);

      // Single round-trip: org-scoped run window + CAGG existence flag + ramp-up cutoff
      const runInfo = await this.loadThroughputRunInfo(
        resolvedTestRunId,
        excludeRampUp,
        isAdmin,
        organizationIds,
      );

      if (!runInfo) {
        // Either the run doesn't exist or the org filter excluded it.
        return {
          overall: { peak_transactions_per_second: 0, peak_requests_per_second: 0 },
          by_scenario: [],
        };
      }

      // Fast path: CAGG has data for this run's window. ~38 s → microseconds. #288.
      if (runInfo.hasCagg) {
        return await this.getThroughputStatsFromCagg(runInfo, excludeRampUp);
      }

      // Fallback: in-flight run that pre-dates the next CAGG refresh (≤30 s lag),
      // or a stack where the CAGG policy hasn't run yet. Falls back to the legacy
      // raw-scan path so we don't return zeros for a populated test run.
      const cutoffTime = runInfo.cutoffTime;
      const endCutoffTime = runInfo.endCutoffTime;

      // Build organization filter clause
      // Param layout: $1=testRunId, $2=excludeRampUp, $3=cutoffTime, $4=endCutoffTime,
      //   $5=orgIds (non-admin)
      const orgFilterClause = !isAdmin
        ? 'AND sut.organization_id = ANY($5::uuid[])'
        : '';

      const transactionsQuery = `
        WITH five_second_buckets AS (
          SELECT
            floor(extract(epoch from t.time) / 5) * 5 as time_bucket,
            COUNT(*) as total_count
          FROM transactions t
          LEFT JOIN test_runs tr ON tr.test_run_id = t.test_run_id
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN teams team ON team.id = sut.team_id
          WHERE t.test_run_id = $1
            AND ($2::boolean = false OR $3::timestamptz IS NULL OR t.time >= $3::timestamptz)
            AND ($2::boolean = false OR $4::timestamptz IS NULL OR t.time <= $4::timestamptz)
            ${orgFilterClause}
          GROUP BY floor(extract(epoch from t.time) / 5)
        )
        SELECT CEIL(MAX(total_count)::numeric / 5) as peak_transactions_per_second
        FROM five_second_buckets
      `;

      const requestsQuery = `
        WITH five_second_buckets AS (
          SELECT
            floor(extract(epoch from rr.time) / 5) * 5 as time_bucket,
            COUNT(*) as total_count
          FROM requests_raw rr
          LEFT JOIN test_runs tr ON tr.test_run_id = rr.test_run_id
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN teams team ON team.id = sut.team_id
          WHERE rr.test_run_id = $1
            AND ($2::boolean = false OR $3::timestamptz IS NULL OR rr.time >= $3::timestamptz)
            AND ($2::boolean = false OR $4::timestamptz IS NULL OR rr.time <= $4::timestamptz)
            ${orgFilterClause}
          GROUP BY floor(extract(epoch from rr.time) / 5)
        )
        SELECT CEIL(MAX(total_count)::numeric / 5) as peak_requests_per_second
        FROM five_second_buckets
      `;

      const scenarioQuery = `
        WITH transaction_buckets AS (
          SELECT
            t.scenario_name,
            floor(extract(epoch from t.time) / 5) as time_bucket,
            COUNT(*) as total_count
          FROM transactions t
          LEFT JOIN test_runs tr ON tr.test_run_id = t.test_run_id
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN teams team ON team.id = sut.team_id
          WHERE t.test_run_id = $1
            AND t.scenario_name IS NOT NULL
            AND ($2::boolean = false OR $3::timestamptz IS NULL OR t.time >= $3::timestamptz)
            AND ($2::boolean = false OR $4::timestamptz IS NULL OR t.time <= $4::timestamptz)
            ${orgFilterClause}
          GROUP BY t.scenario_name, floor(extract(epoch from t.time) / 5)
        ),
        request_buckets AS (
          SELECT
            rr.scenario_name,
            floor(extract(epoch from rr.time) / 5) as time_bucket,
            COUNT(*) as total_count
          FROM requests_raw rr
          LEFT JOIN test_runs tr ON tr.test_run_id = rr.test_run_id
          LEFT JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          LEFT JOIN teams team ON team.id = sut.team_id
          WHERE rr.test_run_id = $1
            AND rr.scenario_name IS NOT NULL
            AND ($2::boolean = false OR $3::timestamptz IS NULL OR rr.time >= $3::timestamptz)
            AND ($2::boolean = false OR $4::timestamptz IS NULL OR rr.time <= $4::timestamptz)
            ${orgFilterClause}
          GROUP BY rr.scenario_name, floor(extract(epoch from rr.time) / 5)
        ),
        transaction_peaks AS (
          SELECT
            scenario_name,
            CEIL(MAX(total_count)::numeric / 5) as peak_transactions_per_second
          FROM transaction_buckets
          GROUP BY scenario_name
        ),
        request_peaks AS (
          SELECT
            scenario_name,
            CEIL(MAX(total_count)::numeric / 5) as peak_requests_per_second
          FROM request_buckets
          GROUP BY scenario_name
        )
        SELECT
          COALESCE(t.scenario_name, r.scenario_name) as scenario_name,
          COALESCE(t.peak_transactions_per_second, 0) as peak_transactions_per_second,
          COALESCE(r.peak_requests_per_second, 0) as peak_requests_per_second
        FROM transaction_peaks t
        FULL OUTER JOIN request_peaks r ON t.scenario_name = r.scenario_name
        ORDER BY scenario_name ASC
      `;

      const queryParams = !isAdmin
        ? [resolvedTestRunId, excludeRampUp, cutoffTime, endCutoffTime, organizationIds]
        : [resolvedTestRunId, excludeRampUp, cutoffTime, endCutoffTime];

      const [transactionsResult, requestsResult, scenarioResult] = await Promise.all([
        withRequestEm(this.testRunRepo).query(transactionsQuery, queryParams),
        withRequestEm(this.testRunRepo).query(requestsQuery, queryParams),
        withRequestEm(this.testRunRepo).query(scenarioQuery, queryParams),
      ]);

      const transactions = transactionsResult[0] || { peak_transactions_per_second: 0 };
      const requests = requestsResult[0] || { peak_requests_per_second: 0 };

      return {
        overall: {
          peak_transactions_per_second: this.mapper.parseInt(transactions.peak_transactions_per_second),
          peak_requests_per_second: this.mapper.parseInt(requests.peak_requests_per_second),
        },
        by_scenario: scenarioResult.map((row: Record<string, unknown>) => ({
          scenario_name: row.scenario_name as string,
          peak_transactions_per_second: this.mapper.parseInt(row.peak_transactions_per_second),
          peak_requests_per_second: this.mapper.parseInt(row.peak_requests_per_second),
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get throughput stats for test run ${testRunId}:`, error);
      throw new DatabaseException('Failed to retrieve throughput statistics', error);
    }
  }

  /**
   * Return time-bucketed performance data for the analysis time range dialog chart.
   * Buckets span the full test duration (ramp_up excluded via the transactions.ramp_up column).
   * Returns null when the test run cannot be found or has no JTL/transactions data.
   */
  async getSummaryTimeseries(testRunIdOrUuid: string): Promise<SummaryTimeseriesResponse | null> {
    try {
      const resolvedTestRunId = await this.resolveTestRunId(testRunIdOrUuid).catch(() => null);
      if (!resolvedTestRunId) return null;

      // Fetch test run metadata: start_time and duration
      const metaRows: Array<{ start_time: string; duration: number }> = await withRequestEm(
        this.testRunRepo,
      ).query(`SELECT start_time, duration FROM test_runs WHERE test_run_id = $1 LIMIT 1`, [
        resolvedTestRunId,
      ]);

      const meta = metaRows[0];
      if (!meta || meta.duration == null) return null;

      const { start_time, duration } = meta;
      const durationNum = Number(duration);
      const BUCKET_TARGET_COUNT = 100;
      const MIN_BUCKET_SECONDS = 5;
      const MAX_BUCKET_SECONDS = 60;
      const bucketSizeSeconds = Math.max(MIN_BUCKET_SECONDS, Math.min(MAX_BUCKET_SECONDS, Math.round(durationNum / BUCKET_TARGET_COUNT)));

      // Query bucketed stats across the FULL test run (no ramp_up filter) so the
      // analysis time range dialog can show the user data outside the current
      // analysis window and let them choose new boundaries.
      // UNION ALL covers both JMeter/Gatling runs (transactions table) and
      // JTL-imported runs (requests_raw table) — only one will have rows.
      const bucketRows: Array<{
        time_seconds: string;
        throughput: string;
        avg_response_time: string;
        errors_per_second: string;
      }> = await withRequestEm(this.testRunRepo).query(
        `SELECT
           FLOOR(EXTRACT(EPOCH FROM (t.time - $2::timestamptz)) / $3) * $3 AS time_seconds,
           COUNT(*)::float / $3 AS throughput,
           AVG(t.response_time) AS avg_response_time,
           0 AS errors_per_second
         FROM (
           SELECT time, response_time FROM transactions   WHERE test_run_id = $1
           UNION ALL
           SELECT time, response_time FROM requests_raw   WHERE test_run_id = $1
         ) t
         GROUP BY 1
         ORDER BY 1`,
        [resolvedTestRunId, start_time, bucketSizeSeconds],
      );

      if (bucketRows.length === 0) return null;

      const buckets: SummaryTimeseriesBucket[] = bucketRows.map((row) => ({
        timeSeconds: Number(row.time_seconds),
        throughput: Number(row.throughput),
        avgResponseTime: Number(row.avg_response_time),
        errorsPerSecond: Number(row.errors_per_second),
      }));

      return { duration: durationNum, bucketSizeSeconds, buckets };
    } catch (error) {
      this.logger.error(
        `Failed to get summary timeseries for test run ${testRunIdOrUuid}:`,
        error,
      );
      throw new DatabaseException('Failed to retrieve summary timeseries', error);
    }
  }

  async getAggregatedMetricTimeseries(
    testRunId: string,
    metric: 'transaction_response_time' | 'request_response_time' | 'error_percentage',
    stat: 'avg' | 'p50' | 'p90' | 'p95' | 'p99' | 'max',
    applyAnalysisWindow: boolean,
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<{ bucketSizeSeconds: number; buckets: Array<{ time: string; value: number }> }> {
    try {
      if (!isAdmin && organizationIds.length === 0) {
        return { bucketSizeSeconds: 60, buckets: [] };
      }

      const resolvedTestRunId = await this.resolveTestRunId(testRunId);
      // applyAnalysisWindow=true is semantically equivalent to excludeRampUp=true in getAnalysisBounds
      const { startCutoff, endCutoff } = await this.getAnalysisBounds(resolvedTestRunId, applyAnalysisWindow);

      const orgClause = isAdmin ? '' : 'AND sut.organization_id = ANY($4::uuid[])';

      const statExprMap: Record<typeof stat, string> = {
        avg: 'ROUND(AVG(t.response_time)::numeric, 2)',
        p50: 'ROUND(approx_percentile(0.50, percentile_agg(t.response_time::double precision))::numeric, 2)',
        p90: 'ROUND(approx_percentile(0.90, percentile_agg(t.response_time::double precision))::numeric, 2)',
        p95: 'ROUND(approx_percentile(0.95, percentile_agg(t.response_time::double precision))::numeric, 2)',
        p99: 'ROUND(approx_percentile(0.99, percentile_agg(t.response_time::double precision))::numeric, 2)',
        max: 'MAX(t.response_time)::numeric',
      };

      let query: string;
      let params: unknown[];

      if (metric === 'error_percentage') {
        query = `
        SELECT
          date_trunc('minute', r.time) AS time,
          ROUND(
            COUNT(*) FILTER (WHERE NOT r.success)::numeric / NULLIF(COUNT(*), 0) * 100,
            2
          ) AS value
        FROM requests_raw r
        JOIN test_runs tr ON tr.test_run_id = r.test_run_id
        JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        WHERE r.test_run_id = $1
          AND ($2::timestamptz IS NULL OR r.time >= $2::timestamptz)
          AND ($3::timestamptz IS NULL OR r.time <= $3::timestamptz)
          ${orgClause}
        GROUP BY 1
        ORDER BY 1
      `;
        params = isAdmin
          ? [resolvedTestRunId, startCutoff, endCutoff]
          : [resolvedTestRunId, startCutoff, endCutoff, organizationIds];
      } else {
        const table = metric === 'transaction_response_time' ? 'transactions' : 'requests_raw';
        const statExpr = statExprMap[stat];
        query = `
        SELECT
          date_trunc('minute', t.time) AS time,
          ${statExpr} AS value
        FROM ${table} t
        JOIN test_runs tr ON tr.test_run_id = t.test_run_id
        JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        WHERE t.test_run_id = $1
          AND ($2::timestamptz IS NULL OR t.time >= $2::timestamptz)
          AND ($3::timestamptz IS NULL OR t.time <= $3::timestamptz)
          ${orgClause}
        GROUP BY 1
        ORDER BY 1
      `;
        params = isAdmin
          ? [resolvedTestRunId, startCutoff, endCutoff]
          : [resolvedTestRunId, startCutoff, endCutoff, organizationIds];
      }

      const rows: Array<{ time: string; value: string }> = await withRequestEm(this.testRunRepo).query(query, params);

      return {
        bucketSizeSeconds: 60,
        buckets: rows.map(row => ({
          time: new Date(row.time).toISOString(),
          value: this.mapper.parseFloat(row.value) ?? 0,
        })),
      };
    } catch (error) {
      throw new DatabaseException('Failed to retrieve aggregated metric timeseries', error as Error);
    }
  }

  /**
   * Run-wide aggregate (all transactions/requests collapsed) per test run — the
   * non-bucketed, batched sibling of getAggregatedMetricTimeseries. Powers the
   * "All aggregated" series on the Trends and Compare cards.
   *
   * Reads the pre-computed rollups (`test_run_transaction_stats` /
   * `test_run_sampler_stats`), merging the per-series tdigests with `rollup()`
   * — accurate, unlike averaging percentiles — so ALL stats come back from one
   * pass over a small table instead of a raw-table scan per stat. `stat` only
   * selects which one lands in `value`; for the response-time metrics `values`
   * carries avg/p50/p90/p95/p99/max, which is what Compare's AVG/P90/P95/P99
   * columns need. `error_percentage` yields `{ avg }` alone and, as the API
   * documents, ignores `stat` entirely — `value` always holds the percentage.
   *
   * Window: analysis-window rows (`ramp_up_excluded = true`) when the run has
   * them, else the full-run rows. The rollup pipeline only writes the
   * analysis-window half `WHERE total_excl > 0`, so a run whose samples all
   * fall inside ramp-up has no such rows at all — without the fallback it would
   * report nothing. The previous raw-table implementation always used the full
   * run, so values shift slightly for runs that do have a window. Percentiles
   * are tdigest approximations (the same ones per-transaction rows show).
   *
   * Contract: `testRunIds` are canonical `test_run_id` strings, NOT entity
   * UUIDs. Unlike the single-run route methods, this batch method does not
   * `resolveTestRunId`; callers (Trends/Compare cards) already hold them.
   */
  async getAggregatedMetricStatistics(
    testRunIds: string[],
    metric: 'transaction_response_time' | 'request_response_time' | 'error_percentage',
    stat: 'avg' | 'p50' | 'p90' | 'p95' | 'p99' | 'max',
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<Array<{ testRunId: string; value: number | null; values: Record<string, number | null> }>> {
    const requested = testRunIds ?? [];
    if (requested.length === 0) return [];
    // Non-admin with no orgs can see nothing.
    if (!isAdmin && organizationIds.length === 0) {
      return requested.map(testRunId => ({ testRunId, value: null, values: {} }));
    }

    try {
      const orgClause = isAdmin ? '' : 'AND sut.organization_id = ANY($2::uuid[])';
      // request_response_time and error_percentage are both request-level.
      const table = metric === 'transaction_response_time'
        ? 'test_run_transaction_stats'
        : 'test_run_sampler_stats';

      // Org-scoped rows for the requested runs, then one window per run:
      // analysis-window rows when the run has any, else the full-run rows.
      const scoped = `
        scoped AS (
          SELECT s.*
          FROM ${table} s
          JOIN test_runs tr ON tr.test_run_id = s.test_run_id
          JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
          WHERE s.test_run_id = ANY($1::text[])
            ${orgClause}
        ),
        win AS (
          SELECT test_run_id, bool_or(ramp_up_excluded) AS use_excluded
          FROM scoped
          GROUP BY test_run_id
        )`;

      let query: string;
      if (metric === 'error_percentage') {
        query = `
        WITH ${scoped}
        SELECT
          s.test_run_id AS test_run_id,
          ROUND(SUM(s.failed_count)::numeric / NULLIF(SUM(s.total_count), 0) * 100, 2) AS avg
        FROM scoped s
        JOIN win w ON w.test_run_id = s.test_run_id
        WHERE s.ramp_up_excluded = w.use_excluded
        GROUP BY s.test_run_id
      `;
      } else {
        query = `
        WITH ${scoped},
        agg AS (
          SELECT s.test_run_id, rollup(s.pct_agg) AS pct_agg
          FROM scoped s
          JOIN win w ON w.test_run_id = s.test_run_id
          WHERE s.ramp_up_excluded = w.use_excluded
          GROUP BY s.test_run_id
        )
        SELECT
          test_run_id,
          ROUND(mean(pct_agg)::numeric, 2)                        AS avg,
          ROUND(approx_percentile(0.50, pct_agg)::numeric, 2)     AS p50,
          ROUND(approx_percentile(0.90, pct_agg)::numeric, 2)     AS p90,
          ROUND(approx_percentile(0.95, pct_agg)::numeric, 2)     AS p95,
          ROUND(approx_percentile(0.99, pct_agg)::numeric, 2)     AS p99,
          ROUND(max_val(pct_agg)::numeric, 2)                     AS max
        FROM agg
      `;
      }

      const params: unknown[] = isAdmin ? [requested] : [requested, organizationIds];
      const rows: Array<Record<string, string>> = await withRequestEm(this.testRunRepo).query(query, params);

      const byId = new Map<string, Record<string, number | null>>();
      for (const row of rows) {
        const { test_run_id: id, ...stats } = row;
        if (!id) continue;
        byId.set(id, Object.fromEntries(
          Object.entries(stats).map(([k, v]) => [k, this.mapper.parseFloat(v)]),
        ));
      }
      // error_percentage has one column and ignores `stat` (the controller
      // deliberately skips allowlisting it for that metric, so never index by
      // it — an arbitrary key would otherwise reach a prototype member).
      const key = metric === 'error_percentage' ? 'avg' : stat;
      return requested.map(testRunId => {
        const values = byId.get(testRunId) ?? {};
        return {
          testRunId,
          value: Object.hasOwn(values, key) ? values[key] ?? null : null,
          values,
        };
      });
    } catch (error) {
      throw new DatabaseException('Failed to retrieve aggregated metric statistics', error as Error);
    }
  }

  /**
   * Per-normalized-URL statistics for the Compare card's URL dimension.
   * Regroups the pre-computed sampler rollup (`test_run_sampler_stats`) by
   * `url_hash`, merging the per-sampler tdigests with `rollup()` (accurate,
   * unlike averaging percentiles) and count-weighting the mean columns. Reads
   * the analysis-window rows (`ramp_up_excluded = true`). Fast: hits the small
   * rollup table, never `requests_raw`.
   *
   * Contract mirrors getAggregatedMetricStatistics: `testRunIds` are canonical
   * `test_run_id` strings; org scoping via (isAdmin, organizationIds).
   *
   * Caveat: the sampler rollup keeps only the last-seen `url_hash` per sampler,
   * so a sampler that hits multiple normalized URLs in one run attributes all
   * its samples to that last URL. Pre-existing rollup property; degrades
   * gracefully; irrelevant to the primary case (samplers labelled by raw URL).
   */
  async getUrlMetricStatistics(
    testRunIds: string[],
    metric: 'response_time' | 'error_percentage' | 'throughput' | 'latency' | 'connect_time',
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<Array<{
    test_run_id: string;
    panel_title: string;
    metric_name: string;
    created_at: string;
    version: string | null;
    annotations: string | null;
    statistics: { avg?: number; q50?: number; q90?: number; q95?: number; q99?: number; count?: number };
  }>> {
    const requested = testRunIds ?? [];
    if (requested.length === 0) return [];
    if (!isAdmin && organizationIds.length === 0) return [];

    try {
      const orgClause = isAdmin ? '' : 'AND sut.organization_id = ANY($2::uuid[])';

      const query = `
      WITH agg AS (
        SELECT
          s.test_run_id,
          s.url_hash,
          s.system_under_test,
          s.test_environment,
          rollup(s.pct_agg)                                                        AS pct_agg,
          SUM(s.total_count)                                                       AS total_count,
          SUM(s.passed_count)                                                      AS passed_count,
          SUM(s.failed_count)                                                      AS failed_count,
          SUM(s.avg_response_time * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg_response_time,
          SUM(s.avg_latency       * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg_latency,
          SUM(s.avg_connect_time  * s.total_count) / NULLIF(SUM(s.total_count), 0) AS avg_connect_time
        FROM test_run_sampler_stats s
        JOIN test_runs tr           ON tr.test_run_id = s.test_run_id
        JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        WHERE s.test_run_id = ANY($1::text[])
          AND s.ramp_up_excluded = true
          AND s.total_count > 0
          ${orgClause}
        GROUP BY s.test_run_id, s.url_hash, s.system_under_test, s.test_environment
      )
      SELECT
        a.test_run_id,
        COALESCE(up.normalized_url, a.url_hash)                                    AS normalized_url,
        a.total_count,
        ROUND(a.avg_response_time::numeric, 2)                                     AS avg_response_time,
        ROUND(approx_percentile(0.50, a.pct_agg)::numeric, 2)                      AS p50,
        ROUND(approx_percentile(0.90, a.pct_agg)::numeric, 2)                      AS p90,
        ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2)                      AS p95,
        ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2)                      AS p99,
        ROUND(a.avg_latency::numeric, 2)                                           AS avg_latency,
        ROUND(a.avg_connect_time::numeric, 2)                                      AS avg_connect_time,
        ROUND(a.failed_count::numeric / NULLIF(a.total_count, 0) * 100, 2)         AS error_percentage,
        ROUND(a.total_count::numeric
              / NULLIF(GREATEST(tr.duration - COALESCE(tr.ramp_up, 0), 0), 0), 2)  AS throughput
      FROM agg a
      JOIN test_runs tr           ON tr.test_run_id = a.test_run_id
      LEFT JOIN url_patterns up
        ON  up.url_hash          = a.url_hash
        AND up.system_under_test = a.system_under_test
        AND up.test_environment  = a.test_environment
      ORDER BY a.total_count DESC
    `;

      const params: unknown[] = isAdmin ? [requested] : [requested, organizationIds];
      const rows: Array<Record<string, unknown>> = await withRequestEm(this.testRunRepo).query(query, params);

      return rows.map(row => {
        const totalCount = this.mapper.parseInt(row.total_count) ?? undefined;
        let statistics: { avg?: number; q50?: number; q90?: number; q95?: number; q99?: number; count?: number };
        if (metric === 'response_time') {
          statistics = {
            avg: this.mapper.parseFloat(row.avg_response_time) ?? undefined,
            q50: this.mapper.parseFloat(row.p50) ?? undefined,
            q90: this.mapper.parseFloat(row.p90) ?? undefined,
            q95: this.mapper.parseFloat(row.p95) ?? undefined,
            q99: this.mapper.parseFloat(row.p99) ?? undefined,
          };
        } else {
          const scalarCol =
            metric === 'error_percentage' ? 'error_percentage'
            : metric === 'throughput'     ? 'throughput'
            : metric === 'latency'        ? 'avg_latency'
            :                               'avg_connect_time';
          statistics = { avg: this.mapper.parseFloat(row[scalarCol]) ?? undefined, count: totalCount };
        }
        return {
          test_run_id: row.test_run_id as string,
          panel_title: 'URL',
          metric_name: row.normalized_url as string,
          created_at: '',
          version: null,
          annotations: null,
          statistics,
        };
      });
    } catch (error) {
      throw new DatabaseException('Failed to retrieve URL metric statistics', error as Error);
    }
  }

  /**
   * Distinct normalized URLs present in a single run's sampler rollup — powers
   * the URL series multi-select. Anchor run only.
   */
  async getUrlDistinctNames(
    testRunId: string,
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<string[]> {
    if (!isAdmin && organizationIds.length === 0) return [];
    try {
      const orgClause = isAdmin ? '' : 'AND sut.organization_id = ANY($2::uuid[])';
      const query = `
      SELECT DISTINCT COALESCE(up.normalized_url, s.url_hash) AS normalized_url
      FROM test_run_sampler_stats s
      JOIN test_runs tr           ON tr.test_run_id = s.test_run_id
      JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
      LEFT JOIN url_patterns up
        ON  up.url_hash          = s.url_hash
        AND up.system_under_test = s.system_under_test
        AND up.test_environment  = s.test_environment
      WHERE s.test_run_id = $1
        AND s.ramp_up_excluded = true
        AND s.total_count > 0
        ${orgClause}
      ORDER BY 1
    `;
      const params: unknown[] = isAdmin ? [testRunId] : [testRunId, organizationIds];
      const rows: Array<{ normalized_url: string }> = await withRequestEm(this.testRunRepo).query(query, params);
      return rows.map(r => r.normalized_url).filter(Boolean);
    } catch (error) {
      throw new DatabaseException('Failed to retrieve URL distinct names', error as Error);
    }
  }

  /**
   * Map of Request-RT metric name -> normalized URL for a run, for the Compare
   * card's Request RT dimension (mirrors the perf-analysis samples join). The
   * key is `transaction_name.sampler_name` — identical to `ds_metric_statistics.
   * metric_name` for panel 201, so the frontend can join by metric name. Only
   * requests that resolve to a `url_patterns.normalized_url` are included; a
   * request with no pattern is omitted so the caller falls back to the bare
   * name. When a request spans multiple url_hashes, the highest-count one wins.
   */
  async getSamplerUrlMap(
    testRunId: string,
    isAdmin: boolean,
    organizationIds: string[],
  ): Promise<Record<string, string>> {
    if (!isAdmin && organizationIds.length === 0) return {};
    try {
      const orgClause = isAdmin ? '' : 'AND sut.organization_id = ANY($2::uuid[])';
      const query = `
      SELECT DISTINCT ON (s.transaction_name || '.' || s.sampler_name)
        s.transaction_name || '.' || s.sampler_name AS metric_name,
        LOWER(up.normalized_url) AS normalized_url
      FROM test_run_sampler_stats s
      JOIN test_runs tr           ON tr.test_run_id = s.test_run_id
      JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
      JOIN url_patterns up
        ON  up.url_hash          = s.url_hash
        AND up.system_under_test = s.system_under_test
        AND up.test_environment  = s.test_environment
      WHERE s.test_run_id = $1
        AND s.ramp_up_excluded = true
        AND s.total_count > 0
        ${orgClause}
      ORDER BY s.transaction_name || '.' || s.sampler_name, s.total_count DESC
    `;
      const params: unknown[] = isAdmin ? [testRunId] : [testRunId, organizationIds];
      const rows: Array<{ metric_name: string; normalized_url: string }> =
        await withRequestEm(this.testRunRepo).query(query, params);
      const map: Record<string, string> = {};
      for (const r of rows) {
        if (r.metric_name && r.normalized_url) map[r.metric_name] = r.normalized_url;
      }
      return map;
    } catch (error) {
      throw new DatabaseException('Failed to retrieve sampler URL map', error as Error);
    }
  }
}
