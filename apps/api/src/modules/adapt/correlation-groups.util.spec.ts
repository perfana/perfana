import { pearson, alignSeries, buildCorrelationGroups, MetricSeries } from './correlation-groups.util';

describe('pearson', () => {
  it('returns 1 for a perfectly correlated series', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 6);
  });

  it('returns -1 for a perfectly anti-correlated series', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 6);
  });

  it('returns NaN for a constant series (zero variance)', () => {
    expect(Number.isNaN(pearson([5, 5, 5], [1, 2, 3]))).toBe(true);
  });
});

describe('alignSeries', () => {
  it('inner-joins on time, keeping only shared timestamps', () => {
    const a = [{ time: 1, value: 10 }, { time: 2, value: 20 }, { time: 3, value: 30 }];
    const b = [{ time: 2, value: 5 }, { time: 3, value: 6 }, { time: 4, value: 7 }];
    expect(alignSeries(a, b)).toEqual([[20, 30], [5, 6]]);
  });
});

describe('buildCorrelationGroups', () => {
  const base = { dashboardLabel: 'svc', dashboardUid: 'uid', panelTitle: 'p', conclusionLabel: 'regression' };
  const ts = (vals: number[]): { time: number; value: number }[] => vals.map((v, i) => ({ time: i, value: v }));

  it('groups two correlated regressions and leaves an independent one ungrouped', () => {
    const series: MetricSeries[] = [
      { ...base, resultId: 'a', metricName: 'cpu', points: ts([1, 2, 3, 4, 5, 6]) },
      { ...base, resultId: 'b', metricName: 'latency', points: ts([2, 4, 6, 8, 10, 12]) }, // r=1 with a
      { ...base, resultId: 'c', metricName: 'noise', points: ts([5, 1, 9, 2, 8, 3]) },      // uncorrelated
    ];
    const result = buildCorrelationGroups(series, { primary: 0.8, metaThreshold: 0.6 });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].members.map((m) => m.resultId).sort()).toEqual(['a', 'b']);
    expect(result.groups[0].label).toBe('svc');
    expect(result.ungrouped.map((u) => u.resultId)).toEqual(['c']);
  });

  it('uses the metadata threshold only when dashboardUid matches', () => {
    // pearson([1,2,3,4,5,6,7,8], [1,4,2,5,3,6,4,7]) ≈ 0.758 — in [0.6, 0.8)
    const sameUid: MetricSeries[] = [
      { ...base, dashboardUid: 'x', resultId: 'a', metricName: 'm1', points: ts([1, 2, 3, 4, 5, 6, 7, 8]) },
      { ...base, dashboardUid: 'x', resultId: 'b', metricName: 'm2', points: ts([1, 4, 2, 5, 3, 6, 4, 7]) }, // 0.6<=|r|<0.8
    ];
    const grouped = buildCorrelationGroups(sameUid, { primary: 0.8, metaThreshold: 0.6 });
    const diffUid = sameUid.map((s, i) => ({ ...s, dashboardUid: `u${i}` }));
    const split = buildCorrelationGroups(diffUid, { primary: 0.8, metaThreshold: 0.6 });
    expect(grouped.groups).toHaveLength(1);   // same uid + medium correlation => edge
    expect(split.groups).toHaveLength(0);     // different uid + medium correlation => no edge
  });

  it('returns nothing to group for fewer than two series', () => {
    const result = buildCorrelationGroups([{ ...base, resultId: 'a', metricName: 'm', points: ts([1, 2, 3]) }], { primary: 0.8, metaThreshold: 0.6 });
    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(1);
  });
});
