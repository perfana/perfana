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
    // driver must be one of the two grouped members
    expect(['a', 'b']).toContain(result.groups[0].driver.resultId);
    // avgCorrelation must reflect the near-perfect r=1 relationship
    expect(result.groups[0].avgCorrelation).toBeGreaterThan(0.9);
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

  it('places transitively-connected members in one group and uses proxy for correlationToDriver', () => {
    // A and C share NO overlapping timestamps (disjoint time grids) so their inner-join
    // has 0 shared points. B overlaps both A and C (≥5 each). Because A-B and B-C edges
    // exist, BFS joins all three into one component. The driver is elected first (A wins
    // on ties as idx[0]). C has no direct |r| to A, so its correlationToDriver must fall
    // back to its mean |r| to the group — which is > 0, not the misleading 0.
    //
    // A times 0-9, values linear (perfectly correlated with B's 0-5 overlap window).
    // B times 0-5 (overlap A) + 20-24 (overlap C).
    // C times 20-28 (no overlap with A).
    const tsAt = (times: number[], values: number[]) =>
      times.map((t, i) => ({ time: t, value: values[i] }));

    const seriesA: MetricSeries = {
      ...base, resultId: 'a', metricName: 'cpu',
      points: tsAt([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    };
    const seriesB: MetricSeries = {
      ...base, resultId: 'b', metricName: 'memory',
      // times 0-5 overlap A (values match A perfectly => r=1),
      // times 20-24 overlap C (values match C on those points => r=1)
      points: tsAt(
        [0, 1, 2, 3, 4, 5, 20, 21, 22, 23, 24],
        [1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50],
      ),
    };
    const seriesC: MetricSeries = {
      ...base, resultId: 'c', metricName: 'latency',
      // times 20-28, no overlap with A at all
      points: tsAt(
        [20, 21, 22, 23, 24, 25, 26, 27, 28],
        [10, 20, 30, 40, 50, 60, 70, 80, 90],
      ),
    };

    const result = buildCorrelationGroups([seriesA, seriesB, seriesC], { primary: 0.8, metaThreshold: 0.6 });

    // All three must be in one group (transitive: A-B edge + B-C edge => one component)
    expect(result.groups).toHaveLength(1);
    expect(result.ungrouped).toHaveLength(0);
    const group = result.groups[0];
    expect(group.members.map((m) => m.resultId).sort()).toEqual(['a', 'b', 'c']);

    // The transitively-connected member's correlationToDriver must NOT be 0
    // (it should reflect mean |r| to the group as a proxy — greater than 0)
    const driverResultId = group.driver.resultId;
    const transitiveMember = group.members.find(
      (m) => m.resultId !== driverResultId && m.correlationToDriver > 0,
    );
    expect(transitiveMember).toBeDefined();
    // Every non-driver member must have a positive correlationToDriver (no misleading zero)
    for (const m of group.members) {
      if (m.resultId !== driverResultId) {
        expect(m.correlationToDriver).toBeGreaterThan(0);
      }
    }
  });

  it('returns nothing to group for fewer than two series', () => {
    const result = buildCorrelationGroups([{ ...base, resultId: 'a', metricName: 'm', points: ts([1, 2, 3]) }], { primary: 0.8, metaThreshold: 0.6 });
    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(1);
  });
});
