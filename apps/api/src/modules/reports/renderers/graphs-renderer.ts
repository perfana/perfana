import { Injectable, Logger } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import {
  ReportDataFetcherService,
  GraphPresetPanels,
  MetricsDataPoint,
  MetricsPanelSelector,
  MetricsTimeSeriesPanel,
  TrendsPresetSeries,
} from '../services/report-data-fetcher.service';
import { CHANGE_POINT_WINDOW } from '../services/trend-window';
import {
  sectionHeader,
  sectionText,
  emptyState,
  warningState,
  formatInt,
  groupHeader,
} from './report-style';
import {
  ChartSvgService,
  ChartWindow,
  NO_WINDOW,
} from './chart-svg.service';

/**
 * What "quality" means for a server-rendered SVG: how much room the chart gets.
 * There is no raster resolution to trade, so size is the honest reading.
 */
const QUALITY_SIZES: Record<string, { width: number; height: number }> = {
  low: { width: 700, height: 240 },
  standard: { width: 1000, height: 320 },
  high: { width: 1400, height: 460 },
};

/** Trend presets follow the Trends section's window: since the last change point, the current run and at most this many before it. */
const TREND_PRESET_MAX_RUNS = 10;

/**
 * Renderer for Graphs section
 *
 * Displays custom metric graphs from ds_metrics time-series data as inline SVG charts.
 * Supports explicit panel selection or auto-discovery of available panels.
 */
@Injectable()
export class GraphsRenderer {
  private readonly logger = new Logger(GraphsRenderer.name);


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
    private readonly dataFetcher: ReportDataFetcherService,
    private readonly chartSvg: ChartSvgService,
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
    // The whole run is charted and the analysis time range is shaded on top of
    // it, the way the Graphs card does it. Trimming the data here would leave
    // nothing to shade.
    const excludeRampUp = false;
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

    // Off by default: the whole run with the excluded bands dimmed is the view
    // that matches the Graphs card, and the toggle is a deliberate narrowing.
    const window = this.analysisWindow(testRun, config.analysisRangeOnly === true);

    // Determine ds_metrics panels to render
    const includeAggregated = config.includeAggregated === true;
    let panels: MetricsPanelSelector[] = [];

    const idsOf = (key: string) => Array.isArray(config[key])
      ? (config[key] as unknown[]).filter((id): id is string => typeof id === 'string' && id !== '')
      : [];
    const presetIds = idsOf('graphPresetIds');
    const trendsPresetIds = idsOf('trendsPresetIds');

    // Trends presets are drawn after whatever the graph side produces: beside graph presets
    // when there are any, beside the auto-discovered (or listed) panels otherwise — a
    // template that had auto-discovery and gains a trends preset keeps its charts.
    const trends = await this.dataFetcher.getTrendsPresetSeries(trendsPresetIds, userId, roles);
    const trendsMissing = trendsPresetIds.length - trends.foundIds.length;
    if (trendsMissing > 0) {
      this.logger.warn(`Graphs section: ${trendsMissing} of ${trendsPresetIds.length} trends presets no longer exist`);
    }

    if (presetIds.length > 0) {
      // Graph presets are the section's primary selection: the same presets the
      // Graphs card saves, re-applied to whichever run is being reported on.
      const { presets, foundIds } = await this.dataFetcher.getGraphPresetPanels(presetIds, userId, roles);
      const wanted = presetIds.length + trendsPresetIds.length;
      const missing = presetIds.length - foundIds.length;
      if (foundIds.length === 0 && trends.foundIds.length === 0) {
        // Deliberately NOT falling through to auto-discovery: a template that
        // asked for two presets must not silently render every panel in the run.
        return this.renderMissingPresetsSection(title, text, wanted);
      }
      if (missing > 0) {
        this.logger.warn(`Graphs section: ${missing} of ${presetIds.length} graph presets no longer exist`);
      }
      const graphCharts = await this.renderPresetCharts(presets, testRun, excludeRampUp, chartWidth, chartHeight, window, showLegend, userId, roles);
      const trendCharts = await this.renderTrendPresetCharts(trends.presets, presets.length, testRun, chartWidth, chartHeight, showLegend, userId, roles);
      if (graphCharts.seriesCount + trendCharts.seriesCount === 0) {
        return this.renderNoDataSection(title, text, 'No metrics data found for the selected presets.');
      }
      const count = presets.length + trends.presets.length;
      return `
        <section class="graphs-section">
          ${sectionHeader(title, { kicker: `${formatInt(count)} preset${count !== 1 ? 's' : ''}` })}

          ${sectionText(text)}

          ${[...graphCharts.charts, ...trendCharts.charts].join('\n')}
        </section>
      `;
    } else if (Array.isArray(config.panels) && config.panels.length > 0) {
      panels = (config.panels as Array<Record<string, string>>).map((p) => ({
        dashboardLabel: p.dashboardLabel || p.dashboard_label,
        panelTitle: p.panelTitle || p.panel_title,
        metricName: p.metricName || p.metric_name,
      }));
    } else if (trendsPresetIds.length > 0 && trends.foundIds.length === 0) {
      // A trends-only template whose presets are gone: same rule as graph presets, never
      // a silent fall-through to every panel in the run.
      return this.renderMissingPresetsSection(title, text, trendsPresetIds.length);
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

    if (timeSeriesData.length === 0 && trends.presets.length === 0) {
      if (includeAggregated) {
        return this.renderNoDataSection(title, text, 'No aggregated performance-test data found for this test run.');
      }
      if (panels.length === 0) {
        return this.renderNoDataSection(title, text, 'No metric panels configured or discovered for this test run.');
      }
      return this.renderNoDataSection(title, text, 'No metrics data found for the selected panels.');
    }

    const hostLabels = await this.dataFetcher.getDynatraceHostLabels(testRun);
    const charts = timeSeriesData
      .map((panel, idx) =>
        this.renderPanelChart(panel, idx, chartWidth, chartHeight, window, showLegend, hostLabels));
    const trendCharts = await this.renderTrendPresetCharts(trends.presets, timeSeriesData.length, testRun, chartWidth, chartHeight, showLegend, userId, roles);
    // Trends presets that no longer exist are named beside the listed panels rather than
    // replacing them: on this path the panels are the section's primary content.
    const missingTrends = trendsPresetIds.length > 0 && trends.foundIds.length === 0
      ? warningState(`The ${trendsPresetIds.length === 1 ? 'trends preset' : `${trendsPresetIds.length} trends presets`} this section selects no longer exist. Re-select presets in the section configuration.`)
      : '';
    const kicker = [
      timeSeriesData.length > 0 || trends.presets.length === 0
        ? `${formatInt(timeSeriesData.length)} panel${timeSeriesData.length !== 1 ? 's' : ''}` : '',
      trends.presets.length > 0 ? `${formatInt(trends.presets.length)} trend preset${trends.presets.length !== 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(', ');

    return `
      <section class="graphs-section">
        ${sectionHeader(title, { kicker })}

        ${sectionText(text)}

        ${missingTrends}
        ${[...charts, ...trendCharts.charts].join('\n')}
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

  /** The preset's synthetic run-wide aggregates, each computed from the raw tables. */
  private async buildPresetAggregatedPanels(
    testRunId: string,
    selectors: MetricsPanelSelector[],
    excludeRampUp: boolean,
    userId: string,
    roles: string[],
  ): Promise<MetricsTimeSeriesPanel[]> {
    const out: MetricsTimeSeriesPanel[] = [];
    for (const sel of selectors) {
      const spec = sel.aggregate;
      if (!spec) continue;
      const series = await this.dataFetcher.getAggregatedSeries(
        testRunId, spec.metric, spec.stat, excludeRampUp, userId, roles,
      );
      if (series.length === 0) continue;
      out.push({
        panelTitle: sel.panelTitle || '',
        dashboardLabel: sel.dashboardLabel || '',
        metricName: sel.metricName || '',
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
    testRun: TestRun,
    excludeRampUp: boolean,
    width: number,
    height: number,
    window: ChartWindow,
    showLegend: boolean,
    userId: string,
    roles: string[],
  ): Promise<{ charts: string[]; seriesCount: number }> {
    const charts: string[] = [];
    let seriesCount = 0;

    for (const [idx, preset] of presets.entries()) {
      // A preset may mix stored metrics with the synthetic run-wide aggregate, which has no
      // ds_metrics rows and is computed from the raw tables instead.
      const stored = preset.panels.filter((p) => !p.aggregate);
      const aggregated = preset.panels.filter((p) => p.aggregate);
      const series = [
        ...(stored.length > 0
          ? await this.dataFetcher.getMetricsTimeSeries(testRun.testRunId, stored, excludeRampUp, userId, roles)
          : []),
        ...(await this.buildPresetAggregatedPanels(testRun.testRunId, aggregated, excludeRampUp, userId, roles)),
      ];
      if (series.length === 0) {
        charts.push(`
          <div style="margin: 16px 0;">
            ${groupHeader(preset.name)}
            ${emptyState('No metrics data found for this preset in this test run.')}
          </div>
        `);
        continue;
      }
      seriesCount += series.length;
      charts.push(this.chartSvg.renderTimeSeriesChart(preset.name, series, idx, width, height, window, showLegend));
    }

    return { charts, seriesCount };
  }

  /**
   * One chart per Trends-card preset: each series' statistic per run, over the same run
   * window the Trends section uses (since ADAPT's last change point, at most
   * TREND_PRESET_MAX_RUNS). Runs are spaced evenly, as the card draws them, and labelled
   * by start time.
   */
  private async renderTrendPresetCharts(
    presets: TrendsPresetSeries[],
    colorOffset: number,
    testRun: TestRun,
    width: number,
    height: number,
    showLegend: boolean,
    userId: string,
    roles: string[],
  ): Promise<{ charts: string[]; seriesCount: number }> {
    const charts: string[] = [];
    let seriesCount = 0;
    if (presets.length === 0) return { charts, seriesCount };

    const runs = await this.dataFetcher.getTrendRunWindow(testRun, TREND_PRESET_MAX_RUNS, userId, roles, CHANGE_POINT_WINDOW);
    const runIds = runs.map((r) => r.testRunId);
    // ponytail: x is the run's index, so `time` is a synthetic epoch; the label closes over
    // the run list to render its start time. Real timestamps would cluster ad-hoc runs.
    const labelOf = (dp: MetricsDataPoint) => {
      const run = runs[dp.time.getTime()];
      return run ? run.startTime.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    };
    const toPoints = (valuesByRun: Record<string, number | null>) =>
      runIds.map((id, i) => ({ time: new Date(i), value: valuesByRun[id] ?? null }));
    // The run-wide aggregates are per (metric, stat), not per preset: two presets asking for
    // the same one share one query.
    const aggregateCache = new Map<string, Promise<Record<string, number | null>>>();
    const aggregateValues = (metric: TrendsPresetSeries['aggregates'][number]['metric'], stat: TrendsPresetSeries['aggregates'][number]['stat']) => {
      const key = `${metric}|${stat}`;
      let p = aggregateCache.get(key);
      if (!p) {
        p = runIds.length > 0 ? this.dataFetcher.getAggregatedTrendValues(runIds, metric, stat) : Promise.resolve({});
        aggregateCache.set(key, p);
      }
      return p;
    };

    for (const [idx, preset] of presets.entries()) {
      const title = `${preset.name} (${preset.stat})`;
      const trends = runIds.length > 0 && preset.selections.length > 0
        ? await this.dataFetcher.getMetricTrends(runIds, preset.selections, preset.stat)
        : [];
      const aggregated: MetricsTimeSeriesPanel[] = [];
      for (const agg of preset.aggregates) {
        aggregated.push({
          panelTitle: agg.panelTitle,
          dashboardLabel: agg.dashboardLabel,
          metricName: agg.metricName,
          unit: agg.unit,
          dataPoints: toPoints(await aggregateValues(agg.metric, agg.stat)),
        });
      }
      const series: MetricsTimeSeriesPanel[] = [
        ...trends.map((t) => ({
          panelTitle: t.panelTitle,
          dashboardLabel: t.dashboardLabel,
          metricName: t.metricName,
          unit: t.unit ?? '',
          dataPoints: toPoints(t.valuesByRun),
        })),
        ...aggregated,
      ]
        // A series with no value in any run is no series: it would otherwise count as data
        // and draw an empty chart wrapper instead of the preset's own empty state.
        .filter((s) => s.dataPoints.some((dp) => dp.value !== null));
      if (series.length === 0) {
        charts.push(`
          <div style="margin: 16px 0;">
            ${groupHeader(title)}
            ${emptyState('No trend data found for this preset in the run window.')}
          </div>
        `);
        continue;
      }
      seriesCount += series.length;
      charts.push(this.chartSvg.renderTimeSeriesChart(title, series, colorOffset + idx, width, height, NO_WINDOW, showLegend, {
        xLabelOf: labelOf, markers: true, categorical: { pointNoun: 'runs' },
      }));
    }

    return { charts, seriesCount };
  }

  private renderPanelChart(
    panel: MetricsTimeSeriesPanel,
    panelIdx: number,
    width: number,
    height: number,
    window: ChartWindow,
    showLegend: boolean = true,
    hostLabels: Record<string, string[]> = {},
  ): string {
    // A chart title is plain text, so a host's labels ride along in brackets rather
    // than as chips the way the trends and comparisons group headings render them.
    const labels = panel.dashboardLabel ? hostLabels[panel.dashboardLabel] ?? [] : [];
    const dashboard = labels.length
      ? `${panel.dashboardLabel} [${labels.join(', ')}]`
      : panel.dashboardLabel;
    const chartTitle = panel.dashboardLabel
      ? `${dashboard} — ${panel.panelTitle}`
      : panel.panelTitle;
    return this.chartSvg.renderTimeSeriesChart(chartTitle, [panel], panelIdx, width, height, window, showLegend);
  }

  /**
   * The run's analysis time range, in epoch milliseconds.
   *
   * The offsets belong to the test run, not to the section: they are the same
   * `analysisStartOffset` / `analysisEndOffset` (seconds) the Graphs card reads,
   * so the report and the card mark the same band. Without a clock to anchor
   * them to, neither end is marked.
   */
  private analysisWindow(testRun: TestRun, only = false): ChartWindow {
    const start = testRun.startTime ? new Date(testRun.startTime).getTime() : null;
    const end = testRun.endTime ? new Date(testRun.endTime).getTime() : null;
    return {
      from: start !== null && testRun.analysisStartOffset ? start + testRun.analysisStartOffset * 1000 : null,
      to: end !== null && testRun.analysisEndOffset ? end - testRun.analysisEndOffset * 1000 : null,
      only,
    };
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
   * Every preset (graph or trends) this section names is gone. A warning, not the neutral
   * empty state: the report is read long after generation, and "the presets
   * this section was built on no longer exist" must not look like "this run had
   * no metrics".
   */
  private renderMissingPresetsSection(title: string, text: string | undefined, count: number): string {
    this.logger.warn(`Graphs section: all ${count} configured presets are missing`);
    return `
      <section class="graphs-section">
        ${sectionHeader(title)}
        ${sectionText(text)}
        ${warningState(`The ${count === 1 ? 'preset' : `${count} presets`} this section selects no longer exist. Re-select presets in the section configuration.`)}
      </section>
    `;
  }
}
