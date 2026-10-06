'use client';

/**
 * The panel and series lists behind the dashboards → panels → series cascade that the
 * Compare, Trends and Graphs cards share (MetricSeriesCascade).
 *
 * Pulled out of the single-selection handlers so the pickers can ask for several
 * dashboards (and several panels) at once: the dashboard's own source decides where
 * its panels come from, and each panel carries that context with it, so a selection
 * spanning Grafana, Dynatrace and performance-test dashboards still knows which
 * application dashboard and metrics source every series belongs to.
 */

import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceMetrics } from '@/lib/dynatrace';
import { getSourceType } from '@/lib/metrics-source-utils';
import { fetchGrafanaDashboardByUid } from '@/lib/grafana-dashboards';
import {
  ALL_AGGREGATED_OPTION,
  collapsePerfRtPanels,
  shouldOfferAllAggregated,
} from '@/lib/aggregated-perf-series';
import { buildUrlPanels, fetchUrlDistinctNames, isUrlPanel } from '@/lib/url-perf-panels';
import { TestRun } from '@/types/test-runs';

export type DataSource = 'grafana' | 'dynatrace' | 'performance-metrics';

/** The dashboard shape every card's types declare; structurally identical across them. */
export interface ApplicationDashboard {
  id: string;
  dashboard_label: string;
  dashboard_name: string;
  dashboard_uid: string;
  /** A uid is unique only WITHIN a Grafana instance, so panel lookups must carry this. */
  grafana_instance_id?: string;
  metrics_source_id?: string;
  source_type?: string;
  /** Dynatrace host dashboards only: the labels given to the host. */
  hostLabels?: string[];
  grafanaInstance?: {
    label: string;
  };
}

export interface Panel {
  id: number;
  title: string;
  type: string;
  yAxesFormat?: string;
  applicationDashboardId?: string;
  metricsSourceId?: string;
}

export const SUPPORTED_PANEL_TYPES = ['graph', 'timeseries', 'stat', 'singlestat'] as const;

/** A panel with the dashboard it came from — the cascade groups and adds series by it. */
export interface PanelOption extends Panel {
  dashboard: ApplicationDashboard;
  dashboardLabel: string;
  source: DataSource;
  /**
   * The run's series for this panel, when the panel list already learned them from
   * `/ds-metrics/available/:run`. Present means `fetchSeriesForPanel` needs no request;
   * absent means it asks `/ds-metrics/distinct-names` as before.
   */
  metricNames?: string[];
}

/** One selectable series: a metric name plus the panel it belongs to. */
export interface SeriesOption {
  metricName: string;
  panel: PanelOption;
}

/** What the cascade hands back per picked series. */
export interface SeriesPick {
  dashboard: ApplicationDashboard;
  panel: PanelOption;
  metricName: string;
}

/**
 * Which per-card extras the panel list gets. Compare wants both: it shows every
 * percentile of a collapsed RT panel in one row and has a URL dimension. Trends and
 * Graphs plot one statistic per panel and have no URL data path, so they take neither.
 */
export interface PanelListOptions {
  /** Fold the per-percentile perf RT panels into one "… RT" entry. */
  collapseRtPanels?: boolean;
  /** Append the virtual "URL …" panels to a performance-test dashboard. */
  includeUrlPanels?: boolean;
}

export function sourceOf(dashboard: ApplicationDashboard): DataSource {
  const type = getSourceType(dashboard);
  if (type === 'dynatrace') return 'dynatrace';
  if (type === 'performance_test') return 'performance-metrics';
  return 'grafana';
}

/**
 * Known units for the synthetic performance-test panels, which have no Grafana panel
 * JSON to read a unit from. Keyed by panel id; the per-scenario and all-aggregated
 * dashboards share these ids.
 */
export const PERFORMANCE_METRICS_PANEL_UNITS: Record<number, string> = {
  // Transaction-level (v2 architecture)
  101: 'ms',       // TXN_RT_AVG
  102: 'ms',       // TXN_RT_P90
  103: 'ms',       // TXN_RT_P95
  104: 'ms',       // TXN_RT_P99
  105: 'percent',  // TXN_ERROR_RATE
  106: 'short',    // TXN_APDEX (0-1 score)
  107: 'reqps',    // TXN_THROUGHPUT
  108: 'short',    // TXN_CONCURRENCY (avg requests in flight, unitless)

  // Request-level (v2 architecture)
  201: 'ms',       // REQ_RT_AVG
  202: 'ms',       // REQ_RT_P90
  203: 'ms',       // REQ_RT_P95
  204: 'ms',       // REQ_RT_P99
  205: 'percent',  // REQ_ERROR_RATE
  206: 'reqps',    // REQ_THROUGHPUT
  207: 'short',    // REQ_APDEX
  208: 'ms',       // REQ_LATENCY
  209: 'ms',       // REQ_CONNECT_TIME
  219: 'short',    // REQ_CONCURRENCY (210-218 are the virtual URL panels)

  // Scenario-level (v2 architecture)
  301: 'short',    // SCENARIO_ERROR_COUNT
  302: 'short',    // SCENARIO_AVG_THREADS
  303: 'short',    // SCENARIO_MAX_THREADS

  // Legacy panel IDs (v1 architecture)
  1: 'ms',         // RESPONSE_TIME
  7: 'ms',         // RESPONSE_LATENCY
  8: 'ms',         // RESPONSE_CONNECT_TIME
  9: 'percent',    // ERROR_RATE
  10: 'reqps',     // THROUGHPUT
  11: 'short',     // APDEX_SCORE_REQUESTS
  12: 'short',     // ERROR_COUNT
  13: 'ms',        // TRANSACTION_RESPONSE_TIME
  14: 'short',     // AVG_ACTIVE_THREADS
  15: 'short',     // MAX_ACTIVE_THREADS
  16: 'percent',   // TRANSACTION_ERROR_RATE
  17: 'short',     // APDEX_SCORE_TRANSACTIONS
};

/** The y-axis unit a Grafana panel declares, wherever its panel type keeps it. */
export function extractYAxisFormat(panel: {
  type: string;
  fieldConfig?: { defaults?: { unit?: string } };
  yaxes?: Array<{ format?: string }>;
}): string | undefined {
  // Older graph panels keep it on the axis; everything newer on fieldConfig.
  if (panel.type === 'graph' && panel.yaxes?.[0]?.format) {
    return panel.yaxes[0].format;
  }
  return panel.fieldConfig?.defaults?.unit || undefined;
}

/**
 * Run `fn` over `items` with at most `limit` in flight.
 *
 * "Select all" is one click over every dashboard on the system — 22 here, 371 on one
 * field system — and each dashboard (then each panel) is its own request. A bare
 * Promise.all fires all of them at once and buries the API behind the browser's
 * connection queue.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Requests in flight while a multi-select loads its children. */
export const OPTION_FETCH_CONCURRENCY = 6;

/** One row of `/metrics/ds-metrics/available/:testRunId`: a panel the run recorded. */
interface AvailablePanelRow {
  dashboard_label: string;
  panel_title: string;
  panel_id: number;
  unit?: string;
  /** Every series the run recorded on this panel — see `seriesFromAvailableRows`. */
  metric_names?: string[];
}

/**
 * Dashboard labels that more than one selected dashboard answers to.
 *
 * `uq_application_dashboards_unique` is `(system_under_test_id, test_environment,
 * grafana_instance_id, dashboard_uid, dashboard_label)` — the LABEL is not unique within a
 * system and environment. The same Grafana dashboard mapped from two instances carries one
 * label and, sharing a uid, the same panel ids; 20 of 152 uids are duplicated across
 * instances on the dev database (root CLAUDE.md item 43). A forked artificial Dynatrace
 * dashboard (item 44) is the other way in.
 *
 * That matters here and did not before, because `/distinct-names` was scoped by
 * `application_dashboard_id` while `/ds-metrics/available` groups by label. Left alone, two
 * such dashboards collapse onto one key and each is offered the union of both their series —
 * pick the stranger's name and the chart draws nothing, with nothing logged.
 *
 * So the ambiguous labels are dropped from the map and those panels keep asking per panel,
 * which is both correct and what they did before this change. Resolved client-side rather
 * than by adding `application_dashboard_id` to the endpoint's GROUP BY: that column is not in
 * `idx_ds_metrics_panel_lookup`, so adding it costs the index-only scan over the run's 2 M
 * entries and makes the panel list slower — the opposite of the point.
 *
 * **Judge this over every dashboard on the system, not over the selection.** The merge is
 * done by the server's `GROUP BY dashboard_label, panel_title, panel_id, unit`, so it has
 * already happened whether or not both twins are picked: selecting only one of them still
 * yields a row carrying both dashboards' series. Computed from the selection alone, the guard
 * would catch the obvious case and miss exactly the quiet one.
 *
 * **Two blind spots, because the population is the picker's merged list and not
 * `application_dashboards`.** Neither is closable from here, and both are the same symptom —
 * a series offered on a panel that has none of it, drawing nothing, logging nothing:
 *
 * - **Dynatrace twins are deduped by label before they arrive.** The cards drop the artificial
 *   Dynatrace rows and rebuild that half from `GET /dynatrace/queries/dashboards`, which is
 *   `getDistinctDashboardLabels` — one entry per distinct label by construction. So this never
 *   returns a Dynatrace label, and the forked-artificial-dashboard case (item 44) is NOT
 *   covered despite being the same shape.
 * - **Compare and Trends pass `hasData=true`, Graphs does not.** A twin with `ds_metrics` rows
 *   for this run but no `ds_metric_statistics` row — a live run, or metrics that are all
 *   ramp-up — is missing from the population those two cards hand in, so the label reads
 *   unambiguous and the merged union goes to the visible twin.
 *
 * A real close needs dashboard identity in the response; see the TODOS.md entry for why adding
 * `application_dashboard_id` to that GROUP BY is not free.
 */
function ambiguousLabels(dashboards: ApplicationDashboard[]): Set<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const d of dashboards) {
    if (seen.has(d.dashboard_label)) duplicated.add(d.dashboard_label);
    seen.add(d.dashboard_label);
  }
  return duplicated;
}

/**
 * The series each panel recorded, keyed by `panelKey` (dashboard label + panel id).
 *
 * `/ds-metrics/available/:run` has always returned `metric_names` per panel and the cascade
 * has always discarded it, then asked `/ds-metrics/distinct-names` for the same names once
 * per panel — 625 requests on a select-all over a production run with 62 perf-test
 * dashboards, three database round trips each (the access check is two of them), for an
 * answer already in hand. Both read `ds_metrics` scoped to the run, so they agree by
 * construction, and neither normalises the column.
 *
 * A panel can appear on more than one row when its rows carry different `unit`s, so the
 * names are unioned rather than overwritten.
 */
function seriesFromAvailableRows(
  rows: AvailablePanelRow[],
  skipLabels: Set<string>,
): Map<string, string[]> {
  const byPanel = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.metric_names?.length) continue;
    if (skipLabels.has(row.dashboard_label)) continue;
    const key = panelKey({ id: row.panel_id, dashboardLabel: row.dashboard_label });
    const existing = byPanel.get(key);
    if (existing) {
      for (const name of row.metric_names) if (!existing.includes(name)) existing.push(name);
    } else {
      byPanel.set(key, [...row.metric_names]);
    }
  }
  return byPanel;
}

/**
 * The run's recorded panels, for every performance-test dashboard at once. The endpoint
 * answers for the whole run (~1 s on a large one), so a select-all over K scenario
 * dashboards must ask once and partition, not K times.
 *
 * It carries two things, not one: the perf-test panel list, and `metric_names` per panel —
 * the series of whatever the run recorded, whichever source it came from. The caller is what
 * decides when to ask for it; see `fetchPanelsForDashboards`.
 */
async function fetchAvailablePanelRows(testRun: TestRun): Promise<AvailablePanelRow[]> {
  const res = await authenticatedFetch(
    `/metrics/ds-metrics/available/${encodeURIComponent(testRun.test_run_id)}`,
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (!res.ok) throw new Error(`available panels: ${res.status}`);
  return res.json();
}

/** The panels of one dashboard, asked of whichever backend that dashboard's source uses. */
export async function fetchPanelsForDashboard(
  dashboard: ApplicationDashboard,
  testRun: TestRun | null,
  { collapseRtPanels = true, includeUrlPanels = true }: PanelListOptions = {},
  /** Pre-fetched `/ds-metrics/available` rows, when the caller already holds them. */
  availableRows?: AvailablePanelRow[],
): Promise<PanelOption[]> {
  const source = sourceOf(dashboard);
  const wrap = (panels: Panel[]): PanelOption[] =>
    panels.map((p) => ({
      ...p,
      applicationDashboardId: p.applicationDashboardId || dashboard.id,
      metricsSourceId: p.metricsSourceId || dashboard.metrics_source_id,
      dashboard,
      dashboardLabel: dashboard.dashboard_label,
      source,
    }));

  try {
    if (source === 'dynatrace') {
      if (!testRun?.system_under_test_id || !testRun.test_environment || !testRun.workload) return [];
      const metrics = await fetchDynatraceMetrics(
        testRun.system_under_test_id, testRun.test_environment, testRun.workload, dashboard.dashboard_label,
      );
      return wrap(metrics.map((m) => ({
        id: m.panelId,
        title: m.panelTitle,
        type: 'dynatrace',
        yAxesFormat: m.metricUnit,
        applicationDashboardId: m.applicationDashboardId,
      })));
    }

    if (source === 'performance-metrics') {
      // Performance-test panels are whatever the run actually recorded, not dashboard JSON.
      if (!testRun) return [];
      const rows = availableRows ?? await fetchAvailablePanelRows(testRun).catch(() => [] as AvailablePanelRow[]);
      const seen = new Set<number>();
      const panels: Panel[] = [];
      for (const row of rows) {
        if (row.dashboard_label === dashboard.dashboard_label && !seen.has(row.panel_id)) {
          seen.add(row.panel_id);
          panels.push({
            id: row.panel_id,
            title: row.panel_title,
            type: 'timeseries',
            yAxesFormat: row.unit || PERFORMANCE_METRICS_PANEL_UNITS[row.panel_id],
          });
        }
      }
      const withUrls = includeUrlPanels ? [...panels, ...buildUrlPanels(dashboard.id)] : panels;
      return wrap(collapseRtPanels ? collapsePerfRtPanels(withUrls) : withUrls);
    }

    if (!dashboard.dashboard_uid) return [];
    // Scoped by instance: a uid is unique only within one Grafana.
    const grafanaDashboard = await fetchGrafanaDashboardByUid(
      dashboard.dashboard_uid,
      dashboard.grafana_instance_id,
    );
    const panels: Panel[] = ((grafanaDashboard?.panels ?? []) as Panel[])
      .filter((p: Panel) => (SUPPORTED_PANEL_TYPES as readonly string[]).includes(p.type))
      .map((p: Panel) => ({ ...p, yAxesFormat: p.yAxesFormat || extractYAxisFormat(p) }));
    return wrap(panels);
  } catch (error) {
    console.error(`Error fetching panels for ${dashboard.dashboard_label}:`, error);
    return [];
  }
}

/** The series of one panel. URL panels answer from the run's normalized URLs instead. */
export async function fetchSeriesForPanel(
  panel: PanelOption,
  testRun: TestRun | null,
): Promise<SeriesOption[]> {
  if (!testRun) return [];
  const asOptions = (names: string[]): SeriesOption[] => names.map((metricName) => ({ metricName, panel }));

  /** The run-wide aggregate is a series no panel has a row for; offered where it means something. */
  const withAllAggregated = (names: string[]): SeriesOption[] =>
    asOptions(shouldOfferAllAggregated(panel.source, panel.id, names)
      ? [ALL_AGGREGATED_OPTION, ...names]
      : names);

  try {
    if (isUrlPanel(panel.id)) {
      return asOptions(await fetchUrlDistinctNames(testRun.test_run_id));
    }

    // Already known from the panel list's one run-wide fetch — no request at all.
    //
    // On a LIVE run this is a snapshot taken when the dashboard selection last changed: a
    // transaction that first reports at minute 40 does not appear until the user touches the
    // dashboard column, where before this change every panel tick re-asked. The panel list
    // beside it has always had exactly that staleness, from exactly this fetch, so the two are
    // now consistent rather than one being fresher than the other.
    if (panel.metricNames) {
      return withAllAggregated(panel.metricNames);
    }

    const params = new URLSearchParams({
      applicationDashboardId: panel.applicationDashboardId || panel.dashboard.id,
      panelId: String(panel.id),
      system: testRun.systems_under_test?.name || '',
      environment: testRun.test_environment || '',
      workload: testRun.workload || '',
      // Scoped to this run: unscoped, the panel answers with every series it ever recorded,
      // so runs with older naming contributed names nothing in the comparison can match.
      testRunId: testRun.test_run_id,
    });
    const metricsSourceId = panel.metricsSourceId || panel.dashboard.metrics_source_id;
    if (metricsSourceId) params.set('metricsSourceId', metricsSourceId);

    const res = await authenticatedFetch(
      `/metrics/ds-metrics/distinct-names?${params.toString()}`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!res.ok) return [];
    return withAllAggregated(await res.json());
  } catch (error) {
    console.error(`Error fetching series for panel ${panel.title}:`, error);
    return [];
  }
}

/** Stable identity for a panel across dashboards — panel ids repeat between them. */
export const panelKey = (p: { id: number; dashboardLabel: string }) => `${p.dashboardLabel} ${p.id}`;

/** Stable identity for a series. */
export const seriesKey = (s: SeriesOption) => `${panelKey(s.panel)} ${s.metricName}`;

/** Panels for many dashboards, bounded so a select-all does not fan out unbounded. */
export const fetchPanelsForDashboards = async (
  dashboards: ApplicationDashboard[],
  testRun: TestRun | null,
  options?: PanelListOptions,
  /**
   * Every dashboard the picker lists, when the caller has it. Only `ambiguousLabels` reads
   * it, and only to widen what it considers — see that function for why the selection alone
   * is the wrong population. Omitted, the guard falls back to the selection, which is the
   * safe-but-narrower answer rather than a wrong one.
   */
  allDashboards?: ApplicationDashboard[],
): Promise<PanelOption[][]> => {
  // One run-wide request serves every performance-test dashboard in the batch.
  // A failed run-wide fetch hands nothing down, so each dashboard retries on its own.
  //
  // Still gated on the batch containing a perf-test dashboard, deliberately. Widening it to
  // every selection looks like a win — one call replacing N — and is not, because the series
  // step is LAZY: `MetricSeriesCascade` asks for series only for the panels the user actually
  // ticks, not for every panel it lists. At 895 ms warm / 5958 ms cold for this call against
  // ~10 ms for a scoped /distinct-names, breakeven is around 90 ticked panels, and the effect
  // re-runs on every dashboard toggle with nothing cached. The 625-request trace this change
  // comes from is a select-all over a perf-test run — exactly the case where these rows are
  // fetched for the panel list anyway, so reading their series out costs nothing extra.
  const rows = testRun && dashboards.some((d) => sourceOf(d) === 'performance-metrics')
    ? await fetchAvailablePanelRows(testRun).catch(() => undefined)
    : undefined;
  const lists = await mapLimit(dashboards, OPTION_FETCH_CONCURRENCY,
    (d) => fetchPanelsForDashboard(d, testRun, options, rows));
  if (!rows) return lists;

  // Series are attached here rather than inside `fetchPanelsForDashboard` so the map is built
  // once per batch instead of once per dashboard, and so the per-dashboard loader stays
  // concerned only with panels. Every source in the batch benefits, not just the perf-test
  // ones that paid for the call: the rows cover whatever the run recorded, and a panel they
  // do not mention simply keeps asking.
  const knownSeries = seriesFromAvailableRows(rows, ambiguousLabels(allDashboards ?? dashboards));
  return lists.map((panels) => panels.map((p) => ({
    ...p,
    metricNames: knownSeries.get(panelKey(p)),
  })));
};

/** Series for many panels, same bound. */
export const fetchSeriesForPanels = (
  panels: PanelOption[],
  testRun: TestRun | null,
): Promise<SeriesOption[][]> =>
  mapLimit(panels, OPTION_FETCH_CONCURRENCY, (p) => fetchSeriesForPanel(p, testRun));
