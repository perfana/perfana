import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, SloCheckResult } from '../services/report-data-fetcher.service';
import { formatValueWithUnit } from './unit-format';
import { sectionHeader, chip, pill, commentBlock, formatInt, REPORT_COLORS } from './report-style';

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
          ${sectionHeader(title, { kicker: 'Service Level Objectives' })}
          ${commentBlock(comment)}
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
          ${sectionHeader(title, { kicker: 'Service Level Objectives' })}
          ${commentBlock(comment)}
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

    const headerChips = [
      chip(`${passed}/${total} passed`, allPassed ? 'good' : 'bad'),
      failed > 0 ? chip(`${failed} failed`, 'bad') : '',
    ];

    return `
      <section class="slo-section">
        ${sectionHeader(title, { kicker: 'Service Level Objectives', chipsHtml: headerChips })}
        ${commentBlock(comment)}

        <!-- Summary Cards -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px;">
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">Total Checks</div>
            <div style="font-size: 28pt; font-weight: 700; color: ${REPORT_COLORS.primary}; font-variant-numeric: tabular-nums;">${formatInt(total)}</div>
          </div>
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">Passed</div>
            <div style="font-size: 28pt; font-weight: 700; color: ${REPORT_COLORS.dot.good}; font-variant-numeric: tabular-nums;">${formatInt(passed)}</div>
          </div>
          <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px;">
            <div style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; font-weight: 600;">Failed</div>
            <div style="font-size: 28pt; font-weight: 700; color: ${failed > 0 ? REPORT_COLORS.dot.bad : REPORT_COLORS.dot.good}; font-variant-numeric: tabular-nums;">${formatInt(failed)}</div>
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
      .map((result, idx) => {
        const name = result.metric_name || result.panel_title || result.benchmark_id;
        const isPassed = result.meets_requirement === true;
        const rowBg = isPassed ? (idx % 2 === 1 ? '#fbfcfd' : '#ffffff') : '#fff7f6';

        const requirementText = this.formatRequirement(
          result.requirement_operator,
          result.requirement_value,
          result.metric_unit,
        );

        const formattedActual = formatValueWithUnit(result.panel_average, result.metric_unit ?? undefined);
        // formatValueWithUnit returns '-' for null/NaN; the table uses '—' for missing values
        const actualValue = formattedActual === '-' ? '—' : this.utils.escapeHtml(formattedActual);

        const statusBadge = isPassed ? pill('PASS', 'good') : pill('FAIL', 'bad');

        return `
          <tr style="background: ${rowBg};">
            <td style="padding: 12px 16px; border-bottom: 1px solid #f0f2f5; font-size: 13px; color: ${REPORT_COLORS.ink}; font-weight: 600;">${this.utils.escapeHtml(name)}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #f0f2f5; text-transform: uppercase; font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; letter-spacing: 0.05em;">${this.utils.escapeHtml(result.evaluate_type)}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #f0f2f5; font-size: 9pt; color: ${REPORT_COLORS.mutedInk};">${this.utils.escapeHtml(result.source)}</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #f0f2f5; font-variant-numeric: tabular-nums;">${this.utils.escapeHtml(requirementText)}</td>
            <td style="padding: 12px 16px; text-align: right; border-bottom: 1px solid #f0f2f5; font-variant-numeric: tabular-nums; font-weight: 600;">${actualValue}</td>
            <td style="padding: 12px 16px; text-align: center; border-bottom: 1px solid #f0f2f5;">${statusBadge}</td>
          </tr>
        `;
      })
      .join('');

    const thText = 'padding: 4px 16px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: ' + REPORT_COLORS.faintInk + ';';

    return `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 2px solid #e6e8ec;">
            <th style="${thText} text-align: left;">Check Name</th>
            <th style="${thText} text-align: left;">Type</th>
            <th style="${thText} text-align: left;">Source</th>
            <th style="${thText} text-align: left;">Requirement</th>
            <th style="${thText} text-align: right;">Actual</th>
            <th style="${thText} text-align: center;">Status</th>
          </tr>
        </thead>
        <tbody style="background: white;">
          ${tableRows}
        </tbody>
      </table>
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
