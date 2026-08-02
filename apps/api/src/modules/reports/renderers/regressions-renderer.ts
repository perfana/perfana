import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, RegressionsMetric } from '../services/report-data-fetcher.service';
import { statusFromConclusion } from './comparison-bands';
import {
  REPORT_COLORS,
  TH_CENTER,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  chip,
  sectionText,
  deltaText,
  emptyState,
  formatInt,
  formatMetricValue,
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
    const text = getSectionText(section);
    const showImprovements = config.showImprovements === true;
    const maxRows = typeof config.maxRows === 'number' ? config.maxRows : 50;

    const data = testRun
      ? await this.dataFetcher.getRegressionsData(testRun.testRunId, userId, roles)
      : null;

    if (!data) {
      return `
        <section class="regressions-section">
          ${sectionHeader(title)}
          ${sectionText(text)}
          ${emptyState('No ADAPT regression analysis data available for this test run.')}
        </section>
      `;
    }

    const overallStatus = statusFromConclusion(data.conclusion);
    // When the conclusion collapses to N/A (skipped, insufficient data, …),
    // surface the human-readable reason next to the pill so readers still see
    // WHY there is no verdict.
    const rawConclusion = (data.conclusion ?? '').toLowerCase().replace(/_/g, ' ').trim();
    const naReasonChip = overallStatus === 'na' && rawConclusion ? chip(rawConclusion, 'neutral') : '';
    const headerChips = [
      statusPill(overallStatus),
      naReasonChip,
      data.regressionCount > 0 ? chip(`${formatInt(data.regressionCount)} regressions`, 'bad') : '',
      data.improvementCount > 0 ? chip(`${formatInt(data.improvementCount)} improvements`, 'info') : '',
      chip(`${formatInt(data.totalMetrics)} metrics`, 'neutral'),
    ];

    return `
      <section class="regressions-section">
        ${sectionHeader(title, { chipsHtml: headerChips })}
        ${sectionText(text)}

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
    const rows = metrics.map((m) => {
      const status = statusFromConclusion(m.conclusionLabel);
      const testStr = formatMetricValue(m.testValue, m.unit);
      const controlStr = formatMetricValue(m.controlValue, m.unit);

      return `
        <tr style="background: white;">
          <td style="padding: 10px 12px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder}; font-size: 9pt; color: ${REPORT_COLORS.mutedInk};">${this.utils.escapeHtml(m.dashboardLabel)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder}; font-size: 9pt;">${this.utils.escapeHtml(m.panelTitle)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder}; font-size: 9pt;">${this.utils.escapeHtml(m.metricName)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder}; text-align: right; font-size: 9pt; font-variant-numeric: tabular-nums;">${testStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder}; text-align: right; font-size: 9pt; font-variant-numeric: tabular-nums;">${controlStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder}; text-align: right; font-size: 9pt; font-variant-numeric: tabular-nums; font-weight: 600;">${deltaText(m.differencePercent)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder}; text-align: center;">${statusPill(status)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div style="margin-top: 28px;">
        ${groupHeader(tableTitle, [chip(`${formatInt(metrics.length)} metrics`, 'neutral')])}
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="${THEAD_ROW}">
              <th style="${TH_TEXT}">Dashboard</th>
              <th style="${TH_TEXT}">Panel</th>
              <th style="${TH_TEXT}">Metric</th>
              <th style="${TH_NUM}">Test Value</th>
              <th style="${TH_NUM}">Control</th>
              <th style="${TH_NUM}">Diff %</th>
              <th style="${TH_CENTER}">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }
}
