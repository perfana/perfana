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
import { TransactionsProcessor } from './helpers/transactions-processor.js';
import { ErrorsProcessor, VirtualUsersProcessor } from './helpers/scenario-processors.js';

/**
 * Performance Test Metrics Pipeline
 */
export class PerformanceTestMetricsPipeline extends BasePipelineTypeORM {
  private dashboardManager: DashboardManager;
  private requestsProcessor: RequestsProcessor;
  private transactionsProcessor: TransactionsProcessor;
  private errorsProcessor: ErrorsProcessor;
  private virtualUsersProcessor: VirtualUsersProcessor;

  constructor(logger: Logger) {
    super(logger);
    // Initialize processors (will be instantiated with dataSource in execute)
    this.dashboardManager = null as any;
    this.requestsProcessor = null as any;
    this.transactionsProcessor = null as any;
    this.errorsProcessor = null as any;
    this.virtualUsersProcessor = null as any;
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

      // Calculate bucket size for time-series aggregation
      // Incremental collection uses fixed 1s buckets to ensure consistent resolution
      // throughout the test run regardless of elapsed time.
      // Full collection uses dynamic bucket sizing based on total test duration.
      const effectiveEndTime = testRun.filter_to_time ?? testRun.end_time;
      const elapsedTimeSeconds = effectiveEndTime
        ? (effectiveEndTime.getTime() - testRun.start_time.getTime()) / 1000
        : 3600; // Default to 1 hour if no end time

      const bucketSizeSeconds = isIncremental
        ? 1 // Fixed 1s buckets for incremental — avoids resolution changes mid-test
        : calculateBucketSize(elapsedTimeSeconds, FULL_COLLECTION_TARGET_DATA_POINTS);
      const estimatedBuckets = Math.ceil(elapsedTimeSeconds / bucketSizeSeconds);

      this.logger.info(
        `📊 Using ${bucketSizeSeconds}s buckets for ${elapsedTimeSeconds.toFixed(0)}s elapsed time (estimated ${estimatedBuckets} buckets${isIncremental ? ', fixed for incremental' : ''})`
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

      // Arrays to collect all metrics and compare configs
      const allMetrics: DsMetricsRecord[] = [];
      const allCompareConfigs: DsCompareConfigRecord[] = [];
      const stepTiming: Array<{ step: string; duration: number; count: number }> = [];

      // Process requests_raw table
      let stepStart = Date.now();
      const requestsResult = await this.requestsProcessor.process(
        testRunId,
        testRun,
        apdexThresholds,
        bucketSizeSeconds
      );
      // Use for-loop to avoid stack overflow with large arrays (push(...arr) fails at ~100k+ items)
      for (let i = 0; i < requestsResult.metrics.length; i++) {
        allMetrics.push(requestsResult.metrics[i]);
      }
      for (let i = 0; i < requestsResult.compareConfigs.length; i++) {
        allCompareConfigs.push(requestsResult.compareConfigs[i]);
      }
      breakdown.responseTimeMetrics += requestsResult.metrics.length;
      stepTiming.push({
        step: 'requests-processor',
        duration: Date.now() - stepStart,
        count: requestsResult.metrics.length
      });

      // Process transactions table
      stepStart = Date.now();
      const transactionsResult = await this.transactionsProcessor.process(
        testRunId,
        testRun,
        apdexThresholds,
        bucketSizeSeconds
      );
      for (let i = 0; i < transactionsResult.metrics.length; i++) {
        allMetrics.push(transactionsResult.metrics[i]);
      }
      for (let i = 0; i < transactionsResult.compareConfigs.length; i++) {
        allCompareConfigs.push(transactionsResult.compareConfigs[i]);
      }
      breakdown.transactionMetrics += transactionsResult.metrics.length;
      stepTiming.push({
        step: 'transactions-processor',
        duration: Date.now() - stepStart,
        count: transactionsResult.metrics.length
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

      // Save all metrics to database and compute statistics in parallel
      // Deduplication is handled at the DB level via ON CONFLICT (incremental)
      // or DELETE + INSERT (full collection), avoiding large in-memory Maps.
      if (allMetrics.length > 0) {
        stepStart = Date.now();
        await Promise.all([
          this.saveDsMetrics(allMetrics, testRunId, testRun, isIncremental),
          this.computeAndSaveStatistics(allMetrics, testRunId, testRun),
        ]);
        metricsCreated = allMetrics.length;
        stepTiming.push({
          step: 'save-metrics+statistics',
          duration: Date.now() - stepStart,
          count: metricsCreated
        });
        this.logger.info(`💾 Saved ${metricsCreated} ds_metrics records and computed statistics in parallel`);

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
   * - **Full collection** (isIncremental=false): DELETE existing metrics for the test run
   *   first, then use plain INSERT with large batch sizes. This is 2-3x faster because
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

    // For full collection, delete existing metrics first to enable plain INSERT
    if (!isIncremental) {
      const deleteStart = Date.now();
      await this.db.dataSource.query(
        `DELETE FROM ds_metrics WHERE test_run_id = $1`,
        [testRunId]
      );
      this.logger.info(`🧹 Deleted existing ds_metrics for ${testRunId} in ${Date.now() - deleteStart}ms`);
    }

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
   * Compute statistics from in-memory metrics and save to ds_metric_statistics.
   * This runs in parallel with saveDsMetrics to avoid the separate StatisticsPipeline
   * round-trip (which reads ds_metrics back from the database).
   */
  private async computeAndSaveStatistics(
    allMetrics: DsMetricsRecord[],
    testRunId: string,
    testRun: TestRunMetadata,
  ): Promise<void> {
    const statsStart = Date.now();

    // Filter: ramp_up === false and value is not null/undefined
    const filtered = allMetrics.filter(m => !m.ramp_up && m.value !== null && m.value !== undefined);

    if (filtered.length === 0) {
      this.logger.info('⏭️  No non-ramp-up metrics for in-memory statistics');
      return;
    }

    // Group by (test_run_id, application_dashboard_id, panel_id, metric_name).
    // CRITICAL: truncate metric_name to 255 chars in the key so it matches what
    // is actually stored (line ~783). Two metrics whose first 255 chars match
    // would otherwise produce two stat records with the same persisted key, and
    // the bulk INSERT ... ON CONFLICT DO UPDATE would then trip Postgres's
    // `cardinality_violation` ("ON CONFLICT DO UPDATE command cannot affect
    // row a second time"). Pre-#134 the same collision tripped a duplicate-key
    // error against uniq_ds_metric_statistics — this is a sibling defect, not
    // a new one, but the upsert form makes it easier to surface.
    const groups = new Map<string, DsMetricsRecord[]>();
    for (const m of filtered) {
      const truncatedMetricName = m.metric_name?.substring(0, 255) ?? '';
      const key = `${m.test_run_id}|${m.application_dashboard_id}|${m.panel_id}|${truncatedMetricName}`;
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(m);
    }

    this.logger.info(
      `📊 Computing in-memory statistics for ${groups.size} metric groups from ${filtered.length} data points`
    );

    // Compute statistics for each group
    interface StatRecord {
      test_run_id: string;
      application_dashboard_id: string;
      metrics_source_id: string | null;
      panel_id: number;
      metric_name: string;
      benchmark_id: string | null;
      dashboard_uid: string;
      dashboard_label: string;
      panel_title: string;
      unit: string | null;
      count: number;
      mean: number;
      median: number;
      min_value: number;
      max_value: number;
      std_dev: number;
      last_value: number;
      n_missing: number;
      n_non_zero: number;
      q10: number;
      q25: number;
      q75: number;
      q90: number;
      q95: number;
      q99: number;
      percentiles: string;
      iqr: number;
      idr: number;
      is_constant: boolean;
      constant_value: boolean;
      all_missing: boolean;
      pct_missing: number;
      missing_percentage: number;
      test_run_start: Date;
      organization_id: string | null;
      team_id: string | null;
    }

    const statRecords: StatRecord[] = [];

    // Helper: linear interpolation percentile on sorted array
    const percentile = (sorted: number[], p: number): number => {
      const n = sorted.length;
      if (n === 1) { return sorted[0]; }
      const rank = (p / 100) * (n - 1);
      const lower = Math.floor(rank);
      const upper = Math.ceil(rank);
      if (lower === upper) { return sorted[lower]; }
      return sorted[lower] + (rank - lower) * (sorted[upper] - sorted[lower]);
    };

    for (const [, records] of groups) {
      // Coerce to number: DB may return numeric values as strings at runtime
      const values = records.map(r => Number(r.value));
      const n = values.length;

      // Sort for percentile calculation
      const sorted = [...values].sort((a, b) => a - b);

      // Basic statistics
      const sum = values.reduce((acc, v) => acc + v, 0);
      const mean = sum / n;
      const minVal = sorted[0];
      const maxVal = sorted[n - 1];

      // Population standard deviation
      const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
      const stdDev = Math.sqrt(variance);

      // Percentiles
      const q10 = percentile(sorted, 10);
      const q25 = percentile(sorted, 25);
      const median = percentile(sorted, 50);
      const q75 = percentile(sorted, 75);
      const q90 = percentile(sorted, 90);
      const q95 = percentile(sorted, 95);
      const q99 = percentile(sorted, 99);

      // Last value by time
      let lastRecord = records[0];
      for (let i = 1; i < records.length; i++) {
        if (records[i].time.getTime() > lastRecord.time.getTime()) {
          lastRecord = records[i];
        }
      }

      // Distinct values → is_constant
      const distinctValues = new Set(values);
      const isConstant = distinctValues.size === 1;

      // Non-zero count
      const nNonZero = values.filter(v => v > 0).length;

      // Use first record for metadata
      const first = records[0];

      statRecords.push({
        test_run_id: first.test_run_id,
        application_dashboard_id: first.application_dashboard_id,
        metrics_source_id: first.metrics_source_id || null,
        panel_id: first.panel_id,
        metric_name: first.metric_name?.substring(0, 255),
        benchmark_id: first.benchmark_ids?.[0] || null,
        dashboard_uid: first.dashboard_uid?.substring(0, 255),
        dashboard_label: (first.dashboard_label || 'missing').substring(0, 255),
        panel_title: (first.panel_title || 'missing').substring(0, 500),
        unit: first.unit?.substring(0, 50) || null,
        count: n,
        mean,
        median,
        min_value: minVal,
        max_value: maxVal,
        std_dev: stdDev,
        last_value: Number(lastRecord.value),
        n_missing: 0,
        n_non_zero: nNonZero,
        q10, q25, q75, q90, q95, q99,
        percentiles: JSON.stringify({
          p10: q10, p25: q25, p50: median, p75: q75, p90: q90, p95: q95, p99: q99,
        }),
        iqr: q75 - q25,
        idr: q90 - q10,
        is_constant: isConstant,
        constant_value: isConstant,
        all_missing: false,
        pct_missing: 0,
        missing_percentage: 0,
        test_run_start: testRun.start_time,
        organization_id: testRun.organization_id ?? null,
        team_id: testRun.team_id ?? null,
      });
    }

    // Bulk UPSERT — 36 params per record, batch size 500 = 18000 params (under 65535 limit).
    // ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name) DO UPDATE
    // is required: IncrementalCollectionScheduler can fire overlapping ticks for the same
    // test_run_id, and the prior DELETE+INSERT pattern (which could take 90+ s under load)
    // raced and tripped uniq_ds_metric_statistics. See issue #134.
    const batchSize = 500;
    let totalInserted = 0;

    for (let i = 0; i < statRecords.length; i += batchSize) {
      const batch = statRecords.slice(i, i + batchSize);
      const values: unknown[] = [];
      const placeholders: string[] = [];

      batch.forEach((rec, idx) => {
        const base = idx * 36;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
          `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, ` +
          `$${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, ` +
          `$${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, $${base + 20}, ` +
          `$${base + 21}, $${base + 22}, $${base + 23}, $${base + 24}, $${base + 25}, ` +
          `$${base + 26}, $${base + 27}, $${base + 28}, $${base + 29}, $${base + 30}, ` +
          `$${base + 31}, $${base + 32}, NOW(), $${base + 33}, $${base + 34}, $${base + 35}, ` +
          `$${base + 36}, 'worker-pipeline', 'worker-pipeline')`
        );
        values.push(
          rec.test_run_id,                // 1
          rec.application_dashboard_id,   // 2
          rec.panel_id,                   // 3
          rec.metric_name,                // 4
          rec.benchmark_id,               // 5
          rec.dashboard_uid,              // 6
          rec.dashboard_label,            // 7
          rec.panel_title,                // 8
          rec.unit,                       // 9
          rec.count,                      // 10
          rec.mean,                       // 11
          rec.median,                     // 12
          rec.min_value,                  // 13
          rec.max_value,                  // 14
          rec.std_dev,                    // 15
          rec.last_value,                 // 16
          rec.n_missing,                  // 17
          rec.n_non_zero,                 // 18
          rec.q10,                        // 19
          rec.q25,                        // 20
          rec.q75,                        // 21
          rec.q90,                        // 22
          rec.q95,                        // 23
          rec.q99,                        // 24
          rec.percentiles,                // 25
          rec.iqr,                        // 26
          rec.idr,                        // 27
          rec.is_constant,                // 28
          rec.constant_value,             // 29
          rec.all_missing,                // 30
          rec.pct_missing,                // 31
          rec.missing_percentage,         // 32
          rec.test_run_start,             // 33
          rec.organization_id,            // 34
          rec.team_id,                    // 35
          rec.metrics_source_id,          // 36
        );
      });

      const query = `
        INSERT INTO ds_metric_statistics (
          test_run_id, application_dashboard_id, panel_id, metric_name, benchmark_id,
          dashboard_uid, dashboard_label, panel_title, unit,
          count, mean, median, min_value, max_value, std_dev, last_value,
          n_missing, n_non_zero,
          q10, q25, q75, q90, q95, q99, percentiles,
          iqr, idr, is_constant, constant_value, all_missing, pct_missing, missing_percentage,
          updated_at, test_run_start, organization_id, team_id,
          metrics_source_id, created_by, updated_by
        ) VALUES ${placeholders.join(', ')}
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
          updated_by          = EXCLUDED.updated_by
      `;

      await this.db.dataSource.query(query, values);
      totalInserted += batch.length;
    }

    this.logger.info(
      `✅ In-memory statistics: ${totalInserted} records upserted in ${Date.now() - statsStart}ms`
    );
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
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`
        );
        values.push(
          config.system_under_test_id,
          config.test_environment,
          config.workload,
          config.application_dashboard_id,
          config.panel_id,
          config.metric_name?.substring(0, 255) ?? null,
          JSON.stringify(config.config_data),
          testRunMetadata?.organization_id || null,
          testRunMetadata?.team_id || null,
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
