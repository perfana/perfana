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
}

const URL_PANELS: Record<number, UrlPanelSpec> = {
  // Spelled out for the report: a section heading has the room the compare card's
  // dropdown does not, and "URL RT" reads as an abbreviation nobody has to decode.
  210: { title: 'URL Response Times', metric: 'response_time', hasPercentiles: true },
  214: { title: 'URL Error Rate', metric: 'error_percentage', hasPercentiles: false },
  215: { title: 'URL Throughput', metric: 'throughput', hasPercentiles: false },
  217: { title: 'URL Latency', metric: 'latency', hasPercentiles: false },
  218: { title: 'URL Connect Time', metric: 'connect_time', hasPercentiles: false },
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
