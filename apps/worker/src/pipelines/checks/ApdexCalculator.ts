import { EntityManager } from 'typeorm';
import type { Logger } from 'pino';
import { BaseCheckService } from './BaseCheckService.js';
import { TestRun } from './BenchmarkMatcher.js';

/**
 * Apdex calculation result containing the score and distribution
 */
export interface ApdexResult {
  /** Transaction name (null for workload-level aggregate) */
  transaction_name: string | null;
  /** Number of requests with response_time <= T */
  satisfied_count: number;
  /** Number of requests with T < response_time <= 4T */
  tolerating_count: number;
  /** Number of requests with response_time > 4T */
  frustrated_count: number;
  /** Total number of requests */
  total_count: number;
  /** Calculated Apdex score (0.000 - 1.000) */
  apdex_score: number | null;
  /** The T threshold used for calculation (in ms) */
  threshold_ms: number;
  /** Average response time in milliseconds */
  avg_response_time_ms: number | null;
}

/**
 * Apdex benchmark configuration
 */
export interface ApdexBenchmark {
  id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  benchmark_type: 'apdex';
  transaction_name: string | null;
  apdex_threshold_ms: number | null;
  min_apdex_score: number;
  include_failed_requests: boolean;
  exclude_ramp_up_time: boolean;
}

/**
 * Per-transaction Apdex result for workload-level SLOs
 */
interface TransactionApdexResult {
  transaction_name: string;
  scenario_name: string;
  apdex_score: number | null;
  threshold_ms: number;
  meets_requirement: boolean | null;
  satisfied_count: number;
  tolerating_count: number;
  frustrated_count: number;
  total_count: number;
  avg_response_time_ms: number | null;
}

/**
 * Apdex check result for storage
 */
export interface ApdexCheckResult {
  benchmark_id: string;
  test_run_id: string;
  meets_requirement: boolean | null;
  apdex_result: ApdexResult;
  requirement: {
    min_score: number;
    threshold_ms: number;
  };
  status: 'COMPLETE' | 'ERROR' | 'NO_DATA';
  message: string;
  /** Per-transaction breakdown for workload-level SLOs */
  transaction_results?: TransactionApdexResult[];
}

/**
 * Service to calculate Apdex scores from transactions table
 *
 * Apdex (Application Performance Index) measures user satisfaction:
 * - Satisfied: response_time <= T (threshold)
 * - Tolerating: T < response_time <= 4T
 * - Frustrated: response_time > 4T
 *
 * Apdex Score = (Satisfied + Tolerating * 0.5) / Total
 *
 * Note: Uses the `transactions` table (transaction-level timings) rather than
 * `requests_raw` (individual HTTP requests) to match Performance Analysis
 * and provide user-perceived performance metrics.
 */
export class ApdexCalculator extends BaseCheckService {
  constructor(
    logger: Logger,
    private manager: EntityManager
  ) {
    super(logger);
  }

  /**
   * Calculate Apdex score for a specific transaction or entire workload.
   *
   * Fast path: when `transactionName` is set and `test_run_transaction_stats` has
   * matching rows for this `(test_run_id, transaction_name, ramp_up_excluded)`
   * triple, the score is computed from the rolled-up tdigest sketch via
   * `approx_percentile_rank`. Drops a ~260 K-row hypertable scan to a few rollup
   * rows. See issues #296 and #298.
   *
   * Sketch selection (#298): the rollup tables store two sketches per row —
   * `pct_agg` over every transaction and `pct_agg_passed` over only `success =
   * true` rows. The fast path picks `pct_agg` when `includeFailedRequests=true`
   * and `pct_agg_passed` otherwise, so the fast path fires regardless of how
   * many failures the run produced. Pre-#298 rollups don't have
   * `pct_agg_passed` populated; in that case the fast path returns a miss and
   * the caller falls back to the raw `transactions` scan, the same shape #296
   * used for the original rollout.
   *
   * Workload-level callers (`transactionName === null`, e.g. `previewApdex`)
   * keep the raw-scan path. The hot path in checks-evaluation always passes a
   * transactionName because `evaluateWorkloadLevelApdex` iterates per-transaction.
   */
  async calculateApdex(params: {
    testRun: TestRun;
    transactionName: string | null;
    thresholdMs: number;
    includeFailedRequests: boolean;
    excludeRampUp: boolean;
  }): Promise<ApdexResult> {
    const { testRun, transactionName, thresholdMs, includeFailedRequests, excludeRampUp } = params;

    if (transactionName !== null) {
      const hits = await this.calculateApdexFromRollupBulk({
        testRunId: testRun.test_run_id,
        transactions: [{ transactionName, thresholdMs }],
        includeFailedRequests,
        excludeRampUp,
      });
      const fastPath = hits.get(transactionName);
      if (fastPath) {
        return fastPath;
      }
      this.logger.debug(
        `Rollup Apdex fast path miss for ${testRun.test_run_id}/${transactionName} (no rollup rows, zero matching count, or pct_agg_passed not yet populated)`,
      );
    }

    return this.calculateApdexRaw(params);
  }

  /** The raw `transactions` scan. Callers that already know the rollup missed use it directly. */
  private async calculateApdexRaw(params: {
    testRun: TestRun;
    transactionName: string | null;
    thresholdMs: number;
    includeFailedRequests: boolean;
    excludeRampUp: boolean;
  }): Promise<ApdexResult> {
    const { testRun, transactionName, thresholdMs, includeFailedRequests, excludeRampUp } = params;
    const toleratingThreshold = thresholdMs * 4;

    // Build WHERE clause
    const conditions: string[] = ['test_run_id = $1'];
    const queryParams: unknown[] = [testRun.test_run_id];
    let paramIndex = 2;

    // Filter by transaction if specified
    if (transactionName) {
      conditions.push(`transaction_name = $${paramIndex}`);
      queryParams.push(transactionName);
      paramIndex++;
    }

    // Exclude failed requests unless configured otherwise
    if (!includeFailedRequests) {
      conditions.push('success = true');
    }

    // Exclude analysis start offset period if configured
    if (excludeRampUp && testRun.ramp_up && testRun.start_time) {
      const rampUpEndTime = new Date(testRun.start_time.getTime() + testRun.ramp_up * 1000);
      conditions.push(`time >= $${paramIndex}`);
      queryParams.push(rampUpEndTime);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Add threshold params
    queryParams.push(thresholdMs);
    queryParams.push(toleratingThreshold);

    const query = `
      SELECT
        COUNT(*) FILTER (WHERE response_time <= $${paramIndex}) as satisfied_count,
        COUNT(*) FILTER (WHERE response_time > $${paramIndex} AND response_time <= $${paramIndex + 1}) as tolerating_count,
        COUNT(*) FILTER (WHERE response_time > $${paramIndex + 1}) as frustrated_count,
        COUNT(*) as total_count,
        AVG(response_time) as avg_response_time_ms
      FROM transactions
      WHERE ${whereClause}
        AND response_time IS NOT NULL
    `;

    this.logger.debug(`Calculating Apdex for test run ${testRun.test_run_id}, transaction: ${transactionName || 'ALL'}, threshold: ${thresholdMs}ms`);

    const result = await this.manager.query(query, queryParams);
    const row = result[0];

    const satisfied = parseInt(row.satisfied_count) || 0;
    const tolerating = parseInt(row.tolerating_count) || 0;
    const frustrated = parseInt(row.frustrated_count) || 0;
    const total = parseInt(row.total_count) || 0;
    const avgResponseTime = row.avg_response_time_ms !== null
      ? Math.round(parseFloat(row.avg_response_time_ms) * 100) / 100
      : null;

    // Calculate Apdex score: (Satisfied + Tolerating * 0.5) / Total
    const apdexScore = total > 0
      ? Math.round(((satisfied + tolerating * 0.5) / total) * 1000) / 1000
      : null;

    this.logger.info(
      `Apdex for ${transactionName || 'workload'}: ${apdexScore?.toFixed(3) || 'N/A'} ` +
      `(S:${satisfied} T:${tolerating} F:${frustrated} Total:${total} Avg:${avgResponseTime?.toFixed(0) || 'N/A'}ms)`
    );

    return {
      transaction_name: transactionName,
      satisfied_count: satisfied,
      tolerating_count: tolerating,
      frustrated_count: frustrated,
      total_count: total,
      apdex_score: apdexScore,
      threshold_ms: thresholdMs,
      avg_response_time_ms: avgResponseTime,
    };
  }

  /**
   * Rollup-based Apdex fast path, for many transactions in ONE statement, each
   * with its own threshold. A transaction is absent from the returned map (a
   * miss) when the rollup has no matching rows OR (when
   * `includeFailedRequests=false`) any matching row's `pct_agg_passed` is NULL —
   * i.e. the row predates #298 and has not been re-rolled-up yet. The caller
   * falls back to the raw `transactions` scan for every miss.
   *
   * The workload-level SLO used to issue this per transaction (plus two threshold
   * lookups and two SAVEPOINT statements each): ~1,470 round trips on a
   * 294-transaction run. `unnest($3::text[], $5::double precision[])` pairs each
   * transaction with its threshold, the inner join drops transactions with no
   * rollup row, and `GROUP BY` keeps one sketch roll-up per transaction. The
   * single-transaction caller (`calculateApdex`) passes one-element arrays.
   *
   * Sketch selection (#298): `rollup(CASE WHEN $4::boolean THEN pct_agg ELSE
   * pct_agg_passed END)` picks the all-rows sketch when
   * `includeFailedRequests=true`, the success-only sketch otherwise. This lets
   * the fast path fire regardless of how many failed rows the run produced —
   * pre-#298 the eligibility filter `($4::boolean OR failed = 0)` forced a
   * fall-back to the legacy scan on every soak run with non-trivial failure
   * rate.
   *
   * Score denominator (#298): `total_count` reported from this query is the
   * effective total for the chosen sketch — `SUM(total_count)` when
   * including failures (matches the all-rows pct_agg) or `SUM(passed_count)`
   * when excluding (matches the success-only pct_agg_passed). That mirrors
   * what the raw query produces with vs without `success = true` and keeps
   * the JS-side score formula identical to the raw path.
   *
   * Output column names mirror the raw query so the caller's parsing works
   * identically; the JS-side Apdex score formula is the same as the raw path.
   */
  private async calculateApdexFromRollupBulk(params: {
    testRunId: string;
    transactions: Array<{ transactionName: string; thresholdMs: number }>;
    includeFailedRequests: boolean;
    excludeRampUp: boolean;
  }): Promise<Map<string, ApdexResult>> {
    const { testRunId, transactions, includeFailedRequests, excludeRampUp } = params;
    const hits = new Map<string, ApdexResult>();
    if (transactions.length === 0) {
      return hits;
    }

    // TimescaleDB toolkit edge case: approx_percentile_rank(x, sketch) returns NaN
    // when x equals exactly the maximum value stored in the sketch (issue #326).
    // NULLIF(NaN, 'NaN') returns NULL in PG (NaN = NaN is true), and COALESCE gives
    // the semantically correct 1.0 (threshold >= max means 100% satisfied).
    const query = `
      WITH wanted AS (
        SELECT t.transaction_name, t.threshold_ms
        FROM unnest($3::text[], $5::double precision[]) AS t(transaction_name, threshold_ms)
      ),
      agg AS (
        SELECT
          w.transaction_name,
          w.threshold_ms,
          COUNT(*)                                                AS row_count,
          COALESCE(
            SUM(CASE WHEN $4::boolean THEN s.total_count ELSE s.passed_count END),
            0
          )::bigint                                               AS effective_total,
          COALESCE(SUM(s.total_count), 0)::bigint                 AS sum_total_count,
          BOOL_AND(s.pct_agg_passed IS NOT NULL)                  AS has_passed_sketch,
          SUM(s.avg_response_time * s.total_count)::numeric       AS sum_avg_x_total,
          rollup(CASE WHEN $4::boolean THEN pct_agg ELSE pct_agg_passed END)
                                                                  AS pct_eff
        FROM wanted w
        JOIN test_run_transaction_stats s
          ON s.test_run_id = $1
         AND s.ramp_up_excluded = $2
         AND s.transaction_name = w.transaction_name
        GROUP BY w.transaction_name, w.threshold_ms
      ),
      ranks AS (
        SELECT
          transaction_name,
          threshold_ms,
          effective_total,
          sum_total_count,
          sum_avg_x_total,
          row_count,
          has_passed_sketch,
          COALESCE(NULLIF(approx_percentile_rank(threshold_ms,       pct_eff), 'NaN'::double precision), 1.0) AS rank_t,
          COALESCE(NULLIF(approx_percentile_rank(threshold_ms * 4,   pct_eff), 'NaN'::double precision), 1.0) AS rank_4t
        FROM agg
      )
      SELECT
        transaction_name,
        threshold_ms,
        effective_total                                                                        AS total_count,
        GREATEST(
          ROUND(rank_t * effective_total)::bigint,
          0::bigint
        )                                                                                      AS satisfied_count,
        GREATEST(
          (ROUND(rank_4t * effective_total)::bigint
           - ROUND(rank_t * effective_total)::bigint),
          0::bigint
        )                                                                                      AS tolerating_count,
        GREATEST(
          (effective_total
           - ROUND(rank_4t * effective_total)::bigint),
          0::bigint
        )                                                                                      AS frustrated_count,
        ROUND((sum_avg_x_total / NULLIF(sum_total_count, 0))::numeric, 2)                      AS avg_response_time_ms
      FROM ranks
      WHERE row_count > 0
        AND effective_total > 0
        AND ($4::boolean OR has_passed_sketch)
    `;

    const queryParams: unknown[] = [
      testRunId,
      excludeRampUp,
      transactions.map((t) => t.transactionName),
      includeFailedRequests,
      transactions.map((t) => t.thresholdMs),
    ];

    this.logger.debug(
      `Trying rollup Apdex fast path for test run ${testRunId}, ${transactions.length} transaction(s)`,
    );

    // threshold_ms comes back from the unnest as float8; echo the caller's number instead.
    const thresholdByName = new Map(transactions.map((t) => [t.transactionName, t.thresholdMs]));
    const result = await this.manager.query(query, queryParams);
    for (const row of result) {
      const transactionName: string = row.transaction_name;
      const satisfied = parseInt(row.satisfied_count) || 0;
      const tolerating = parseInt(row.tolerating_count) || 0;
      const frustrated = parseInt(row.frustrated_count) || 0;
      const total = parseInt(row.total_count) || 0;
      const avgResponseTime = row.avg_response_time_ms !== null && row.avg_response_time_ms !== undefined
        ? Math.round(parseFloat(row.avg_response_time_ms) * 100) / 100
        : null;
      const apdexScore = total > 0
        ? Math.round(((satisfied + tolerating * 0.5) / total) * 1000) / 1000
        : null;
      const thresholdMs = thresholdByName.get(transactionName) ?? Number(row.threshold_ms);

      this.logger.info(
        `Apdex (rollup) for ${transactionName}: ${apdexScore?.toFixed(3) || 'N/A'} ` +
        `(S:${satisfied} T:${tolerating} F:${frustrated} Total:${total} Avg:${avgResponseTime?.toFixed(0) || 'N/A'}ms)`,
      );

      hits.set(transactionName, {
        transaction_name: transactionName,
        satisfied_count: satisfied,
        tolerating_count: tolerating,
        frustrated_count: frustrated,
        total_count: total,
        apdex_score: apdexScore,
        threshold_ms: thresholdMs,
        avg_response_time_ms: avgResponseTime,
      });
    }
    return hits;
  }

  /**
   * Resolve the threshold to use for Apdex calculation.
   * Priority: transaction-specific > benchmark threshold > workload-level > default (500ms)
   *
   * Transaction-specific overrides take highest priority to allow fine-tuning
   * individual transactions that may have different performance characteristics.
   */
  async resolveThreshold(params: {
    benchmarkThreshold: number | null | undefined;
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    transactionName: string | null;
    organizationId?: string | null;
  }): Promise<number> {
    const { transactionName, ...scope } = params;
    const resolve = await this.loadThresholdResolver({
      ...scope,
      transactionNames: transactionName ? [transactionName] : [],
    });
    return resolve(transactionName);
  }

  /**
   * Load every threshold the priority chain can consult for a workload in at most
   * two statements, and return a synchronous per-transaction resolver:
   * transaction-specific > benchmark threshold > workload-level > default (500ms).
   *
   * The workload-level SLO used to run this chain per transaction (two queries
   * each); it now loads the overrides for all its transactions at once.
   */
  private async loadThresholdResolver(params: {
    benchmarkThreshold: number | null | undefined;
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    transactionNames: string[];
    organizationId?: string | null;
  }): Promise<(transactionName: string | null) => number> {
    const { benchmarkThreshold, systemUnderTestId, testEnvironment, workload, transactionNames, organizationId } = params;

    // 1. Transaction-specific thresholds (highest priority), all at once
    const perTransaction = new Map<string, number>();
    if (transactionNames.length > 0) {
      // RBAC: Filter by organization (backward compatible with NULL)
      let txQuery = `
        SELECT wtat.transaction_name, wtat.apdex_threshold
        FROM workload_transaction_apdex_thresholds wtat
        WHERE wtat.system_under_test_id = $1::uuid
          AND wtat.test_environment = $2
          AND wtat.workload = $3
          AND wtat.transaction_name = ANY($4::text[])
      `;
      const txParams: unknown[] = [systemUnderTestId, testEnvironment, workload, transactionNames];

      if (organizationId) {
        txQuery += `          AND (wtat.organization_id = $5 OR wtat.organization_id IS NULL)\n`;
        txParams.push(organizationId);
      }

      const rows = await this.manager.query(txQuery, txParams);
      for (const row of rows) {
        if (row.apdex_threshold) {
          perTransaction.set(row.transaction_name, row.apdex_threshold);
        }
      }
    }

    // 2. Explicit threshold on benchmark — if set, the workload-level lookup is never needed
    const hasBenchmarkThreshold = benchmarkThreshold !== null && benchmarkThreshold !== undefined;

    // 3. Workload-level threshold
    let workloadLevel: number | null = null;
    if (!hasBenchmarkThreshold) {
      // RBAC: Filter by organization (backward compatible with NULL)
      let wlQuery = `
        SELECT wat.apdex_threshold
        FROM workload_apdex_thresholds wat
        WHERE wat.system_under_test_id = $1::uuid
          AND wat.test_environment = $2
          AND wat.workload = $3
      `;
      const wlParams: unknown[] = [systemUnderTestId, testEnvironment, workload];

      if (organizationId) {
        wlQuery += `        AND (wat.organization_id = $4 OR wat.organization_id IS NULL)\n`;
        wlParams.push(organizationId);
      }

      const workloadThreshold = await this.manager.query(wlQuery, wlParams);
      if (workloadThreshold.length > 0 && workloadThreshold[0].apdex_threshold) {
        workloadLevel = workloadThreshold[0].apdex_threshold;
      }
    }

    return (transactionName) => {
      const specific = transactionName ? perTransaction.get(transactionName) : undefined;
      if (specific !== undefined) {
        this.logger.debug(`Using transaction-specific threshold: ${specific}ms`);
        return specific;
      }
      if (hasBenchmarkThreshold) {
        this.logger.debug(`Using explicit benchmark threshold: ${benchmarkThreshold}ms`);
        return benchmarkThreshold as number;
      }
      if (workloadLevel !== null) {
        this.logger.debug(`Using workload-level threshold: ${workloadLevel}ms`);
        return workloadLevel;
      }
      // 4. System default
      this.logger.debug('Using default threshold: 500ms');
      return 500;
    };
  }

  /**
   * Evaluate an Apdex benchmark and return a single check result.
   * For workload-level SLOs (transaction_name is null), evaluates each transaction
   * and returns a single result that passes only if ALL transactions pass.
   * The per-transaction breakdown is stored in transaction_results for UI display.
   */
  async evaluateApdexBenchmark(
    testRun: TestRun,
    benchmark: ApdexBenchmark
  ): Promise<ApdexCheckResult> {
    // If this is a workload-level SLO (no specific transaction), evaluate all transactions
    if (!benchmark.transaction_name) {
      return this.evaluateWorkloadLevelApdex(testRun, benchmark);
    }

    // Otherwise, evaluate the specific transaction
    return this.evaluateSingleTransaction(testRun, benchmark, benchmark.transaction_name);
  }

  /**
   * Evaluate a workload-level Apdex SLO against all transactions.
   * Returns a single result that passes only if ALL transactions meet the requirement.
   * Per-transaction breakdown is stored in transaction_results.
   */
  private async evaluateWorkloadLevelApdex(
    testRun: TestRun,
    benchmark: ApdexBenchmark
  ): Promise<ApdexCheckResult> {
    const {
      id: benchmarkId,
      system_under_test_id,
      test_environment,
      workload,
      apdex_threshold_ms,
      min_apdex_score,
      include_failed_requests,
      exclude_ramp_up_time,
    } = benchmark;

    // Get all transactions with their scenarios for this test run
    const transactionsWithScenarios = await this.getTransactionsWithScenarios(testRun.test_run_id);

    if (transactionsWithScenarios.length === 0) {
      this.logger.warn(`No transactions found for test run ${testRun.test_run_id}`);
      return {
        benchmark_id: benchmarkId,
        test_run_id: testRun.test_run_id,
        meets_requirement: false,
        apdex_result: {
          transaction_name: null,
          satisfied_count: 0,
          tolerating_count: 0,
          frustrated_count: 0,
          total_count: 0,
          apdex_score: null,
          threshold_ms: apdex_threshold_ms || 500,
          avg_response_time_ms: null,
        },
        requirement: { min_score: min_apdex_score, threshold_ms: apdex_threshold_ms || 500 },
        status: 'NO_DATA',
        message: 'No transactions found for this test run',
        transaction_results: [],
      };
    }

    this.logger.info(`Evaluating workload-level Apdex SLO for ${transactionsWithScenarios.length} transactions`);

    // Thresholds once for the whole workload, then one rollup statement for every
    // transaction. Only the transactions the rollup cannot answer (no row, or a
    // pre-#298 row without pct_agg_passed) take the per-transaction raw scan below.
    const resolveThreshold = await this.loadThresholdResolver({
      benchmarkThreshold: apdex_threshold_ms,
      systemUnderTestId: system_under_test_id,
      testEnvironment: test_environment,
      workload: workload,
      transactionNames: transactionsWithScenarios.map((t) => t.transaction_name),
      organizationId: testRun.organization_id,
    });
    // The rollup statement used to run inside each transaction's savepoint; keep that
    // isolation for the one bulk statement, or a fatal Postgres error in it (the #326
    // bigint-overflow shape) would abort the benchmark instead of one transaction.
    // On failure every transaction is a miss and takes the raw scan below.
    let rollupHits = new Map<string, ApdexResult>();
    await this.manager.query('SAVEPOINT sp_apdex_rollup');
    try {
      // One entry per NAME: a transaction that runs in two scenarios is two rows in
      // transactionsWithScenarios, and a duplicate in the unnest would join every
      // rollup row twice and double the counts after the GROUP BY.
      const uniqueNames = [...new Set(transactionsWithScenarios.map((t) => t.transaction_name))];
      rollupHits = await this.calculateApdexFromRollupBulk({
        testRunId: testRun.test_run_id,
        transactions: uniqueNames.map((transactionName) => ({
          transactionName,
          thresholdMs: resolveThreshold(transactionName),
        })),
        includeFailedRequests: include_failed_requests,
        excludeRampUp: exclude_ramp_up_time,
      });
      await this.manager.query('RELEASE SAVEPOINT sp_apdex_rollup');
    } catch (error) {
      try { await this.manager.query('ROLLBACK TO SAVEPOINT sp_apdex_rollup'); } catch { /* best-effort */ }
      this.logger.warn(`Bulk rollup Apdex failed, falling back to per-transaction raw scans: ${error}`);
    }

    // Evaluate each transaction
    const transactionResults: TransactionApdexResult[] = [];

    let allPass = true;
    let anyError = false;
    let totalSatisfied = 0;
    let totalTolerating = 0;
    let totalFrustrated = 0;
    let totalCount = 0;
    const failedTransactions: string[] = [];

    const record = (transactionName: string, scenarioName: string, resolvedThreshold: number, apdexResult: ApdexResult) => {
      const meetsReq = apdexResult.apdex_score !== null && apdexResult.apdex_score >= min_apdex_score;

      if (!meetsReq && apdexResult.total_count > 0) {
        allPass = false;
        failedTransactions.push(transactionName);
      }

      // Aggregate totals
      totalSatisfied += apdexResult.satisfied_count;
      totalTolerating += apdexResult.tolerating_count;
      totalFrustrated += apdexResult.frustrated_count;
      totalCount += apdexResult.total_count;

      transactionResults.push({
        transaction_name: transactionName,
        scenario_name: scenarioName,
        apdex_score: apdexResult.apdex_score,
        threshold_ms: resolvedThreshold,
        meets_requirement: apdexResult.total_count > 0 ? meetsReq : null,
        satisfied_count: apdexResult.satisfied_count,
        tolerating_count: apdexResult.tolerating_count,
        frustrated_count: apdexResult.frustrated_count,
        total_count: apdexResult.total_count,
        avg_response_time_ms: apdexResult.avg_response_time_ms,
      });
    };

    // SAVEPOINT isolation: if one transaction's query causes a fatal Postgres error
    // (e.g. bigint overflow from a NaN propagation bug), it aborts the current
    // transaction block and makes every subsequent query fail with "current
    // transaction is aborted". By wrapping each iteration in a SAVEPOINT we can
    // roll back to a clean state and continue evaluating the remaining transactions.
    // SAVEPOINT is a no-op if we are not inside an explicit transaction (the query
    // throws, which we catch and ignore so the loop continues without isolation).
    let savepointIdx = 0;
    for (const { transaction_name: transactionName, scenario_name: scenarioName } of transactionsWithScenarios) {
      const resolvedThreshold = resolveThreshold(transactionName);
      const hit = rollupHits.get(transactionName);
      if (hit) {
        record(transactionName, scenarioName, resolvedThreshold, hit);
        continue;
      }

      const sp = `sp_apdex_${savepointIdx++}`;
      let savepointActive = false;
      try {
        await this.manager.query(`SAVEPOINT ${sp}`);
        savepointActive = true;

        // The bulk rollup already missed this transaction; go straight to the raw scan.
        const apdexResult = await this.calculateApdexRaw({
          testRun,
          transactionName: transactionName,
          thresholdMs: resolvedThreshold,
          includeFailedRequests: include_failed_requests,
          excludeRampUp: exclude_ramp_up_time,
        });

        await this.manager.query(`RELEASE SAVEPOINT ${sp}`);
        savepointActive = false;

        record(transactionName, scenarioName, resolvedThreshold, apdexResult);
      } catch (error) {
        if (savepointActive) {
          // eslint-disable-next-line no-empty
          try { await this.manager.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch { /* intentionally swallowed — restoring savepoint is best-effort */ }
        }
        this.logger.error(`Error calculating Apdex for transaction ${transactionName}: ${error}`);
        anyError = true;
        transactionResults.push({
          transaction_name: transactionName,
          scenario_name: scenarioName,
          apdex_score: null,
          threshold_ms: apdex_threshold_ms || 500,
          meets_requirement: null,
          satisfied_count: 0,
          tolerating_count: 0,
          frustrated_count: 0,
          total_count: 0,
          avg_response_time_ms: null,
        });
      }
    }

    // Calculate overall Apdex score from aggregated counts
    const overallApdexScore = totalCount > 0
      ? Math.round(((totalSatisfied + totalTolerating * 0.5) / totalCount) * 1000) / 1000
      : null;

    // Determine overall status
    let status: 'COMPLETE' | 'ERROR' | 'NO_DATA' = 'COMPLETE';
    let message: string;

    if (anyError) {
      status = 'ERROR';
      message = 'Error calculating Apdex for some transactions';
    } else if (totalCount === 0) {
      status = 'NO_DATA';
      message = 'No request data found for any transaction';
    } else if (allPass) {
      message = `All ${transactionsWithScenarios.length} transactions meet minimum Apdex ${min_apdex_score}`;
    } else {
      message = `${failedTransactions.length} of ${transactionsWithScenarios.length} transactions below minimum Apdex ${min_apdex_score}: ${failedTransactions.slice(0, 3).join(', ')}${failedTransactions.length > 3 ? '...' : ''}`;
    }

    this.logger.info(
      `Workload-level Apdex SLO result: ${allPass ? 'PASS' : 'FAIL'} ` +
      `(${transactionsWithScenarios.length} transactions, ${failedTransactions.length} failed)`
    );

    return {
      benchmark_id: benchmarkId,
      test_run_id: testRun.test_run_id,
      meets_requirement: totalCount > 0 ? allPass : false,
      apdex_result: {
        transaction_name: null, // Workload-level
        satisfied_count: totalSatisfied,
        tolerating_count: totalTolerating,
        frustrated_count: totalFrustrated,
        total_count: totalCount,
        apdex_score: overallApdexScore,
        threshold_ms: apdex_threshold_ms || 500,
        avg_response_time_ms: null, // N/A for aggregate workload-level
      },
      requirement: { min_score: min_apdex_score, threshold_ms: apdex_threshold_ms || 500 },
      status,
      message,
      transaction_results: transactionResults,
    };
  }

  /**
   * Evaluate Apdex for a single transaction
   */
  private async evaluateSingleTransaction(
    testRun: TestRun,
    benchmark: ApdexBenchmark,
    transactionName: string
  ): Promise<ApdexCheckResult> {
    const {
      id: benchmarkId,
      system_under_test_id,
      test_environment,
      workload,
      apdex_threshold_ms,
      min_apdex_score,
      include_failed_requests,
      exclude_ramp_up_time,
    } = benchmark;

    try {
      // Resolve the threshold to use for this specific transaction
      // This allows transaction-specific threshold overrides via workload_transaction_apdex_thresholds
      const resolvedThreshold = await this.resolveThreshold({
        benchmarkThreshold: apdex_threshold_ms,
        systemUnderTestId: system_under_test_id,
        testEnvironment: test_environment,
        workload: workload,
        transactionName: transactionName,
        organizationId: testRun.organization_id,
      });

      // Calculate Apdex for this transaction
      const apdexResult = await this.calculateApdex({
        testRun,
        transactionName: transactionName,
        thresholdMs: resolvedThreshold,
        includeFailedRequests: include_failed_requests,
        excludeRampUp: exclude_ramp_up_time,
      });

      // No data available
      if (apdexResult.total_count === 0) {
        return {
          benchmark_id: benchmarkId,
          test_run_id: testRun.test_run_id,
          meets_requirement: false,
          apdex_result: apdexResult,
          requirement: { min_score: min_apdex_score, threshold_ms: resolvedThreshold },
          status: 'NO_DATA',
          message: `No request data found for transaction: ${transactionName}`,
        };
      }

      // Evaluate pass/fail
      const meetsRequirement = apdexResult.apdex_score !== null &&
        apdexResult.apdex_score >= min_apdex_score;

      return {
        benchmark_id: benchmarkId,
        test_run_id: testRun.test_run_id,
        meets_requirement: meetsRequirement,
        apdex_result: apdexResult,
        requirement: { min_score: min_apdex_score, threshold_ms: resolvedThreshold },
        status: 'COMPLETE',
        message: meetsRequirement
          ? `Apdex ${apdexResult.apdex_score!.toFixed(3)} meets minimum ${min_apdex_score} for ${transactionName}`
          : `Apdex ${apdexResult.apdex_score!.toFixed(3)} is below minimum ${min_apdex_score} for ${transactionName}`,
      };

    } catch (error) {
      this.logger.error(`Error calculating Apdex for benchmark ${benchmarkId}, transaction ${transactionName}: ${error}`);
      return {
        benchmark_id: benchmarkId,
        test_run_id: testRun.test_run_id,
        meets_requirement: null,
        apdex_result: {
          transaction_name: transactionName,
          satisfied_count: 0,
          tolerating_count: 0,
          frustrated_count: 0,
          total_count: 0,
          apdex_score: null,
          threshold_ms: apdex_threshold_ms || 500,
          avg_response_time_ms: null,
        },
        requirement: { min_score: min_apdex_score, threshold_ms: apdex_threshold_ms || 500 },
        status: 'ERROR',
        message: `Error calculating Apdex for ${transactionName}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get all available transactions for a test run.
   *
   * Reads `test_run_transaction_stats` (one row per `(test_run × transaction ×
   * scenario × ramp_up_excluded)` triple) instead of scanning the
   * `transactions` hypertable. The rollup is keyed by the same triple so a
   * `SELECT DISTINCT transaction_name … WHERE test_run_id = $1 AND
   * ramp_up_excluded = false` is an index-only scan on the existing PK
   * (`O(distinct transactions)` vs the legacy `O(hypertable chunk)` cost).
   * Filtering on `ramp_up_excluded = false` picks one of the two variants the
   * rollup pipeline always emits — the unconditional full-window row.
   *
   * Falls back to the raw `transactions` scan when the rollup is empty for
   * this `test_run_id` (rollup pipeline has not run yet, or the run predates
   * the rollup tables). Same shape #296 / #298 use for the Apdex fast path.
   */
  async getAvailableTransactions(testRunId: string): Promise<string[]> {
    const rollupResult = await this.manager.query(`
      SELECT DISTINCT transaction_name
      FROM test_run_transaction_stats
      WHERE test_run_id = $1
        AND ramp_up_excluded = false
        AND transaction_name IS NOT NULL
      ORDER BY transaction_name
    `, [testRunId]) as Array<{ transaction_name: string }>;

    if (rollupResult.length > 0) {
      return rollupResult.map((row) => row.transaction_name);
    }

    const legacyResult = await this.manager.query(`
      SELECT DISTINCT transaction_name
      FROM transactions
      WHERE test_run_id = $1
        AND transaction_name IS NOT NULL
      ORDER BY transaction_name
    `, [testRunId]) as Array<{ transaction_name: string }>;

    return legacyResult.map((row) => row.transaction_name);
  }

  /**
   * Get all available transactions with their scenario names for a test run.
   *
   * Same rollup-first / raw-scan fallback as `getAvailableTransactions`. This
   * is the hot path inside `evaluateWorkloadLevelApdex`, fired once per
   * workload-level Apdex SLO per test_run.
   *
   * The rollup stores `scenario_name` as `''` (empty string) when the source
   * was NULL — `COALESCE(NULLIF(scenario_name, ''), 'default')` preserves the
   * legacy caller contract (return `'default'` for the no-scenario case).
   */
  async getTransactionsWithScenarios(testRunId: string): Promise<Array<{ transaction_name: string; scenario_name: string }>> {
    const rollupResult = await this.manager.query(`
      SELECT DISTINCT
        transaction_name,
        COALESCE(NULLIF(scenario_name, ''), 'default') AS scenario_name
      FROM test_run_transaction_stats
      WHERE test_run_id = $1
        AND ramp_up_excluded = false
        AND transaction_name IS NOT NULL
      ORDER BY scenario_name, transaction_name
    `, [testRunId]) as Array<{ transaction_name: string; scenario_name: string }>;

    if (rollupResult.length > 0) {
      return rollupResult.map((row) => ({
        transaction_name: row.transaction_name,
        scenario_name: row.scenario_name,
      }));
    }

    const legacyResult = await this.manager.query(`
      SELECT DISTINCT transaction_name, COALESCE(scenario_name, 'default') as scenario_name
      FROM transactions
      WHERE test_run_id = $1
        AND transaction_name IS NOT NULL
      ORDER BY scenario_name, transaction_name
    `, [testRunId]) as Array<{ transaction_name: string; scenario_name: string }>;

    return legacyResult.map((row) => ({
      transaction_name: row.transaction_name,
      scenario_name: row.scenario_name,
    }));
  }

  /**
   * Preview Apdex calculation for a test run without storing results
   * Useful for UI to show what the Apdex would be before creating an SLO
   */
  async previewApdex(
    testRunId: string,
    transactionName: string | null,
    thresholdMs: number
  ): Promise<ApdexResult> {
    // Create a minimal test run for calculation
    const testRunResult = await this.manager.query(`
      SELECT test_run_id, system_under_test_id, test_environment, workload, start_time, end_time, ramp_up
      FROM test_runs
      WHERE test_run_id = $1
    `, [testRunId]);

    if (testRunResult.length === 0) {
      throw new Error(`Test run not found: ${testRunId}`);
    }

    const testRun: TestRun = {
      test_run_id: testRunResult[0].test_run_id,
      system_under_test_id: testRunResult[0].system_under_test_id,
      test_environment: testRunResult[0].test_environment,
      workload: testRunResult[0].workload,
      start_time: testRunResult[0].start_time,
      end_time: testRunResult[0].end_time,
      ramp_up: testRunResult[0].ramp_up,
    };

    return this.calculateApdex({
      testRun,
      transactionName,
      thresholdMs,
      includeFailedRequests: false,
      excludeRampUp: true,
    });
  }
}
