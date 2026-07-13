import { bandOf, rankOf, worstBand, gatedDiffPercent, DiffThresholds } from '../compare-bands';
import { DEFAULT_DISPLAY_CONFIG, getMetricColumns, toDiffThresholds, graphKeyOf } from '../compare-utils';

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

describe('display-config helpers', () => {
  it('default columns are avg + p95 + p99 (p90 off)', () => {
    expect(getMetricColumns(DEFAULT_DISPLAY_CONFIG)).toEqual(['avg', 'q95', 'q99']);
  });
  it('enabling p90 inserts it before p95/p99', () => {
    const cfg = { ...DEFAULT_DISPLAY_CONFIG, percentiles: { p90: true, p95: true, p99: true } };
    expect(getMetricColumns(cfg)).toEqual(['avg', 'q90', 'q95', 'q99']);
  });
  it('maps UI thresholds onto band-logic fields', () => {
    const t = toDiffThresholds({ ...DEFAULT_DISPLAY_CONFIG, warningThreshold: 10, regressionThreshold: 50, minAbsolute: 0 });
    expect(t).toEqual({ good: 10, warning: 50, minAbsolute: undefined });
    expect(toDiffThresholds({ ...DEFAULT_DISPLAY_CONFIG, minAbsolute: 5 }).minAbsolute).toBe(5);
  });
  it('graphKeyOf is unique per dashboard+panel+metric', () => {
    expect(graphKeyOf('d1', 3, 'cpu')).toBe('d1::3::cpu');
  });
});
