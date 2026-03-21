import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop redundant indexes on ds_metrics to speed up bulk INSERTs.
 *
 * With 10 indexes, every INSERT must maintain all 10 B-trees. Dropping
 * redundant/unused ones reduces write amplification by ~50%.
 *
 * DROPPED (5 of 10):
 * - idx_ds_metrics_test_run_id (test_run_id)
 *     Prefix of idx_ds_metrics_test_run_time (test_run_id, time DESC)
 *
 * - idx_ds_metrics_application_dashboard_id (application_dashboard_id)
 *     Prefix of idx_ds_metrics_dashboard_panel_metric_time
 *     (application_dashboard_id, panel_id, metric_name, time DESC)
 *
 * - idx_ds_metrics_composite (test_run_id, application_dashboard_id, panel_id)
 *     Prefix of both PK and idx_ds_metrics_upsert_key
 *
 * - idx_ds_metrics_organization_id (organization_id)
 *     No query path filters ds_metrics by organization_id alone;
 *     RBAC filtering happens via test_runs JOIN
 *
 * - idx_ds_metrics_team_id (team_id)
 *     Same as organization_id — no direct filter path
 *
 * KEPT (5 of 10):
 * - PK_ced55abef6ba73d0d1e86a9660d (TypeORM composite PK)
 * - idx_ds_metrics_upsert_key (used for ON CONFLICT in incremental inserts)
 * - idx_ds_metrics_test_run_time (StatisticsPipeline, time-range queries)
 * - idx_ds_metrics_dashboard_panel_metric_time (panel data queries)
 * - idx_ds_metrics_metric_name_time (metric lookup queries)
 */
export class DropRedundantDsMetricsIndexes1700000000007 implements MigrationInterface {
  name = 'DropRedundantDsMetricsIndexes1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metrics_test_run_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metrics_application_dashboard_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metrics_composite`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metrics_organization_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metrics_team_id`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ds_metrics_test_run_id ON ds_metrics USING btree (test_run_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ds_metrics_application_dashboard_id ON ds_metrics USING btree (application_dashboard_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ds_metrics_composite ON ds_metrics USING btree (test_run_id, application_dashboard_id, panel_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ds_metrics_organization_id ON ds_metrics USING btree (organization_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ds_metrics_team_id ON ds_metrics USING btree (team_id)`);
  }
}
