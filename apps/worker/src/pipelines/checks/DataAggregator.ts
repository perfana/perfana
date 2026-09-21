import { EntityManager } from 'typeorm';
import type { Logger } from 'pino';
import { BaseCheckService, DataAggregationError } from './BaseCheckService.js';
import { TestRun, Benchmark } from './BenchmarkMatcher.js';
import {
  METRIC_TYPE_PANEL_IDS,
  ALL_AGGREGATED_SCENARIO,
  ALL_AGGREGATED_METRIC,
  samplerMetricNameSql,
} from '../../constants/performance-metrics.js';
import { generateScenarioDashboardLabel } from '../../utils/uuid-generator.js';

/** Perf-test panels whose stored series is a per-bucket ratio, not a per-run one. */
const POOLED_ERROR_RATE_PANELS = new Set<number>([
  METRIC_TYPE_PANEL_IDS.TXN_ERROR_RATE,
  METRIC_TYPE_PANEL_IDS.REQ_ERROR_RATE,
]);

const SCENARIO_LABEL_PREFIX = generateScenarioDashboardLabel('');

/**
 * Trend SLO floor: below this |r| the slope is noise, not a drift, and the series is
 * reported but not judged (`weak_trend`). Same shape as the Apdex sample floor.
 * ponytail: constants, not benchmark columns — make them per-SLO if a tenant needs to tune them.
 */
const TREND_MIN_CORR = 0.5;
const TREND_MIN_POINTS = 10;

export interface MetricTarget {
  target: string;
  value: number;
  isArtificial: boolean;
  /** Trend SLO: r below TREND_MIN_CORR or too few points — reported, not judged. */
  weakTrend?: boolean;
  trendCorr?: number | null;
}

export interface AggregationResult {
  panel_average: number | null;
  targets: MetricTarget[];
}

export interface MetricStatistic {
  metric_name: string;
  mean: number;
  median: number;
  min_value: number;
  max_value: number;
  std_dev: number;
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  q95: number;
  q99: number;
  last_value: number;
  trend_pct_per_hour?: number | null;
  trend_corr?: number | null;
  count: number;
  is_constant: boolean;
  all_missing: boolean;
  pct_missing: number;
  /** Pipeline-written; the scenario dashboard's label for perf-test rows. */
  dashboard_label?: string | null;
}

/**
 * Service for aggregating dsMetric data according to benchmark specifications
 * Based on data_aggregator.py:32-199
 */
export class DataAggregator extends BaseCheckService {
  constructor(
    logger: Logger,
    private manager: EntityManager
  ) {
    super(logger);
  }

  /**
   * Fetch aggregated metrics for a specific benchmark from dsMetricStatistics
   * Based on data_aggregator.py:39-199
   */
  async aggregateMetricsForBenchmark(
    testRun: TestRun,
    benchmark: Benchmark,
    metricNameFilter?: string
  ): Promise<AggregationResult> {
    try {
      // Extract panel_id from configuration.id (matches Python benchmark.panel.id)
      const config = benchmark.configuration as Record<string, unknown> | null | undefined;
      const panelId = config?.id as number | undefined;
      if (!panelId) {
        throw new DataAggregationError(`No panel ID found in benchmark ${benchmark.id} configuration`);
      }

      // Based on data_aggregator.py:48-57
      const filterCriteria = {
        test_run_id: testRun.test_run_id,
        application_dashboard_id: benchmark.application_dashboard_id,
        panel_id: panelId
      };

      // Build dynamic WHERE clause based on metric name filter
      const whereClauses = [
        'test_run_id = $1',
        'application_dashboard_id = $2',
        'panel_id = $3'
      ];

      const queryParams: unknown[] = [
        filterCriteria.test_run_id,
        filterCriteria.application_dashboard_id,
        filterCriteria.panel_id
      ];

      // Add metric name filter if provided
      if (metricNameFilter) {
        whereClauses.push(`metric_name = $${queryParams.length + 1}`);
        queryParams.push(metricNameFilter);
      }

      // RBAC: Build organization-filtered subqueries
      let dashboardFilter = 'application_dashboard_id IN (SELECT id FROM application_dashboards';
      let dynatraceFilter = 'application_dashboard_id IN (SELECT DISTINCT application_dashboard_id FROM dynatrace_queries';

      if (testRun.organization_id) {
        // Add organization filtering to subqueries (backward compatible with NULL)
        queryParams.push(testRun.organization_id, testRun.organization_id);
        const orgParamIndex1 = queryParams.length - 1;
        const orgParamIndex2 = queryParams.length;

        dashboardFilter += ` WHERE organization_id = $${orgParamIndex1} OR organization_id IS NULL)`;
        dynatraceFilter += ` WHERE organization_id = $${orgParamIndex2} OR organization_id IS NULL)`;
      } else {
        dashboardFilter += ')';
        dynatraceFilter += ')';
      }

      const metricStatisticsSql = `
        SELECT
          metric_name,
          mean, median, min_value, max_value,
          std_dev, last_value, count,
          trend_pct_per_hour, trend_corr,
          q10, q25, q75, q90, q95, q99,
          is_constant, all_missing, pct_missing,
          dashboard_label
        FROM ds_metric_statistics
        WHERE ${whereClauses.join('\n          AND ')}
          AND (
            ${dashboardFilter}
            OR ${dynatraceFilter}
          )
      `;

      const result = await this.manager.query(metricStatisticsSql, queryParams) as Record<string, unknown>[];

      const metricStatistics: MetricStatistic[] = result.map((row) => ({
        metric_name: row.metric_name as string,
        mean: row.mean as number,
        median: row.median as number,
        min_value: row.min_value as number,
        max_value: row.max_value as number,
        std_dev: row.std_dev as number,
        q10: row.q10 as number,
        q25: row.q25 as number,
        q75: row.q75 as number,
        q90: row.q90 as number,
        q95: row.q95 as number,
        q99: row.q99 as number,
        last_value: row.last_value as number,
        trend_pct_per_hour: row.trend_pct_per_hour as number | null,
        trend_corr: row.trend_corr as number | null,
        count: row.count as number,
        is_constant: row.is_constant as boolean,
        all_missing: row.all_missing as boolean,
        pct_missing: row.pct_missing as number,
        dashboard_label: (row.dashboard_label as string | null) ?? null,
      }));

      // Based on data_aggregator.py:59-131
      if (metricStatistics.length === 0) {
        this.logger.debug(
          `No metric_statistics found for filter: ${JSON.stringify(filterCriteria)}`
        );

        if (benchmark.validate_with_default_if_no_data) {
          this.logger.info(
            `Backfilling artificial dsMetricStatistics for panel ${panelId} in test run ${testRun.test_run_id}`
          );

          const defaultValue = benchmark.validate_with_default_if_no_data_value || 0.0;

          // Create and save a default dsMetricStatistics document
          // Based on data_aggregator.py:79-115
          await this.createArtificialMetricStatistic(
            testRun,
            benchmark,
            panelId,
            defaultValue
          );

          // Return aggregation result with isArtificial: true
          // Based on data_aggregator.py:116-126
          return {
            panel_average: defaultValue,
            targets: [{
              target: 'default',
              value: defaultValue,
              isArtificial: true
            }]
          };
        }

        this.logger.warn(
          `No metrics data found for panel ${panelId} in test run ${testRun.test_run_id}`
        );
        return { panel_average: null, targets: [] };
      }

      // Map aggregation type to field name
      // Based on data_aggregator.py:133-137
      const evaluateType = benchmark.evaluate_type || 'mean';
      const fieldName = this.mapAggregationTypeToField(evaluateType);

      if (fieldName === 'mean' && POOLED_ERROR_RATE_PANELS.has(panelId)) {
        // The label is pipeline-written on the statistics rows; `benchmarks.dashboard_label`
        // is nullable and user-editable, so it is neither safe to dereference nor to scope by.
        const dashboardLabel = metricStatistics[0]?.dashboard_label ?? '';
        let pooled = new Map<string, number>();
        try {
          pooled = await this.pooledErrorRates(testRun, benchmark, panelId, dashboardLabel);
        } catch (err) {
          // Degrade to the bucket mean rather than erase the check: a rollup read that
          // fails (timeout, table missing) must not turn a verdict into "no result".
          this.logger.error(
            { err },
            `Pooled error rate read failed for panel ${panelId} (${dashboardLabel}) in ${testRun.test_run_id}; using the bucket mean`
          );
        }
        // Known misses that are not worth a warning: the artificial `default` row (see
        // createArtificialMetricStatistic; `is_constant` alone also matches a real series
        // that failed in every bucket), and on panel 205 a sampler outside any Transaction
        // Controller (stored under its bare name; SAMPLER_ROLLUP_BASE_SQL drops
        // NULL-transaction rows, so it never has a rollup row and keeps the bucket mean).
        const isArtificial = (stat: MetricStatistic) => stat.is_constant && stat.metric_name === 'default';
        const isBareSampler = (name: string) =>
          panelId === METRIC_TYPE_PANEL_IDS.REQ_ERROR_RATE && !name.includes('.');
        const fellBack: string[] = [];
        for (const stat of metricStatistics) {
          const pct = pooled.get(stat.metric_name);
          if (pct !== undefined) { stat.mean = pct; }
          else if (!isArtificial(stat) && !isBareSampler(stat.metric_name)) { fellBack.push(stat.metric_name); }
        }
        // The bucket mean is the number this path exists to replace, so say when it is used.
        if (fellBack.length > 0) {
          this.logger.warn(
            `Pooled error rate unavailable for ${fellBack.length}/${metricStatistics.length} series on panel ${panelId} ` +
            `(${dashboardLabel}) in ${testRun.test_run_id}; using the bucket mean: ${fellBack.slice(0, 5).join(', ')}`
          );
        }
      }

      const targets: MetricTarget[] = [];
      const values: number[] = [];

      // Check if only one metric_statistic and it is artificial
      // Based on data_aggregator.py:141-152
      // A trend has no artificial default: a flat series has slope 0 and no correlation,
      // so it takes the weak-trend path below instead of being judged on its mean.
      if (metricStatistics.length === 1 && metricStatistics[0].is_constant && fieldName !== 'trend_pct_per_hour') {
        targets.push({
          target: 'default',
          value: metricStatistics[0].mean,
          isArtificial: true
        });
        return {
          panel_average: metricStatistics[0].mean,
          targets
        };
      }

      // Process each metric statistic
      // Based on data_aggregator.py:153-174
      for (const stat of metricStatistics) {
        const metricName = stat.metric_name;
        const isArtificial = stat.is_constant || false;
        // The artificial "default" row (validate_with_default_if_no_data) carries the default in
        // `mean` and no trend columns; a trend SLO reads it from there and judges it as given.
        const isDefaultRow = isArtificial && metricName === 'default';
        const value = fieldName === 'trend_pct_per_hour' && isDefaultRow ? stat.mean : this.getFieldValue(stat, fieldName);

        if (value !== null && metricName) {
          const target: MetricTarget = {
            target: metricName,
            value: parseFloat(value.toString()),
            isArtificial
          };
          if (fieldName === 'trend_pct_per_hour' && !isDefaultRow) {
            const r = stat.trend_corr ?? null;
            target.trendCorr = r;
            // A weak series still carries its slope so the table can show it, but is left
            // out of the panel average: an unjudged value must not tip an average_all verdict.
            // NaN r (a NaN sample poisons corr) is weak too: Math.abs(NaN) < x is false.
            target.weakTrend = r === null || !Number.isFinite(r) || Math.abs(r) < TREND_MIN_CORR || Number(stat.count) < TREND_MIN_POINTS;
          }
          targets.push(target);
          if (!target.weakTrend) { values.push(target.value); }
        }
      }

      if (targets.length === 0) {
        return { panel_average: null, targets: [] };
      }

      // Calculate panel average
      // Based on data_aggregator.py:169-174
      let panelAverage: number | null = null;
      if (benchmark.average_all) {
        panelAverage = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
      } else if (values.length > 0) {
        panelAverage = values[0];
      }

      return { panel_average: panelAverage, targets };

    } catch (error) {
      throw new DataAggregationError(
        `Failed to aggregate metrics for benchmark ${benchmark.id}: ${error}`
      );
    }
  }

  /**
   * Per-run error rate for the perf-test error-rate panels, keyed by series name.
   *
   * The stored series for panel 105/205 is `errors / count` PER BUCKET, and
   * `ds_metric_statistics.mean` averages those buckets unweighted — a bucket
   * holding one failed execution counts 100 %, the same as a bucket holding 40
   * successes counts 0 %. On a sparse transaction that read 10.97 % against a
   * real 7.49 % (WERKNL-00011, `WG_VAC_16_Stuur_Email`). The rollup tables hold
   * the pooled counts, so the SLO reads `SUM(failed) / SUM(total)` from there,
   * the same figure Performance Analysis shows.
   *
   * Always the ramp-up/ramp-down-excluded row: that is the window the bucket mean
   * it replaces was computed over (`ds_metric_statistics` holds `ramp_up = false`
   * only), and `benchmarks.exclude_ramp_up_time` has never applied to metric SLOs.
   *
   * Empty map when the dashboard is not a perf-test source or the run has no
   * rollup yet — the caller then keeps the bucket mean, as before. A thrown
   * error is the caller's to catch; it degrades the same way.
   */
  private async pooledErrorRates(
    testRun: TestRun,
    benchmark: Benchmark,
    panelId: number,
    dashboardLabel: string,
  ): Promise<Map<string, number>> {
    const isSampler = panelId === METRIC_TYPE_PANEL_IDS.REQ_ERROR_RATE;
    // The label is `Performance test metrics <scenario>` verbatim (the uid is lossy).
    const scenario = dashboardLabel.startsWith(SCENARIO_LABEL_PREFIX)
      ? dashboardLabel.slice(SCENARIO_LABEL_PREFIX.length)
      : null;
    if (scenario === null) { return new Map(); }
    const allAggregated = scenario === ALL_AGGREGATED_SCENARIO;

    // Same naming rule the writer uses (transactions-processor / requests-processor).
    const nameExpr = isSampler
      ? samplerMetricNameSql('transaction_name', 'sampler_name')
      : 'transaction_name';

    // On the all-aggregated dashboard every scenario pools into one series ($6 is
    // its name); elsewhere $6 is NULL and the rows group by their own name. The
    // processors label a NULL scenario 'default' where the rollup writes ''. The
    // EXISTS proves a perf-test source with this uid exists for the SUT/environment
    // (`application_dashboards.metrics_source_id` is not populated for these rows,
    // see TODOS.md). Rounded to 2 decimals like the stored per-bucket series.
    const rows = await this.manager.query(
      `SELECT COALESCE($6::text, ${nameExpr}) AS metric_name,
              ROUND((SUM(failed_count)::numeric / NULLIF(SUM(total_count), 0)) * 100, 2)::float AS pct
       FROM ${isSampler ? 'test_run_sampler_stats' : 'test_run_transaction_stats'}
       WHERE test_run_id = $1
         AND ramp_up_excluded = true
         AND ($2::text IS NULL OR scenario_name = $2 OR ($2 = 'default' AND scenario_name = ''))
         AND EXISTS (
           SELECT 1 FROM metrics_sources
           WHERE source_type = 'performance_test'
             AND system_under_test_id = $3 AND test_environment = $4 AND external_ref = $5
         )
       GROUP BY 1`,
      [
        testRun.test_run_id,
        allAggregated ? null : scenario,
        benchmark.system_under_test_id,
        benchmark.test_environment,
        benchmark.dashboard_uid,
        allAggregated ? ALL_AGGREGATED_METRIC : null,
      ],
    ) as Array<{ metric_name: string; pct: number | null }>;

    // pct is NULL only when a group has zero executions; keep the bucket mean there.
    return new Map(
      rows.filter((r) => r.pct !== null).map((r) => [r.metric_name, Number(r.pct)]),
    );
  }

  /**
   * Create artificial metric statistics document when no data exists
   * Based on data_aggregator.py:79-115
   */
  private async createArtificialMetricStatistic(
    testRun: TestRun,
    benchmark: Benchmark,
    panelId: number,
    defaultValue: number
  ): Promise<void> {
    const metricName = 'default';
    const now = new Date();

    // Use UPSERT to handle duplicate key conflicts during reevaluation
    // This prevents "duplicate key value violates unique constraint" errors
    // when checks are reevaluated on test runs that already have artificial statistics
    const upsertSql = `
      INSERT INTO ds_metric_statistics (
        test_run_id,
        application_dashboard_id,
        dashboard_uid,
        panel_id,
        panel_title,
        dashboard_label,
        metric_name,
        mean, median, min_value, max_value,
        std_dev, last_value, count,
        q10, q25, q75, q90, q95, q99,
        is_constant, all_missing, pct_missing,
        updated_at, test_run_start,
        organization_id, created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $8, $8, $8,
        0.0, $8, 1,
        $8, $8, $8, $8, $8, $8,
        true, false, 0.0,
        $9, $10,
        $11, 'worker-pipeline', 'worker-pipeline'
      )
      ON CONFLICT (test_run_id, application_dashboard_id, panel_id, metric_name)
      DO UPDATE SET
        mean = EXCLUDED.mean,
        median = EXCLUDED.median,
        min_value = EXCLUDED.min_value,
        max_value = EXCLUDED.max_value,
        std_dev = EXCLUDED.std_dev,
        last_value = EXCLUDED.last_value,
        count = EXCLUDED.count,
        q10 = EXCLUDED.q10,
        q25 = EXCLUDED.q25,
        q75 = EXCLUDED.q75,
        q90 = EXCLUDED.q90,
        q95 = EXCLUDED.q95,
        q99 = EXCLUDED.q99,
        is_constant = EXCLUDED.is_constant,
        all_missing = EXCLUDED.all_missing,
        pct_missing = EXCLUDED.pct_missing,
        updated_at = EXCLUDED.updated_at,
        test_run_start = EXCLUDED.test_run_start,
        dashboard_uid = EXCLUDED.dashboard_uid,
        panel_title = EXCLUDED.panel_title,
        dashboard_label = EXCLUDED.dashboard_label,
        organization_id = EXCLUDED.organization_id,
        updated_by = EXCLUDED.updated_by
    `;

    await this.manager.query(upsertSql, [
      testRun.test_run_id,
      benchmark.application_dashboard_id,
      benchmark.dashboard_uid,
      panelId,
      benchmark.panel_title || '',
      benchmark.dashboard_label,
      metricName,
      defaultValue, // Used multiple times for mean, median, min, max, last, and all percentiles
      now,
      testRun.start_time || now,
      testRun.organization_id || null
    ]);
  }

  /**
   * Map aggregation type to field name
   * Based on data_aggregator.py:180-195
   */
  private mapAggregationTypeToField(aggregationType: string): string {
    const mapping: Record<string, string> = {
      'mean': 'mean',
      'avg': 'mean',
      'min': 'min_value',
      'max': 'max_value',
      'median': 'median',
      'q10': 'q10',
      'q25': 'q25',
      'q75': 'q75',
      'q90': 'q90',
      'q95': 'q95',
      'q99': 'q99',
      'last': 'last_value',
      'trend': 'trend_pct_per_hour',
      'std': 'std_dev'
    };
    return mapping[aggregationType.toLowerCase()] || 'mean';
  }

  /**
   * Get field value from metric statistic
   */
  private getFieldValue(stat: MetricStatistic, fieldName: string): number | null {
    switch (fieldName) {
      case 'mean': return stat.mean;
      case 'median': return stat.median;
      case 'min_value': return stat.min_value;
      case 'max_value': return stat.max_value;
      case 'std_dev': return stat.std_dev;
      case 'q10': return stat.q10;
      case 'q25': return stat.q25;
      case 'q75': return stat.q75;
      case 'q90': return stat.q90;
      case 'q95': return stat.q95;
      case 'q99': return stat.q99;
      case 'last_value': return stat.last_value;
      case 'trend_pct_per_hour': return stat.trend_pct_per_hour ?? null;
      default: return stat.mean;
    }
  }
}