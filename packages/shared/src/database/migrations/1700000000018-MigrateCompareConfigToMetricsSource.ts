import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3.7.2+3: Backfill metrics_source_id on ds_compare_config
 *
 * The column already exists (added in Phase 3.2, migration 0014) and was
 * partially backfilled in migration 0017. This migration ensures any
 * remaining rows are backfilled from the application_dashboards forward link,
 * covering rows that may have been inserted between migrations.
 */
export class MigrateCompareConfigToMetricsSource1700000000018 implements MigrationInterface {
  name = 'MigrateCompareConfigToMetricsSource1700000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backfill metrics_source_id from application_dashboards forward link
    await queryRunner.query(`
      UPDATE ds_compare_config dcc
      SET metrics_source_id = ad.metrics_source_id
      FROM application_dashboards ad
      WHERE dcc.application_dashboard_id = ad.id
        AND ad.metrics_source_id IS NOT NULL
        AND (dcc.metrics_source_id IS NULL OR dcc.metrics_source_id != ad.metrics_source_id)
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op: we don't clear metrics_source_id on rollback since it was
    // already populated by earlier migrations. The column itself is managed
    // by migration 0014.
  }
}
