import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, RegressionsMetric, RegressionsData } from '../services/report-data-fetcher.service';

/**
 * Renderer for Regressions section
 *
 * Displays ADAPT performance regression analysis with:
 * - Overall conclusion banner with severity color
 * - Summary counts (regressions, improvements, total metrics)
 * - Regression details table grouped by dashboard > panel
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

    if (!testRun) {
      return `
        <section class="regressions-section">
          <h2>${this.utils.escapeHtml(title)}</h2>
          ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
          <div class="regressions-results">
            <p class="placeholder-message">No ADAPT regression analysis data available for this test run.</p>
          </div>
        </section>
      `;
    }

    const data = await this.dataFetcher.getRegressionsData(testRun.testRunId, userId, roles);

    if (!data) {
      return `
        <section class="regressions-section">
          <h2>${this.utils.escapeHtml(title)}</h2>
          ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
          <div class="regressions-results">
            <p class="placeholder-message">No ADAPT regression analysis data available for this test run.</p>
          </div>
        </section>
      `;
    }

    const conclusionColor = this.getConclusionColor(data.conclusion);
    const conclusionIcon = this.getConclusionIcon(data.conclusion);
    const conclusionLabel = this.formatConclusion(data.conclusion);

    return `
      <section class="regressions-section">
        <!-- Section Header -->
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 32px; border-left: 4px solid ${conclusionColor}; padding-left: 20px;">
          <div style="background: linear-gradient(135deg, ${conclusionColor} 0%, ${conclusionColor}cc 100%); color: white; width: 64px; height: 64px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 32px; box-shadow: 0 2px 8px ${conclusionColor}4d;">
            ${conclusionIcon}
          </div>
          <div style="flex: 1;">
            <h2 style="margin: 0; padding: 0; border: none; font-size: 18pt; font-weight: 600; color: #333;">${this.utils.escapeHtml(title)}</h2>
          </div>
          <div style="font-size: 14pt; font-weight: 700; color: ${conclusionColor}; text-transform: uppercase; letter-spacing: 0.08em;">
            ${this.utils.escapeHtml(conclusionLabel)}
          </div>
        </div>

        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}

        <!-- Summary Badges -->
        ${this.renderSummaryBadges(data)}

        <!-- Regressions Table -->
        ${data.regressions.length > 0 ? this.renderMetricsTable(data.regressions.slice(0, maxRows), 'Regressions', '#db524e') : ''}

        <!-- Improvements Table (optional) -->
        ${showImprovements && data.improvements.length > 0
          ? this.renderMetricsTable(data.improvements.slice(0, maxRows), 'Improvements', '#4caf50')
          : ''}
      </section>
    `;
  }

  private renderSummaryBadges(data: RegressionsData): string {
    return `
      <div style="display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 140px; background: #fff5f5; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28pt; font-weight: 700; color: #db524e;">${data.regressionCount}</div>
          <div style="font-size: 9pt; color: #991b1b; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Regressions</div>
        </div>
        <div style="flex: 1; min-width: 140px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28pt; font-weight: 700; color: #4caf50;">${data.improvementCount}</div>
          <div style="font-size: 9pt; color: #166534; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Improvements</div>
        </div>
        <div style="flex: 1; min-width: 140px; background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28pt; font-weight: 700; color: #555;">${data.totalMetrics}</div>
          <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Total Metrics</div>
        </div>
      </div>
    `;
  }

  private renderMetricsTable(metrics: RegressionsMetric[], tableTitle: string, accentColor: string): string {
    const rows = metrics.map((m) => {
      const diffPctStr = m.differencePercent != null ? `${m.differencePercent >= 0 ? '+' : ''}${m.differencePercent.toFixed(1)}%` : '—';
      const testStr = m.testValue != null ? this.formatValue(m.testValue, m.unit) : '—';
      const controlStr = m.controlValue != null ? this.formatValue(m.controlValue, m.unit) : '—';
      const diffColor = accentColor;

      return `
        <tr style="background: white;">
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt; color: #555;">${this.utils.escapeHtml(m.dashboardLabel)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt;">${this.utils.escapeHtml(m.panelTitle)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt;">${this.utils.escapeHtml(m.metricName)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-family: 'Courier New', monospace; font-size: 9pt;">${testStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-family: 'Courier New', monospace; font-size: 9pt;">${controlStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-family: 'Courier New', monospace; font-size: 9pt; color: ${diffColor}; font-weight: 600;">${diffPctStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 8pt; font-weight: 600; color: white; background: ${accentColor}; text-transform: uppercase;">
              ${this.utils.escapeHtml(m.conclusionLabel)}
            </span>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div style="margin-top: 24px; border-left: 4px solid ${accentColor}; padding-left: 20px;">
        <h3 style="margin: 0 0 12px 0; font-size: 11pt; font-weight: 600; color: #333;">${this.utils.escapeHtml(tableTitle)} (${metrics.length})</h3>
        <table style="width: 100%; border-collapse: collapse; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <thead>
            <tr style="background: linear-gradient(135deg, ${accentColor} 0%, ${accentColor}cc 100%); color: white;">
              <th style="padding: 12px; text-align: left; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Dashboard</th>
              <th style="padding: 12px; text-align: left; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Panel</th>
              <th style="padding: 12px; text-align: left; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Metric</th>
              <th style="padding: 12px; text-align: right; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Test Value</th>
              <th style="padding: 12px; text-align: right; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Control</th>
              <th style="padding: 12px; text-align: right; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Diff %</th>
              <th style="padding: 12px; text-align: center; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }

  private formatValue(value: number, unit: string | null): string {
    if (unit === 'ms' || unit === 'milliseconds') return `${value.toFixed(1)} ms`;
    if (unit === 's' || unit === 'seconds') return `${value.toFixed(2)} s`;
    if (unit === '%' || unit === 'percent') return `${value.toFixed(1)}%`;
    if (unit === 'bytes') return this.formatBytes(value);
    if (Math.abs(value) >= 1000) return value.toFixed(0);
    if (Math.abs(value) >= 1) return value.toFixed(2);
    return value.toFixed(4);
  }

  private formatBytes(bytes: number): string {
    const abs = Math.abs(bytes);
    if (abs >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
    if (abs >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (abs >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  private getConclusionColor(conclusion: string): string {
    switch (conclusion) {
      case 'regression': return '#db524e';
      case 'improvement': return '#4caf50';
      case 'no_difference': return '#4285f4';
      default: return '#9e9e9e';
    }
  }

  private getConclusionIcon(conclusion: string): string {
    switch (conclusion) {
      case 'regression': return '&#x26A0;';
      case 'improvement': return '&#x2714;';
      case 'no_difference': return '&#x2796;';
      default: return '&#x2753;';
    }
  }

  private formatConclusion(conclusion: string): string {
    switch (conclusion) {
      case 'regression': return 'Regression Detected';
      case 'improvement': return 'Improvement';
      case 'no_difference': return 'No Difference';
      default: return conclusion.replace(/_/g, ' ');
    }
  }
}
