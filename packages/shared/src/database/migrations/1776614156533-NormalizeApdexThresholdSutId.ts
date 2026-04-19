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
 *   0. Skips the table entirely when `system_under_test_id` is already
 *      `uuid` (fresh installs materialise the consolidated schema which
 *      already has the column as uuid + FK).
 *   1. Drops the existing UNIQUE constraint so the subsequent backfill can
 *      transiently produce duplicates without hitting 23505.
 *   2. Lowercases any UUID-shaped text so dedupe/orphan-detection/cast all
 *      compare against `sut.id::text` (which is lowercase) consistently.
 *   3. Backfills any name-shaped value to the matching SUT UUID.
 *   4. Dedupes any rows that collide on the unique key after backfill,
 *      keeping the most recently updated row per key.
 *   5. Logs and DELETEs rows whose system_under_test_id matches no SUT at
 *      all (orphans). The plan is explicit that orphan deletion is the
 *      desired behaviour — the alternative (failing the migration) would
 *      block deploys in environments with stale legacy data.
 *   6. Converts the column type via `USING ::uuid`.
 *   7. Adds an `ON DELETE CASCADE` FK to `systems_under_test(id)`.
 *   8. Recreates the UNIQUE constraint with the same column list.
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
      // Step 0 (Issue 1 fix): Fresh-install guard. The consolidated schema
      // (schema-sql.ts / 1700000000000-ConsolidatedSchema.ts) already creates
      // `system_under_test_id` as `uuid` with the FK on fresh DBs. Running
      // the text-shaped backfill/cast against a uuid column fails with
      // `42883 operator does not exist: uuid = text`. If the column is
      // already uuid there's nothing to normalise — skip the entire block.
      const columnInfo: Array<{ data_type: string }> = await queryRunner.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'system_under_test_id'`,
        [table],
      );
      if (columnInfo.length === 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[NormalizeApdexThresholdSutId] ${table}: table or column not found — skipping`,
        );
        continue;
      }
      if (columnInfo[0].data_type === 'uuid') {
        // eslint-disable-next-line no-console
        console.log(
          `[NormalizeApdexThresholdSutId] ${table}: system_under_test_id is already uuid — skipping`,
        );
        continue;
      }

      // Lock the table for the duration of the transaction so a concurrent
      // INSERT cannot slip a name-shaped value past us between the backfill
      // and the type conversion.
      await queryRunner.query(`LOCK TABLE "${table}" IN ACCESS EXCLUSIVE MODE`);

      // Step 1 (Issue 2 fix): Drop the existing UNIQUE constraint BEFORE the
      // backfill. Without this, the Step 2 UPDATE that rewrites a name to a
      // UUID could collide with a pre-existing uuid-keyed row that already
      // has the same (test_environment, workload[, transaction_name]) and
      // raise `23505 duplicate key`. Dropping the constraint first lets
      // duplicates exist transiently; the dedupe step below resolves them.
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${uniqueConstraint}"`);

      // Step 2 (Issue 3 fix, canonicalisation pass): Lowercase any UUID-
      // shaped text value up-front. `sut.id::text` renders lowercase, so
      // uppercase legacy UUIDs would otherwise (a) be rejected by the Step 3
      // regex (so never backfilled) and (b) fail the Step 4 orphan match
      // against `sut.id::text`. Canonicalising first ensures every UUID-
      // shaped value is lowercase before dedupe, orphan detection, and cast.
      await queryRunner.query(`
        UPDATE "${table}"
        SET system_under_test_id = LOWER(system_under_test_id)
        WHERE system_under_test_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND system_under_test_id != LOWER(system_under_test_id)
      `);

      // Step 3: Backfill rows whose system_under_test_id is NOT a UUID and
      // matches a systems_under_test.name. The regex screens out anything
      // that already looks like a UUID (case-insensitive — Issue 3 fix —
      // though Step 2 already lowercased everything that is UUID-shaped) so
      // we don't waste rows on a self-join in the common path.
      await queryRunner.query(`
        UPDATE "${table}" t
        SET system_under_test_id = sut.id::text
        FROM systems_under_test sut
        WHERE t.system_under_test_id = sut.name
          AND t.system_under_test_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      `);

      // Step 4 (Issue 2 fix, dedupe): After backfill, two formerly-distinct
      // rows may now share the same (system_under_test_id, test_environment,
      // workload[, transaction_name]). Keep the row with the greatest
      // updated_at (break ties by id::text to be deterministic), delete the
      // rest. This lets us safely recreate the UNIQUE constraint later.
      const dedupeExtraPredicate =
        table === 'workload_transaction_apdex_thresholds' ? 'AND t1.transaction_name = t2.transaction_name' : '';
      // TypeORM's queryRunner.query() returns a two-element array
      // `[rows, rowCount]` for DELETE/UPDATE/INSERT statements. Use
      // `result[0]` for the RETURNING rows; fall back to `result[1]` if
      // needed. SELECT returns just `rows` so this shape check works too.
      const dedupeResult: unknown = await queryRunner.query(`
        DELETE FROM "${table}" t1
        USING "${table}" t2
        WHERE t1.id <> t2.id
          AND t1.system_under_test_id = t2.system_under_test_id
          AND t1.test_environment     = t2.test_environment
          AND t1.workload              = t2.workload
          ${dedupeExtraPredicate}
          AND (
            t1.updated_at < t2.updated_at
            OR (t1.updated_at = t2.updated_at AND t1.id::text < t2.id::text)
          )
        RETURNING t1.id
      `);
      let dedupedCount = 0;
      if (Array.isArray(dedupeResult)) {
        const first = dedupeResult[0];
        if (Array.isArray(first)) {
          // [rows, rowCount] shape
          dedupedCount = first.length;
        } else {
          // Plain rows array shape
          dedupedCount = dedupeResult.length;
        }
      }
      if (dedupedCount > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[NormalizeApdexThresholdSutId] Deduped ${dedupedCount} row(s) from "${table}" ` +
            `after backfilling name→uuid. Kept the row with the greatest updated_at per ` +
            `(system_under_test_id, test_environment, workload${
              table === 'workload_transaction_apdex_thresholds' ? ', transaction_name' : ''
            }) key.`,
        );
      }

      // Step 5: Identify orphans — rows whose system_under_test_id matches no
      // SUT by either id or name. Log them, then delete. Logging happens via
      // console.warn so the rows show up in migration output for operators.
      // The id::text comparison uses LOWER() on the text column so any
      // uppercase-UUID rows that somehow slipped past Step 2 still match
      // (Issue 3 fix).
      const orphans: Array<{ id: string; system_under_test_id: string }> = await queryRunner.query(`
        SELECT id, system_under_test_id
        FROM "${table}" t
        WHERE NOT EXISTS (
          SELECT 1 FROM systems_under_test sut
          WHERE sut.id::text = LOWER(t.system_under_test_id) OR sut.name = t.system_under_test_id
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
            WHERE sut.id::text = LOWER(t.system_under_test_id) OR sut.name = t.system_under_test_id
          )
        `);
      }

      // Step 6: Convert column type text -> uuid. After Steps 2-5 every
      // remaining value is a valid, lowercase UUID string, so the cast
      // cannot fail.
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ALTER COLUMN system_under_test_id TYPE uuid USING system_under_test_id::uuid
      `);

      // Step 7: Add the FK with ON DELETE CASCADE so deleting a SUT cleans
      // up its threshold rows automatically (mirrors expected_config_changes
      // and notification_channels).
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ADD CONSTRAINT "${fkConstraint}"
        FOREIGN KEY (system_under_test_id) REFERENCES systems_under_test(id) ON DELETE CASCADE
      `);

      // Step 8: Recreate the UNIQUE constraint with the same columns. The
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
