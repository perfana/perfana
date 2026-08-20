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
  groupHeader,
  markerChip,
  sectionText,
  emptyState,
  formatInt,
  pill,
  sectionHeader,
  statCard,
} from './report-style';

/**
 * Source labels for the per-source tables. Apdex is its own source: the checker stores it
 * as `grafana` because that is where the transaction data was collected, but an Apdex SLO
 * is not a Grafana panel check and does not belong in that table.
 */
const SOURCE_LABELS: Record<string, string> = {
  apdex: 'Apdex',
  grafana: 'Grafana',
  dynatrace: 'Dynatrace',
  custom: 'Performance metrics',
  'performance-metrics': 'Performance metrics',
};

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
    // Apdex always names the transactions that failed it — that IS the check. For the other
    // checks the per-series breakdown is opt-in, since a failing metric check can carry
    // hundreds of series and most readers only want the verdict.
    const showFailureDetails = config.showFailureDetails === true;

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

        <!-- One table per source: the Source column was the same value on every row -->
        ${this.renderSourceTables(filtered.slice(0, maxItems), showFailureDetails)}
      </section>
    `;
  }

  /**
   * The source a check belongs to for grouping.
   *
   * Apdex is its own source whatever the row says, and the rest follow the benchmark rather
   * than the check result: the checker stamps every row `grafana` because that is where the
   * data came from, so grouping on it puts performance-metrics checks in the Grafana table.
   */
  private sourceOf(result: SloCheckResult): string {
    if (this.isApdex(result)) return 'apdex';
    const source = result.benchmark_source || result.source || 'other';
    return source === 'custom' ? 'performance-metrics' : source;
  }

  /**
   * One table per source, in the order the sources first appear — and since the results
   * arrive failures-first, that puts the source with the first failure at the top.
   */
  private renderSourceTables(results: SloCheckResult[], showFailureDetails: boolean): string {
    const bySource = new Map<string, SloCheckResult[]>();
    for (const r of results) {
      const key = this.sourceOf(r);
      const arr = bySource.get(key) ?? [];
      arr.push(r);
      bySource.set(key, arr);
    }

    return [...bySource.entries()].map(([source, rows]) => {
      const failed = rows.filter((r) => r.meets_requirement === false).length;
      return `<div style="margin-top: 28px;">
        ${groupHeader(
          SOURCE_LABELS[source] ?? source,
          [chip(`${formatInt(rows.length)} checks`, 'neutral')],
          [failed > 0 ? chip(`${formatInt(failed)} failed`, 'bad') : chip('all passed', 'good')],
        )}
        ${this.renderCheckResultsTable(rows, source === 'apdex', showFailureDetails)}
      </div>`;
    }).join('\n');
  }

  /**
   * Render one source's check results.
   *
   * Columns mirror the SLO card — Dashboard, Metric Name, Requirement — so the report and
   * the screen name the same things the same way. The Apdex table drops the Actual column:
   * a single run-wide score says nothing the per-transaction rows below it do not say better.
   *
   * A failed check gets a second row naming the targets that failed it. For Apdex that is
   * unconditional (the transactions ARE the finding); for the rest it follows the section's
   * "show details in case of failure" setting.
   */
  private renderCheckResultsTable(
    results: SloCheckResult[],
    isApdexTable: boolean,
    showFailureDetails: boolean,
  ): string {
    const columns = isApdexTable ? 4 : 5;
    const tableRows = results
      .map((result, idx) => {
        const isPassed = result.meets_requirement === true;
        const rowBg = isPassed ? (idx % 2 === 1 ? '#fbfcfd' : '#ffffff') : '#fff7f6';
        const statusBadge = isPassed ? pill('PASS', 'good') : pill('FAIL', 'bad');
        const cell = `padding: 12px 16px; border-bottom: 1px solid #f0f2f5;`;
        const pattern = result.match_pattern
          ? `<div style="font-size:10.5px; color:${REPORT_COLORS.mutedInk}; margin-top:4px;">For series matching pattern: ${this.utils.escapeHtml(result.match_pattern)}</div>`
          : '';

        return `
          <tr style="background: ${rowBg};">
            <td style="${cell} font-size: 13px; color: ${REPORT_COLORS.ink}; font-weight: 600;">${this.utils.escapeHtml(this.dashboardName(result))}</td>
            <td style="${cell} font-size: 12.5px; color: ${REPORT_COLORS.mutedInk};">${this.utils.escapeHtml(this.metricName(result))}${pattern}</td>
            <td style="${cell} font-size: 12.5px; color: ${REPORT_COLORS.mutedInk}; font-variant-numeric: tabular-nums;">${this.utils.escapeHtml(this.requirementText(result))}</td>
            ${isApdexTable ? '' : `<td style="${cell} font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600;">${this.actualText(result)}</td>`}
            <td style="${cell} text-align: center;">${statusBadge}</td>
          </tr>
          ${this.renderFailingTargets(result, columns, showFailureDetails)}
        `;
      })
      .join('');

    return `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="${THEAD_ROW}">
            <th style="${TH_TEXT}">Dashboard</th>
            <th style="${TH_TEXT}">Metric Name</th>
            <th style="${TH_TEXT}">Requirement</th>
            ${isApdexTable ? '' : `<th style="${TH_NUM}">Actual</th>`}
            <th style="${TH_CENTER}">Status</th>
          </tr>
        </thead>
        <tbody style="background: white;">
          ${tableRows}
        </tbody>
      </table>
    `;
  }

  /** Dashboard column — an Apdex check has no dashboard of its own, like on the SLO card. */
  private dashboardName(result: SloCheckResult): string {
    if (this.isApdex(result)) return 'Apdex SLO';
    return result.dashboard_label || result.benchmark_id;
  }

  /** Metric Name column, worded as the SLO card words it. */
  private metricName(result: SloCheckResult): string {
    if (this.isApdex(result)) return 'Apdex Score';
    const req = result.requirement ?? {};
    if (req.type === 'aggregated' || result.evaluate_type === 'aggregated') {
      const metric = typeof req.aggregate_metric === 'string' ? req.aggregate_metric : '';
      if (metric === 'error_percentage') return 'Error Percentage';
      const stat = typeof req.aggregate_stat === 'string' ? req.aggregate_stat : '';
      const statLabel = stat ? stat.charAt(0).toUpperCase() + stat.slice(1) : '';
      const metricLabel = metric === 'transaction_response_time'
        ? 'Transaction Response Times'
        : 'Request Response Times';
      return statLabel ? `${statLabel} ${metricLabel}` : metricLabel;
    }
    return result.panel_title || result.metric_name || result.benchmark_id;
  }

  /** The targets that failed a failed check, as a nested row under it. */
  private renderFailingTargets(result: SloCheckResult, columns: number, showFailureDetails: boolean): string {
    if (result.meets_requirement === true) return '';
    const isApdex = this.isApdex(result);
    if (!isApdex && !showFailureDetails) return '';
    const failing = (result.targets ?? []).filter((t) => t.meets_requirement === false);
    if (failing.length === 0) return '';

    // ponytail: 20 rows then a count — a 2000-transaction check would otherwise be the report.
    const shown = failing.slice(0, 20);
    const rest = failing.length - shown.length;
    const total = (result.targets ?? []).length;

    const head = isApdex
      ? ['Transaction', 'Scenario', 'Apdex', 'Threshold', 'Avg', 'Satisfied', 'Tolerating', 'Frustrated', 'Status']
      : ['Target', 'Value', 'Status'];

    const rows = shown.map((t) => {
      const cells = isApdex
        ? [
            this.utils.escapeHtml(t.target),
            this.utils.escapeHtml(t.scenario_name ?? '—'),
            this.formatScore(t.value),
            this.formatMs(t.threshold_ms),
            this.formatMs(t.avg_response_time_ms),
            this.formatCount(t.satisfied_count),
            this.formatCount(t.tolerating_count),
            this.formatCount(t.frustrated_count),
            markerChip('FAIL', 'bad'),
          ]
        : [
            this.utils.escapeHtml(t.target),
            this.utils.escapeHtml(this.formatActualValue(t.value, result.metric_unit)),
            markerChip('FAIL', 'bad'),
          ];
      return `<tr>${cells.map((c, i) => {
        const align = i === 0 ? '' : i === cells.length - 1 ? 'text-align:center;' : 'text-align:right; font-variant-numeric:tabular-nums;';
        return `<td style="padding:6px 10px; font-size:11px; color:${REPORT_COLORS.ink}; ${align}">${c}</td>`;
      }).join('')}</tr>`;
    }).join('');

    // The checker's own message is worth quoting for Apdex (it names the transactions), but
    // for metric checks it can disagree with the rows right under it — one live check says
    // "7 of 7 targets failed requirements" while only 2 of its targets carry a failure flag.
    // Count what is actually shown instead.
    const caption = isApdex && result.message
      ? this.utils.escapeHtml(result.message)
      : `${formatInt(failing.length)} of ${formatInt(total)} ${isApdex ? 'transactions' : 'targets'} failed`;

    return `
      <tr style="background:#fff7f6;">
        <td colspan="${columns}" style="padding: 0 16px 14px; border-bottom: 1px solid #f0f2f5;">
          <div style="font-size:11.5px; color:${REPORT_COLORS.mutedInk}; margin-bottom:6px;">${caption}</div>
          <table style="width:100%; border-collapse:collapse; background:#ffffff; border:1px solid #f3d7d3; border-radius:6px;">
            <thead><tr>${head.map((h, i) => {
              const align = i === 0 ? 'left' : i === head.length - 1 ? 'center' : 'right';
              return `<th style="padding:6px 10px; font-size:10px; text-transform:uppercase; letter-spacing:0.05em; color:${REPORT_COLORS.mutedInk}; text-align:${align};">${h}</th>`;
            }).join('')}</tr></thead>
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
      if (min != null) {
        // The per-transaction thresholds are in the rows below, and they can differ per
        // transaction — naming one of them up here would be a half-truth.
        return `≥ ${min} Apdex for all transactions`;
      }
    }
    return this.formatRequirement(
      result.requirement_operator,
      result.requirement_value,
      result.metric_unit,
      this.requirementSubject(result),
    );
  }

  private toNumber(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Format requirement operator and value into human-readable text
   */
  /**
   * Human-readable requirement, worded as the SLO card words it: the statistic the check
   * evaluates, the comparison, and the threshold — "Maximum value should be greater than 90 %".
   * The statistic matters: "> 90 %" alone leaves the reader guessing whether the maximum, the
   * mean or a percentile was measured.
   */
  private formatRequirement(
    operator: string | null,
    value: number | null,
    unit: string | null,
    subject: string,
  ): string {
    if (!operator || value == null) return 'No requirement';

    const operatorLabels: Record<string, string> = {
      lt: 'should be less than', '<': 'should be less than',
      le: 'should be less than or equal to', lte: 'should be less than or equal to', '<=': 'should be less than or equal to',
      gt: 'should be greater than', '>': 'should be greater than',
      ge: 'should be greater than or equal to', gte: 'should be greater than or equal to', '>=': 'should be greater than or equal to',
      eq: 'should equal', '=': 'should equal', '==': 'should equal',
      ne: 'should not equal', '!=': 'should not equal',
    };
    const comparison = operatorLabels[operator] ?? `should ${operator}`;
    return `${subject} ${comparison} ${formatValueWithUnit(value, unit ?? undefined)}`;
  }

  /**
   * What the requirement is *about*: the statistic the check evaluates. Mirrors the SLO
   * card's map, plus `mean` — the checker's own name for an average, which the card leaves
   * as a bare "Value".
   */
  private requirementSubject(result: SloCheckResult): string {
    const req = result.requirement ?? {};
    const aggregateStat = typeof req.aggregate_stat === 'string' ? req.aggregate_stat : '';
    if (aggregateStat) return aggregateStat.toUpperCase();

    const statLabels: Record<string, string> = {
      avg: 'Average value',
      mean: 'Average value',
      max: 'Maximum value',
      min: 'Minimum value',
      last: 'Last value',
      sum: 'Sum value',
      count: 'Count value',
      median: 'Median value',
      q50: '50th percentile',
      q90: '90th percentile',
      q95: '95th percentile',
      q99: '99th percentile',
    };
    return statLabels[result.evaluate_type] ?? 'Value';
  }
}
