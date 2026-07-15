import { authenticatedFetch } from '@/lib/api';
import { Panel, MetricStatistic } from '@/app/test-runs/[id]/components/compare/types';

export type UrlMetric = 'response_time' | 'error_percentage' | 'throughput' | 'latency' | 'connect_time';

export const URL_PANEL_ID_MIN = 210;
export const URL_PANEL_ID_MAX = 218;

interface UrlPanelSpec { id: number; title: string; metric: UrlMetric; yAxesFormat: string }

// ponytail: 210-213 all map to response_time and return the same distribution;
// distinct titles match the request-panel list. Apdex (216) is omitted — per-URL
// Apdex crosses transaction thresholds and has no single active threshold.
const URL_PANELS: UrlPanelSpec[] = [
  { id: 210, title: 'URL RT Avg',       metric: 'response_time',    yAxesFormat: 'ms' },
  { id: 211, title: 'URL RT P90',       metric: 'response_time',    yAxesFormat: 'ms' },
  { id: 212, title: 'URL RT P95',       metric: 'response_time',    yAxesFormat: 'ms' },
  { id: 213, title: 'URL RT P99',       metric: 'response_time',    yAxesFormat: 'ms' },
  { id: 214, title: 'URL Error Rate',   metric: 'error_percentage', yAxesFormat: 'percent' },
  { id: 215, title: 'URL Throughput',   metric: 'throughput',       yAxesFormat: 'reqps' },
  { id: 217, title: 'URL Latency',      metric: 'latency',          yAxesFormat: 'ms' },
  { id: 218, title: 'URL Connect Time', metric: 'connect_time',     yAxesFormat: 'ms' },
];

const BY_ID = new Map(URL_PANELS.map(p => [p.id, p]));

export function isUrlPanel(panelId: number): boolean {
  return BY_ID.has(panelId);
}

export function getUrlPanelMetric(panelId: number): UrlMetric | null {
  return BY_ID.get(panelId)?.metric ?? null;
}

/** Dropdown entries injected for performance-metrics dashboards. */
export function buildUrlPanels(applicationDashboardId: string): Panel[] {
  return URL_PANELS.map(p => ({
    id: p.id,
    title: p.title,
    type: 'timeseries',
    yAxesFormat: p.yAxesFormat,
    applicationDashboardId,
  }));
}

/** Distinct normalized URLs for the anchor run (series multi-select). [] on error. */
export async function fetchUrlDistinctNames(testRunId: string): Promise<string[]> {
  try {
    const res = await authenticatedFetch(
      `/test-runs/${testRunId}/url-distinct-names`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!res.ok) { console.error(`Failed to fetch URL distinct names: HTTP ${res.status}`); return []; }
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch URL distinct names:', err);
    return [];
  }
}

/** Per-URL statistics for the given metric across runs. [] on error. */
export async function fetchUrlMetricStatistics(
  anchorTestRunId: string,
  testRunIds: string[],
  metric: UrlMetric,
): Promise<MetricStatistic[]> {
  try {
    const params = new URLSearchParams({ metric, testRunIds: testRunIds.join(',') });
    const res = await authenticatedFetch(
      `/test-runs/${anchorTestRunId}/url-metric-statistics?${params.toString()}`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!res.ok) { console.error(`Failed to fetch URL statistics: HTTP ${res.status}`); return []; }
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch URL statistics:', err);
    return [];
  }
}
