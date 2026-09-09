import { bandColor, gatedDiffPercent, percentDiff, percentDiffScaled, statusFromConclusion } from './comparison-bands';

describe('gatedDiffPercent (minimum absolute change gate)', () => {
  it('collapses to 0 when the absolute change is below minAbsolute', () => {
    // 1ms -> 2ms is +100% but only 1ms absolute; a 5ms gate treats it as no change.
    expect(gatedDiffPercent(2, 1, 100, 5)).toBe(0);
  });
  it('passes the diff through when the absolute change meets minAbsolute', () => {
    expect(gatedDiffPercent(60, 50, 20, 5)).toBe(20);
  });
  it('is a no-op when minAbsolute is undefined', () => {
    expect(gatedDiffPercent(2, 1, 100, undefined)).toBe(100);
  });
  it('passes null through (missing values cannot be gated)', () => {
    expect(gatedDiffPercent(null, 1, null, 5)).toBeNull();
    expect(gatedDiffPercent(2, null, null, 5)).toBeNull();
  });

  // The gate is a number the user typed against the RENDERED table. A percentunit
  // pair stored 0.42/0.40 prints as "42 vs 40" — a change of 2 — so a threshold of 1
  // must let it through. Gating the raw pair compared 0.02 against 1 and silenced
  // every percentunit row.
  it('gates a percentunit pair on the scaled change, not the stored one', () => {
    expect(gatedDiffPercent(0.42, 0.4, 5, 1, 'percentunit')).toBe(5);
    expect(gatedDiffPercent(0.42, 0.4, 5, 1)).toBe(0); // unit omitted = old behaviour
  });
  it('still gates a percentunit pair whose scaled change is genuinely small', () => {
    // 40.1 vs 40.0 -> 0.1 scaled, under a threshold of 1.
    expect(gatedDiffPercent(0.401, 0.4, 0.25, 1, 'percentunit')).toBe(0);
  });
  it('scales each side by its own unit when the pairing is cross-unit', () => {
    // current 42 `percent`, baseline 0.4 `percentunit` -> 42 vs 40, a change of 2.
    expect(gatedDiffPercent(42, 0.4, 5, 1, 'percent', 'percentunit')).toBe(5);
  });
  it('leaves a non-percentunit pair alone', () => {
    expect(gatedDiffPercent(2, 1, 100, 5, 'ms')).toBe(0);
    expect(gatedDiffPercent(60, 50, 20, 5, 'ms')).toBe(20);
  });
});

describe('percentDiffScaled (cross-unit pairings)', () => {
  it('agrees with the pair the reader sees when the sides carry different units', () => {
    // 42 `percent` against 0.4 `percentunit` renders as "42 vs 40": +5%, not +10400%.
    expect(percentDiffScaled(42, 0.4, 'percent', 'percentunit')).toBeCloseTo(5);
    expect(percentDiff(42, 0.4)).toBeCloseTo(10400); // what it used to report
  });
  it('is identical to percentDiff when both sides share a unit', () => {
    // Scaling both sides by the same factor cancels, which is why the same-unit
    // call sites need no change.
    for (const unit of ['ms', 'percentunit', 'percent', undefined]) {
      expect(percentDiffScaled(110, 100, unit, unit)).toBeCloseTo(percentDiff(110, 100)!);
    }
  });
  it('falls back to the current unit when baselineUnit is absent', () => {
    expect(percentDiffScaled(0.42, 0.4, 'percentunit', null)).toBeCloseTo(percentDiff(42, 40)!);
  });
  it('returns null when either side is missing', () => {
    expect(percentDiffScaled(null, 0.4, 'percent', 'percentunit')).toBeNull();
    expect(percentDiffScaled(42, null, 'percent', 'percentunit')).toBeNull();
  });
});

describe('percentDiff', () => {
  it('computes percent change vs baseline magnitude', () => {
    expect(percentDiff(110, 100)).toBeCloseTo(10);
    expect(percentDiff(50, 100)).toBeCloseTo(-50);
  });
  it('returns null on null/zero baseline', () => {
    expect(percentDiff(10, null)).toBeNull();
    expect(percentDiff(10, 0)).toBeNull();
    expect(percentDiff(null, 100)).toBeNull();
  });
});

describe('bandColor', () => {
  const t = { good: 10, warning: 50 };
  it('greens improvements regardless of magnitude', () => {
    expect(bandColor(-80, t)).toBe('#43a047');
  });
  it('bands positive diffs with REPORT_COLORS.dot-aligned hexes, inclusive boundaries', () => {
    expect(bandColor(5, t)).toBe('#43a047');
    expect(bandColor(10, t)).toBe('#43a047'); // ≤ good — matches statusFor's OK
    expect(bandColor(25, t)).toBe('#f59e0b');
    expect(bandColor(50, t)).toBe('#f59e0b'); // ≤ warning — matches statusFor's WARNING
    expect(bandColor(75, t)).toBe('#e04944');
  });
  it('greys null with the palette neutral', () => {
    expect(bandColor(null, t)).toBe('#bdbdbd');
  });
});

describe('statusFromConclusion (rule 01 — one status scale)', () => {
  it('maps full regressions to regression', () => {
    expect(statusFromConclusion('regression')).toBe('regression');
    expect(statusFromConclusion('REGRESSION')).toBe('regression'); // overall conclusion casing
  });
  it('maps partial regressions and ALL direction-unclassified drift to warning', () => {
    expect(statusFromConclusion('partial regression')).toBe('warning');
    expect(statusFromConclusion('partial_regression')).toBe('warning');
    // ADAPT emits increase/decrease only when higherIsBetter IS NULL —
    // the engine declined to judge direction, so the report must not
    // assert REGRESSION or IMPROVEMENT for these.
    expect(statusFromConclusion('increase')).toBe('warning');
    expect(statusFromConclusion('decrease')).toBe('warning');
    expect(statusFromConclusion('partial increase')).toBe('warning');
    expect(statusFromConclusion('partial decrease')).toBe('warning');
  });
  it('maps improvements (full and partial) to improvement', () => {
    expect(statusFromConclusion('improvement')).toBe('improvement');
    expect(statusFromConclusion('partial improvement')).toBe('improvement');
  });
  it('maps no difference and passed to ok', () => {
    expect(statusFromConclusion('no difference')).toBe('ok');
    expect(statusFromConclusion('no_difference')).toBe('ok');
    expect(statusFromConclusion('PASSED')).toBe('ok');
  });
  it('maps incomparable/ignored/skipped/unknown/null to na', () => {
    expect(statusFromConclusion('incomparable')).toBe('na');
    expect(statusFromConclusion('ignored')).toBe('na');
    expect(statusFromConclusion('SKIPPED')).toBe('na');
    expect(statusFromConclusion('no_data')).toBe('na');
    expect(statusFromConclusion('unknown')).toBe('na');
    expect(statusFromConclusion(null)).toBe('na');
    expect(statusFromConclusion(undefined)).toBe('na');
  });
});
