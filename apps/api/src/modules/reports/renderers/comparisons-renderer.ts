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
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const config = section.config || {};
    if (config.comparisonMode === 'baseline_run') {
      return this.renderBaselineRun(section, testRun, userId, roles);
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

  private async renderBaselineRun(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    userId: string,
    roles: string[],
  ): Promise<string> {
    const config = section.config || {};
    const title = section.title || 'Comparisons';
    const comment = section.comment;
    const source = (config.source as 'performance-metrics' | 'grafana' | 'dynatrace') || 'performance-metrics';
    const metrics = (Array.isArray(config.metrics) && config.metrics.length ? config.metrics : ['avg', 'p95', 'p99']) as ('avg' | 'p95' | 'p99')[];
    const thresholds = (config.thresholds as { good: number; warning: number }) || { good: 10, warning: 50 };
    const baselineId = typeof config.baselineTestRunId === 'string' ? config.baselineTestRunId : undefined;
    const dashboardMap = Array.isArray(config.dashboardMap)
      ? (config.dashboardMap as { current: string; baseline: string }[])
      : undefined;
    const dashboardLabel = typeof config.dashboardLabel === 'string' ? config.dashboardLabel : undefined;
    const panelIds = Array.isArray(config.panels)
      ? (config.panels as { id: number; title: string }[]).map((p) => p.id)
      : undefined;

    const data = testRun && baselineId
      ? await this.dataFetcher.getBaselineRunComparison(testRun.testRunId, baselineId, source,
          { metrics, userId, roles, dashboardMap, dashboardLabel, panelIds })
      : null;

    if (!data || data.rows.length === 0) {
      return `<section class="comparisons-section"><h2>${this.utils.escapeHtml(title)}</h2>
        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
        <p class="placeholder-message">No comparison data available for the selected baseline run.</p></section>`;
    }

    // Map bandColor()'s single hex to a full chip / text / bar / rank palette.
    const palette = (hex: string): { chip: string; text: string; dot: string; rank: number } => {
      switch (hex) {
        case '#4caf50': return { chip: '#e7f4ea', text: '#2e7d32', dot: '#43a047', rank: 0 };
        case '#f59e0b': return { chip: '#fdf0dd', text: '#9a5b00', dot: '#f59e0b', rank: 1 };
        case '#db524e': return { chip: '#fbe6e4', text: '#c1362f', dot: '#e04944', rank: 2 };
        default:        return { chip: '#f1f1f1', text: '#9e9e9e', dot: '#bdbdbd', rank: 0 };
      }
    };
    const fmt = (v: number | null | undefined): string => (v == null ? '—' : String(v));

    const groups = new Map<string, BaselineComparisonRow[]>();
    for (const r of data.rows) {
      const arr = groups.get(r.group) ?? [];
      arr.push(r);
      groups.set(r.group, arr);
    }

    const thStyle = 'text-align:right; padding:4px 16px 12px; font-size:11.5px; font-weight:700; letter-spacing:0.06em; color:#1976d2;';
    const metricHeaders = metrics.map((k, i) =>
      `<th style="${thStyle}${i > 0 ? ' border-left:1px solid #eef1f5;' : ''}">${k.toUpperCase()}</th>`).join('');

    const groupHtml = Array.from(groups.entries()).map(([group, rows]) => {
      let reg = 0, warn = 0, ok = 0;

      const body = rows.map((row, idx) => {
        const cellData = row.metrics.map(m => ({ m, p: palette(bandColor(m.diffPercent, thresholds)) }));
        const worst = cellData.reduce((mx, c) => Math.max(mx, c.p.rank), 0);
        if (worst === 2) reg++; else if (worst === 1) warn++; else ok++;
        const nameColor = worst === 2 ? '#e04944' : worst === 1 ? '#f59e0b' : '#43a047';
        const rowBg = worst === 2 ? '#fff7f6' : (idx % 2 === 1 ? '#fbfcfd' : '#ffffff');

        const cells = cellData.map(({ m, p }, gi) => {
          const diff = m.diffPercent == null ? '—' : `${m.diffPercent >= 0 ? '+' : ''}${m.diffPercent.toFixed(1)}%`;
          const arrow = m.diffPercent == null ? '' : (m.diffPercent > 0 ? '▲' : (m.diffPercent < 0 ? '▼' : ''));
          let left = 50, width = 0;
          if (m.diffPercent != null) {
            const mag = Math.min(Math.abs(m.diffPercent), 100) / 2; // 100% diff fills half the track
            if (m.diffPercent >= 0) { left = 50; width = mag; } else { width = mag; left = 50 - mag; }
          }
          return `<td style="padding:14px 16px; border-bottom:1px solid #f0f2f5;${gi > 0 ? ' border-left:1px solid #eef1f5;' : ''}">
            <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
              <div style="display:flex; align-items:baseline; gap:8px;">
                <span style="font-size:15px; font-weight:700; color:#1f2933; font-variant-numeric:tabular-nums;">${fmt(m.current)}</span>
                <span style="font-size:11px; color:#9aa2ab; font-variant-numeric:tabular-nums;">vs ${fmt(m.baseline)}</span>
              </div>
              <span style="display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:999px; font-size:11.5px; font-weight:700; font-variant-numeric:tabular-nums; background:${p.chip}; color:${p.text};">${arrow} ${diff}</span>
              <div style="position:relative; width:110px; height:4px; border-radius:2px; background:#edf0f3;">
                <div style="position:absolute; left:50%; top:-2px; width:1px; height:8px; background:#ccd0d6;"></div>
                <div style="position:absolute; top:0; height:100%; border-radius:2px; left:${left}%; width:${width}%; background:${p.dot};"></div>
              </div>
            </div></td>`;
        }).join('');

        return `<tr style="background:${rowBg};">
          <td style="padding:14px 14px 14px 12px; border-left:3px solid ${nameColor}; border-bottom:1px solid #f0f2f5; font-size:13px; color:#374151; font-weight:500; white-space:nowrap; vertical-align:top;">${this.utils.escapeHtml(row.label)}</td>
          ${cells}</tr>`;
      }).join('');

      const chips = [
        reg > 0 ? `<span style="padding:4px 11px; border-radius:999px; background:#fbe6e4; color:#c1362f; font-size:12px; font-weight:700;">${reg} regressions</span>` : '',
        warn > 0 ? `<span style="padding:4px 11px; border-radius:999px; background:#fdf0dd; color:#9a5b00; font-size:12px; font-weight:700;">${warn} warnings</span>` : '',
        ok > 0 ? `<span style="padding:4px 11px; border-radius:999px; background:#e7f4ea; color:#2e7d32; font-size:12px; font-weight:700;">${ok} within range</span>` : '',
      ].join('');

      return `<div style="margin-top:38px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h3 style="margin:0; font-size:17px; font-weight:700; color:#2b3138; padding-left:14px; border-left:4px solid #1976d2;">${this.utils.escapeHtml(group)}</h3>
          <div style="display:flex; gap:8px;">${chips}</div>
        </div>
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="border-bottom:2px solid #e6e8ec;">
            <th style="text-align:left; padding:4px 14px 12px 12px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#8a929c;">Transaction</th>
            ${metricHeaders}
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
    }).join('\n');

    const legend = `<div style="font-size:12.5px; color:#6b7280; margin-top:12px; display:flex; align-items:center; gap:20px; flex-wrap:wrap;">
      <span>Each cell shows <strong style="color:#1f2933; font-weight:600;">current</strong> &#183; vs baseline &#183; &#916;%. Bar shows regression magnitude.</span>
      <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:#43a047;"></span> &#8804; ${thresholds.good}%</span>
      <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:#f59e0b;"></span> ${thresholds.good}&#8211;${thresholds.warning}%</span>
      <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:#db524e;"></span> &gt; ${thresholds.warning}%</span>
    </div>`;

    return `<section class="comparisons-section">
      <h2>${this.utils.escapeHtml(title)}</h2>
      ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
      ${legend}
      ${groupHtml}
    </section>`;
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
