import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4: close the null-org escape hatch.
 *
 * Greenfield deployment — no backfill needed (no production data exists with
 * `organization_id IS NULL` that we want to preserve). Each owned-resource
 * table flips `organization_id` to NOT NULL. After this lands, services no
 * longer need to defend against null-org rows.
 *
 * Excluded from this migration (intentionally still nullable):
 * - `audit_logs.organization_id` — system-level events (signup, system startup,
 *   cross-org admin actions) legitimately have no org context.
 * - `test_runs.organization_id` — column is vestigial; access is checked via
 *   the joined `systems_under_test.organization_id`. The TestRun entity itself
 *   does not own this column for authorization purposes.
 */
export class OrganizationIdNotNull1777700000000 implements MigrationInterface {
  name = 'OrganizationIdNotNull1777700000000';

  private readonly tables = [
    'alert_tag_filters',
    'api_keys',
    'application_dashboards',
    'benchmarks',
    'compare_filter_presets',
    'deep_links',
    'dynatrace_configs',
    'dynatrace_entity_mappings',
    'dynatrace_queries',
    'events',
    'expected_config_changes',
    'generic_deep_links',
    'grafana_dashboards',
    'grafana_instances',
    'graph_presets',
    'metrics_sources',
    'notification_channels',
    'profile_benchmarks',
    'profile_grafana_dashboards',
    'profiles',
    'pyroscope_instances',
    'report_templates',
    'sparse_metric_exclusions',
    'systems_under_test',
    'tracing_instances',
    'tracing_services',
    'trends_filter_presets',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      await queryRunner.query(
        `ALTER TABLE ${table} ALTER COLUMN organization_id SET NOT NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...this.tables].reverse()) {
      await queryRunner.query(
        `ALTER TABLE ${table} ALTER COLUMN organization_id DROP NOT NULL`,
      );
    }
  }
}
