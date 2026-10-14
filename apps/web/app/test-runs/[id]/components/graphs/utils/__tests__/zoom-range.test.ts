import { zoomRangeFromRelayout } from '../chart-utils';

/** 10 samples, one minute apart. */
const ts = Array.from({ length: 10 }, (_, i) =>
  new Date(Date.UTC(2026, 9, 14, 5, i)).toISOString(),
);

describe('zoomRangeFromRelayout', () => {
  it('maps a fractional index range to the samples it covers, rounded outwards', () => {
    expect(zoomRangeFromRelayout({ 'xaxis.range[0]': 2.4, 'xaxis.range[1]': 5.6 }, ts, false)).toEqual({
      from: ts[2],
      to: ts[6],
    });
  });

  it('resets only on autorange, and only while zoomed', () => {
    expect(zoomRangeFromRelayout({ 'xaxis.autorange': true }, ts, true)).toBeNull();
    expect(zoomRangeFromRelayout({ 'xaxis.autorange': true }, ts, false)).toBeUndefined();
  });

  it('ignores the full-span range the layout writes on every render', () => {
    // Reading this as a reset would refetch the whole run on each redraw.
    expect(zoomRangeFromRelayout({ 'xaxis.range[0]': 0, 'xaxis.range[1]': 9 }, ts, true)).toBeUndefined();
  });

  it('ignores a window too small to refine, a reversed drag aside', () => {
    expect(zoomRangeFromRelayout({ 'xaxis.range[0]': 4, 'xaxis.range[1]': 4.2 }, ts, false)).toBeUndefined();
    expect(zoomRangeFromRelayout({ 'xaxis.range[0]': 7.8, 'xaxis.range[1]': 1.2 }, ts, false)).toEqual({
      from: ts[1],
      to: ts[8],
    });
  });

  it('ignores an event that carries no x range', () => {
    expect(zoomRangeFromRelayout({ dragmode: 'zoom' }, ts, true)).toBeUndefined();
  });
});
