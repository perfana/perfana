import { buildTrendLineTrace, analysisWindowBounds } from '../slo-chart-utils';
import { defaultTrendTarget } from '../metric-series-table-utils';

/** Reference OLS slope, in units per hour, of the line the trace draws. */
function slopePerHour(trace: Record<string, unknown>): number {
  const x = trace.x as Date[];
  const y = trace.y as number[];
  return ((y[1] - y[0]) / (x[1].getTime() - x[0].getTime())) * 3_600_000;
}

describe('buildTrendLineTrace', () => {
  const start = new Date('2026-09-22T05:00:00Z');
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

  it('draws a line whose slope is the stored %/h against the series mean', () => {
    // Mean 200ms, +10 %/h => 20ms per hour.
    const x = [at(0), at(30), at(60)];
    const y = [190, 200, 210];

    const trace = buildTrendLineTrace('t', x, y, 10, at(0), at(60), '#000')!;

    expect(trace).not.toBeNull();
    expect(slopePerHour(trace)).toBeCloseTo(20, 6);
    // OLS passes through (x̄, ȳ): the midpoint of the fit is the series mean.
    const ys = trace.y as number[];
    expect((ys[0] + ys[1]) / 2).toBeCloseTo(200, 6);
    expect(trace.name).toBe('t · +10.0 %/h');
  });

  it('reads a negative slope as a downward line', () => {
    const trace = buildTrendLineTrace(
      't', [at(0), at(60)], [100, 100], -50, at(0), at(60), '#000'
    )!;
    expect(slopePerHour(trace)).toBeCloseTo(-50, 6);
    expect(trace.name).toBe('t · -50.0 %/h');
  });

  it('ignores points outside the analysis window', () => {
    // The ramp-up point would drag the mean to 600 and the line with it.
    const x = [at(0), at(30), at(60)];
    const y = [2000, 100, 100];

    const trace = buildTrendLineTrace('t', x, y, 10, at(30), at(60), '#000')!;

    const ys = trace.y as number[];
    expect((ys[0] + ys[1]) / 2).toBeCloseTo(100, 6);
  });

  it('returns null when the window holds fewer than two points', () => {
    expect(
      buildTrendLineTrace('t', [at(0)], [100], 10, at(0), at(60), '#000')
    ).toBeNull();
    expect(
      buildTrendLineTrace('t', [at(0), at(5)], [100, 100], 10, at(30), at(60), '#000')
    ).toBeNull();
  });

  it('names the series in the legend entry, not just the slope', () => {
    const trace = buildTrendLineTrace(
      'WG_01_Home', [at(0), at(60)], [100, 110], 10, at(0), at(60), '#000'
    )!;
    expect(trace.name).toBe('WG_01_Home · +10.0 %/h');
  });

  it('rounds before signing, so a tiny negative reads 0.0 like the table does', () => {
    const trace = buildTrendLineTrace(
      't', [at(0), at(60)], [100, 100], -0.04, at(0), at(60), '#000'
    )!;
    // -0.04.toFixed(1) is '-0.0'; the table shows '0.0 %/h' for the same value.
    expect(trace.name).toBe('t · 0.0 %/h');
  });

  it('draws a flat line for a constant zero series instead of dividing by its mean', () => {
    // An error-count series with no errors: mean 0, so the %-normalisation has
    // no base. The worker reports 0 %/h for it; the line must still be drawn.
    const trace = buildTrendLineTrace(
      'errors', [at(0), at(30), at(60)], [0, 0, 0], 0, at(0), at(60), '#000'
    )!;
    expect(trace).not.toBeNull();
    const ys = trace.y as number[];
    expect(ys[0]).toBe(0);
    expect(ys[1]).toBe(0);
    expect(trace.name).toBe('errors · 0.0 %/h');
  });

  it('ignores NaN samples when averaging', () => {
    const trace = buildTrendLineTrace(
      't', [at(0), at(30), at(60)], [100, NaN, 100], 0, at(0), at(60), '#000'
    )!;
    const ys = trace.y as number[];
    expect(ys[0]).toBeCloseTo(100, 6);
    expect(Number.isNaN(ys[0])).toBe(false);
  });
});

describe('analysisWindowBounds', () => {
  const start = new Date('2026-09-22T05:00:00Z');
  const end = new Date('2026-09-22T06:00:00Z');

  it('trims the run by both offsets', () => {
    const w = analysisWindowBounds(start, end, 300, 600);
    expect(w.start.toISOString()).toBe('2026-09-22T05:05:00.000Z');
    expect(w.end.toISOString()).toBe('2026-09-22T05:50:00.000Z');
  });

  it('never returns an end before the start when the offsets do not fit', () => {
    const w = analysisWindowBounds(start, end, 3000, 3000);
    expect(w.end.getTime()).toBe(w.start.getTime());
  });

  it('treats absent offsets as zero', () => {
    const w = analysisWindowBounds(start, end, undefined, undefined);
    expect(w.start.getTime()).toBe(start.getTime());
    expect(w.end.getTime()).toBe(end.getTime());
  });
});

describe('defaultTrendTarget', () => {
  const targets = [
    { target: 'passing-steep', value: -57.2, meets_requirement: true },
    { target: 'failing', value: 12.6, meets_requirement: false },
    { target: 'passing-flat', value: -8.9, meets_requirement: true },
  ];

  it('prefers a failing series over a steeper passing one', () => {
    expect(defaultTrendTarget({ evaluate_type: 'trend', targets })).toBe('failing');
  });

  it('falls back to the steepest drift when nothing failed', () => {
    expect(
      defaultTrendTarget({ evaluate_type: 'trend', targets: targets.filter(t => t.meets_requirement) })
    ).toBe('passing-steep');
  });

  it('skips an artificial target, which has no charted series to show', () => {
    // The validate_with_default_if_no_data row is judged and can be the failing
    // one, but no dashboard produced it, so selecting it renders a blank chart.
    expect(
      defaultTrendTarget({
        evaluate_type: 'trend',
        targets: [
          { target: 'default', value: 99, meets_requirement: false, is_artificial: true },
          { target: 'real', value: 3, meets_requirement: true },
        ],
      })
    ).toBe('real');
  });

  it('skips an empty-string target, which would read as "no filter" downstream', () => {
    expect(
      defaultTrendTarget({
        evaluate_type: 'trend',
        targets: [
          { target: '', value: 99, meets_requirement: false },
          { target: 'real', value: 3, meets_requirement: true },
        ],
      })
    ).toBe('real');
  });

  it('returns undefined when the targets field is absent entirely', () => {
    expect(defaultTrendTarget({ evaluate_type: 'trend' })).toBeUndefined();
  });

  it('leaves every other evaluate type showing all series', () => {
    expect(defaultTrendTarget({ evaluate_type: 'avg', targets })).toBeUndefined();
    expect(defaultTrendTarget({ evaluate_type: 'trend', targets: [] })).toBeUndefined();
  });
});
