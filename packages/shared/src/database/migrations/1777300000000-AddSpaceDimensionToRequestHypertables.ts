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
 * API/worker env to a different value (1–64) at migration time to override.
 * Once applied, use TimescaleDB's `set_number_partitions()` to change the
 * count later; re-running this migration will not adjust an existing
 * dimension.
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

    for (const table of this.tables) {
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
          await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
          continue;
        }

        const existing = await queryRunner.query(`
          SELECT 1 FROM timescaledb_information.dimensions
          WHERE hypertable_name = '${table}'
            AND column_name = '${this.spaceColumn}'
        `);

        if (existing.length > 0) {
          console.log(
            `  ${table}: space dimension on ${this.spaceColumn} already exists`,
          );
          await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
          continue;
        }

        await queryRunner.query(
          `SELECT add_dimension('${table}', by_hash('${this.spaceColumn}', ${this.partitions}), if_not_exists => TRUE)`,
        );

        console.log(
          `  ${table}: added by_hash('${this.spaceColumn}', ${this.partitions})`,
        );
        await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (error) {
        try {
          await queryRunner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch {
          // Ignore savepoint cleanup errors
        }
        const message =
          error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : 'Unknown error';
        console.warn(
          `  Warning: could not add space dimension to ${table}: ${message}`,
        );
        console.warn(
          `  See docs-site/content/Operations/Hypertable Space Rebuild.md for retroactive rebuild`,
        );
      }
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    console.log(
      '  Space dimension removal requires a hypertable rebuild — no automatic down migration.',
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
  if (!Number.isFinite(n) || n < 1 || n > 64) return DEFAULT;
  return n;
}
