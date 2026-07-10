import { bandColor, percentDiff, statusFromConclusion } from './comparison-bands';

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
