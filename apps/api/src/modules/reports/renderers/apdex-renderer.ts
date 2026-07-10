import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, ApdexOverallData, ApdexScenarioData, ApdexTransaction } from '../services/report-data-fetcher.service';
import {
  sectionHeader,
  groupHeader,
  chip,
  pill,
  commentBlock,
  emptyState,
  formatInt,
  formatNum,
  formatPercent,
  statCard,
  REPORT_COLORS,
  PillKind,
} from './report-style';

/**
 * Renderer for Apdex section
 *
 * Generates Application Performance Index reports with:
 * - Overall test metrics
 * - Per-scenario breakdowns
 * - Transaction-level Apdex scores
 */
@Injectable()
export class ApdexRenderer {
  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  /**
   * Map an Apdex rating word to a pill kind (rule 06: rating words render as
   * pills — Excellent/Good → good, Fair → warn, Poor/Unacceptable → bad).
   */
  private ratingKind(rating: string): PillKind {
    switch (rating.toLowerCase()) {
      case 'excellent':
      case 'good':
        return 'good';
      case 'fair':
        return 'warn';
      default:
        return 'bad';
    }
  }

  /** Rating pill for an Apdex score. */
  private ratingPill(apdex: number): string {
    const rating = this.utils.getApdexRating(apdex);
    return pill(rating, this.ratingKind(rating));
  }

  /** Dot color for an Apdex score, derived from the same rating scale as the pill. */
  private ratingDotColor(apdex: number): string {
    const kind = this.ratingKind(this.utils.getApdexRating(apdex));
    return kind === 'good'
      ? REPORT_COLORS.dot.good
      : kind === 'warn'
        ? REPORT_COLORS.dot.warn
        : REPORT_COLORS.dot.bad;
  }

  /**
   * Render Apdex section
   * Supports multiple scenarios via config.scenarios parameter
   */
  async renderApdexSection(section: ReportSectionConfig, testRun: TestRun | null, userId: string = '', roles: string[] = []): Promise<string> {
    const config = section.config || {};
    const title = section.title || 'Apdex Scores';
    const comment = section.comment;
    const showOverallMetrics = config.showOverallMetrics !== false;
    const apdexThreshold = (config.apdexThreshold as number) || 500; // Default T=500ms
    const excludeRampUp = config.excludeRampUp !== false; // Default to true (match Performance Analysis)

    if (!testRun) {
      return `
        <section class="apdex-section">
          ${sectionHeader(title, { kicker: 'Application Performance Index' })}
          ${commentBlock(comment)}
          ${emptyState('No test run data available for Apdex section.')}
        </section>
      `;
    }

    // Fetch real Apdex data from database
    const apdexData = await this.dataFetcher.getApdexDataFromDatabase(testRun, apdexThreshold, excludeRampUp, userId, roles);

    if (!apdexData) {
      return `
        <section class="apdex-section">
          ${sectionHeader(title, { kicker: 'Application Performance Index' })}
          ${commentBlock(comment)}
          ${emptyState('No transaction data available for Apdex calculation.')}
        </section>
      `;
    }

    // Get scenarios to display
    let scenariosToDisplay: string[] = [];
    if (config.scenarios) {
      if (config.scenarios === 'all') {
        scenariosToDisplay = Object.keys(apdexData.scenarios);
      } else if (Array.isArray(config.scenarios)) {
        scenariosToDisplay = config.scenarios as string[];
      }
    } else {
      // Default: show all scenarios
      scenariosToDisplay = Object.keys(apdexData.scenarios);
    }

    const headerChips = [
      chip(`Apdex ${apdexData.overall.apdex.toFixed(3)}`, 'info'),
      this.ratingPill(apdexData.overall.apdex),
    ];

    return `
      <section class="apdex-section">
        ${sectionHeader(title, { kicker: 'Application Performance Index', chipsHtml: headerChips })}
        ${commentBlock(comment)}

        <!-- Overall Test Metrics -->
        ${showOverallMetrics ? this.renderApdexOverallMetrics(apdexData.overall) : ''}

        <!-- Scenarios Section Header -->
        <h3 style="margin: 32px 0 16px 0; font-size: 10pt; font-weight: 700; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em;">Scenarios</h3>

        <!-- Scenarios Section -->
        ${scenariosToDisplay.map(scenarioName => {
          const scenarioData = apdexData.scenarios[scenarioName];
          if (!scenarioData) {
            return `
              <div style="margin: 24px 0;">
                ${emptyState(`Scenario "${scenarioName}" not found in test run data.`)}
              </div>
            `;
          }
          return this.renderApdexScenario(scenarioData, apdexThreshold);
        }).join('')}
      </section>
    `;
  }

  /**
   * Render overall Apdex metrics grid
   */
  renderApdexOverallMetrics(overallData: ApdexOverallData): string {
    const sub = (text: string): string =>
      `<span style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; font-weight: 400;">${text}</span>`;
    const msValue = (value: number): string =>
      `${formatNum(value)} <span style="font-size: 14pt;">ms</span>`;
    // Rule 01: the score's color follows its rating, not a hardcoded green.
    const apdexColor = this.ratingDotColor(overallData.apdex);

    return `
      <div style="margin-bottom: 32px;">
        <h3 style="margin: 24px 0 16px 0; font-size: 10pt; font-weight: 700; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em;">Overall Test Metrics</h3>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0;">
          ${statCard('Peak Transactions / Second', formatNum(overallData.peakTxnsPerSec))}
          ${statCard('Peak Requests / Second', formatNum(overallData.peakReqsPerSec))}
          ${statCard(
            'Peak Active Users',
            formatInt(overallData.peakActiveUsers),
            overallData.avgActiveUsers ? sub(`Avg: ${formatInt(overallData.avgActiveUsers)}`) : '',
          )}
          ${statCard(
            'Transaction Error Rate',
            `<span style="color: ${overallData.errorRate > 1 ? REPORT_COLORS.dot.bad : REPORT_COLORS.dot.good};">${formatPercent(overallData.errorRate)}</span>`,
            overallData.failedCount ? sub(`${formatInt(overallData.failedCount)} transactions failed`) : '',
          )}
          ${statCard('Avg Response Time', msValue(overallData.avgMs), sub('Weighted average'))}
          ${statCard('P95 Response Time', msValue(overallData.p95Ms), sub('95th percentile'))}
          ${statCard('P99 Response Time', msValue(overallData.p99Ms), sub('99th percentile'))}
          ${statCard(
            'Overall Apdex Score',
            `<span style="color: ${apdexColor};">${overallData.apdex.toFixed(3)}</span> ${this.ratingPill(overallData.apdex)}`,
            sub(overallData.thresholdVaries ? 'T=varies per txn' : `T=${overallData.threshold}ms`),
          )}
        </div>
      </div>
    `;
  }

  /**
   * Render individual scenario section for Apdex
   */
  renderApdexScenario(scenarioData: ApdexScenarioData, apdexThreshold: number): string {
    return `
      <div style="margin: 32px 0;">
        <!-- Scenario Header -->
        ${groupHeader(scenarioData.scenario, [], [
          chip(`Apdex ${scenarioData.summary.apdex.toFixed(3)}`, 'info'),
          this.ratingPill(scenarioData.summary.apdex),
        ])}

        <!-- Inline Scenario Metrics -->
        <div style="display: flex; justify-content: space-between; padding: 16px; background: #fafafa; border-radius: 4px; margin-bottom: 20px; align-items: baseline;">
          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Peak Txns / Sec</span>
            <span style="font-size: 16pt; font-weight: 700; color: ${REPORT_COLORS.primary}; font-variant-numeric: tabular-nums; margin-top: 4px;">${formatNum(scenarioData.summary.peakTxnsPerSec)}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Peak Reqs / Sec</span>
            <span style="font-size: 16pt; font-weight: 700; color: ${REPORT_COLORS.primary}; font-variant-numeric: tabular-nums; margin-top: 4px;">${formatNum(scenarioData.summary.peakReqsPerSec)}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Peak VU</span>
            <span style="font-size: 16pt; font-weight: 700; color: ${REPORT_COLORS.primary}; font-variant-numeric: tabular-nums; margin-top: 4px;">${formatInt(scenarioData.summary.peakVu)}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Errors</span>
            <span style="font-size: 16pt; font-weight: 700; color: ${scenarioData.summary.errors > 0 ? REPORT_COLORS.dot.warn : REPORT_COLORS.dot.good}; font-variant-numeric: tabular-nums; margin-top: 4px;">${formatPercent(scenarioData.summary.errors)}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Avg (MS)</span>
            <span style="font-size: 16pt; font-weight: 700; color: ${REPORT_COLORS.primary}; font-variant-numeric: tabular-nums; margin-top: 4px;">${formatNum(scenarioData.summary.avgMs)}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">P95 (MS)</span>
            <span style="font-size: 16pt; font-weight: 700; color: ${REPORT_COLORS.dot.warn}; font-variant-numeric: tabular-nums; margin-top: 4px;">${formatNum(scenarioData.summary.p95Ms)}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">P99 (MS)</span>
            <span style="font-size: 16pt; font-weight: 700; color: ${REPORT_COLORS.dot.bad}; font-variant-numeric: tabular-nums; margin-top: 4px;">${formatNum(scenarioData.summary.p99Ms)}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Apdex</span>
            <span style="margin-top: 4px;">${this.ratingPill(scenarioData.summary.apdex)}</span>
          </div>
        </div>

        <!-- Transaction Table with Apdex Column -->
        ${this.renderApdexTransactionsTable(scenarioData.transactions, apdexThreshold)}
      </div>
    `;
  }

  /**
   * Render transactions table with Apdex column
   */
  renderApdexTransactionsTable(transactions: ApdexTransaction[], _apdexThreshold: number): string {
    const tableRows = transactions
      .map(
        (txn: ApdexTransaction) => {
          return `
      <tr>
        <td>${this.utils.escapeHtml(txn.name)}</td>
        <td style="text-align: right; font-variant-numeric: tabular-nums;">${formatNum(txn.avgMs)}</td>
        <td style="text-align: right; font-variant-numeric: tabular-nums;">${formatNum(txn.p95Ms)}</td>
        <td style="text-align: right; font-variant-numeric: tabular-nums;">${formatNum(txn.p99Ms)}</td>
        <td style="text-align: right; font-variant-numeric: tabular-nums;" class="table-value-pass">${formatInt(txn.pass)}</td>
        <td style="text-align: right; font-variant-numeric: tabular-nums;" class="${txn.fail > 0 ? 'table-value-fail' : ''}">${formatInt(txn.fail)}</td>
        <td style="text-align: right; font-variant-numeric: tabular-nums;" class="${txn.errPct > 0 ? 'table-value-error-pct' : ''}">${formatPercent(txn.errPct)}</td>
        <td style="text-align: right; font-variant-numeric: tabular-nums;">${formatInt(txn.threshold || 500)}ms</td>
        <td style="text-align: right;">${this.ratingPill(txn.apdex)}</td>
      </tr>
    `;
        },
      )
      .join('');

    return `
      <table class="data-table">
        <thead>
          <tr>
            <th>Transaction Name</th>
            <th style="text-align: right;">Avg Response<br/>(ms)</th>
            <th style="text-align: right;">95th Pct<br/>(ms)</th>
            <th style="text-align: right;">99th Pct<br/>(ms)</th>
            <th style="text-align: right;">Passed</th>
            <th style="text-align: right;">Failed</th>
            <th style="text-align: right;">Errors<br/>%</th>
            <th style="text-align: right;">Threshold<br/>(ms)</th>
            <th style="text-align: right;">Apdex<br/>Score</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    `;
  }
}
