import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, RegressionsMetric, ControlGroupSummary } from '../services/report-data-fetcher.service';
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
 * Renderer for the Anomaly Detection section (section type `regressions`)
 *
 * Displays ADAPT anomaly detection with:
 * - Section header with regression/improvement counts and the control group size (rule 04)
 * - Which past runs ADAPT compared against, so the counts can be judged
 * - Regression details table with per-metric status pills (rule 01)
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
    const title = section.title || 'Anomaly Detection';
    const text = getSectionText(section);
    const showImprovements = config.showImprovements === true;
    // maxItems is what the config form writes; maxRows is the older key some saved templates hold.
    const configuredMax = config.maxItems ?? config.maxRows;
    const maxRows = typeof configuredMax === 'number' ? configuredMax : 50;

    const data = testRun
      ? await this.dataFetcher.getRegressionsData(testRun.testRunId, userId, roles)
      : null;

    if (!data) {
      return `
        <section class="regressions-section">
          ${sectionHeader(title)}
          ${sectionText(text)}
          ${emptyState('No ADAPT anomaly detection data available for this test run.')}
        </section>
      `;
    }

    // The counts ARE the verdict, so no status pill repeating them — except when ADAPT
    // reached no verdict at all (skipped, insufficient data, …), where the reason is the
    // only thing worth putting in the header. The total-metric count is gone: it counted
    // every ADAPT result, matched nothing shown below it, and dwarfed the numbers beside it.
    const overallStatus = statusFromConclusion(data.conclusion);
    const rawConclusion = (data.conclusion ?? '').toLowerCase().replace(/_/g, ' ').trim();
    const cg = data.controlGroup;
    const headerChips = overallStatus === 'na'
      ? [statusPill('na'), rawConclusion ? chip(rawConclusion, 'neutral') : '']
      : [
          data.regressionCount > 0 ? chip(`${formatInt(data.regressionCount)} regressions`, 'bad') : '',
          data.improvementCount > 0 ? chip(`${formatInt(data.improvementCount)} improvements`, 'info') : '',
          data.regressionCount === 0 && data.improvementCount === 0 ? chip('no anomalies', 'good') : '',
          cg ? chip(`control group: ${formatInt(cg.nTestRuns)} runs`, 'neutral') : '',
        ];

    return `
      <section class="regressions-section">
        ${sectionHeader(title, { chipsHtml: headerChips })}
        ${this.renderControlGroup(cg)}
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

  /**
   * Name the runs behind the verdict. "9 regressions" against three runs and against thirty
   * are different claims, and only the reader can tell which one they are looking at.
   */
  private renderControlGroup(cg: ControlGroupSummary | undefined): string {
    if (!cg) return '';
    const window = [cg.firstDatetime, cg.lastDatetime]
      .filter((d): d is string => !!d)
      .map((d) => new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }));
    const range = window.length === 2 && window[0] !== window[1]
      ? ` · ${window[0]} – ${window[1]}`
      : window.length ? ` · ${window[0]}` : '';
    // ponytail: 12 ids then a count — a 40-run control group would otherwise fill the page.
    const shown = cg.testRuns.slice(0, 12);
    const rest = cg.testRuns.length - shown.length;
    const runs = shown.length
      ? `${shown.map((r) => this.utils.escapeHtml(r)).join(', ')}${rest > 0 ? ` and ${formatInt(rest)} more` : ''}`
      : 'run ids not recorded';

    return `<div style="margin:-8px 0 20px; padding:12px 14px; background:${REPORT_COLORS.emptyBg}; border-radius:6px; font-size:12px; color:${REPORT_COLORS.mutedInk};">
      <strong style="color:${REPORT_COLORS.ink}; font-weight:600;">Compared against ${formatInt(cg.nTestRuns)} previous ${cg.nTestRuns === 1 ? 'run' : 'runs'}</strong>${range}
      <div style="margin-top:6px; line-height:1.6;">${runs}</div>
    </div>`;
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
        <div class="table-scroll">
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
      </div>
    `;
  }
}
