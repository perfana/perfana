/**
 * Transactions Processor for Performance Test Metrics Pipeline
 *
 * Processes transactions table and creates transaction-level metrics organized by:
 * - Scenario -> Dashboard
 * - Metric type -> Panel (one panel per metric type, all transactions in one panel)
 * - Metric name = "{transactionName}"
 *
 * Like the requests processor, the aggregate is written straight to ds_metrics by
 * `insertDsMetricsFromAggregate` — no row is materialised in JS.
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

export interface TransactionsProcessorResult {
  rowsInserted: number;
  compareConfigs: DsCompareConfigRecord[];
}

/** Panel ID -> the `computed` column holding its value. */
const TRANSACTION_PANEL_VALUES: Array<{ panelId: number; column: string }> = [
  { panelId: METRIC_TYPE_PANEL_IDS.TXN_RT_AVG, column: 'avg_response_time' },
  { panelId: METRIC_TYPE_PANEL_IDS.TXN_RT_P90, column: 'p90_response_time' },
  { panelId: METRIC_TYPE_PANEL_IDS.TXN_RT_P95, column: 'p95_response_time' },
  { panelId: METRIC_TYPE_PANEL_IDS.TXN_RT_P99, column: 'p99_response_time' },
  { panelId: METRIC_TYPE_PANEL_IDS.TXN_ERROR_RATE, column: 'error_rate' },
  { panelId: METRIC_TYPE_PANEL_IDS.TXN_THROUGHPUT, column: 'throughput' },
  { panelId: METRIC_TYPE_PANEL_IDS.TXN_APDEX, column: 'apdex_score' },
];

const TRANSACTION_PANEL_IDS = TRANSACTION_PANEL_VALUES.map((m) => m.panelId);

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
    bucketSizeSeconds: number,
    isIncremental: boolean
  ): Promise<TransactionsProcessorResult> {
    const compareConfigs: DsCompareConfigRecord[] = [];

    const { dashboards, scenarioNames } = await resolveScenarioDashboards({
      dataSource: this.dataSource,
      dashboardManager: this.dashboardManager,
      logger: this.logger,
      table: 'transactions',
      testRunId,
      testRun,
    });

    if (scenarioNames.length === 0) {
      this.logger.warn(`⚠️  No transactions data found for test run ${testRunId}`);
      return { rowsInserted: 0, compareConfigs };
    }

    // Display-only: the all-aggregated dashboard gets no compare configs, so ADAPT does
    // not evaluate the roll-up.
    for (const scenarioName of scenarioNames) {
      const dashboard = dashboards.get(scenarioName);
      if (dashboard) {
        this.addPanelCompareConfigs(testRun, dashboard, compareConfigs);
      }
    }

    const { aggregateCte, rowsSelect, params } = this.buildTransactionsAggregate(
      testRunId,
      testRun,
      apdexThresholds,
      bucketSizeSeconds
    );

    const rowsInserted = await insertDsMetricsFromAggregate({
      dataSource: this.dataSource,
      aggregateCte,
      rowsSelect,
      params,
      dashboards,
      panelIds: TRANSACTION_PANEL_IDS,
      testRunId,
      testRun,
      isIncremental,
    });

    this.logger.info(`✅ Created ${rowsInserted} transaction metrics`);

    return { rowsInserted, compareConfigs };
  }

  /** One panel-level compare config per (dashboard, panel). */
  private addPanelCompareConfigs(
    testRun: TestRunMetadata,
    dashboard: DashboardMetadata,
    compareConfigs: DsCompareConfigRecord[]
  ): void {
    for (const panelId of TRANSACTION_PANEL_IDS) {
      const panel = this.dashboardManager.getMetricTypePanel(panelId);
      const aggregation = METRIC_TYPE_PANEL_ADAPT_AGGREGATION[panelId];

      compareConfigs.push(
        CLASSIFIED_TXN_PANELS.has(panelId)
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
   * Aggregate transactions data at database level.
   * Uses TimescaleDB's time_bucket() and PostgreSQL's PERCENTILE_CONT.
   *
   * Apdex bracket counts are computed in SQL using a LEFT JOIN to
   * workload_transaction_apdex_thresholds, so no response-time arrays are
   * materialised in JS heap.
   *
   * For incremental collection:
   * - Bucket alignment uses original start_time for consistency across increments
   * - WHERE clause uses filter_from_time/filter_to_time for time range filtering
   */
  private buildTransactionsAggregate(
    testRunId: string,
    testRun: TestRunMetadata,
    apdexThresholds: ApdexThresholdLookup,
    bucketSizeSeconds: number
  ): { aggregateCte: string; rowsSelect: string; params: unknown[] } {
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
    // $10 = roll-up scenario name
    // $11 = roll-up metric name
    // $12 = organization_id (optional, only when hasOrgFilter)
    const orgFilterClause = hasOrgFilter
      ? 'AND (organization_id = $12 OR organization_id IS NULL)'
      : '';

    const aggregateCte = `
      per_txn_thresholds AS (
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
          -- Which grouping set produced this row: per-transaction, run-wide roll-up,
          -- or the per-scenario "total" the JS loop used to accumulate into a Map.
          GROUPING(bd.scenario_name) as g_scenario,
          GROUPING(bd.transaction_name) as g_txn,
          bd.scenario_name,
          bd.transaction_name,
          bd.bucket_time,
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
        -- Second grouping set rolls every scenario and transaction up into one series per
        -- bucket. It shares this scan, and the percentiles/Apdex brackets are computed over
        -- the raw rows, so they are exact rather than an average of per-transaction values.
        -- Third set is the per-scenario "total" series. It rounds the summed count
        -- rather than summing already-rounded per-transaction throughputs, which the JS
        -- Map did: measured up to 0.47 req/s apart on a 13.5 req/s bucket with ~140
        -- transactions. The rounded sum is the accurate one.
        GROUP BY GROUPING SETS (
          (bd.scenario_name, bd.transaction_name, bd.bucket_time, COALESCE(pt.apdex_threshold, $9)),
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
          bucket_time,
          avg_response_time,
          p90_response_time,
          p95_response_time,
          p99_response_time,
          ROUND((error_count::numeric / NULLIF(transaction_count, 0) * 100)::numeric, 2) as error_rate,
          ROUND((transaction_count::numeric / $4)::numeric, 2) as throughput,
          -- Absolute timestep from test start for consistent values across incremental runs
          FLOOR(EXTRACT(EPOCH FROM (bucket_time - $5::timestamp)) / $4)::integer as timestep,
          CASE
            WHEN apdex_total > 0
            THEN (apdex_satisfied + apdex_tolerating * 0.5) / apdex_total
            ELSE NULL
          END as apdex_score
        FROM aggregated
      )`;

    const panelValues = TRANSACTION_PANEL_VALUES.map(
      (m) => `(${m.panelId}, c.${m.column}::double precision)`
    ).join(', ');

    const rowsSelect = `
      SELECT
        CASE WHEN c.g_scenario = 1 THEN $10 ELSE c.scenario_name END as scenario_name,
        CASE
          WHEN c.g_scenario = 1 THEN $11
          WHEN c.g_txn = 1 THEN 'total'
          ELSE c.transaction_name
        END as metric_name,
        v.panel_id,
        v.value,
        c.bucket_time,
        c.timestep
      FROM computed c
      CROSS JOIN LATERAL (VALUES ${panelValues}) AS v(panel_id, value)
      WHERE c.g_txn = 0 OR c.g_scenario = 1

      UNION ALL

      -- Per-scenario "total" throughput. The roll-up row already covers every
      -- transaction, so it must not also produce a second "total" series.
      SELECT
        c.scenario_name,
        'total',
        ${METRIC_TYPE_PANEL_IDS.TXN_THROUGHPUT},
        c.throughput::double precision,
        c.bucket_time,
        c.timestep
      FROM computed c
      WHERE c.g_scenario = 0 AND c.g_txn = 1`;

    const baseParams: unknown[] = [
      testRunId,                              // $1
      filterFromTime,                         // $2
      hasFilterEndTime ? filterToTime : null, // $3
      bucketSizeSeconds,                      // $4
      testRun.start_time,                     // $5
      testRun.system_under_test_id,           // $6
      testRun.test_environment,               // $7
      testRun.workload,                       // $8
      fallbackThreshold,                      // $9
      ALL_AGGREGATED_SCENARIO,                // $10
      ALL_AGGREGATED_METRIC,                  // $11
    ];
    const params = hasOrgFilter
      ? [...baseParams, testRun.organization_id] // $12
      : baseParams;

    return { aggregateCte, rowsSelect, params };
  }
}
