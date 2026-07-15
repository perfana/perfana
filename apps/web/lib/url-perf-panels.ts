import { authenticatedFetch } from '@/lib/api';
import { Panel, MetricStatistic } from '@/app/test-runs/[id]/components/compare/types';

export type UrlMetric = 'response_time' | 'error_percentage' | 'throughput' | 'latency' | 'connect_time';

export const URL_PANEL_ID_MIN = 210;

interface UrlPanelSpec { id: number; title: string; metric: UrlMetric; yAxesFormat: string }

// ponytail: one "URL RT" entry (210) — the response_time row already carries the
// full avg/p90/p95/p99 distribution, and the compare table renders every percentile
// column from it, so separate Avg/P90/P95/P99 entries were identical duplicates.
// Apdex (216) is omitted — per-URL Apdex crosses transaction thresholds and has no
// single active threshold.
const URL_PANELS: UrlPanelSpec[] = [
  { id: 210, title: 'URL RT',           metric: 'response_time',    yAxesFormat: 'ms' },
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

/**
 * Map of sampler/request name -> normalized URL for a run, for enriching the
 * Compare card's Request RT rows with their normalized URL. {} on error.
 */
export async function fetchSamplerUrlMap(
  anchorTestRunId: string,
): Promise<Record<string, string>> {
  try {
    const res = await authenticatedFetch(
      `/test-runs/${anchorTestRunId}/sampler-url-map`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!res.ok) { console.error(`Failed to fetch sampler URL map: HTTP ${res.status}`); return {}; }
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch sampler URL map:', err);
    return {};
  }
}

/** Panel id for the per-request response-time panel ("Request RT"). */
export const REQUEST_RT_PANEL_ID = 201;

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
