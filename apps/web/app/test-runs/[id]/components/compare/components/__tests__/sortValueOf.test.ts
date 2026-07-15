import { sortValueOf } from '../MetricsComparisonTable';
import type { MetricComparison } from '../../types/compare.types';

const c = (cur: number | null, sel: number | null): MetricComparison => ({
  metric_name: 'm', evaluate_type: 'avg', current_value: cur, selected_value: sel,
  percentage_difference: cur != null && sel ? ((cur - sel) / sel) * 100 : null,
});

describe('sortValueOf', () => {
  it('returns signed absolute delta in absolute mode', () => {
    expect(sortValueOf(c(120, 100), 'absolute', 0)).toBe(20);
    expect(sortValueOf(c(80, 100), 'absolute', 0)).toBe(-20);
  });
  it('returns percentage delta in percentage mode', () => {
    expect(sortValueOf(c(120, 100), 'percentage', 0)).toBeCloseTo(20);
  });
  it('returns NaN for missing cells or values so they sort to the end', () => {
    expect(sortValueOf(undefined, 'absolute', 0)).toBeNaN();
    expect(sortValueOf(c(null, 100), 'absolute', 0)).toBeNaN();
  });
});
