import { formatImpactShare, sumImpact } from '@perfana/shared/utils';

/**
 * The three Performance Analysis Top 10 lists (transactions, requests, URLs) each
 * build their `dimensions` array inline inside a hook or component that also does
 * data fetching, so there is no seam to render them through without standing up a
 * fetch harness for each. What actually changed in them is the impact dimension's
 * arithmetic — the denominator and the formatter — and that IS reachable, because
 * both halves now come from the shared module all three call.
 *
 * These tests pin the contract those three files depend on. The wiring itself
 * (title, valueHeader, valueFormatter) is asserted in the API renderer suite, which
 * shares the same two functions.
 */
describe('Top 10 impact score (shared arithmetic behind all three lists)', () => {
  // Shaped like the rows the three lists hold: `impact` is optional on the web types.
  const rows = [
    { transactionName: 'T04_Payment', impact: 197_000 },
    { transactionName: 'T05_Order', impact: 127_000 },
    { transactionName: 'T03_Shipping', impact: 77_000 },
  ];

  it('scores each row against every row in the current filter', () => {
    const total = sumImpact(rows);
    expect(total).toBe(401_000);
    expect(formatImpactShare(rows[0].impact, total)).toBe('49.1');
    expect(formatImpactShare(rows[1].impact, total)).toBe('31.7');
    expect(formatImpactShare(rows[2].impact, total)).toBe('19.2');
  });

  it('re-bases every score when the filter narrows the set', () => {
    // Changing the scenario filter changes the denominator — that is the intent:
    // the score always means "share of what you are currently looking at".
    const narrowed = rows.slice(0, 2);
    const before = formatImpactShare(rows[0].impact, sumImpact(rows));
    const after = formatImpactShare(narrowed[0].impact, sumImpact(narrowed));
    expect(before).toBe('49.1');
    expect(after).toBe('60.8');
  });

  it('survives a row whose impact never arrived', () => {
    const withHoles = [{ impact: 100 }, {}, { impact: undefined }, { impact: null }];
    const total = sumImpact(withHoles);
    expect(total).toBe(100);
    expect(formatImpactShare(100, total)).toBe('100.0');
    // A row with no impact scores 0, not NaN.
    expect(formatImpactShare(undefined as unknown as number, total)).toBe('0');
  });

  it('shows no score at all rather than NaN when nothing consumed time', () => {
    const zeroed = [{ impact: 0 }, { impact: 0 }];
    const total = sumImpact(zeroed);
    expect(total).toBe(0);
    expect(formatImpactShare(0, total)).toBe('0');
  });

  it('keeps the ranking the raw avg × count product gave', () => {
    const total = sumImpact(rows);
    const byRaw = [...rows].sort((a, b) => b.impact - a.impact).map((r) => r.transactionName);
    const byScore = [...rows]
      .sort(
        (a, b) =>
          Number(formatImpactShare(b.impact, total)) - Number(formatImpactShare(a.impact, total)),
      )
      .map((r) => r.transactionName);
    expect(byScore).toEqual(byRaw);
  });
});
