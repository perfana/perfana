import { Injectable, Logger } from '@nestjs/common';
import { MetricsDataPoint, MetricsTimeSeriesPanel } from '../services/report-data-fetcher.service';
import { ReportUtilsService } from '../services/report-utils.service';
import { REPORT_COLORS, emptyState, formatInt, formatNum, groupHeader } from './report-style';
import { formatValueWithUnit } from './unit-format';

/**
 * The report's time-series chart, as a server-rendered inline SVG.
 *
 * A report is one self-contained HTML file read in an iframe with no
 * `allow-scripts` (see `report-interactivity.ts`), so there is no client chart
 * library to lean on: every chart in every section is SVG built here. It began
 * as `GraphsRenderer.renderChart` and moved out when the comparisons section
 * needed the same chart for its current-vs-baseline graphs — two renderers, one
 * chart, rather than a second implementation that slowly diverges.
 *
 * Multi-unit (one Y axis per distinct unit, collapsing to a shared scale when the
 * axes would not fit), analysis-window aware, and optionally categorical for a
 * trend whose x-axis is runs rather than time.
 */

/** Default series colours, assigned by index from the caller's `colorOffset`. */
const CHART_COLORS = [
  '#4285f4', '#ea8c55', '#db524e', '#6aa84f', '#9c50b6', '#46bdc6', '#ea6c3d',
  '#f4b400', '#0f9d58', '#ab47bc', '#00acc1', '#ff7043',
];

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

/** A chart with no analysis window to mark — trend charts, whose x-axis is runs, not time. */
export const NO_WINDOW: ChartWindow = { from: null, to: null, only: false };

/**
 * One drawn series. `color` and `dashed` exist for the comparisons section, where the
 * two lines are not two metrics but the same metric on two runs: the baseline has to be
 * told apart from the current run by more than hue, so it is drawn dashed — and it reads
 * that way in a greyscale print too.
 */
export type ChartSeries = MetricsTimeSeriesPanel & { color?: string; dashed?: boolean };

/**
 * A series colour, or the palette default if it is not a plain hex.
 *
 * `color` lands unescaped in a `stroke=` and in the legend's `background:`, and a report is
 * served from the public share page with no authentication, so this is the one place that
 * has to refuse `" onload=` rather than trust its callers. Both current callers pass a
 * constant from `report-style`; this is about the next one.
 */
const safeColor = (color: string | undefined, fallback: string): string =>
  color && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : fallback;

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
      .map((s) => ({ ...s, dataPoints: s.dataPoints.filter((dp) => dp.value !== null) }))
      .filter((s) => s.dataPoints.length > 0);

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
      const values = points.map((dp) => dp.value!);
      // A unit whose series all fall outside the window would give Infinity here.
      if (values.length === 0) return { yMin: 0, yMax: 1 };
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);
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

    const padding = {
      top: 20,
      right: collapse ? 40 : wanted,
      bottom: 60,
      left: 80,
    };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // The single-axis case keeps the old label: one unit, named.
    const unit = axes.length === 1 ? axes[0]!.unit : '';

    // Compute X-axis range
    const times = allPoints.map((dp) => dp.time.getTime());
    const dataMin = Math.min(...times);
    const dataMax = Math.max(...times);
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
    const scaleY = (v: number) => scaleYOn(axes[0]!, v);
    /** Where a right-hand axis is drawn: successively further out. */
    const axisX = (axis: { side: 'left' | 'right'; index: number }) =>
      axis.side === 'left'
        ? padding.left
        : padding.left + chartWidth + (axis.index - 1) * RIGHT_AXIS_WIDTH;

    // One path per series, each in its own colour, each on its unit's axis
    const lines = drawn.map((s, i) => {
      const color = safeColor(s.color, CHART_COLORS[(colorOffset + i) % CHART_COLORS.length]!);
      const axis = axisFor(s);
      // Coordinates to 0.1px, and consecutive duplicates dropped. A 3-hour run is tens of
      // thousands of points on a 900px-wide chart, where full float precision is ~17
      // characters per point of path data that renders identically — and this SVG is stored
      // in Postgres, mailed, and run through Puppeteer.
      const px = (n: number) => Math.round(n * 10) / 10;
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
      `<rect x="${x0}" y="${padding.top}" width="${Math.max(0, x1 - x0)}" height="${chartHeight}" fill="#9e9e9e" opacity="0.18"/>`;
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
      gridLines.push(`
        <line x1="${padding.left}" y1="${y}" x2="${padding.left + chartWidth}" y2="${y}"
              stroke="#e0e0e0" stroke-width="1" stroke-dasharray="2,2"/>
      `);
      for (const axis of axes) {
        const value = axis.yMax - ((axis.yMax - axis.yMin) / numGridLines) * i;
        const label = this.formatValue(value, axis.unit);
        const x = axisX(axis);
        // A second axis is tinted with its own series' colour so the reader can
        // tell at a glance which line it scales.
        const tint = axis.side === 'left'
          ? '#666'
          : (lines.find((l) => l.axis === axis)?.color ?? '#666');
        gridLines.push(`
          <text x="${axis.side === 'left' ? x - 10 : x + 8}" y="${y + 4}"
                text-anchor="${axis.side === 'left' ? 'end' : 'start'}"
                font-size="9" fill="${tint}">${this.utils.escapeHtml(label)}</text>
        `);
      }
    }

    // Axis titles: the left one keeps its rotated label, each right one gets
    // its unit above the plot where there is room for it.
    const rightAxisTitles = axes
      .filter((axis) => axis.side === 'right' && axis.unit)
      .map((axis) => {
        const tint = lines.find((l) => l.axis === axis)?.color ?? '#666';
        return `<text x="${axisX(axis) + 8}" y="${padding.top - 6}"
                      text-anchor="start" font-size="9" font-weight="600"
                      fill="${tint}">${this.utils.escapeHtml(axis.unit)}</text>`;
      })
      .join('');

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
      const timeLabel = style.xLabelOf
        ? this.utils.escapeHtml(style.xLabelOf(dp))
        : dp.time.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          });
      xLabels.push(`
        <text x="${x}" y="${yPos}"
              text-anchor="end" font-size="9" fill="#666"
              transform="rotate(-30 ${x} ${yPos})">${timeLabel}</text>
      `);
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
    const legend = !showLegend ? '' : `
      <div style="display: flex; flex-wrap: wrap; gap: 14px; margin: 0 0 12px;">
        ${lines.map(({ series: s, color }) => `
          <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 9pt; color: ${REPORT_COLORS.mutedInk};">
            <span style="width: 12px; height: 3px; border-radius: 2px; background: ${color}; display: inline-block;"></span>
            ${this.utils.escapeHtml(s.panelTitle ? `${s.panelTitle} · ${s.metricName}` : s.metricName)}${axes.length > 1 && s.unit ? ` <span style="color:${REPORT_COLORS.faintInk};">(${this.utils.escapeHtml(s.unit)})</span>` : ''}
          </span>`).join('')}
      </div>`;

    return `
      <div style="margin: 24px 0; padding: 20px; background: #f5f5f5; border-radius: 4px;">
        ${groupHeader(chartTitle)}
        <div style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; margin: -6px 0 12px;">
          ${subtitle}
        </div>
        ${legend}

        <div style="background: white; border-radius: 4px; border: 1px solid #e0e0e0; padding: 10px;">
          <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto;" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
            <!-- Series are clipped to the plot area: with the x-domain narrowed to the
                 analysis range, the points outside it still have coordinates, and an
                 unclipped path draws them over the axis labels and the page. -->
            <defs>
              <clipPath id="${clipId}">
                <rect x="${padding.left}" y="${padding.top}" width="${chartWidth}" height="${chartHeight}"/>
              </clipPath>
            </defs>

            <!-- Chart border -->
            <rect x="${padding.left}" y="${padding.top}" width="${chartWidth}" height="${chartHeight}"
                  fill="none" stroke="#999" stroke-width="1"/>

            <!-- Analysis time range: excluded bands and their boundaries -->
            ${analysisShapes.join('')}

            <!-- Grid lines and axis labels -->
            ${gridLines.join('')}
            ${rightAxisTitles}

            <!-- A spine per right-hand axis, so its labels read as an axis -->
            ${axes.filter((a) => a.side === 'right').map((a) => `<line x1="${axisX(a)}" y1="${padding.top}" x2="${axisX(a)}" y2="${padding.top + chartHeight}" stroke="#ccc" stroke-width="1"/>`).join('')}

            <!-- Data lines -->
            <g clip-path="url(#${clipId})">
            ${lines.map(({ color, path, dashed }) => `<path d="${path}" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"${dashed ? ' stroke-dasharray="6,4"' : ''}/>`).join('')}

            <!-- Data points: only worth drawing on a sparse single-series chart, or when asked -->
            ${style.markers
              ? lines.map(({ series: s, color, axis }) => s.dataPoints.map((dp) =>
                  `<circle cx="${scaleX(dp.time.getTime())}" cy="${scaleYOn(axis, dp.value!)}" r="2.5" fill="${color}"/>`).join('')).join('')
              : drawn.length === 1 && dataPoints.length <= 50 ? dataPoints.map((dp) => {
              const cx = scaleX(dp.time.getTime());
              const cy = scaleY(dp.value!);
              return `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${lines[0]!.color}"/>`;
            }).join('') : ''}
            </g>

            <!-- X-axis labels -->
            ${xLabels.join('')}

            <!-- Y-axis label -->
            <text x="15" y="${padding.top + chartHeight / 2}"
                  text-anchor="middle" font-size="10" fill="#666" font-weight="600"
                  transform="rotate(-90 15 ${padding.top + chartHeight / 2})">${this.utils.escapeHtml(axes[0]!.unit || 'Value')}</text>
          </svg>
        </div>
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
