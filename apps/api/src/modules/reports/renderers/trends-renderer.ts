import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, TrendRunSummary, MetricTrendSeries } from '../services/report-data-fetcher.service';
import { buildSelections } from './section-selections';
import { formatValueWithUnit } from './unit-format';
import {
  REPORT_COLORS,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  chip,
  groupHeader,
  sectionHeader,
  sectionText,
  deltaChip,
  deltaText,
  emptyState,
  formatInt,
  formatNum,
  formatPercent,
  markerChip,
  pill,
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
    // timeRange.runCount is the older key; the form now picks where the window starts.
    const runCount = (config.timeRange as { runCount?: unknown } | undefined)?.runCount ?? config.maxRuns;
    const maxRuns = typeof runCount === 'number' ? runCount : 10;
    const oldestTestRunId = typeof config.oldestTestRunId === 'string' && config.oldestTestRunId
      ? config.oldestTestRunId
      : undefined;

    if (!testRun) {
      return this.renderNoDataSection(title, text, 'No test run data available for trends analysis.');
    }

    const trendsData = await this.dataFetcher.getTrendsData(testRun, maxRuns, userId, roles, oldestTestRunId);

    if (!trendsData || trendsData.previousRuns.length === 0) {
      return this.renderNoDataSection(title, text, 'No previous runs found for trend comparison. Trends require at least two completed runs with the same system, environment, and workload.');
    }

    // All runs in chronological order (oldest first)
    const allRuns = [...trendsData.previousRuns].reverse();
    allRuns.push(trendsData.currentRun);

    const previousRun = trendsData.previousRuns[0]!;
    const currentRun = trendsData.currentRun;

    // The aggregated run-level trend leads every trends section — it is the answer to
    // "did this get slower", and the per-dashboard tables below only explain it.
    const selections = buildSelections(config);
    const series = selections.length
      ? await this.dataFetcher.getMetricTrends(allRuns.map((r) => r.testRunId), selections)
      : [];

    return `
      <section class="trends-section">
        ${sectionHeader(title, { kicker: `${formatInt(allRuns.length)} runs compared` })}

        ${sectionText(text)}

        <h3 style="margin: 24px 0 16px 0; font-size: 10pt; font-weight: 700; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em;">Aggregated Performance Trends</h3>
        ${this.renderTrendSummaryCards(currentRun, previousRun)}

        <!-- Historical Runs Table -->
        <h3 style="margin: 32px 0 16px 0; font-size: 10pt; font-weight: 700; color: ${REPORT_COLORS.mutedInk}; text-transform: uppercase; letter-spacing: 0.05em;">Run History</h3>
        ${this.renderRunHistoryTable([...allRuns].reverse(), currentRun.testRunId)}

        ${this.renderDashboardTrends(series, allRuns)}
      </section>
    `;
  }

  /**
   * One table per selected dashboard: a row per series, a column per run (oldest first),
   * and the change across the whole window.
   *
   * Run columns are labelled with the run id's trailing token — the full ids and dates are
   * in the Run History table directly above, so repeating them here would cost a third of
   * the page width per column.
   */
  private renderDashboardTrends(series: MetricTrendSeries[], runs: TrendRunSummary[]): string {
    if (series.length === 0) return '';

    // Grouped the way the comparison section groups: a dashboard heads the block, each of its
    // panels heads its own table. Two dashboards with a "CPU" panel stay apart, and a panel's
    // name is not repeated down a column.
    const byDashboard = new Map<string, Map<string, MetricTrendSeries[]>>();
    for (const s of series) {
      const panels = byDashboard.get(s.dashboardLabel) ?? new Map<string, MetricTrendSeries[]>();
      const arr = panels.get(s.panelTitle || 'Other') ?? [];
      arr.push(s);
      panels.set(s.panelTitle || 'Other', arr);
      byDashboard.set(s.dashboardLabel, panels);
    }

    const shortLabel = (testRunId: string, idx: number) => {
      const tail = testRunId.split('-').pop();
      return tail && tail.length <= 8 ? tail : `#${idx + 1}`;
    };
    // The run being reported on is marked in its own column header, the way the Run History
    // table marks its row — otherwise the reader has to count columns to find it.
    const currentTestRunId = runs[runs.length - 1]?.testRunId;
    const runHeaders = runs.map((r, i) => `<th style="${TH_NUM}">${this.utils.escapeHtml(shortLabel(r.testRunId, i))}${
      r.testRunId === currentTestRunId ? ` ${markerChip('Current', 'info')}` : ''
    }</th>`).join('');

    return [...byDashboard.entries()].map(([dashboard, panels]) => {
      const dashboardSeries = [...panels.values()].reduce((n, rows) => n + rows.length, 0);

      const panelBlocks = [...panels.entries()].map(([panel, rows]) => {
        // ponytail: 50 series per panel, then a count — an unfiltered panel is 100s.
        const shown = rows.slice(0, 50);
        const rest = rows.length - shown.length;

        const body = shown.map((s, idx) => {
          const values = runs.map((r) => s.valuesByRun[r.testRunId] ?? null);
          // Against the run before this one, not the oldest in the window: that is the
          // comparison a reader makes when a number moved, and the one the summary cards
          // at the top of the section already use.
          const measured = values.filter((v): v is number => v != null);
          const last = measured[measured.length - 1] ?? null;
          const previous = measured[measured.length - 2] ?? null;
          const change = previous != null && previous !== 0 && last != null
            ? ((last - previous) / Math.abs(previous)) * 100
            : null;
          const cells = values.map((v) => {
            const formatted = v == null ? '—' : formatValueWithUnit(v, s.unit ?? undefined);
            return `<td style="padding:8px 10px; text-align:right; font-size:11px; font-variant-numeric:tabular-nums; border-bottom:1px solid ${REPORT_COLORS.rowBorder};">${this.utils.escapeHtml(formatted === '-' ? '—' : formatted)}</td>`;
          }).join('');
          return `<tr style="background:${idx % 2 === 1 ? '#fbfcfd' : '#ffffff'};">
            <td style="padding:8px 10px; font-size:11.5px; color:${REPORT_COLORS.ink}; font-weight:600; border-bottom:1px solid ${REPORT_COLORS.rowBorder};">${this.utils.escapeHtml(s.metricName)}</td>
            ${cells}
            <td style="padding:8px 10px; text-align:right; border-bottom:1px solid ${REPORT_COLORS.rowBorder};">${deltaText(change)}</td>
          </tr>`;
        }).join('');

        return `<div style="margin-top:18px;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
            <h4 style="margin:0; font-size:13px; font-weight:700; color:${REPORT_COLORS.mutedInk}; text-transform:uppercase; letter-spacing:0.05em;">${this.utils.escapeHtml(panel)}</h4>
            ${chip(`${formatInt(rows.length)} series`, 'neutral')}
          </div>
          <div class="table-scroll">
            <table style="width:100%; border-collapse:collapse;">
            <thead><tr style="${THEAD_ROW}">
              <th style="${TH_TEXT}">Series</th>
              ${runHeaders}
              <th style="${TH_NUM}">Change</th>
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
          </div>
          ${rest > 0 ? `<div style="font-size:11px; color:${REPORT_COLORS.mutedInk}; margin-top:6px;">and ${formatInt(rest)} more series</div>` : ''}
        </div>`;
      }).join('\n');

      return `<div style="margin-top:32px;">
        ${groupHeader(dashboard, [
          chip(`${formatInt(panels.size)} panels`, 'neutral'),
          chip(`${formatInt(dashboardSeries)} series`, 'neutral'),
        ])}
        <div style="font-size:11.5px; color:${REPORT_COLORS.mutedInk}; margin:-6px 0 4px;">One column per run, oldest first. Change compares this run to the one before it.</div>
        ${panelBlocks}
      </div>`;
    }).join('\n');
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
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 24px 0;">
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

  /**
   * Newest run first: the run being reported on is the one the reader came for, and a
   * history that grows downwards puts it at the bottom of a table that only gets longer.
   * The per-panel trend tables keep their columns oldest-first — a series reads left to right.
   */
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
      const verdicts = this.verdicts(run);

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
          <td style="text-align: center;">${verdicts.slo}</td>
          <td style="text-align: center;">${verdicts.adapt}</td>
          <td style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk};">${
            run.annotations.length
              ? run.annotations.map((a) => this.utils.escapeHtml(a)).join('; ')
              : '-'
          }</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="table-scroll">
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
            <th style="text-align: center;">SLO</th>
            <th style="text-align: center;">Anomalies</th>
            <th>Annotations</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      </div>
    `;
  }

  /**
   * The run's two verdicts, as the run itself recorded them.
   *
   * `consolidated_result` already carries both — `meetsRequirement` for the SLO checks and
   * `adaptTestRunOK` for anomaly detection — so the history table costs no extra query.
   * A run evaluated before either check ran carries neither, and says so rather than
   * claiming a pass.
   */
  private verdicts(run: TrendRunSummary): { slo: string; adapt: string } {
    const result = (run.consolidatedResult ?? {}) as { meetsRequirement?: unknown; adaptTestRunOK?: unknown };
    const verdict = (value: unknown, okLabel: string, badLabel: string): string => {
      if (value === true) return pill(okLabel, 'good');
      if (value === false) return pill(badLabel, 'bad');
      return pill('N/A', 'neutral');
    };
    return {
      slo: verdict(result.meetsRequirement, 'PASS', 'FAIL'),
      adapt: verdict(result.adaptTestRunOK, 'OK', 'ANOMALIES'),
    };
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
