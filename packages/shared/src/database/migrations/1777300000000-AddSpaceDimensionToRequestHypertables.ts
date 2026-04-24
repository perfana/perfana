import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a by_hash('system_under_test', N) space dimension to the three large
 * request hypertables (requests_raw, requests_error, transactions) so that
 * SUT-filtered queries and maintenance operations prune chunks down to the
 * buckets that can actually contain matching rows.
 *
 * Scope: fresh-install / new-chunk behavior only. `add_dimension` applies
 * the new partitioning to chunks that are created *after* the migration
 * runs; existing chunks keep their single-partition layout. Operators who
 * want retroactive partitioning must follow the rebuild procedure in
 * docs-site/content/Operations/Hypertable Space Rebuild.md.
 *
 * Partition count: defaults to 4. Set HYPERTABLE_SPACE_PARTITIONS in the
 * API/worker env to a different value (2–64) at migration time to override.
 * N=1 is rejected because by_hash(..., 1) is functionally identical to no
 * space dimension but saddles the hypertable with permanent dimension
 * metadata and makes future adjustments awkward — if you want to skip space
 * partitioning, don't run the migration at all. Once applied, use
 * TimescaleDB's `set_number_partitions()` to change the count later;
 * re-running this migration will not adjust an existing dimension (the
 * skip-log includes the current partition count so mismatches are visible).
 *
 * Idempotent: passes `if_not_exists => TRUE` and additionally checks the
 * timescaledb_information.dimensions view so re-running on an
 * already-partitioned hypertable is a no-op. Each table is wrapped in a
 * savepoint so a failure on one table (e.g. older TimescaleDB versions
 * rejecting the add on a hypertable with compressed chunks) does not
 * abort the migration — the failure is logged with a pointer to the
 * rebuild runbook and the next table is attempted.
 *
 * Compression interaction: the existing compression segmentby columns
 * (test_run_id, transaction_name) remain in effect. Space partitioning
 * operates at chunk-boundary level and is orthogonal to per-chunk
 * compression layout.
 */
export class AddSpaceDimensionToRequestHypertables1777300000000
  implements MigrationInterface
{
  name = 'AddSpaceDimensionToRequestHypertables1777300000000';

  private readonly tables = [
    'requests_raw',
    'requests_error',
    'transactions',
  ] as const;

  private readonly spaceColumn = 'system_under_test';

  private readonly partitions = parseSpacePartitions(
    process.env.HYPERTABLE_SPACE_PARTITIONS,
  );

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ has_timescaledb }] = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS has_timescaledb`,
    );

    if (!has_timescaledb) {
      console.log(
        '  TimescaleDB not available — skipping space dimension',
      );
      return;
    }

    const skipped: string[] = [];
    let poisonedTx = false;

    for (const table of this.tables) {
      if (poisonedTx) {
        skipped.push(`${table} (skipped: earlier savepoint cleanup failed)`);
        continue;
      }

      const savepoint = `sp_${table}_space_dim`;
      try {
        await queryRunner.query(`SAVEPOINT ${savepoint}`);

        const [{ is_hypertable }] = await queryRunner.query(`
          SELECT EXISTS (
            SELECT 1 FROM timescaledb_information.hypertables
            WHERE hypertable_name = '${table}'
          ) AS is_hypertable
        `);

        if (!is_hypertable) {
          console.log(`  Skipping ${table} — not a hypertable`);
          skipped.push(`${table} (not a hypertable)`);
          await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
          continue;
        }

        const existing = await queryRunner.query(`
          SELECT num_partitions FROM timescaledb_information.dimensions
          WHERE hypertable_name = '${table}'
            AND column_name = '${this.spaceColumn}'
        `);

        if (existing.length > 0) {
          const currentN = existing[0]?.num_partitions ?? 'unknown';
          const mismatch =
            currentN !== this.partitions
              ? ` (configured HYPERTABLE_SPACE_PARTITIONS=${this.partitions} ignored — use set_number_partitions() to change)`
              : '';
          console.log(
            `  ${table}: space dimension on ${this.spaceColumn} already exists with ${currentN} partitions${mismatch}`,
          );
          await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
          continue;
        }

        await queryRunner.query(
          `SELECT add_dimension('${table}', by_hash('${this.spaceColumn}', ${this.partitions}), if_not_exists => TRUE)`,
        );

        const [verify] = await queryRunner.query(`
          SELECT num_partitions FROM timescaledb_information.dimensions
          WHERE hypertable_name = '${table}'
            AND column_name = '${this.spaceColumn}'
        `);

        if (!verify || verify.num_partitions !== this.partitions) {
          throw new Error(
            `add_dimension on ${table} reported success but dimension not visible with ${this.partitions} partitions`,
          );
        }

        console.log(
          `  ${table}: added by_hash('${this.spaceColumn}', ${this.partitions})`,
        );
        await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (error) {
        try {
          await queryRunner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (cleanupErr) {
          poisonedTx = true;
          const cleanupMsg =
            cleanupErr && typeof cleanupErr === 'object' && 'message' in cleanupErr
              ? (cleanupErr as Error).message
              : 'Unknown cleanup error';
          console.warn(
            `  Savepoint cleanup failed for ${table}: ${cleanupMsg} — aborting remaining tables to avoid tx poisoning`,
          );
        }
        const message =
          error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : 'Unknown error';
        console.warn(
          `  Warning: could not add space dimension to ${table}: ${message}`,
        );
        skipped.push(`${table} (${message})`);
      }
    }

    if (skipped.length > 0) {
      console.warn(
        `  Space dimension skipped on ${skipped.length} of ${this.tables.length} tables:`,
      );
      for (const entry of skipped) {
        console.warn(`    - ${entry}`);
      }
      console.warn(
        '  See docs-site/content/Operations/Hypertable Space Rebuild.md for retroactive rebuild.',
      );
    }
  }

  /**
   * Intentional no-op. TimescaleDB does not expose a `drop_dimension` that
   * works after chunks have been created, so reverting this migration via
   * `typeorm migration:revert` will only delete the row from the
   * `typeorm_migrations` table — the space dimension itself stays in place
   * on the hypertable. If a deployment genuinely needs to undo the dimension,
   * follow the rebuild runbook in reverse (copy to a new hypertable without
   * the dimension, swap, drop).
   */
  public async down(_queryRunner: QueryRunner): Promise<void> {
    console.log(
      '  Space dimension removal requires a hypertable rebuild — no automatic down migration.',
    );
    console.log(
      '  The migrations table row will be removed, but the hypertable dimension stays.',
    );
    console.log(
      '  See docs-site/content/Operations/Hypertable Space Rebuild.md',
    );
  }
}

function parseSpacePartitions(raw: string | undefined): number {
  const DEFAULT = 4;
  if (!raw) return DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 2 || n > 64) return DEFAULT;
  return n;
}
