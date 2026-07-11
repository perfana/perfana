export type SutFilter = 'bySut' | 'byTestRunVarchar' | 'byTestRunUuid' | 'byAppDashboard' | 'byTestEnvironment' | 'byReference';
export type SutGroup = 'core' | 'optional' | 'raw' | 'shared';

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
  { table: 'grafana_instances', filter: 'byReference', group: 'shared',
    customSql: `SELECT DISTINCT row_to_json(t) AS r FROM grafana_instances t
                JOIN application_dashboards ad ON ad.grafana_instance_id = t.id
                WHERE ad.system_under_test_id = $1` },
  { table: 'grafana_dashboards', filter: 'byReference', group: 'shared',
    customSql: `SELECT DISTINCT row_to_json(t) AS r FROM grafana_dashboards t
                JOIN application_dashboards ad ON ad.grafana_dashboard_id = t.id
                WHERE ad.system_under_test_id = $1` },

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
  { table: 'ds_control_group_statistics', filter: 'bySut', group: 'core' },

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
