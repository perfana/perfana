import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import {
  ReportDataFetcherService,
  MetricsPanelSelector,
  MetricsTimeSeriesPanel,
} from '../services/report-data-fetcher.service';
import {
  REPORT_COLORS,
  sectionHeader,
  commentBlock,
  emptyState,
  formatInt,
  formatNum,
  groupHeader,
} from './report-style';
import { formatValueWithUnit } from './unit-format';

/**
 * Renderer for Graphs section
 *
 * Displays custom metric graphs from ds_metrics time-series data as inline SVG charts.
 * Supports explicit panel selection or auto-discovery of available panels.
 */
@Injectable()
export class GraphsRenderer {
  private static readonly CHART_COLORS = [
    '#4285f4', '#ea8c55', '#db524e', '#6aa84f', '#9c50b6', '#46bdc6', '#ea6c3d',
    '#f4b400', '#0f9d58', '#ab47bc', '#00acc1', '#ff7043',
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
    const comment = section.comment;
    const excludeRampUp = config.excludeRampUp !== false;
    const chartWidth = (config.chartWidth as number) || 1000;
    const chartHeight = (config.chartHeight as number) || 320;

    if (!testRun) {
      return this.renderNoDataSection(title, comment, 'No test run data available for graph rendering.');
    }

    // Determine panels to render
    let panels: MetricsPanelSelector[] = [];

    if (Array.isArray(config.panels) && config.panels.length > 0) {
      panels = (config.panels as Array<Record<string, string>>).map((p) => ({
        dashboardLabel: p.dashboardLabel || p.dashboard_label,
        panelTitle: p.panelTitle || p.panel_title,
        metricName: p.metricName || p.metric_name,
      }));
    } else {
      // Auto-discover available panels
      panels = await this.dataFetcher.getAvailableMetricsPanels(
        testRun.testRunId, userId, roles,
      );
    }

    if (panels.length === 0) {
      return this.renderNoDataSection(title, comment, 'No metric panels configured or discovered for this test run.');
    }

    // Fetch time-series data for all panels
    const timeSeriesData = await this.dataFetcher.getMetricsTimeSeries(
      testRun.testRunId, panels, excludeRampUp, userId, roles,
    );

    if (timeSeriesData.length === 0) {
      return this.renderNoDataSection(title, comment, 'No ds_metrics data found for the selected panels.');
    }

    const charts = timeSeriesData
      .map((panel, idx) => this.renderPanelChart(panel, idx, chartWidth, chartHeight))
      .join('\n');

    return `
      <section class="graphs-section">
        ${sectionHeader(title, { kicker: `${formatInt(timeSeriesData.length)} panel${timeSeriesData.length !== 1 ? 's' : ''}` })}

        ${commentBlock(comment)}

        ${charts}
      </section>
    `;
  }

  private renderPanelChart(
    panel: MetricsTimeSeriesPanel,
    panelIdx: number,
    width: number,
    height: number,
  ): string {
    const color = GraphsRenderer.CHART_COLORS[panelIdx % GraphsRenderer.CHART_COLORS.length];
    const padding = { top: 20, right: 40, bottom: 60, left: 80 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const dataPoints = panel.dataPoints.filter((dp) => dp.value !== null);

    if (dataPoints.length === 0) {
      return `
        <div style="margin: 16px 0;">
          ${groupHeader(panel.panelTitle)}
          ${emptyState('No data points available.')}
        </div>
      `;
    }

    // Compute Y-axis range
    const values = dataPoints.map((dp) => dp.value!);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const valueRange = maxVal - minVal || 1;
    const yPadding = valueRange * 0.1;
    const yMin = Math.max(0, minVal - yPadding);
    const yMax = maxVal + yPadding;

    // Compute X-axis range
    const times = dataPoints.map((dp) => dp.time.getTime());
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const tRange = tMax - tMin || 1;

    const scaleX = (t: number) => padding.left + ((t - tMin) / tRange) * chartWidth;
    const scaleY = (v: number) => padding.top + chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight;

    // Generate line path
    const pathData = dataPoints
      .map((dp, i) => {
        const x = scaleX(dp.time.getTime());
        const y = scaleY(dp.value!);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
      })
      .join(' ');

    // Grid lines (5 horizontal)
    const numGridLines = 5;
    const gridLines: string[] = [];
    for (let i = 0; i <= numGridLines; i++) {
      const y = padding.top + (chartHeight / numGridLines) * i;
      const value = yMax - ((yMax - yMin) / numGridLines) * i;
      const label = this.formatValue(value, panel.unit);
      gridLines.push(`
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"
              stroke="#e0e0e0" stroke-width="1" stroke-dasharray="2,2"/>
        <text x="${padding.left - 10}" y="${y + 4}"
              text-anchor="end" font-size="9" fill="#666">${this.utils.escapeHtml(label)}</text>
      `);
    }

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

    const chartTitle = panel.dashboardLabel
      ? `${panel.dashboardLabel} — ${panel.panelTitle}`
      : panel.panelTitle;

    const unitLabel = panel.unit ? ` (${this.utils.escapeHtml(panel.unit)})` : '';

    return `
      <div style="margin: 24px 0; padding: 20px; background: #f5f5f5; border-radius: 4px;">
        ${groupHeader(chartTitle)}
        <div style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; margin: -6px 0 12px;">
          ${this.utils.escapeHtml(panel.metricName)}${unitLabel} &middot; ${formatInt(dataPoints.length)} data points
        </div>

        <div style="background: white; border-radius: 4px; border: 1px solid #e0e0e0; padding: 10px;">
          <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto;" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
            <!-- Chart border -->
            <rect x="${padding.left}" y="${padding.top}" width="${chartWidth}" height="${chartHeight}"
                  fill="none" stroke="#999" stroke-width="1"/>

            <!-- Grid lines -->
            ${gridLines.join('')}

            <!-- Data line -->
            <path d="${pathData}" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>

            <!-- Data points -->
            ${dataPoints.length <= 50 ? dataPoints.map((dp) => {
              const cx = scaleX(dp.time.getTime());
              const cy = scaleY(dp.value!);
              return `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${color}"/>`;
            }).join('') : ''}

            <!-- X-axis labels -->
            ${xLabels.join('')}

            <!-- Y-axis label -->
            <text x="15" y="${padding.top + chartHeight / 2}"
                  text-anchor="middle" font-size="10" fill="#666" font-weight="600"
                  transform="rotate(-90 15 ${padding.top + chartHeight / 2})">${this.utils.escapeHtml(panel.unit || 'Value')}</text>
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

  private renderNoDataSection(title: string, comment: string | undefined, message: string): string {
    return `
      <section class="graphs-section">
        ${sectionHeader(title)}
        ${commentBlock(comment)}
        ${emptyState(message)}
      </section>
    `;
  }
}
