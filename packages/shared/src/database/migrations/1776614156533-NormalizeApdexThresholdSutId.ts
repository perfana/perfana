import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Normalise `system_under_test_id` on the two apdex-threshold tables from
 * `text` to `uuid` and add a real FK to `systems_under_test`.
 *
 * Background (#139): both tables historically stored `system_under_test_id`
 * as `text` because legacy callers wrote the SUT *name* instead of its UUID.
 * The mixed shape forced a `name OR id::text` OR-join in three queries
 * (getTransactionStats / getTransactionSamples / getTransactionErrors), which
 * defeats hash joins on the SUT side and is one of the main reasons Apdex
 * queries take 8-60 s on production-sized data sets.
 *
 * All current writes (apps/api/.../test-runs-apdex.service.ts) already pass
 * UUIDs (validated through systemRepo), so most rows should already be
 * UUIDs. This migration:
 *   1. Backfills any name-shaped value to the matching SUT UUID.
 *   2. Logs and DELETEs rows whose system_under_test_id matches no SUT at
 *      all (orphans). The plan is explicit that orphan deletion is the
 *      desired behaviour — the alternative (failing the migration) would
 *      block deploys in environments with stale legacy data.
 *   3. Drops the existing UNIQUE constraint, converts the column type via
 *      `USING ::uuid`, recreates the UNIQUE constraint with the same
 *      column list, and finally adds an `ON DELETE CASCADE` FK.
 *
 * The down() reverts the FK and column type, but cannot losslessly restore
 * the original name-based values — this is a deliberate one-way data
 * normalisation and is documented inline.
 */
export class NormalizeApdexThresholdSutId1776614156533 implements MigrationInterface {
  name = 'NormalizeApdexThresholdSutId1776614156533';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tables: Array<{
      table: string;
      uniqueConstraint: string;
      uniqueColumns: string[];
      fkConstraint: string;
    }> = [
      {
        table: 'workload_apdex_thresholds',
        uniqueConstraint: 'unique_workload_threshold',
        uniqueColumns: ['system_under_test_id', 'test_environment', 'workload'],
        fkConstraint: 'fk_workload_apdex_thresholds_system_under_test',
      },
      {
        table: 'workload_transaction_apdex_thresholds',
        uniqueConstraint: 'unique_workload_transaction_threshold',
        uniqueColumns: ['system_under_test_id', 'test_environment', 'workload', 'transaction_name'],
        fkConstraint: 'fk_workload_transaction_apdex_thresholds_system_under_test',
      },
    ];

    for (const { table, uniqueConstraint, uniqueColumns, fkConstraint } of tables) {
      // Lock the table for the duration of the transaction so a concurrent
      // INSERT cannot slip a name-shaped value past us between the backfill
      // and the type conversion.
      await queryRunner.query(`LOCK TABLE "${table}" IN ACCESS EXCLUSIVE MODE`);

      // Step 1: Backfill rows whose system_under_test_id is NOT a UUID and
      // matches a systems_under_test.name. The regex screens out anything
      // that already looks like a UUID so we don't waste rows on a self-join
      // in the common path.
      await queryRunner.query(`
        UPDATE "${table}" t
        SET system_under_test_id = sut.id::text
        FROM systems_under_test sut
        WHERE t.system_under_test_id = sut.name
          AND t.system_under_test_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      `);

      // Step 2: Identify orphans — rows whose system_under_test_id matches no
      // SUT by either id or name. Log them, then delete. Logging happens via
      // console.warn so the rows show up in migration output for operators.
      const orphans: Array<{ id: string; system_under_test_id: string }> = await queryRunner.query(`
        SELECT id, system_under_test_id
        FROM "${table}" t
        WHERE NOT EXISTS (
          SELECT 1 FROM systems_under_test sut
          WHERE sut.id::text = t.system_under_test_id OR sut.name = t.system_under_test_id
        )
      `);

      if (orphans.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[NormalizeApdexThresholdSutId] Deleting ${orphans.length} orphan row(s) from "${table}" ` +
            `whose system_under_test_id matches no systems_under_test row by id or name. ` +
            `Sample: ${JSON.stringify(orphans.slice(0, 10))}`,
        );

        await queryRunner.query(`
          DELETE FROM "${table}" t
          WHERE NOT EXISTS (
            SELECT 1 FROM systems_under_test sut
            WHERE sut.id::text = t.system_under_test_id OR sut.name = t.system_under_test_id
          )
        `);
      }

      // Step 3: Drop the existing UNIQUE constraint that includes
      // system_under_test_id so the column type can be altered. Using
      // IF EXISTS for safety in environments where the constraint may have
      // been renamed by a hand patch.
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${uniqueConstraint}"`);

      // Step 4: Convert column type text -> uuid. After Steps 1 + 2 every
      // remaining value is a valid UUID string, so the cast cannot fail.
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ALTER COLUMN system_under_test_id TYPE uuid USING system_under_test_id::uuid
      `);

      // Step 5: Add the FK with ON DELETE CASCADE so deleting a SUT cleans
      // up its threshold rows automatically (mirrors expected_config_changes
      // and notification_channels).
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ADD CONSTRAINT "${fkConstraint}"
        FOREIGN KEY (system_under_test_id) REFERENCES systems_under_test(id) ON DELETE CASCADE
      `);

      // Step 6: Recreate the UNIQUE constraint with the same columns. The
      // index that backs this constraint also covers point-lookups by
      // (system_under_test_id, …) — replacing the previous unique-on-text
      // index that was queried by Apdex services.
      const quotedCols = uniqueColumns.map((c) => `"${c}"`).join(', ');
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ADD CONSTRAINT "${uniqueConstraint}" UNIQUE (${quotedCols})
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse the FK + type change. Note: the original name-based values
    // cannot be losslessly restored — Step 1 of up() rewrote them to UUIDs
    // and Step 2 deleted unmatchable rows. This down() leaves all surviving
    // rows as UUID strings stored in a text column, which is the safest
    // best-effort revert. Operators rolling back should not expect to see
    // the legacy name-shaped values reappear.
    const tables: Array<{
      table: string;
      uniqueConstraint: string;
      uniqueColumns: string[];
      fkConstraint: string;
    }> = [
      {
        table: 'workload_transaction_apdex_thresholds',
        uniqueConstraint: 'unique_workload_transaction_threshold',
        uniqueColumns: ['system_under_test_id', 'test_environment', 'workload', 'transaction_name'],
        fkConstraint: 'fk_workload_transaction_apdex_thresholds_system_under_test',
      },
      {
        table: 'workload_apdex_thresholds',
        uniqueConstraint: 'unique_workload_threshold',
        uniqueColumns: ['system_under_test_id', 'test_environment', 'workload'],
        fkConstraint: 'fk_workload_apdex_thresholds_system_under_test',
      },
    ];

    for (const { table, uniqueConstraint, uniqueColumns, fkConstraint } of tables) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${fkConstraint}"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${uniqueConstraint}"`);
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ALTER COLUMN system_under_test_id TYPE text USING system_under_test_id::text
      `);
      const quotedCols = uniqueColumns.map((c) => `"${c}"`).join(', ');
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ADD CONSTRAINT "${uniqueConstraint}" UNIQUE (${quotedCols})
      `);
    }
  }
}
