import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop narrow unique constraints on ds_compare_config that only cover
 * (application_dashboard_id, panel_id[, metric_name]).
 *
 * These old constraints prevent saving configs for the same dashboard+panel
 * when different (system_under_test_id, test_environment, workload) combos
 * share the same application_dashboard. The wider unique indexes
 * (uniq_ds_compare_config_panel / uniq_ds_compare_config_metric) already
 * enforce uniqueness correctly.
 */
export class DropNarrowCompareConfigUniqueConstraints1700000000019 implements MigrationInterface {
  name = 'DropNarrowCompareConfigUniqueConstraints1700000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the old narrow unique indexes if they exist
    await queryRunner.query(`
      DROP INDEX IF EXISTS ds_compare_config_panel_level_unique
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS ds_compare_config_metric_level_unique
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-create the old narrow unique indexes
    await queryRunner.query(`
      CREATE UNIQUE INDEX ds_compare_config_panel_level_unique
      ON ds_compare_config (application_dashboard_id, panel_id)
      WHERE metric_name IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX ds_compare_config_metric_level_unique
      ON ds_compare_config (application_dashboard_id, panel_id, metric_name)
      WHERE metric_name IS NOT NULL
    `);
  }
}
