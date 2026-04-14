/**
 * Metrics Builder for Performance Test Metrics Pipeline
 *
 * Handles building cleaned metric names and creating ds_metrics/ds_compare_config records
 * according to the new architecture:
 * - Metric names exclude scenario and transaction names (moved to dashboard/panel structure)
 * - Request-level: "{samplerName}.{metricType}.{aggregation}"
 * - Transaction-level: "{metricType}.{aggregation}"
 * - Scenario-level: "{metricType}" (e.g., "avg_active_threads")
 */

import type { DashboardMetadata, PanelMetadata } from './dashboard-manager.js';
import {
  METRIC_NAME_TEMPLATES as _METRIC_NAME_TEMPLATES,
  AGGREGATION_TYPES as _AGGREGATION_TYPES,
  PERFORMANCE_METRIC_CLASSIFICATIONS as _PERFORMANCE_METRIC_CLASSIFICATIONS,
  DEFAULT_PERFORMANCE_THRESHOLDS,
  DEFAULT_VALUE_IF_CONTROL_GROUP_MISSING,
} from '../../constants/performance-metrics.js';
import type { MetricClassification } from '../../constants/performance-metrics.js';
import type {
  DsMetricsRecord,
  DsCompareConfigRecord,
  TestRunMetadata,
} from '../../types/performance-metrics.js';

/**
 * Build a cleaned metric name for request-level metrics
 * Removes scenario and transaction names, keeps sampler name
 *
 * @param samplerName - The sampler/request name (e.g., "homepage", "api_call")
 * @param metricType - The metric type from METRIC_NAME_TEMPLATES
 * @param aggregationType - Optional aggregation type from AGGREGATION_TYPES
 * @returns Cleaned metric name (e.g., "homepage.response_time.avg")
 */
export function buildRequestMetricName(
  samplerName: string,
  metricType: string,
  aggregationType?: string
): string {
  return aggregationType
    ? `${samplerName}.${metricType}.${aggregationType}`
    : `${samplerName}.${metricType}`;
}

/**
 * Build a cleaned metric name for transaction-level metrics
 * Removes scenario and transaction names completely
 *
 * @param metricType - The metric type from METRIC_NAME_TEMPLATES
 * @param aggregationType - Optional aggregation type from AGGREGATION_TYPES
 * @returns Cleaned metric name (e.g., "response_time.avg")
 */
export function buildTransactionMetricName(
  metricType: string,
  aggregationType?: string
): string {
  return aggregationType ? `${metricType}.${aggregationType}` : metricType;
}

/**
 * Build a cleaned metric name for scenario-level metrics
 * Just the metric type itself
 *
 * @param metricType - The metric type (e.g., "avg_active_threads")
 * @returns Cleaned metric name (e.g., "avg_active_threads")
 */
export function buildScenarioMetricName(metricType: string): string {
  return metricType;
}

// ---------------------------------------------------------------------------
// Panel-per-metric-type naming helpers (v2)
// ---------------------------------------------------------------------------

/**
 * Build a metric name for the new panel-per-metric-type structure (transaction level).
 * Returns just the transaction name — the metric type is implied by the panel.
 *
 * @param transactionName - e.g. "checkout"
 * @returns e.g. "checkout"
 */
export function buildNewTransactionMetricName(transactionName: string): string {
  return transactionName;
}

/**
 * Build a metric name for the new panel-per-metric-type structure (request level).
 * Returns "{transactionName}.{samplerName}" — the metric type is implied by the panel.
 * When transactionName equals samplerName (no JMeter Transaction Controller — each
 * request IS its own transaction), or is empty/'overall', returns just the samplerName
 * to avoid redundant "label.label" metric names.
 *
 * @param transactionName - e.g. "checkout", "" for standalone samplers, or same as samplerName
 * @param samplerName - e.g. "GET /api/cart"
 * @returns e.g. "checkout.GET /api/cart" or "GET /api/cart"
 */
export function buildNewRequestMetricName(
  transactionName: string,
  samplerName: string
): string {
  if (!transactionName || transactionName === 'overall' || transactionName === samplerName) {
    return samplerName;
  }
  return `${transactionName}.${samplerName}`;
}

/**
 * Create a ds_metrics record
 *
 * @param testRunStartTime - Test run start time (optional, for analysis start offset calculation)
 * @param analysisStartOffsetTime - Analysis start offset in seconds (optional, for ramp-up calculation)
 */
export function createDsMetricsRecord(
  testRunId: string,
  dashboard: DashboardMetadata,
  panel: PanelMetadata,
  metricName: string,
  value: number,
  time: Date,
  unit: string | null,
  timestep: number,
  testRunStartTime?: Date,
  analysisStartOffsetTime?: number
): DsMetricsRecord {
  // Calculate ramp_up flag based on timing if available
  let isRampUp = false;
  if (testRunStartTime && analysisStartOffsetTime !== undefined) {
    const elapsedSeconds = (time.getTime() - testRunStartTime.getTime()) / 1000;
    isRampUp = elapsedSeconds < analysisStartOffsetTime;
  }

  return {
    test_run_id: testRunId,
    application_dashboard_id: dashboard.dashboardId,
    metrics_source_id: dashboard.metricsSourceId || null,
    dashboard_uid: dashboard.dashboardUid,
    panel_id: panel.panelId,
    time,
    metric_name: metricName,
    panel_title: panel.panelName,
    dashboard_label: dashboard.dashboardLabel,
    benchmark_ids: null,
    errors: null,
    timestep,
    ramp_up: isRampUp,
    value,
    unit,
  };
}

/**
 * Create a ds_compare_config record with classification.
 *
 * @param classificationOverride - When provided, used directly instead of
 *   parsing the metric name (required for panel-per-metric-type panels where
 *   metric names no longer contain the metric type).
 */
export function createDsCompareConfigRecord(
  testRun: TestRunMetadata,
  dashboard: DashboardMetadata,
  panel: PanelMetadata,
  metricName: string,
  aggregation: string = 'mean',
  classificationOverride?: MetricClassification
): DsCompareConfigRecord {
  const classification = classificationOverride ?? getClassificationForMetric(metricName);

  return {
    system_under_test_id: testRun.system_under_test_id,
    test_environment: testRun.test_environment,
    workload: testRun.workload,
    application_dashboard_id: dashboard.dashboardId,
    panel_id: panel.panelId,
    metric_name: metricName,
    config_data: {
      metricClassification: {
        classification: classification.classification,
        higherIsBetter: classification.higherIsBetter,
      },
      thresholds: {
        aggregation,
        percentageThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.percentageThreshold,
        iqrThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.iqrThreshold,
        absoluteThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.absoluteThreshold,
      },
      defaultValueIfControlGroupMissing: DEFAULT_VALUE_IF_CONTROL_GROUP_MISSING,
    },
  };
}

/**
 * Create a panel-level ds_compare_config record (metric_name = null).
 *
 * In the panel-per-metric-type architecture every metric in a panel shares the
 * same classification and aggregation, so one config per (dashboard, panel) is
 * sufficient.  Panel-level configs act as the default for every metric in the
 * panel while still allowing per-metric overrides to take priority in the ADAPT
 * hierarchy (metric > panel > dashboard > global > default).
 */
export function createDsCompareConfigRecordPanelLevel(
  testRun: TestRunMetadata,
  dashboard: DashboardMetadata,
  panel: PanelMetadata,
  aggregation: string = 'mean',
  classificationOverride?: MetricClassification
): DsCompareConfigRecord {
  const classification = classificationOverride ?? {
    classification: 'none',
    higherIsBetter: null,
  };

  return {
    system_under_test_id: testRun.system_under_test_id,
    test_environment: testRun.test_environment,
    workload: testRun.workload,
    application_dashboard_id: dashboard.dashboardId,
    panel_id: panel.panelId,
    metric_name: null,
    config_data: {
      metricClassification: {
        classification: classification.classification,
        higherIsBetter: classification.higherIsBetter,
      },
      thresholds: {
        aggregation,
        percentageThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.percentageThreshold,
        iqrThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.iqrThreshold,
        absoluteThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.absoluteThreshold,
      },
      defaultValueIfControlGroupMissing: DEFAULT_VALUE_IF_CONTROL_GROUP_MISSING,
    },
  };
}

/**
 * Create a panel-level ds_compare_config record without classification.
 * Used for non-baseline panels (p90, p95, p99) that are stored but not compared.
 */
export function createDsCompareConfigRecordPanelLevelNoClassification(
  testRun: TestRunMetadata,
  dashboard: DashboardMetadata,
  panel: PanelMetadata,
  aggregation: string = 'mean'
): DsCompareConfigRecord {
  return createDsCompareConfigRecordPanelLevel(testRun, dashboard, panel, aggregation, {
    classification: 'none',
    higherIsBetter: null,
  });
}

/**
 * Create a ds_compare_config record without classification
 * Used for non-baseline aggregations (p90, p95, p99) that are stored but not compared
 */
export function createDsCompareConfigRecordNoClassification(
  testRun: TestRunMetadata,
  dashboard: DashboardMetadata,
  panel: PanelMetadata,
  metricName: string,
  aggregation: string = 'mean'
): DsCompareConfigRecord {
  return {
    system_under_test_id: testRun.system_under_test_id,
    test_environment: testRun.test_environment,
    workload: testRun.workload,
    application_dashboard_id: dashboard.dashboardId,
    panel_id: panel.panelId,
    metric_name: metricName,
    config_data: {
      metricClassification: {
        classification: 'none',
        higherIsBetter: null,
      },
      thresholds: {
        aggregation,
        percentageThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.percentageThreshold,
        iqrThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.iqrThreshold,
        absoluteThreshold: DEFAULT_PERFORMANCE_THRESHOLDS.absoluteThreshold,
      },
      defaultValueIfControlGroupMissing: DEFAULT_VALUE_IF_CONTROL_GROUP_MISSING,
    },
  };
}

/**
 * Determine classification for a metric based on its name
 * Helper function since we no longer use fixed panel IDs for classification
 */
function getClassificationForMetric(metricName: string): {
  classification: string;
  higherIsBetter: boolean | null;
} {
  // Check metric name patterns to determine classification
  if (
    metricName.includes('response_time') ||
    metricName.includes('latency') ||
    metricName.includes('connect_time')
  ) {
    return {
      classification: 'RED_duration',
      higherIsBetter: false,
    };
  }

  if (metricName.includes('error_rate') || metricName.includes('error_count')) {
    return {
      classification: 'RED_errors',
      higherIsBetter: false,
    };
  }

  if (metricName.includes('throughput')) {
    return {
      classification: 'RED_rate',
      higherIsBetter: true,
    };
  }

  if (metricName.includes('apdex_score')) {
    return {
      classification: 'RED_duration',
      higherIsBetter: true, // Apdex is 0-1, higher is better
    };
  }

  if (metricName.includes('active_threads')) {
    return {
      classification: 'load',
      higherIsBetter: null,
    };
  }

  // Default classification
  return {
    classification: 'none',
    higherIsBetter: null,
  };
}
