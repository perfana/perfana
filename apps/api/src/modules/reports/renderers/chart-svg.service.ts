import { Injectable, Logger } from '@nestjs/common';
import { MetricsDataPoint, MetricsTimeSeriesPanel } from '../services/report-data-fetcher.service';
import { ReportUtilsService } from '../services/report-utils.service';
import { emptyState, formatInt, formatNum, groupHeader } from './report-style';
import {
  CHART_INK,
  CHART_MONO,
  CHART_SIZE,
  axisUnitLabel,
  chartCard,
  chartColor,
  chartSeriesTable,
  gridLine,
  hoverSlot,
  legendStats,
  safeChartColor,
  tickLabel,
  type ChartLegendRow,
} from './chart-tokens';
import { formatValueWithUnit } from './unit-format';

/**
 * The report's time-series chart, as a server-rendered inline SVG.
 *
 * A report is one self-contained HTML file read in an iframe with no
 * `allow-scripts` (see `report-interactivity.ts`), so there is no client chart
 * library to lean on: every chart in every section is SVG built here — hover included,
 * which is what the pre-rendered cursor bands and `CHART_HOVER_CSS` are for. It began
 * as `GraphsRenderer.renderChart` and moved out when the comparisons section
 * needed the same chart for its current-vs-baseline graphs — two renderers, one
 * chart, rather than a second implementation that slowly diverges.
 *
 * Multi-unit (one Y axis per distinct unit, collapsing to a shared scale when the
 * axes would not fit), analysis-window aware, and optionally categorical for a
 * trend whose x-axis is runs rather than time.
 */

/** The run's analysis time range, as epoch milliseconds. `null` = that end is not trimmed. */
export interface ChartWindow {
  from: number | null;
  to: number | null;
  /**
   * Draw ONLY the analysis range (plus a thin margin), instead of the whole run
   * with the excluded bands dimmed. Set from the section's
   * `analysisRangeOnly` toggle.
   */
  only: boolean;
}

/**
 * How far outside the analysis range the "analysis only" view still draws, as a
 * fraction of the range. Without it the two boundary lines land exactly on the
 * plot edges, where they are indistinguishable from the chart border — the
 * margin is what makes the offsets visible, which is the point of the view.
 */
const ANALYSIS_ONLY_MARGIN = 0.025;

/**
 * The analysis-window boundary, amber dashed.
 *
 * The Graphs card used to draw the same amber and now draws a `theme.faint` hairline
 * instead (`lib/charts/layout.ts`, pinned by `analysis-window.test.ts`). The report keeps
 * amber on purpose: it prints, and a faint grey hairline on a white page at PDF scale is
 * not a mark anyone sees.
 */
const ANALYSIS_BOUNDARY_COLOR = '#f59e0b';

/**
 * The cursor readout's geometry. Every number here is tuned against `CHART_SIZE.tickFont`
 * (10px mono), which is the font the readout is drawn in — change that token and these
 * follow, which is the whole reason they are named rather than inlined.
 *
 * `maxSeries`: how many series a readout names before it falls back to "+N more". A box
 * taller than the plot is worse than an incomplete one, and an SVG tooltip cannot scroll.
 * `charWidth`: px per character of CHART_MONO at that size, for sizing the box — SVG has
 * no shrink-wrap, so nothing sizes a rect to the text inside it.
 * `bandPx` / `maxBands`: how coarse the hover bands are. The band markup is the largest
 * part of a chart's bytes, so this is a size budget, not a precision dial.
 */
/**
 * The band readout's and x axis' clock format. Hoisted because `toLocaleTimeString` builds
 * a formatter per call (~36us measured) and this now runs once per hover band, not once
 * per axis tick.
 */
const CLOCK = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

const CURSOR = {
  maxSeries: 10,
  rowHeight: 12,
  firstBaseline: 15,
  charWidth: 5.8,
  padding: 8,
  labelChars: 28,
  bandPx: 22,
  maxBands: 48,
} as const;

/** A series name in a cursor readout, trimmed to keep the box narrower than the chart. */
const truncateLabel = (name: string): string =>
  name.length > CURSOR.labelChars ? `${name.slice(0, CURSOR.labelChars - 1)}\u2026` : name;

/** A chart with no analysis window to mark — trend charts, whose x-axis is runs, not time. */
export const NO_WINDOW: ChartWindow = { from: null, to: null, only: false };

/**
 * One drawn series. `color` and `dashed` exist for the comparisons section, where the
 * two lines are not two metrics but the same metric on two runs: the baseline has to be
 * told apart from the current run by more than hue, so it is drawn dashed — and it reads
 * that way in a greyscale print too.
 */
export type ChartSeries = MetricsTimeSeriesPanel & { color?: string; dashed?: boolean };

/** How a chart labels and marks its x-axis; the default is the time-series reading. */
export interface ChartStyle {
  /** Label for an x tick; defaults to the point's time of day. */
  xLabelOf?: (dp: MetricsDataPoint) => string;
  /** Draw a marker on every point of every series (a trend has one point per run). */
  markers?: boolean;
  /**
   * Categorical x-axis: one label per point, and the domain padded by half a step so the
   * first and last markers are not cut by the plot edge. The subtitle then counts
   * `pointNoun` (runs) rather than data points.
   */
  categorical?: { pointNoun: string };
}

@Injectable()
export class ChartSvgService {
  private readonly logger = new Logger(ChartSvgService.name);

  constructor(private readonly utils: ReportUtilsService) {}

  renderTimeSeriesChart(
    chartTitle: string,
    series: ChartSeries[],
    colorOffset: number,
    width: number,
    height: number,
    window: ChartWindow,
    showLegend: boolean = true,
    style: ChartStyle = {},
  ): string {
    const drawn = series
      // Non-finite times and values go out with the nulls. A NaN timestamp is worse than a
      // missing one: `Math.abs(NaN - t) > tolerance` is FALSE, so the readout's guard fails
      // OPEN and the point is accepted as that series' reading in every band on the chart.
      .map((s) => ({
        ...s,
        dataPoints: s.dataPoints.filter((dp) =>
          dp.value !== null && Number.isFinite(dp.value) && Number.isFinite(dp.time.getTime())),
      }))
      .filter((s) => s.dataPoints.length > 0)
      // Time order is a precondition, not a hope: the cursor readout walks each series with
      // a monotone index, so an out-of-order point parks the walk and every later band
      // reports a value against the wrong timestamp — a wrong NUMBER on a report chart,
      // which is the one thing a reader takes off it as fact. Every producer orders by
      // time today, so this is an O(n) scan that almost never sorts.
      .map((s) => {
        const points = s.dataPoints;
        const ascending = points.every((dp, i) =>
          i === 0 || points[i - 1]!.time.getTime() <= dp.time.getTime());
        return ascending
          ? s
          : { ...s, dataPoints: [...points].sort((a, b) => a.time.getTime() - b.time.getTime()) };
      });

    if (drawn.length === 0) {
      return `
        <div style="margin: 16px 0;">
          ${groupHeader(chartTitle)}
          ${emptyState('No data points available.')}
        </div>
      `;
    }

    const allPoints = drawn.flatMap((s) => s.dataPoints);
    const dataPoints = drawn[0]!.dataPoints;

    // "Analysis range only": the x-domain becomes the analysis window plus a thin
    // margin, and — the part that matters — every Y scale is computed from the
    // points INSIDE the window. Scaling on the whole run instead lets a ramp-up
    // spike the reader cannot even see set the axis, flattening the band they
    // asked to look at. Falls back to the full run when the run carries no
    // offsets, since there is then no window to zoom to.
    const inWindow = (t: number) =>
      (window.from === null || t >= window.from) && (window.to === null || t <= window.to);
    const analysisOnly = window.only && (window.from !== null || window.to !== null)
      && allPoints.some((dp) => inWindow(dp.time.getTime()));
    const scalePoints = analysisOnly
      ? allPoints.filter((dp) => inWindow(dp.time.getTime()))
      : allPoints;

    // One axis per distinct unit, in the order the units first appear, so the
    // left axis belongs to the first series drawn.
    const unitsInOrder = [...new Set(drawn.map((s) => s.unit || ''))];
    const range = (points: MetricsDataPoint[]) => {
      // A unit whose series all fall outside the window would give Infinity here.
      if (points.length === 0) return { yMin: 0, yMax: 1 };
      // Looped for the same reason as the x range above: this runs over every point of
      // every series sharing the unit.
      let minVal = Infinity;
      let maxVal = -Infinity;
      for (const dp of points) {
        const v = dp.value!;
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
      const pad = (maxVal - minVal || 1) * 0.1;
      return { yMin: Math.max(0, minVal - pad), yMax: maxVal + pad };
    };

    // Every right-hand axis costs horizontal room. If the axes would leave no
    // chart to draw in, collapse to one shared scale rather than emitting a
    // negative-width SVG — unreadable beats broken.
    const RIGHT_AXIS_WIDTH = 56;
    const wanted = 40 + Math.max(0, unitsInOrder.length - 1) * RIGHT_AXIS_WIDTH;
    const collapse = width - 80 - wanted < 200;
    if (collapse && unitsInOrder.length > 1) {
      this.logger.warn(`Chart "${chartTitle}": ${unitsInOrder.length} units do not fit as separate axes, sharing one scale`);
    }

    const axes = (collapse ? [''] : unitsInOrder).map((unit, i) => ({
      unit,
      side: i === 0 ? ('left' as const) : ('right' as const),
      index: i,
      ...range(
        collapse
          ? scalePoints
          : drawn
              .filter((s) => (s.unit || '') === unit)
              .flatMap((s) => s.dataPoints)
              .filter((dp) => !analysisOnly || inWindow(dp.time.getTime())),
      ),
    }));
    const axisFor = (s: MetricsTimeSeriesPanel) =>
      axes.find((a) => a.unit === (s.unit || '')) ?? axes[0]!;

    // Unique per chart: several charts share one HTML document, and a repeated
    // clipPath id would make every chart use the first one's plot rectangle.
    const clipId = `plot-clip-${colorOffset}-${Math.abs(this.hashString(chartTitle))}`;

    // `top` carries the unit captions the standard prints above each axis, in place of the
    // rotated axis title it removes. `left` stays wide: unlike the app, a tick here carries
    // its own unit (`formatValue` rescales per value — 900 ms and 1.2 s can be two ticks of
    // one axis), so the labels are "287.36 ms", not "287.36".
    const padding = {
      top: 28,
      right: collapse ? 40 : wanted,
      bottom: 60,
      left: 78,
    };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // The single-axis case keeps the old label: one unit, named.
    const unit = axes.length === 1 ? axes[0]!.unit : '';

    // Compute X-axis range
    // A loop, not `Math.min(...times)`: `allPoints` is every point of every series, which on
    // a long run is the array that would throw `RangeError: Maximum call stack size exceeded`
    // first. `comparisons-renderer.ts` carries the same warning about its own timestamps.
    let dataMin = Infinity;
    let dataMax = -Infinity;
    for (const dp of allPoints) {
      const t = dp.time.getTime();
      if (t < dataMin) dataMin = t;
      if (t > dataMax) dataMax = t;
    }
    let tMin = dataMin;
    let tMax = dataMax;
    if (style.categorical) {
      // Points sit at integer positions; half a step of margin keeps the first and last
      // markers inside the plot instead of half under its border.
      tMin = dataMin - 0.5;
      tMax = dataMax + 0.5;
    }
    if (analysisOnly) {
      // A null bound means that end is not trimmed, so it stays at the data edge.
      const wFrom = window.from ?? dataMin;
      const wTo = window.to ?? dataMax;
      const margin = Math.max((wTo - wFrom) * ANALYSIS_ONLY_MARGIN, 1000);
      tMin = wFrom - margin;
      tMax = wTo + margin;
    }
    const tRange = tMax - tMin || 1;

    const scaleX = (t: number) => padding.left + ((t - tMin) / tRange) * chartWidth;
    const scaleYOn = (axis: { yMin: number; yMax: number }, v: number) =>
      padding.top + chartHeight - ((v - axis.yMin) / (axis.yMax - axis.yMin)) * chartHeight;
    /** Where a right-hand axis is drawn: successively further out. */
    const axisX = (axis: { side: 'left' | 'right'; index: number }) =>
      axis.side === 'left'
        ? padding.left
        : padding.left + chartWidth + (axis.index - 1) * RIGHT_AXIS_WIDTH;

    // Coordinates to 0.1px: a 3-hour run is tens of thousands of points on a 900px-wide
    // chart, where full float precision is ~17 characters per point that renders
    // identically — and this SVG is stored in Postgres, mailed, and run through Puppeteer.
    const px = (n: number) => Math.round(n * 10) / 10;

    // One path per series, each in its own colour, each on its unit's axis
    const lines = drawn.map((s, i) => {
      const color = safeChartColor(s.color, chartColor(colorOffset + i));
      const axis = axisFor(s);
      // Consecutive duplicate coordinates are dropped, for the same reason `px` rounds.
      const parts: string[] = [];
      let lastX = NaN;
      let lastY = NaN;
      for (const dp of s.dataPoints) {
        const x = px(scaleX(dp.time.getTime()));
        const y = px(scaleYOn(axis, dp.value!));
        if (x === lastX && y === lastY) continue;
        parts.push(`${parts.length === 0 ? 'M' : 'L'} ${x} ${y}`);
        lastX = x;
        lastY = y;
      }
      return { series: s, color, path: parts.join(' '), axis, dashed: s.dashed === true };
    });

    // Analysis time range: dim what it excludes and mark each boundary with an
    // amber dashed line — the same overlay the Graphs card draws.
    const analysisShapes: string[] = [];
    const clampX = (t: number) => Math.min(Math.max(scaleX(t), padding.left), padding.left + chartWidth);
    const dimBand = (x0: number, x1: number) =>
      `<rect x="${x0}" y="${padding.top}" width="${Math.max(0, x1 - x0)}" height="${chartHeight}" fill="${CHART_INK.excludedPrint}"/>`;
    const boundary = (x: number) =>
      `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${padding.top + chartHeight}" stroke="${ANALYSIS_BOUNDARY_COLOR}" stroke-width="1.5" stroke-dasharray="4,3"/>`;
    if (window.from !== null && window.from > tMin) {
      const x = clampX(window.from);
      analysisShapes.push(dimBand(padding.left, x), boundary(x));
    }
    if (window.to !== null && window.to < tMax) {
      const x = clampX(window.to);
      analysisShapes.push(dimBand(x, padding.left + chartWidth), boundary(x));
    }

    // Grid lines (5 horizontal). The lines are shared; every axis labels those
    // same positions with its own values, which is what makes two scales
    // readable off one plot area.
    const numGridLines = 5;
    const gridLines: string[] = [];
    for (let i = 0; i <= numGridLines; i++) {
      const y = padding.top + (chartHeight / numGridLines) * i;
      gridLines.push(gridLine(padding.left, padding.left + chartWidth, y));
      for (const axis of axes) {
        const value = axis.yMax - ((axis.yMax - axis.yMin) / numGridLines) * i;
        const label = this.formatValue(value, axis.unit);
        const x = axisX(axis);
        // A second axis is tinted with its own series' colour so the reader can
        // tell at a glance which line it scales.
        const tint = axis.side === 'left'
          ? CHART_INK.faint
          : (lines.find((l) => l.axis === axis)?.color ?? CHART_INK.faint);
        gridLines.push(tickLabel(
          this.utils.escapeHtml(label),
          axis.side === 'left' ? x - 10 : x + 8,
          y + 4,
          axis.side === 'left' ? 'end' : 'start',
          '',
          tint,
        ));
      }
    }

    // Axis unit captions: every axis names its unit once, above itself. The standard has
    // no rotated axis title — the left axis is captioned the same way the right ones are.
    const axisUnitLabels = axes
      .filter((axis) => axis.unit)
      .map((axis) => axisUnitLabel(
        this.utils.escapeHtml(axis.unit),
        axis.side === 'left' ? padding.left : axisX(axis) + 8,
        padding.top - 8,
        'start',
        axis.side === 'left'
          ? CHART_INK.muted
          : (lines.find((l) => l.axis === axis)?.color ?? CHART_INK.muted),
      ))
      .join('');

    // How a point is named on this chart: the caller's labeller (a trend's run label), or
    // its time of day. ONE definition — the axis ticks and the cursor readouts have to
    // agree, and two copies of the same option bag drift silently.
    const xLabelFor = (dp: MetricsDataPoint): string => style.xLabelOf
      ? style.xLabelOf(dp)
      : CLOCK.format(dp.time);

    // X-axis labels (up to 6 evenly spaced). Drawn from the points inside the
    // domain, or every label past the boundary would sit outside the plot.
    const labelPoints = analysisOnly
      ? (dataPoints.filter((dp) => inWindow(dp.time.getTime())) ?? dataPoints)
      : dataPoints;
    // A categorical axis labels every run any series has a value in, not the first series' runs.
    const labelSource = style.categorical
      ? [...new Map(allPoints.map((dp) => [dp.time.getTime(), dp])).values()].sort((a, b) => a.time.getTime() - b.time.getTime())
      : labelPoints.length > 0 ? labelPoints : dataPoints;
    // A categorical axis labels every point — "which run is this" is the whole chart.
    const xLabelCount = style.categorical ? labelSource.length : Math.min(6, labelSource.length);
    const xLabels: string[] = [];
    for (let i = 0; i < xLabelCount; i++) {
      const idx = xLabelCount === 1 ? 0 : Math.round((i / (xLabelCount - 1)) * (labelSource.length - 1));
      const dp = labelSource[idx]!;
      const x = scaleX(dp.time.getTime());
      const yPos = padding.top + chartHeight + 10;
      xLabels.push(tickLabel(
        this.utils.escapeHtml(xLabelFor(dp)), x, yPos, 'end', `transform="rotate(-30 ${x} ${yPos})"`,
      ));
    }

    const unitLabel = unit ? ` (${this.utils.escapeHtml(unit)})` : '';
    // One series names itself in the subtitle; several are counted there and
    // named in the legend — a subtitle listing five metric names is unreadable.
    // The legend follows the toggle, single series included.
    const pointCount = style.categorical
      ? `${formatInt(labelSource.length)} ${this.utils.escapeHtml(style.categorical.pointNoun)}`
      : `${formatInt(allPoints.length)} data points`;
    const subtitle = drawn.length === 1
      ? `${this.utils.escapeHtml(drawn[0]!.metricName)}${unitLabel} &middot; ${pointCount}`
      : `${formatInt(drawn.length)} series${unitLabel} &middot; ${pointCount}`;
    // The legend is the app's series table: a swatch, the name, the unit and the
    // min/mean/max of what is drawn. Computed over the points the line actually shows —
    // under "analysis range only" that is the window, not the whole run, which is the
    // same rule `windowStats` follows in the app.
    const legendRows: ChartLegendRow[] = lines.map(({ series: s, color, axis, dashed }) => {
      const values = s.dataPoints
        .filter((dp) => !analysisOnly || inWindow(dp.time.getTime()))
        .map((dp) => dp.value!);
      const stat = (n: number) => this.formatValue(n, axis.unit || s.unit || '');
      return {
        name: s.panelTitle ? `${s.panelTitle} · ${s.metricName}` : s.metricName,
        color,
        unit: s.unit || axis.unit,
        ...legendStats(values, stat),
        dashed,
      };
    });
    const legend = !showLegend ? '' : chartSeriesTable(legendRows, (text) => this.utils.escapeHtml(text));

    // One group per series, line and markers together. `data-series` is the index of the
    // series table row beside it, which is the whole pairing mechanism — see CHART_HOVER_CSS.
    const seriesGroups = lines.map(({ series: s, color, path, axis, dashed }, i) => {
      const slot = hoverSlot(i);
      // Markers belong on discrete points: a trend over runs (style.markers), or a single
      // sparse series where the points are the reading rather than the shape.
      const marked = style.markers || (drawn.length === 1 && s.dataPoints.length <= 50);
      return `<g${slot}>`
        + `<path d="${path}" stroke="${color}" stroke-width="${style.markers ? CHART_SIZE.markedLine : CHART_SIZE.line}"`
        + ` fill="none" stroke-linecap="round" stroke-linejoin="round"${dashed ? ` stroke-dasharray="${CHART_SIZE.baselineDash}"` : ''}/>`
        + (marked
          ? s.dataPoints.map((dp) =>
            `<circle cx="${px(scaleX(dp.time.getTime()))}" cy="${px(scaleYOn(axis, dp.value!))}" r="${CHART_SIZE.marker}" fill="${color}"/>`).join('')
          : '')
        + `</g>`;
    }).join('');

    // The cursor readout: a crosshair and every series' value at the pointer.
    //
    // The report has no scripts where it is read (the viewer's iframe has no
    // allow-scripts), so a band per x position IS the hover handler: each band carries its
    // own pre-rendered readout, and CHART_HOVER_CSS reveals the one under the pointer. That
    // is also why the bands are coarse — one per ~22px, not one per data point.
    // A categorical chart gets one band per RUN — "which run is this" is the whole chart —
    // and its width comes from the DOMAIN, not from `labelSource.length`: a run with no
    // value in any series is absent from the labels while still occupying its slot, and
    // sizing on the label count makes every band too wide, so they overlap and a hover near
    // one marker reveals its neighbour's readout.
    //
    // Past `maxBands` runs the layer is dropped rather than drawn: it is bounded in
    // practice by `TREND_PRESET_MAX_RUNS` (graphs-renderer.ts), but that is a caller's
    // constant, and a band carries up to ten readings — 200 runs would be ~300 KB on one
    // chart. No readout beats a report nobody can open.
    const bandCount = style.categorical
      ? Math.max(labelSource.length, 1)
      : Math.min(CURSOR.maxBands, Math.max(6, Math.round(chartWidth / CURSOR.bandPx)));
    const bandWidth = style.categorical ? chartWidth / tRange : chartWidth / bandCount;
    const bandStep = tRange / bandCount;
    const bandTimes = style.categorical
      ? (bandCount > CURSOR.maxBands ? [] : labelSource.map((dp) => dp.time.getTime()))
      : Array.from({ length: bandCount }, (_, i) => tMin + (i + 0.5) * bandStep);
    // A reading has to lie inside the band the pointer is over — expressed as the band's own
    // interval, not as a distance from its centre. Two reasons it is written this way:
    // the intervals tile exactly, so every point belongs to a band and none is lost to the
    // floating-point boundary a half-band distance test loses (a regularly sampled series
    // sits exactly half a band from the nearest centre, which is the COMMON case, not the
    // edge case); and it bounds the spread inside one readout to a single band, so the
    // values under a printed timestamp were all measured around it. A series with nothing
    // in the band is then absent from that readout, never a stale value carried across.
    const bandSpan = style.categorical ? 1 : bandStep;
    // Half a millisecond of slack on the time axis: timestamps are whole milliseconds, and
    // a point landing exactly on a band edge is the common case (a regularly sampled
    // series puts every point at the same phase), so the comparison must not lose it to a
    // floating-point ULP. A run index has no such rounding, hence the token value there.
    const bandSlack = style.categorical ? 1e-9 : 0.5;
    // One walking index per series: the bands ascend and so do the points, so the whole
    // layer costs one pass over the data instead of a search per band per series.
    const walk = lines.map(() => 0);
    const esc = (text: string) => this.utils.escapeHtml(text);
    // How many series a readout can name HERE. `maxSeries` is the ceiling; the plot's own
    // height is the real bound — a full 12-cell box is 158px against the 152px plot of the
    // `low` quality preset, and `chartHeight` comes from an unvalidated section config. The
    // box sheds rows into its "+N more" line rather than overhanging the x-axis labels.
    const maxReadings = Math.max(1, Math.min(
      CURSOR.maxSeries, Math.floor((chartHeight - 14) / CURSOR.rowHeight) - 2,
    ));
    // Name and unit are fixed per series; they were being truncated again in every band
    // (480 calls on a 12-series chart). Deliberately NOT escaped here — escaping happens
    // once, at the emit site below, because `charWidth` measures the glyphs the browser
    // draws: pre-escaping makes `&` five characters to the ruler and nine on the page.
    const seriesLabel = lines.map((line) =>
      truncateLabel(line.series.metricName || line.series.panelTitle || ''));
    const seriesUnit = lines.map((line) => line.axis.unit || line.series.unit || '');
    const hoverLayer = bandTimes.map((t, bandIdx) => {
      const readings: Array<{ color: string; text: string }> = [];
      let hidden = 0;
      // The point the band is labelled by: a real sample, so `xLabelOf` (a trend's run
      // label) gets the data point it expects rather than the band's synthetic centre.
      let anchor: MetricsDataPoint | undefined;
      lines.forEach((line, li) => {
        const points = line.series.dataPoints;
        let i = walk[li]!;
        while (i + 1 < points.length
          && Math.abs(points[i + 1]!.time.getTime() - t) <= Math.abs(points[i]!.time.getTime() - t)) i++;
        walk[li] = i;
        const dp = points[i];
        if (!dp || Math.abs(dp.time.getTime() - t) > bandSpan / 2 + bandSlack) return;
        if (!anchor) anchor = dp;
        // ponytail: a chart with more series than fits gets a count instead of a 30-line
        // box taller than the plot. Scrolling is not available to a cursor on an SVG.
        if (readings.length >= maxReadings) { hidden++; return; }
        readings.push({
          color: line.color,
          text: `${seriesLabel[li]}  ${this.formatValue(dp.value!, seriesUnit[li]!)}`,
        });
      });
      if (readings.length === 0 || !anchor) return '';

      // ONE list, measured and drawn. Sizing the box from one array and filling it from
      // another is how a readout ends up clipped by a word nobody re-measured.
      // Raw text, escaped once when it is written out. See `seriesLabel` above.
      const cells: Array<{ text: string; fill: string }> = [
        { text: xLabelFor(anchor), fill: CHART_INK.text },
        ...readings.map((r) => ({ text: r.text, fill: r.color })),
        ...(hidden > 0 ? [{ text: `+${hidden} more`, fill: CHART_INK.faint }] : []),
      ];
      let boxWidth = 2 * CURSOR.padding;
      for (const cell of cells) {
        boxWidth = Math.max(boxWidth, cell.text.length * CURSOR.charWidth + 2 * CURSOR.padding);
      }
      // Floor as well as ceiling: `chartWidth` can be a couple of px on a hand-set
      // `chartWidth` config, and a negative `width` makes an SVG rect vanish silently.
      boxWidth = Math.max(
        2 * CURSOR.padding, Math.min(boxWidth, Math.max(chartWidth - CURSOR.padding, 0)),
      );
      const boxHeight = cells.length * CURSOR.rowHeight + 14;
      const cx = scaleX(t);
      // Flipped to the near side past the midpoint, then clamped: a readout must not run
      // off the plot, and on a narrow chart the clamp is what keeps it on the page.
      const preferred = cx > padding.left + chartWidth / 2
        ? cx - CURSOR.padding - boxWidth
        : cx + CURSOR.padding;
      const boxX = Math.min(
        Math.max(preferred, padding.left + 2), padding.left + chartWidth - boxWidth - 2,
      );
      // A full readout is 12 cells (head + `maxSeries` + the overflow line) = 158px, which
      // is taller than the 152px plot of the `low` quality preset — and `chartHeight` comes
      // from an unvalidated section config, so it can be anything. Clamped, not constant.
      const boxY = Math.max(padding.top + 2, Math.min(
        padding.top + 6, padding.top + chartHeight - boxHeight - 2,
      ));
      const bandX = style.categorical ? cx - bandWidth / 2 : padding.left + bandIdx * bandWidth;
      const textX = px(boxX + CURSOR.padding);

      // Only geometry and the per-series colour are inline. The crosshair's stroke, the
      // box's fill and the font stack are in CHART_HOVER_CSS: constant per band, and
      // repeating them here was 51% of this layer's bytes. `fill="transparent"` stays on
      // the band rect so a stylesheet-less consumer gets an invisible rect, not a black
      // bar, and `opacity="0"` stays on the readout so it is hidden there too.
      return `<g class="chart-cursor-band">`
        + `<rect x="${px(Math.max(bandX, padding.left))}" y="${padding.top}" width="${px(Math.max(bandWidth, 0))}"`
        + ` height="${chartHeight}" fill="transparent"/>`
        + `<g class="chart-cursor" opacity="0">`
        + `<line x1="${px(cx)}" y1="${padding.top}" x2="${px(cx)}" y2="${padding.top + chartHeight}"/>`
        + `<rect x="${px(boxX)}" y="${boxY}" width="${px(boxWidth)}" height="${boxHeight}" rx="4"/>`
        + `<text>`
        + cells.map((cell, row) => `<tspan x="${textX}" ${row === 0
          ? `y="${boxY + CURSOR.firstBaseline}"`
          : `dy="${CURSOR.rowHeight}"`} fill="${cell.fill}">${esc(cell.text)}</tspan>`).join('')
        + `</text></g></g>`;
    }).join('');

    return `
      <div class="chart-hover" style="margin: 24px 0;">
        ${groupHeader(chartTitle)}
        <div style="font-family: ${CHART_MONO}; font-size: ${CHART_SIZE.tableFont}px; color: ${CHART_INK.faint}; margin: -6px 0 12px;">
          ${subtitle}
        </div>
        ${chartCard(`
          <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto;" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
            <!-- Series are clipped to the plot area: with the x-domain narrowed to the
                 analysis range, the points outside it still have coordinates, and an
                 unclipped path draws them over the axis labels and the page. -->
            <defs>
              <clipPath id="${clipId}">
                <rect x="${padding.left}" y="${padding.top}" width="${chartWidth}" height="${chartHeight}"/>
              </clipPath>
            </defs>

            <!-- The plot area. A fill, not a frame: the standard has no plot border. -->
            <rect x="${padding.left}" y="${padding.top}" width="${chartWidth}" height="${chartHeight}"
                  fill="${CHART_INK.plotBg}"/>

            <!-- Analysis time range: excluded bands and their boundaries -->
            ${analysisShapes.join('')}

            <!-- Grid lines and axis labels -->
            ${gridLines.join('')}
            ${axisUnitLabels}

            <!-- A spine per right-hand axis, so its labels read as an axis -->
            ${axes.filter((a) => a.side === 'right').map((a) => `<line x1="${axisX(a)}" y1="${padding.top}" x2="${axisX(a)}" y2="${padding.top + chartHeight}" stroke="${CHART_INK.divider}" stroke-width="1"/>`).join('')}

            <!-- One group per series — line and its markers together — so data-series is
                 all a hovered legend row needs to dim the others (CHART_HOVER_CSS). -->
            <g clip-path="url(#${clipId})">
            ${seriesGroups}
            </g>

            <!-- X-axis labels -->
            ${xLabels.join('')}

            <!-- Hover bands last: they have to sit above the lines to be the hover target -->
            ${hoverLayer}
          </svg>
        `)}
        ${legend}
      </div>
    `;
  }

  private hashString(value: string): number {
    let h = 0;
    for (let i = 0; i < value.length; i++) {
      h = ((h << 5) - h) + value.charCodeAt(i);
      h |= 0;
    }
    return h;
  }

  private formatValue(value: number, unit: string): string {
    if (unit === 'ms' || unit === 'milliseconds') {
      return formatValueWithUnit(value, 'ms');
    }
    if (unit === 's' || unit === 'seconds') {
      return formatValueWithUnit(value, 's');
    }
    if (unit === '%' || unit === 'percent') {
      return formatValueWithUnit(value, 'percent');
    }
    if (Math.abs(value) >= 1_000_000) {
      return `${formatNum(value / 1_000_000)}M`;
    }
    if (Math.abs(value) >= 1_000) {
      return `${formatNum(value / 1_000)}K`;
    }
    return formatNum(value);
  }
}
