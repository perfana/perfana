import { bandOf, rankOf, worstBand, gatedDiffPercent, DiffThresholds } from '../compare-bands';

const T: DiffThresholds = { good: 10, warning: 50 };

describe('compare-bands', () => {
  it('treats any diff <= 0 as good (faster/lower is better)', () => {
    expect(bandOf(-80, T)).toBe('good');
    expect(bandOf(0, T)).toBe('good');
  });
  it('uses inclusive band boundaries', () => {
    expect(bandOf(10, T)).toBe('good');   // <= good
    expect(bandOf(10.01, T)).toBe('warn');
    expect(bandOf(50, T)).toBe('warn');   // <= warning
    expect(bandOf(50.01, T)).toBe('bad');
  });
  it('returns neutral for null diff', () => {
    expect(bandOf(null, T)).toBe('neutral');
  });
  it('gates small absolute changes to 0', () => {
    // 1 -> 2 is +100% but only 1 absolute; minAbsolute 5 suppresses it
    expect(gatedDiffPercent(2, 1, 100, 5)).toBe(0);
    expect(gatedDiffPercent(20, 10, 100, 5)).toBe(100); // 10 absolute >= 5, keep
    expect(gatedDiffPercent(2, 1, 100, undefined)).toBe(100); // no gate
  });
  it('worstBand picks the most severe of a row', () => {
    expect(worstBand([2, 60, -5], T)).toBe('bad');
    expect(worstBand([2, 20], T)).toBe('warn');
    expect(worstBand([2, -30], T)).toBe('good');
    expect(rankOf('bad')).toBe(2);
  });
});
