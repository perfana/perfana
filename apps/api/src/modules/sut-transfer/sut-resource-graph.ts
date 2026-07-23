type SutFilter = 'bySut' | 'byTestRunVarchar' | 'byTestRunUuid' | 'byAppDashboard' | 'byTestEnvironment' | 'byReference';
type SutGroup = 'core' | 'optional' | 'raw' | 'shared';

export interface SutResource {
  table: string;
  filter: SutFilter;
  group: SutGroup;
  /** Only for group: 'shared' (filter: 'byReference'). $1 = sutId. Must SELECT row_to_json(t) AS r. */
  customSql?: string;
}

// Insert (dependency) order. This is the REVERSE of the delete cascade in
// apps/api/src/modules/systems-under-test/handlers/delete-system-under-test.handler.ts.
// Keep the two in sync: adding a table to the delete cascade means adding it here.
export const SUT_RESOURCES: SutResource[] = [
  // --- shared reference rows (must exist before the SUT / dashboards) ---
  { table: 'pyroscope_instances', filter: 'byReference', group: 'shared',
    customSql: `SELECT row_to_json(t) AS r FROM pyroscope_instances t
                WHERE t.id = (SELECT pyroscope_instance_id FROM systems_under_test WHERE id = $1)` },
  // Note: DISTINCT must apply to the real row (via a subquery), not to the
  // row_to_json() result — Postgres' plain `json` type has no equality
  // operator, so `SELECT DISTINCT row_to_json(t)` fails with error 42883.
  { table: 'grafana_instances', filter: 'byReference', group: 'shared',
    customSql: `SELECT row_to_json(t) AS r FROM (
                  SELECT DISTINCT gi.* FROM grafana_instances gi
                  JOIN application_dashboards ad ON ad.grafana_instance_id = gi.id
                  WHERE ad.system_under_test_id = $1
                ) t` },
  { table: 'grafana_dashboards', filter: 'byReference', group: 'shared',
    customSql: `SELECT row_to_json(t) AS r FROM (
                  SELECT DISTINCT gd.* FROM grafana_dashboards gd
                  JOIN application_dashboards ad ON ad.grafana_dashboard_id = gd.id
                  WHERE ad.system_under_test_id = $1
                ) t` },
  // dynatrace_entity_mappings and dynatrace_queries both FK into
  // dynatrace_configs (discovered via FK-discovery, see sut-resource-graph.spec.ts).
  // t.id is the PK, so IN(...) already dedupes without needing DISTINCT.
  { table: 'dynatrace_configs', filter: 'byReference', group: 'shared',
    customSql: `SELECT row_to_json(t) AS r FROM dynatrace_configs t
                WHERE t.id IN (
                  SELECT dynatrace_config_id FROM dynatrace_entity_mappings WHERE system_under_test_id = $1
                  UNION
                  SELECT dynatrace_config_id FROM dynatrace_queries WHERE system_under_test_id = $1
                )` },
  // generated_reports.template_id → report_templates(id) is NOT NULL, so the
  // parent template must ship in the bundle or the import FK-violates. Templates
  // are scoped by system_id (SUT name) but can also be '*' (global, shared across
  // SUTs), so we can't filter by name — export exactly the templates referenced
  // by this SUT's generated_reports (superset of the selected runs → full cover).
  // Shared (not SUT-owned): imported ON CONFLICT DO NOTHING and, like
  // grafana_dashboards, deliberately NOT removed by the SUT delete cascade.
  { table: 'report_templates', filter: 'byReference', group: 'shared',
    customSql: `SELECT row_to_json(t) AS r FROM report_templates t
                WHERE t.id IN (
                  SELECT DISTINCT gr.template_id FROM generated_reports gr
                  JOIN test_runs tr ON tr.id = gr.test_run_id
                  WHERE tr.system_under_test_id = $1
                )` },

  // --- the SUT itself ---
  { table: 'systems_under_test', filter: 'bySut', group: 'core' },

  // --- metrics_sources FIRST among SUT children (NO ACTION FK; dependents need it) ---
  { table: 'metrics_sources', filter: 'bySut', group: 'core' },

  // --- test runs (parents of all per-run data) ---
  { table: 'test_runs', filter: 'bySut', group: 'core' },

  // --- application dashboards (depend on grafana + metrics_sources) ---
  { table: 'application_dashboards', filter: 'bySut', group: 'core' },

  // --- remaining SUT children ---
  { table: 'benchmarks', filter: 'bySut', group: 'core' },
  { table: 'expected_config_changes', filter: 'bySut', group: 'optional' },
  { table: 'events', filter: 'bySut', group: 'optional' },
  { table: 'tracing_services', filter: 'bySut', group: 'optional' },
  { table: 'deep_links', filter: 'bySut', group: 'optional' },
  { table: 'notification_channels', filter: 'bySut', group: 'optional' },
  { table: 'dynatrace_entity_mappings', filter: 'bySut', group: 'optional' },
  { table: 'dynatrace_queries', filter: 'bySut', group: 'optional' },
  { table: 'workload_apdex_thresholds', filter: 'bySut', group: 'optional' },
  { table: 'workload_transaction_apdex_thresholds', filter: 'bySut', group: 'optional' },
  { table: 'system_under_test_test_environments', filter: 'bySut', group: 'optional' },
  { table: 'system_under_test_workloads', filter: 'byTestEnvironment', group: 'optional' },
  { table: 'scaling_sessions', filter: 'bySut', group: 'optional' },
  { table: 'sparse_metric_exclusions', filter: 'bySut', group: 'optional' },
  { table: 'alert_tag_filters', filter: 'bySut', group: 'optional' },
  { table: 'trends_filter_presets', filter: 'byAppDashboard', group: 'optional' },
  { table: 'compare_filter_presets', filter: 'byAppDashboard', group: 'optional' },

  // --- DS SUT-scoped tables ---
  { table: 'ds_compare_config', filter: 'bySut', group: 'core' },
  { table: 'provisioned_template_ds_compare_configs', filter: 'bySut', group: 'core' },
  { table: 'ds_control_groups', filter: 'bySut', group: 'core' },
  // Note: this table has no system_under_test_id column of its own; it hangs
  // off application_dashboards (see \d ds_control_group_statistics).
  { table: 'ds_control_group_statistics', filter: 'byAppDashboard', group: 'core' },

  // --- per-test-run child data (uuid key) ---
  { table: 'ds_metrics', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'test_run_configs', filter: 'byTestRunUuid', group: 'core' },
  { table: 'awr_reports', filter: 'byTestRunUuid', group: 'optional' },
  { table: 'generated_reports', filter: 'byTestRunUuid', group: 'optional' },
  { table: 'test_run_alerts', filter: 'byTestRunUuid', group: 'optional' },
  { table: 'test_run_events', filter: 'byTestRunUuid', group: 'optional' },
  { table: 'graph_presets', filter: 'byTestRunVarchar', group: 'optional' },

  // --- raw sample hypertables (off by default) ---
  { table: 'requests_raw', filter: 'byTestRunVarchar', group: 'raw' },
  { table: 'requests_error', filter: 'byTestRunVarchar', group: 'raw' },
  { table: 'transactions', filter: 'byTestRunVarchar', group: 'raw' },
  { table: 'virtual_users', filter: 'byTestRunVarchar', group: 'raw' },

  // --- DS per-test-run analysis tables ---
  { table: 'ds_adapt_results', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_adapt_conclusion', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_adapt_tracked_results', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_change_points', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'check_results', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_metric_statistics', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'test_run_transaction_stats', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_metric_collection_status', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_panels', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_query_executions', filter: 'byTestRunUuid', group: 'core' },
  { table: 'ds_tracked_differences', filter: 'byTestRunUuid', group: 'core' },
];

export function selectResources(opts: { includeOptional: boolean; includeRaw: boolean }): SutResource[] {
  return SUT_RESOURCES.filter((r) => {
    if (r.group === 'core' || r.group === 'shared') return true;
    if (r.group === 'optional') return opts.includeOptional;
    if (r.group === 'raw') return opts.includeRaw;
    return false;
  });
}
