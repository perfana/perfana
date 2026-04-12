import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, AwrData, AwrReportSummary, AwrInsightSummary } from '../services/report-data-fetcher.service';

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
    const comment = section.comment;

    const data = testRun
      ? await this.dataFetcher.getAwrData(testRun.testRunId)
      : null;

    if (!data || data.reports.length === 0) {
      return `
        <section class="awr-section">
          <h2>${this.utils.escapeHtml(title)}</h2>
          ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
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

    return `
      <section class="awr-section">
        <!-- Section Header -->
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 32px; border-left: 4px solid #1976d2; padding-left: 20px;">
          <div style="background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%); color: white; width: 64px; height: 64px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 28px; box-shadow: 0 2px 8px rgba(25,118,210,0.3);">
            &#x1F4CA;
          </div>
          <div style="flex: 1;">
            <h2 style="margin: 0; padding: 0; border: none; font-size: 18pt; font-weight: 600; color: #333;">${this.utils.escapeHtml(title)}</h2>
            <div style="font-size: 10pt; color: #666; margin-top: 4px;">${data.reports.length} AWR report${data.reports.length > 1 ? 's' : ''} analyzed</div>
          </div>
        </div>

        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}

        <!-- Severity Summary -->
        ${this.renderSeverityBadges(data)}

        <!-- Database Info -->
        ${data.reports.map((r) => this.renderReportSummary(r)).join('\n')}

        <!-- Insights Table -->
        ${displayInsights.length > 0 ? this.renderInsightsTable(displayInsights) : ''}

        <!-- Top SQL -->
        ${showTopSql ? this.renderTopSql(data.reports) : ''}
      </section>
    `;
  }

  private renderSeverityBadges(data: AwrData): string {
    const s = data.severitySummary;
    return `
      <div style="display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 140px; background: #ffebee; border: 1px solid #ffcdd2; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28pt; font-weight: 700; color: #c62828;">${s.critical}</div>
          <div style="font-size: 9pt; color: #b71c1c; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Critical</div>
        </div>
        <div style="flex: 1; min-width: 140px; background: #fff3e0; border: 1px solid #ffe0b2; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28pt; font-weight: 700; color: #e65100;">${s.warning}</div>
          <div style="font-size: 9pt; color: #bf360c; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Warning</div>
        </div>
        <div style="flex: 1; min-width: 140px; background: #e3f2fd; border: 1px solid #bbdefb; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28pt; font-weight: 700; color: #1565c0;">${s.info}</div>
          <div style="font-size: 9pt; color: #0d47a1; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Info</div>
        </div>
        <div style="flex: 1; min-width: 140px; background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28pt; font-weight: 700; color: #555;">${s.total}</div>
          <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Total</div>
        </div>
      </div>
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
        <h3 style="margin: 0 0 16px 0; font-size: 11pt; font-weight: 600; color: #333; padding-left: 16px; border-left: 4px solid #1976d2;">${this.utils.escapeHtml(dbLabel)}</h3>
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
            <div style="font-size: 10pt; font-weight: 600; color: #333; font-family: 'Courier New', monospace;">${beginStr}</div>
            <div style="font-size: 9pt; color: #888;">to ${endStr}</div>
          </div>
          <div style="background: #f5f5f5; border-radius: 6px; padding: 14px; border: 1px solid #e0e0e0;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 4px;">Timing</div>
            <div style="font-size: 11pt; font-weight: 600; color: #333;">
              ${report.elapsedMinutes != null ? `${report.elapsedMinutes.toFixed(1)} min elapsed` : '—'}
            </div>
            <div style="font-size: 9pt; color: #888;">
              ${report.dbTimeMinutes != null ? `${report.dbTimeMinutes.toFixed(1)} min DB time` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderInsightsTable(insights: AwrInsightSummary[]): string {
    const rows = insights.map((i) => {
      const severityColor = this.getSeverityColor(i.severity);
      const severityBg = this.getSeverityBg(i.severity);
      const categoryLabel = i.category.replace(/_/g, ' ');

      return `
        <tr style="background: white;">
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: center;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 8pt; font-weight: 600; color: ${severityColor}; background: ${severityBg}; text-transform: uppercase;">
              ${this.utils.escapeHtml(i.severity)}
            </span>
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt; color: #555; text-transform: capitalize;">${this.utils.escapeHtml(categoryLabel)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt; font-weight: 600;">${this.utils.escapeHtml(i.title)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt; color: #555;">${this.utils.escapeHtml(i.description)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-size: 9pt; color: #555; font-style: italic;">${i.recommendation ? this.utils.escapeHtml(i.recommendation) : '—'}</td>
        </tr>
      `;
    }).join('');

    return `
      <div style="margin-top: 24px; border-left: 4px solid #ff9800; padding-left: 20px;">
        <h3 style="margin: 0 0 12px 0; font-size: 11pt; font-weight: 600; color: #333;">Insights (${insights.length})</h3>
        <table style="width: 100%; border-collapse: collapse; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <thead>
            <tr style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); color: white;">
              <th style="padding: 12px; text-align: center; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; width: 80px;">Severity</th>
              <th style="padding: 12px; text-align: left; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; width: 120px;">Category</th>
              <th style="padding: 12px; text-align: left; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Finding</th>
              <th style="padding: 12px; text-align: left; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Description</th>
              <th style="padding: 12px; text-align: left; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Recommendation</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
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

    const rows = topSqlEntries.map((s) => `
      <tr style="background: white;">
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; font-family: 'Courier New', monospace; font-size: 9pt; font-weight: 600;">${this.utils.escapeHtml(s.sqlId)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-family: 'Courier New', monospace; font-size: 9pt;">${s.elapsedTime.toFixed(2)}s</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-family: 'Courier New', monospace; font-size: 9pt;">${s.executions.toLocaleString()}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e0e0e0; text-align: right; font-family: 'Courier New', monospace; font-size: 9pt;">${s.elapsedPerExec.toFixed(4)}s</td>
      </tr>
    `).join('');

    return `
      <div style="margin-top: 24px; border-left: 4px solid #9c27b0; padding-left: 20px;">
        <h3 style="margin: 0 0 12px 0; font-size: 11pt; font-weight: 600; color: #333;">Top SQL by Elapsed Time</h3>
        <table style="width: 100%; border-collapse: collapse; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <thead>
            <tr style="background: linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%); color: white;">
              <th style="padding: 12px; text-align: left; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">SQL ID</th>
              <th style="padding: 12px; text-align: right; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Elapsed Time</th>
              <th style="padding: 12px; text-align: right; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Executions</th>
              <th style="padding: 12px; text-align: right; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Elapsed/Exec</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }

  private getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical': return '#c62828';
      case 'warning': return '#e65100';
      case 'info': return '#1565c0';
      default: return '#555';
    }
  }

  private getSeverityBg(severity: string): string {
    switch (severity) {
      case 'critical': return '#ffebee';
      case 'warning': return '#fff3e0';
      case 'info': return '#e3f2fd';
      default: return '#f5f5f5';
    }
  }
}
