import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ensure ds_metrics is a TimescaleDB hypertable and remove redundant indexes.
 *
 * The ConsolidatedSchema migration (Phase 4) attempts hypertable conversion but
 * silently catches errors. This guarantees the conversion, then drops indexes
 * that are redundant once chunk exclusion handles time-based filtering.
 *
 * DROPPED (ds_metrics — 7 of 16):
 * - ds_metrics_time_idx (time DESC)            — chunk exclusion replaces this
 * - idx_ds_metrics_time (time ASC)             — chunk exclusion replaces this
 * - idx_ds_metrics_panel_id (panel_id)         — prefix of idx_ds_metrics_composite
 * - idx_ds_metrics_panel_time (panel_id, time) — covered by idx_ds_metrics_dashboard_panel_metric_time
 * - idx_ds_metrics_value (value)               — not useful for any query pattern
 * - idx_ds_metrics_created_by (created_by)     — not used in any query path
 * - idx_ds_metrics_metric_name (metric_name)   — prefix of idx_ds_metrics_metric_name_time
 *
 * DROPPED (ds_metric_statistics — 1):
 * - idx_ds_metric_stats_test_run (test_run_id) — duplicate of idx_ds_metric_statistics_test_run_id
 */
export class RemoveRedundantIndexes1700000000006 implements MigrationInterface {
  name = 'RemoveRedundantIndexes1700000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Ensure ds_metrics is a hypertable (idempotent — no-op if already converted)
    await queryRunner.query(`
      SELECT create_hypertable('ds_metrics', 'time',
        chunk_time_interval => INTERVAL '7 days',
        if_not_exists => TRUE,
        migrate_data => TRUE
      )
    `);

    // Drop redundant ds_metrics indexes
    await queryRunner.query(`DROP INDEX IF EXISTS ds_metrics_time_idx`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metrics_time`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metrics_panel_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metrics_panel_time`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metrics_value`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metrics_created_by`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metrics_metric_name`);

    // Drop duplicate ds_metric_statistics index
    await queryRunner.query(`DROP INDEX IF EXISTS idx_ds_metric_stats_test_run`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS ds_metrics_time_idx ON ds_metrics USING btree ("time" DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ds_metrics_time ON ds_metrics USING btree ("time")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ds_metrics_panel_id ON ds_metrics USING btree (panel_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ds_metrics_panel_time ON ds_metrics USING btree (panel_id, "time" DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ds_metrics_value ON ds_metrics USING btree (value)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ds_metrics_created_by ON ds_metrics USING btree (created_by)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ds_metrics_metric_name ON ds_metrics USING btree (metric_name)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ds_metric_stats_test_run ON ds_metric_statistics USING btree (test_run_id)`);
  }
}
