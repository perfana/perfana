import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add data_warnings column to test_runs
 *
 * Separates informational data quality warnings (e.g., sparse metrics) from
 * hard validation errors (reasons_not_valid). Sparse data warnings no longer
 * invalidate a test run when all SLO checks completed successfully.
 */
export class AddDataWarningsColumn1700000000023 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE test_runs
      ADD COLUMN IF NOT EXISTS data_warnings text[] DEFAULT NULL
    `);

    // Migrate existing sparse data reasons to the new warnings column
    // and remove them from reasons_not_valid
    await queryRunner.query(`
      UPDATE test_runs
      SET
        data_warnings = (
          SELECT array_agg(reason)
          FROM unnest(reasons_not_valid) AS reason
          WHERE reason LIKE 'Sparse data:%'
        ),
        reasons_not_valid = (
          SELECT NULLIF(array_agg(reason), '{}')
          FROM unnest(reasons_not_valid) AS reason
          WHERE reason NOT LIKE 'Sparse data:%'
        )
      WHERE reasons_not_valid IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM unnest(reasons_not_valid) AS r WHERE r LIKE 'Sparse data:%'
        )
    `);

    // Fix validity: test runs that were only invalid due to sparse data
    // should now be valid (no remaining reasons_not_valid)
    await queryRunner.query(`
      UPDATE test_runs
      SET valid = true
      WHERE valid = false
        AND (reasons_not_valid IS NULL OR array_length(reasons_not_valid, 1) IS NULL)
        AND data_warnings IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Move warnings back to reasons_not_valid
    await queryRunner.query(`
      UPDATE test_runs
      SET
        reasons_not_valid = COALESCE(reasons_not_valid, '{}') || COALESCE(data_warnings, '{}'),
        valid = false
      WHERE data_warnings IS NOT NULL
        AND array_length(data_warnings, 1) > 0
    `);

    await queryRunner.query(`
      ALTER TABLE test_runs DROP COLUMN IF EXISTS data_warnings
    `);
  }
}
