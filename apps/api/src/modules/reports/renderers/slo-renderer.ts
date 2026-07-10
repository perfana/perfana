import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, SloCheckResult } from '../services/report-data-fetcher.service';
import { formatValueWithUnit } from './unit-format';

/**
 * Renderer for SLO section
 *
 * Displays Service Level Objective results with pass/fail status,
 * requirement thresholds, and actual measured values.
 */
@Injectable()
export class SloRenderer {
  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  /**
   * Render SLO section with real check result data from the database
   */
  async renderSloSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const title = section.title || 'SLO Results';
    const comment = section.comment;
    const config = section.config || {};
    const filterType = config.filterType as string | undefined; // 'metric' | 'apdex' | undefined (show all)

    if (!testRun) {
      return `
        <section class="slo-section">
          <h2>${this.utils.escapeHtml(title)}</h2>
          ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
          <div class="slo-results">
            <p class="placeholder-message">No test run data available for SLO analysis.</p>
          </div>
        </section>
      `;
    }

    const checkResults = await this.dataFetcher.getSloCheckResults(testRun.testRunId, userId, roles);

    // Apply optional type filter
    const filtered = filterType
      ? checkResults.filter(r => r.evaluate_type === filterType)
      : checkResults;

    if (filtered.length === 0) {
      return `
        <section class="slo-section">
          <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px; border-left: 4px solid ${this.utils.getDefaultStyling().primaryColor}; padding-left: 20px;">
            <div style="background: linear-gradient(135deg, #43a047 0%, #66bb6a 100%); color: white; width: 64px; height: 64px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 32px; box-shadow: 0 2px 8px rgba(67,160,71,0.3);">
              ✓
            </div>
            <div style="flex: 1;">
              <h2 style="margin: 0; padding: 0; border: none; font-size: 18pt; font-weight: 600; color: #333;">${this.utils.escapeHtml(title)}</h2>
              <div style="font-size: 10pt; color: #666; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 4px;">
                SERVICE LEVEL OBJECTIVES
              </div>
            </div>
          </div>
          ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
          <div style="padding: 20px; background: #f5f5f5; border-radius: 4px; text-align: center; color: #999;">
            No SLO check results available for this test run.
          </div>
        </section>
      `;
    }

    const passed = filtered.filter(r => r.meets_requirement === true).length;
    const failed = filtered.filter(r => r.meets_requirement === false).length;
    const total = filtered.length;
    const allPassed = failed === 0;

    return `
      <section class="slo-section">
        <!-- Section Header -->
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px; border-left: 4px solid ${allPassed ? '#43a047' : '#f44336'}; padding-left: 20px;">
          <div style="background: linear-gradient(135deg, ${allPassed ? '#43a047 0%, #66bb6a' : '#e53935 0%, #ef5350'} 100%); color: white; width: 64px; height: 64px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 32px; box-shadow: 0 2px 8px ${allPassed ? 'rgba(67,160,71,0.3)' : 'rgba(229,57,53,0.3)'};">
            ${allPassed ? '✓' : '✗'}
          </div>
          <div style="flex: 1;">
            <h2 style="margin: 0; padding: 0; border: none; font-size: 18pt; font-weight: 600; color: #333;">${this.utils.escapeHtml(title)}</h2>
            <div style="font-size: 10pt; color: #666; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 4px;">
              SERVICE LEVEL OBJECTIVES
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 28pt; font-weight: 700; color: ${allPassed ? '#43a047' : '#f44336'}; font-family: 'Courier New', monospace;">${passed}/${total}</div>
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em;">CHECKS PASSED</div>
          </div>
        </div>

        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}

        <!-- Summary Cards -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px;">
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">Total Checks</div>
            <div style="font-size: 28pt; font-weight: 700; color: ${this.utils.getDefaultStyling().primaryColor}; font-family: 'Courier New', monospace;">${total}</div>
          </div>
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">Passed</div>
            <div style="font-size: 28pt; font-weight: 700; color: #43a047; font-family: 'Courier New', monospace;">${passed}</div>
          </div>
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">Failed</div>
            <div style="font-size: 28pt; font-weight: 700; color: ${failed > 0 ? '#f44336' : '#43a047'}; font-family: 'Courier New', monospace;">${failed}</div>
          </div>
        </div>

        <!-- Check Results Table -->
        ${this.renderCheckResultsTable(filtered)}
      </section>
    `;
  }

  /**
   * Render the check results table
   */
  private renderCheckResultsTable(results: SloCheckResult[]): string {
    const tableRows = results
      .map((result) => {
        const name = result.metric_name || result.panel_title || result.benchmark_id;
        const isPassed = result.meets_requirement === true;
        const rowBg = isPassed ? 'white' : '#fff8f8';

        const requirementText = this.formatRequirement(
          result.requirement_operator,
          result.requirement_value,
          result.metric_unit,
        );

        const formattedActual = formatValueWithUnit(result.panel_average, result.metric_unit ?? undefined);
        // formatValueWithUnit returns '-' for null/NaN; the table uses '—' for missing values
        const actualValue = formattedActual === '-' ? '—' : this.utils.escapeHtml(formattedActual);

        const statusBadge = isPassed
          ? `<span style="display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; background: #e8f5e9; color: #2e7d32;">PASS</span>`
          : `<span style="display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; background: #ffebee; color: #c62828;">FAIL</span>`;

        return `
          <tr style="background: ${rowBg};">
            <td style="padding: 12px 16px; border-bottom: 1px solid #e0e0e0;">${this.utils.escapeHtml(name)}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e0e0e0; text-transform: uppercase; font-size: 9pt; color: #666; letter-spacing: 0.05em;">${this.utils.escapeHtml(result.evaluate_type)}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e0e0e0; font-size: 9pt; color: #666;">${this.utils.escapeHtml(result.source)}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e0e0e0; font-family: 'Courier New', monospace;">${this.utils.escapeHtml(requirementText)}</td>
            <td style="padding: 12px 16px; text-align: right; border-bottom: 1px solid #e0e0e0; font-family: 'Courier New', monospace; font-weight: 600;">${actualValue}</td>
            <td style="padding: 12px 16px; text-align: center; border-bottom: 1px solid #e0e0e0;">${statusBadge}</td>
          </tr>
        `;
      })
      .join('');

    return `
      <div style="border-left: 4px solid ${this.utils.getDefaultStyling().primaryColor}; padding-left: 20px;">
        <table style="width: 100%; border-collapse: collapse; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <thead>
            <tr style="background: linear-gradient(135deg, #4285f4 0%, #5e92f3 100%); color: white;">
              <th style="padding: 16px; text-align: left; font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Check Name</th>
              <th style="padding: 16px; text-align: left; font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Type</th>
              <th style="padding: 16px; text-align: left; font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Source</th>
              <th style="padding: 16px; text-align: left; font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Requirement</th>
              <th style="padding: 16px; text-align: right; font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Actual</th>
              <th style="padding: 16px; text-align: center; font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Status</th>
            </tr>
          </thead>
          <tbody style="background: white;">
            ${tableRows}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Format requirement operator and value into human-readable text
   */
  private formatRequirement(
    operator: string | null,
    value: number | null,
    unit: string | null,
  ): string {
    if (!operator || value == null) return 'No requirement';

    // Format like the web UI does (percentunit → %, short/none → bare number)
    const formattedValue = formatValueWithUnit(value, unit ?? undefined);

    switch (operator) {
      case 'lt': return `< ${formattedValue}`;
      case 'le':
      case 'lte': return `≤ ${formattedValue}`;
      case 'gt': return `> ${formattedValue}`;
      case 'ge':
      case 'gte': return `≥ ${formattedValue}`;
      case 'eq': return `= ${formattedValue}`;
      case 'ne': return `≠ ${formattedValue}`;
      default: return `${operator} ${formattedValue}`;
    }
  }
}
