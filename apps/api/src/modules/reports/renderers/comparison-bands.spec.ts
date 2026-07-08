import { bandColor, percentDiff } from './comparison-bands';

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
    expect(bandColor(-80, t)).toBe('#4caf50');
  });
  it('bands positive diffs', () => {
    expect(bandColor(5, t)).toBe('#4caf50');
    expect(bandColor(25, t)).toBe('#f59e0b');
    expect(bandColor(75, t)).toBe('#db524e');
  });
  it('greys null', () => {
    expect(bandColor(null, t)).toBe('#9e9e9e');
  });
});
