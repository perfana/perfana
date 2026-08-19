import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, BaselineComparisonRow } from '../services/report-data-fetcher.service';
import { buildSelections } from './section-selections';
import { bandColor, percentDiff, gatedDiffPercent, DiffThresholds } from './comparison-bands';
import {
  ACCENT,
  DEFAULT_THRESHOLDS,
  REPORT_COLORS,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  chip,
  sectionText,
  deltaChip,
  emptyState,
  escapeHtml,
  formatInt,
  formatNum,
  groupHeader,
  sectionHeader,
  splitHostLabel,
} from './report-style';

/**
 * The value a template stores when the baseline should follow the run being reported on rather
 * than being pinned to one particular run.
 *
 * A template is written once and generated from for months, so a fixed baseline id goes stale
 * the day after it is chosen — every nightly report keeps comparing against the same old run.
 * Storing this instead makes each report resolve its own predecessor at render time.
 */
import { PREVIOUS_RUN_BASELINE } from '@perfana/shared/types';
export { PREVIOUS_RUN_BASELINE };

/** The only metric keys the baseline-run comparison understands. */
const ALLOWED_BASELINE_METRICS = ['avg', 'p90', 'p95', 'p99'] as const;
type BaselineMetricKey = (typeof ALLOWED_BASELINE_METRICS)[number];

/**
 * Renderer for Comparisons section
 *
 * Displays side-by-side comparison of metrics between
 * this test run and a baseline run with:
 * - One table per scenario (performance metrics) or one merged table (grafana/dynatrace)
 * - Per-metric current vs baseline values with a banded delta chip (rules 01/02)
 * - An explicit empty state naming why a comparison could not be made
 */
@Injectable()
export class ComparisonsRenderer {
  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  /**
   * The baseline this report should compare against: whatever the template pinned, or the run
   * before this one when the template said to follow along.
   *
   * Returns undefined when there is no predecessor — the first run in a system, environment and
   * workload has nothing behind it, and the section then renders its existing empty state rather
   * than comparing a run against itself.
   */
  private async resolveBaseline(
    configured: unknown,
    testRun: TestRun | null,
  ): Promise<{ id?: string; reason?: string }> {
    if (typeof configured !== 'string' || configured === '') {
      return { reason: 'no baseline run is configured for this section.' };
    }
    if (configured !== PREVIOUS_RUN_BASELINE) {
      return { id: configured };
    }
    if (!testRun) {
      return { reason: 'this section was rendered without a test run.' };
    }
    const previous = await this.dataFetcher.getPreviousTestRun(testRun);
    return previous?.testRunId
      ? { id: previous.testRunId }
      : { reason: 'this is the first run for its system, environment and workload — there is no previous run behind it.' };
  }

  /**
   * Render the Comparisons section: this run against a baseline run.
   *
   * The old control-group mode (a table of ADAPT conclusions for this run) was dropped — it
   * answered a different question than the section's title promises and duplicated the
   * Regressions section, so there is only one mode left and no mode switch.
   */
  async renderComparisonsSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const config = section.config || {};
    const title = section.title || 'Comparisons';
    const text = getSectionText(section);
    const source = (config.source as 'performance-metrics' | 'grafana' | 'dynatrace') || 'performance-metrics';
    // SECURITY: config is user-supplied JSON — whitelist metric keys instead of
    // trusting a cast (they are interpolated into <th> markup below).
    const requestedMetrics = Array.isArray(config.metrics) ? config.metrics : [];
    const whitelisted = requestedMetrics.filter(
      (m): m is BaselineMetricKey => (ALLOWED_BASELINE_METRICS as readonly unknown[]).includes(m),
    );
    // Default set stays avg/p95/p99 — p90 is opt-in (added to ALLOWED_BASELINE_METRICS
    // so it's selectable, but not shown unless the user picks it).
    const metrics: BaselineMetricKey[] = whitelisted.length ? whitelisted : ['avg', 'p95', 'p99'];
    // SECURITY: coerce thresholds — only accept when BOTH fields are finite numbers.
    const rawThresholds = (config.thresholds ?? {}) as { good?: unknown; warning?: unknown; minAbsolute?: unknown };
    const goodT = Number(rawThresholds.good);
    const warningT = Number(rawThresholds.warning);
    const minAbsT = Number(rawThresholds.minAbsolute);
    const thresholds: DiffThresholds = {
      ...(Number.isFinite(goodT) && Number.isFinite(warningT)
        ? { good: goodT, warning: warningT }
        : DEFAULT_THRESHOLDS),
      minAbsolute: Number.isFinite(minAbsT) && minAbsT > 0 ? minAbsT : undefined,
    };
    const baseline = await this.resolveBaseline(config.baselineTestRunId, testRun);
    const baselineId = baseline.id;
    const dashboardMap = Array.isArray(config.dashboardMap)
      ? (config.dashboardMap as { current: string; baseline: string }[])
      : undefined;
    const selections = buildSelections(config);
    const selectedDashboards = [...new Set(selections.map((s) => s.dashboardLabel))];

    let data = testRun && baselineId
      ? await this.dataFetcher.getBaselineRunComparison(testRun.testRunId, baselineId, source,
          { metrics, userId, roles, dashboardMap, selections })
      : null;

    if (!data || data.rows.length === 0) {
      // Five ways to end up empty, one message each — a silent empty section is
      // indistinguishable from "nothing regressed", which is the opposite conclusion.
      const why = !testRun
        ? 'this section was rendered without a test run.'
        : baseline.reason
          ?? `baseline run ${baselineId} returned no metrics comparable with this run — check that it exists and collected ${source} data.`;
      return `<section class="comparisons-section">${sectionHeader(title)}
        ${sectionText(text)}
        ${emptyState(`No comparison data available: ${why}`)}</section>`;
    }

    // "All aggregated" row — run-wide aggregate across all transactions (perf-metrics only).
    if (source === 'performance-metrics' && config.includeAggregated === true && testRun && baselineId) {
      const [curS, baseS] = await Promise.all([
        this.dataFetcher.getAggregatedScalars(testRun.testRunId, userId, roles),
        this.dataFetcher.getAggregatedScalars(baselineId, userId, roles),
      ]);
      const byKey: Record<BaselineMetricKey, [number | null, number | null]> = {
        avg: [curS.avg, baseS.avg],
        p90: [curS.p90, baseS.p90],
        p95: [curS.p95, baseS.p95],
        p99: [curS.p99, baseS.p99],
      };
      const aggRow: BaselineComparisonRow = {
        group: 'All aggregated',
        label: 'All aggregated',
        metrics: metrics.map((k) => {
          const [cv, bv] = byKey[k];
          return { key: k, current: cv, baseline: bv, diffPercent: percentDiff(cv, bv) };
        }),
      };
      data = { ...data, rows: [aggRow, ...data.rows] };
    }

    // Effective diff after the minimum-absolute-change gate (thresholds.minAbsolute).
    const effDiff = (m: { current: number | null; baseline: number | null; diffPercent: number | null }): number | null =>
      gatedDiffPercent(m.current, m.baseline, m.diffPercent, thresholds.minAbsolute);

    // Rank a band color for row accents / worst-of-row aggregation.
    const rankFor = (hex: string): number =>
      hex === REPORT_COLORS.dot.bad ? 2 : hex === REPORT_COLORS.dot.warn ? 1 : 0;
    const worstRank = (row: BaselineComparisonRow): number =>
      row.metrics.reduce((mx, m) => Math.max(mx, rankFor(bandColor(effDiff(m), thresholds))), 0);
    const accent = (rank: number): string =>
      (rank === 2 ? REPORT_COLORS.dot.bad : rank === 1 ? REPORT_COLORS.dot.warn : REPORT_COLORS.dot.good);
    const rowBackground = (rank: number, idx: number): string =>
      (rank === 2 ? '#fff7f6' : (idx % 2 === 1 ? '#fbfcfd' : '#ffffff'));

    const renderCell = (m: { current: number | null; baseline: number | null; diffPercent: number | null }, leftBorder: boolean): string => {
      const d = effDiff(m);
      const dot = bandColor(d, thresholds);
      let left = 50, width = 0;
      if (d != null) {
        const mag = Math.min(Math.abs(d), 100) / 2; // 100% diff fills half the track
        if (d >= 0) { left = 50; width = mag; } else { width = mag; left = 50 - mag; }
      }
      return `<td style="padding:14px 16px; border-bottom:1px solid ${REPORT_COLORS.rowBorder};${leftBorder ? ' border-left:1px solid #eef1f5;' : ''}">
        <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
          <div style="display:flex; align-items:baseline; gap:8px;">
            <span style="font-size:15px; font-weight:700; color:${REPORT_COLORS.ink}; font-variant-numeric:tabular-nums;">${formatNum(m.current)}</span>
            <span style="font-size:12px; font-weight:600; color:${REPORT_COLORS.mutedInk}; font-variant-numeric:tabular-nums;">vs ${formatNum(m.baseline)}</span>
          </div>
          ${deltaChip(d, thresholds)}
          <div style="position:relative; width:110px; height:4px; border-radius:2px; background:#edf0f3;">
            <div style="position:absolute; left:50%; top:-2px; width:1px; height:8px; background:#ccd0d6;"></div>
            <div style="position:absolute; top:0; height:100%; border-radius:2px; left:${left}%; width:${width}%; background:${dot};"></div>
          </div>
        </div></td>`;
    };

    const summaryChips = (reg: number, warn: number, ok: number): string[] => [
      reg > 0 ? chip(`${reg} regressions`, 'bad') : '',
      warn > 0 ? chip(`${warn} warnings`, 'warn') : '',
      ok > 0 ? chip(`${ok} within range`, 'good') : '',
    ];

    // Name the two runs being compared explicitly, so the report is unambiguous
    // when read out of context (current run vs the chosen baseline run id).
    // Wording deliberately avoids a bare ">Current</span>"/">Baseline</span>" token —
    // that's the mapping-caption signature the renderer tests key on.
    const runIds = `<div style="font-size:12.5px; color:${REPORT_COLORS.mutedInk}; margin-top:6px;">
      Comparing current run <strong style="color:${REPORT_COLORS.ink}; font-weight:600;">${escapeHtml(testRun?.testRunId ?? '')}</strong>
      against baseline run <strong style="color:${REPORT_COLORS.ink}; font-weight:600;">${escapeHtml(baselineId ?? '')}</strong>
    </div>`;

    const minAbsNote = thresholds.minAbsolute != null
      ? `<span style="display:inline-flex; align-items:center; gap:6px;">changes &lt; ${formatNum(thresholds.minAbsolute)} treated as none</span>`
      : '';

    const legend = `<div style="font-size:12.5px; color:${REPORT_COLORS.mutedInk}; margin-top:12px; display:flex; align-items:center; gap:20px; flex-wrap:wrap;">
      <span>Each cell shows <strong style="color:${REPORT_COLORS.ink}; font-weight:600;">current</strong> &#183; vs baseline &#183; &#916;%. Bar shows regression magnitude.</span>
      <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:${REPORT_COLORS.dot.good};"></span> &#8804; ${thresholds.good}%</span>
      <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:${REPORT_COLORS.dot.warn};"></span> ${thresholds.good}&#8211;${thresholds.warning}%</span>
      <span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:${REPORT_COLORS.dot.bad};"></span> &gt; ${thresholds.warning}%</span>
      ${minAbsNote}
    </div>`;

    let bodyHtml: string;

    // ---- DYNATRACE / GRAFANA source: ONE merged table (single-source) ----
    // A single "Metric" column (there is only ever one host per section). For
    // Dynatrace the host-id prefix is stripped and the host NAME becomes a chip
    // next to the heading ("HOST-123_afterburner-be_Memory Usage" -> heading
    // "Dynatrace" + host chip "afterburner-be", metric "Memory Usage"). Grafana
    // labels have no host prefix, so the label is used as-is and the heading is "Grafana".
    if (source === 'dynatrace' || source === 'grafana') {
      const hasHost = source === 'dynatrace';
      let hostName = '';
      let reg = 0, warn = 0, ok = 0;

      const rowsHtml = data.rows.map((row, idx) => {
        const rank = worstRank(row);
        if (rank === 2) reg++; else if (rank === 1) warn++; else ok++;
        const cells = row.metrics.map((m) => renderCell(m, true)).join('');
        let metric = row.label;
        if (hasHost) {
          const parsed = splitHostLabel(row.label);
          if (parsed.host) hostName = parsed.host;
          metric = parsed.metric;
        }
        return `<tr style="background:${rowBackground(rank, idx)};">
          <td style="padding:14px 14px 14px 12px; border-left:3px solid ${accent(rank)}; border-bottom:1px solid ${REPORT_COLORS.rowBorder}; font-size:13px; color:${REPORT_COLORS.ink}; font-weight:600; white-space:nowrap; vertical-align:top;">${this.utils.escapeHtml(metric)}</td>
          ${cells}</tr>`;
      }).join('');

      const heading = source === 'dynatrace' ? 'Dynatrace' : 'Grafana';
      const headingChips = [
        hasHost && hostName ? chip(hostName, 'info') : '',
        chip(`${formatInt(data.rows.length)} metrics`, 'neutral'),
      ];
      const metricHeaders = metrics.map((k) => `<th style="${TH_NUM} border-left:1px solid #eef1f5;">${escapeHtml(k.toUpperCase())}</th>`).join('');

      // Dashboard-mapping caption: when the comparison pairs a current-run
      // dashboard with a differently named baseline dashboard, say so —
      // "Current <dash> → Baseline <dash>" chips under the heading. Scoped to
      // the selected dashboard's pair; unscoped sections show every differing pair.
      const activePairs = (dashboardMap ?? [])
        .filter((p) => p.current && p.baseline && p.current !== p.baseline)
        .filter((p) => selectedDashboards.length === 0 || selectedDashboards.includes(p.current));
      const mappingCaption = activePairs.length === 0 ? '' : activePairs.map((p) =>
        `<div style="display:flex; align-items:center; gap:12px; margin:-2px 0 16px; font-size:12px;">
          <span style="display:inline-flex; align-items:center; gap:7px; padding:5px 12px; border-radius:8px; background:#f1f6ff; border:1px solid #d6e4fb;">
            <span style="width:8px; height:8px; border-radius:50%; background:${ACCENT};"></span>
            <span style="text-transform:uppercase; letter-spacing:0.05em; font-size:10.5px; font-weight:700; color:#5b6470;">Current</span>
            <span style="font-weight:600; color:#1f2933;">${this.utils.escapeHtml(p.current)}</span>
          </span>
          <span style="color:#b6bcc4; font-size:15px;">&rarr;</span>
          <span style="display:inline-flex; align-items:center; gap:7px; padding:5px 12px; border-radius:8px; background:#f6f7f9; border:1px solid #e6e8ec;">
            <span style="width:8px; height:8px; border-radius:50%; background:#9aa2ab;"></span>
            <span style="text-transform:uppercase; letter-spacing:0.05em; font-size:10.5px; font-weight:700; color:${REPORT_COLORS.faintInk};">Baseline</span>
            <span style="font-weight:600; color:#4b5563;">${this.utils.escapeHtml(p.baseline)}</span>
          </span>
        </div>`).join('');

      bodyHtml = `<div style="margin-top:30px;">
        ${groupHeader(heading, headingChips, summaryChips(reg, warn, ok))}
        ${mappingCaption}
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="${THEAD_ROW}">
            <th style="${TH_TEXT}">Metric</th>
            ${metricHeaders}
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
    } else {
      // ---- performance-metrics source: grouped by scenario, transaction rows ----
      const groups = new Map<string, BaselineComparisonRow[]>();
      for (const r of data.rows) {
        const arr = groups.get(r.group) ?? [];
        arr.push(r);
        groups.set(r.group, arr);
      }
      const metricHeaders = metrics.map((k, i) => `<th style="${TH_NUM}${i > 0 ? ' border-left:1px solid #eef1f5;' : ''}">${escapeHtml(k.toUpperCase())}</th>`).join('');

      bodyHtml = Array.from(groups.entries()).map(([group, rows]) => {
        let reg = 0, warn = 0, ok = 0;
        const body = rows.map((row, idx) => {
          const rank = worstRank(row);
          if (rank === 2) reg++; else if (rank === 1) warn++; else ok++;
          const cells = row.metrics.map((m, gi) => renderCell(m, gi > 0)).join('');
          return `<tr style="background:${rowBackground(rank, idx)};">
            <td style="padding:14px 14px 14px 12px; border-left:3px solid ${accent(rank)}; border-bottom:1px solid ${REPORT_COLORS.rowBorder}; font-size:13px; color:#374151; font-weight:500; white-space:nowrap; vertical-align:top;">${this.utils.escapeHtml(row.label)}</td>
            ${cells}</tr>`;
        }).join('');

        return `<div style="margin-top:38px;">
          ${groupHeader(group, [chip(`${formatInt(rows.length)} transactions`, 'neutral')], summaryChips(reg, warn, ok))}
          <table style="width:100%; border-collapse:collapse;">
            <thead><tr style="${THEAD_ROW}">
              <th style="${TH_TEXT}">Transaction</th>
              ${metricHeaders}
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>`;
      }).join('\n');
    }

    return `<section class="comparisons-section">
      ${sectionHeader(title)}
      ${runIds}
      ${sectionText(text)}
      ${legend}
      ${bodyHtml}
    </section>`;
  }
}
