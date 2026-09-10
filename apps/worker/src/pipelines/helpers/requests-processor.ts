/**
 * Requests Processor for Performance Test Metrics Pipeline
 *
 * Processes requests_raw table and creates metrics organized by:
 * - Scenario -> Dashboard
 * - Metric type -> Panel (one panel per metric type, all transactions in one panel)
 * - Metric name = "{transactionName}.{samplerName}"
 *
 * The aggregate is written straight to ds_metrics by `insertDsMetricsFromAggregate`.
 * Nothing here builds a row in JS: a run with a few thousand samplers produces
 * millions of (bucket x panel) pairs, and materialising those was a worker OOM.
 */

import { DataSource } from 'typeorm';
import type { Logger } from 'pino';
import type { DashboardManager, DashboardMetadata } from './dashboard-manager.js';
import {
  createDsCompareConfigRecordPanelLevel,
  createDsCompareConfigRecordPanelLevelNoClassification,
} from './metrics-builder.js';
import { insertDsMetricsFromAggregate } from './perf-metrics-writer.js';
import { resolveScenarioDashboards } from './scenario-dashboards.js';
import {
  METRIC_TYPE_PANEL_IDS,
  METRIC_TYPE_PANEL_CLASSIFICATIONS,
  METRIC_TYPE_PANEL_ADAPT_AGGREGATION,
  DEFAULT_APDEX_THRESHOLD_MS,
  ALL_AGGREGATED_SCENARIO,
  ALL_AGGREGATED_METRIC,
} from '../../constants/performance-metrics.js';
import type {
  TestRunMetadata,
  ApdexThresholdLookup,
  DsCompareConfigRecord,
} from '../../types/performance-metrics.js';

export interface RequestsProcessorResult {
  rowsInserted: number;
  compareConfigs: DsCompareConfigRecord[];
}

/** Panel ID -> the `computed` column holding its value. */
const REQUEST_PANEL_VALUES: Array<{ panelId: number; column: string }> = [
  { panelId: METRIC_TYPE_PANEL_IDS.REQ_RT_AVG, column: 'avg_response_time' },
  { panelId: METRIC_TYPE_PANEL_IDS.REQ_RT_P90, column: 'p90_response_time' },
  { panelId: METRIC_TYPE_PANEL_IDS.REQ_RT_P95, column: 'p95_response_time' },
  { panelId: METRIC_TYPE_PANEL_IDS.REQ_RT_P99, column: 'p99_response_time' },
  { panelId: METRIC_TYPE_PANEL_IDS.REQ_ERROR_RATE, column: 'error_rate' },
  { panelId: METRIC_TYPE_PANEL_IDS.REQ_THROUGHPUT, column: 'throughput' },
  { panelId: METRIC_TYPE_PANEL_IDS.REQ_APDEX, column: 'apdex_score' },
  { panelId: METRIC_TYPE_PANEL_IDS.REQ_LATENCY, column: 'avg_latency' },
  { panelId: METRIC_TYPE_PANEL_IDS.REQ_CONNECT_TIME, column: 'avg_connect_time' },
];

const REQUEST_PANEL_IDS = REQUEST_PANEL_VALUES.map((m) => m.panelId);

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
    bucketSizeSeconds: number,
    isIncremental: boolean
  ): Promise<RequestsProcessorResult> {
    const compareConfigs: DsCompareConfigRecord[] = [];

    const { dashboards, scenarioNames } = await resolveScenarioDashboards({
      dataSource: this.dataSource,
      dashboardManager: this.dashboardManager,
      logger: this.logger,
      table: 'requests_raw',
      testRunId,
      testRun,
    });

    if (scenarioNames.length === 0) {
      this.logger.warn(`⚠️  No requests_raw data found for test run ${testRunId}`);
      return { rowsInserted: 0, compareConfigs };
    }

    // Panel-level compare configs, one set per real scenario. Display-only: the
    // all-aggregated dashboard gets none, so ADAPT does not evaluate the roll-up —
    // a run-wide average moves on any traffic-mix shift.
    for (const scenarioName of scenarioNames) {
      const dashboard = dashboards.get(scenarioName);
      if (dashboard) {
        this.addPanelCompareConfigs(testRun, dashboard, compareConfigs);
      }
    }

    const { aggregateCte, rowsSelect, params } = this.buildRequestsAggregate(
      testRunId,
      testRun,
      bucketSizeSeconds
    );

    const rowsInserted = await insertDsMetricsFromAggregate({
      dataSource: this.dataSource,
      aggregateCte,
      rowsSelect,
      params,
      dashboards,
      panelIds: REQUEST_PANEL_IDS,
      testRunId,
      testRun,
      isIncremental,
    });

    this.logger.info(`✅ Created ${rowsInserted} request metrics`);

    return { rowsInserted, compareConfigs };
  }

  /**
   * One panel-level compare config per (dashboard, panel).
   * Panel-level configs (metric_name IS NULL) apply to every metric in the panel,
   * leaving per-metric overrides free to take priority in the ADAPT hierarchy.
   */
  private addPanelCompareConfigs(
    testRun: TestRunMetadata,
    dashboard: DashboardMetadata,
    compareConfigs: DsCompareConfigRecord[]
  ): void {
    for (const panelId of REQUEST_PANEL_IDS) {
      const panel = this.dashboardManager.getMetricTypePanel(panelId);
      const aggregation = METRIC_TYPE_PANEL_ADAPT_AGGREGATION[panelId];

      compareConfigs.push(
        CLASSIFIED_REQUEST_PANELS.has(panelId)
          ? createDsCompareConfigRecordPanelLevel(
              testRun,
              dashboard,
              panel,
              aggregation,
              METRIC_TYPE_PANEL_CLASSIFICATIONS[panelId]
            )
          : createDsCompareConfigRecordPanelLevelNoClassification(
              testRun,
              dashboard,
              panel,
              aggregation
            )
      );
    }
  }

  /**
   * Aggregate requests data at database level.
   * Uses TimescaleDB's time_bucket() and PostgreSQL's PERCENTILE_CONT.
   *
   * Apdex is computed entirely in SQL by LEFT JOINing threshold tables and
   * using COUNT FILTER, so no response-time arrays are transferred to JS.
   *
   * For incremental collection:
   * - Bucket alignment uses original start_time for consistency across increments
   * - WHERE clause uses filter_from_time/filter_to_time for time range filtering
   */
  private buildRequestsAggregate(
    testRunId: string,
    testRun: TestRunMetadata,
    bucketSizeSeconds: number
  ): { aggregateCte: string; rowsSelect: string; params: unknown[] } {
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
    // $7 = test_environment
    // $8 = workload
    // $9 = default apdex threshold (fallback)
    // $10 = roll-up scenario name
    // $11 = roll-up metric name
    const aggregateCte = `
      thresholds AS (
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
          -- Which grouping set produced this row. Set 1 is the per-sampler series,
          -- set 2 the run-wide roll-up, set 3 the per-scenario "total" throughput
          -- that the JS loop used to accumulate into a Map.
          GROUPING(bd.scenario_name) as g_scenario,
          GROUPING(bd.transaction_name) as g_txn,
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
        -- Second grouping set rolls every scenario, transaction and sampler up into one
        -- series per bucket. It shares this scan, and the percentiles/Apdex brackets are
        -- computed over the raw rows, so they are exact rather than an average of averages.
        -- Third set is the per-scenario "total" series. It rounds the summed count
        -- rather than summing already-rounded per-sampler throughputs, which the JS
        -- Map did: measured up to 0.47 req/s apart on a 13.5 req/s bucket with ~140
        -- samplers. The rounded sum is the accurate one; it too is free here, where summing
        -- already-rounded per-sampler throughputs in JS was not.
        GROUP BY GROUPING SETS (
          (bd.scenario_name, bd.transaction_name, bd.sampler_name, bd.bucket_time,
           th.tx_threshold, wt.apdex_threshold),
          (bd.bucket_time),
          (bd.scenario_name, bd.bucket_time)
        )
      ),
      computed AS (
        SELECT
          g_scenario,
          g_txn,
          scenario_name,
          transaction_name,
          sampler_name,
          bucket_time,
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
      )`;

    const panelValues = REQUEST_PANEL_VALUES.map(
      (m) => `(${m.panelId}, c.${m.column}::double precision)`
    ).join(', ');

    const rowsSelect = `
      SELECT
        CASE WHEN c.g_scenario = 1 THEN $10 ELSE c.scenario_name END as scenario_name,
        CASE
          WHEN c.g_scenario = 1 THEN $11
          WHEN c.g_txn = 1 THEN 'total'
          -- Metric name for the request level: drop the transaction prefix when it
          -- adds nothing (no Transaction Controller, or it equals the sampler).
          WHEN c.transaction_name IS NULL
            OR c.transaction_name = ''
            OR c.transaction_name = 'overall'
            OR c.transaction_name = c.sampler_name THEN c.sampler_name
          ELSE c.transaction_name || '.' || c.sampler_name
        END as metric_name,
        v.panel_id,
        v.value,
        c.bucket_time,
        c.timestep
      FROM computed c
      CROSS JOIN LATERAL (VALUES ${panelValues}) AS v(panel_id, value)
      WHERE c.g_txn = 0 OR c.g_scenario = 1

      UNION ALL

      -- Per-scenario "total" throughput. The roll-up row already covers every sampler,
      -- so it must not also produce a second "total" series.
      SELECT
        c.scenario_name,
        'total',
        ${METRIC_TYPE_PANEL_IDS.REQ_THROUGHPUT},
        c.throughput::double precision,
        c.bucket_time,
        c.timestep
      FROM computed c
      WHERE c.g_scenario = 0 AND c.g_txn = 1`;

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
      ALL_AGGREGATED_SCENARIO,
      ALL_AGGREGATED_METRIC,
    ];

    return { aggregateCte, rowsSelect, params };
  }
}
