import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enable TimescaleDB compression on all hypertables and add automatic
 * compression policies (compress chunks older than 7 days).
 *
 * Hypertables affected:
 * - ds_metrics          (segmentby: test_run_id, application_dashboard_id, panel_id, metric_name)
 * - requests_raw        (segmentby: test_run_id, transaction_name)
 * - requests_error      (segmentby: test_run_id, transaction_name)
 * - transactions        (segmentby: test_run_id, transaction_name)
 * - virtual_users       (segmentby: test_run_id, scenario_name)
 *
 * Compression segmentby columns are chosen to match the most common
 * WHERE-clause filters, keeping decompression scoped to the smallest
 * possible set of rows.
 */
export class AddTimescaleDBCompressionPolicies1700000000010
  implements MigrationInterface
{
  name = 'AddTimescaleDBCompressionPolicies1700000000010';

  private readonly compressAfter = '7 days';

  private readonly tables = [
    {
      name: 'ds_metrics',
      segmentby: 'test_run_id, application_dashboard_id, panel_id, metric_name',
      orderby: '"time" DESC',
    },
    {
      name: 'requests_raw',
      segmentby: 'test_run_id, transaction_name',
      orderby: '"time" DESC',
    },
    {
      name: 'requests_error',
      segmentby: 'test_run_id, transaction_name',
      orderby: '"time" DESC',
    },
    {
      name: 'transactions',
      segmentby: 'test_run_id, transaction_name',
      orderby: '"time" DESC',
    },
    {
      name: 'virtual_users',
      segmentby: 'test_run_id, scenario_name',
      orderby: '"time" DESC',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      // Verify this is actually a hypertable before configuring compression
      const [{ is_hypertable }] = await queryRunner.query(`
        SELECT EXISTS (
          SELECT 1 FROM timescaledb_information.hypertables
          WHERE hypertable_name = '${table.name}'
        ) AS is_hypertable
      `);

      if (!is_hypertable) {
        console.log(
          `  Skipping ${table.name} — not a hypertable`,
        );
        continue;
      }

      // Enable compression settings
      await queryRunner.query(`
        ALTER TABLE ${table.name} SET (
          timescaledb.compress,
          timescaledb.compress_segmentby = '${table.segmentby}',
          timescaledb.compress_orderby = '${table.orderby}'
        )
      `);

      // Add automatic compression policy (idempotent)
      await queryRunner.query(`
        SELECT add_compression_policy('${table.name}',
          compress_after => INTERVAL '${this.compressAfter}',
          if_not_exists => TRUE
        )
      `);

      console.log(
        `  Enabled compression on ${table.name} (after ${this.compressAfter})`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      // Remove compression policy
      await queryRunner.query(`
        SELECT remove_compression_policy('${table.name}', if_exists => TRUE)
      `);

      // Decompress all compressed chunks before disabling compression
      const chunks = await queryRunner.query(`
        SELECT chunk_name, chunk_schema
        FROM timescaledb_information.chunks
        WHERE hypertable_name = '${table.name}'
          AND is_compressed = true
      `);

      for (const chunk of chunks) {
        await queryRunner.query(
          `SELECT decompress_chunk('${chunk.chunk_schema}.${chunk.chunk_name}')`,
        );
      }

      // Disable compression
      await queryRunner.query(`
        ALTER TABLE ${table.name} SET (timescaledb.compress = false)
      `);

      console.log(`  Disabled compression on ${table.name}`);
    }
  }
}
