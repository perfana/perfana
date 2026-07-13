import {
  AGGREGATED_METRIC_SPECS,
  buildAggregatedMetricSeries,
} from '../aggregated-series';

describe('aggregated-series', () => {
  it('exposes exactly the three report-parity metric specs', () => {
    expect(AGGREGATED_METRIC_SPECS.map((s) => s.metric)).toEqual([
      'transaction_response_time',
      'request_response_time',
      'error_percentage',
    ]);
    expect(AGGREGATED_METRIC_SPECS.map((s) => s.yAxisFormat)).toEqual([
      'ms',
      'ms',
      'percent',
    ]);
  });

  it('maps buckets to a stable series config + data points', () => {
    const spec = AGGREGATED_METRIC_SPECS[0]; // transaction_response_time
    const { config, data } = buildAggregatedMetricSeries(spec, [
      { time: '2026-07-13T10:00:00.000Z', value: 1823.4 },
      { time: '2026-07-13T10:01:00.000Z', value: 1901.1 },
    ]);

    // Stable id so the toggle-off path can clear by key.
    expect(config.id).toBe('aggregated-transaction_response_time');
    expect(config.source).toBe('performance-metrics');
    expect(config.yAxisFormat).toBe('ms');
    // Legend/label reads the spec title.
    expect(config.metricName).toBe(spec.title);
    expect(config.panelTitle).toBe(spec.title);

    expect(data).toEqual([
      { time: '2026-07-13T10:00:00.000Z', metric_name: spec.title, value: 1823.4, timestep: 0 },
      { time: '2026-07-13T10:01:00.000Z', metric_name: spec.title, value: 1901.1, timestep: 1 },
    ]);
  });

  it('returns an empty data array for empty buckets', () => {
    const { data } = buildAggregatedMetricSeries(AGGREGATED_METRIC_SPECS[2], []);
    expect(data).toEqual([]);
  });
});
