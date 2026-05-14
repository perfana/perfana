import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import { EntityManager } from 'typeorm';
import { BenchmarkMatcher, TestRun as TestRunInterface, Benchmark } from './checks/BenchmarkMatcher.js';
import { DataAggregator } from './checks/DataAggregator.js';
import { RequirementChecker, CheckResult as _CheckResult } from './checks/RequirementChecker.js';
import { ApdexCalculator, ApdexCheckResult } from './checks/ApdexCalculator.js';
import { CheckPipelineError, BenchmarkNotFoundError } from './checks/BaseCheckService.js';
import { getRealtimePublisher } from '../common/realtime-accessor.js';
import { TestRun } from '@perfana/shared';

export interface ChecksInput {
  testRunIds: string[];
  forceReprocess?: boolean;
  snapshotId?: string;
  grafanaInfo?: string;
  // Optional: Filter to specific metric for re-evaluation
  metricsSourceId?: string;
  applicationDashboardId?: string;
  panelId?: number;
  metricName?: string;
}

export interface ChecksPipelineResult {
  processed_test_runs: number;
  processed_benchmarks: number;
  created_check_results: number;
  failed_test_runs: Array<{ test_run_id: string; error: string }>;
  execution_time_seconds: number;
}

/**
 * Main pipeline orchestrator for the check pipeline
 * Based on pipeline.py:79-434 (excluding compare_results logic)
 */
export class ChecksPipeline extends BasePipelineTypeORM {

  validateInput(input: unknown): boolean {
    if (!input || typeof input !== 'object') {return false;}
    const typedInput = input as { testRunIds?: unknown[] };
    return Array.isArray(typedInput.testRunIds) &&
           typedInput.testRunIds.length > 0 &&
           typedInput.testRunIds.every((id: unknown) => typeof id === 'string');
  }

  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();

    try {
      // Validate input
      if (!this.validateInput(input)) {
        throw new Error('Invalid input: expected { testRunIds: string[] }');
      }
      const validatedInput = input as ChecksInput;

      const { testRunIds, forceReprocess = false, snapshotId, grafanaInfo, metricsSourceId, applicationDashboardId, panelId, metricName } = validatedInput;

      if (metricsSourceId || applicationDashboardId || panelId || metricName) {
        this.logger.info(`Starting check pipeline for ${testRunIds.length} test runs with metric filter: metricsSource=${metricsSourceId}, dashboard=${applicationDashboardId}, panel=${panelId}, metric=${metricName}`);
      } else {
        this.logger.info(`Starting check pipeline for ${testRunIds.length} test runs`);
      }

      // Cleanup stale data before processing
      await this.cleanupStaleApplicationDashboards(['check_results']);

      const result = await this.runCheckPipeline(testRunIds, forceReprocess, snapshotId, grafanaInfo, { metricsSourceId, applicationDashboardId, panelId, metricName });

      const duration = Date.now() - startTime;

      this.logger.info(
        `✅ Check pipeline completed successfully in ${(duration / 1000).toFixed(2)}s ` +
        `(${result.processed_test_runs} test runs, ${result.created_check_results} check results)`
      );

      return this.createSuccessResult(result, duration);

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Check pipeline failed after ${(duration / 1000).toFixed(2)}s: ${error}`);
      this.logError(error as Error, { input });
      return this.createErrorResult(
        error as Error,
        'CHECKS_PIPELINE_FAILED',
        { input }
      );
    }
  }

  /**
   * Run the complete check pipeline for given test run IDs
   * Based on pipeline.py:79-201
   */
  private async runCheckPipeline(
    testRunIds: string[],
    _forceReprocess = false,
    snapshotId?: string,
    grafanaInfo?: string,
    metricFilter?: {
      metricsSourceId?: string;
      applicationDashboardId?: string;
      panelId?: number;
      metricName?: string;
    }
  ): Promise<ChecksPipelineResult> {
    const startTime = Date.now();

    const results: ChecksPipelineResult = {
      processed_test_runs: 0,
      processed_benchmarks: 0,
      created_check_results: 0,
      failed_test_runs: [],
      execution_time_seconds: 0
    };

    try {
      // Process each test run in its own transaction (connection held only for writes)
      for (const testRunId of testRunIds) {
        try {
          // Set status to IN_PROGRESS in a separate transaction BEFORE the main work
          // This ensures the frontend sees the status update immediately
          await this.withTransaction(async (manager: EntityManager) => {
            const now = new Date();
            this.logger.info(`About to update test run status to IN_PROGRESS for ${testRunId}`);
            try {
              await this.updateTestRunStatus(manager, testRunId, {
                evaluatingChecks: 'IN_PROGRESS',
                lastUpdate: now.toISOString()
              });
              this.logger.info(`Successfully updated test run status to IN_PROGRESS for ${testRunId}`);

              // Publish realtime update
              await this.publishRealtimeUpdate(manager, testRunId);
            } catch (error) {
              this.logger.error(`Failed to update test run status to IN_PROGRESS for ${testRunId}: ${error}`);
              throw error;
            }
          });

          // Main transaction for processing the work
          await this.withTransaction(async (manager: EntityManager) => {
            // Initialize services with this transaction's manager
            // Note: These services still use PoolClient internally, but EntityManager is compatible for query operations
            const benchmarkMatcher = new BenchmarkMatcher(this.logger, manager as any);
            const dataAggregator = new DataAggregator(this.logger, manager as any);
            const requirementChecker = new RequirementChecker(this.logger, manager as any);
            const apdexCalculator = new ApdexCalculator(this.logger, manager as any);

            // Load test run
            const testRunData = await this.loadTestRunForChecks(manager, testRunId);
            if (!testRunData) {
              this.logger.error(`Test run ${testRunId} not found`);
              results.failed_test_runs.push({
                test_run_id: testRunId,
                error: 'Test run not found'
              });
              return;
            }

            // Always delete existing check results to prevent duplicates
            await this.deleteExistingCheckResults(manager, testRunId, metricFilter);
            this.logger.info(`Deleted existing check results for ${testRunId}`);

            // Process single test run
            this.logger.info(`Starting process_single_test_run for ${testRunId}`);
            const testRunResults = await this.processSingleTestRun(
              testRunData,
              benchmarkMatcher,
              dataAggregator,
              requirementChecker,
              apdexCalculator,
              manager,
              snapshotId,
              grafanaInfo,
              metricFilter
            );
            this.logger.info(`Completed process_single_test_run for ${testRunId}`);

            results.processed_test_runs += 1;
            results.processed_benchmarks += testRunResults.processed_benchmarks;
            results.created_check_results += testRunResults.created_check_results;
          });

        } catch (error) {
          this.logger.error(`Failed to process test run ${testRunId}: ${error}`);
          results.failed_test_runs.push({
            test_run_id: testRunId,
            error: String(error)
          });
        }
      }

      results.execution_time_seconds = (Date.now() - startTime) / 1000;
      this.logger.info(
        `Check pipeline completed in ${results.execution_time_seconds.toFixed(2)}s. ` +
        `Processed ${results.processed_test_runs} test runs, ` +
        `created ${results.created_check_results} check results`
      );

      return results;

    } catch (error) {
      results.execution_time_seconds = (Date.now() - startTime) / 1000;
      throw new CheckPipelineError(`Check pipeline failed: ${error}`);
    }
  }

  /**
   * Process a single test run through the complete pipeline
   * Based on pipeline.py:203-434 (excluding compare_results logic)
   */
  private async processSingleTestRun(
    testRun: TestRunInterface,
    benchmarkMatcher: BenchmarkMatcher,
    dataAggregator: DataAggregator,
    requirementChecker: RequirementChecker,
    apdexCalculator: ApdexCalculator,
    manager: EntityManager,
    snapshotId?: string,
    grafanaInfo?: string,
    metricFilter?: {
      metricsSourceId?: string;
      applicationDashboardId?: string;
      panelId?: number;
      metricName?: string;
    }
  ): Promise<{ processed_benchmarks: number; created_check_results: number; failed_benchmarks: unknown[] }> {
    const startTime = Date.now();
    this.logger.info(`Processing test run ${testRun.test_run_id}`);

    const results = {
      processed_benchmarks: 0,
      created_check_results: 0,
      failed_benchmarks: []
    };

    // Note: Status is set to IN_PROGRESS before this method is called (outside transaction)
    try {
      // Find matching benchmarks
      const benchmarks = await benchmarkMatcher.findMatchingBenchmarks(testRun, metricFilter);
      this.logger.info(`Found ${benchmarks.length} matching benchmarks`);

      // If no benchmarks with requirement, set status to NOT_CONFIGURED
      if (benchmarks.length === 0) {
        await this.updateTestRunStatus(manager, testRun.test_run_id, {
          evaluatingChecks: 'NOT_CONFIGURED',
          lastUpdate: new Date().toISOString()
        });

        // Publish realtime update
        await this.publishRealtimeUpdate(manager, testRun.test_run_id);

        return results;
      }

      const checkResults = [];

      // Process each benchmark inside a savepoint so a single DB-level failure
      // (e.g. FK violation, constraint error) doesn't abort the entire transaction
      // and cascade-fail all remaining benchmarks.
      for (let i = 0; i < benchmarks.length; i++) {
        const benchmark = benchmarks[i];
        const sp = `sp_benchmark_${i}`;
        try {
          await manager.query(`SAVEPOINT ${sp}`);

          // Handle Apdex benchmarks separately
          if (benchmark.benchmark_type === 'apdex') {
            this.logger.info(`Processing Apdex benchmark ${benchmark.id} for transaction: ${benchmark.transaction_name || 'ALL (workload-level)'}`);

            // Evaluate Apdex benchmark
            const apdexResult = await apdexCalculator.evaluateApdexBenchmark(testRun, {
              id: benchmark.id,
              system_under_test_id: benchmark.system_under_test_id,
              test_environment: benchmark.test_environment,
              workload: benchmark.workload,
              benchmark_type: 'apdex',
              transaction_name: benchmark.transaction_name || null,
              apdex_threshold_ms: benchmark.apdex_threshold_ms || null,
              min_apdex_score: benchmark.min_apdex_score!,
              include_failed_requests: benchmark.include_failed_requests,
              exclude_ramp_up_time: benchmark.exclude_ramp_up_time,
            });

            results.processed_benchmarks += 1;

            // Save Apdex check result (includes per-transaction breakdown in targets for workload-level SLOs)
            await this.saveApdexCheckResult(manager, testRun, benchmark, apdexResult);
            checkResults.push({
              status: apdexResult.status,
              meets_requirement: apdexResult.meets_requirement,
            } as any);
            results.created_check_results += 1;

            this.logger.info(
              `Created Apdex check result for benchmark ${benchmark.id}: ` +
              `score=${apdexResult.apdex_result.apdex_score?.toFixed(3) || 'N/A'}, ` +
              `meets_requirement=${apdexResult.meets_requirement}` +
              (apdexResult.transaction_results ? ` (${apdexResult.transaction_results.length} transactions)` : '')
            );
          } else {
            // Handle metric benchmarks (existing logic)
            // Aggregate metrics data
            const aggregationResult = await dataAggregator.aggregateMetricsForBenchmark(
              testRun,
              benchmark,
              metricFilter?.metricName
            );

            // Create check result
            this.logger.info(`Calling requirement_checker.createCheckResult for benchmark ${benchmark.id}`);
            const checkResult = await requirementChecker.createCheckResult(
              testRun,
              benchmark,
              aggregationResult,
              grafanaInfo,
              snapshotId
            );
            this.logger.info(`requirement_checker.createCheckResult returned: ${checkResult ? 'CheckResult' : 'null'} for benchmark ${benchmark.id}`);

            // Always count processed benchmarks
            results.processed_benchmarks += 1;

            if (checkResult !== null) {
              // Save to database
              this.logger.debug(`About to save check_result for benchmark ${benchmark.id}`);
              await requirementChecker.saveCheckResult(checkResult);
              checkResults.push(checkResult);
              results.created_check_results += 1;
              this.logger.debug(
                `Created check result for benchmark ${benchmark.id} ` +
                `(status: ${checkResult.status})`
              );
            } else {
              this.logger.warn(`No check result created for benchmark ${benchmark.id} despite processing - likely no valid requirement config`);
            }
          }

          await manager.query(`RELEASE SAVEPOINT ${sp}`);
        } catch (error) {
          // Roll back this benchmark's savepoint to keep the transaction usable
          try {
            await manager.query(`ROLLBACK TO SAVEPOINT ${sp}`);
            await manager.query(`RELEASE SAVEPOINT ${sp}`);
          } catch { /* ignore savepoint cleanup errors */ }

          this.logger.error(`Failed to process benchmark ${benchmark.id}: ${error}`);
          (results.failed_benchmarks as Array<{benchmarkId: string; error: string}>).push({
            benchmarkId: benchmark.id,
            error: String(error)
          });
        }
      }

      // --- STATUS: ERROR if any benchmark failed technically or any check result has ERROR status ---
      const hasCheckError = checkResults.some(cr => cr.status === 'ERROR');
      const hasBenchmarkFailure = results.failed_benchmarks.length > 0;
      const hasError = hasCheckError || hasBenchmarkFailure;

      await this.updateTestRunStatus(manager, testRun.test_run_id, {
        evaluatingChecks: hasError ? 'ERROR' : 'COMPLETED',
        lastUpdate: new Date().toISOString()
      });

      // Publish realtime update
      await this.publishRealtimeUpdate(manager, testRun.test_run_id);

      // --- SET VALID=FALSE IF ANY STATUS IS ERROR, OTHERWISE SET VALID=TRUE ---
      if (hasError) {
        const reason = hasBenchmarkFailure
          ? `${results.failed_benchmarks.length}/${benchmarks.length} benchmarks failed to process`
          : 'evaluatingChecks has ERROR status';
        await this.markTestRunInvalid(manager, testRun.test_run_id, reason);
      } else {
        await this.markTestRunValid(manager, testRun.test_run_id);
      }

      // --- CONSOLIDATED RESULT AGGREGATION ---
      await this.updateConsolidatedResult(manager, testRun.test_run_id, hasBenchmarkFailure);

      // --- SET ADAPT DIFFERENCES ACCEPTED TO TBD ---

      const duration = Date.now() - startTime;
      this.logger.info(
        `✅ Completed test run ${testRun.test_run_id} in ${duration}ms ` +
        `(${results.processed_benchmarks} benchmarks, ${results.created_check_results} check results)`
      );

      return results;

    } catch (error) {
      if (error instanceof BenchmarkNotFoundError) {
        this.logger.warn(`No benchmarks found for test run ${testRun.test_run_id}: ${error}`);
        await this.updateTestRunStatus(manager, testRun.test_run_id, {
          evaluatingChecks: 'NOT_CONFIGURED',
          lastUpdate: new Date().toISOString()
        });

        // Publish realtime update
        await this.publishRealtimeUpdate(manager, testRun.test_run_id);

        return results;
      }

      await this.updateTestRunStatus(manager, testRun.test_run_id, {
        evaluatingChecks: 'ERROR',
        lastUpdate: new Date().toISOString()
      });

      // Publish realtime update
      await this.publishRealtimeUpdate(manager, testRun.test_run_id);

      throw new CheckPipelineError(`Failed to process test run ${testRun.test_run_id}: ${error}`);
    }
  }

  /**
   * Load test run data for checks processing
   */
  private async loadTestRunForChecks(manager: EntityManager, testRunId: string): Promise<TestRunInterface | null> {
    const sql = `
      SELECT
        test_run_id,
        system_under_test_id,
        test_environment,
        workload,
        organization_id,
        start_time,
        end_time,
        ramp_up
      FROM test_runs
      WHERE test_run_id = $1
    `;

    const result = await manager.query(sql, [testRunId]);
    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    const testRun = {
      test_run_id: row.test_run_id,
      system_under_test_id: row.system_under_test_id,
      test_environment: row.test_environment,
      workload: row.workload,
      organization_id: row.organization_id,
      start_time: row.start_time,
      end_time: row.end_time,
      ramp_up: row.ramp_up
    };

    return testRun;
  }

  /**
   * Delete existing check results for force reprocessing
   */
  private async deleteExistingCheckResults(
    manager: EntityManager,
    testRunId: string,
    metricFilter?: {
      metricsSourceId?: string;
      applicationDashboardId?: string;
      panelId?: number;
      metricName?: string;
    }
  ): Promise<void> {
    const whereClauses = ['test_run_id = $1'];
    const queryParams: unknown[] = [testRunId];

    // Add filter conditions if provided — prefer metricsSourceId over applicationDashboardId
    if (metricFilter?.metricsSourceId) {
      whereClauses.push(`metrics_source_id = $${queryParams.length + 1}`);
      queryParams.push(metricFilter.metricsSourceId);
    } else if (metricFilter?.applicationDashboardId) {
      whereClauses.push(`application_dashboard_id = $${queryParams.length + 1}`);
      queryParams.push(metricFilter.applicationDashboardId); // UUID as string
    }
    if (metricFilter?.panelId !== undefined) {
      whereClauses.push(`panel_id = $${queryParams.length + 1}`);
      queryParams.push(metricFilter.panelId);
    }

    const sql = `DELETE FROM check_results WHERE ${whereClauses.join(' AND ')}`;
    await manager.query(sql, queryParams);
  }

  /**
   * Update test run status using dotted notation for JSONB
   * Based on pipeline.py:36-76
   */
  private async updateTestRunStatus(
    manager: EntityManager,
    testRunId: string,
    statusUpdates: Record<string, unknown>
  ): Promise<void> {
    // Build a single JSONB update by chaining jsonb_set operations
    const values: unknown[] = [testRunId];
    let statusExpression = 'COALESCE(status, \'{}\'::jsonb)';
    let paramIndex = 2;

    for (const [key, value] of Object.entries(statusUpdates)) {
      const path = `{${key}}`;
      statusExpression = `jsonb_set(${statusExpression}, '${path}', $${paramIndex}::jsonb)`;
      values.push(JSON.stringify(value));
      paramIndex++;
    }

    const updateQuery = `
      UPDATE test_runs
      SET status = ${statusExpression}, updated_at = NOW()
      WHERE test_run_id = $1
    `;

    await manager.query(updateQuery, values);
  }

  /**
   * Update consolidated result (simplified without compare_results)
   * Based on pipeline.py:352-413
   *
   * If hasBenchmarkFailure is true, some benchmarks failed to process (technical error).
   * In that case the consolidated result cannot be trusted — we set overall to false
   * and flag it with an error so it's not reported as a false positive.
   */
  private async updateConsolidatedResult(
    manager: EntityManager,
    testRunId: string,
    hasBenchmarkFailure = false
  ): Promise<void> {
    if (hasBenchmarkFailure) {
      // Some benchmarks failed technically — consolidated result is incomplete
      const sql = `
        UPDATE test_runs
        SET consolidated_result = jsonb_build_object(
          'meetsRequirement', false,
          'overall', false,
          'error', 'Some benchmarks failed to process'
        ),
        updated_at = NOW()
        WHERE test_run_id = $1
      `;
      await manager.query(sql, [testRunId]);
      return;
    }

    const sql = `
      WITH check_results_summary AS (
        SELECT
          test_run_id,
          bool_and(COALESCE(meets_requirement, true)) as all_meet_requirements
        FROM check_results
        WHERE test_run_id = $1
        GROUP BY test_run_id
      )
      UPDATE test_runs
      SET consolidated_result = jsonb_build_object(
        'meetsRequirement', COALESCE(crs.all_meet_requirements, true),
        'overall', COALESCE(crs.all_meet_requirements, true)
      ),
      updated_at = NOW()
      FROM check_results_summary crs
      WHERE test_runs.test_run_id = $1
    `;

    await manager.query(sql, [testRunId]);
  }

  /**
   * Set adapt_config.differencesAccepted to "TBD" if:
   * - consolidated_result.meetsRequirement is true
   * - adapt_config.mode is not "BASELINE"
   */
  /**
   * Mark test run as invalid when any pipeline status has ERROR
   */
  private async markTestRunInvalid(manager: EntityManager, testRunId: string, reason: string): Promise<void> {
    const sql = `
      UPDATE test_runs
      SET valid = false,
          updated_at = NOW()
      WHERE test_run_id = $1
    `;

    await manager.query(sql, [testRunId]);
    this.logger.warn(`Marked test run ${testRunId} as invalid: ${reason}`);
  }

  /**
   * Mark test run as valid when checks complete successfully
   */
  private async markTestRunValid(manager: EntityManager, testRunId: string): Promise<void> {
    const sql = `
      UPDATE test_runs
      SET valid = true,
          updated_at = NOW()
      WHERE test_run_id = $1
    `;

    await manager.query(sql, [testRunId]);
    this.logger.info(`Marked test run ${testRunId} as valid (checks completed successfully)`);
  }

  /**
   * Save an Apdex check result to the database
   * Adapts ApdexCheckResult to fit the check_results table schema
   */
  private async saveApdexCheckResult(
    manager: EntityManager,
    testRun: TestRunInterface,
    benchmark: Benchmark,
    apdexResult: ApdexCheckResult
  ): Promise<void> {
    // For workload-level SLOs, store per-transaction breakdown in targets
    // For transaction-specific SLOs, store single transaction result
    let targets: unknown[];

    if (apdexResult.transaction_results && apdexResult.transaction_results.length > 0) {
      // Workload-level SLO: store each transaction as a target
      targets = apdexResult.transaction_results.map(tr => ({
        target: tr.transaction_name,
        scenario_name: tr.scenario_name,
        value: tr.apdex_score,
        meets_requirement: tr.meets_requirement,
        is_artificial: false,
        threshold_ms: tr.threshold_ms,
        satisfied_count: tr.satisfied_count,
        tolerating_count: tr.tolerating_count,
        frustrated_count: tr.frustrated_count,
        total_count: tr.total_count,
        avg_response_time_ms: tr.avg_response_time_ms,
      }));
    } else {
      // Transaction-specific SLO: single target entry
      targets = [{
        target: apdexResult.apdex_result.transaction_name || 'workload',
        value: apdexResult.apdex_result.apdex_score,
        meets_requirement: apdexResult.meets_requirement,
        is_artificial: false,
        threshold_ms: apdexResult.requirement.threshold_ms,
        satisfied_count: apdexResult.apdex_result.satisfied_count,
        tolerating_count: apdexResult.apdex_result.tolerating_count,
        frustrated_count: apdexResult.apdex_result.frustrated_count,
        total_count: apdexResult.apdex_result.total_count,
        avg_response_time_ms: apdexResult.apdex_result.avg_response_time_ms,
      }];
    }

    const insertSql = `
      INSERT INTO check_results (
        system_under_test_id, test_environment, workload, test_run_id,
        dashboard_label, dashboard_uid, application_dashboard_id, panel_title, panel_id, panel_type,
        panel_y_axes_format, metric_name, metric_unit, benchmark_id, status, message,
        average_all, evaluate_type, exclude_ramp_up_time, ramp_up,
        match_pattern, requirement, panel_average, meets_requirement,
        targets, validate_with_default_if_no_data, validate_with_default_if_no_data_value,
        tags, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, NOW(), NOW()
      )
    `;

    await manager.query(insertSql, [
      testRun.system_under_test_id,
      testRun.test_environment,
      testRun.workload,
      testRun.test_run_id,
      'Apdex SLO',                              // dashboard_label - identifier for Apdex results
      null,                                      // dashboard_uid - not applicable for Apdex
      null,                                      // application_dashboard_id - not applicable
      benchmark.transaction_name || 'Workload Apdex', // panel_title - transaction name or workload
      null,                                      // panel_id - not applicable for Apdex
      'apdex',                                   // panel_type - identifies as Apdex check
      null,                                      // panel_y_axes_format
      null,                                      // metric_name
      'apdex_score',                             // metric_unit
      benchmark.id,                              // benchmark_id
      apdexResult.status,                        // status (COMPLETE, ERROR, NO_DATA)
      apdexResult.message,                       // message
      false,                                     // average_all - not applicable for Apdex
      'apdex',                                   // evaluate_type
      benchmark.exclude_ramp_up_time,            // exclude_ramp_up_time
      testRun.ramp_up || 0,                      // ramp_up
      null,                                      // match_pattern
      JSON.stringify({
        type: 'apdex',
        min_score: apdexResult.requirement.min_score,
        threshold_ms: apdexResult.requirement.threshold_ms,
        include_failed_requests: benchmark.include_failed_requests,
      }),                                        // requirement (JSONB)
      apdexResult.apdex_result.apdex_score,      // panel_average - stores the Apdex score
      apdexResult.meets_requirement,             // meets_requirement
      JSON.stringify(targets),                   // targets (JSONB with Apdex breakdown)
      false,                                     // validate_with_default_if_no_data
      0,                                         // validate_with_default_if_no_data_value
      [],                                        // tags
    ]);

    this.logger.debug(
      `Saved Apdex check result for benchmark ${benchmark.id}: ` +
      `score=${apdexResult.apdex_result.apdex_score?.toFixed(3) || 'N/A'}, ` +
      `meets_requirement=${apdexResult.meets_requirement}`
    );
  }

  /**
   * Publish realtime update for a single test run after status change
   * This is called after each status update to provide real-time feedback
   */
  private async publishRealtimeUpdate(manager: EntityManager, testRunId: string): Promise<void> {
    try {
      const realtime = getRealtimePublisher();

      // IMPORTANT: Query within the transaction to get the FRESH data, not cached!
      // Note: We don't need to load relations for real-time updates, just the core fields
      const testRun = await manager.findOne(TestRun, {
        where: { testRunId: testRunId }
      });

      if (testRun) {
        this.logger.debug(`Publishing realtime update for ${testRunId} with status: ${JSON.stringify(testRun.status)}`);
        await realtime.triggerTestRunUpdated(testRun);
        this.logger.debug(`Published realtime update for test run: ${testRunId}`);
      } else {
        this.logger.warn(`Test run not found for realtime update: ${testRunId}`);
      }
    } catch (error) {
      // Non-blocking: log warning but don't throw
      this.logger.error({ err: error }, `Failed to publish realtime update for ${testRunId}`);
    }
  }
}