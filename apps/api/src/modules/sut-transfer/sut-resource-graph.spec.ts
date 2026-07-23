import { SUT_RESOURCES, selectResources, SutResource } from './sut-resource-graph';

const idx = (table: string): number => SUT_RESOURCES.findIndex((r) => r.table === table);

describe('SUT_RESOURCES', () => {
  it('lists every SUT-keyed table exactly once', () => {
    const tables = SUT_RESOURCES.map((r) => r.table);
    expect(new Set(tables).size).toBe(tables.length);
    // Drift guard: this is the full set the delete handler touches, plus shared refs.
    // If you add a table to the delete cascade, add it here too.
    const expected = [
      'pyroscope_instances', 'grafana_instances', 'grafana_dashboards', 'dynatrace_configs',
      'report_templates',
      'systems_under_test', 'metrics_sources', 'test_runs', 'application_dashboards',
      'benchmarks', 'expected_config_changes', 'events', 'tracing_services',
      'deep_links', 'notification_channels', 'dynatrace_entity_mappings',
      'dynatrace_queries', 'workload_apdex_thresholds', 'workload_transaction_apdex_thresholds',
      'system_under_test_test_environments', 'system_under_test_workloads',
      'scaling_sessions', 'sparse_metric_exclusions', 'alert_tag_filters',
      'trends_filter_presets', 'compare_filter_presets',
      'ds_compare_config', 'provisioned_template_ds_compare_configs',
      'ds_control_groups', 'ds_control_group_statistics',
      'ds_metrics', 'test_run_configs', 'awr_reports', 'generated_reports',
      'test_run_alerts', 'test_run_events', 'graph_presets',
      'requests_raw', 'requests_error', 'transactions', 'virtual_users',
      'ds_adapt_results', 'ds_adapt_conclusion', 'ds_adapt_tracked_results',
      'ds_change_points', 'check_results', 'ds_metric_statistics',
      'ds_metric_collection_status', 'ds_panels', 'ds_query_executions',
      'ds_tracked_differences', 'test_run_transaction_stats',
    ].sort();
    expect([...tables].sort()).toEqual(expected);
  });

  it('orders parents before children (FK-safe insert order)', () => {
    expect(idx('pyroscope_instances')).toBeLessThan(idx('systems_under_test'));
    expect(idx('grafana_instances')).toBeLessThan(idx('application_dashboards'));
    expect(idx('grafana_dashboards')).toBeLessThan(idx('application_dashboards'));
    expect(idx('systems_under_test')).toBeLessThan(idx('metrics_sources'));
    expect(idx('metrics_sources')).toBeLessThan(idx('test_runs'));
    expect(idx('metrics_sources')).toBeLessThan(idx('application_dashboards'));
    expect(idx('metrics_sources')).toBeLessThan(idx('benchmarks'));
    expect(idx('application_dashboards')).toBeLessThan(idx('benchmarks'));
    expect(idx('application_dashboards')).toBeLessThan(idx('trends_filter_presets'));
    expect(idx('test_runs')).toBeLessThan(idx('ds_metrics'));
    expect(idx('test_runs')).toBeLessThan(idx('check_results'));
    expect(idx('ds_control_groups')).toBeLessThan(idx('ds_control_group_statistics'));
    expect(idx('system_under_test_test_environments')).toBeLessThan(idx('system_under_test_workloads'));
    expect(idx('test_runs')).toBeLessThan(idx('test_run_transaction_stats'));
    expect(idx('dynatrace_configs')).toBeLessThan(idx('dynatrace_entity_mappings'));
    expect(idx('dynatrace_configs')).toBeLessThan(idx('dynatrace_queries'));
    expect(idx('application_dashboards')).toBeLessThan(idx('ds_control_group_statistics'));
    // report_templates is the NOT NULL FK parent of generated_reports.template_id.
    expect(idx('report_templates')).toBeLessThan(idx('generated_reports'));
  });

  it('raw tables are excluded unless includeRaw', () => {
    const withoutRaw = selectResources({ includeOptional: true, includeRaw: false }).map((r) => r.table);
    expect(withoutRaw).not.toContain('requests_raw');
    expect(withoutRaw).toContain('ds_metrics'); // core, always present
    const withRaw = selectResources({ includeOptional: true, includeRaw: true }).map((r) => r.table);
    expect(withRaw).toContain('requests_raw');
  });

  it('optional tables are excluded unless includeOptional, but core+shared always present', () => {
    const coreOnly = selectResources({ includeOptional: false, includeRaw: false });
    const tables = coreOnly.map((r) => r.table);
    expect(tables).not.toContain('events'); // optional
    expect(tables).toContain('systems_under_test'); // core
    expect(tables).toContain('grafana_instances'); // shared
    expect(coreOnly.every((r: SutResource) => r.group === 'core' || r.group === 'shared')).toBe(true);
  });

  it('selectResources preserves SUT_RESOURCES order', () => {
    const selected = selectResources({ includeOptional: true, includeRaw: true }).map((r) => r.table);
    const full = SUT_RESOURCES.map((r) => r.table);
    // selected is full here (everything included); order must match
    expect(selected).toEqual(full);
  });
});
