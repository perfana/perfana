import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, TrendRunSummary } from '../services/report-data-fetcher.service';

/**
 * Renderer for Trends section
 *
 * Displays performance trends over time across multiple test runs
 * for the same system/environment/workload, showing improvements
 * or degradations in key metrics (avg response time, p95, p99,
 * error rate, throughput).
 */
@Injectable()
export class TrendsRenderer {
  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  /**
   * Render Trends section
   */
  async renderTrendsSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const config = section.config || {};
    const title = section.title || 'Performance Trends';
    const comment = section.comment;
    const maxRuns = (config.maxRuns as number) || 10;

    if (!testRun) {
      return this.renderNoDataSection(title, comment, 'No test run data available for trends analysis.');
    }

    const trendsData = await this.dataFetcher.getTrendsData(testRun, maxRuns, userId, roles);

    if (!trendsData || trendsData.previousRuns.length === 0) {
      return this.renderNoDataSection(title, comment, 'No previous runs found for trend comparison. Trends require at least two completed runs with the same system, environment, and workload.');
    }

    // All runs in chronological order (oldest first)
    const allRuns = [...trendsData.previousRuns].reverse();
    allRuns.push(trendsData.currentRun);

    // Calculate trend direction comparing current vs previous run
    const previousRun = trendsData.previousRuns[0]!; // Most recent previous (guard above ensures length > 0)
    const currentRun = trendsData.currentRun;

    const styling = this.utils.getDefaultStyling();

    return `
      <section class="trends-section">
        <!-- Section Header -->
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
          <div style="background: ${styling.primaryColor}; color: white; width: 56px; height: 56px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 28px;">
            &#x1F4C8;
          </div>
          <div style="flex: 1;">
            <h2 style="margin: 0; padding: 0; border: none;">${this.utils.escapeHtml(title)}</h2>
            <div style="font-size: 10pt; color: #666; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 4px;">
              ${allRuns.length} RUNS COMPARED
            </div>
          </div>
        </div>

        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}

        <!-- Trend Summary Cards -->
        ${this.renderTrendSummaryCards(currentRun, previousRun, styling)}

        <!-- Historical Runs Table -->
        <h3 style="margin: 32px 0 16px 0; font-size: 10pt; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 0.05em;">Run History</h3>
        ${this.renderRunHistoryTable(allRuns, currentRun.testRunId)}
      </section>
    `;
  }

  private renderTrendSummaryCards(
    current: TrendRunSummary,
    previous: TrendRunSummary,
    styling: { primaryColor?: string; secondaryColor?: string },
  ): string {
    const avgDelta = this.calculateDelta(current.avgMs, previous.avgMs);
    const p95Delta = this.calculateDelta(current.p95Ms, previous.p95Ms);
    const errorDelta = this.calculateDelta(current.errorRate, previous.errorRate);
    const txnDelta = this.calculateDelta(current.totalTransactions, previous.totalTransactions);

    return `
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0;">
        ${this.renderTrendCard('Avg Response Time', `${current.avgMs.toFixed(2)} ms`, avgDelta, true, styling.primaryColor || '#1976d2')}
        ${this.renderTrendCard('P95 Response Time', `${current.p95Ms.toFixed(2)} ms`, p95Delta, true, '#ff9800')}
        ${this.renderTrendCard('Error Rate', `${current.errorRate.toFixed(2)}%`, errorDelta, true, current.errorRate > 1 ? '#f44336' : '#4caf50')}
        ${this.renderTrendCard('Total Transactions', current.totalTransactions.toLocaleString(), txnDelta, false, styling.secondaryColor || '#9c27b0')}
      </div>
    `;
  }

  private renderTrendCard(
    label: string,
    value: string,
    delta: { percent: number; direction: 'up' | 'down' | 'flat' },
    lowerIsBetter: boolean,
    color: string,
  ): string {
    let trendColor: string;
    let trendIcon: string;

    if (delta.direction === 'flat') {
      trendColor = '#666';
      trendIcon = '&#x2194;'; // ↔
    } else if (delta.direction === 'up') {
      trendColor = lowerIsBetter ? '#f44336' : '#4caf50';
      trendIcon = '&#x25B2;'; // ▲
    } else {
      trendColor = lowerIsBetter ? '#4caf50' : '#f44336';
      trendIcon = '&#x25BC;'; // ▼
    }

    const sign = delta.percent > 0 ? '+' : '';

    return `
      <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
        <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">${label}</div>
        <div style="font-size: 24pt; font-weight: 700; color: ${color}; font-family: 'Courier New', monospace;">${value}</div>
        <div style="font-size: 10pt; color: ${trendColor}; margin-top: 8px; font-weight: 600;">
          <span>${trendIcon}</span> ${sign}${delta.percent.toFixed(1)}% vs previous
        </div>
      </div>
    `;
  }

  private renderRunHistoryTable(runs: TrendRunSummary[], currentTestRunId: string): string {
    const rows = runs.map((run) => {
      const isCurrent = run.testRunId === currentTestRunId;
      const rowStyle = isCurrent ? 'background-color: #e3f2fd;' : '';
      const dateStr = run.startTime.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const durationStr = run.duration ? this.utils.formatDuration(run.duration) : '-';
      const release = run.applicationRelease ? this.utils.escapeHtml(run.applicationRelease) : '-';

      return `
        <tr style="${rowStyle}">
          <td style="font-family: 'Courier New', monospace; font-size: 9pt; white-space: nowrap;">
            ${dateStr}${isCurrent ? ' <span style="font-size: 8pt; background: #1976d2; color: white; padding: 2px 6px; border-radius: 3px; margin-left: 4px;">CURRENT</span>' : ''}
          </td>
          <td style="font-size: 9pt;">${release}</td>
          <td style="text-align: right; font-family: 'Courier New', monospace;">${durationStr}</td>
          <td style="text-align: right; font-family: 'Courier New', monospace;">${run.avgMs.toFixed(2)}</td>
          <td style="text-align: right; font-family: 'Courier New', monospace;">${run.p95Ms.toFixed(2)}</td>
          <td style="text-align: right; font-family: 'Courier New', monospace;">${run.p99Ms.toFixed(2)}</td>
          <td style="text-align: right; font-family: 'Courier New', monospace;" class="${run.errorRate > 0 ? 'table-value-error-pct' : ''}">${run.errorRate.toFixed(2)}%</td>
          <td style="text-align: right; font-family: 'Courier New', monospace;">${run.totalTransactions.toLocaleString()}</td>
        </tr>
      `;
    }).join('');

    return `
      <table class="data-table">
        <thead>
          <tr>
            <th>Run Date</th>
            <th>Release</th>
            <th style="text-align: right;">Duration</th>
            <th style="text-align: right;">Avg (ms)</th>
            <th style="text-align: right;">P95 (ms)</th>
            <th style="text-align: right;">P99 (ms)</th>
            <th style="text-align: right;">Errors</th>
            <th style="text-align: right;">Transactions</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  private calculateDelta(
    current: number,
    previous: number,
  ): { percent: number; direction: 'up' | 'down' | 'flat' } {
    if (previous === 0 && current === 0) {
      return { percent: 0, direction: 'flat' };
    }
    if (previous === 0) {
      return { percent: 100, direction: 'up' };
    }

    const percent = ((current - previous) / previous) * 100;

    if (Math.abs(percent) < 0.5) {
      return { percent: 0, direction: 'flat' };
    }

    return {
      percent,
      direction: percent > 0 ? 'up' : 'down',
    };
  }

  private renderNoDataSection(title: string, comment: string | undefined, message: string): string {
    return `
      <section class="trends-section">
        <h2>${this.utils.escapeHtml(title)}</h2>
        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
        <div style="padding: 20px; background: #fff3e0; border-radius: 4px; border-left: 4px solid #ff9800;">
          <p style="margin: 0; color: #666;">${message}</p>
        </div>
      </section>
    `;
  }
}
