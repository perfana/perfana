import { authenticatedFetch } from '@/lib/api';
import {
  ALL_AGGREGATED_OPTION,
  shouldOfferAllAggregated,
  getAggregateSpec,
} from '@/lib/aggregated-perf-series';
import { MetricDataPoint, SeriesConfig } from '../types';

/** One point of the /aggregated-metric-timeseries response `buckets` array. */
export interface AggregatedBucket {
  time: string;
  value: number;
}

/** Shape aggregated-timeseries buckets into the chart's data-point model. */
export function bucketsToDataPoints(
  buckets: AggregatedBucket[],
  metricName: string,
): MetricDataPoint[] {
  return buckets.map((b, i) => ({
    time: b.time,
    metric_name: metricName,
    value: b.value,
    timestep: i,
  }));
}

/** Default Y-axis unit for an aggregated perf metric. */
export function aggregatedYAxisFormat(metric: string): string {
  return metric === 'error_percentage' ? 'percent' : 'ms';
}

/** Prepend the "All aggregated" dropdown entry for aggregatable perf panels. */
export function offerAggregatedOption(
  source: string,
  panelId: number,
  metricNames: string[],
): string[] {
  return shouldOfferAllAggregated(source, panelId)
    ? [ALL_AGGREGATED_OPTION, ...metricNames]
    : metricNames;
}

/**
 * Fetch one panel's run-wide aggregate as a chart series' data. Routes to the
 * aggregated-timeseries endpoint using the panel's (metric, stat) spec.
 * Returns [] when the panel isn't aggregatable or on any HTTP/transport error.
 */
export async function fetchAggregatedSeriesData(
  testRunIdForQuery: string,
  series: SeriesConfig,
): Promise<MetricDataPoint[]> {
  const spec = getAggregateSpec(series.panelId);
  if (!spec) return [];
  try {
    const res = await authenticatedFetch(
      `/test-runs/${testRunIdForQuery}/aggregated-metric-timeseries?metric=${spec.metric}&stat=${spec.stat}`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!res.ok) {
      console.warn(`Failed to fetch aggregated data for series ${series.id}:`, res.statusText);
      return [];
    }
    const body: { buckets?: AggregatedBucket[] } = await res.json();
    return bucketsToDataPoints(body.buckets ?? [], series.metricName);
  } catch (err) {
    console.error(`Error fetching aggregated data for series ${series.id}:`, err);
    return [];
  }
}
