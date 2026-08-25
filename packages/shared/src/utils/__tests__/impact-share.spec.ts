import { formatImpactShare, sumImpact } from '../index';

describe('sumImpact', () => {
  it('adds the impact of every row', () => {
    expect(sumImpact([{ impact: 50000 }, { impact: 30000 }])).toBe(80000);
  });

  it('counts a missing or non-numeric impact as zero rather than poisoning the sum', () => {
    // The web row types make `impact` optional, and one NaN would turn the whole
    // denominator into NaN — which would render every score as '0'.
    expect(sumImpact([{ impact: 100 }, {}, { impact: null }, { impact: NaN }])).toBe(100);
  });

  it('is 0 for an empty set', () => {
    expect(sumImpact([])).toBe(0);
  });
});

describe('formatImpactShare', () => {
  it('scores a row as its share of the total', () => {
    expect(formatImpactShare(50000, 80000)).toBe('62.5');
    expect(formatImpactShare(30000, 80000)).toBe('37.5');
  });

  it('returns 0 for an all-zero run rather than dividing by zero', () => {
    expect(formatImpactShare(0, 0)).toBe('0');
    expect(formatImpactShare(5, 0)).toBe('0');
  });

  it('returns 0 for a row that consumed nothing', () => {
    expect(formatImpactShare(0, 100)).toBe('0');
  });

  it('is defensive about junk input', () => {
    expect(formatImpactShare(-5, 100)).toBe('0');
    expect(formatImpactShare(NaN, 100)).toBe('0');
    expect(formatImpactShare(5, NaN)).toBe('0');
    expect(formatImpactShare(5, -100)).toBe('0');
  });

  it("reads '<0.1' for a row under a tenth of a percent, never a rounded 0.0", () => {
    // A row that made the top ten did consume time; '0.0' reads as a bug, and a
    // rounded '0.1' would make a long tail visibly sum past 100.
    expect(formatImpactShare(1, 1_000_000)).toBe('<0.1');
  });

  it('sums to about 100 across a row set with no long tail', () => {
    const rows = [{ impact: 50000 }, { impact: 30000 }, { impact: 20000 }];
    const total = sumImpact(rows);
    const sum = rows.reduce((acc, r) => acc + Number(formatImpactShare(r.impact, total)), 0);
    expect(sum).toBeCloseTo(100, 1);
  });

  it('ranks identically to the raw impact it replaces', () => {
    // The whole claim of the refactor: readable numbers, same ordering.
    const rows = [{ impact: 10 }, { impact: 400 }, { impact: 90 }];
    const total = sumImpact(rows);
    const byRaw = [...rows].sort((a, b) => b.impact - a.impact).map((r) => r.impact);
    const byScore = [...rows]
      .sort((a, b) => Number(formatImpactShare(b.impact, total)) - Number(formatImpactShare(a.impact, total)))
      .map((r) => r.impact);
    expect(byScore).toEqual(byRaw);
  });
});
