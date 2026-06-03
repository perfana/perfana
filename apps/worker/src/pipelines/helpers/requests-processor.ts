/**
 * Requests Processor for Performance Test Metrics Pipeline
 *
 * Processes requests_raw table and creates metrics organized by:
 * - Scenario -> Dashboard
 * - Metric type -> Panel (one panel per metric type, all transactions in one panel)
 * - Metric name = "{transactionName}.{samplerName}"
 */

import { DataSource } from 'typeorm';
import type { Logger } from 'pino';
import type { DashboardManager, DashboardMetadata } from './dashboard-manager.js';
import {
  buildNewRequestMetricName,
  createDsMetricsRecord,
  createDsCompareConfigRecordPanelLevel,
  createDsCompareConfigRecordPanelLevelNoClassification,
} from './metrics-builder.js';
// calculateApdexScore no longer needed — Apdex is computed in SQL
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

export interface RequestsProcessorResult {
  metrics: DsMetricsRecord[];
  compareConfigs: DsCompareConfigRecord[];
}

/**
 * Mapping from a row field name to its panel ID.
 * Used by the helper to avoid repetition.
 */
interface RequestMetricMapping {
  field: string;
  panelId: number;
}

/** All request-level metric mappings (excluding apdex which needs special calculation). */
const REQUEST_METRIC_MAPPINGS: RequestMetricMapping[] = [
  { field: 'avg_response_time', panelId: METRIC_TYPE_PANEL_IDS.REQ_RT_AVG },
  { field: 'p90_response_time', panelId: METRIC_TYPE_PANEL_IDS.REQ_RT_P90 },
  { field: 'p95_response_time', panelId: METRIC_TYPE_PANEL_IDS.REQ_RT_P95 },
  { field: 'p99_response_time', panelId: METRIC_TYPE_PANEL_IDS.REQ_RT_P99 },
  { field: 'error_rate', panelId: METRIC_TYPE_PANEL_IDS.REQ_ERROR_RATE },
  { field: 'throughput', panelId: METRIC_TYPE_PANEL_IDS.REQ_THROUGHPUT },
  // apdex_score handled separately (needs threshold calculation)
  { field: 'avg_latency', panelId: METRIC_TYPE_PANEL_IDS.REQ_LATENCY },
  { field: 'avg_connect_time', panelId: METRIC_TYPE_PANEL_IDS.REQ_CONNECT_TIME },
];

/**
 * Panel IDs that get classified compare configs (with ADAPT comparison).
 * P90/P95/P99 get no-classification configs.
 */
const CLASSIFIED_REQUEST_PANELS: Set<number> = new Set([
  METRIC_TYPE_PANEL_IDS.REQ_RT_AVG,
  METRIC_TYPE_PANEL_IDS.REQ_ERROR_RATE,
  METRIC_TYPE_PANEL_IDS.REQ_THROUGHPUT,
  METRIC_TYPE_PANEL_IDS.REQ_APDEX,
]);

export class RequestsProcessor {
  constructor(
    private dataSource: DataSource,
    private dashboardManager: DashboardManager,
    private logger: Logger
  ) {}

  async process(
    testRunId: string,
    testRun: TestRunMetadata,
    _apdexThresholds: ApdexThresholdLookup,
    bucketSizeSeconds: number
  ): Promise<RequestsProcessorResult> {
    const metrics: DsMetricsRecord[] = [];
    const compareConfigs: DsCompareConfigRecord[] = [];
    const compareConfigsCreated = new Set<string>();

    // Use database-side aggregation for better performance
    const aggregatedData = await this.aggregateRequestsInDatabase(
      testRunId,
      testRun,
      bucketSizeSeconds
    );

    if (!aggregatedData || aggregatedData.length === 0) {
      this.logger.warn(`⚠️  No requests_raw data found for test run ${testRunId}`);
      return { metrics, compareConfigs };
    }

    this.logger.info(`📊 Processing ${aggregatedData.length} aggregated request buckets (database-side aggregation)`);

    // Accumulate total throughput per (scenario, bucket) for "total" metric
    const totalThroughputBuckets = new Map<string, {
      total: number;
      dashboard: DashboardMetadata;
      bucketTime: Date;
      timestep: number;
    }>();

    // Scenarios whose dashboard could not be created — skipped without aborting
    // the whole run, so remaining scenarios still yield ds_metrics (issue #388).
    const failedScenarios = new Set<string>();

    // Process pre-aggregated data from database
    for (const row of aggregatedData) {
      // Skip rows for a scenario we already failed to set up (logged once below).
      if (failedScenarios.has(row.scenario_name)) {
        continue;
      }

      // Get/create dashboard for this scenario. A single failing scenario must
      // not abort the entire pipeline — log it, remember it, and move on.
      let dashboard: DashboardMetadata;
      try {
        dashboard = await this.dashboardManager.getOrCreateScenarioDashboard(
          row.scenario_name,
          testRun.system_under_test_id,
          testRun.test_environment
        );
      } catch (err) {
        failedScenarios.add(row.scenario_name);
        const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
        this.logger.error(
          { err },
          `⚠️  Skipping scenario "${row.scenario_name}" — dashboard creation failed: ${msg}. Remaining scenarios will still be processed.`
        );
        continue;
      }

      // Build the new metric name: "{transactionName}.{samplerName}"
      const metricName = buildNewRequestMetricName(row.transaction_name, row.sampler_name);

      // Apdex score is already computed in SQL via COUNT FILTER

      // Emit one metric record per metric type, each to its own panel
      for (const mapping of REQUEST_METRIC_MAPPINGS) {
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
        const apdexPanel = this.dashboardManager.getMetricTypePanel(METRIC_TYPE_PANEL_IDS.REQ_APDEX);
        metrics.push(
          createDsMetricsRecord(
            testRunId,
            dashboard,
            apdexPanel,
            metricName,
            row.apdex_score,
            row.bucket_time,
            METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.REQ_APDEX],
            row.timestep,
            testRun.start_time,
            testRun.ramp_up_time
          )
        );
      }

      // Create panel-level compare configs ONCE per unique (dashboard, panel) combination.
      // Panel-level configs (metric_name IS NULL) apply to all metrics in the panel,
      // allowing user overrides at both panel and metric granularity.
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

    // Emit "total" throughput metrics (sum of all requests per bucket)
    const throughputPanel = this.dashboardManager.getMetricTypePanel(METRIC_TYPE_PANEL_IDS.REQ_THROUGHPUT);
    for (const bucket of totalThroughputBuckets.values()) {
      metrics.push(
        createDsMetricsRecord(
          testRunId,
          bucket.dashboard,
          throughputPanel,
          'total',
          Math.round(bucket.total * 100) / 100,
          bucket.bucketTime,
          METRIC_TYPE_PANEL_UNITS[METRIC_TYPE_PANEL_IDS.REQ_THROUGHPUT],
          bucket.timestep,
          testRun.start_time,
          testRun.ramp_up_time
        )
      );

      // Panel-level configs already cover the "total" metric (created above)
    }

    this.logger.info(`✅ Created ${metrics.length} request metrics`);

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
    const allRequestPanelIds = [
      ...REQUEST_METRIC_MAPPINGS.map((m) => m.panelId),
      METRIC_TYPE_PANEL_IDS.REQ_APDEX,
    ];

    for (const panelId of allRequestPanelIds) {
      const key = `${dashboard.dashboardId}::panel::${panelId}`;
      if (created.has(key)) { continue; }

      const panel = this.dashboardManager.getMetricTypePanel(panelId);
      const aggregation = METRIC_TYPE_PANEL_ADAPT_AGGREGATION[panelId];

      if (CLASSIFIED_REQUEST_PANELS.has(panelId)) {
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
   * Aggregate requests data at database level for much better performance
   * Uses TimescaleDB's time_bucket() and PostgreSQL's PERCENTILE_CONT
   *
   * Apdex is computed entirely in SQL by LEFT JOINing threshold tables and
   * using COUNT FILTER, eliminating the need to transfer response_time arrays
   * to JS (which caused memory exhaustion on large datasets).
   *
   * For incremental collection:
   * - Bucket alignment uses original start_time for consistency across increments
   * - WHERE clause uses filter_from_time/filter_to_time for time range filtering
   */
  private async aggregateRequestsInDatabase(
    testRunId: string,
    testRun: TestRunMetadata,
    bucketSizeSeconds: number
  ) {
    // Determine effective filter times (use filter times if set, otherwise use start/end)
    const filterFromTime = testRun.filter_from_time ?? testRun.start_time;
    const filterToTime = testRun.filter_to_time ?? testRun.end_time;
    const hasFilterEndTime = filterToTime !== null;

    // Parameters:
    // $1 = testRunId
    // $2 = filterFromTime (for WHERE clause)
    // $3 = filterToTime (optional, for WHERE clause)
    // $4 = bucketSizeSeconds
    // $5 = start_time (original, for bucket alignment)
    // $6 = system_under_test_id (for threshold lookups)
    // $7 = test_environment (for threshold lookups)
    // $8 = workload (for threshold lookups)
    // $9 = default apdex threshold (fallback)
    const query = `
      WITH thresholds AS (
        -- Pre-load per-transaction and workload-level Apdex thresholds
        SELECT
          wtat.transaction_name,
          wtat.apdex_threshold as tx_threshold
        FROM workload_transaction_apdex_thresholds wtat
        WHERE wtat.system_under_test_id = $6
          AND wtat.test_environment = $7
          AND wtat.workload = $8
      ),
      workload_threshold AS (
        SELECT apdex_threshold
        FROM workload_apdex_thresholds
        WHERE system_under_test_id = $6
          AND test_environment = $7
          AND workload = $8
        LIMIT 1
      ),
      bucketed_data AS (
        SELECT
          COALESCE(scenario_name, 'default') as scenario_name,
          COALESCE(transaction_name, 'overall') as transaction_name,
          COALESCE(sampler_name, 'unknown') as sampler_name,
          CASE
            WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb')
            THEN time_bucket(INTERVAL '1 second' * $4, time, $5::timestamp)
            ELSE date_trunc('second', time) +
                 INTERVAL '1 second' * (FLOOR(EXTRACT(EPOCH FROM (time - $5::timestamp)) / $4) * $4)
          END as bucket_time,
          response_time,
          response_latency,
          response_connect_time,
          success,
          CASE WHEN success = false THEN 1 ELSE 0 END as is_error
        FROM requests_raw
        WHERE test_run_id = $1
          AND time >= $2
          ${hasFilterEndTime ? 'AND time <= $3' : ''}
      ),
      aggregated AS (
        SELECT
          bd.scenario_name,
          bd.transaction_name,
          bd.sampler_name,
          bd.bucket_time,
          COUNT(*) as request_count,
          SUM(bd.is_error) as error_count,

          -- Response time aggregations
          AVG(bd.response_time) FILTER (WHERE bd.response_time IS NOT NULL) as avg_response_time,
          PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY bd.response_time)
            FILTER (WHERE bd.response_time IS NOT NULL) as p90_response_time,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY bd.response_time)
            FILTER (WHERE bd.response_time IS NOT NULL) as p95_response_time,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY bd.response_time)
            FILTER (WHERE bd.response_time IS NOT NULL) as p99_response_time,

          -- Latency and connect time
          AVG(bd.response_latency) FILTER (WHERE bd.response_latency IS NOT NULL) as avg_latency,
          AVG(bd.response_connect_time) FILTER (WHERE bd.response_connect_time IS NOT NULL) as avg_connect_time,

          -- SQL-side Apdex: compute satisfied/tolerating counts using threshold fallback chain
          -- Priority: transaction-specific -> workload -> system default ($9)
          COALESCE(th.tx_threshold, wt.apdex_threshold, $9) as effective_threshold,
          COUNT(*) FILTER (WHERE bd.response_time IS NOT NULL) as apdex_total,
          COUNT(*) FILTER (
            WHERE bd.response_time IS NOT NULL
              AND bd.response_time <= COALESCE(th.tx_threshold, wt.apdex_threshold, $9)
          ) as apdex_satisfied,
          COUNT(*) FILTER (
            WHERE bd.response_time IS NOT NULL
              AND bd.response_time > COALESCE(th.tx_threshold, wt.apdex_threshold, $9)
              AND bd.response_time <= COALESCE(th.tx_threshold, wt.apdex_threshold, $9) * 4
          ) as apdex_tolerating

        FROM bucketed_data bd
        LEFT JOIN thresholds th
          ON th.transaction_name = CASE WHEN bd.transaction_name = 'overall' THEN NULL ELSE bd.transaction_name END
        CROSS JOIN (SELECT apdex_threshold FROM workload_threshold UNION ALL SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM workload_threshold)) wt
        GROUP BY bd.scenario_name, bd.transaction_name, bd.sampler_name, bd.bucket_time,
                 th.tx_threshold, wt.apdex_threshold
      )
      SELECT
        scenario_name,
        transaction_name,
        sampler_name,
        bucket_time,
        request_count,
        error_count,
        avg_response_time,
        p90_response_time,
        p95_response_time,
        p99_response_time,
        avg_latency,
        avg_connect_time,
        ROUND((error_count::numeric / NULLIF(request_count, 0) * 100)::numeric, 2) as error_rate,
        ROUND((request_count::numeric / $4)::numeric, 2) as throughput,
        FLOOR(EXTRACT(EPOCH FROM (bucket_time - $5::timestamp)) / $4)::integer as timestep,
        -- Apdex score: (satisfied + tolerating/2) / total
        CASE
          WHEN apdex_total > 0
          THEN ROUND(((apdex_satisfied + apdex_tolerating / 2.0) / apdex_total)::numeric, 4)
          ELSE NULL
        END as apdex_score
      FROM aggregated
      ORDER BY scenario_name, transaction_name, sampler_name, bucket_time
    `;

    const params = [
      testRunId,
      filterFromTime,
      hasFilterEndTime ? filterToTime : null,
      bucketSizeSeconds,
      testRun.start_time,
      testRun.system_under_test_id,
      testRun.test_environment,
      testRun.workload,
      DEFAULT_APDEX_THRESHOLD_MS,
    ];

    return this.dataSource.query(query, params);
  }

}
