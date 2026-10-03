import { Logger } from '@nestjs/common';
import { ReportUtilsService } from '../services/report-utils.service';
import { CHART_INK, CHART_SIZE, chartColor } from './chart-tokens';
import { ChartSvgService, NO_WINDOW, ChartSeries } from './chart-svg.service';

/**
 * The report's server-rendered SVG chart, tested directly.
 *
 * A report is one self-contained HTML file read in an iframe with no `allow-scripts`, so
 * there is no client chart library: every chart in every section is this one function.
 * `GraphsRenderer`'s own spec covers it through a section — single and double axis, point
 * circles, ms/s tick labels, the no-data state. What is tested here is what a section
 * cannot easily reach:
 *
 * - the AXIS COLLAPSE guard. Every right-hand axis costs 56px; past a few units the plot
 *   area goes negative and the SVG is broken rather than merely cramped, so the chart
 *   collapses to one shared scale and says so in the log.
 * - "analysis range only" scaling the Y axes from the points INSIDE the window. Scaling on
 *   the whole run lets a ramp-up spike the reader cannot even see set the axis, flattening
 *   the band they asked to look at — and the chart still LOOKS fine, which is why it needs
 *   an assertion.
 * - the clipPath id being unique per chart. Several charts share one HTML document, and a
 *   repeated id makes every chart use the first one's plot rectangle.
 * - the categorical x-axis the trends charts use, whose labels come from every series
 *   rather than the first one's points.
 */
describe('ChartSvgService', () => {
  let svc: ChartSvgService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    svc = new ChartSvgService(new ReportUtilsService());
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  /** Minutes 0..n-1 from a fixed instant, so x positions are predictable. */
  const points = (values: Array<number | null>, startMs = 1_700_000_000_000) =>
    values.map((value, i) => ({ time: new Date(startMs + i * 60_000), value }));

  const series = (over: Partial<ChartSeries> = {}): ChartSeries =>
    ({
      dashboardLabel: 'JVM',
      panelTitle: 'Heap',
      metricName: 'used',
      unit: 'ms',
      dataPoints: points([10, 20, 30]),
      ...over,
    }) as ChartSeries;

  const render = (s: ChartSeries[], over: Partial<{
    title: string; offset: number; width: number; height: number;
    window: typeof NO_WINDOW; legend: boolean; style: Parameters<ChartSvgService['renderTimeSeriesChart']>[7];
  }> = {}) =>
    svc.renderTimeSeriesChart(
      over.title ?? 'Chart',
      s,
      over.offset ?? 0,
      over.width ?? 900,
      over.height ?? 300,
      over.window ?? NO_WINDOW,
      over.legend ?? true,
      over.style ?? {},
    );

  /** Every `<text ... >N</text>` on the plot, which is what the axis labels are. */
  const axisLabels = (html: string) =>
    Array.from(html.matchAll(/<text[^>]*>([^<]+)<\/text>/g)).map((m) => m[1]!.trim());

  describe('no data', () => {
    it('answers an empty state rather than an SVG when every point is null', () => {
      const html = render([series({ dataPoints: points([null, null]) })]);
      expect(html).not.toContain('<svg');
      expect(html).toContain('No data points available.');
    });

    it('answers the same for no series at all', () => {
      expect(render([])).toContain('No data points available.');
    });

    it('drops only the null points of a series that has some', () => {
      // 2 of 3 drawn: the path has two commands, not three, and no `NaN` coordinate.
      const html = render([series({ dataPoints: points([10, null, 30]) })]);
      expect(html).not.toContain('NaN');
      expect(html).toContain('2 data points');
    });
  });

  describe('axis collapse', () => {
    it('gives each unit its own right-hand spine while they fit', () => {
      const html = render([
        series({ unit: 'ms' }),
        series({ metricName: 'rate', unit: 'req/s' }),
      ]);
      // One right-hand spine for the second unit, in the standard's divider ink.
      const divider = CHART_INK.divider.replace(/[()]/g, '\\$&');
      expect((html.match(new RegExp(`stroke="${divider}"`, 'g')) ?? []).length).toBe(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it('collapses to one shared scale, and warns, when the axes would leave no plot', () => {
      // Five units want 40 + 4×56 = 264px of axis gutter; at 300px wide the plot area
      // would be negative and the SVG simply broken.
      const many = ['ms', 'req/s', 'percent', 'bytes', 'ops/s'].map((unit, i) =>
        series({ unit, metricName: `m${i}` }));
      const html = render(many, { width: 300, title: 'Cramped' });

      expect(html).toContain('<svg');
      // No right-hand spines at all once collapsed.
      expect(html).not.toContain('stroke="#ccc"');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('5 units do not fit as separate axes'));
      // ...and no negative geometry reached the markup.
      expect(html).not.toMatch(/(width|height)="-/);
    });

    it('does not warn when there is only one unit, however narrow the chart', () => {
      render([series()], { width: 120 });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('analysis window', () => {
    const base = 1_700_000_000_000;
    // A ramp-up spike of 10 000 in the first minute, then a flat band at ~20.
    const spiky = series({ unit: '', dataPoints: points([10_000, 20, 21, 22, 23]) });
    const windowFrom = base + 60_000;   // exclude the first point

    it('dims the excluded head and marks it with the amber boundary', () => {
      const html = render([spiky], { window: { from: windowFrom, to: null, only: false } });
      // The dim band is the standard's slate, at the opacity that survives a print.
      expect(html).toContain(`fill="${CHART_INK.excludedPrint}"`);
      // Amber is kept deliberately: a faint grey hairline does not print.
      expect(html).toContain('stroke="#f59e0b"');
    });

    it('scales the Y axis from the points INSIDE the window in analysis-only mode', () => {
      const whole = render([spiky], { window: { from: windowFrom, to: null, only: false } });
      const only = render([spiky], { window: { from: windowFrom, to: null, only: true } });

      // Whole-run scaling is dominated by the spike the reader cannot even see: the top
      // tick is in thousands, so the 20-23 band is flattened onto the axis line.
      expect(axisLabels(whole)[0]).toMatch(/K$/);
      // Analysis-only tops out just above the band, so the band is readable.
      const top = Number(axisLabels(only)[0]);
      expect(Number.isFinite(top)).toBe(true);
      expect(top).toBeLessThan(100);
    });

    it('falls back to the whole run when the run carries no window to zoom to', () => {
      const only = render([spiky], { window: { from: null, to: null, only: true } });
      const none = render([spiky], { window: NO_WINDOW });
      expect(only).toBe(none);
    });

    it('falls back to whole-run scaling when no point lies inside the window', () => {
      // A window past the end of the data: zooming to it would narrow the x domain onto a
      // stretch with no samples and scale every Y axis off an empty set. The band shading
      // is still drawn — that part is independent of the zoom — but the SCALES are the
      // whole run's.
      const beyond = render([spiky], { window: { from: base + 86_400_000, to: null, only: true } });
      expect(axisLabels(beyond)[0]).toBe(axisLabels(render([spiky], { window: NO_WINDOW }))[0]);
    });

    it('clips the series to the plot area, or a point outside the zoom draws over the page', () => {
      const html = render([spiky], { window: { from: windowFrom, to: null, only: true } });
      expect(html).toContain('<clipPath id="plot-clip-');
      expect(html).toContain('clip-path="url(#plot-clip-');
    });
  });

  it('gives every chart its own clipPath id, so one document can hold several', () => {
    const a = render([series()], { title: 'Heap' });
    const b = render([series()], { title: 'Threads' });
    const idOf = (html: string) => /id="(plot-clip-[^"]+)"/.exec(html)![1];
    expect(idOf(a)).not.toBe(idOf(b));
    // The colour offset is part of it too: two presets can chart the same title.
    expect(idOf(render([series()], { title: 'Heap', offset: 3 }))).not.toBe(idOf(a));
  });

  describe('legend and subtitle', () => {
    it('names a single series in the subtitle, and counts several', () => {
      expect(render([series()])).toContain('used (ms)');
      expect(render([series(), series({ metricName: 'committed' })])).toContain('2 series');
    });

    it('drops the legend when the section turned it off, SVG and all kept', () => {
      const html = render([series(), series({ metricName: 'committed' })], { legend: false });
      expect(html).toContain('<svg');
      expect(html).not.toContain('border-radius: 2px');  // the legend swatch
    });

    it('escapes a metric name that contains markup', () => {
      const html = render([series({ metricName: '<img src=x>' })]);
      expect(html).not.toContain('<img src=x>');
      expect(html).toContain('&lt;img');
    });
  });

  describe('per-series colour and dash — the comparisons section', () => {
    it('honours an explicit colour and draws a dashed baseline', () => {
      const html = render([
        series({ color: '#2f6fed' }),
        series({ color: '#8a8a8a', dashed: true }),
      ]);
      expect(html).toContain('stroke="#2f6fed"');
      expect(html).toContain('stroke="#8a8a8a"');
      // One dashed line, not two: `dashed` is per series.
      expect((html.match(new RegExp(`stroke-dasharray="${CHART_SIZE.baselineDash}"`, 'g')) ?? []).length).toBe(1);
    });

    it('falls back to the palette at the caller offset when no colour is given', () => {
      // The Analyst palette, by slot — `chart-tokens.spec.ts` pins the hexes themselves.
      expect(render([series()], { offset: 0 })).toContain(`stroke="${chartColor(0)}"`);
      expect(render([series()], { offset: 1 })).toContain(`stroke="${chartColor(1)}"`);
      // Wraps rather than emitting `stroke="undefined"`.
      expect(render([series()], { offset: 99 })).not.toContain('stroke="undefined"');
    });
  });

  describe('style', () => {
    it('labels the x axis through xLabelOf when the caller supplies one', () => {
      const html = render([series()], {
        style: { xLabelOf: (dp) => `${Math.round(dp.time.getTime() / 60000)}m` },
      });
      expect(html).not.toMatch(/>\d{2}:\d{2}:\d{2}</);
      expect(axisLabels(html).some((l) => l.endsWith('m'))).toBe(true);
    });

    it('escapes an xLabelOf result — it is caller-built text on the page', () => {
      const html = render([series()], { style: { xLabelOf: () => '<b>x</b>' } });
      expect(html).not.toContain('<b>x</b>');
    });

    it('labels every run on a categorical axis, from EVERY series rather than the first', () => {
      // Two runs; the first series only has the earlier one. A trend where one metric
      // started later must still label the run the other metric has.
      const t0 = 0;
      const a = series({ metricName: 'a', dataPoints: [{ time: new Date(t0), value: 1 }] });
      const b = series({
        metricName: 'b',
        dataPoints: [{ time: new Date(t0), value: 2 }, { time: new Date(t0 + 1), value: 3 }],
      });
      const html = render([a, b], {
        style: {
          // Already plural: the subtitle prints the noun verbatim, as `GraphsRenderer` does.
          categorical: { pointNoun: 'runs' },
          xLabelOf: (dp) => `R${dp.time.getTime()}`,
        },
      });
      const labels = axisLabels(html);
      expect(labels).toContain('R0');
      expect(labels).toContain('R1');
      // The subtitle counts runs, not data points.
      expect(html).toContain('2 runs');
    });

    it('draws a marker on every point of every series when asked', () => {
      const html = render([series(), series({ metricName: 'committed' })], {
        style: { markers: true },
      });
      expect((html.match(/<circle /g) ?? []).length).toBe(6);
    });

    it('draws no markers on a dense single series, and some on a sparse one', () => {
      const sparse = render([series({ dataPoints: points([1, 2, 3]) })]);
      const dense = render([series({ dataPoints: points(Array.from({ length: 60 }, (_, i) => i)) })]);
      expect((sparse.match(/<circle /g) ?? []).length).toBe(3);
      expect(dense).not.toContain('<circle ');
    });
  });

  describe('tick labels', () => {
    it('abbreviates a large unitless value rather than printing every digit', () => {
      const html = render([series({ unit: '', dataPoints: points([0, 2_500_000]) })]);
      expect(axisLabels(html).some((l) => l.endsWith('M'))).toBe(true);
    });

    it('abbreviates thousands with K', () => {
      const html = render([series({ unit: '', dataPoints: points([0, 4_000]) })]);
      expect(axisLabels(html).some((l) => l.endsWith('K'))).toBe(true);
    });

    it('routes ms and percent through the unit formatter instead', () => {
      expect(render([series({ unit: 'ms', dataPoints: points([0, 4_000]) })])).toContain('s');
      const pct = render([series({ unit: '%', dataPoints: points([0, 50]) })]);
      expect(pct).toContain('%');
    });

    it('survives a flat series, where min equals max', () => {
      const html = render([series({ dataPoints: points([5, 5, 5]) })]);
      expect(html).toContain('<svg');
      expect(html).not.toContain('NaN');
    });
  });
  /**
   * The series table that replaced the swatch-and-name legend.
   *
   * It is the only place a report reader gets a NUMBER off a chart — the SVG has no hover
   * — so the min/mean/max are load-bearing, and they follow the same rule the app's
   * `windowStats` follows: under "analysis range only" they describe the window, not the
   * whole run. `chart-tokens.spec.ts` covers the markup the table is made of; what is
   * tested here is which values go into it.
   */
  describe('the series table legend', () => {
    const base = 1_700_000_000_000;
    /** The legend precedes the chart card, so everything before the `<svg` is it. */
    const legendOf = (html: string) => html.slice(0, html.indexOf('<svg'));
    /** The right-aligned data cells, min/mean/max per row, in row order. */
    const legendStats = (html: string) =>
      [...legendOf(html).matchAll(/role="cell" style="[^"]*text-align:right;[^"]*">([^<]*)</g)]
        .map((m) => m[1]!);
    /** The series name of each row, in row order. */
    const legendNames = (html: string) =>
      [...legendOf(html).matchAll(/margin-left:8px;">([^<]*)</g)].map((m) => m[1]!);
    /** The unit column of each row — the only cell padded on the left. */
    const legendUnits = (html: string) =>
      [...legendOf(html).matchAll(/role="cell" style="[^"]*padding-left:14px;">([^<]*)</g)]
        .map((m) => m[1]!);

    it('carries the min, mean and max of the series, formatted in its unit', () => {
      // 10/20/30 ms: the mean is the third number, not a repeat of the max.
      expect(legendStats(render([series()]))).toEqual(['10 ms', '20 ms', '30 ms']);
    });

    it('names each row panel-then-metric, with the unit in its own column', () => {
      const html = render([series(), series({ metricName: 'committed', unit: 's' })]);
      expect(legendNames(html)).toEqual(['Heap · used', 'Heap · committed']);
      // The unit is a column, so the name is not "used (ms)".
      expect(legendUnits(html)).toEqual(['ms', 's']);
      expect(legendNames(html)[0]).not.toContain('(ms)');
    });

    it('drops the unit column when the whole chart is unitless, and dashes the odd one out', () => {
      // One unit per chart is named above the axis, so a column repeating it is noise.
      expect(render([series({ unit: '' })])).not.toContain('>Unit<');
      // A mixed chart keeps the column, and the series with no unit reads as a dash.
      expect(legendUnits(render([series({ unit: 'ms' }), series({ metricName: 'b', unit: '' })])))
        .toEqual(['ms', '—']);
    });

    it('computes the stats over the WINDOW in analysis-only mode, not the whole run', () => {
      // A ramp-up spike of 10 000 in the first minute, then a flat band at 20..23. A legend
      // that kept reporting the whole run would print a max the reader cannot see on the
      // chart in front of them, and a mean two orders of magnitude off the band.
      const spiky = series({ unit: '', dataPoints: points([10_000, 20, 21, 22, 23]) });
      const whole = render([spiky], { window: { from: base + 60_000, to: null, only: false } });
      const only = render([spiky], { window: { from: base + 60_000, to: null, only: true } });

      expect(legendStats(whole)).toEqual(['20', '2.02K', '10K']);
      expect(legendStats(only)).toEqual(['20', '21.5', '23']);
    });

    it('prints an em dash for a series with no point inside the window', () => {
      // Analysis-only is on because the FIRST series has points in the window; the second
      // one has none, and `Math.min(...[])` would otherwise put Infinity on the page.
      const inside = series({ unit: '', metricName: 'inside', dataPoints: points([5, 6, 7], base) });
      const outside = series({
        unit: '', metricName: 'outside', dataPoints: points([99], base + 86_400_000),
      });
      const html = render([inside, outside], {
        window: { from: base, to: base + 120_000, only: true },
      });

      expect(legendStats(html)).toEqual(['5', '6', '7', '—', '—', '—']);
      expect(html).not.toContain('Infinity');
      expect(html).not.toContain('NaN');
    });

    it('marks a dashed baseline in its swatch, so the table reads like the chart', () => {
      const html = render([series(), series({ metricName: 'baseline', dashed: true })]);
      // One dashed swatch, not two: `dashed` is per series, as it is on the line.
      expect((legendOf(html).match(/border-top:2px dashed/g) ?? []).length).toBe(1);
    });

    it('renders no series table at all when the section turned the legend off', () => {
      // The old assertion keyed on the swatch's `border-radius: 2px`, which no longer
      // exists anywhere in the chart — so it passed whether or not the legend was drawn.
      const html = render([series(), series({ metricName: 'committed' })], { legend: false });
      expect(html).toContain('<svg');
      expect(html).not.toContain('role="table"');
      expect(html).not.toContain('role="columnheader"');
    });
  });

  describe('the standard\'s marks', () => {
    it('draws a time series as a hairline, and a run-over-run chart thicker and marked', () => {
      expect(render([series()])).toContain(`stroke-width="${CHART_SIZE.line}"`);
      const marked = render([series()], { style: { markers: true } });
      expect(marked).toContain(`stroke-width="${CHART_SIZE.markedLine}"`);
      expect(marked).toContain(`r="${CHART_SIZE.marker}"`);
    });

    it('captions every axis above the plot instead of rotating a y-axis title', () => {
      const html = render([series({ unit: 'ms' }), series({ metricName: 'rate', unit: 'req/s' })]);
      // One caption per axis — the left one included, which used to be the rotated title.
      expect((html.match(/font-weight="600"/g) ?? []).length).toBe(2);
      expect(html).toMatch(/font-weight="600"[^>]*>ms</);
      expect(html).toMatch(/font-weight="600"[^>]*>req\/s</);
      // Nothing is rotated by 90 degrees any more.
      expect(html).not.toContain('rotate(-90');
    });

    it('fills the plot area instead of framing it', () => {
      const html = render([series()]);
      expect(html).toContain(`fill="${CHART_INK.plotBg}"`);
      // The grey `#999` frame was the loudest mark on the old report charts.
      expect(html).not.toContain('stroke="#999"');
    });
  });

});
