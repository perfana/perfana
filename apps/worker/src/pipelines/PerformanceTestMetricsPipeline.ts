/**
 * Performance Test Metrics Pipeline (REFACTORED)
 *
 * NEW ARCHITECTURE:
 * - One dashboard per scenario (deterministic UUIDs)
 * - One panel per transaction within each dashboard (hash-based panel IDs)
 * - Special "scenario-level" panel for scenario-wide metrics
 * - Simplified metric names (scenario/transaction names removed from metric_name)
 *
 * Extracts aggregated metrics from performance test tables (requests_raw, transactions,
 * requests_error, virtual_users) and stores them as time-series data in ds_metrics format.
 *
 * Key Features:
 * - Time-series bucketing with dynamic bucket sizes based on test duration
 * - Calculates Apdex scores based on configured thresholds
 * - Creates ds_metrics records with scenario-specific dashboard IDs
 * - Auto-creates ds_compare_config records with proper classifications
 *
 * Note: Ramp-up filtering is handled upstream in the data ingestion pipeline
 */

import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import type { Logger } from 'pino';
import {
  PerformanceTestMetricsInput,
  PerformanceTestMetricsOutput,
  TestRunMetadata,
  ApdexThresholdLookup,
  DsMetricsRecord,
  DsCompareConfigRecord,
} from '../types/performance-metrics.js';
import { DEFAULT_APDEX_THRESHOLD_MS } from '../constants/performance-metrics.js';
import { calculateBucketSize, FULL_COLLECTION_TARGET_DATA_POINTS } from '../utils/time-bucketing.js';
import { DashboardManager } from './helpers/dashboard-manager.js';
import { RequestsProcessor } from './helpers/requests-processor.js';
import { upsertPerfTestStatistics } from './helpers/perf-metrics-writer.js';
import { TransactionsProcessor } from './helpers/transactions-processor.js';
import { ErrorsProcessor, VirtualUsersProcessor } from './helpers/scenario-processors.js';

/**
 * Performance Test Metrics Pipeline
 */
export class PerformanceTestMetricsPipeline extends BasePipelineTypeORM {
  private dashboardManager!: DashboardManager;
  private requestsProcessor!: RequestsProcessor;
  private transactionsProcessor!: TransactionsProcessor;
  private errorsProcessor!: ErrorsProcessor;
  private virtualUsersProcessor!: VirtualUsersProcessor;

  constructor(logger: Logger) {
    super(logger);
  }

  /**
   * Execute the performance test metrics pipeline
   */
  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();

    try {
      // Validate input
      const validatedInput = this.validateAndParseInput(input);
      const { testRunId, fromTime, toTime } = validatedInput;

      const isIncremental = fromTime !== undefined || toTime !== undefined;
      this.logger.info(
        `🎯 Starting performance test metrics collection for test run: ${testRunId}${isIncremental ? ' (incremental)' : ''}`
      );

      // Initialize processors with dataSource
      this.initializeProcessors();

      // Load test run metadata
      const originalTestRun = await this.loadTestRunMetadata(testRunId);

      // For incremental collection, set filter times while keeping original start_time for bucket alignment
      const testRun: TestRunMetadata = {
        ...originalTestRun,
        // Keep original start_time for consistent bucket alignment across increments
        // Use filter times for WHERE clause filtering
        filter_from_time: fromTime,
        filter_to_time: toTime,
      };

      if (isIncremental) {
        this.logger.info(
          `📅 Filter time range: ${fromTime!.toISOString()} to ${toTime!.toISOString()} (bucket origin: ${originalTestRun.start_time.toISOString()})`
        );
      }

      // Calculate bucket size from the window actually being aggregated, not from the
      // incremental flag. A live tick's window is ~60s and still resolves to 1s buckets,
      // but a force-refetch reevaluate calls this "incrementally" with the run's FULL
      // range (see simple-orchestrate-reevaluate-batch.ts): a fixed 1s bucket over a 3h
      // run is 30x the rows the full path writes (1.8M buckets x 9 panels = 16M records
      // materialised in JS), which is a worker OOM rather than a slow job.
      const effectiveEndTime = testRun.filter_to_time ?? testRun.end_time;
      const elapsedTimeSeconds = effectiveEndTime
        ? (effectiveEndTime.getTime() - testRun.start_time.getTime()) / 1000
        : 3600; // Default to 1 hour if no end time
      const windowSeconds =
        fromTime && effectiveEndTime
          ? Math.max(1, (effectiveEndTime.getTime() - fromTime.getTime()) / 1000)
          : elapsedTimeSeconds;

      const bucketSizeSeconds = calculateBucketSize(windowSeconds, FULL_COLLECTION_TARGET_DATA_POINTS);
      const estimatedBuckets = Math.ceil(windowSeconds / bucketSizeSeconds);

      this.logger.info(
        `📊 Using ${bucketSizeSeconds}s buckets for a ${windowSeconds.toFixed(0)}s window (estimated ${estimatedBuckets} buckets${isIncremental ? ', incremental' : ''})`
      );

      // Load Apdex thresholds
      const apdexThresholds = await this.loadApdexThresholds(
        testRun.system_under_test_id,
        testRun.test_environment,
        testRun.workload,
        testRun.organization_id || undefined
      );

      // Initialize counters
      let metricsCreated = 0;
      let compareConfigsCreated = 0;
      const breakdown = {
        responseTimeMetrics: 0,
        transactionMetrics: 0,
        errorMetrics: 0,
        virtualUserMetrics: 0,
        apdexScores: 0,
      };

      // Only the errors and virtual-user processors still build records in JS: they emit
      // a handful of points per scenario. The requests and transactions processors write
      // their millions of (bucket x panel) rows with INSERT ... SELECT and never return
      // them — materialising those is what exhausted the heap.
      const allMetrics: DsMetricsRecord[] = [];
      const allCompareConfigs: DsCompareConfigRecord[] = [];
      const stepTiming: Array<{ step: string; duration: number; count: number }> = [];

      // Full collection replaces the run's metrics wholesale. The DELETE has to happen
      // before the processors, not inside saveDsMetrics, because they now insert as they
      // aggregate — a later DELETE would take their rows with it.
      if (!isIncremental) {
        const deleteStart = Date.now();
        await this.db.dataSource.query(
          `DELETE FROM ds_metrics WHERE test_run_id = $1`,
          [testRunId]
        );
        this.logger.info(`🧹 Deleted existing ds_metrics for ${testRunId} in ${Date.now() - deleteStart}ms`);
      }

      // Process requests_raw table
      let stepStart = Date.now();
      const requestsResult = await this.requestsProcessor.process(
        testRunId,
        testRun,
        apdexThresholds,
        bucketSizeSeconds,
        isIncremental
      );
      for (let i = 0; i < requestsResult.compareConfigs.length; i++) {
        allCompareConfigs.push(requestsResult.compareConfigs[i]);
      }
      breakdown.responseTimeMetrics += requestsResult.rowsInserted;
      metricsCreated += requestsResult.rowsInserted;
      stepTiming.push({
        step: 'requests-processor',
        duration: Date.now() - stepStart,
        count: requestsResult.rowsInserted
      });

      // Process transactions table
      stepStart = Date.now();
      const transactionsResult = await this.transactionsProcessor.process(
        testRunId,
        testRun,
        apdexThresholds,
        bucketSizeSeconds,
        isIncremental
      );
      for (let i = 0; i < transactionsResult.compareConfigs.length; i++) {
        allCompareConfigs.push(transactionsResult.compareConfigs[i]);
      }
      breakdown.transactionMetrics += transactionsResult.rowsInserted;
      metricsCreated += transactionsResult.rowsInserted;
      stepTiming.push({
        step: 'transactions-processor',
        duration: Date.now() - stepStart,
        count: transactionsResult.rowsInserted
      });

      // Process requests_error table
      stepStart = Date.now();
      const errorsResult = await this.errorsProcessor.process(
        testRunId,
        testRun
      );
      for (let i = 0; i < errorsResult.metrics.length; i++) {
        allMetrics.push(errorsResult.metrics[i]);
      }
      for (let i = 0; i < errorsResult.compareConfigs.length; i++) {
        allCompareConfigs.push(errorsResult.compareConfigs[i]);
      }
      breakdown.errorMetrics += errorsResult.metrics.length;
      stepTiming.push({
        step: 'errors-processor',
        duration: Date.now() - stepStart,
        count: errorsResult.metrics.length
      });

      // Process virtual_users table
      stepStart = Date.now();
      const vuResult = await this.virtualUsersProcessor.process(
        testRunId,
        testRun
      );
      for (let i = 0; i < vuResult.metrics.length; i++) {
        allMetrics.push(vuResult.metrics[i]);
      }
      for (let i = 0; i < vuResult.compareConfigs.length; i++) {
        allCompareConfigs.push(vuResult.compareConfigs[i]);
      }
      breakdown.virtualUserMetrics += vuResult.metrics.length;
      stepTiming.push({
        step: 'virtual-users-processor',
        duration: Date.now() - stepStart,
        count: vuResult.metrics.length
      });

      // Save the scenario-level metrics the two small processors built in JS.
      if (allMetrics.length > 0) {
        stepStart = Date.now();
        await this.saveDsMetrics(allMetrics, testRunId, testRun, isIncremental);
        metricsCreated += allMetrics.length;
        stepTiming.push({
          step: 'save-scenario-metrics',
          duration: Date.now() - stepStart,
          count: allMetrics.length
        });
      }

      if (metricsCreated > 0) {
        // Statistics are recomputed from the rows just written rather than from a
        // second and third copy of them in the heap. See upsertPerfTestStatistics.
        stepStart = Date.now();
        await upsertPerfTestStatistics(
          this.db.dataSource,
          testRunId,
          this.dashboardManager.getResolvedDashboardIds(),
          testRun,
          this.logger
        );
        stepTiming.push({
          step: 'statistics',
          duration: Date.now() - stepStart,
          count: metricsCreated
        });
        this.logger.info(`💾 Saved ${metricsCreated} ds_metrics records and computed statistics`);

        // Update dashboard panels based on saved metrics
        stepStart = Date.now();
        await this.updateDashboardPanels(testRunId, testRun.start_time, testRun.end_time);
        stepTiming.push({
          step: 'update-panels',
          duration: Date.now() - stepStart,
          count: 0
        });
      }

      // Save all compare configs to database
      if (allCompareConfigs.length > 0) {
        stepStart = Date.now();
        compareConfigsCreated = await this.saveDsCompareConfigs(allCompareConfigs, testRun);
        stepTiming.push({
          step: 'save-compare-configs',
          duration: Date.now() - stepStart,
          count: compareConfigsCreated
        });
        this.logger.info(
          `📊 Created/updated ${compareConfigsCreated} ds_compare_config records`
        );
      }

      const duration = Date.now() - startTime;
      const output: PerformanceTestMetricsOutput = {
        metricsCreated,
        compareConfigsCreated,
        breakdown,
      };

      // Log detailed timing breakdown
      this.logger.info('⏱️  Performance Test Metrics Pipeline - Step Timing:');
      stepTiming.forEach(({ step, duration: stepDuration, count }) => {
        const percentage = ((stepDuration / duration) * 100).toFixed(1);
        const bar = '█'.repeat(Math.round((stepDuration / duration) * 20));
        this.logger.info(
          `   ${step.padEnd(25)} ${stepDuration.toString().padStart(6)}ms ${percentage.padStart(5)}% ${bar} (${count} records)`
        );
      });

      this.logger.info(
        `✅ Performance test metrics collection completed in ${(duration / 1000).toFixed(2)}s`
      );

      return {
        success: true,
        data: output,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error({ err: error, stack }, '❌ Performance test metrics collection failed');
      return {
        success: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: 'PIPELINE_ERROR',
          details: stack,
        },
        duration,
      };
    }
  }

  /**
   * Initialize processor instances
   */
  private initializeProcessors(): void {
    this.dashboardManager = new DashboardManager(this.db.dataSource, this.logger);
    this.requestsProcessor = new RequestsProcessor(
      this.db.dataSource,
      this.dashboardManager,
      this.logger
    );
    this.transactionsProcessor = new TransactionsProcessor(
      this.db.dataSource,
      this.dashboardManager,
      this.logger
    );
    this.errorsProcessor = new ErrorsProcessor(
      this.db.dataSource,
      this.dashboardManager,
      this.logger
    );
    this.virtualUsersProcessor = new VirtualUsersProcessor(
      this.db.dataSource,
      this.dashboardManager,
      this.logger
    );
  }

  /**
   * Validate and parse input
   */
  private validateAndParseInput(input: unknown): PerformanceTestMetricsInput {
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected object');
    }

    const { testRunId, fromTime, toTime } = input as Record<string, unknown>;

    if (!testRunId || typeof testRunId !== 'string') {
      throw new Error('Invalid input: testRunId is required and must be a string');
    }

    // Parse optional time range parameters
    const result: PerformanceTestMetricsInput = { testRunId };

    if (fromTime !== undefined) {
      result.fromTime = fromTime instanceof Date ? fromTime : new Date(fromTime as string | number);
      if (isNaN(result.fromTime.getTime())) {
        throw new Error('Invalid input: fromTime is not a valid date');
      }
    }

    if (toTime !== undefined) {
      result.toTime = toTime instanceof Date ? toTime : new Date(toTime as string | number);
      if (isNaN(result.toTime.getTime())) {
        throw new Error('Invalid input: toTime is not a valid date');
      }
    }

    return result;
  }

  /**
   * Load test run metadata from database
   */
  private async loadTestRunMetadata(testRunId: string): Promise<TestRunMetadata> {
    const testRun = await this.db.getTestRunByTestRunId(testRunId);

    if (!testRun) {
      throw new Error(`Test run not found: ${testRunId}`);
    }

    if (!testRun.startTime) {
      throw new Error(`Test run ${testRunId} has no start time`);
    }

    return {
      test_run_id: testRun.testRunId,
      system_under_test_id: testRun.systemUnderTestId,
      test_environment: testRun.testEnvironment,
      workload: testRun.workload,
      start_time: testRun.startTime,
      ramp_up_time: testRun.analysisStartOffset || 0,
      end_time: testRun.endTime || null,
      organization_id: testRun.organizationId || null,
      team_id: testRun.teamId || null,
    };
  }

  /**
   * Load Apdex thresholds for the workload and transactions
   */
  private async loadApdexThresholds(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    organizationId?: string
  ): Promise<ApdexThresholdLookup> {
    const result: ApdexThresholdLookup = {
      workloadThreshold: null,
      benchmarkThreshold: null,
      transactionThresholds: new Map(),
    };

    // Load workload-level threshold
    // RBAC: Filter by organization (backward compatible with NULL)
    let workloadThresholdQuery = `SELECT apdex_threshold
       FROM workload_apdex_thresholds
       WHERE system_under_test_id = $1
         AND test_environment = $2
         AND workload = $3`;
    const workloadThresholdParams: unknown[] = [systemUnderTestId, testEnvironment, workload];

    if (organizationId) {
      workloadThresholdQuery += `\n         AND (organization_id = $4 OR organization_id IS NULL)`;
      workloadThresholdParams.push(organizationId);
    }

    const workloadThreshold = await this.db.dataSource.query(
      workloadThresholdQuery,
      workloadThresholdParams
    );

    if (workloadThreshold && workloadThreshold.length > 0) {
      result.workloadThreshold = workloadThreshold[0].apdex_threshold;
    }

    // Load benchmark-configured threshold (from apdex benchmark)
    // RBAC: Filter by organization (backward compatible with NULL)
    let benchmarkQuery = `
      SELECT apdex_threshold_ms
      FROM benchmarks
      WHERE system_under_test_id = $1
        AND test_environment = $2
        AND workload = $3
        AND benchmark_type = 'apdex'
        AND apdex_threshold_ms IS NOT NULL`;

    const benchmarkParams: unknown[] = [systemUnderTestId, testEnvironment, workload];

    if (organizationId) {
      benchmarkQuery += `\n        AND (organization_id = $4 OR organization_id IS NULL)`;
      benchmarkParams.push(organizationId);
    }

    benchmarkQuery += `\n      LIMIT 1`;

    const benchmarkThreshold = await this.db.dataSource.query(
      benchmarkQuery,
      benchmarkParams
    );

    if (benchmarkThreshold && benchmarkThreshold.length > 0) {
      result.benchmarkThreshold = benchmarkThreshold[0].apdex_threshold_ms;
    }

    // Load transaction-level thresholds
    // RBAC: Filter by organization (backward compatible with NULL)
    let txThresholdQuery = `SELECT transaction_name, apdex_threshold
       FROM workload_transaction_apdex_thresholds
       WHERE system_under_test_id = $1
         AND test_environment = $2
         AND workload = $3`;
    const txThresholdParams: unknown[] = [systemUnderTestId, testEnvironment, workload];

    if (organizationId) {
      txThresholdQuery += `\n         AND (organization_id = $4 OR organization_id IS NULL)`;
      txThresholdParams.push(organizationId);
    }

    const transactionThresholds = await this.db.dataSource.query(
      txThresholdQuery,
      txThresholdParams
    );

    for (const row of transactionThresholds) {
      result.transactionThresholds.set(row.transaction_name, row.apdex_threshold);
    }

    const effectiveThreshold = result.workloadThreshold || result.benchmarkThreshold || DEFAULT_APDEX_THRESHOLD_MS;
    this.logger.info(
      `📐 Loaded Apdex thresholds: workload=${result.workloadThreshold || 'not set'}, ` +
        `benchmark=${result.benchmarkThreshold || 'not set'}, ` +
        `effective=${effectiveThreshold}ms, ` +
        `transaction-specific=${result.transactionThresholds.size}`
    );

    return result;
  }

  /**
   * Save ds_metrics records to database using parallel batch inserts.
   *
   * Two modes:
   * - **Full collection** (isIncremental=false): plain INSERT with large batch sizes — the
   *   run-wide DELETE happens in `execute()`, before the requests/transactions processors insert. This is 2-3x faster because
   *   PostgreSQL skips unique-index conflict checking and lock contention is eliminated.
   * - **Incremental collection** (isIncremental=true): Use INSERT...ON CONFLICT (UPSERT)
   *   with smaller batch sizes to handle overlapping time ranges safely.
   */
  private async saveDsMetrics(
    metrics: DsMetricsRecord[],
    testRunId: string,
    testRunMetadata?: TestRunMetadata,
    isIncremental: boolean = true
  ): Promise<void> {
    if (metrics.length === 0) {
      return;
    }

    // The run-wide DELETE for full collection happens in execute(), before the
    // requests/transactions processors insert.

    // Full collection: plain INSERT (no conflict check), larger batches
    // Incremental: INSERT...ON CONFLICT (upsert), smaller batches for lock safety
    // PostgreSQL max params: 65535; each record uses 20 params
    // Plain INSERT: 3000 rows × 20 = 60000 params (under limit, no lock contention)
    // ON CONFLICT: 1000 rows × 20 = 20000 params (smaller to reduce lock contention)
    const batchSize = isIncremental ? 1000 : 3000;
    const maxConcurrentBatches = isIncremental ? 4 : 6;

    // Create all batch insert operations
    const batchOperations: Array<() => Promise<void>> = [];

    for (let i = 0; i < metrics.length; i += batchSize) {
      const batch = metrics.slice(i, i + batchSize);

      // Create a function for this batch insert
      const batchInsert = async () => {
        // Build VALUES clause for batch insert
        const values: unknown[] = [];
        const placeholders: string[] = [];

        batch.forEach((record, idx) => {
          const base = idx * 20;
          placeholders.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, $${base + 20})`
          );
          values.push(
            record.test_run_id,
            record.application_dashboard_id,
            record.metrics_source_id || null,
            record.dashboard_uid?.substring(0, 255),
            record.panel_id,
            record.time,
            record.metric_name?.substring(0, 255),
            record.panel_title?.substring(0, 500),
            record.dashboard_label?.substring(0, 255),
            record.benchmark_ids ? JSON.stringify(record.benchmark_ids) : null,
            record.errors ? JSON.stringify(record.errors) : null,
            record.timestep,
            record.ramp_up,
            record.value,
            record.unit,
            new Date(), // created_at
            testRunMetadata?.organization_id || null,
            testRunMetadata?.team_id || null,
            'worker-pipeline', // created_by
            'worker-pipeline'  // updated_by
          );
        });

        let query: string;
        if (isIncremental) {
          query = `
            INSERT INTO ds_metrics (
              test_run_id, application_dashboard_id, metrics_source_id, dashboard_uid, panel_id, time,
              metric_name, panel_title, dashboard_label, benchmark_ids, errors,
              timestep, ramp_up, value, unit, created_at,
              organization_id, team_id, created_by, updated_by
            ) VALUES ${placeholders.join(', ')}
            ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name, time)
            DO UPDATE SET
              value = EXCLUDED.value,
              unit = EXCLUDED.unit,
              metrics_source_id = COALESCE(EXCLUDED.metrics_source_id, ds_metrics.metrics_source_id),
              updated_at = CURRENT_TIMESTAMP,
              organization_id = EXCLUDED.organization_id,
              team_id = EXCLUDED.team_id,
              updated_by = EXCLUDED.updated_by
          `;
        } else {
          query = `
            INSERT INTO ds_metrics (
              test_run_id, application_dashboard_id, metrics_source_id, dashboard_uid, panel_id, time,
              metric_name, panel_title, dashboard_label, benchmark_ids, errors,
              timestep, ramp_up, value, unit, created_at,
              organization_id, team_id, created_by, updated_by
            ) VALUES ${placeholders.join(', ')}
          `;
        }

        // Use write pool so inserts are never starved by analytics
        await this.db.writeDataSource.query(query, values);
      };

      batchOperations.push(batchInsert);
    }

    // Execute batch operations with controlled concurrency
    const results: Array<PromiseSettledResult<void>> = [];
    for (let i = 0; i < batchOperations.length; i += maxConcurrentBatches) {
      const chunk = batchOperations.slice(i, i + maxConcurrentBatches);
      const chunkResults = await Promise.allSettled(chunk.map(op => op()));
      results.push(...chunkResults);
    }

    // Check for failures
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      this.logger.error(`❌ ${failures.length} batch inserts failed`);
      throw new Error(`Failed to save ${failures.length} batches of metrics`);
    }
  }

  /**
   * Save ds_compare_config records using batch insert for better performance.
   *
   * Handles two types of configs:
   * - **Panel-level** (metric_name IS NULL): One per (dashboard, panel).
   *   These provide default thresholds/classification for every metric in the panel.
   *   Uses `ON CONFLICT ... DO NOTHING` to preserve user customizations.
   * - **Metric-specific** (metric_name IS NOT NULL): Per-metric overrides (legacy).
   *   Also uses `DO NOTHING` to preserve existing records.
   *
   * Returns the number of records created.
   */
  private async saveDsCompareConfigs(configs: DsCompareConfigRecord[], testRunMetadata?: TestRunMetadata): Promise<number> {
    if (configs.length === 0) {
      return 0;
    }

    // Split configs into panel-level and metric-specific groups
    const panelLevelConfigs = configs.filter((c) => c.metric_name === null);
    const metricSpecificConfigs = configs.filter((c) => c.metric_name !== null);

    let totalInserted = 0;

    // Insert panel-level configs (metric_name IS NULL)
    if (panelLevelConfigs.length > 0) {
      totalInserted += await this.insertCompareConfigBatch(
        panelLevelConfigs,
        testRunMetadata,
        // Must match uniq_ds_compare_config_panel index
        `ON CONFLICT (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id) WHERE metric_name IS NULL DO NOTHING`
      );
    }

    // Insert metric-specific configs (metric_name IS NOT NULL) — legacy path
    if (metricSpecificConfigs.length > 0) {
      totalInserted += await this.insertCompareConfigBatch(
        metricSpecificConfigs,
        testRunMetadata,
        // Must match uniq_ds_compare_config_metric index
        `ON CONFLICT (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id, metric_name) WHERE metric_name IS NOT NULL DO NOTHING`
      );
    }

    return totalInserted;
  }

  /**
   * Batch insert compare config records with a given ON CONFLICT clause.
   */
  private async insertCompareConfigBatch(
    configs: DsCompareConfigRecord[],
    testRunMetadata: TestRunMetadata | undefined,
    onConflictClause: string
  ): Promise<number> {
    const batchSize = 200;
    let totalInserted = 0;

    for (let i = 0; i < configs.length; i += batchSize) {
      const batch = configs.slice(i, i + batchSize);

      const values: unknown[] = [];
      const placeholders: string[] = [];

      batch.forEach((config, idx) => {
        const base = idx * 11;
        placeholders.push(
          // organization_id is NOT NULL on ds_compare_config: when the optional metadata is
          // absent, resolve it from the FK-guaranteed parent SUT instead of inserting NULL.
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, ` +
            `COALESCE($${base + 8}, (SELECT organization_id FROM systems_under_test WHERE id = $${base + 1})), ` +
            `COALESCE($${base + 9}, (SELECT team_id FROM systems_under_test WHERE id = $${base + 1})), ` +
            `$${base + 10}, $${base + 11})`
        );
        values.push(
          config.system_under_test_id,
          config.test_environment,
          config.workload,
          config.application_dashboard_id,
          config.panel_id,
          config.metric_name?.substring(0, 255) ?? null,
          JSON.stringify(config.config_data),
          testRunMetadata?.organization_id ?? null,
          testRunMetadata?.team_id ?? null,
          'worker-pipeline',
          'worker-pipeline'
        );
      });

      const query = `
        INSERT INTO ds_compare_config (
          system_under_test_id, test_environment, workload,
          application_dashboard_id, panel_id, metric_name, config_data,
          organization_id, team_id, created_by, updated_by
        )
        VALUES ${placeholders.join(', ')}
        ${onConflictClause}
        RETURNING id
      `;

      const result = await this.db.dataSource.query(query, values);
      totalInserted += result.length;

      this.logger.debug(
        `📥 Batch ${Math.floor(i / batchSize) + 1}: Inserted ${result.length}/${batch.length} compare configs`
      );
    }

    return totalInserted;
  }

  /**
   * Update dashboard panels based on saved metrics
   * Queries distinct panels from ds_metrics and updates grafana_dashboards.panels JSONB field
   */
  private async updateDashboardPanels(
    testRunId: string,
    startTime: Date,
    endTime: Date | null
  ): Promise<void> {
    this.logger.info('📊 Updating dashboard panels based on saved metrics...');

    try {
      // TimescaleDB optimization: Add generous time window to limit chunk scanning
      // Add 1 hour buffer before start and after end to handle clock skew
      const timeFrom = new Date(startTime.getTime() - 3600000); // 1 hour before
      const timeTo = endTime ? new Date(endTime.getTime() + 3600000) : new Date(); // 1 hour after or now

      // Get all dashboards that have metrics for this test run
      const dashboards = await this.db.dataSource.query<
        Array<{ dashboard_uid: string; grafana_dashboard_id: string }>
      >(
        `SELECT DISTINCT ad.dashboard_uid, gd.id as grafana_dashboard_id
         FROM ds_metrics dm
         JOIN application_dashboards ad ON ad.id = dm.application_dashboard_id
         JOIN grafana_dashboards gd ON gd.uid = ad.dashboard_uid
         WHERE dm.test_run_id = $1
         AND dm.time >= $2
         AND dm.time <= $3`,
        [testRunId, timeFrom, timeTo]
      );

      if (!dashboards || dashboards.length === 0) {
        this.logger.info(`⏭️  No dashboards found for test run: ${testRunId} - skipping panel update`);
        return;
      }

      this.logger.info(`🔄 Updating panels for ${dashboards.length} dashboard(s)`);

      // Single query to update all dashboards at once (eliminates N+1 loop)
      const result = await this.db.dataSource.query<
        Array<{ id: string; uid: string; panels: unknown[] }>
      >(
        `UPDATE grafana_dashboards gd
         SET panels = panel_updates.panels
         FROM (
           SELECT
             gd2.id,
             jsonb_agg(
               jsonb_build_object(
                 'id', panels_deduped.panel_id,
                 'title', panels_deduped.panel_title,
                 'type', 'timeseries',
                 'y_axes_format', panels_deduped.unit
               )
             ) as panels
           FROM (
             SELECT DISTINCT ON (ad.dashboard_uid, dm.panel_id)
               ad.dashboard_uid,
               dm.panel_id,
               dm.panel_title,
               dm.unit
             FROM ds_metrics dm
             JOIN application_dashboards ad ON ad.id = dm.application_dashboard_id
             WHERE dm.test_run_id = $1
               AND dm.time >= $2
               AND dm.time <= $3
               AND dm.unit IS NOT NULL
               AND dm.unit != ''
             ORDER BY ad.dashboard_uid, dm.panel_id, dm.unit
           ) panels_deduped
           JOIN grafana_dashboards gd2 ON gd2.uid = panels_deduped.dashboard_uid
           GROUP BY gd2.id
         ) panel_updates
         WHERE gd.id = panel_updates.id
         RETURNING gd.id, gd.uid, gd.panels`,
        [testRunId, timeFrom, timeTo]
      );

      if (result) {
        for (const row of result) {
          const panelCount = row.panels ? row.panels.length : 0;
          this.logger.info(`✅ Updated ${panelCount} panel(s) for dashboard: ${row.uid}`);
        }
      }

      this.logger.info('✅ Dashboard panels update completed');
    } catch (error) {
      this.logger.error('❌ Failed to update dashboard panels:', error);
      // Don't throw - this is a non-critical operation
      // Metrics are saved, panels can be updated manually if needed
    }
  }
}
