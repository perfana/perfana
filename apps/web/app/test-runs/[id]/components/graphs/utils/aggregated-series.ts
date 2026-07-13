import { SeriesConfig, MetricDataPoint } from '../types';

/** One point of the /aggregated-metric-timeseries response `buckets` array. */
export interface AggregatedBucket {
  time: string;
  value: number;
}

/**
 * The run-wide aggregate metrics to overlay. Mirrors the report renderer's
 * AGGREGATED_METRICS (graphs-renderer.ts) so the interactive card and the
 * generated report agree. yAxisFormat uses Grafana-style unit strings the
 * chart's getUnitConversion understands (see graph-formatters.ts).
 */
export interface AggregatedMetricSpec {
  metric: 'transaction_response_time' | 'request_response_time' | 'error_percentage';
  title: string;
  yAxisFormat: string;
}

export const AGGREGATED_METRIC_SPECS: readonly AggregatedMetricSpec[] = [
  { metric: 'transaction_response_time', title: "All aggregated — Transaction response time (avg)", yAxisFormat: 'ms' },
  { metric: 'request_response_time', title: "All aggregated — Request response time (avg)", yAxisFormat: 'ms' },
  { metric: 'error_percentage', title: "All aggregated — Error percentage", yAxisFormat: 'percent' },
] as const;

/**
 * Shape one aggregated metric's buckets into the chart's series model. The id
 * is deterministic (`aggregated-<metric>`) so the toggle can clear it by key.
 */
export function buildAggregatedMetricSeries(
  spec: AggregatedMetricSpec,
  buckets: AggregatedBucket[],
): { config: SeriesConfig; data: MetricDataPoint[] } {
  const config: SeriesConfig = {
    id: `aggregated-${spec.metric}`,
    dashboardId: 'aggregated',
    dashboardLabel: 'Performance Test Metrics',
    panelId: -1,
    panelTitle: spec.title,
    metricName: spec.title,
    source: 'performance-metrics',
    yAxisFormat: spec.yAxisFormat,
  };

  const data: MetricDataPoint[] = buckets.map((b, i) => ({
    time: b.time,
    metric_name: spec.title,
    value: b.value,
    timestep: i,
  }));

  return { config, data };
}
