import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3.2.2: Add metrics_source_id forward link on application_dashboards.
 *
 * This allows ApplicationDashboard to point to its corresponding MetricsSource,
 * enabling dual-write producers to set the link at creation time.
 *
 * Also backfills existing rows using the mapping from the backfill migration.
 */
export class AddMetricsSourceIdToApplicationDashboard1700000000016 implements MigrationInterface {
  name = 'AddMetricsSourceIdToApplicationDashboard1700000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add column
    await queryRunner.query(`
      ALTER TABLE application_dashboards
      ADD COLUMN IF NOT EXISTS metrics_source_id UUID
    `);

    // Add foreign key
    await queryRunner.query(`
      ALTER TABLE application_dashboards
      ADD CONSTRAINT fk_application_dashboards_metrics_source
      FOREIGN KEY (metrics_source_id) REFERENCES metrics_sources(id)
      ON DELETE SET NULL
      NOT VALID
    `);

    await queryRunner.query(`
      ALTER TABLE application_dashboards
      VALIDATE CONSTRAINT fk_application_dashboards_metrics_source
    `);

    // Add index
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_application_dashboards_metrics_source_id
      ON application_dashboards (metrics_source_id)
      WHERE metrics_source_id IS NOT NULL
    `);

    // Backfill: set metrics_source_id for existing rows
    await queryRunner.query(`
      UPDATE application_dashboards ad
      SET metrics_source_id = ms.id
      FROM metrics_sources ms
      WHERE ms.system_under_test_id = ad.system_under_test_id
        AND ms.test_environment = ad.test_environment
        AND ms.external_ref = ad.dashboard_uid
        AND ms.display_name = ad.dashboard_name
        AND ms.source_type = CASE
          WHEN ad.dashboard_uid LIKE 'dynatrace-%' THEN 'dynatrace'
          WHEN ad.dashboard_uid LIKE 'performance-test-metrics-%' THEN 'performance_test'
          ELSE 'grafana'
        END
        AND ad.metrics_source_id IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE application_dashboards
      DROP CONSTRAINT IF EXISTS fk_application_dashboards_metrics_source
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_application_dashboards_metrics_source_id
    `);

    await queryRunner.query(`
      ALTER TABLE application_dashboards
      DROP COLUMN IF EXISTS metrics_source_id
    `);
  }
}
