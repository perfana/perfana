import { formatMetricValue } from '../metric-series-table-utils';
import type { MetricTarget, MetricSeriesResult } from '../../types';

const trendResult: MetricSeriesResult = { evaluate_type: 'trend', metric_unit: '%/h', panel_type: 'graph' };

describe('formatMetricValue — trend evaluate type', () => {
  it('renders a signed slope with one decimal and the correlation with two', () => {
    const rising: MetricTarget = { target: 'VolgendeCV', value: 26.44, trend_corr: 0.6612, meets_requirement: false };
    const falling: MetricTarget = { target: 'Cache', value: -3.06, trend_corr: -0.81, meets_requirement: true };
    const flat: MetricTarget = { target: 'Idle', value: 0, trend_corr: 0.02, meets_requirement: null, weak_trend: true };

    expect(formatMetricValue(rising, trendResult)).toBe('+26.4 %/h (r 0.66)');
    expect(formatMetricValue(falling, trendResult)).toBe('-3.1 %/h (r -0.81)');
    // Zero gets no plus sign; a weak row still shows its slope so the "No clear trend" chip explains itself.
    expect(formatMetricValue(flat, trendResult)).toBe('0.0 %/h (r 0.02)');
    // The value arrives as a JSONB number but may be serialised as a string.
    expect(formatMetricValue({ target: 's', value: '12.24', trend_corr: 0.9 }, trendResult)).toBe('+12.2 %/h (r 0.90)');
  });

  it('omits the r suffix on rows without a correlation and leaves other evaluate types on the unit path', () => {
    // check_results written before the trend columns existed carry no trend_corr at all, or null.
    expect(formatMetricValue({ target: 'old', value: 5 }, trendResult)).toBe('+5.0 %/h');
    expect(formatMetricValue({ target: 'old', value: 5, trend_corr: null }, trendResult)).toBe('+5.0 %/h');
    expect(formatMetricValue({ target: 'none', value: null, trend_corr: 0.9 }, trendResult)).toBe('N/A');

    // A trend_corr on a non-trend result is ignored: the ordinary two-decimal + unit format applies.
    const avgResult: MetricSeriesResult = { evaluate_type: 'avg', metric_unit: 'ms' };
    expect(formatMetricValue({ target: 't', value: 26.44, trend_corr: 0.66 }, avgResult)).toBe('26.44 ms');
    // Apdex wins over trend when both are set on the result.
    const apdexResult: MetricSeriesResult = { evaluate_type: 'trend', panel_type: 'apdex' };
    expect(formatMetricValue({ target: 't', value: 0.9, trend_corr: 0.66 }, apdexResult)).not.toContain('%/h');
  });
});
