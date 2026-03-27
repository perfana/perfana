import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix autovacuum throttling on ds_metrics and transactions tables.
 *
 * Migration 1700000000020 set autovacuum_vacuum_cost_delay = 20ms on ds_metrics
 * to reduce I/O contention during writes. However, this is 10x slower than the
 * global default (2ms), causing dead tuple buildup and stale visibility maps.
 * The result: index-only scans on hot chunks degrade to heap fetches (46% of
 * rows), producing 68.5s query times on the transaction_buckets CTE.
 *
 * Fix: set cost_delay back to 2ms (match global) and lower scale factors so
 * vacuum runs more frequently in smaller batches. Also tune the transactions
 * table which suffers the same hot-chunk visibility map staleness.
 *
 * IMPORTANT: Both ds_metrics and transactions are TimescaleDB hypertables.
 * ALTER TABLE SET on the parent only affects NEW chunks. Existing chunks keep
 * their old reloptions. We must propagate settings to all existing chunks too.
 */
export class FixAutovacuumThrottling1700000000021 implements MigrationInterface {
  name = 'FixAutovacuumThrottling1700000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fix ds_metrics parent table (affects new chunks)
    await queryRunner.query(`
      ALTER TABLE ds_metrics SET (
        autovacuum_vacuum_cost_delay = 2,
        autovacuum_vacuum_scale_factor = 0.02,
        autovacuum_analyze_scale_factor = 0.02
      )
    `);

    // Propagate to all existing ds_metrics chunks
    await queryRunner.query(`
      DO $$
      DECLARE
        chunk_name text;
      BEGIN
        FOR chunk_name IN
          SELECT format('%I.%I', chunk_schema, chunk_name)
          FROM timescaledb_information.chunks
          WHERE hypertable_name = 'ds_metrics'
        LOOP
          EXECUTE format(
            'ALTER TABLE %s SET (
              autovacuum_vacuum_cost_delay = 2,
              autovacuum_vacuum_scale_factor = 0.02,
              autovacuum_analyze_scale_factor = 0.02
            )', chunk_name
          );
        END LOOP;
      END $$
    `);

    // Tune transactions parent table (affects new chunks)
    await queryRunner.query(`
      ALTER TABLE transactions SET (
        autovacuum_vacuum_cost_delay = 2,
        autovacuum_vacuum_scale_factor = 0.02,
        autovacuum_analyze_scale_factor = 0.02
      )
    `);

    // Propagate to all existing transactions chunks
    await queryRunner.query(`
      DO $$
      DECLARE
        chunk_name text;
      BEGIN
        FOR chunk_name IN
          SELECT format('%I.%I', chunk_schema, chunk_name)
          FROM timescaledb_information.chunks
          WHERE hypertable_name = 'transactions'
        LOOP
          EXECUTE format(
            'ALTER TABLE %s SET (
              autovacuum_vacuum_cost_delay = 2,
              autovacuum_vacuum_scale_factor = 0.02,
              autovacuum_analyze_scale_factor = 0.02
            )', chunk_name
          );
        END LOOP;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert transactions parent + chunks to defaults
    await queryRunner.query(`
      ALTER TABLE transactions RESET (
        autovacuum_vacuum_cost_delay,
        autovacuum_vacuum_scale_factor,
        autovacuum_analyze_scale_factor
      )
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        chunk_name text;
      BEGIN
        FOR chunk_name IN
          SELECT format('%I.%I', chunk_schema, chunk_name)
          FROM timescaledb_information.chunks
          WHERE hypertable_name = 'transactions'
        LOOP
          EXECUTE format(
            'ALTER TABLE %s RESET (
              autovacuum_vacuum_cost_delay,
              autovacuum_vacuum_scale_factor,
              autovacuum_analyze_scale_factor
            )', chunk_name
          );
        END LOOP;
      END $$
    `);

    // Revert ds_metrics parent + chunks to the previous migration's values
    await queryRunner.query(`
      ALTER TABLE ds_metrics SET (
        autovacuum_vacuum_cost_delay = 20,
        autovacuum_vacuum_scale_factor = 0.1,
        autovacuum_analyze_scale_factor = 0.1
      )
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        chunk_name text;
      BEGIN
        FOR chunk_name IN
          SELECT format('%I.%I', chunk_schema, chunk_name)
          FROM timescaledb_information.chunks
          WHERE hypertable_name = 'ds_metrics'
        LOOP
          EXECUTE format(
            'ALTER TABLE %s SET (
              autovacuum_vacuum_cost_delay = 20,
              autovacuum_vacuum_scale_factor = 0.1,
              autovacuum_analyze_scale_factor = 0.1
            )', chunk_name
          );
        END LOOP;
      END $$
    `);
  }
}
