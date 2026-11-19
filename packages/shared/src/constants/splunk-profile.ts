/**
 * A profile benchmark with this `source` targets the artificial Splunk dashboards the API writes
 * for a workload's Splunk queries (`ensureArtificialDashboard` in `apps/api/src/modules/splunk`),
 * instead of a Grafana template. It is the Splunk twin of `DYNATRACE_HOSTS_PROFILE_SOURCE`:
 * `dashboard_uid` holds a regex over `application_dashboards.dashboard_uid`,
 * `profile_dashboard_id` is NULL, and one profile row fans out to every Splunk dashboard of every
 * workload the system has, including panels added later.
 *
 * Unlike the Dynatrace host panels, Splunk panels are user-authored per workload: there is no
 * fixed panel list and a panel's id is whatever `nextPanelId` handed out in that workload. The
 * profile row is therefore keyed on `panel_title` (its `panel_id` stays NULL) and grafana-sync
 * reads each workload's real panel id from its `splunk_queries` row with that title.
 *
 * The SLO grafana-sync provisions from it is stored with `benchmarks.source = 'splunk'`.
 */
export const SPLUNK_PROFILE_SOURCE = 'splunk-panels';

/** `benchmarks.source` of an SLO provisioned from a `splunk-panels` profile benchmark. */
export const SPLUNK_BENCHMARK_SOURCE = 'splunk';

/**
 * Every Splunk dashboard. The uid is `splunk-` + the slugged dashboard label. Runs in Postgres
 * (`~`, ARE dialect) — keep it to constructs both engines share; the API validates it with the JS
 * engine, grafana-sync executes it in Postgres.
 */
export const SPLUNK_DASHBOARD_UID_PATTERN_DEFAULT = '^splunk-';
