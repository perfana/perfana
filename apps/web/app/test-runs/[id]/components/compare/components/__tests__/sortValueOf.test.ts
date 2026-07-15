import { sortValueOf, buildNameMatcher } from '../MetricsComparisonTable';
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

describe('buildNameMatcher', () => {
  it('returns null for an empty search (no filtering)', () => {
    expect(buildNameMatcher('   ', false)).toBeNull();
  });
  it('substring-matches case-insensitively when regex is off', () => {
    const m = buildNameMatcher('cart', false)!;
    expect(m('T01_Add_To_Cart')).toBe(true);
    expect(m('Homepage')).toBe(false);
  });
  it('regex-matches case-insensitively when regex is on', () => {
    const m = buildNameMatcher('^(get|post)_', true)!;
    expect(m('GET_users')).toBe(true);
    expect(m('DELETE_users')).toBe(false);
  });
  it('matches nothing for an invalid regex', () => {
    const m = buildNameMatcher('(unclosed', true)!;
    expect(m('anything')).toBe(false);
  });
});
