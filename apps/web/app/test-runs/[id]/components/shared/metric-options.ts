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
interface AvailablePanelRow { dashboard_label: string; panel_title: string; panel_id: number; unit?: string }

/**
 * The run's recorded panels, for every performance-test dashboard at once. The endpoint
 * answers for the whole run (~1 s on a large one), so a select-all over K scenario
 * dashboards must ask once and partition, not K times.
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
    const res = await authenticatedFetch(
      `/grafana/dashboards?uid=${encodeURIComponent(dashboard.dashboard_uid)}`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const grafanaDashboard = Array.isArray(data) ? data[0] : data;
    const panels: Panel[] = (grafanaDashboard?.panels ?? [])
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

  try {
    if (isUrlPanel(panel.id)) {
      return asOptions(await fetchUrlDistinctNames(testRun.test_run_id));
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
    const names: string[] = await res.json();
    // The run-wide aggregate is a series no panel has a row for; offered where it means something.
    return asOptions(shouldOfferAllAggregated(panel.source, panel.id, names)
      ? [ALL_AGGREGATED_OPTION, ...names]
      : names);
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
): Promise<PanelOption[][]> => {
  // One run-wide request serves every performance-test dashboard in the batch.
  // A failed run-wide fetch hands nothing down, so each dashboard retries on its own.
  const rows = testRun && dashboards.some((d) => sourceOf(d) === 'performance-metrics')
    ? await fetchAvailablePanelRows(testRun).catch(() => undefined)
    : undefined;
  return mapLimit(dashboards, OPTION_FETCH_CONCURRENCY, (d) => fetchPanelsForDashboard(d, testRun, options, rows));
};

/** Series for many panels, same bound. */
export const fetchSeriesForPanels = (
  panels: PanelOption[],
  testRun: TestRun | null,
): Promise<SeriesOption[][]> =>
  mapLimit(panels, OPTION_FETCH_CONCURRENCY, (p) => fetchSeriesForPanel(p, testRun));
