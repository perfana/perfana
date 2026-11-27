/**
 * A profile benchmark with this `source` targets the artificial Loki dashboards the API writes for
 * a workload's Loki panels (`ensureArtificialDashboard` in `apps/api/src/modules/loki`): the Loki
 * twin of `SPLUNK_PROFILE_SOURCE`. `dashboard_uid` holds a regex over
 * `application_dashboards.dashboard_uid`, `profile_dashboard_id` is NULL, and the row is keyed on
 * `panel_title` (Loki panels are user-authored per workload, so their ids differ per workload);
 * grafana-sync reads each workload's panel id from its `loki_queries` row with that title.
 *
 * The SLO grafana-sync provisions from it is stored with `benchmarks.source = 'loki'`.
 */
export const LOKI_PROFILE_SOURCE = 'loki-panels';

/** `benchmarks.source` of an SLO provisioned from a `loki-panels` profile benchmark. */
export const LOKI_BENCHMARK_SOURCE = 'loki';

/**
 * Every Loki dashboard. The uid is `loki-` + the slugged dashboard label. Runs in Postgres (`~`,
 * ARE dialect): keep it to constructs both engines share.
 */
export const LOKI_DASHBOARD_UID_PATTERN_DEFAULT = '^loki-';

/** The panels POST /loki/queries/starter creates, and what a profile SLO can target before any exist. */
export const LOKI_STARTER_PANEL_TITLES = ['Log lines by level', 'Error lines by service', 'Log volume by service'] as const;
