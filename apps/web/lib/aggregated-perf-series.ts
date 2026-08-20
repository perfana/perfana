import { authenticatedFetch } from '@/lib/api';

/** Dropdown entry that stands in for the run-wide aggregate of a perf panel. */
export const ALL_AGGREGATED_OPTION = 'All aggregated';

export type AggMetric = 'transaction_response_time' | 'request_response_time' | 'error_percentage';
export type AggStat = 'avg' | 'p50' | 'p90' | 'p95' | 'p99' | 'max';
export interface AggregateSpec { metric: AggMetric; stat: AggStat }

/**
 * Performance-test panel ids that have a rollup-backed run-wide aggregate,
 * mapped to the (metric, stat) the aggregate endpoint understands. Panel ids
 * come from METRIC_TYPE_PANEL_IDS in apps/worker/src/constants/performance-metrics.ts.
 * error_percentage ignores stat ('avg' is a placeholder the API never reads).
 */
const AGGREGATABLE_PERF_PANELS: Record<number, AggregateSpec> = {
  101: { metric: 'transaction_response_time', stat: 'avg' },
  102: { metric: 'transaction_response_time', stat: 'p90' },
  103: { metric: 'transaction_response_time', stat: 'p95' },
  104: { metric: 'transaction_response_time', stat: 'p99' },
  105: { metric: 'error_percentage', stat: 'avg' },
  201: { metric: 'request_response_time', stat: 'avg' },
  202: { metric: 'request_response_time', stat: 'p90' },
  203: { metric: 'request_response_time', stat: 'p95' },
  204: { metric: 'request_response_time', stat: 'p99' },
  205: { metric: 'error_percentage', stat: 'avg' },
};

export function getAggregateSpec(panelId: number): AggregateSpec | null {
  return AGGREGATABLE_PERF_PANELS[panelId] ?? null;
}

const RT_AGG_METRICS = new Set<AggMetric>(['transaction_response_time', 'request_response_time']);
const RT_KEEPER_TITLES: Record<number, string> = { 101: 'Transaction RT', 201: 'Request RT' };

/**
 * Collapse the redundant per-percentile RT panels. Transaction/Request RT
 * Avg/P90/P95/P99 all store the identical per-series distribution (the
 * percentile lives only in the panel title, not the ds_metric_statistics row),
 * so P90/P95/P99 are dropped and the Avg panel is relabelled to one "… RT" entry.
 * Perf-metrics panels only — panel ids are not unique across sources, so callers
 * MUST gate on source === 'performance-metrics' before calling this.
 */
export function collapsePerfRtPanels<T extends { id: number; title?: string }>(panels: T[]): T[] {
  return panels
    .filter(p => {
      const spec = getAggregateSpec(p.id);
      return !(spec && RT_AGG_METRICS.has(spec.metric) && spec.stat !== 'avg');
    })
    .map(p => (RT_KEEPER_TITLES[p.id] ? { ...p, title: RT_KEEPER_TITLES[p.id] } : p));
}

export function isAggregatablePanel(panelId: number): boolean {
  return panelId in AGGREGATABLE_PERF_PANELS;
}

/**
 * Whether the "All aggregated" option should be offered for a panel. Guards
 * on BOTH the source (perf-test only — panel ids are not disjoint across
 * Grafana/Dynatrace, so a bare panel-id check can collide) and the panel
 * being one we can aggregate.
 */
export function shouldOfferAllAggregated(source: string, panelId: number): boolean {
  return source === 'performance-metrics' && isAggregatablePanel(panelId);
}

/**
 * Rewrite a legacy per-percentile aggregated series onto the keeper panel.
 *
 * `collapsePerfRtPanels` only filters the panel dropdown. Preset restore rebuilds
 * series straight from the stored panelId/metricName, so a preset saved before the
 * collapse can still hold panel 202 — a row labelled "All aggregated — Request RT
 * P90" that now shows AVG/P90/P95/P99, contradicting its own label and duplicating
 * the collapsed "All aggregated — Request RT" row if both are added.
 *
 * Returns the input unchanged for anything that is not one of those panels, so it
 * is safe to run over every restored series.
 */
export function normaliseLegacyAggregatedSeries<
  T extends { panelId: number; panelTitle?: string; metricName?: string; isAggregated?: boolean },
>(series: T): T {
  if (!series.isAggregated) return series;

  const spec = getAggregateSpec(series.panelId);
  if (!spec || !RT_AGG_METRICS.has(spec.metric) || spec.stat === 'avg') return series;

  const keeper = spec.metric === 'transaction_response_time' ? 101 : 201;
  const title = RT_KEEPER_TITLES[keeper];
  if (!title) return series;

  return {
    ...series,
    panelId: keeper,
    panelTitle: title,
    metricName: buildAggregatedMetricName(title),
  };
}

/** Readable, per-panel-unique legend/row name so two aggregated panels don't collide. */
export function buildAggregatedMetricName(panelTitle: string): string {
  return `${ALL_AGGREGATED_OPTION} — ${panelTitle}`;
}

/**
 * Fetch the run-wide aggregate for one panel spec across the given runs.
 * `value` is the spec's own stat; `values` carries every stat (avg/p50/p90/
 * p95/p99/max) — the API computes them all in one pass, so Compare can fill
 * its percentile columns for free.
 * Returns [] on transport/HTTP error (callers treat that as no data).
 */
export async function fetchAggregatedStatistics(
  anchorTestRunId: string,
  testRunIds: string[],
  spec: AggregateSpec,
): Promise<Array<{ testRunId: string; value: number | null; values?: Record<string, number | null> }>> {
  try {
    const params = new URLSearchParams({
      metric: spec.metric,
      stat: spec.stat,
      testRunIds: testRunIds.join(','),
    });
    const res = await authenticatedFetch(
      `/test-runs/${anchorTestRunId}/aggregated-metric-statistic?${params.toString()}`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!res.ok) {
      console.error(`Failed to fetch aggregated statistic: HTTP ${res.status}`);
      return [];
    }
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch aggregated statistic:', err);
    return [];
  }
}
