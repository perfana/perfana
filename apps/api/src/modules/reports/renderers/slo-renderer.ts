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
    const maxItems = typeof config.maxItems === 'number' ? config.maxItems : 50;

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
        <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 24px;">
          ${statCard('Total Checks', formatInt(total))}
          ${statCard('Passed', `<span style="color: ${REPORT_COLORS.dot.good};">${formatInt(passed)}</span>`)}
          ${statCard('Failed', `<span style="color: ${failed > 0 ? REPORT_COLORS.dot.bad : REPORT_COLORS.dot.good};">${formatInt(failed)}</span>`)}
        </div>

        <!-- Check Results Table -->
        ${this.renderCheckResultsTable(filtered.slice(0, maxItems))}
      </section>
    `;
  }

  /**
   * Render the check results table.
   *
   * A failed check gets a second row naming the targets that failed it: a single FAIL on
   * "Workload Apdex" is unactionable, while "T04_Payment_Processing scored 0.62" is the
   * finding. The checker already stores those per-target outcomes; nothing showed them.
   */
  private renderCheckResultsTable(results: SloCheckResult[]): string {
    const tableRows = results
      .map((result, idx) => {
        const name = result.panel_title || result.metric_name || result.benchmark_id;
        const isPassed = result.meets_requirement === true;
        const rowBg = isPassed ? (idx % 2 === 1 ? '#fbfcfd' : '#ffffff') : '#fff7f6';

        const requirementText = this.requirementText(result);
        const actualValue = this.actualText(result);
        const statusBadge = isPassed ? pill('PASS', 'good') : pill('FAIL', 'bad');
        const cell = `padding: 12px 16px; border-bottom: 1px solid #f0f2f5;`;

        return `
          <tr style="background: ${rowBg};">
            <td style="${cell} font-size: 13px; color: ${REPORT_COLORS.ink}; font-weight: 600;">${this.utils.escapeHtml(name)}</td>
            <td style="${cell} font-size: 9pt; color: ${REPORT_COLORS.mutedInk};">${this.utils.escapeHtml(result.dashboard_label ?? '—')}</td>
            <td style="${cell} text-transform: uppercase; font-size: 9pt; color: ${REPORT_COLORS.mutedInk}; letter-spacing: 0.05em;">${this.utils.escapeHtml(result.evaluate_type)}</td>
            <td style="${cell} font-size: 9pt; color: ${REPORT_COLORS.mutedInk};">${this.utils.escapeHtml(result.source)}</td>
            <td style="${cell} font-variant-numeric: tabular-nums;">${this.utils.escapeHtml(requirementText)}</td>
            <td style="${cell} text-align: right; font-variant-numeric: tabular-nums; font-weight: 600;">${actualValue}</td>
            <td style="${cell} text-align: center;">${statusBadge}</td>
          </tr>
          ${this.renderFailingTargets(result)}
        `;
      })
      .join('');

    return `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="${THEAD_ROW}">
            <th style="${TH_TEXT}">Check Name</th>
            <th style="${TH_TEXT}">Dashboard</th>
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

  /** The targets that failed a failed check, as a nested row under it. */
  private renderFailingTargets(result: SloCheckResult): string {
    if (result.meets_requirement === true) return '';
    const failing = (result.targets ?? []).filter((t) => t.meets_requirement === false);
    if (failing.length === 0) return '';

    // ponytail: 20 rows then a count — a 2000-transaction check would otherwise be the report.
    const shown = failing.slice(0, 20);
    const rest = failing.length - shown.length;
    const isApdex = this.isApdex(result);
    const total = (result.targets ?? []).length;

    const head = isApdex
      ? ['Transaction', 'Scenario', 'Apdex', 'Avg', 'Satisfied', 'Tolerating', 'Frustrated']
      : ['Target', 'Value'];

    const rows = shown.map((t) => {
      const cells = isApdex
        ? [
            this.utils.escapeHtml(t.target),
            this.utils.escapeHtml(t.scenario_name ?? '—'),
            this.formatScore(t.value),
            this.formatMs(t.avg_response_time_ms),
            this.formatCount(t.satisfied_count),
            this.formatCount(t.tolerating_count),
            this.formatCount(t.frustrated_count),
          ]
        : [
            this.utils.escapeHtml(t.target),
            this.utils.escapeHtml(this.formatActualValue(t.value, result.metric_unit)),
          ];
      return `<tr>${cells.map((c, i) => `<td style="padding:6px 10px; font-size:11px; color:${REPORT_COLORS.ink}; ${i === 0 ? '' : 'text-align:right; font-variant-numeric:tabular-nums;'}">${c}</td>`).join('')}</tr>`;
    }).join('');

    const caption = result.message
      ? this.utils.escapeHtml(result.message)
      : `${formatInt(failing.length)} of ${formatInt(total)} targets failed`;

    return `
      <tr style="background:#fff7f6;">
        <td colspan="7" style="padding: 0 16px 14px; border-bottom: 1px solid #f0f2f5;">
          <div style="font-size:11.5px; color:${REPORT_COLORS.mutedInk}; margin-bottom:6px;">${caption}</div>
          <table style="width:100%; border-collapse:collapse; background:#ffffff; border:1px solid #f3d7d3; border-radius:6px;">
            <thead><tr>${head.map((h, i) => `<th style="padding:6px 10px; font-size:10px; text-transform:uppercase; letter-spacing:0.05em; color:${REPORT_COLORS.mutedInk}; text-align:${i === 0 ? 'left' : 'right'};">${h}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
          ${rest > 0 ? `<div style="font-size:11px; color:${REPORT_COLORS.mutedInk}; margin-top:6px;">and ${formatInt(rest)} more</div>` : ''}
        </td>
      </tr>
    `;
  }

  private isApdex(result: SloCheckResult): boolean {
    return result.evaluate_type === 'apdex' || result.requirement?.type === 'apdex';
  }

  /** An Apdex score is a bare 0–1 number; its stored unit code ("apdex_score") is not printable. */
  private formatScore(value: number | null | undefined): string {
    return value == null || !Number.isFinite(value) ? '—' : value.toFixed(2);
  }

  private formatMs(value: number | null | undefined): string {
    return value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)} ms`;
  }

  private formatCount(value: number | null | undefined): string {
    return value == null ? '—' : formatInt(value);
  }

  private formatActualValue(value: number | null, unit: string | null): string {
    const formatted = formatValueWithUnit(value, unit ?? undefined);
    return formatted === '-' ? '—' : formatted;
  }

  private actualText(result: SloCheckResult): string {
    if (this.isApdex(result)) return this.formatScore(result.panel_average);
    return this.utils.escapeHtml(this.formatActualValue(result.panel_average, result.metric_unit));
  }

  /**
   * What the check actually required. An operator/value pair cannot express either an Apdex
   * requirement (a minimum score at a latency threshold) or which statistic an aggregated
   * check evaluates — both used to render as "No requirement" or a bare "≤ 2000".
   */
  private requirementText(result: SloCheckResult): string {
    const req = result.requirement ?? {};
    if (this.isApdex(result)) {
      const min = this.toNumber(req.min_score);
      const ms = this.toNumber(req.threshold_ms);
      if (min != null) {
        return `≥ ${min} Apdex${ms != null ? ` at ${formatInt(ms)} ms` : ''}`;
      }
    }
    const base = this.formatRequirement(result.requirement_operator, result.requirement_value, result.metric_unit);
    const stat = typeof req.aggregate_stat === 'string' ? req.aggregate_stat : null;
    return stat ? `${stat.toUpperCase()} ${base}` : base;
  }

  private toNumber(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
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
      case '<': return `< ${formattedValue}`;
      case '<=': return `≤ ${formattedValue}`;
      case '>': return `> ${formattedValue}`;
      case '>=': return `≥ ${formattedValue}`;
      case '=':
      case '==': return `= ${formattedValue}`;
      case '!=': return `≠ ${formattedValue}`;
      default: return `${operator} ${formattedValue}`;
    }
  }
}
