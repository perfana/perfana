import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, AwrReportSummary, AwrInsightSummary } from '../services/report-data-fetcher.service';
import {
  PillKind,
  TH_CENTER,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  chip,
  groupHeader,
  sectionHeader,
  sectionText,
  formatInt,
  formatNum,
  pill,
} from './report-style';

/**
 * Renderer for AWR section
 *
 * Displays Oracle Automatic Workload Repository (AWR) analysis with:
 * - Database and host information summary
 * - Snapshot window and timing metrics
 * - Severity summary badges (critical, warning, info)
 * - Insights table grouped by category
 * - Top SQL highlights from parsed data
 */
@Injectable()
export class AwrRenderer {
  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  /**
   * Render AWR section
   */
  async renderAwrSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
  ): Promise<string> {
    const config = section.config || {};
    const maxInsights = typeof config.maxInsights === 'number' ? config.maxInsights : 30;
    const categories = Array.isArray(config.categories) ? config.categories as string[] : null;
    const showTopSql = config.showTopSql !== false;
    const title = section.title || 'AWR Analysis';
    const text = getSectionText(section);

    const data = testRun
      ? await this.dataFetcher.getAwrData(testRun.testRunId)
      : null;

    if (!data || data.reports.length === 0) {
      return `
        <section class="awr-section">
          ${sectionHeader(title)}
          ${sectionText(text)}
          <div class="awr-results">
            <p class="placeholder-message">No AWR report data available for this test run.</p>
          </div>
        </section>
      `;
    }

    const filteredInsights = categories
      ? data.insights.filter((i) => categories.includes(i.category))
      : data.insights;
    const displayInsights = filteredInsights.slice(0, maxInsights);

    // Severity summary as right-aligned chips on the section header (rule 04),
    // matching how other sections surface their counts.
    const s = data.severitySummary;
    const severityChips = [
      s.critical > 0 ? chip(`${formatInt(s.critical)} critical`, 'bad') : '',
      s.warning > 0 ? chip(`${formatInt(s.warning)} warning`, 'warn') : '',
      s.info > 0 ? chip(`${formatInt(s.info)} info`, 'info') : '',
    ];

    return `
      <section class="awr-section">
        ${sectionHeader(title, {
          kicker: `${data.reports.length} AWR report${data.reports.length > 1 ? 's' : ''} analyzed`,
          chipsHtml: severityChips,
        })}

        ${sectionText(text)}

        <!-- Database Info -->
        ${data.reports.map((r) => this.renderReportSummary(r)).join('\n')}

        <!-- Insights Table -->
        ${displayInsights.length > 0 ? this.renderInsightsTable(displayInsights) : ''}

        <!-- Top SQL -->
        ${showTopSql ? this.renderTopSql(data.reports) : ''}
      </section>
    `;
  }

  private renderReportSummary(report: AwrReportSummary): string {
    const dbLabel = [report.dbName, report.instanceName].filter(Boolean).join(' / ') || 'Unknown Database';
    const hostLabel = [report.hostName, report.platform].filter(Boolean).join(' — ') || 'Unknown Host';
    const hwLabel = [
      report.cpus ? `${report.cpus} CPUs` : null,
      report.cores ? `${report.cores} cores` : null,
      report.memoryGb ? `${report.memoryGb} GB RAM` : null,
    ].filter(Boolean).join(', ');

    const beginStr = report.beginTime ? new Date(report.beginTime).toLocaleString() : '—';
    const endStr = report.endTime ? new Date(report.endTime).toLocaleString() : '—';

    return `
      <div style="margin-bottom: 24px;">
        ${groupHeader(dbLabel)}
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px;">
          <div style="background: #f5f5f5; border-radius: 6px; padding: 14px; border: 1px solid #e0e0e0;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 4px;">Host</div>
            <div style="font-size: 11pt; font-weight: 600; color: #333;">${this.utils.escapeHtml(hostLabel)}</div>
            ${hwLabel ? `<div style="font-size: 9pt; color: #888; margin-top: 2px;">${this.utils.escapeHtml(hwLabel)}</div>` : ''}
          </div>
          <div style="background: #f5f5f5; border-radius: 6px; padding: 14px; border: 1px solid #e0e0e0;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 4px;">Database</div>
            <div style="font-size: 11pt; font-weight: 600; color: #333;">${this.utils.escapeHtml(report.dbEdition || '—')} ${this.utils.escapeHtml(report.dbRelease || '')}</div>
          </div>
          <div style="background: #f5f5f5; border-radius: 6px; padding: 14px; border: 1px solid #e0e0e0;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 4px;">Snapshot Window</div>
            <div style="font-size: 10pt; font-weight: 600; color: #333; font-variant-numeric: tabular-nums;">${beginStr}</div>
            <div style="font-size: 9pt; color: #888;">to ${endStr}</div>
          </div>
          <div style="background: #f5f5f5; border-radius: 6px; padding: 14px; border: 1px solid #e0e0e0;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 4px;">Timing</div>
            <div style="font-size: 11pt; font-weight: 600; color: #333; font-variant-numeric: tabular-nums;">
              ${report.elapsedMinutes != null ? `${formatNum(report.elapsedMinutes)} min elapsed` : '—'}
            </div>
            <div style="font-size: 9pt; color: #888; font-variant-numeric: tabular-nums;">
              ${report.dbTimeMinutes != null ? `${formatNum(report.dbTimeMinutes)} min DB time` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderInsightsTable(insights: AwrInsightSummary[]): string {
    const rows = insights.map((i) => {
      const categoryLabel = i.category.replace(/_/g, ' ');

      return `
        <tr style="background: white;">
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">
            ${pill(i.severity, this.severityPillKind(i.severity))}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt; color: #555; text-transform: capitalize;">${this.utils.escapeHtml(categoryLabel)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt; font-weight: 600;">${this.utils.escapeHtml(i.title)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt; color: #555;">${this.utils.escapeHtml(i.description)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt; color: #555; font-style: italic;">${i.recommendation ? this.utils.escapeHtml(i.recommendation) : '—'}</td>
        </tr>
      `;
    }).join('');

    return `
      <div style="margin-top: 24px;">
        ${groupHeader('Insights', [chip(`${formatInt(insights.length)} insights`, 'neutral')])}
        <div class="table-scroll">
          <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="${THEAD_ROW}">
              <th style="${TH_CENTER} width: 80px;">Severity</th>
              <th style="${TH_TEXT} width: 120px;">Category</th>
              <th style="${TH_TEXT}">Finding</th>
              <th style="${TH_TEXT}">Description</th>
              <th style="${TH_TEXT}">Recommendation</th>
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

  private renderTopSql(reports: AwrReportSummary[]): string {
    const topSqlEntries: Array<{ sqlId: string; elapsedTime: number; executions: number; elapsedPerExec: number }> = [];

    for (const report of reports) {
      const parsedData = report.parsedData;
      if (!parsedData?.topSql) continue;

      const topSql = parsedData.topSql as Record<string, unknown>;
      const byElapsedTime = topSql.byElapsedTime as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(byElapsedTime)) continue;

      for (const entry of byElapsedTime.slice(0, 5)) {
        if (entry.sqlId && typeof entry.elapsedTimeSec === 'number') {
          topSqlEntries.push({
            sqlId: String(entry.sqlId),
            elapsedTime: Number(entry.elapsedTimeSec),
            executions: Number(entry.executions || 0),
            elapsedPerExec: Number(entry.elapsedPerExecSec || 0),
          });
        }
      }
    }

    if (topSqlEntries.length === 0) return '';

    // SQL IDs stay monospace on purpose — they are opaque identifiers, not numbers.
    const rows = topSqlEntries.map((s) => `
      <tr style="background: white;">
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-family: 'Courier New', monospace; font-size: 9pt; font-weight: 600;">${this.utils.escapeHtml(s.sqlId)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-variant-numeric: tabular-nums; font-size: 9pt;">${formatNum(s.elapsedTime)}s</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-variant-numeric: tabular-nums; font-size: 9pt;">${formatInt(s.executions)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-variant-numeric: tabular-nums; font-size: 9pt;">${formatNum(s.elapsedPerExec)}s</td>
      </tr>
    `).join('');

    return `
      <div style="margin-top: 24px;">
        ${groupHeader('Top SQL by Elapsed Time', [chip(`${formatInt(topSqlEntries.length)} statements`, 'neutral')])}
        <div class="table-scroll">
          <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="${THEAD_ROW}">
              <th style="${TH_TEXT}">SQL ID</th>
              <th style="${TH_NUM}">Elapsed Time</th>
              <th style="${TH_NUM}">Executions</th>
              <th style="${TH_NUM}">Elapsed/Exec</th>
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

  private severityPillKind(severity: string): PillKind {
    switch (severity) {
      case 'critical': return 'bad';
      case 'warning': return 'warn';
      case 'info': return 'info';
      default: return 'neutral';
    }
  }
}
