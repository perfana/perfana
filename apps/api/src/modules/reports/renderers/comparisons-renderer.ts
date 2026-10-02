import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import {
  BaselineComparisonRow,
  MetricsTimeSeriesPanel,
  ReportDataFetcherService,
} from '../services/report-data-fetcher.service';
import { ChartSeries, ChartSvgService, NO_WINDOW } from './chart-svg.service';
import { buildSelections } from './section-selections';
import { bandColor, gatedDiffPercent, DiffThresholds } from './comparison-bands';
import {
  ACCENT,
  BAND_FOR_RANK,
  DEFAULT_THRESHOLDS,
  REPORT_COLORS,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  bandFilterChip,
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
import { toUnitScale, unitLabel } from './unit-format';

/**
 * The value a template stores when the baseline should follow the run being reported on rather
 * than being pinned to one particular run.
 *
 * A template is written once and generated from for months, so a fixed baseline id goes stale
 * the day after it is chosen — every nightly report keeps comparing against the same old run.
 * Storing this instead makes each report resolve its own predecessor at render time.
 */
import { PREVIOUS_RUN_BASELINE, PREVIOUS_SUCCESSFUL_RUN_BASELINE } from '@perfana/shared/types';
export { PREVIOUS_RUN_BASELINE, PREVIOUS_SUCCESSFUL_RUN_BASELINE };

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
    private readonly chartSvg: ChartSvgService,
  ) {}

  /**
   * How many rows get a graph. One chart is one inline SVG in a document that is also
   * stored in Postgres and turned into a PDF, so the section charts the rows a reader
   * would look at — the ones outside the good band, worst first — and stops. Charting
   * everything on a 400-row comparison is how a report becomes megabytes.
   */
  private static readonly MAX_ROW_CHARTS = 20;

  /** Enough to read a shape, small enough to stack twenty of them. */
  private static readonly ROW_CHART = { width: 900, height: 260 };

  /** `dashboard\u0000panel\u0000metric` — how a chart is matched back to its table row. */
  private static rowKey(r: BaselineComparisonRow): string {
    return `${r.dashboardLabel ?? ''}\u0000${r.panelId ?? ''}\u0000${r.label}`;
  }

  /**
   * Current-vs-baseline graphs for the rows that moved, as one collapsed `<details>` per
   * row, keyed by `rowKey` so the caller can put each one under the row it belongs to.
   *
   * It goes in a DETAIL ROW — `<tr><td colspan=N>` immediately after the data row — not in
   * a block after the table. `report-interactivity.ts` recognises a single-cell spanning
   * row as belonging to the row above it (`collectUnits`), so the graph travels with its
   * row when a column is sorted and hides with it when a band chip or the filter box
   * excludes it. The SLO section's failing-targets block is the same shape. A block after
   * the table would have been detached from the row it describes the moment anyone sorted.
   *
   * `<details>` and not a script: the in-app viewer and the public share page render the
   * report in an iframe with no `allow-scripts` (see `report-interactivity.ts`), so a
   * JS-driven expander would be dead in the two places people actually read reports.
   * Native disclosure works in that sandbox with no permissions at all.
   *
   * Only rows carrying a dashboard AND a panel can be charted: those identify the series
   * for `getMetricsTimeSeries`. The perf-test fallback path pairs rows straight out of
   * `transactions` by scenario and transaction name and carries neither, so that shape
   * silently gets no graphs rather than wrong ones.
   */
  private async renderRowCharts(
    rows: BaselineComparisonRow[],
    testRun: TestRun,
    baselineId: string,
    dashboardMap: { current: string; baseline: string }[] | undefined,
    userId: string,
    roles: string[],
  ): Promise<Map<string, string>> {
    const charts = new Map<string, string>();
    const chartable = rows.filter((r) => r.dashboardLabel && r.panelId != null && r.label);
    if (chartable.length === 0) return charts;

    // The baseline's own dashboard name, which a dashboardMap can make different from the
    // current run's — the whole point of that mapping. Selecting the baseline series by the
    // current name would return nothing and the graph would show one line.
    const baselineDashboard = (current: string): string =>
      (dashboardMap ?? []).find((m) => m.current === current)?.baseline ?? current;

    /**
     * Identify the panel by ID, and send the title only to be echoed back.
     *
     * The row's `panelTitle` is a DISPLAY name: `perfPanelTitle` collapses
     * `Transaction RT Avg/P90/P95/P99` into one `Transaction RT`, which matches no stored
     * panel_title at all — selecting on it returned nothing and every graph silently
     * vanished. The id filters; `key` is what pairs the result back to its row, because the
     * echoed title cannot (all four of those panels echo the same one).
     */
    const selector = (r: BaselineComparisonRow, dashboard: string) => ({
      dashboardLabel: dashboard,
      // A panel id belongs to ONE dashboard. Where a dashboardMap sends the baseline to a
      // differently named dashboard, the current run's id identifies nothing there, and the
      // id wins over the title in the fetcher — so the mapped side goes by title alone, and
      // a perf-test panel (whose title is a display rename) simply gets no baseline line.
      panelId: baselineDashboard(r.dashboardLabel!) === dashboard ? r.panelId : undefined,
      panelTitle: r.panelTitle ?? undefined,
      metricName: r.label,
      key: ComparisonsRenderer.rowKey(r),
    });

    // Two round trips per row, both batched into one await each. `getMetricsTimeSeries`
    // issues one query per selector, so this is 2N queries for N charted rows — bounded by
    // MAX_ROW_CHARTS, which is what keeps that number small.
    const [current, baseline] = await Promise.all([
      this.dataFetcher.getMetricsTimeSeries(
        testRun.testRunId,
        chartable.map((r) => selector(r, r.dashboardLabel!)),
        false, userId, roles,
      ),
      this.dataFetcher.getMetricsTimeSeries(
        baselineId,
        chartable.map((r) => selector(r, baselineDashboard(r.dashboardLabel!))),
        false, userId, roles,
      ),
    ]);

    // Paired on the echoed `key`, never on the echoed fields: `perfPanelTitle` collapses
    // panels 101-104 to one display title, so a (dashboard, title, metric) key puts all four
    // of a transaction's rows on whichever one came back last.
    const index = (panels: MetricsTimeSeriesPanel[]) =>
      new Map(panels.filter((p) => p.key).map((p) => [p.key!, p]));
    const curBy = index(current);
    const baseBy = index(baseline);

    /**
     * Both runs on one x axis, measured from each run's own first point.
     *
     * Two runs happened at two different times, so plotting absolute clocks would put them
     * side by side instead of on top of each other. Rebasing to elapsed time is what makes
     * the comparison readable — and it is what the Compare card's chart does.
     */
    const rebase = (panel: MetricsTimeSeriesPanel): MetricsTimeSeriesPanel => {
      // `getMetricsTimeSeries` orders by time, so the first point is the earliest. Spreading
      // every timestamp into `Math.min` would blow the argument limit on a long run.
      const t0 = panel.dataPoints[0]?.time.getTime() ?? 0;
      return {
        ...panel,
        dataPoints: panel.dataPoints.map((dp) => ({ ...dp, time: new Date(dp.time.getTime() - t0) })),
      };
    };

    for (const r of chartable) {
      const cur = curBy.get(ComparisonsRenderer.rowKey(r));
      const base = baseBy.get(ComparisonsRenderer.rowKey(r));
      const series: ChartSeries[] = [];
      // Current first, so it takes the solid line and the first colour slot.
      if (cur) series.push({ ...rebase(cur), color: ACCENT });
      if (base) series.push({ ...rebase(base), color: REPORT_COLORS.mutedInk, dashed: true });
      if (series.length === 0) continue;
      const chart = this.chartSvg.renderTimeSeriesChart(
        [r.dashboardLabel, r.panelTitle, r.label].filter(Boolean).join(' · '),
        series,
        0,
        ComparisonsRenderer.ROW_CHART.width,
        ComparisonsRenderer.ROW_CHART.height,
        // No window shading: the two runs have their own analysis ranges, and shading one
        // of them over both would label the other run's data with a window it never had.
        NO_WINDOW,
        true,
        { xLabelOf: (dp) => `${Math.round(dp.time.getTime() / 60000)}m` },
      );
      // The summary is the whole row's width and says what the graph is; the row above
      // already names the metric, so this only has to say "graph" and flag a missing
      // baseline.
      charts.set(ComparisonsRenderer.rowKey(r), `<details style="margin:0;">
        <summary style="cursor:pointer; font-size:12px; color:${REPORT_COLORS.mutedInk};">
          Graph &middot; current solid, baseline dashed, both from their own start
          ${base ? '' : '<span style="color:' + REPORT_COLORS.faintInk + ';"> &mdash; baseline has no series for this metric</span>'}
        </summary>
        <div style="padding:8px 0 4px;">${chart}</div>
      </details>`);
    }

    return charts;
  }

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
    const sloPassedOnly = configured === PREVIOUS_SUCCESSFUL_RUN_BASELINE;
    if (configured !== PREVIOUS_RUN_BASELINE && !sloPassedOnly) {
      return { id: configured };
    }
    if (!testRun) {
      return { reason: 'this section was rendered without a test run.' };
    }
    const previous = await this.dataFetcher.getPreviousTestRun(testRun, { sloPassedOnly });
    if (previous?.testRunId) return { id: previous.testRunId };
    const firstRun =
      'this is the first run for its system, environment and workload — there is no previous run behind it.';
    if (!sloPassedOnly) return { reason: firstRun };
    // A run whose SLOs were never evaluated has no `meetsRequirement` key, so the
    // SLO-passed query skips it exactly as it skips a run that failed. Saying "none passed"
    // for the first case asserts they FAILED — the opposite conclusion, in a document that
    // is served unauthenticated over share links. Ask which of the three it actually was.
    const miss = await this.dataFetcher.previousRunSloMiss(testRun);
    return {
      reason:
        miss === 'none'
          ? firstRun
          : miss === 'not-evaluated'
            ? 'earlier runs exist for its system, environment and workload, but none of them had its SLOs evaluated — so none could be selected as a known-good baseline.'
            : 'no earlier run for its system, environment and workload passed its SLOs.',
    };
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
    // Default set: avg/p90/p95. p99 is opt-in — it is the noisiest column of the four and
    // the one most often read as a regression when it is a single slow request.
    const metrics: BaselineMetricKey[] = whitelisted.length ? whitelisted : ['avg', 'p90', 'p95'];
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

    const data = testRun && baselineId
      ? await this.dataFetcher.getBaselineRunComparison(testRun.testRunId, baselineId, source,
          { metrics, userId, roles, dashboardMap, selections })
      : null;
    const hostLabels = await this.dataFetcher.getDynatraceHostLabels(testRun);

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

    // Effective diff after the minimum-absolute-change gate (thresholds.minAbsolute).
    // The row's unit codes go in too: the gate is a threshold the user typed against the
    // rendered numbers, so it has to be applied to the scaled pair, not the stored one.
    const effDiff = (
      m: { current: number | null; baseline: number | null; diffPercent: number | null },
      unit?: string | null,
      baselineUnit?: string | null,
    ): number | null =>
      gatedDiffPercent(m.current, m.baseline, m.diffPercent, thresholds.minAbsolute, unit, baselineUnit);

    // Rank a band color for row accents / worst-of-row aggregation.
    const rankFor = (hex: string): number =>
      hex === REPORT_COLORS.dot.bad ? 2 : hex === REPORT_COLORS.dot.warn ? 1 : 0;
    const worstRank = (row: BaselineComparisonRow): number =>
      row.metrics.reduce(
        (mx, m) => Math.max(mx, rankFor(bandColor(effDiff(m, row.unit, row.baselineUnit), thresholds))),
        0,
      );
    const accent = (rank: number): string =>
      (rank === 2 ? REPORT_COLORS.dot.bad : rank === 1 ? REPORT_COLORS.dot.warn : REPORT_COLORS.dot.good);
    const rowBackground = (rank: number, idx: number): string =>
      (rank === 2 ? '#fff7f6' : (idx % 2 === 1 ? '#fbfcfd' : '#ffffff'));

    // Values are BARE — the unit is printed once in the heading above the table, not repeated
    // on every number in every cell. The scaling still has to happen here, though: `percentunit`
    // is stored 0.0-1.0, and an unscaled 0.42 sitting under a "%" heading is simply wrong.
    const scaled = (v: number | null, unit?: string | null): string =>
      (v == null ? formatNum(v) : formatNum(toUnitScale(v, unit ?? undefined)));

    /**
     * The one unit label every row under a heading shares, or '' when they do not share one.
     *
     * Printing the unit once means it has to be true of EVERY row it sits above. Rows pair on
     * dashboard/panel/metric name, which excludes the unit, so a group CAN hold an `s` row next
     * to an `ms` one — and there the honest thing is no chip at all rather than one row's unit
     * implied over the rest. `unitLabel` yields '' for a unitless or unrecognised code, which
     * collapses to the same "say nothing" outcome.
     */
    const sharedUnitLabel = (rows: BaselineComparisonRow[]): string => {
      const labels = new Set(rows.map((r) => unitLabel(r.unit)));
      return labels.size === 1 ? [...labels][0] ?? '' : '';
    };

    /** The heading's unit chip, or '' — groupHeader/panel headings drop empty strings. */
    const unitChip = (rows: BaselineComparisonRow[]): string => {
      const label = sharedUnitLabel(rows);
      return label ? chip(label, 'neutral') : '';
    };

    const renderCell = (
      m: { current: number | null; baseline: number | null; diffPercent: number | null },
      leftBorder: boolean,
      unit?: string | null,
      baselineUnit?: string | null,
    ): string => {
      const d = effDiff(m, unit, baselineUnit);
      const dot = bandColor(d, thresholds);
      let left = 50, width = 0;
      if (d != null) {
        const mag = Math.min(Math.abs(d), 100) / 2; // 100% diff fills half the track
        if (d >= 0) { left = 50; width = mag; } else { width = mag; left = 50 - mag; }
      }
      return `<td style="padding:14px 16px; border-bottom:1px solid ${REPORT_COLORS.rowBorder};${leftBorder ? ' border-left:1px solid #eef1f5;' : ''}">
        <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
          <div style="display:flex; align-items:baseline; gap:8px;">
            <span style="font-size:15px; font-weight:700; color:${REPORT_COLORS.ink}; font-variant-numeric:tabular-nums;">${escapeHtml(scaled(m.current, unit))}</span>
            <span style="font-size:12px; font-weight:600; color:${REPORT_COLORS.mutedInk}; font-variant-numeric:tabular-nums;">vs ${escapeHtml(scaled(m.baseline, baselineUnit ?? unit))}</span>
          </div>
          ${deltaChip(d, thresholds)}
          <div style="position:relative; width:110px; height:4px; border-radius:2px; background:#edf0f3;">
            <div style="position:absolute; left:50%; top:-2px; width:1px; height:8px; background:#ccd0d6;"></div>
            <div style="position:absolute; top:0; height:100%; border-radius:2px; left:${left}%; width:${width}%; background:${dot};"></div>
          </div>
        </div></td>`;
    };

    // Label column. `white-space:nowrap` used to be here: one long URL then blew the column
    // out past the page and the value columns scrolled out of sight, so the table read as a
    // single column. `overflow-wrap:anywhere` lets a URL fold instead.
    const labelCell = (label: string, rank: number, url?: string): string =>
      `<td style="padding:14px 14px 14px 12px; border-left:3px solid ${accent(rank)}; border-bottom:1px solid ${REPORT_COLORS.rowBorder}; font-size:13px; color:${REPORT_COLORS.ink}; font-weight:600; vertical-align:top; max-width:320px; overflow-wrap:anywhere; word-break:break-word;">
        ${this.utils.escapeHtml(label)}
        ${url ? `<div style="margin-top:3px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10.5px; font-weight:400; color:${REPORT_COLORS.faintInk}; overflow-wrap:anywhere; word-break:break-word;">${this.utils.escapeHtml(url)}</div>` : ''}
      </td>`;

    // These double as the group's band filters once the report's interactivity
    // script runs; without it they are the same count chips as before.
    const summaryChips = (reg: number, warn: number, ok: number): string[] => [
      reg > 0 ? bandFilterChip(`${reg} regressions`, 'bad', 'regression') : '',
      warn > 0 ? bandFilterChip(`${warn} warnings`, 'warn', 'warning') : '',
      ok > 0 ? bandFilterChip(`${ok} within range`, 'good', 'ok') : '',
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

    // Opt-in: one SVG per row in a document that is stored, shared and printed, so the
    // author asks for it. Off keeps the section byte-for-byte what it was.
    const rowCharts = config.showRowGraphs === true && testRun && baselineId
      ? await this.renderRowCharts(
          data.rows
            // Only what moved — a row inside the good band has nothing for a reader to see.
            .filter((r) => worstRank(r) > 0)
            .sort((a, b) => worstRank(b) - worstRank(a))
            .slice(0, ComparisonsRenderer.MAX_ROW_CHARTS),
          testRun,
          baselineId,
          dashboardMap,
          userId,
          roles,
        )
      : new Map<string, string>();

    /**
     * The graph's own row, under the row it belongs to.
     *
     * One cell spanning the table is what makes `report-interactivity.ts` treat it as a
     * DETAIL row of the one above (`collectUnits`): it then travels with that row through
     * a sort and hides with it through a filter. Two cells, or a colspan of 1, and it
     * becomes an independent row that a sort scatters.
     */
    const chartRow = (row: BaselineComparisonRow, background: string): string => {
      const chart = rowCharts.get(ComparisonsRenderer.rowKey(row));
      if (!chart) return '';
      return `<tr style="background:${background};"><td colspan="${metrics.length + 1}" style="padding:0 16px 12px; border-bottom:1px solid ${REPORT_COLORS.rowBorder};">${chart}</td></tr>`;
    };

    let bodyHtml: string;

    // ---- DYNATRACE / GRAFANA source: ONE merged table (single-source) ----
    // A single "Metric" column (there is only ever one host per section). For
    // Dynatrace the host-id prefix is stripped and the host NAME becomes a chip
    // next to the heading ("HOST-123_afterburner-be_Memory Usage" -> heading
    // "Dynatrace" + host chip "afterburner-be", metric "Memory Usage"). Grafana
    // labels have no host prefix, so the label is used as-is and the heading is "Grafana".
    if (data.rows.some((r) => r.dashboardLabel)) {
      const hasHost = source === 'dynatrace';
      const metricHeaders = metrics.map((k) => `<th style="${TH_NUM} border-left:1px solid #eef1f5;">${escapeHtml(k.toUpperCase())}</th>`).join('');

      // Dashboard-mapping caption: when the comparison pairs a current-run
      // dashboard with a differently named baseline dashboard, say so —
      // "Current <dash> → Baseline <dash>" chips under the heading.
      const mappingCaption = (dashboard: string): string => {
        const pairs = (dashboardMap ?? [])
          .filter((p) => p.current && p.baseline && p.current !== p.baseline)
          .filter((p) => p.current === dashboard);
        return pairs.map((p) =>
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
      };

      // Grouped twice: a section can select several dashboards, and each dashboard several
      // panels. One merged table mixed them — "CPU" from two dashboards read as two unrelated
      // rows with the same name, and a dashboard's panels ran together in one list.
      const byDashboard = new Map<string, Map<string, BaselineComparisonRow[]>>();
      for (const row of data.rows) {
        const dashboard = row.dashboardLabel ?? (source === 'dynatrace' ? 'Hosts' : 'Other');
        const panel = row.panelTitle || 'Other';
        const panels = byDashboard.get(dashboard) ?? new Map<string, BaselineComparisonRow[]>();
        const arr = panels.get(panel) ?? [];
        arr.push(row);
        panels.set(panel, arr);
        byDashboard.set(dashboard, panels);
      }

      bodyHtml = [...byDashboard.entries()].map(([dashboard, panels]) => {
        let hostName = '';
        let reg = 0, warn = 0, ok = 0;
        let dashboardRows = 0;

        const panelBlocks = [...panels.entries()].map(([panel, rows]) => {
          dashboardRows += rows.length;
          const rowsHtml = rows.map((row, idx) => {
            const rank = worstRank(row);
            if (rank === 2) reg++; else if (rank === 1) warn++; else ok++;
            const cells = row.metrics.map((m) => renderCell(m, true, row.unit, row.baselineUnit)).join('');
            let metric = row.label;
            if (hasHost) {
              const parsed = splitHostLabel(row.label);
              if (parsed.host) hostName = parsed.host;
              metric = parsed.metric;
            }
            const background = rowBackground(rank, idx);
            return `<tr data-band="${BAND_FOR_RANK[rank]}" style="background:${background};">
              ${labelCell(metric, rank, row.url)}
              ${cells}</tr>${chartRow(row, background)}`;
          }).join('');

          // The panel heads its own table, so neither it nor the unit is repeated down a column.
          return `<div style="margin-top:18px;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
              <h4 style="margin:0; font-size:13px; font-weight:700; color:${REPORT_COLORS.mutedInk}; text-transform:uppercase; letter-spacing:0.05em;">${this.utils.escapeHtml(panel)}</h4>
              ${chip(`${formatInt(rows.length)} metrics`, 'neutral')}
              ${unitChip(rows)}
            </div>
            <div class="table-scroll">
              <table style="width:100%; border-collapse:collapse;">
              <thead><tr style="${THEAD_ROW}">
                <th style="${TH_TEXT}">Metric</th>
                ${metricHeaders}
              </tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            </div>
          </div>`;
        }).join('\n');

        const headingChips = [
          hasHost && hostName ? chip(hostName, 'info') : '',
          ...(hostLabels[dashboard] ?? []).map((l) => chip(l, 'info')),
          chip(`${formatInt(panels.size)} panels`, 'neutral'),
          chip(`${formatInt(dashboardRows)} metrics`, 'neutral'),
        ];

        return `<div data-band-scope style="margin-top:30px;">
          ${groupHeader(dashboard, headingChips, summaryChips(reg, warn, ok))}
          ${mappingCaption(dashboard)}
          ${panelBlocks}
        </div>`;
      }).join('\n');
    } else {
      // ---- performance metrics with no dashboard selection: grouped by scenario ----
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
          const cells = row.metrics.map((m, gi) => renderCell(m, gi > 0, row.unit, row.baselineUnit)).join('');
          return `<tr data-band="${BAND_FOR_RANK[rank]}" style="background:${rowBackground(rank, idx)};">
            ${labelCell(row.label, rank, row.url)}
            ${cells}</tr>`;
        }).join('');

        return `<div data-band-scope style="margin-top:38px;">
          ${groupHeader(group, [chip(`${formatInt(rows.length)} transactions`, 'neutral'), unitChip(rows)], summaryChips(reg, warn, ok))}
          <div class="table-scroll">
            <table style="width:100%; border-collapse:collapse;">
            <thead><tr style="${THEAD_ROW}">
              <th style="${TH_TEXT}">Transaction</th>
              ${metricHeaders}
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
          </div>
        </div>`;
      }).join('\n');
    }

    const SOURCE_LABELS: Record<string, string> = {
      'performance-metrics': 'Performance metrics',
      grafana: 'Grafana',
      dynatrace: 'Dynatrace',
    };

    return `<section class="comparisons-section">
      ${sectionHeader(title, { chipsHtml: [chip(SOURCE_LABELS[source] ?? source, 'neutral')] })}
      ${runIds}
      ${sectionText(text)}
      ${legend}
      ${bodyHtml}
    </section>`;
  }
}
