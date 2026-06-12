/**
 * Real-world ADAPT metric-name fixtures — "what production metric names actually
 * look like", encoded once and reused.
 *
 * The #383 regression (per-transaction performance rows showing "Chart not
 * available") slipped through because every test used *synthetic* dotted metric
 * names (transactions.login.response_time.p95) that the production data never
 * uses. These fixtures are pulled verbatim from `ds_adapt_results` joined to
 * `metrics_sources`, covering the real shapes:
 *
 *   - performance_test, transaction-level → plain transaction name in metric_name,
 *     type/stat in panel_title (e.g. "Transaction RT Avg" / "AV_AVAC_01_Match")
 *   - performance_test, request-level → "<transaction>.<sub-request>" metric_name
 *     (e.g. "AV_AVAC_01_Match.-0")
 *   - performance_test, global counters → single-token metric_name
 *     (e.g. "avg_active_threads", "error_count")
 *   - grafana → arbitrary Grafana series name
 *   - aggregate-SLO format → the dotted scheme the whole-test aggregate SLO
 *     feature (#383) emits and that parseAggregatedMetricSource resolves. No real
 *     rows exist in the sample DB yet, so these are marked origin:'aggregate-slo'
 *     and documented as the one shape that routes to the aggregated endpoint.
 *
 * `chartPath` is the data path the row MUST take:
 *   - 'ds-metrics'  → aggregatedMetricSource is undefined; chart falls back to the
 *                     ds-metrics panel endpoint (keyed by panel_id + metric_name)
 *   - 'aggregated'  → aggregatedMetricSource is resolved; chart uses
 *                     /aggregated-metric-timeseries
 *
 * Every fixture must render a chart — none should ever show "Chart not available".
 */

export type ChartPath = 'ds-metrics' | 'aggregated';

export interface AdaptMetricNameFixture {
  /** Where this pair comes from — real query rows vs. the documented aggregate-SLO format. */
  origin: 'ds_adapt_results' | 'aggregate-slo';
  sourceType: string;
  panelTitle: string;
  metricName: string;
  chartPath: ChartPath;
  /** Expected aggregatedMetricSource when chartPath === 'aggregated'. */
  aggregatedMetricSource?: { metric: string; stat: string };
}

export const ADAPT_METRIC_NAME_FIXTURES: AdaptMetricNameFixture[] = [
  // --- performance_test · transaction-level (plain transaction name) ---
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Transaction RT Avg', metricName: 'AV_AVAC_01_Match', chartPath: 'ds-metrics' },
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Transaction RT P90', metricName: 'AV_AVAC_01_Match', chartPath: 'ds-metrics' },
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Transaction RT P95', metricName: 'AV_AVAC_01_Match', chartPath: 'ds-metrics' },
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Transaction RT P99', metricName: 'AV_AVAC_01_Match', chartPath: 'ds-metrics' },
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Transaction Apdex', metricName: 'AV_AVAC_01_Match', chartPath: 'ds-metrics' },
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Transaction Error Rate', metricName: 'AV_AVAC_01_Match', chartPath: 'ds-metrics' },
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Transaction Throughput', metricName: 'AV_AVAC_01_Match', chartPath: 'ds-metrics' },

  // --- performance_test · request-level ("<transaction>.<sub-request>") ---
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Request RT Avg', metricName: 'AV_AVAC_01_Match.-0', chartPath: 'ds-metrics' },
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Request RT P95', metricName: 'AV_AVAC_01_Match.-0', chartPath: 'ds-metrics' },
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Request Apdex', metricName: 'AV_AVAC_01_Match.-0', chartPath: 'ds-metrics' },
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Request Latency', metricName: 'AV_AVAC_01_Match.-0', chartPath: 'ds-metrics' },
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Request Error Rate', metricName: 'AV_AVAC_01_Match.-0', chartPath: 'ds-metrics' },
  // real-world request name carrying an embedded value + spaces (from BMS-acc-loadTest-00002)
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Request RT P95', metricName: 'AV_BVAC_03_Vacatures.AV_BVAC_03_Vacatures_@vacature_count=193184@_14', chartPath: 'ds-metrics' },

  // --- performance_test · global counters (single token) ---
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Avg Active Threads', metricName: 'avg_active_threads', chartPath: 'ds-metrics' },
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Max Active Threads', metricName: 'max_active_threads', chartPath: 'ds-metrics' },
  { origin: 'ds_adapt_results', sourceType: 'performance_test', panelTitle: 'Error Count', metricName: 'error_count', chartPath: 'ds-metrics' },

  // --- grafana · arbitrary series name (not performance_test → ds-metrics) ---
  { origin: 'ds_adapt_results', sourceType: 'grafana', panelTitle: 'Collections end of major GC by cause', metricName: '  (CodeCache GC Threshold)', chartPath: 'ds-metrics' },

  // --- aggregate-SLO format (#383) · the one shape that routes to the aggregated endpoint ---
  { origin: 'aggregate-slo', sourceType: 'performance_test', panelTitle: 'Aggregate Transaction RT P95', metricName: 'transactions.login.response_time.p95', chartPath: 'aggregated', aggregatedMetricSource: { metric: 'transaction_response_time', stat: 'p95' } },
  { origin: 'aggregate-slo', sourceType: 'performance_test', panelTitle: 'Aggregate Request RT Avg', metricName: 'requests.checkout.response_time.avg', chartPath: 'aggregated', aggregatedMetricSource: { metric: 'request_response_time', stat: 'avg' } },
  { origin: 'aggregate-slo', sourceType: 'performance_test', panelTitle: 'Aggregate Transaction Error Rate', metricName: 'transactions.login.error_rate', chartPath: 'aggregated', aggregatedMetricSource: { metric: 'error_percentage', stat: 'avg' } },
];
