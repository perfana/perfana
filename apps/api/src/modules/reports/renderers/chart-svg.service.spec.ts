import { Logger } from '@nestjs/common';
import { ReportUtilsService } from '../services/report-utils.service';
import { CHART_INK, CHART_SIZE, HOVER_SERIES_SLOTS, chartColor } from './chart-tokens';
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
      // One right-hand spine for the second unit, in the standard's divider ink. Matched
      // on the <line> specifically: the cursor readouts box themselves in the same ink.
      const divider = CHART_INK.divider.replace(/[()]/g, '\\$&');
      expect((html.match(new RegExp(`<line[^>]*stroke="${divider}"`, 'g')) ?? []).length).toBe(1);
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

    it('rounds a marker\'s coordinates like the path\'s, to 0.1px', () => {
      // A marker per point on a trend over many runs is as much payload as the path, and
      // full float precision is ~17 characters per coordinate that renders identically in
      // a document stored in Postgres, mailed, and run through Puppeteer.
      const runs = Array.from({ length: 7 }, (_, i) => ({ time: new Date(i), value: i * 3 + 1 }));
      const html = render([series({ unit: '', dataPoints: runs })], {
        style: { markers: true, categorical: { pointNoun: 'runs' } },
      });
      const coords = [...html.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)"/g)].flatMap((m) => [m[1]!, m[2]!]);

      expect(coords.length).toBe(14);
      // At most one decimal place on every one of them.
      expect(coords.filter((c) => /\.\d{2}/.test(c))).toEqual([]);
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
    /**
     * The legend FOLLOWS the chart card, so everything after `</svg>` is it.
     *
     * Throws rather than slicing from -1: on a render with no chart that would return the
     * document's LAST CHARACTER, and every matcher below would then report `[]` for the
     * wrong reason — a passing assertion about a legend that was never drawn.
     */
    const legendOf = (html: string) => {
      const at = html.indexOf('</svg>');
      if (at < 0) throw new Error('no chart in output — legendOf has nothing to slice');
      return html.slice(at);
    };
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

  /**
   * Hover, on a chart that is read where no script runs. Both halves are markup the CSS in
   * `CHART_HOVER_CSS` only reveals, so what is testable here is the pairing and the bands.
   */
  describe('hover', () => {
    /*
     * These cases are MARKUP-ONLY, and deliberately so: jsdom evaluates no CSS, so nothing
     * here can witness `:has()` resolving out of the series table into the SVG, `:hover`
     * matching a `display: contents` row, or the band rects winning the hit test. Those
     * three were verified by hand in Chrome against a generated report on 2026-10-03 (both
     * behaviours, before and after the paint moved into CHART_HOVER_CSS). Same structural
     * limit as REPORT_DETAILS_CSS — see the `data:`-URL CSP note in apps/api/CLAUDE.md for
     * the last time a browser-only rule shipped broken past a green suite.
     */
    it('pairs each legend row with its line through data-series', () => {
      const html = render([series(), series({ metricName: 'committed' })]);
      // The row index IS the group index — the whole dim-the-others mechanism.
      expect(html).toContain('role="row" data-series="0"');
      expect(html).toContain('role="row" data-series="1"');
      expect(html).toContain('<g data-series="0">');
      expect(html).toContain('<g data-series="1">');
      // The legend follows the chart, so a hover on it has to reach back up via :has().
      expect(html.indexOf('</svg>')).toBeLessThan(html.indexOf('role="table"'));
    });

    it('pre-renders a cursor readout per band, naming every series and its value', () => {
      const html = render([series(), series({ metricName: 'committed', unit: 's' })]);
      expect(html).toContain('class="chart-cursor-band"');
      // A readout carries the time, then one coloured line per series at that point.
      expect(html).toMatch(/<tspan[^>]*>\d{2}:\d{2}:\d{2}<\/tspan>/);
      expect(html).toMatch(/<tspan[^>]*>used {2}\d/);
      expect(html).toMatch(/<tspan[^>]*>committed {2}\d/);
      // Bands are the hover target, so they must sit above the lines.
      expect(html.indexOf('class="chart-cursor-band"')).toBeGreaterThan(html.indexOf('<g data-series="0">'));
    });

    it('names at most ten series in a readout, and counts the rest', () => {
      // The cap is what keeps the box inside the plot. Without the overflow line the
      // readout silently stops at ten and the reader cannot tell.
      const many = Array.from({ length: 14 }, (_, i) => series({ metricName: `m${i}`, unit: '' }));
      const html = render(many);
      const band = html.slice(html.indexOf('class="chart-cursor-band"'));
      const firstReadout = band.slice(0, band.indexOf('</text>'));

      // One head line, ten readings, one overflow line.
      expect((firstReadout.match(/<tspan /g) ?? []).length).toBe(12);
      expect(firstReadout).toContain('+4 more');
    });

    it('trims a long series name in the readout but leaves a 28-character one whole', () => {
      // Only the READOUT truncates — the series table below the chart is the one place the
      // full name is written, so the assertions are scoped to the band markup.
      // The bands to the end of the SVG — NOT to the end of the document, which would
      // include the series table and its full-length names.
      const readoutOf = (html: string) =>
        html.slice(html.indexOf('class="chart-cursor-band"'), html.indexOf('</svg>'));
      const keep = 'a'.repeat(28);
      const cut = 'b'.repeat(29);

      expect(readoutOf(render([series({ metricName: keep, unit: '' })]))).toContain(keep);
      const html = render([series({ metricName: cut, unit: '' })]);
      expect(readoutOf(html)).toContain(`${'b'.repeat(27)}\u2026`);
      expect(readoutOf(html)).not.toContain(cut);
      // …and the table still carries it whole.
      expect(html).toContain(cut);
    });

    it('emits no negative geometry however narrow the chart is configured', () => {
      // `chartWidth` comes from a section config with no DTO validation, and a negative
      // `width` on a rect is an error value: the readout's box silently does not render.
      for (const width of [120, 126, 130, 200, 400]) {
        expect(render([series()], { width })).not.toMatch(/(width|height)="-/);
      }
    });

    it('stops pairing past the last hover slot, instead of dimming with no way back', () => {
      // The un-dim rules are generated per slot, so a series past the last one must not
      // carry the attribute at all — the generic dim rule would fade it with nothing left
      // to restore it, which is the inverse of the feature.
      const many = Array.from(
        { length: HOVER_SERIES_SLOTS + 6 }, (_, i) => series({ metricName: `m${i}`, unit: '' }),
      );
      const html = render(many);
      const slots = [...html.matchAll(/<g data-series="(\d+)">/g)].map((m) => Number(m[1]));

      expect(slots).toHaveLength(HOVER_SERIES_SLOTS);
      expect(Math.max(...slots)).toBe(HOVER_SERIES_SLOTS - 1);
      expect(html).not.toContain(`data-series="${HOVER_SERIES_SLOTS}"`);
    });

    it('reads the point nearest the band even when the series arrives out of order', () => {
      // A monotone walk over unsorted points parks on the wrong one and reports its value
      // against another timestamp. The renderer sorts first; this is the proof.
      const base = 1_700_000_000_000;
      const shuffled = series({ unit: '', dataPoints: [
        { time: new Date(base + 120_000), value: 30 },
        { time: new Date(base), value: 10 },
        { time: new Date(base + 60_000), value: 20 },
      ] });
      const sorted = series({ unit: '', dataPoints: points([10, 20, 30]) });
      const readouts = (html: string) => html.match(/<tspan[^>]*>used {2}[^<]*</g) ?? [];

      expect(readouts(render([shuffled]))).toEqual(readouts(render([sorted])));
      expect(readouts(render([shuffled])).length).toBeGreaterThan(0);
    });

    it('writes an ampersand in a name once, not escaped twice', () => {
      // The readout used to escape text that was already escaped, so `Search & Browse`
      // reached the PDF and the share page as `Search &amp; Browse` — and the box was
      // measured from the shorter string, so a name with a few of them overflowed it.
      const html = render([series({ metricName: 'Search & Browse <1s', unit: '' })]);
      const readout = html.slice(html.indexOf('class="chart-cursor-band"'), html.indexOf('</svg>'));

      expect(readout).toContain('Search &amp; Browse &lt;1s');
      expect(readout).not.toContain('&amp;amp;');
    });

    it('keeps the readout inside the plot on the shortest chart it renders', () => {
      // A full readout is 12 cells; the `low` quality preset's plot is 152px. The box has
      // to be clamped, not placed at a constant offset.
      const many = Array.from({ length: 14 }, (_, i) => series({ metricName: `m${i}`, unit: '' }));
      const html = render(many, { width: 700, height: 240 });
      const plotBottom = 240 - 60;

      const boxes = [...html.matchAll(/<rect x="[\d.]+" y="(\d+)" width="[\d.]+" height="(\d+)" rx="4"/g)];
      expect(boxes.length).toBeGreaterThan(0);
      for (const [, y, h] of boxes) expect(Number(y) + Number(h)).toBeLessThanOrEqual(plotBottom);
    });

    it('drops a point whose timestamp is not a number instead of reading it in every band', () => {
      // `Math.abs(NaN - t) > span` is FALSE, so an Invalid Date used to pass the band guard
      // and print `NaN` as that series' value on the whole chart.
      const base = 1_700_000_000_000;
      const html = render([series({ unit: '', dataPoints: [
        { time: new Date(base), value: 10 },
        { time: new Date('nonsense'), value: 20 },
        { time: new Date(base + 60_000), value: 30 },
      ] })]);

      expect(html).not.toContain('NaN');
      expect(html).not.toContain('Invalid');
    });

    it('leaves a series out of a band it has no point in, rather than repeating a stale value', () => {
      const base = 1_700_000_000_000;
      // `short` stops after three points; `long` runs on. The bands past the gap must name
      // only `long` — a tooltip that keeps reporting the last value invents data.
      const short = series({ unit: '', metricName: 'short' });
      const long = series({
        unit: '',
        metricName: 'long',
        dataPoints: Array.from({ length: 40 }, (_, i) => ({ time: new Date(base + i * 60_000), value: i })),
      });
      const html = render([short, long]);
      expect((html.match(/<tspan[^>]*>long {2}/g) ?? []).length)
        .toBeGreaterThan((html.match(/<tspan[^>]*>short {2}/g) ?? []).length);
    });

    /**
     * The readouts are inside the SVG and the series table is after it, so anything matched
     * on the slice up to `</svg>` is a readout and not the legend repeating the same name.
     */
    const readouts = (html: string) => html.slice(0, html.indexOf('</svg>'));

    /** Every band's crosshair x and the box it carries, in band order. */
    const bands = (html: string) =>
      [...html.matchAll(/<g class="chart-cursor-band">[\s\S]*?<line x1="([\d.]+)"[\s\S]*?<rect x="([\d.]+)" y="\d+" width="([\d.]+)"/g)]
        .map((m) => ({ cx: +m[1]!, boxX: +m[2]!, boxWidth: +m[3]! }));

    it('trims a long series name instead of widening the box past the chart', () => {
      // 40 a's. The box is sized from a character count (mono type), so an untrimmed
      // JMeter transaction name would be a readout wider than the plot it sits in.
      const html = render([series({ metricName: 'a'.repeat(40) })]);
      expect(readouts(html)).toMatch(/<tspan[^>]*>a{27}… {2}\d/);
      // ...and the full name is still written once, in the legend, where it can wrap.
      expect(html.slice(html.indexOf('</svg>'))).toContain('a'.repeat(40));
    });

    it('counts the series past the tenth rather than growing a box taller than the plot', () => {
      // 13 series at the same timestamps: ten are named, three are a count. An SVG tooltip
      // cannot scroll, so a 13-line box would simply overhang the chart.
      const many = Array.from({ length: 13 }, (_, i) => series({ metricName: `m${i}`, unit: '' }));
      const svg = readouts(render(many));

      expect(svg).toMatch(/<tspan[^>]*>\+3 more<\/tspan>/);
      expect(svg).toMatch(/<tspan[^>]*>m0 {2}/);
      // The eleventh onwards are not in the readout at all — not drawn behind the count.
      expect(svg).not.toMatch(/<tspan[^>]*>m12 {2}/);
    });

    it('heads a readout with the chart\'s own x label, taken from a real sample', () => {
      // A trend chart's x-axis is runs, so `xLabelOf` has to be handed a data point — which
      // is why the band keeps an anchor instead of labelling its synthetic centre time.
      const svg = readouts(render([series()], { style: { xLabelOf: (dp) => `run-${dp.value}` } }));

      // The head is the first cell of the readout: the one `tspan` with an absolute `y`.
      expect(svg).toMatch(/<tspan x="[\d.]+" y="\d+"[^>]*>run-10<\/tspan>/);
      // And no clock reading anywhere: that would be the band centre, not a run.
      expect(svg).not.toMatch(/<tspan[^>]*y="\d+"[^>]*>\d{2}:\d{2}:\d{2}</);
    });

    it('spaces the bands by width on a time axis and by run on a categorical one', () => {
      const dense = (width: number) => {
        const html = render([series({ dataPoints: points(Array.from({ length: 200 }, (_, i) => i)) })], { width });
        return (html.match(/class="chart-cursor-band"/g) ?? []).length;
      };
      // ~22px per band: 900 wide leaves a 782px plot, so 36 — not one band per point, which
      // is the markup this layer is already the second-largest cost in the chart for.
      expect(dense(900)).toBe(36);
      // Clamped at both ends: 48 bands however wide, 6 however narrow.
      expect(dense(2000)).toBe(48);
      expect(dense(220)).toBe(6);

      // A categorical chart gets one band per run instead — a run IS the reading there.
      const runs = [0, 1, 2, 3].map((i) => ({ time: new Date(i), value: i * 10 }));
      const cat = render([series({ unit: '', dataPoints: runs })], {
        style: { categorical: { pointNoun: 'runs' }, markers: true },
      });
      expect((cat.match(/class="chart-cursor-band"/g) ?? []).length).toBe(4);
    });

    it('keeps every readout inside the plot, flipping it to the near side past the midpoint', () => {
      // 900 wide, one unit: the plot runs from x=78 to x=860. A box that ran off the right
      // edge would be clipped by the SVG, so the reader would lose the values they pointed at.
      const html = render([series({ dataPoints: points(Array.from({ length: 200 }, (_, i) => i)) })]);
      const [left, right] = [78, 860];
      const all = bands(html);
      expect(all.length).toBeGreaterThan(1);

      for (const band of all) {
        expect(band.boxX).toBeGreaterThanOrEqual(left);
        expect(band.boxX + band.boxWidth).toBeLessThanOrEqual(right);
        // Past the midpoint the box sits entirely left of the crosshair, and before it
        // entirely right — otherwise it covers the half of the chart being read.
        if (band.cx > left + (right - left) / 2) {
          expect(band.boxX + band.boxWidth).toBeLessThanOrEqual(band.cx);
        } else {
          expect(band.boxX).toBeGreaterThanOrEqual(band.cx);
        }
      }
    });

    it('escapes a series name into the readout, which is SVG text and not markup', () => {
      // The name comes from `ds_metrics` and lands in a `<tspan>`; the legend's escaping
      // does not cover this copy of it.
      const svg = readouts(render([series({ metricName: '<b>&x' })]));
      expect(svg).toContain('&lt;b&gt;&amp;x');
      expect(svg).not.toContain('<b>&x');
    });

    it('names a series by its panel when the metric has no name of its own', () => {
      // `metricName || panelTitle`: an empty name would otherwise put a bare value in the
      // readout with nothing to say which line it belongs to.
      const svg = readouts(render([series({ metricName: '', panelTitle: 'Heap', unit: '' })]));
      expect(svg).toMatch(/<tspan[^>]*>Heap {2}\d/);
    });

    it('still draws the readouts when the section turned the legend off', () => {
      // The two halves are independent: no table means no row to hover and nothing to dim,
      // but the plot is still the only place a value can be read off this chart.
      const html = render([series()], { legend: false });
      expect(html).not.toContain('role="table"');
      expect(html).toContain('class="chart-cursor-band"');
      expect(html).toContain('<g data-series="0">');
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
