import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService } from '../services/report-data-fetcher.service';

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
   * Render Apdex section
   * Supports multiple scenarios via config.scenarios parameter
   * TODO: Replace mock data with actual Apdex data from test run metrics
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
          <div style="padding: 20px; background: #fff3e0; border-radius: 4px; border-left: 4px solid #ff9800;">
            <p style="margin: 0; color: #666;">No test run data available for Apdex section.</p>
          </div>
        </section>
      `;
    }

    // Fetch real Apdex data from database
    const apdexData = await this.dataFetcher.getApdexDataFromDatabase(testRun, apdexThreshold, excludeRampUp, userId, roles);

    if (!apdexData) {
      return `
        <section class="apdex-section">
          <div style="padding: 20px; background: #fff3e0; border-radius: 4px; border-left: 4px solid #ff9800;">
            <p style="margin: 0; color: #666;">No transaction data available for Apdex calculation.</p>
          </div>
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

    return `
      <section class="apdex-section">
        <!-- Section Header with Star Icon -->
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
          <div style="background: ${this.utils.getDefaultStyling().primaryColor}; color: white; width: 56px; height: 56px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 28px;">
            ⭐
          </div>
          <div style="flex: 1;">
            <h2 style="margin: 0; padding: 0; border: none;">${this.utils.escapeHtml(title)}</h2>
            <div style="font-size: 10pt; color: #666; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 4px;">
              APPLICATION PERFORMANCE INDEX
            </div>
          </div>
        </div>

        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}

        <!-- Overall Test Metrics -->
        ${showOverallMetrics ? this.renderApdexOverallMetrics(apdexData.overall) : ''}

        <!-- Scenarios Section Header -->
        <h3 style="margin: 32px 0 16px 0; font-size: 10pt; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 0.05em;">Scenarios</h3>

        <!-- Scenarios Section -->
        ${scenariosToDisplay.map(scenarioName => {
          const scenarioData = apdexData.scenarios[scenarioName];
          if (!scenarioData) {
            return `
              <div style="margin: 24px 0; padding: 16px; background: #fff3e0; border-radius: 4px; border-left: 4px solid var(--warning-color);">
                <p style="margin: 0; color: var(--text-secondary);">Scenario "${this.utils.escapeHtml(scenarioName)}" not found in test run data.</p>
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
  renderApdexOverallMetrics(overallData: any): string {
    const apdexRating = this.utils.getApdexRating(overallData.apdex);

    return `
      <div style="margin-bottom: 32px;">
        <h3 style="margin: 24px 0 16px 0; font-size: 10pt; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 0.05em;">Overall Test Metrics</h3>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0;">
          <!-- Peak Transactions/Second -->
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">Peak Transactions / Second</div>
            <div style="font-size: 28pt; font-weight: 700; color: ${this.utils.getDefaultStyling().primaryColor}; font-family: 'Courier New', monospace;">${overallData.peakTxnsPerSec}</div>
          </div>

          <!-- Peak Requests/Second -->
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">Peak Requests / Second</div>
            <div style="font-size: 28pt; font-weight: 700; color: ${this.utils.getDefaultStyling().secondaryColor}; font-family: 'Courier New', monospace;">${overallData.peakReqsPerSec}</div>
          </div>

          <!-- Peak Active Users -->
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">Peak Active Users</div>
            <div style="font-size: 28pt; font-weight: 700; color: ${this.utils.getDefaultStyling().primaryColor}; font-family: 'Courier New', monospace;">${overallData.peakActiveUsers}</div>
            ${overallData.avgActiveUsers ? `<div style="font-size: 9pt; color: #666; margin-top: 4px;">Avg: ${overallData.avgActiveUsers}</div>` : ''}
          </div>

          <!-- Transaction Error Rate -->
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">Transaction Error Rate</div>
            <div style="font-size: 28pt; font-weight: 700; color: ${overallData.errorRate > 1 ? '#f44336' : '#4caf50'}; font-family: 'Courier New', monospace;">${overallData.errorRate.toFixed(2)}%</div>
            ${overallData.failedCount ? `<div style="font-size: 9pt; color: #666; margin-top: 4px;">${overallData.failedCount} transactions failed</div>` : ''}
          </div>

          <!-- Avg Response Time -->
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">Avg Response Time</div>
            <div style="font-size: 28pt; font-weight: 700; color: ${this.utils.getDefaultStyling().primaryColor}; font-family: 'Courier New', monospace;">${overallData.avgMs.toFixed(2)} <span style="font-size: 14pt;">ms</span></div>
            <div style="font-size: 9pt; color: #666; margin-top: 4px;">Weighted average</div>
          </div>

          <!-- P95 Response Time -->
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">P95 Response Time</div>
            <div style="font-size: 28pt; font-weight: 700; color: #ff9800; font-family: 'Courier New', monospace;">${overallData.p95Ms.toFixed(2)} <span style="font-size: 14pt;">ms</span></div>
            <div style="font-size: 9pt; color: #666; margin-top: 4px;">95th percentile</div>
          </div>

          <!-- P99 Response Time -->
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">P99 Response Time</div>
            <div style="font-size: 28pt; font-weight: 700; color: #f44336; font-family: 'Courier New', monospace;">${overallData.p99Ms.toFixed(2)} <span style="font-size: 14pt;">ms</span></div>
            <div style="font-size: 9pt; color: #666; margin-top: 4px;">99th percentile</div>
          </div>

          <!-- Overall Apdex Score -->
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">Overall Apdex Score</div>
            <div style="font-size: 28pt; font-weight: 700; color: #4caf50; font-family: 'Courier New', monospace;">${overallData.apdex.toFixed(3)} <span style="font-size: 12pt; text-transform: uppercase; color: #4caf50;">${apdexRating}</span></div>
            <div style="font-size: 9pt; color: #666; margin-top: 4px;">${overallData.thresholdVaries ? 'T=varies per txn' : `T=${overallData.threshold}ms`}</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render individual scenario section for Apdex
   */
  renderApdexScenario(scenarioData: any, apdexThreshold: number): string {
    const apdexRating = this.utils.getApdexRating(scenarioData.summary.apdex);

    return `
      <div style="margin: 32px 0;">
        <!-- Scenario Header -->
        <div style="background: #e3f2fd; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px;">
          <h3 style="margin: 0; font-size: 12pt; font-weight: 600; color: var(--text-color); border: none; padding: 0;">
            ${this.utils.escapeHtml(scenarioData.scenario)}
          </h3>
        </div>

        <!-- Inline Scenario Metrics -->
        <div style="display: flex; justify-content: space-between; padding: 16px; background: #fafafa; border-radius: 4px; margin-bottom: 20px; align-items: baseline;">
          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Peak Txns / Sec</span>
            <span style="font-size: 16pt; font-weight: 700; color: ${this.utils.getDefaultStyling().primaryColor}; font-family: 'Courier New', monospace; margin-top: 4px;">${scenarioData.summary.peakTxnsPerSec}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Peak Reqs / Sec</span>
            <span style="font-size: 16pt; font-weight: 700; color: ${this.utils.getDefaultStyling().secondaryColor}; font-family: 'Courier New', monospace; margin-top: 4px;">${scenarioData.summary.peakReqsPerSec}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Peak VU</span>
            <span style="font-size: 16pt; font-weight: 700; color: ${this.utils.getDefaultStyling().primaryColor}; font-family: 'Courier New', monospace; margin-top: 4px;">${scenarioData.summary.peakVu}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Errors</span>
            <span style="font-size: 16pt; font-weight: 700; color: ${scenarioData.summary.errors > 0 ? '#ff9800' : '#4caf50'}; font-family: 'Courier New', monospace; margin-top: 4px;">${scenarioData.summary.errors > 0 ? scenarioData.summary.errors.toFixed(2) + '%' : scenarioData.summary.errors + '%'}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Avg (MS)</span>
            <span style="font-size: 16pt; font-weight: 700; color: ${this.utils.getDefaultStyling().primaryColor}; font-family: 'Courier New', monospace; margin-top: 4px;">${scenarioData.summary.avgMs.toFixed(2)}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">P95 (MS)</span>
            <span style="font-size: 16pt; font-weight: 700; color: #ff9800; font-family: 'Courier New', monospace; margin-top: 4px;">${scenarioData.summary.p95Ms.toFixed(2)}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">P99 (MS)</span>
            <span style="font-size: 16pt; font-weight: 700; color: #f44336; font-family: 'Courier New', monospace; margin-top: 4px;">${scenarioData.summary.p99Ms.toFixed(2)}</span>
          </div>

          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Apdex</span>
            <span style="font-size: 16pt; font-weight: 700; color: #4caf50; font-family: 'Courier New', monospace; margin-top: 4px;">${apdexRating}</span>
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
  renderApdexTransactionsTable(transactions: any[], _apdexThreshold: number): string {
    const tableRows = transactions
      .map(
        (txn: any) => {
          const apdexRating = this.utils.getApdexRating(txn.apdex);
          const apdexColor = txn.apdex >= 0.94 ? '#4caf50' : txn.apdex >= 0.85 ? '#66bb6a' : txn.apdex >= 0.70 ? '#ff9800' : '#f44336';

          return `
      <tr>
        <td>${this.utils.escapeHtml(txn.name)}</td>
        <td style="text-align: right; font-family: 'Courier New', monospace;">${txn.avgMs.toFixed(2)}</td>
        <td style="text-align: right; font-family: 'Courier New', monospace;">${txn.p95Ms.toFixed(2)}</td>
        <td style="text-align: right; font-family: 'Courier New', monospace;">${txn.p99Ms.toFixed(2)}</td>
        <td style="text-align: right;" class="table-value-pass">${txn.pass}</td>
        <td style="text-align: right;" class="${txn.fail > 0 ? 'table-value-fail' : ''}">${txn.fail}</td>
        <td style="text-align: right;" class="${txn.errPct > 0 ? 'table-value-error-pct' : ''}">${txn.errPct.toFixed(2)}%</td>
        <td style="text-align: right; font-family: 'Courier New', monospace;">${txn.threshold || 500}ms</td>
        <td style="text-align: right;">
          <span style="font-weight: 600; color: ${apdexColor}; text-transform: uppercase; font-size: 9pt; letter-spacing: 0.05em;">${apdexRating}</span>
        </td>
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
