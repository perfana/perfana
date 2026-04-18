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
export interface TransactionApdexResult {
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
   * Calculate Apdex score for a specific transaction or entire workload
   */
  async calculateApdex(params: {
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
    const { benchmarkThreshold, systemUnderTestId, testEnvironment, workload, transactionName, organizationId } = params;

    // 1. Transaction-specific threshold takes highest priority
    if (transactionName) {
      // Query supports both UUID and name format for system_under_test_id
      // RBAC: Filter by organization (backward compatible with NULL)
      let txQuery = `
        SELECT wtat.apdex_threshold
        FROM workload_transaction_apdex_thresholds wtat
        LEFT JOIN systems_under_test sut ON sut.name = wtat.system_under_test_id
        WHERE (wtat.system_under_test_id = $1 OR sut.id = $1::uuid)
          AND wtat.test_environment = $2
          AND wtat.workload = $3
          AND wtat.transaction_name = $4
      `;
      const txParams: unknown[] = [systemUnderTestId, testEnvironment, workload, transactionName];

      if (organizationId) {
        txQuery += `          AND (wtat.organization_id = $5 OR wtat.organization_id IS NULL)\n`;
        txParams.push(organizationId);
      }

      const transactionThreshold = await this.manager.query(txQuery, txParams);

      if (transactionThreshold.length > 0 && transactionThreshold[0].apdex_threshold) {
        this.logger.debug(`Using transaction-specific threshold: ${transactionThreshold[0].apdex_threshold}ms`);
        return transactionThreshold[0].apdex_threshold;
      }
    }

    // 2. Explicit threshold on benchmark
    if (benchmarkThreshold !== null && benchmarkThreshold !== undefined) {
      this.logger.debug(`Using explicit benchmark threshold: ${benchmarkThreshold}ms`);
      return benchmarkThreshold;
    }

    // 3. Workload-level threshold
    // Query supports both UUID and name format for system_under_test_id
    // RBAC: Filter by organization (backward compatible with NULL)
    let wlQuery = `
      SELECT wat.apdex_threshold
      FROM workload_apdex_thresholds wat
      LEFT JOIN systems_under_test sut ON sut.name = wat.system_under_test_id
      WHERE (wat.system_under_test_id = $1 OR sut.id = $1::uuid)
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
      this.logger.debug(`Using workload-level threshold: ${workloadThreshold[0].apdex_threshold}ms`);
      return workloadThreshold[0].apdex_threshold;
    }

    // 4. System default
    this.logger.debug('Using default threshold: 500ms');
    return 500;
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
        meets_requirement: null,
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

    // Evaluate each transaction
    const transactionResults: TransactionApdexResult[] = [];

    let allPass = true;
    let anyError = false;
    let totalSatisfied = 0;
    let totalTolerating = 0;
    let totalFrustrated = 0;
    let totalCount = 0;
    const failedTransactions: string[] = [];

    for (const { transaction_name: transactionName, scenario_name: scenarioName } of transactionsWithScenarios) {
      try {
        // Resolve threshold for this specific transaction (allows per-transaction overrides)
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

      } catch (error) {
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
      meets_requirement: totalCount > 0 ? allPass : null,
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
          meets_requirement: null,
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
   * Get all available transactions for a test run with their scenario names
   * Useful for UI to show available transactions for Apdex SLO configuration
   */
  async getAvailableTransactions(testRunId: string): Promise<string[]> {
    const result = await this.manager.query(`
      SELECT DISTINCT transaction_name
      FROM transactions
      WHERE test_run_id = $1
        AND transaction_name IS NOT NULL
      ORDER BY transaction_name
    `, [testRunId]);

    return result.map((row: unknown) => row.transaction_name);
  }

  /**
   * Get all available transactions with their scenario names for a test run
   */
  async getTransactionsWithScenarios(testRunId: string): Promise<Array<{ transaction_name: string; scenario_name: string }>> {
    const result = await this.manager.query(`
      SELECT DISTINCT transaction_name, COALESCE(scenario_name, 'default') as scenario_name
      FROM transactions
      WHERE test_run_id = $1
        AND transaction_name IS NOT NULL
      ORDER BY scenario_name, transaction_name
    `, [testRunId]);

    return result.map((row: unknown) => ({
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
