/**
 * A profile benchmark with this `source` targets the artificial
 * `Dynatrace host metrics <host>` dashboards the API writes when a HOST is mapped
 * (`createHostMetricQueries`), instead of a Grafana template. It is the Dynatrace twin of
 * `PERF_TEST_PROFILE_SOURCE`: `dashboard_uid` holds a regex over
 * `application_dashboards.dashboard_uid`, `profile_dashboard_id` is NULL, and one profile row
 * fans out to every host the system has, including hosts mapped later.
 *
 * The SLO grafana-sync provisions from it is stored with `benchmarks.source = 'dynatrace'`, the
 * value the SUT SLO dialog writes for a hand-made Dynatrace SLO, so the run view and the edit
 * dialog treat both alike.
 */
export const DYNATRACE_HOSTS_PROFILE_SOURCE = 'dynatrace-hosts';

/** `benchmarks.source` of an SLO provisioned from a `dynatrace-hosts` profile benchmark. */
export const DYNATRACE_BENCHMARK_SOURCE = 'dynatrace';

/**
 * Every host dashboard. The uid is `dynatrace-` + the sanitised label
 * `Dynatrace host metrics <host>` (`generateDynatraceDashboardUid` in the API's
 * `dynatrace.repository.ts`). Runs in Postgres (`~`, ARE dialect) — keep it to constructs both
 * engines share; the API validates it with the JS engine, grafana-sync executes it in Postgres.
 */
export const DYNATRACE_HOST_DASHBOARD_UID_PATTERN_DEFAULT = '^dynatrace-dynatrace-host-metrics-';

/**
 * Panels every host dashboard carries, by title. A host panel's real id is a hash of its
 * dashboard label and title (`generatePanelId` in `dynatrace.repository.ts`), so it differs per
 * host and cannot be stored on the profile row. The `id`s here are SYNTHETIC keys for the
 * profile form and the provisioning file only; grafana-sync maps the id to its title and reads
 * each host's real panel id from `dynatrace_queries`. Never renumber an entry — stored profile
 * benchmarks reference these ids.
 *
 * Titles mirror `HOST_METRICS` in `apps/api/src/modules/dynatrace/dynatrace.service.ts`, pinned
 * by `dynatrace-host-profile-panels.spec.ts` there. `yAxesFormat` is that list's unit.
 */
export const DYNATRACE_HOST_PROFILE_PANELS: ReadonlyArray<{ id: number; title: string; yAxesFormat: string }> = [
  { id: 1, title: 'CPU Usage', yAxesFormat: 'percent' },
  { id: 2, title: 'Memory Usage', yAxesFormat: 'percent' },
  { id: 3, title: 'Disk Read Latency', yAxesFormat: 'ms' },
  { id: 4, title: 'Disk Write Latency', yAxesFormat: 'ms' },
  { id: 5, title: 'Disk Read Operations', yAxesFormat: 'iops' },
  { id: 6, title: 'Disk Write Operations', yAxesFormat: 'iops' },
  { id: 7, title: 'Disk Queue Length', yAxesFormat: 'none' },
  { id: 8, title: 'Network Traffic', yAxesFormat: 'bytes' },
  // Hosts mapped before v0.2.96.22 still carry this query and are not migrated (it was
  // replaced by the latency/IOPS/queue set above). Kept so a profile can still cover them.
  { id: 9, title: 'Disk Utilization', yAxesFormat: 'percent' },
];

/** The host panel title a synthetic profile panel id stands for, or undefined. */
export function dynatraceHostPanelTitle(panelId: number | null | undefined): string | undefined {
  return DYNATRACE_HOST_PROFILE_PANELS.find((p) => p.id === panelId)?.title;
}
