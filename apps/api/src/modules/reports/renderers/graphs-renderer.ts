import { Injectable, Logger } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import {
  ReportDataFetcherService,
  GraphPresetPanels,
  MetricsDataPoint,
  MetricsPanelSelector,
  MetricsTimeSeriesPanel,
} from '../services/report-data-fetcher.service';
import {
  REPORT_COLORS,
  sectionHeader,
  sectionText,
  emptyState,
  warningState,
  formatInt,
  formatNum,
  groupHeader,
} from './report-style';
import { formatValueWithUnit } from './unit-format';

/**
 * What "quality" means for a server-rendered SVG: how much room the chart gets.
 * There is no raster resolution to trade, so size is the honest reading.
 */
const QUALITY_SIZES: Record<string, { width: number; height: number }> = {
  low: { width: 700, height: 240 },
  standard: { width: 1000, height: 320 },
  high: { width: 1400, height: 460 },
};

/** The slice of the run to chart, as epoch milliseconds. */
interface ChartWindow {
  from: number;
  to: number;
}

/**
 * Renderer for Graphs section
 *
 * Displays custom metric graphs from ds_metrics time-series data as inline SVG charts.
 * Supports explicit panel selection or auto-discovery of available panels.
 */
@Injectable()
export class GraphsRenderer {
  private readonly logger = new Logger(GraphsRenderer.name);

  private static readonly CHART_COLORS = [
    '#4285f4', '#ea8c55', '#db524e', '#6aa84f', '#9c50b6', '#46bdc6', '#ea6c3d',
    '#f4b400', '#0f9d58', '#ab47bc', '#00acc1', '#ff7043',
  ];

  private static readonly AGGREGATED_METRICS: ReadonlyArray<{
    metric: 'transaction_response_time' | 'request_response_time' | 'error_percentage';
    title: string;
    unit: string;
  }> = [
    { metric: 'transaction_response_time', title: 'All aggregated — Transaction response time (avg)', unit: 'ms' },
    { metric: 'request_response_time', title: 'All aggregated — Request response time (avg)', unit: 'ms' },
    { metric: 'error_percentage', title: 'All aggregated — Error percentage', unit: '%' },
  ];

  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  /**
   * Render Graphs section
   */
  async renderGraphsSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const config = section.config || {};
    const title = section.title || 'Custom Graphs';
    const text = getSectionText(section);
    const excludeRampUp = config.excludeRampUp !== false;
    // Quality picks the chart's rendered size — the only dimension an inline SVG
    // has to trade. An explicit chartWidth/chartHeight still wins, so a template
    // that set them keeps its size.
    const quality = QUALITY_SIZES[String(config.quality ?? 'standard')] ?? QUALITY_SIZES.standard!;
    const chartWidth = (config.chartWidth as number) || quality.width;
    const chartHeight = (config.chartHeight as number) || quality.height;
    const showLegend = config.showLegends !== false;

    if (!testRun) {
      return this.renderNoDataSection(title, text, 'No test run data available for graph rendering.');
    }

    const window = this.chartWindow(config, testRun);

    // Determine ds_metrics panels to render
    const includeAggregated = config.includeAggregated === true;
    let panels: MetricsPanelSelector[] = [];

    const presetIds = Array.isArray(config.graphPresetIds)
      ? (config.graphPresetIds as unknown[]).filter((id): id is string => typeof id === 'string' && id !== '')
      : [];

    if (presetIds.length > 0) {
      // Graph presets are the section's primary selection: the same presets the
      // Graphs card saves, re-applied to whichever run is being reported on.
      const { presets, foundIds } = await this.dataFetcher.getGraphPresetPanels(presetIds, userId, roles);
      const missing = presetIds.length - foundIds.length;
      if (foundIds.length === 0) {
        // Deliberately NOT falling through to auto-discovery: a template that
        // asked for two presets must not silently render every panel in the run.
        return this.renderMissingPresetsSection(title, text, presetIds.length);
      }
      if (missing > 0) {
        this.logger.warn(`Graphs section: ${missing} of ${presetIds.length} graph presets no longer exist`);
      }
      return this.renderPresetCharts(presets, title, text, testRun, excludeRampUp, chartWidth, chartHeight, window, showLegend, userId, roles);
    } else if (Array.isArray(config.panels) && config.panels.length > 0) {
      panels = (config.panels as Array<Record<string, string>>).map((p) => ({
        dashboardLabel: p.dashboardLabel || p.dashboard_label,
        panelTitle: p.panelTitle || p.panel_title,
        metricName: p.metricName || p.metric_name,
      }));
    } else {
      // Auto-discover available panels. Aggregated series (if enabled) are appended
      // on top of these — not a substitute for them.
      panels = await this.dataFetcher.getAvailableMetricsPanels(testRun.testRunId, userId, roles);
    }

    let timeSeriesData: MetricsTimeSeriesPanel[] = [];
    if (panels.length > 0) {
      timeSeriesData = await this.dataFetcher.getMetricsTimeSeries(
        testRun.testRunId, panels, excludeRampUp, userId, roles,
      );
    }
    if (includeAggregated) {
      timeSeriesData = [
        ...timeSeriesData,
        ...(await this.buildAggregatedPanels(testRun.testRunId, excludeRampUp, userId, roles)),
      ];
    }

    timeSeriesData = this.clipToWindow(timeSeriesData, window);

    if (timeSeriesData.length === 0) {
      if (includeAggregated) {
        return this.renderNoDataSection(title, text, 'No aggregated performance-test data found for this test run.');
      }
      if (panels.length === 0) {
        return this.renderNoDataSection(title, text, 'No metric panels configured or discovered for this test run.');
      }
      return this.renderNoDataSection(title, text, 'No ds_metrics data found for the selected panels.');
    }

    const charts = timeSeriesData
      .map((panel, idx) => this.renderPanelChart(panel, idx, chartWidth, chartHeight, showLegend))
      .join('\n');

    return `
      <section class="graphs-section">
        ${sectionHeader(title, { kicker: `${formatInt(timeSeriesData.length)} panel${timeSeriesData.length !== 1 ? 's' : ''}` })}

        ${sectionText(text)}

        ${charts}
      </section>
    `;
  }

  private async buildAggregatedPanels(
    testRunId: string,
    excludeRampUp: boolean,
    userId: string,
    roles: string[],
  ): Promise<MetricsTimeSeriesPanel[]> {
    const out: MetricsTimeSeriesPanel[] = [];
    for (const spec of GraphsRenderer.AGGREGATED_METRICS) {
      const series = await this.dataFetcher.getAggregatedSeries(
        testRunId, spec.metric, 'avg', excludeRampUp, userId, roles,
      );
      if (series.length === 0) continue;
      out.push({
        panelTitle: spec.title,
        dashboardLabel: 'Performance Test Metrics',
        metricName: spec.metric,
        unit: spec.unit,
        dataPoints: series.map((p) => ({ time: p.time, value: p.value })),
      });
    }
    return out;
  }

  /**
   * One chart per preset, drawing every series the preset combines.
   *
   * A preset IS a chart — the Graphs card lets an author put series from
   * different panels on one set of axes, and splitting them back into a chart
   * per panel throws that away. Each preset is fetched on its own so its series
   * stay together; presets are a handful, so the extra round trips are cheap
   * next to re-matching a flattened result back onto its preset.
   */
  private async renderPresetCharts(
    presets: GraphPresetPanels[],
    title: string,
    text: string | undefined,
    testRun: TestRun,
    excludeRampUp: boolean,
    width: number,
    height: number,
    window: ChartWindow,
    showLegend: boolean,
    userId: string,
    roles: string[],
  ): Promise<string> {
    const charts: string[] = [];
    let seriesCount = 0;

    for (const [idx, preset] of presets.entries()) {
      const series = this.clipToWindow(
        preset.panels.length > 0
          ? await this.dataFetcher.getMetricsTimeSeries(testRun.testRunId, preset.panels, excludeRampUp, userId, roles)
          : [],
        window,
      );
      if (series.length === 0) {
        charts.push(`
          <div style="margin: 16px 0;">
            ${groupHeader(preset.name)}
            ${emptyState('No ds_metrics data found for this preset in this test run.')}
          </div>
        `);
        continue;
      }
      seriesCount += series.length;
      charts.push(this.renderChart(preset.name, series, idx, width, height, showLegend));
    }

    if (seriesCount === 0) {
      return this.renderNoDataSection(title, text, 'No ds_metrics data found for the selected graph presets.');
    }

    return `
      <section class="graphs-section">
        ${sectionHeader(title, { kicker: `${formatInt(presets.length)} preset${presets.length !== 1 ? 's' : ''}` })}

        ${sectionText(text)}

        ${charts.join('\n')}
      </section>
    `;
  }

  private renderPanelChart(
    panel: MetricsTimeSeriesPanel,
    panelIdx: number,
    width: number,
    height: number,
    showLegend: boolean = true,
  ): string {
    const chartTitle = panel.dashboardLabel
      ? `${panel.dashboardLabel} — ${panel.panelTitle}`
      : panel.panelTitle;
    return this.renderChart(chartTitle, [panel], panelIdx, width, height, showLegend);
  }

  /**
   * The slice of the run the section asked to chart.
   *
   * Offsets trim from each END of the run, the same convention the analysis
   * time range uses (effective duration = duration − start − end) — a reader who
   * has set one there should not have to learn a second meaning here.
   */
  private chartWindow(config: Record<string, unknown>, testRun: TestRun): ChartWindow {
    const range = (config.timeRange ?? {}) as { startOffset?: unknown; endOffset?: unknown };
    const minutes = (value: unknown) => {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) && n > 0 ? n * 60_000 : 0;
    };
    const startTrim = minutes(range.startOffset);
    const endTrim = minutes(range.endOffset);
    if (startTrim === 0 && endTrim === 0) return { from: -Infinity, to: Infinity };

    // Trimming needs the run's own clock. Without it the offsets have no anchor,
    // so the window is left open rather than guessed at from the data.
    const start = testRun.startTime ? new Date(testRun.startTime).getTime() : null;
    const end = testRun.endTime ? new Date(testRun.endTime).getTime() : null;
    return {
      from: start !== null && startTrim > 0 ? start + startTrim : -Infinity,
      to: end !== null && endTrim > 0 ? end - endTrim : Infinity,
    };
  }

  /** Drop the points outside the window, and any series left with nothing. */
  private clipToWindow(series: MetricsTimeSeriesPanel[], window: ChartWindow): MetricsTimeSeriesPanel[] {
    if (window.from === -Infinity && window.to === Infinity) return series;
    return series
      .map((s) => ({
        ...s,
        dataPoints: s.dataPoints.filter((dp) => {
          const t = dp.time.getTime();
          return t >= window.from && t <= window.to;
        }),
      }))
      .filter((s) => s.dataPoints.length > 0);
  }

  /**
   * A line chart over one or more series.
   *
   * Series are scaled per UNIT, not per chart: a preset combining ms with a
   * count has two ranges that share nothing, and putting them on one scale
   * flattens whichever is smaller into the axis. Each distinct unit therefore
   * gets its own axis — the first on the left, the rest down the right — with
   * all axes sharing the same gridline positions, so a value can be read off
   * whichever axis its colour belongs to.
   *
   * A chart whose series all share a unit renders exactly as it did with one
   * axis, which is every single-panel chart in the section.
   */
  private renderChart(
    chartTitle: string,
    series: MetricsTimeSeriesPanel[],
    colorOffset: number,
    width: number,
    height: number,
    showLegend: boolean = true,
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

    // One axis per distinct unit, in the order the units first appear, so the
    // left axis belongs to the first series drawn.
    const unitsInOrder = [...new Set(drawn.map((s) => s.unit || ''))];
    const range = (points: MetricsDataPoint[]) => {
      const values = points.map((dp) => dp.value!);
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
      ...range(collapse ? allPoints : drawn.filter((s) => (s.unit || '') === unit).flatMap((s) => s.dataPoints)),
    }));
    const axisFor = (s: MetricsTimeSeriesPanel) =>
      axes.find((a) => a.unit === (s.unit || '')) ?? axes[0]!;

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
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
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
      const color = GraphsRenderer.CHART_COLORS[(colorOffset + i) % GraphsRenderer.CHART_COLORS.length];
      const axis = axisFor(s);
      const path = s.dataPoints
        .map((dp, j) => {
          const x = scaleX(dp.time.getTime());
          const y = scaleYOn(axis, dp.value!);
          return j === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
        })
        .join(' ');
      return { series: s, color, path, axis };
    });

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

    // X-axis labels (up to 6 evenly spaced)
    const xLabelCount = Math.min(6, dataPoints.length);
    const xLabels: string[] = [];
    for (let i = 0; i < xLabelCount; i++) {
      const idx = Math.round((i / (xLabelCount - 1)) * (dataPoints.length - 1));
      const dp = dataPoints[idx]!;
      const x = scaleX(dp.time.getTime());
      const yPos = padding.top + chartHeight + 10;
      const timeLabel = dp.time.toLocaleTimeString('en-US', {
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
    // One series names itself in the subtitle, as it always has. Several get a
    // legend instead — a subtitle listing five metric names is unreadable.
    const subtitle = drawn.length === 1
      ? `${this.utils.escapeHtml(drawn[0]!.metricName)}${unitLabel} &middot; ${formatInt(allPoints.length)} data points`
      : `${formatInt(drawn.length)} series${unitLabel} &middot; ${formatInt(allPoints.length)} data points`;
    const legend = drawn.length === 1 || !showLegend ? '' : `
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
            <!-- Chart border -->
            <rect x="${padding.left}" y="${padding.top}" width="${chartWidth}" height="${chartHeight}"
                  fill="none" stroke="#999" stroke-width="1"/>

            <!-- Grid lines and axis labels -->
            ${gridLines.join('')}
            ${rightAxisTitles}

            <!-- A spine per right-hand axis, so its labels read as an axis -->
            ${axes.filter((a) => a.side === 'right').map((a) => `<line x1="${axisX(a)}" y1="${padding.top}" x2="${axisX(a)}" y2="${padding.top + chartHeight}" stroke="#ccc" stroke-width="1"/>`).join('')}

            <!-- Data lines -->
            ${lines.map(({ color, path }) => `<path d="${path}" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}

            <!-- Data points: only worth drawing on a sparse single-series chart -->
            ${drawn.length === 1 && dataPoints.length <= 50 ? dataPoints.map((dp) => {
              const cx = scaleX(dp.time.getTime());
              const cy = scaleY(dp.value!);
              return `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${lines[0]!.color}"/>`;
            }).join('') : ''}

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

  private renderNoDataSection(title: string, text: string | undefined, message: string): string {
    return `
      <section class="graphs-section">
        ${sectionHeader(title)}
        ${sectionText(text)}
        ${emptyState(message)}
      </section>
    `;
  }

  /**
   * Every graph preset this section names is gone. A warning, not the neutral
   * empty state: the report is read long after generation, and "the presets
   * this section was built on no longer exist" must not look like "this run had
   * no metrics".
   */
  private renderMissingPresetsSection(title: string, text: string | undefined, count: number): string {
    this.logger.warn(`Graphs section: all ${count} configured graph presets are missing`);
    return `
      <section class="graphs-section">
        ${sectionHeader(title)}
        ${sectionText(text)}
        ${warningState(`The ${count === 1 ? 'graph preset' : `${count} graph presets`} this section selects no longer exist. Re-select presets in the section configuration.`)}
      </section>
    `;
  }
}
