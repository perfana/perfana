import { EMPTY, fmtClock, fmtDay, fmtDayHM, fmtHM, ft, fv, niceStep, tickValues } from './format';
import { catColor, nextFreeSlot } from './tokens';

describe('fv — series-table values', () => {
  it('picks decimals by magnitude so a column lines up', () => {
    expect(fv(12345.6)).toBe('12,346');
    expect(fv(1000)).toBe('1,000');
    expect(fv(432.1)).toBe('432');
    expect(fv(43.21)).toBe('43.2');
    expect(fv(4.321)).toBe('4.32');
    expect(fv(0.4321)).toBe('0.432');
    expect(fv(0)).toBe('0');
  });

  it('is an em dash for anything unusable, never 0', () => {
    expect(fv(null)).toBe(EMPTY);
    expect(fv(undefined)).toBe(EMPTY);
    expect(fv(NaN)).toBe(EMPTY);
    expect(fv(Infinity)).toBe(EMPTY);
  });

  it('applies the same rules to negatives', () => {
    expect(fv(-43.21)).toBe('-43.2');
    expect(fv(-0.5)).toBe('-0.500');
  });
});

describe('ft — tick labels', () => {
  it('drops trailing zeros but keeps grouping', () => {
    expect(ft(43.0)).toBe('43');
    expect(ft(4.5)).toBe('4.5');
    expect(ft(0.5)).toBe('0.5');
    expect(ft(1000)).toBe('1,000');
    expect(ft(0)).toBe('0');
  });

  it('is blank, not an em dash, for a missing tick', () => {
    expect(ft(undefined)).toBe('');
    expect(ft(NaN)).toBe('');
  });
});

describe('niceStep / tickValues', () => {
  it('rounds up to 1/2/2.5/5 × 10ⁿ', () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1.4)).toBe(2);
    expect(niceStep(2.2)).toBe(2.5);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(230)).toBe(250);
    expect(niceStep(0.03)).toBe(0.05);
  });

  it('never returns a zero or negative step', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
    expect(niceStep(NaN)).toBe(1);
  });

  it('builds ticks from zero to just past the max', () => {
    expect(tickValues(95, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(tickValues(0, 4)).toEqual([0]);
  });
});

describe('colour slots', () => {
  it('assigns by slot, not by index, and wraps once the palette runs out', () => {
    expect(catColor(0, 'light')).toBe('#2563eb');
    expect(catColor(8, 'light')).toBe(catColor(0, 'light'));
    expect(catColor(0, 'dark')).toBe('#60a5fa');
  });

  it('never returns undefined for a junk slot', () => {
    expect(catColor(-1, 'light')).toBe(catColor(1, 'light'));
    expect(catColor(NaN, 'light')).toBe(catColor(0, 'light'));
  });

  it('reuses the lowest freed slot, so removing a series never recolours the rest', () => {
    expect(nextFreeSlot([0, 1, 2])).toBe(3);
    // Series in slot 1 was removed: the next one added takes 1 back, and slots 0 and 2
    // keep the colours the user has been reading.
    expect(nextFreeSlot([0, 2])).toBe(1);
    expect(nextFreeSlot([])).toBe(0);
    expect(nextFreeSlot([undefined, 0])).toBe(1);
  });
});

describe('fmtClock', () => {
  it('is HH:MM:SS, and an em dash for an unparseable time', () => {
    expect(fmtClock('2026-01-02T03:04:05Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(fmtClock('not a time')).toBe(EMPTY);
  });
});

/**
 * The date tick formatters the Trends axis uses. `trends-plot-x-axis.test.ts` asserts
 * their SHAPE through the hook, because the label is rendered in the viewer's timezone and
 * an exact string would pass only where the suite happens to run. What is pinned here is
 * what does NOT depend on a timezone: `en-GB` ordering, the padded day, and the fact that
 * an unparseable date is a BLANK tick rather than the em dash `fv` would print.
 */
describe('fmtHM / fmtDay / fmtDayHM', () => {
  it('is HH:MM, day-before-month, with a padded day', () => {
    expect(fmtHM('2026-10-04T14:30:00Z')).toMatch(/^\d{2}:\d{2}$/);
    // `04 Oct`, never `10/04` — a reader must not have to guess October from April.
    expect(fmtDay('2026-10-04T12:00:00Z')).toMatch(/^\d{2} [A-Z][a-z]{2,3}$/);
    expect(fmtDay('2026-01-04T12:00:00Z')).toMatch(/^04 Jan$/);
  });

  it('puts the date before the clock, separated by one space', () => {
    const label = fmtDayHM('2026-10-04T14:30:00Z');
    expect(label).toMatch(/^\d{2} [A-Z][a-z]{2,3} \d{2}:\d{2}$/);
    expect(label.startsWith(fmtDay('2026-10-04T14:30:00Z'))).toBe(true);
  });

  it('is a BLANK tick for an unparseable time, not an em dash', () => {
    // An axis with an em dash on it reads as a data point; a blank reads as no label.
    for (const f of [fmtHM, fmtDay, fmtDayHM]) {
      expect(f('not a time')).toBe('');
      expect(f(NaN)).toBe('');
    }
    // ...whereas the table formatter does print one. The two are deliberately different.
    expect(fv(NaN)).toBe(EMPTY);
  });

  it('accepts a Date, a number and a string alike', () => {
    const t = Date.UTC(2026, 9, 4, 14, 30);
    expect(fmtDay(new Date(t))).toBe(fmtDay(t));
    expect(fmtDay(new Date(t).toISOString())).toBe(fmtDay(t));
  });
});
