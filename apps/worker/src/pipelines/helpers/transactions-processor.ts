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
      apdexThresholds,
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

      // Compute Apdex score from SQL-aggregated bracket counts (no array materialisation)
      const apdexTotal = parseInt(row.apdex_total, 10) || 0;
      if (apdexTotal > 0) {
        const apdexSatisfied = parseInt(row.apdex_satisfied, 10) || 0;
        const apdexTolerating = parseInt(row.apdex_tolerating, 10) || 0;
        row.apdex_score = (apdexSatisfied + apdexTolerating * 0.5) / apdexTotal;
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
   * Aggregate transactions data at database level for much better performance.
   * Uses TimescaleDB's time_bucket() and PostgreSQL's PERCENTILE_CONT.
   *
   * Apdex bracket counts are computed in SQL using a LEFT JOIN to
   * workload_transaction_apdex_thresholds, so no response-time arrays are
   * materialised in JS heap. Memory cost is O(rows) not O(rows × bucket_size).
   *
   * For incremental collection:
   * - Bucket alignment uses original start_time for consistency across increments
   * - WHERE clause uses filter_from_time/filter_to_time for time range filtering
   */
  private async aggregateTransactionsInDatabase(
    testRunId: string,
    testRun: TestRunMetadata,
    apdexThresholds: ApdexThresholdLookup,
    bucketSizeSeconds: number
  ): Promise<any[]> {
    const filterFromTime = testRun.filter_from_time ?? testRun.start_time;
    const filterToTime = testRun.filter_to_time ?? testRun.end_time;
    const hasFilterEndTime = filterToTime !== null;
    const hasOrgFilter = !!testRun.organization_id;

    // Fallback threshold used when no per-transaction override exists.
    const fallbackThreshold =
      apdexThresholds.workloadThreshold ??
      apdexThresholds.benchmarkThreshold ??
      DEFAULT_APDEX_THRESHOLD_MS;

    // $1 = testRunId
    // $2 = filterFromTime
    // $3 = filterToTime (null when no upper bound)
    // $4 = bucketSizeSeconds
    // $5 = start_time (bucket origin)
    // $6 = system_under_test_id (for per-transaction threshold JOIN)
    // $7 = test_environment
    // $8 = workload
    // $9 = fallbackThreshold (ms)
    // $10 = organization_id (optional, only when hasOrgFilter)
    const orgFilterClause = hasOrgFilter
      ? 'AND (organization_id = $10 OR organization_id IS NULL)'
      : '';

    const query = `
      WITH per_txn_thresholds AS (
        SELECT transaction_name, apdex_threshold
        FROM workload_transaction_apdex_thresholds
        WHERE system_under_test_id = $6::uuid
          AND test_environment = $7
          AND workload = $8
          ${orgFilterClause}
      ),
      bucketed_data AS (
        SELECT
          COALESCE(scenario_name, 'default') as scenario_name,
          transaction_name,
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
          bd.scenario_name,
          bd.transaction_name,
          bd.bucket_time,
          -- Apdex threshold resolved per transaction; fallback to $9 when no override
          COALESCE(pt.apdex_threshold, $9) as apdex_threshold_ms,
          COUNT(*) as transaction_count,
          SUM(bd.is_error) as error_count,

          AVG(bd.response_time) FILTER (WHERE bd.response_time IS NOT NULL) as avg_response_time,
          PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY bd.response_time)
            FILTER (WHERE bd.response_time IS NOT NULL) as p90_response_time,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY bd.response_time)
            FILTER (WHERE bd.response_time IS NOT NULL) as p95_response_time,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY bd.response_time)
            FILTER (WHERE bd.response_time IS NOT NULL) as p99_response_time,

          -- Apdex bracket counts — replaces ARRAY_AGG to avoid heap allocation
          COUNT(*) FILTER (WHERE bd.response_time IS NOT NULL
                             AND bd.response_time <= COALESCE(pt.apdex_threshold, $9)) as apdex_satisfied,
          COUNT(*) FILTER (WHERE bd.response_time IS NOT NULL
                             AND bd.response_time > COALESCE(pt.apdex_threshold, $9)
                             AND bd.response_time <= COALESCE(pt.apdex_threshold, $9) * 4) as apdex_tolerating,
          COUNT(*) FILTER (WHERE bd.response_time IS NOT NULL) as apdex_total
        FROM bucketed_data bd
        LEFT JOIN per_txn_thresholds pt ON pt.transaction_name = bd.transaction_name
        GROUP BY bd.scenario_name, bd.transaction_name, bd.bucket_time, COALESCE(pt.apdex_threshold, $9)
      )
      SELECT
        *,
        ROUND((error_count::numeric / NULLIF(transaction_count, 0) * 100)::numeric, 2) as error_rate,
        ROUND((transaction_count::numeric / $4)::numeric, 2) as throughput,
        -- Absolute timestep from test start for consistent values across incremental runs
        FLOOR(EXTRACT(EPOCH FROM (bucket_time - $5::timestamp)) / $4)::integer as timestep
      FROM aggregated
      ORDER BY scenario_name, transaction_name, bucket_time
    `;

    const baseParams: unknown[] = [
      testRunId,                         // $1
      filterFromTime,                    // $2
      hasFilterEndTime ? filterToTime : null, // $3
      bucketSizeSeconds,                 // $4
      testRun.start_time,               // $5
      testRun.system_under_test_id,     // $6
      testRun.test_environment,          // $7
      testRun.workload,                  // $8
      fallbackThreshold,                 // $9
    ];
    const params = hasOrgFilter
      ? [...baseParams, testRun.organization_id]  // $10
      : baseParams;

    return this.dataSource.query(query, params);
  }
}
