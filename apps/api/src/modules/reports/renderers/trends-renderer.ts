import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, TrendRunSummary } from '../services/report-data-fetcher.service';
import {
  REPORT_COLORS,
  sectionHeader,
  sectionText,
  deltaChip,
  emptyState,
  formatInt,
  formatNum,
  formatPercent,
  markerChip,
} from './report-style';

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
    const text = getSectionText(section);
    const maxRuns = typeof config.maxRuns === 'number' ? config.maxRuns : 10;

    if (!testRun) {
      return this.renderNoDataSection(title, text, 'No test run data available for trends analysis.');
    }

    const trendsData = await this.dataFetcher.getTrendsData(testRun, maxRuns, userId, roles);

    if (!trendsData || trendsData.previousRuns.length === 0) {
      return this.renderNoDataSection(title, text, 'No previous runs found for trend comparison. Trends require at least two completed runs with the same system, environment, and workload.');
    }

    // All runs in chronological order (oldest first)
    const allRuns = [...trendsData.previousRuns].reverse();
    allRuns.push(trendsData.currentRun);

    const previousRun = trendsData.previousRuns[0]!;
    const currentRun = trendsData.currentRun;

    return `
      <section class="trends-section">
        ${sectionHeader(title, { kicker: `${formatInt(allRuns.length)} runs compared` })}

        ${sectionText(text)}

        <!-- Trend Summary Cards -->
        ${this.renderTrendSummaryCards(currentRun, previousRun)}

        <!-- Historical Runs Table -->
        <h3 style="margin: 32px 0 16px 0; font-size: 10pt; font-weight: 700; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em;">Run History</h3>
        ${this.renderRunHistoryTable(allRuns, currentRun.testRunId)}
      </section>
    `;
  }

  private renderTrendSummaryCards(
    current: TrendRunSummary,
    previous: TrendRunSummary,
  ): string {
    const avgDelta = this.calculateDelta(current.avgMs, previous.avgMs);
    const p95Delta = this.calculateDelta(current.p95Ms, previous.p95Ms);
    const errorDelta = this.calculateDelta(current.errorRate, previous.errorRate);
    const txnDelta = this.calculateDelta(current.totalTransactions, previous.totalTransactions);

    return `
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0;">
        ${this.renderTrendCard('Avg Response Time', `${formatNum(current.avgMs)} ms`, avgDelta, true)}
        ${this.renderTrendCard('P95 Response Time', `${formatNum(current.p95Ms)} ms`, p95Delta, true)}
        ${this.renderTrendCard('Error Rate', formatPercent(current.errorRate), errorDelta, true)}
        ${this.renderTrendCard('Total Transactions', formatInt(current.totalTransactions), txnDelta, false)}
      </div>
    `;
  }

  private renderTrendCard(
    label: string,
    value: string,
    delta: { percent: number; direction: 'up' | 'down' | 'flat' },
    lowerIsBetter: boolean,
  ): string {
    return `
      <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
        <div style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">${label}</div>
        <div style="font-size: 24pt; font-weight: 700; color: ${REPORT_COLORS.ink}; font-variant-numeric: tabular-nums;">${value}</div>
        <div style="font-size: 10pt; color: ${REPORT_COLORS.mutedInk}; margin-top: 8px; font-weight: 600;">
          ${deltaChip(delta.percent, undefined, lowerIsBetter)} vs previous
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
          <td style="font-size: 9pt; white-space: nowrap; font-variant-numeric: tabular-nums;">
            ${dateStr}${isCurrent ? ` ${markerChip('Current', 'info')}` : ''}
          </td>
          <td style="font-size: 9pt;">${release}</td>
          <td style="text-align: right; font-variant-numeric: tabular-nums;">${durationStr}</td>
          <td style="text-align: right; font-variant-numeric: tabular-nums;">${formatNum(run.avgMs)}</td>
          <td style="text-align: right; font-variant-numeric: tabular-nums;">${formatNum(run.p95Ms)}</td>
          <td style="text-align: right; font-variant-numeric: tabular-nums;">${formatNum(run.p99Ms)}</td>
          <td style="text-align: right; font-variant-numeric: tabular-nums;" class="${run.errorRate > 0 ? 'table-value-error-pct' : ''}">${formatPercent(run.errorRate)}</td>
          <td style="text-align: right; font-variant-numeric: tabular-nums;">${formatInt(run.totalTransactions)}</td>
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

  /**
   * Calculate delta between current and previous values
   */
  calculateDelta(
    current: number,
    previous: number,
  ): { percent: number; direction: 'up' | 'down' | 'flat' } {
    if (previous === 0 && current === 0) {
      return { percent: 0, direction: 'flat' };
    }
    if (previous === 0) {
      return { percent: 100, direction: 'up' };
    }

    const percent = ((current - previous) / Math.abs(previous)) * 100;

    if (Math.abs(percent) < 0.5) {
      return { percent: 0, direction: 'flat' };
    }

    return {
      percent,
      direction: percent > 0 ? 'up' : 'down',
    };
  }

  private renderNoDataSection(title: string, text: string | undefined, message: string): string {
    return `
      <section class="trends-section">
        ${sectionHeader(title)}
        ${sectionText(text)}
        ${emptyState(message)}
      </section>
    `;
  }
}
