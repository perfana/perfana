/**
 * Transactions Processor for Performance Test Metrics Pipeline
 *
 * Processes transactions table and creates transaction-level metrics organized by:
 * - Scenario -> Dashboard
 * - Metric type -> Panel (one panel per metric type, all transactions in one panel)
 * - Metric name = "{transactionName}"
 *
 * OPTIMIZED: Uses database-side aggregation with TimescaleDB support
 */

import { DataSource } from 'typeorm';
import type { Logger } from 'pino';
import type { DashboardManager, DashboardMetadata } from './dashboard-manager.js';
import {
  buildNewTransactionMetricName,
  createDsMetricsRecord,
  createDsCompareConfigRecordPanelLevel,
  createDsCompareConfigRecordPanelLevelNoClassification,
} from './metrics-builder.js';
import { calculateApdexScore } from '../../utils/performance-aggregations.js';
import {
  METRIC_TYPE_PANEL_IDS,
  METRIC_TYPE_PANEL_UNITS,
  METRIC_TYPE_PANEL_CLASSIFICATIONS,
  METRIC_TYPE_PANEL_ADAPT_AGGREGATION,
  DEFAULT_APDEX_THRESHOLD_MS,
} from '../../constants/performance-metrics.js';
import type {
  TestRunMetadata,
  ApdexThresholdLookup,
  DsMetricsRecord,
  DsCompareConfigRecord,
} from '../../types/performance-metrics.js';

export interface TransactionsProcessorResult {
  metrics: DsMetricsRecord[];
  compareConfigs: DsCompareConfigRecord[];
}

/**
 * Mapping from a row field name to its panel ID.
 */
interface TransactionMetricMapping {
  field: string;
  panelId: number;
}

/** All transaction-level metric mappings (excluding apdex which needs special calculation). */
const TRANSACTION_METRIC_MAPPINGS: TransactionMetricMapping[] = [
  { field: 'avg_response_time', panelId: METRIC_TYPE_PANEL_IDS.TXN_RT_AVG },
  { field: 'p90_response_time', panelId: METRIC_TYPE_PANEL_IDS.TXN_RT_P90 },
  { field: 'p95_response_time', panelId: METRIC_TYPE_PANEL_IDS.TXN_RT_P95 },
  { field: 'p99_response_time', panelId: METRIC_TYPE_PANEL_IDS.TXN_RT_P99 },
  { field: 'error_rate', panelId: METRIC_TYPE_PANEL_IDS.TXN_ERROR_RATE },
  { field: 'throughput', panelId: METRIC_TYPE_PANEL_IDS.TXN_THROUGHPUT },
  // apdex_score handled separately (needs threshold calculation)
];

/**
 * Panel IDs that get classified compare configs.
 * P90/P95/P99 get no-classification configs.
 */
const CLASSIFIED_TXN_PANELS: Set<number> = new Set([
  METRIC_TYPE_PANEL_IDS.TXN_RT_AVG,
  METRIC_TYPE_PANEL_IDS.TXN_ERROR_RATE,
  METRIC_TYPE_PANEL_IDS.TXN_APDEX,
  METRIC_TYPE_PANEL_IDS.TXN_THROUGHPUT,
]);

export class TransactionsProcessor {
  constructor(
    private dataSource: DataSource,
    private dashboardManager: DashboardManager,
    private logger: Logger
  ) {}

  async process(
    testRunId: string,
    testRun: TestRunMetadata,
    apdexThresholds: ApdexThresholdLookup,
    bucketSizeSeconds: number
  ): Promise<TransactionsProcessorResult> {
    const metrics: DsMetricsRecord[] = [];
    const compareConfigs: DsCompareConfigRecord[] = [];
    const compareConfigsCreated = new Set<string>();

    // Use database-side aggregation for better performance
    const aggregatedData = await this.aggregateTransactionsInDatabase(
      testRunId,
      testRun,
      bucketSizeSeconds
    );

    if (!aggregatedData || aggregatedData.length === 0) {
      this.logger.warn(`⚠️  No transactions data found for test run ${testRunId}`);
      return { metrics, compareConfigs };
    }

    this.logger.info(
      `📊 Processing ${aggregatedData.length} aggregated transaction buckets (database-side aggregation)`
    );

    // Accumulate total throughput per (scenario, bucket) for "total" metric
    const totalThroughputBuckets = new Map<string, {
      total: number;
      dashboard: DashboardMetadata;
      bucketTime: Date;
      timestep: number;
    }>();

    // Process pre-aggregated data from database
    for (const row of aggregatedData) {
      // Get/create dashboard for this scenario
      const dashboard = await this.dashboardManager.getOrCreateScenarioDashboard(
        row.scenario_name,
        testRun.system_under_test_id,
        testRun.test_environment
      );

      // Build the new metric name: just the transaction name
      const metricName = buildNewTransactionMetricName(row.transaction_name);

      // Get Apdex threshold for this transaction
      const apdexThreshold = this.getApdexThreshold(row.transaction_name, apdexThresholds);
      const apdexToleratingThreshold = apdexThreshold * 4;

      // Calculate Apdex score from response times array
      if (row.response_times_array && row.response_times_array.length > 0) {
        row.apdex_score = calculateApdexScore(
          row.response_times_array,
          apdexThreshold,
          apdexToleratingThreshold
        );
      }

      // Emit one metric record per metric type, each to its own panel
      for (const mapping of TRANSACTION_METRIC_MAPPINGS) {
        if (row[mapping.field] !== null && row[mapping.field] !== undefined) {
          const panel = this.dashboardManager.getMetricTypePanel(mapping.panelId);
          metrics.push(
            createDsMetricsRecord(
              testRunId,
              dashboard,
              panel,
              metricName,
              row[mapping.field],
              row.bucket_time,
              METRIC_TYPE_PANEL_UNITS[mapping.panelId],
              row.timestep,
              testRun.start_time,
              testRun.ramp_up_time
            )
          );
        }
      }

      // Apdex (needs special threshold calculation done above)
      if (row.apdex_score !== null && row.apdex_score !== undefined) {
        const apdexPanel = this.dashboardManager.getMetricTypePanel(METRIC_TYPE_PANEL_IDS.TXN_APDEX);
        metrics.push(
          createDsMetricsRecord(
            testRunId,
            dashboard,
            apdexPanel,
            metricName,
            row.apdex_score,
            row.bucket_time,
            METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.TXN_APDEX],
            row.timestep,
            testRun.start_time,
            testRun.ramp_up_time
          )
        );
      }

      // Create panel-level compare configs ONCE per unique (dashboard, panel) combination.
      this.ensurePanelCompareConfigs(testRun, dashboard, compareConfigs, compareConfigsCreated);

      // Accumulate throughput for "total" metric
      if (row.throughput !== null && row.throughput !== undefined) {
        const bucketKey = `${row.scenario_name}::${row.bucket_time}`;
        const existing = totalThroughputBuckets.get(bucketKey);
        if (existing) {
          existing.total += parseFloat(row.throughput);
        } else {
          totalThroughputBuckets.set(bucketKey, {
            total: parseFloat(row.throughput),
            dashboard,
            bucketTime: row.bucket_time,
            timestep: row.timestep,
          });
        }
      }
    }

    // Emit "total" throughput metrics (sum of all transactions per bucket)
    const throughputPanel = this.dashboardManager.getMetricTypePanel(METRIC_TYPE_PANEL_IDS.TXN_THROUGHPUT);
    for (const bucket of totalThroughputBuckets.values()) {
      metrics.push(
        createDsMetricsRecord(
          testRunId,
          bucket.dashboard,
          throughputPanel,
          'total',
          Math.round(bucket.total * 100) / 100,
          bucket.bucketTime,
          METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.TXN_THROUGHPUT],
          bucket.timestep,
          testRun.start_time,
          testRun.ramp_up_time
        )
      );

      // Panel-level configs already cover the "total" metric (created above)
    }

    this.logger.info(`✅ Created ${metrics.length} transaction metrics`);

    return { metrics, compareConfigs };
  }

  /**
   * Ensure one panel-level compare config exists per (dashboard, panel).
   * Idempotent — skips panels already registered in `created` set.
   */
  private ensurePanelCompareConfigs(
    testRun: TestRunMetadata,
    dashboard: DashboardMetadata,
    compareConfigs: DsCompareConfigRecord[],
    created: Set<string>
  ): void {
    const allTxnPanelIds = [
      ...TRANSACTION_METRIC_MAPPINGS.map((m) => m.panelId),
      METRIC_TYPE_PANEL_IDS.TXN_APDEX,
    ];

    for (const panelId of allTxnPanelIds) {
      const key = `${dashboard.dashboardId}::panel::${panelId}`;
      if (created.has(key)) { continue; }

      const panel = this.dashboardManager.getMetricTypePanel(panelId);
      const aggregation = METRIC_TYPE_PANEL_ADAPT_AGGREGATION[panelId];

      if (CLASSIFIED_TXN_PANELS.has(panelId)) {
        compareConfigs.push(
          createDsCompareConfigRecordPanelLevel(
            testRun,
            dashboard,
            panel,
            aggregation,
            METRIC_TYPE_PANEL_CLASSIFICATIONS[panelId]
          )
        );
      } else {
        compareConfigs.push(
          createDsCompareConfigRecordPanelLevelNoClassification(
            testRun,
            dashboard,
            panel,
            aggregation
          )
        );
      }

      created.add(key);
    }
  }

  /**
   * Aggregate transactions data at database level for much better performance
   * Uses TimescaleDB's time_bucket() and PostgreSQL's PERCENTILE_CONT
   *
   * For incremental collection:
   * - Bucket alignment uses original start_time for consistency across increments
   * - WHERE clause uses filter_from_time/filter_to_time for time range filtering
   */
  private async aggregateTransactionsInDatabase(
    testRunId: string,
    testRun: TestRunMetadata,
    bucketSizeSeconds: number
  ): Promise<any[]> {
    // Determine effective filter times (use filter times if set, otherwise use start/end)
    const filterFromTime = testRun.filter_from_time ?? testRun.start_time;
    const filterToTime = testRun.filter_to_time ?? testRun.end_time;
    const hasFilterEndTime = filterToTime !== null;

    // Parameters - reordered to put time filter at $2/$3 (fixes parameter binding issue)
    // $1 = testRunId
    // $2 = filterFromTime (for WHERE clause)
    // $3 = filterToTime (optional, for WHERE clause)
    // $4 = bucketSizeSeconds
    // $5 = start_time (original, for bucket alignment)
    const query = `
      WITH bucketed_data AS (
        SELECT
          COALESCE(scenario_name, 'default') as scenario_name,
          transaction_name,
          -- Use TimescaleDB's time_bucket for optimal performance
          -- Bucket alignment uses ORIGINAL start_time ($5) for consistency
          CASE
            WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')
            THEN time_bucket(INTERVAL '1 second' * $4, time, $5::timestamp)
            ELSE date_trunc('second', time) +
                 INTERVAL '1 second' * (FLOOR(EXTRACT(EPOCH FROM (time - $5::timestamp)) / $4) * $4)
          END as bucket_time,
          response_time,
          success,
          CASE WHEN success = false THEN 1 ELSE 0 END as is_error
        FROM transactions
        WHERE test_run_id = $1
          AND time >= $2
          ${hasFilterEndTime ? 'AND time <= $3' : ''}
      ),
      aggregated AS (
        SELECT
          scenario_name,
          transaction_name,
          bucket_time,
          COUNT(*) as transaction_count,
          SUM(is_error) as error_count,

          -- Response time aggregations
          AVG(response_time) FILTER (WHERE response_time IS NOT NULL) as avg_response_time,
          PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY response_time)
            FILTER (WHERE response_time IS NOT NULL) as p90_response_time,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time)
            FILTER (WHERE response_time IS NOT NULL) as p95_response_time,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time)
            FILTER (WHERE response_time IS NOT NULL) as p99_response_time,

          -- Apdex calculation components
          ARRAY_AGG(response_time ORDER BY response_time)
            FILTER (WHERE response_time IS NOT NULL) as response_times_array
        FROM bucketed_data
        GROUP BY scenario_name, transaction_name, bucket_time
      )
      SELECT
        *,
        ROUND((error_count::numeric / NULLIF(transaction_count, 0) * 100)::numeric, 2) as error_rate,
        ROUND((transaction_count::numeric / $4)::numeric, 2) as throughput,
        -- Calculate absolute timestep from test start (not relative to query result)
        -- This ensures consistent timestep values across incremental pipeline runs
        FLOOR(EXTRACT(EPOCH FROM (bucket_time - $5::timestamp)) / $4)::integer as timestep
      FROM aggregated
      ORDER BY scenario_name, transaction_name, bucket_time
    `;

    // Params reordered: time filter at $2/$3, bucket params at $4/$5
    const params = hasFilterEndTime
      ? [testRunId, filterFromTime, filterToTime, bucketSizeSeconds, testRun.start_time]
      : [testRunId, filterFromTime, null, bucketSizeSeconds, testRun.start_time];

    const result = await this.dataSource.query(query, params);

    // Apdex score will be calculated in main loop with proper thresholds
    for (const row of result) {
      row.apdex_score = null; // Placeholder
    }

    return result;
  }

  private getApdexThreshold(
    transactionName: string,
    apdexThresholds: ApdexThresholdLookup
  ): number {
    // Priority: transaction-specific > workload > benchmark > default
    if (apdexThresholds.transactionThresholds.has(transactionName)) {
      return apdexThresholds.transactionThresholds.get(transactionName)!;
    }
    return apdexThresholds.workloadThreshold || apdexThresholds.benchmarkThreshold || DEFAULT_APDEX_THRESHOLD_MS;
  }
}
