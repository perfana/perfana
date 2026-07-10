import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, ComparisonsData, ComparisonMetric, BaselineComparisonRow } from '../services/report-data-fetcher.service';
import { bandColor, statusFromConclusion } from './comparison-bands';
import {
  REPORT_COLORS,
  chip,
  commentBlock,
  deltaArrow,
  deltaChip,
  formatInt,
  formatNum,
  formatPercent,
  groupHeader,
  sectionHeader,
  splitHostLabel,
  statusPill,
} from './report-style';

/**
 * Renderer for Comparisons section
 *
 * Displays side-by-side comparison of metrics between
 * test run and control group (ADAPT baseline) with:
 * - Section header with right-aligned summary chips (rule 04)
 * - Comparison table grouped by dashboard, five-state status pills (rule 01)
 * - Delta arrows bound to the value (rule 02)
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
          ${sectionHeader(title)}
          ${commentBlock(comment)}
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
        ${sectionHeader(title, {
          kicker: `Test run vs control group — ${formatInt(data.totalMetrics)} metrics compared`,
          chipsHtml: this.summaryChips(data),
        })}
        ${commentBlock(comment)}

        <!-- Grouped Comparison Tables -->
        ${grouped.map(({ dashboard, metrics }) => this.renderDashboardGroup(dashboard, metrics)).join('\n')}
      </section>
    `;
  }

  private summaryChips(data: ComparisonsData): string[] {
    return [
      data.regressionCount > 0 ? chip(`${formatInt(data.regressionCount)} regressions`, 'bad') : '',
      data.improvementCount > 0 ? chip(`${formatInt(data.improvementCount)} improvements`, 'info') : '',
      data.noDifferenceCount > 0 ? chip(`${formatInt(data.noDifferenceCount)} within range`, 'good') : '',
    ];
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
      return `<section class="comparisons-section">${sectionHeader(title)}
        ${commentBlock(comment)}
        <p class="placeholder-message">No comparison data available for the selected baseline run.</p></section>`;
    }

    // Rank a band color for row accents / worst-of-row aggregation.
    const rankFor = (hex: string): number =>
      hex === REPORT_COLORS.dot.bad ? 2 : hex === REPORT_COLORS.dot.warn ? 1 : 0;
    const worstRank = (row: BaselineComparisonRow): number =>
      row.metrics.reduce((mx, m) => Math.max(mx, rankFor(bandColor(m.diffPercent, thresholds))), 0);
    const accent = (rank: number): string =>
      (rank === 2 ? REPORT_COLORS.dot.bad : rank === 1 ? REPORT_COLORS.dot.warn : REPORT_COLORS.dot.good);
    const rowBackground = (rank: number, idx: number): string =>
      (rank === 2 ? '#fff7f6' : (idx % 2 === 1 ? '#fbfcfd' : '#ffffff'));

    const renderCell = (m: { current: number | null; baseline: number | null; diffPercent: number | null }, leftBorder: boolean): string => {
      const dot = bandColor(m.diffPercent, thresholds);
      let left = 50, width = 0;
      if (m.diffPercent != null) {
        const mag = Math.min(Math.abs(m.diffPercent), 100) / 2; // 100% diff fills half the track
        if (m.diffPercent >= 0) { left = 50; width = mag; } else { width = mag; left = 50 - mag; }
      }
      return `<td style="padding:14px 16px; border-bottom:1px solid #f0f2f5;${leftBorder ? ' border-left:1px solid #eef1f5;' : ''}">
        <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
          <div style="display:flex; align-items:baseline; gap:8px;">
            <span style="font-size:15px; font-weight:700; color:${REPORT_COLORS.ink}; font-variant-numeric:tabular-nums;">${formatNum(m.current)}</span>
            <span style="font-size:11px; color:#9aa2ab; font-variant-numeric:tabular-nums;">vs ${formatNum(m.baseline)}</span>
          </div>
          ${deltaChip(m.diffPercent, thresholds)}
          <div style="position:relative; width:110px; height:4px; border-radius:2px; background:#edf0f3;">
            <div style="position:absolute; left:50%; top:-2px; width:1px; height:8px; background:#ccd0d6;"></div>
            <div style="position:absolute; top:0; height:100%; border-radius:2px; left:${left}%; width:${width}%; background:${dot};"></div>
          </div>
        </div></td>`;
    };

    const summaryChips = (reg: number, warn: number, ok: number): string[] => [
      reg > 0 ? chip(`${reg} regressions`, 'bad') : '',
      warn > 0 ? chip(`${warn} warnings`, 'warn') : '',
      ok > 0 ? chip(`${ok} within range`, 'good') : '',
    ];

    const thStyle = 'text-align:right; padding:4px 16px 12px; font-size:11.5px; font-weight:700; letter-spacing:0.06em; color:#1976d2; white-space:nowrap;';
    const thText = 'text-align:left; padding:4px 14px 12px 12px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#8a929c; white-space:nowrap;';

    const legend = `<div style="font-size:12.5px; color:#6b7280; margin-top:12px; display:flex; align-items:center; gap:20px; flex-wrap:wrap;">
      <span>Each cell shows <strong style="color:#1f2933; font-weight:600;">current</strong> &#183; vs baseline &#183; &#916;%. Bar shows regression magnitude.</span>
      <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:${REPORT_COLORS.dot.good};"></span> &#8804; ${thresholds.good}%</span>
      <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:${REPORT_COLORS.dot.warn};"></span> ${thresholds.good}&#8211;${thresholds.warning}%</span>
      <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:${REPORT_COLORS.dot.bad};"></span> &gt; ${thresholds.warning}%</span>
    </div>`;

    let bodyHtml: string;

    // ---- DYNATRACE / GRAFANA source: ONE merged table (single-source) ----
    // A single "Metric" column (there is only ever one host per section). For
    // Dynatrace the host-id prefix is stripped and the host NAME becomes a chip
    // next to the heading ("HOST-123_afterburner-be_Memory Usage" -> heading
    // "Dynatrace" + host chip "afterburner-be", metric "Memory Usage"). Grafana
    // labels have no host prefix, so the label is used as-is and the heading is "Grafana".
    if (source === 'dynatrace' || source === 'grafana') {
      const hasHost = source === 'dynatrace';
      let hostName = '';
      let reg = 0, warn = 0, ok = 0;

      const rowsHtml = data.rows.map((row, idx) => {
        const rank = worstRank(row);
        if (rank === 2) reg++; else if (rank === 1) warn++; else ok++;
        const cells = row.metrics.map((m) => renderCell(m, true)).join('');
        let metric = row.label;
        if (hasHost) {
          const parsed = splitHostLabel(row.label);
          if (parsed.host) hostName = parsed.host;
          metric = parsed.metric;
        }
        return `<tr style="background:${rowBackground(rank, idx)};">
          <td style="padding:14px 14px 14px 12px; border-left:3px solid ${accent(rank)}; border-bottom:1px solid #f0f2f5; font-size:13px; color:#1f2933; font-weight:600; white-space:nowrap; vertical-align:top;">${this.utils.escapeHtml(metric)}</td>
          ${cells}</tr>`;
      }).join('');

      const heading = source === 'dynatrace' ? 'Dynatrace' : 'Grafana';
      const headingChips = [
        hasHost && hostName ? chip(hostName, 'info') : '',
        chip(`${formatInt(data.rows.length)} metrics`, 'neutral'),
      ];
      const metricHeaders = metrics.map((k) => `<th style="${thStyle} border-left:1px solid #eef1f5;">${k.toUpperCase()}</th>`).join('');

      // Dashboard-mapping caption: when the comparison pairs a current-run
      // dashboard with a differently named baseline dashboard, say so —
      // "Current <dash> → Baseline <dash>" chips under the heading. Scoped to
      // the selected dashboard's pair; unscoped sections show every differing pair.
      const activePairs = (dashboardMap ?? [])
        .filter((p) => p.current && p.baseline && p.current !== p.baseline)
        .filter((p) => !dashboardLabel || p.current === dashboardLabel);
      const mappingCaption = activePairs.length === 0 ? '' : activePairs.map((p) =>
        `<div style="display:flex; align-items:center; gap:12px; margin:-2px 0 16px; font-size:12px;">
          <span style="display:inline-flex; align-items:center; gap:7px; padding:5px 12px; border-radius:8px; background:#f1f6ff; border:1px solid #d6e4fb;">
            <span style="width:8px; height:8px; border-radius:50%; background:#1976d2;"></span>
            <span style="text-transform:uppercase; letter-spacing:0.05em; font-size:10.5px; font-weight:700; color:#5b6470;">Current</span>
            <span style="font-weight:600; color:#1f2933;">${this.utils.escapeHtml(p.current)}</span>
          </span>
          <span style="color:#b6bcc4; font-size:15px;">&rarr;</span>
          <span style="display:inline-flex; align-items:center; gap:7px; padding:5px 12px; border-radius:8px; background:#f6f7f9; border:1px solid #e6e8ec;">
            <span style="width:8px; height:8px; border-radius:50%; background:#9aa2ab;"></span>
            <span style="text-transform:uppercase; letter-spacing:0.05em; font-size:10.5px; font-weight:700; color:#8a929c;">Baseline</span>
            <span style="font-weight:600; color:#4b5563;">${this.utils.escapeHtml(p.baseline)}</span>
          </span>
        </div>`).join('');

      bodyHtml = `<div style="margin-top:30px;">
        ${groupHeader(heading, headingChips, summaryChips(reg, warn, ok))}
        ${mappingCaption}
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="border-bottom:2px solid #e6e8ec;">
            <th style="${thText}">Metric</th>
            ${metricHeaders}
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
    } else {
      // ---- performance-metrics source: grouped by scenario, transaction rows ----
      const groups = new Map<string, BaselineComparisonRow[]>();
      for (const r of data.rows) {
        const arr = groups.get(r.group) ?? [];
        arr.push(r);
        groups.set(r.group, arr);
      }
      const metricHeaders = metrics.map((k, i) => `<th style="${thStyle}${i > 0 ? ' border-left:1px solid #eef1f5;' : ''}">${k.toUpperCase()}</th>`).join('');

      bodyHtml = Array.from(groups.entries()).map(([group, rows]) => {
        let reg = 0, warn = 0, ok = 0;
        const body = rows.map((row, idx) => {
          const rank = worstRank(row);
          if (rank === 2) reg++; else if (rank === 1) warn++; else ok++;
          const cells = row.metrics.map((m, gi) => renderCell(m, gi > 0)).join('');
          return `<tr style="background:${rowBackground(rank, idx)};">
            <td style="padding:14px 14px 14px 12px; border-left:3px solid ${accent(rank)}; border-bottom:1px solid #f0f2f5; font-size:13px; color:#374151; font-weight:500; white-space:nowrap; vertical-align:top;">${this.utils.escapeHtml(row.label)}</td>
            ${cells}</tr>`;
        }).join('');

        return `<div style="margin-top:38px;">
          ${groupHeader(group, [chip(`${formatInt(rows.length)} transactions`, 'neutral')], summaryChips(reg, warn, ok))}
          <table style="width:100%; border-collapse:collapse;">
            <thead><tr style="border-bottom:2px solid #e6e8ec;">
              <th style="${thText}">Transaction</th>
              ${metricHeaders}
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>`;
      }).join('\n');
    }

    return `<section class="comparisons-section">
      ${sectionHeader(title)}
      ${commentBlock(comment)}
      ${legend}
      ${bodyHtml}
    </section>`;
  }

  private renderDashboardGroup(dashboard: string, metrics: ComparisonMetric[]): string {
    const thText = 'padding:8px 12px; text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#8a929c; white-space:nowrap;';
    const thNum = 'padding:8px 12px; text-align:right; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#8a929c; white-space:nowrap;';

    const rows = metrics.map((m) => {
      const status = statusFromConclusion(m.conclusion);
      const currentStr = m.currentValue != null ? this.formatValue(m.currentValue, m.unit) : '—';
      const baselineStr = m.baselineValue != null ? this.formatValue(m.baselineValue, m.unit) : '—';
      const diffStr = m.difference == null || m.difference === 0 ? '—' : this.formatValue(m.difference, m.unit);

      return `
        <tr style="background: white;">
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; font-size: 9pt;">${this.utils.escapeHtml(m.panelTitle)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; font-size: 9pt;">${this.utils.escapeHtml(m.metricName)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; text-align: right; font-size: 9pt; font-variant-numeric: tabular-nums;">${currentStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; text-align: right; font-size: 9pt; font-variant-numeric: tabular-nums;">${baselineStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; text-align: right; font-size: 9pt; font-variant-numeric: tabular-nums;">${diffStr}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; text-align: right; font-size: 9pt; font-variant-numeric: tabular-nums; font-weight: 600;">${this.renderDiffPercent(m.differencePercent)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f0f2f5; text-align: center;">${statusPill(status)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div style="margin-top: 28px;">
        ${groupHeader(dashboard, [chip(`${formatInt(metrics.length)} metrics`, 'neutral')])}
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 2px solid #e6e8ec;">
              <th style="${thText}">Panel</th>
              <th style="${thText}">Metric</th>
              <th style="${thNum}">Current</th>
              <th style="${thNum}">Baseline</th>
              <th style="${thNum}">Diff</th>
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

  private groupByDashboard(metrics: ComparisonMetric[]): Array<{ dashboard: string; metrics: ComparisonMetric[] }> {
    const map = new Map<string, ComparisonMetric[]>();
    for (const m of metrics) {
      const key = m.dashboardLabel || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries()).map(([dashboard, metrics]) => ({ dashboard, metrics }));
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
