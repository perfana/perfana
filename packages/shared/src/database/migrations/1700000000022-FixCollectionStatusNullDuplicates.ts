import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix duplicate ds_metric_collection_status rows caused by NULL source_id
 *
 * Problem: PostgreSQL unique indexes treat NULL != NULL, so the unique index on
 * (test_run_id, source_type, source_id) allowed multiple rows with source_id IS NULL.
 * This caused coverage calculations to count phantom "incomplete" sources.
 *
 * Fix:
 * 1. Merge duplicate NULL source_id rows (keep the one marked complete, or the newest)
 * 2. Drop old unique indexes
 * 3. Recreate with NULLS NOT DISTINCT (PostgreSQL 15+)
 */
export class FixCollectionStatusNullDuplicates1700000000022 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Merge duplicate rows where source_id IS NULL
    // For each (test_run_id, source_type) group with NULL source_id,
    // keep the row that is_complete=true (or the most recently updated),
    // and merge collected_ranges from all duplicates into it.
    await queryRunner.query(`
      WITH duplicates AS (
        SELECT
          id,
          test_run_id,
          source_type,
          collected_ranges,
          failed_ranges,
          is_complete,
          last_collected_at,
          total_data_points,
          updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY test_run_id, source_type
            ORDER BY is_complete DESC, updated_at DESC
          ) AS rn
        FROM ds_metric_collection_status
        WHERE source_id IS NULL
      ),
      -- Aggregate all collected_ranges from duplicates into the keeper row
      merged_ranges AS (
        SELECT
          d_keep.id AS keeper_id,
          (
            SELECT jsonb_agg(elem)
            FROM duplicates d_all,
            LATERAL jsonb_array_elements(d_all.collected_ranges) AS elem
            WHERE d_all.test_run_id = d_keep.test_run_id
              AND d_all.source_type = d_keep.source_type
              AND jsonb_array_length(d_all.collected_ranges) > 0
          ) AS all_ranges,
          (
            SELECT MAX(d_all.last_collected_at)
            FROM duplicates d_all
            WHERE d_all.test_run_id = d_keep.test_run_id
              AND d_all.source_type = d_keep.source_type
          ) AS max_last_collected,
          (
            SELECT SUM(d_all.total_data_points)
            FROM duplicates d_all
            WHERE d_all.test_run_id = d_keep.test_run_id
              AND d_all.source_type = d_keep.source_type
          ) AS sum_data_points
        FROM duplicates d_keep
        WHERE d_keep.rn = 1
      )
      UPDATE ds_metric_collection_status s
      SET
        collected_ranges = COALESCE(mr.all_ranges, '[]'::jsonb),
        last_collected_at = mr.max_last_collected,
        total_data_points = COALESCE(mr.sum_data_points, 0),
        updated_at = NOW()
      FROM merged_ranges mr
      WHERE s.id = mr.keeper_id
    `);

    // Step 2: Delete the duplicate rows (keep only rn=1)
    await queryRunner.query(`
      DELETE FROM ds_metric_collection_status
      WHERE id IN (
        SELECT id FROM (
          SELECT
            id,
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

    // Step 3: Drop the old unique indexes that don't handle NULL correctly
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_c51ab2014ab264427902fcefec"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_collection_status"
    `);

    // Step 4: Recreate unique index with NULLS NOT DISTINCT (PostgreSQL 15+)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_collection_status"
      ON ds_metric_collection_status (test_run_id, source_type, source_id)
      NULLS NOT DISTINCT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to old unique index (without NULLS NOT DISTINCT)
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_collection_status"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_collection_status"
      ON ds_metric_collection_status (test_run_id, source_type, source_id)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_c51ab2014ab264427902fcefec"
      ON ds_metric_collection_status (test_run_id, source_type, source_id)
    `);
  }
}
