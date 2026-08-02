import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, SloCheckResult } from '../services/report-data-fetcher.service';
import { formatValueWithUnit } from './unit-format';
import {
  REPORT_COLORS,
  TH_CENTER,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  chip,
  sectionText,
  emptyState,
  formatInt,
  pill,
  sectionHeader,
  statCard,
} from './report-style';

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
    const text = getSectionText(section);
    const config = section.config || {};
    const filterType = config.filterType as string | undefined; // 'metric' | 'apdex' | undefined (show all)

    if (!testRun) {
      return `
        <section class="slo-section">
          ${sectionHeader(title, { kicker: 'Service Level Objectives' })}
          ${sectionText(text)}
          ${emptyState('No test run data available for SLO analysis.')}
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
          ${sectionText(text)}
          ${emptyState('No SLO check results available for this test run.')}
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
        ${sectionText(text)}

        <!-- Summary Cards -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px;">
          ${statCard('Total Checks', formatInt(total))}
          ${statCard('Passed', `<span style="color: ${REPORT_COLORS.dot.good};">${formatInt(passed)}</span>`)}
          ${statCard('Failed', `<span style="color: ${failed > 0 ? REPORT_COLORS.dot.bad : REPORT_COLORS.dot.good};">${formatInt(failed)}</span>`)}
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

    return `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="${THEAD_ROW}">
            <th style="${TH_TEXT}">Check Name</th>
            <th style="${TH_TEXT}">Type</th>
            <th style="${TH_TEXT}">Source</th>
            <th style="${TH_TEXT}">Requirement</th>
            <th style="${TH_NUM}">Actual</th>
            <th style="${TH_CENTER}">Status</th>
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
