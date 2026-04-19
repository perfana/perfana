import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix the root cause of ds_metric_collection_status row explosion (#136).
 *
 * Two earlier migrations fought each other:
 *   - 1700000000022 dropped IDX_c51ab2014ab264427902fcefec and replaced it with
 *     uq_collection_status using NULLS NOT DISTINCT.
 *   - 1776148518354 re-created IDX_c51ab2014ab264427902fcefec without NULLS NOT
 *     DISTINCT, so on PostgreSQL's standard NULL-aware unique semantics every
 *     performance_test tick (source_id IS NULL) produced a new row instead of
 *     upserting the existing one.
 *
 * Fix: eliminate the ambiguity by making source_id NOT NULL DEFAULT ''.
 * Performance-test collection stores '' instead of NULL, so a plain unique
 * index works correctly and the `INSERT … ON CONFLICT (test_run_id,
 * source_type, source_id)` upsert path in `WorkerDatabaseService` finally
 * matches for perf-test rows.
 */
export class RequireNonNullSourceIdOnCollectionStatus1776700000000 implements MigrationInterface {
  name = 'RequireNonNullSourceIdOnCollectionStatus1776700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 0: Take an ACCESS EXCLUSIVE lock for the duration of the transaction.
    // The migration drops both unique indexes in Step 3 and doesn't recreate one
    // until Step 5, and it flips the column to NOT NULL in Step 4. Without the
    // table-level lock a concurrent worker INSERT could:
    //   (a) slip a fresh NULL-source_id row in between Step 2 (delete dupes) and
    //       Step 4, causing ALTER … SET NOT NULL to fail with 23502, or
    //   (b) create a duplicate between Step 3 (drop indexes) and Step 5 (create
    //       new unique index), causing CREATE UNIQUE INDEX to fail with 23505.
    // Migrations run serially and this table is small, so the lock is cheap.
    await queryRunner.query(`LOCK TABLE ds_metric_collection_status IN ACCESS EXCLUSIVE MODE`);

    // Step 1: Merge any duplicate rows for (test_run_id, source_type) where
    // source_id IS NULL — the broken standard-btree index on NULL may have
    // permitted multiple rows, and we cannot backfill NULL → '' without first
    // collapsing them into one.
    //
    // Intentional: `failed_ranges` is reset to '[]'::jsonb on the keeper row.
    // The duplicates existed because the broken index let every tick insert a
    // new row, so their `failed_ranges` are almost entirely stale errors from
    // the old `uniq_ds_metric_statistics` race (see #134/#135) that no longer
    // apply on 0.2.40.0+. The next successful tick will repopulate real failed
    // ranges if anything actually fails; until then, a clean slate is
    // preferable to carrying forward phantom failures that would flip the
    // sanity check.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT
          id,
          test_run_id,
          source_type,
          collected_ranges,
          failed_ranges,
          is_complete,
          last_collected_at,
          total_data_points,
          ROW_NUMBER() OVER (
            PARTITION BY test_run_id, source_type
            ORDER BY is_complete DESC, updated_at DESC
          ) AS rn
        FROM ds_metric_collection_status
        WHERE source_id IS NULL
      ),
      merged AS (
        SELECT
          keeper.id AS keeper_id,
          (
            SELECT jsonb_agg(elem)
            FROM ranked r,
            LATERAL jsonb_array_elements(r.collected_ranges) elem
            WHERE r.test_run_id = keeper.test_run_id
              AND r.source_type = keeper.source_type
              AND jsonb_array_length(r.collected_ranges) > 0
          ) AS all_collected,
          (
            SELECT MAX(r.last_collected_at)
            FROM ranked r
            WHERE r.test_run_id = keeper.test_run_id
              AND r.source_type = keeper.source_type
          ) AS max_last_collected,
          (
            SELECT SUM(r.total_data_points)
            FROM ranked r
            WHERE r.test_run_id = keeper.test_run_id
              AND r.source_type = keeper.source_type
          ) AS sum_data_points,
          (
            SELECT bool_or(r.is_complete)
            FROM ranked r
            WHERE r.test_run_id = keeper.test_run_id
              AND r.source_type = keeper.source_type
          ) AS any_complete
        FROM ranked keeper
        WHERE keeper.rn = 1
      )
      UPDATE ds_metric_collection_status s
      SET
        collected_ranges = COALESCE(m.all_collected, '[]'::jsonb),
        failed_ranges = '[]'::jsonb,
        is_complete = COALESCE(m.any_complete, s.is_complete),
        last_collected_at = m.max_last_collected,
        total_data_points = COALESCE(m.sum_data_points, 0),
        updated_at = NOW()
      FROM merged m
      WHERE s.id = m.keeper_id
    `);

    await queryRunner.query(`
      DELETE FROM ds_metric_collection_status
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY test_run_id, source_type
              ORDER BY is_complete DESC, updated_at DESC
            ) AS rn
          FROM ds_metric_collection_status
          WHERE source_id IS NULL
        ) ranked
        WHERE rn > 1
      )
    `);

    // Step 2: Backfill remaining NULL source_id → '' (after dedup).
    await queryRunner.query(`
      UPDATE ds_metric_collection_status
      SET source_id = ''
      WHERE source_id IS NULL
    `);

    // Step 3: Drop every known variant of the stale unique index so the
    // ALTER COLUMN SET NOT NULL below is unambiguous and we can create one
    // canonical index. NULLS NOT DISTINCT (from migration 22) and the standard
    // btree variant (from migration 1776148518354) are both dropped.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_c51ab2014ab264427902fcefec"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_collection_status"`);

    // Step 4: Enforce NOT NULL with a sensible default. The default lets any
    // caller that still passes NULL (there shouldn't be any after this PR)
    // fall back to '' instead of raising a 23502.
    await queryRunner.query(`
      ALTER TABLE ds_metric_collection_status
        ALTER COLUMN source_id SET DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE ds_metric_collection_status
        ALTER COLUMN source_id SET NOT NULL
    `);

    // Step 5: Create the canonical unique index. Named to match the entity's
    // explicit @Index('uq_ds_metric_collection_status_source', …) decorator,
    // so TypeORM's synchronize path (used by test suites) will detect it and
    // not spawn a second auto-hashed index.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_ds_metric_collection_status_source"
      ON ds_metric_collection_status (test_run_id, source_type, source_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_ds_metric_collection_status_source"`);

    await queryRunner.query(`
      ALTER TABLE ds_metric_collection_status
        ALTER COLUMN source_id DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE ds_metric_collection_status
        ALTER COLUMN source_id DROP DEFAULT
    `);

    // Restore the pre-#136 state: the NULLS NOT DISTINCT index from migration
    // 22 plus the NULL-unsafe TypeORM-auto index from 1776148518354. Both were
    // present on production before this migration and callers that still exist
    // on older worker images may expect ON CONFLICT to target the original
    // index name.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_collection_status"
      ON ds_metric_collection_status (test_run_id, source_type, source_id)
      NULLS NOT DISTINCT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_c51ab2014ab264427902fcefec"
      ON ds_metric_collection_status (test_run_id, source_type, source_id)
    `);
  }
}
