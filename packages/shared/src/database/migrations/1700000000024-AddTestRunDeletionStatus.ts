import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add deletion_status column to test_runs
 *
 * Supports async bulk deletion via BullMQ queue to prevent database deadlocks
 * when deleting multiple test runs with millions of rows concurrently.
 *
 * Values: NULL (normal), 'queued', 'deleting', 'failed'
 */
export class AddTestRunDeletionStatus1700000000024 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE test_runs
      ADD COLUMN IF NOT EXISTS deletion_status VARCHAR(20) DEFAULT NULL
    `);

    // Partial index — only indexes rows with non-null status (very few rows)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_test_runs_deletion_status
      ON test_runs(deletion_status)
      WHERE deletion_status IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_test_runs_deletion_status
    `);

    await queryRunner.query(`
      ALTER TABLE test_runs DROP COLUMN IF EXISTS deletion_status
    `);
  }
}
