import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, ComparisonsData, ComparisonMetric, BaselineComparisonRow } from '../services/report-data-fetcher.service';
import { bandColor } from './comparison-bands';

/**
 * Renderer for Comparisons section
 *
 * Displays side-by-side comparison of metrics between
 * test run and control group (ADAPT baseline) with:
 * - Summary counts (regressions, improvements, no difference)
 * - Comparison table grouped by dashboard > panel
 * - Color-coded difference columns
 */
@Injectable()
export class ComparisonsRenderer {
  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  /**
   * Render Comparisons section
   */
  async renderComparisonsSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
  ): Promise<string> {
    const config = section.config || {};
    if (config.comparisonMode === 'baseline_run') {
      return this.renderBaselineRun(section, testRun);
    }
    const baselineTestRunId = typeof config.baselineTestRunId === 'string' ? config.baselineTestRunId : undefined;
    const title = section.title || 'Comparisons';
    const comment = section.comment;

    const data = testRun
      ? await this.dataFetcher.getComparisonsData(testRun.testRunId, baselineTestRunId)
      : null;

    if (!data || data.metrics.length === 0) {
      return `
        <section class="comparisons-section">
          <h2>${this.utils.escapeHtml(title)}</h2>
          ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
          <div class="comparisons-results">
            <p class="placeholder-message">No comparison data available for this test run.</p>
          </div>
        </section>
      `;
    }

    // Group by dashboard
    const grouped = this.groupByDashboard(data.metrics);

    return `
      <section class="comparisons-section">
        <!-- Section Header -->
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 32px; border-left: 4px solid #1976d2; padding-left: 20px;">
          <div style="background: linear-gradient(135deg, #1976d2 0%, #42a5f5 100%); color: white; width: 64px; height: 64px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 28px; box-shadow: 0 2px 8px rgba(25,118,210,0.3);">
            &#x2194;
          </div>
          <div style="flex: 1;">
            <h2 style="margin: 0; padding: 0; border: none; font-size: 18pt; font-weight: 600; color: #333;">${this.utils.escapeHtml(title)}</h2>
            <div style="font-size: 10pt; color: #666; margin-top: 4px;">Test run vs control group — ${data.totalMetrics} metrics compared</div>
          </div>
        </div>

        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}

        <!-- Summary Badges -->
        ${this.renderSummaryBadges(data)}

        <!-- Grouped Comparison Tables -->
        ${grouped.map(({ dashboard, metrics }) => this.renderDashboardGroup(dashboard, metrics)).join('\n')}
      </section>
    `;
  }

  private async renderBaselineRun(section: ReportSectionConfig, testRun: TestRun | null): Promise<string> {
    const config = section.config || {};
    const title = section.title || 'Comparisons';
    const comment = section.comment;
    const source = (config.source as 'performance-metrics' | 'grafana' | 'dynatrace') || 'performance-metrics';
    const metrics = (Array.isArray(config.metrics) && config.metrics.length ? config.metrics : ['avg', 'p95', 'p99']) as ('avg' | 'p95' | 'p99')[];
    const thresholds = (config.thresholds as { good: number; warning: number }) || { good: 10, warning: 50 };
    const baselineId = typeof config.baselineTestRunId === 'string' ? config.baselineTestRunId : undefined;

    const data = testRun && baselineId
      ? await this.dataFetcher.getBaselineRunComparison(testRun.testRunId, baselineId, source,
          { metrics, userId: '', roles: [], hostMap: config.hostMap as any })
      : null;

    if (!data || data.rows.length === 0) {
      return `<section class="comparisons-section"><h2>${this.utils.escapeHtml(title)}</h2>
        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
        <p class="placeholder-message">No comparison data available for the selected baseline run.</p></section>`;
    }

    const groups = new Map<string, BaselineComparisonRow[]>();
    for (const r of data.rows) {
      const arr = groups.get(r.group) ?? [];
      arr.push(r);
      groups.set(r.group, arr);
    }

    const metricHeaders = metrics.map(k =>
      `<th colspan="3" style="text-align:center;">${k.toUpperCase()}</th>`).join('');
    const subHeaders = metrics.map(() =>
      `<th>Current</th><th>Baseline</th><th>Diff %</th>`).join('');

    const groupHtml = Array.from(groups.entries()).map(([group, rows]) => {
      const body = rows.map(row => {
        const cells = row.metrics.map(m => {
          const color = bandColor(m.diffPercent, thresholds);
          const diff = m.diffPercent == null ? '—' : `${m.diffPercent >= 0 ? '+' : ''}${m.diffPercent.toFixed(1)}%`;
          return `<td style="text-align:right;">${m.current ?? '—'}</td>
                  <td style="text-align:right;">${m.baseline ?? '—'}</td>
                  <td style="text-align:right; color:${color}; font-weight:600;">${diff}</td>`;
        }).join('');
        return `<tr><td>${this.utils.escapeHtml(row.label)}</td>${cells}</tr>`;
      }).join('');
      return `<h3>${this.utils.escapeHtml(group)}</h3>
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr><th rowspan="2">Transaction / Metric</th>${metricHeaders}</tr><tr>${subHeaders}</tr></thead>
          <tbody>${body}</tbody></table>`;
    }).join('\n');

    return `<section class="comparisons-section"><h2>${this.utils.escapeHtml(title)}</h2>
      ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
      ${groupHtml}</section>`;
  }

  private renderSummaryBadges(data: ComparisonsData): string {
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
        <div style="flex: 1; min-width: 140px; background: #e3f2fd; border: 1px solid #bbdefb; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28pt; font-weight: 700; color: #1565c0;">${data.noDifferenceCount}</div>
          <div style="font-size: 9pt; color: #0d47a1; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">No Difference</div>
        </div>
        <div style="flex: 1; min-width: 140px; background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28pt; font-weight: 700; color: #555;">${data.totalMetrics}</div>
          <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Total Metrics</div>
        </div>
      </div>
    `;
  }

  private renderDashboardGroup(dashboard: string, metrics: ComparisonMetric[]): string {
    const rows = metrics.map((m) => {
      const currentStr = m.currentValue != null ? this.formatValue(m.currentValue, m.unit) : '—';
      const baselineStr = m.baselineValue != null ? this.formatValue(m.baselineValue, m.unit) : '—';
      const diffStr = m.difference != null ? this.formatValue(m.difference, m.unit) : '—';
      const diffPctStr = m.differencePercent != null ? `${m.differencePercent >= 0 ? '+' : ''}${m.differencePercent.toFixed(1)}%` : '—';
      const diffColor = this.getConclusionColor(m.conclusion);
      const arrow = this.getDirectionArrow(m.conclusion, m.differencePercent);
      const badgeColor = diffColor;

      return `
        <tr style="background: white;">
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt;">${this.utils.escapeHtml(m.panelTitle)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt;">${this.utils.escapeHtml(m.metricName)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-family: 'Courier New', monospace; font-size: 9pt;">${currentStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-family: 'Courier New', monospace; font-size: 9pt;">${baselineStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-family: 'Courier New', monospace; font-size: 9pt; color: ${diffColor}; font-weight: 600;">${diffStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-family: 'Courier New', monospace; font-size: 9pt; color: ${diffColor}; font-weight: 600;">${arrow} ${diffPctStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 8pt; font-weight: 600; color: white; background: ${badgeColor}; text-transform: uppercase;">
              ${this.utils.escapeHtml(m.conclusion.replace(/_/g, ' '))}
            </span>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div style="margin-top: 24px; border-left: 4px solid #1976d2; padding-left: 20px;">
        <h3 style="margin: 0 0 12px 0; font-size: 11pt; font-weight: 600; color: #333;">${this.utils.escapeHtml(dashboard)} (${metrics.length} metrics)</h3>
        <table style="width: 100%; border-collapse: collapse; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <thead>
            <tr style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white;">
              <th style="padding: 12px; text-align: left; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Panel</th>
              <th style="padding: 12px; text-align: left; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Metric</th>
              <th style="padding: 12px; text-align: right; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Current</th>
              <th style="padding: 12px; text-align: right; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Baseline</th>
              <th style="padding: 12px; text-align: right; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Diff</th>
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

  private groupByDashboard(metrics: ComparisonMetric[]): Array<{ dashboard: string; metrics: ComparisonMetric[] }> {
    const map = new Map<string, ComparisonMetric[]>();
    for (const m of metrics) {
      const key = m.dashboardLabel || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries()).map(([dashboard, metrics]) => ({ dashboard, metrics }));
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

  private getDirectionArrow(conclusion: string, diffPct: number | null): string {
    if (diffPct == null) return '';
    if (conclusion === 'regression') return '&#x25B2;'; // up triangle (bad)
    if (conclusion === 'improvement') return '&#x25BC;'; // down triangle (good)
    return '&#x2796;'; // minus
  }
}
