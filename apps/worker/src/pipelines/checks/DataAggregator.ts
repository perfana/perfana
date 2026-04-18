import { EntityManager } from 'typeorm';
import type { Logger } from 'pino';
import { BaseCheckService, DataAggregationError } from './BaseCheckService.js';
import { TestRun, Benchmark } from './BenchmarkMatcher.js';

export interface MetricTarget {
  target: string;
  value: number;
  isArtificial: boolean;
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
  count: number;
  is_constant: boolean;
  all_missing: boolean;
  pct_missing: number;
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
      const panelId = benchmark.configuration?.id;
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
          q10, q25, q75, q90, q95, q99,
          is_constant, all_missing, pct_missing
        FROM ds_metric_statistics
        WHERE ${whereClauses.join('\n          AND ')}
          AND (
            ${dashboardFilter}
            OR ${dynatraceFilter}
          )
      `;

      const result = await this.manager.query(metricStatisticsSql, queryParams);

      const metricStatistics: MetricStatistic[] = result.map((row: unknown) => ({
        metric_name: row.metric_name,
        mean: row.mean,
        median: row.median,
        min_value: row.min_value,
        max_value: row.max_value,
        std_dev: row.std_dev,
        q10: row.q10,
        q25: row.q25,
        q75: row.q75,
        q90: row.q90,
        q95: row.q95,
        q99: row.q99,
        last_value: row.last_value,
        count: row.count,
        is_constant: row.is_constant,
        all_missing: row.all_missing,
        pct_missing: row.pct_missing
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

      const targets: MetricTarget[] = [];
      const values: number[] = [];

      // Check if only one metric_statistic and it is artificial
      // Based on data_aggregator.py:141-152
      if (metricStatistics.length === 1 && metricStatistics[0].is_constant) {
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
        const value = this.getFieldValue(stat, fieldName);

        if (value !== null && metricName) {
          const isArtificial = stat.is_constant || false;
          targets.push({
            target: metricName,
            value: parseFloat(value.toString()),
            isArtificial
          });
          values.push(parseFloat(value.toString()));
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
      default: return stat.mean;
    }
  }
}