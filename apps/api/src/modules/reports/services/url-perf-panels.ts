/**
 * The virtual "URL …" panels a performance-test dashboard offers.
 *
 * They have no rows in ds_metric_statistics — the numbers come from the sampler rollup
 * (`test_run_sampler_stats` joined to `url_patterns`), which is why they need their own
 * comparison path. The ids and titles mirror `apps/web/lib/url-perf-panels.ts`; keep the
 * two in step or the report will not recognise what the config form offered.
 */
export type UrlMetric = 'response_time' | 'error_percentage' | 'throughput' | 'latency' | 'connect_time';

interface UrlPanelSpec {
  title: string;
  metric: UrlMetric;
  /** Response time carries a full distribution; the rest are a single number per URL. */
  hasPercentiles: boolean;
  /** Grafana unit code for the panel's values. Mirrors `yAxesFormat` in the web copy. */
  unit: string;
}

const URL_PANELS: Record<number, UrlPanelSpec> = {
  // Spelled out for the report: a section heading has the room the compare card's
  // dropdown does not, and "URL RT" reads as an abbreviation nobody has to decode.
  210: { title: 'URL Response Times', metric: 'response_time', hasPercentiles: true, unit: 'ms' },
  214: { title: 'URL Error Rate', metric: 'error_percentage', hasPercentiles: false, unit: 'percent' },
  215: { title: 'URL Throughput', metric: 'throughput', hasPercentiles: false, unit: 'reqps' },
  217: { title: 'URL Latency', metric: 'latency', hasPercentiles: false, unit: 'ms' },
  218: { title: 'URL Connect Time', metric: 'connect_time', hasPercentiles: false, unit: 'ms' },
};

export function isUrlPanel(panelId: number | undefined): boolean {
  return panelId != null && panelId in URL_PANELS;
}

export function getUrlPanel(panelId: number): UrlPanelSpec | null {
  return URL_PANELS[panelId] ?? null;
}

/**
 * Report-facing titles for the performance-test response-time panels.
 *
 * The stored panel titles name the statistic ("Transaction RT Avg", "… P95"), but a single
 * ds_metric_statistics row carries the whole distribution and the comparison renders every
 * requested percentile as its own column — so all four ids are one panel, named once.
 * Perf-test source only: panel ids are not unique across sources.
 */
const PERF_RT_PANEL_TITLES: Record<number, string> = {
  101: 'Transaction Response Times',
  102: 'Transaction Response Times',
  103: 'Transaction Response Times',
  104: 'Transaction Response Times',
  201: 'Request Response Times',
  202: 'Request Response Times',
  203: 'Request Response Times',
  204: 'Request Response Times',
};

/**
 * The per-request panels: response time (201-204), error rate, throughput, apdex, latency
 * and connect time (205-209). All of them name their series `transaction_name.sampler_name`,
 * so all of them can be given the request's URL.
 */
export function isRequestPanel(panelId: number | null | undefined): boolean {
  return panelId != null && panelId >= 201 && panelId <= 209;
}

export function perfPanelTitle(panelId: number | null, storedTitle: string | null): string {
  return (panelId != null && PERF_RT_PANEL_TITLES[panelId]) || storedTitle || '';
}

/**
 * The series entry that stands in for a panel's run-wide aggregate. Mirrors
 * ALL_AGGREGATED_OPTION in apps/web/lib/aggregated-perf-series.ts — the config form writes
 * this exact string into the panel's series list, so the two must not drift.
 */
export const ALL_AGGREGATED_SERIES = 'All aggregated';

/**
 * Which run-wide aggregate a performance-test panel stands for, for the panels the report can
 * actually compute one for: the transaction and request response-time panels. The rate and
 * count panels are aggregatable in the compare card but have no rollup the comparison reads,
 * so the config form does not offer the option for them.
 */
export function aggregatedKindFor(panelId: number | undefined): 'transaction' | 'request' | null {
  if (panelId == null) return null;
  if (panelId >= 101 && panelId <= 104) return 'transaction';
  if (panelId >= 201 && panelId <= 204) return 'request';
  return null;
}

/**
 * The dashboard the perf-test pipeline writes with a REAL `All aggregated` series on every
 * panel (ALL_AGGREGATED_SCENARIO in apps/worker/src/constants/performance-metrics.ts).
 * Mirrors ALL_AGGREGATED_DASHBOARD_LABEL in apps/web/lib/aggregated-perf-series.ts.
 */
export const ALL_AGGREGATED_DASHBOARD_LABEL = 'Performance test metrics all aggregated';

/**
 * Whether a selection is asking for the SYNTHETIC run-wide aggregate — the one this service
 * computes on the fly because no row exists for it.
 *
 * The dashboard check is load-bearing. On the all-aggregated dashboard the same name is an
 * ordinary `ds_metric_statistics` row, and claiming it here breaks two ways: on panels
 * 101-104/201-204 the report would answer from a different computation than the stored row
 * (raw PERCENTILE_CONT over the run vs the pipeline's per-bucket rollup), and on every other
 * panel `aggregatedKindFor` is null, so the name would be stripped from the selection with
 * nothing substituted and the section would render empty. Both are silent.
 */
export function isSyntheticAllAggregated(sel: {
  metricNames?: string[];
  dashboardLabel?: string;
  panelId?: number;
}): boolean {
  return !!sel.metricNames?.includes(ALL_AGGREGATED_SERIES)
    && sel.dashboardLabel !== ALL_AGGREGATED_DASHBOARD_LABEL
    && aggregatedKindFor(sel.panelId) !== null;
}
