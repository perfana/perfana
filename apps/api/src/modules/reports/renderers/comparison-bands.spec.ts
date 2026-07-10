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
  it('bands positive diffs with REPORT_COLORS.dot-aligned hexes', () => {
    expect(bandColor(5, t)).toBe('#43a047');
    expect(bandColor(25, t)).toBe('#f59e0b');
    expect(bandColor(75, t)).toBe('#e04944');
  });
  it('greys null', () => {
    expect(bandColor(null, t)).toBe('#9e9e9e');
  });
});

describe('statusFromConclusion (rule 01 — one status scale)', () => {
  it('maps full regressions and unclassified increases to regression', () => {
    expect(statusFromConclusion('regression')).toBe('regression');
    expect(statusFromConclusion('increase')).toBe('regression');
    expect(statusFromConclusion('REGRESSION')).toBe('regression'); // overall conclusion casing
  });
  it('maps partial regressions/increases to warning', () => {
    expect(statusFromConclusion('partial regression')).toBe('warning');
    expect(statusFromConclusion('partial_regression')).toBe('warning');
    expect(statusFromConclusion('partial increase')).toBe('warning');
  });
  it('maps improvements/decreases (full and partial) to improvement', () => {
    expect(statusFromConclusion('improvement')).toBe('improvement');
    expect(statusFromConclusion('decrease')).toBe('improvement');
    expect(statusFromConclusion('partial improvement')).toBe('improvement');
    expect(statusFromConclusion('partial decrease')).toBe('improvement');
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
