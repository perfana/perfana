import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 step 2: Add metrics_source_id columns to all downstream entities
 * that currently reference application_dashboard_id.
 *
 * Strangler fig approach — both columns coexist. Code will be migrated
 * incrementally to use metrics_source_id, after which application_dashboard_id
 * can be dropped in a future migration.
 *
 * ds_metrics is a TimescaleDB hypertable with compression — must disable
 * compression before ALTER TABLE and re-enable after.
 */
export class AddMetricsSourceIdColumns1700000000014 implements MigrationInterface {
  name = 'AddMetricsSourceIdColumns1700000000014';

  /** Regular tables — straightforward ALTER TABLE */
  private readonly regularTables = [
    'benchmarks',
    'compare_filter_presets',
    'ds_adapt_results',
    'ds_adapt_tracked_results',
    'ds_change_points',
    'ds_compare_config',
    'ds_control_group_statistics',
    'ds_metric_statistics',
    'ds_panels',
    'ds_tracked_differences',
    'dynatrace_queries',
    'provisioned_template_ds_compare_configs',
    'trends_filter_presets',
  ];

  /** TimescaleDB hypertables with compression — need special handling */
  private readonly compressedHypertables = ['ds_metrics'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Regular tables
    for (const table of this.regularTables) {
      await this.addColumn(queryRunner, table);
    }

    // Compressed hypertables: decompress all chunks, disable compression, alter, re-enable, recompress
    for (const table of this.compressedHypertables) {
      // Decompress all compressed chunks first (required by TimescaleDB 2.x columnstore)
      const chunks = await queryRunner.query(`
        SELECT chunk_schema, chunk_name
        FROM timescaledb_information.chunks
        WHERE hypertable_name = '${table}' AND is_compressed = true
      `).catch(() => []);
      for (const chunk of chunks) {
        await queryRunner.query(`SELECT decompress_chunk('"${chunk.chunk_schema}"."${chunk.chunk_name}"')`);
      }

      await queryRunner.query(
        `ALTER TABLE "${table}" SET (timescaledb.compress = false)`,
      );
      await this.addColumn(queryRunner, table);
      await queryRunner.query(
        `ALTER TABLE "${table}" SET (timescaledb.compress,
          timescaledb.compress_segmentby = 'test_run_id, application_dashboard_id, panel_id, metric_name',
          timescaledb.compress_orderby = '"time" DESC')`,
      );

      // Recompress chunks
      for (const chunk of chunks) {
        await queryRunner.query(`SELECT compress_chunk('"${chunk.chunk_schema}"."${chunk.chunk_name}"')`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const allTables = [...this.compressedHypertables, ...this.regularTables].reverse();

    for (const table of this.compressedHypertables) {
      // Decompress all chunks first
      const chunks = await queryRunner.query(`
        SELECT chunk_schema, chunk_name
        FROM timescaledb_information.chunks
        WHERE hypertable_name = '${table}' AND is_compressed = true
      `).catch(() => []);
      for (const chunk of chunks) {
        await queryRunner.query(`SELECT decompress_chunk('"${chunk.chunk_schema}"."${chunk.chunk_name}"')`);
      }
      await queryRunner.query(
        `ALTER TABLE "${table}" SET (timescaledb.compress = false)`,
      );
    }

    for (const table of allTables) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "fk_${table}_metrics_source"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "idx_${table}_metrics_source_id"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "metrics_source_id"`,
      );
    }

    for (const table of this.compressedHypertables) {
      await queryRunner.query(
        `ALTER TABLE "${table}" SET (timescaledb.compress,
          timescaledb.compress_segmentby = 'test_run_id, application_dashboard_id, panel_id, metric_name',
          timescaledb.compress_orderby = '"time" DESC')`,
      );
    }
  }

  private async addColumn(queryRunner: QueryRunner, table: string): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "metrics_source_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_${table}_metrics_source_id"
       ON "${table}" ("metrics_source_id")
       WHERE "metrics_source_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "${table}"
       ADD CONSTRAINT "fk_${table}_metrics_source"
       FOREIGN KEY ("metrics_source_id")
       REFERENCES "metrics_sources" ("id")
       ON DELETE SET NULL
       NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "${table}"
       VALIDATE CONSTRAINT "fk_${table}_metrics_source"`,
    );
  }
}
