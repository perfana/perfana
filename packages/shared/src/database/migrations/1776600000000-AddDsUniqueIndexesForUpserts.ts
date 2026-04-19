import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Restores the nine ds_* unique indexes that worker pipelines depend on for
 * INSERT … ON CONFLICT upserts. AddWorkloadToEvents1776148518354.up() dropped
 * equivalents (idx_ds_metrics_upsert_key, idx_ds_control_group_stats_unique,
 * uniq_ds_compare_config_panel/_metric, and several table constraints) without
 * recreating them, so analyze/checks/ADAPT stages hit SQLSTATE 42P10 — "there
 * is no unique or exclusion constraint matching the ON CONFLICT specification"
 * — and the pipeline silently aborts, leaving ds_check_results empty.
 *
 * Each block is idempotent: it checks pg_indexes by name first. If duplicate
 * rows exist the migration fails loudly with the offending key tuple so an
 * operator can dedupe before retrying — fresh installs and the demo DB had
 * zero duplicates.
 *
 * The unique indexes sit alongside existing primary keys and non-unique
 * indexes; no existing index is dropped. ds_metrics is a TimescaleDB
 * hypertable, so the unique index includes "time" as required.
 */
export class AddDsUniqueIndexesForUpserts1776600000000 implements MigrationInterface {
  name = 'AddDsUniqueIndexesForUpserts1776600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createUniqueIndexIfMissing(
      queryRunner,
      'uniq_ds_metrics_upsert',
      'ds_metrics',
      ['test_run_id', 'application_dashboard_id', 'panel_id', 'metric_name', '"time"'],
    );

    await this.createUniqueIndexIfMissing(
      queryRunner,
      'uniq_ds_compare_config_panel',
      'ds_compare_config',
      ['system_under_test_id', 'test_environment', 'workload', 'application_dashboard_id', 'panel_id'],
      'metric_name IS NULL',
    );

    await this.createUniqueIndexIfMissing(
      queryRunner,
      'uniq_ds_compare_config_metric',
      'ds_compare_config',
      ['system_under_test_id', 'test_environment', 'workload', 'application_dashboard_id', 'panel_id', 'metric_name'],
      'metric_name IS NOT NULL',
    );

    await this.createUniqueIndexIfMissing(
      queryRunner,
      'uniq_ds_control_groups_cgid',
      'ds_control_groups',
      ['control_group_id'],
    );

    await this.createUniqueIndexIfMissing(
      queryRunner,
      'uniq_ds_metric_statistics',
      'ds_metric_statistics',
      ['test_run_id', 'application_dashboard_id', 'panel_id', 'metric_name'],
    );

    await this.createUniqueIndexIfMissing(
      queryRunner,
      'uniq_ds_control_group_statistics',
      'ds_control_group_statistics',
      ['control_group_id', 'application_dashboard_id', 'panel_id', 'metric_name'],
    );

    await this.createUniqueIndexIfMissing(
      queryRunner,
      'uniq_ds_adapt_results',
      'ds_adapt_results',
      ['test_run_id', 'control_group_id', 'application_dashboard_id', 'panel_id', 'metric_name'],
    );

    await this.createUniqueIndexIfMissing(
      queryRunner,
      'uniq_ds_adapt_conclusion',
      'ds_adapt_conclusion',
      ['test_run_id'],
    );

    await this.createUniqueIndexIfMissing(
      queryRunner,
      'uniq_ds_adapt_tracked_results',
      'ds_adapt_tracked_results',
      ['test_run_id', 'application_dashboard_id', 'panel_id', 'metric_name', 'tracked_test_run_id'],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uniq_ds_adapt_tracked_results"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uniq_ds_adapt_conclusion"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uniq_ds_adapt_results"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uniq_ds_control_group_statistics"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uniq_ds_metric_statistics"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uniq_ds_control_groups_cgid"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uniq_ds_compare_config_metric"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uniq_ds_compare_config_panel"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uniq_ds_metrics_upsert"`);
  }

  private async createUniqueIndexIfMissing(
    queryRunner: QueryRunner,
    indexName: string,
    tableName: string,
    columns: string[],
    partialPredicate?: string,
  ): Promise<void> {
    const existing = await queryRunner.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2`,
      [tableName, indexName],
    );
    if (existing.length > 0) {
      return;
    }

    const quotedCols = columns.map((c) => (c.startsWith('"') ? c : `"${c}"`));
    const groupByCols = quotedCols.join(', ');
    const wherePredicate = partialPredicate ? `WHERE ${partialPredicate}` : '';

    const dupCheck = await queryRunner.query(
      `SELECT ${groupByCols}, COUNT(*) AS cnt
       FROM "${tableName}"
       ${wherePredicate}
       GROUP BY ${groupByCols}
       HAVING COUNT(*) > 1
       LIMIT 5`,
    );
    if (dupCheck.length > 0) {
      throw new Error(
        `Cannot create unique index ${indexName}: duplicate rows exist in ${tableName} for (${columns.join(', ')}). ` +
          `Sample offending keys: ${JSON.stringify(dupCheck)}. ` +
          `Dedupe before re-running this migration.`,
      );
    }

    const createSql = `CREATE UNIQUE INDEX "${indexName}" ON "${tableName}" (${groupByCols}) ${wherePredicate}`.trim();
    await queryRunner.query(createSql);
  }
}
