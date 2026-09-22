/**
 * A profile benchmark with this `source` targets the worker-written
 * `Performance test metrics <scenario>` dashboards instead of a Grafana template:
 * `dashboard_uid` then holds a regex over `application_dashboards.dashboard_uid` and
 * `profile_dashboard_id` is NULL. Same literal the SUT SLO dialog stores in
 * `benchmarks.source` / `configuration.type`.
 */
export const PERF_TEST_PROFILE_SOURCE = 'performance-metrics';

/**
 * Every scenario dashboard, minus the run-wide roll-up and the no-scenario fallback.
 * Runs in Postgres (`~`, ARE dialect) — keep it to constructs both engines share; the API
 * validates it with the JS engine, grafana-sync executes it in Postgres.
 */
export const PERF_TEST_DASHBOARD_UID_PATTERN_DEFAULT =
  '^performance-test-metrics-(?!all-aggregated$|default$)';

/**
 * Panels every perf-test dashboard carries. Copy of the worker's
 * `METRIC_TYPE_PANEL_NAMES` (`apps/worker/src/constants/performance-metrics.ts`), pinned
 * by `apps/worker/src/test/unit/pipelines/perf-test-profile-panels.test.ts` — the profile form has no application
 * dashboard to read `ds_metric_statistics` from, so it needs the list statically.
 */
export const PERF_TEST_PROFILE_PANELS: ReadonlyArray<{ id: number; title: string }> = [
  { id: 101, title: 'Transaction RT Avg' },
  { id: 102, title: 'Transaction RT P90' },
  { id: 103, title: 'Transaction RT P95' },
  { id: 104, title: 'Transaction RT P99' },
  { id: 105, title: 'Transaction Error Rate' },
  { id: 106, title: 'Transaction Apdex' },
  { id: 107, title: 'Transaction Throughput' },
  { id: 108, title: 'Transaction Concurrency' },
  { id: 201, title: 'Request RT Avg' },
  { id: 202, title: 'Request RT P90' },
  { id: 203, title: 'Request RT P95' },
  { id: 204, title: 'Request RT P99' },
  { id: 205, title: 'Request Error Rate' },
  { id: 206, title: 'Request Throughput' },
  { id: 207, title: 'Request Apdex' },
  { id: 208, title: 'Request Latency' },
  { id: 209, title: 'Request Connect Time' },
  { id: 219, title: 'Request Concurrency' },
];
