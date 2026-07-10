import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, RegressionsMetric } from '../services/report-data-fetcher.service';
import { statusFromConclusion } from './comparison-bands';
import {
  chip,
  commentBlock,
  deltaArrow,
  formatInt,
  formatNum,
  formatPercent,
  groupHeader,
  sectionHeader,
  statusPill,
} from './report-style';

/**
 * Renderer for Regressions section
 *
 * Displays ADAPT performance regression analysis with:
 * - Section header with five-state status pill and summary chips (rules 01/04)
 * - Regression details table with per-metric status pills
 * - Optional improvements table
 */
@Injectable()
export class RegressionsRenderer {
  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  /**
   * Render Regressions section
   */
  async renderRegressionsSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const config = section.config || {};
    const title = section.title || 'Regressions';
    const comment = section.comment;
    const showImprovements = config.showImprovements === true;
    const maxRows = typeof config.maxRows === 'number' ? config.maxRows : 50;

    const data = testRun
      ? await this.dataFetcher.getRegressionsData(testRun.testRunId, userId, roles)
      : null;

    if (!data) {
      return `
        <section class="regressions-section">
          ${sectionHeader(title)}
          ${commentBlock(comment)}
          <div class="regressions-results">
            <p class="placeholder-message">No ADAPT regression analysis data available for this test run.</p>
          </div>
        </section>
      `;
    }

    const overallStatus = statusFromConclusion(data.conclusion);
    const headerChips = [
      statusPill(overallStatus),
      data.regressionCount > 0 ? chip(`${formatInt(data.regressionCount)} regressions`, 'bad') : '',
      data.improvementCount > 0 ? chip(`${formatInt(data.improvementCount)} improvements`, 'info') : '',
      chip(`${formatInt(data.totalMetrics)} metrics`, 'neutral'),
    ];

    return `
      <section class="regressions-section">
        ${sectionHeader(title, { chipsHtml: headerChips })}
        ${commentBlock(comment)}

        <!-- Regressions Table -->
        ${data.regressions.length > 0 ? this.renderMetricsTable(data.regressions.slice(0, maxRows), 'Regressions') : ''}

        <!-- Improvements Table (optional) -->
        ${showImprovements && data.improvements.length > 0
          ? this.renderMetricsTable(data.improvements.slice(0, maxRows), 'Improvements')
          : ''}
      </section>
    `;
  }

  private renderMetricsTable(metrics: RegressionsMetric[], tableTitle: string): string {
    const thText = 'padding:8px 12px; text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#8a929c; white-space:nowrap;';
    const thNum = 'padding:8px 12px; text-align:right; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#8a929c; white-space:nowrap;';

    const rows = metrics.map((m) => {
      const status = statusFromConclusion(m.conclusionLabel);
      const testStr = m.testValue != null ? this.formatValue(m.testValue, m.unit) : '—';
      const controlStr = m.controlValue != null ? this.formatValue(m.controlValue, m.unit) : '—';

      return `
        <tr style="background: white;">
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; font-size: 9pt; color: #6b7280;">${this.utils.escapeHtml(m.dashboardLabel)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; font-size: 9pt;">${this.utils.escapeHtml(m.panelTitle)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; font-size: 9pt;">${this.utils.escapeHtml(m.metricName)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; text-align: right; font-size: 9pt; font-variant-numeric: tabular-nums;">${testStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; text-align: right; font-size: 9pt; font-variant-numeric: tabular-nums;">${controlStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; text-align: right; font-size: 9pt; font-variant-numeric: tabular-nums; font-weight: 600;">${this.renderDiffPercent(m.differencePercent)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; text-align: center;">${statusPill(status)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div style="margin-top: 28px;">
        ${groupHeader(tableTitle, [chip(`${formatInt(metrics.length)} metrics`, 'neutral')])}
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 2px solid #e6e8ec;">
              <th style="${thText}">Dashboard</th>
              <th style="${thText}">Panel</th>
              <th style="${thText}">Metric</th>
              <th style="${thNum}">Test Value</th>
              <th style="${thNum}">Control</th>
              <th style="${thNum}">Diff %</th>
              <th style="padding:8px 12px; text-align:center; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#8a929c; white-space:nowrap;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }

  /** Rule 02/03: arrow bound to the value's direction, true zero renders as em-dash. */
  private renderDiffPercent(pct: number | null): string {
    if (pct == null || !isFinite(pct) || pct === 0) return '—';
    const sign = pct > 0 ? '+' : '';
    return `${deltaArrow(pct)} ${sign}${formatPercent(pct)}`;
  }

  private formatValue(value: number, unit: string | null): string {
    if (unit === 'bytes') return this.formatBytes(value);
    if (unit === 'ms' || unit === 'milliseconds') return `${formatNum(value)} ms`;
    if (unit === 's' || unit === 'seconds') return `${formatNum(value)} s`;
    if (unit === '%' || unit === 'percent') return formatPercent(value);
    return formatNum(value);
  }

  private formatBytes(bytes: number): string {
    const abs = Math.abs(bytes);
    if (abs >= 1073741824) return `${formatNum(bytes / 1073741824)} GB`;
    if (abs >= 1048576) return `${formatNum(bytes / 1048576)} MB`;
    if (abs >= 1024) return `${formatNum(bytes / 1024)} KB`;
    return `${formatInt(bytes)} B`;
  }
}
