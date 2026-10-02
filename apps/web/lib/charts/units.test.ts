/**
 * `resolveAxes` is the rule the Analyst standard is built on: one unit family, one axis.
 *
 * The two behaviours these pin down are the ones the old `assignSeriesToAxes` got wrong —
 * every unit after the first sharing `y2`, and a single unit split across both axes on a
 * 100× magnitude ratio.
 */
import { axisBadge, displayUnit, groupLabels, resolveAxes, toDisplay, unitText, windowStats } from './units';
import type { AxisSeries } from './units';

const s = (id: string, unit?: string, max?: number, min?: number): AxisSeries => ({ id, unit, max, min });

describe('resolveAxes', () => {
  it('puts one family on one left axis', () => {
    const { mode, groups } = resolveAxes([s('a', 'ms', 100), s('b', 'ms', 200)]);
    expect(mode).toBe('overlay');
    expect(groups).toHaveLength(1);
    expect(groups[0].side).toBe('L');
    expect(groups[0].axis).toBe('y');
  });

  it('keeps mixed ids of ONE family on ONE axis, drawn in a unit that fits them both', () => {
    // 0.4 s and 300 ms are both sub-second, so the family is drawn in ms: the s series
    // plots as 400 and the ms series as 300 against a single `ms` axis.
    const { mode, groups } = resolveAxes([s('a', 's', 0.4), s('b', 'ms', 300)]);
    expect(mode).toBe('overlay');
    expect(groups).toHaveLength(1);
    expect(groups[0].display.label).toBe('ms');
    expect(toDisplay(0.4, 's', groups[0].display)).toBeCloseTo(400);
    expect(toDisplay(300, 'ms', groups[0].display)).toBeCloseTo(300);
  });

  it('never splits one family across two axes on a magnitude ratio', () => {
    // 1 ms next to 5000 ms: the old rule sent the big one to the right axis.
    const { groups } = resolveAxes([s('a', 'ms', 1), s('b', 'ms', 5000)]);
    expect(groups).toHaveLength(1);
  });

  it('sends a second family to the right axis', () => {
    const { mode, groups } = resolveAxes([s('a', 'ms', 100), s('b', 'reqps', 40)]);
    expect(mode).toBe('overlay');
    expect(groups.map((g) => g.side)).toEqual(['L', 'R']);
    expect(groups[1].axis).toBe('y2');
    expect(groupLabels(groups)).toEqual(['ms', 'req/s']);
  });

  it('switches to lanes at three families, one lane each, in first-appearance order', () => {
    const { mode, groups } = resolveAxes([
      s('a', 'ms', 100),
      s('b', 'reqps', 40),
      s('c', 'percentunit', 0.8),
    ]);
    expect(mode).toBe('lanes');
    expect(groups.map((g) => g.side)).toEqual([1, 2, 3]);
    expect(groups.map((g) => g.axis)).toEqual(['y', 'y2', 'y3']);
    expect(groupLabels(groups)).toEqual(['ms', 'req/s', '%']);
  });

  it('honours an explicit split even with two families', () => {
    const { mode, groups } = resolveAxes([s('a', 'ms', 100), s('b', 'reqps', 40)], { split: true });
    expect(mode).toBe('lanes');
    expect(groups.map((g) => g.side)).toEqual([1, 2]);
  });

  it('gives each rate its own family — req/s and ops/s are not interchangeable', () => {
    const { groups } = resolveAxes([s('a', 'reqps', 40), s('b', 'ops', 900)]);
    expect(groups).toHaveLength(2);
  });

  it('gives an unknown code its own family and labels it with the code', () => {
    const { groups } = resolveAxes([s('a', 'ms', 10), s('b', 'currencyUSD', 99)]);
    expect(groups).toHaveLength(2);
    expect(groups[1].display.label).toBe('currencyUSD');
  });

  it('scales percentunit to 0-100 and labels it %', () => {
    const { groups } = resolveAxes([s('a', 'percentunit', 0.42)]);
    expect(groups[0].display.label).toBe('%');
    expect(toDisplay(0.42, 'percentunit', groups[0].display)).toBeCloseTo(42);
  });

  it('draws percent and percentunit together on one axis', () => {
    const { groups } = resolveAxes([s('a', 'percent', 90), s('b', 'percentunit', 0.5)]);
    expect(groups).toHaveLength(1);
    expect(toDisplay(90, 'percent', groups[0].display)).toBeCloseTo(90);
    expect(toDisplay(0.5, 'percentunit', groups[0].display)).toBeCloseTo(50);
  });

  it('resolves nothing for no series', () => {
    expect(resolveAxes([])).toEqual({ mode: 'overlay', groups: [] });
  });
});

describe('displayUnit', () => {
  it('auto-scales time by magnitude', () => {
    expect(displayUnit('time', 0.0004, 's').label).toBe('µs');
    expect(displayUnit('time', 0.4, 's').label).toBe('ms');
    expect(displayUnit('time', 4, 's').label).toBe('s');
  });

  it('auto-scales IEC bytes in 1024s and SI bytes in 1000s', () => {
    expect(displayUnit('data', 5 * 1024 ** 2, 'bytes')).toEqual({ label: 'MiB', divisor: 1024 ** 2 });
    expect(displayUnit('data-si', 5e6, 'decbytes')).toEqual({ label: 'MB', divisor: 1e6 });
  });

  it('auto-scales short and leaves none raw', () => {
    expect(displayUnit('short', 2_500_000, 'short')).toEqual({ label: '×1M', divisor: 1e6 });
    expect(displayUnit('short', 2_500, 'short')).toEqual({ label: '×1K', divisor: 1e3 });
    expect(displayUnit('short', 12, 'short')).toEqual({ label: '', divisor: 1 });
    expect(displayUnit('none', 12, 'none')).toEqual({ label: '', divisor: 1 });
  });

  it('keeps the series own unit when there is no data to scale against', () => {
    // All zeroes say nothing about scale; µs would be a chart of zeroes labelled wrong.
    expect(displayUnit('time', 0, 's')).toEqual({ label: 's', divisor: 1 });
  });
});

describe('unitText', () => {
  it('is empty for the unitless codes and the code itself for an unknown one', () => {
    expect(unitText('short')).toBe('');
    expect(unitText('none')).toBe('');
    expect(unitText(undefined)).toBe('');
    expect(unitText('ms')).toBe('ms');
    expect(unitText('dateTimeAsIso')).toBe('dateTimeAsIso');
  });
});

describe('windowStats', () => {
  it('reports min/mean/max in the display unit', () => {
    const display = { label: 'ms', divisor: 1e-3 };
    expect(windowStats([0.1, 0.2, 0.3], 's', display)).toEqual({ min: 100, mean: 200, max: 300 });
  });

  it('skips non-numeric samples and reports null when nothing is left', () => {
    const display = { label: 'ms', divisor: 1e-3 };
    expect(windowStats([NaN, 5], 'ms', display)).toEqual({ min: 5, mean: 5, max: 5 });
    expect(windowStats([NaN], 'ms', display)).toBeNull();
    expect(windowStats([], 'ms', display)).toBeNull();
  });
});

/**
 * `axisBadge` is the series table's axis column: the one place a reader learns WHICH of
 * two scales a line is drawn against. An empty or wrong badge there makes a two-axis
 * chart unreadable, and nothing else in the UI reports it.
 */
describe('axisBadge', () => {
  it('reports L and R in overlay mode', () => {
    const { groups } = resolveAxes([s('a', 'ms', 100), s('b', 'req/s', 50)]);
    expect(axisBadge(groups, 'a')).toBe('L');
    expect(axisBadge(groups, 'b')).toBe('R');
  });

  it('reports the lane number in lanes mode', () => {
    const { groups } = resolveAxes([s('a', 'ms', 1), s('b', 'req/s', 1), s('c', 'percent', 1)]);
    expect(axisBadge(groups, 'a')).toBe('1');
    expect(axisBadge(groups, 'c')).toBe('3');
  });

  it('is an em dash for a series on no axis — a hidden one, or one already removed', () => {
    const { groups } = resolveAxes([s('a', 'ms', 1)]);
    expect(axisBadge(groups, 'gone')).toBe('—');
    expect(axisBadge([], 'a')).toBe('—');
  });
});
