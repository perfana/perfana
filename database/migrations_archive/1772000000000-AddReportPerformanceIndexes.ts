import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add Performance Indexes for Report Generation
 *
 * This migration adds database indexes to optimize report generation queries.
 *
 * IMPORTANT: Some indexes reference columns added in later migrations (system_id, test_environment, workload).
 * These indexes are created conditionally - they'll be skipped if columns don't exist yet and can be
 * created after the scoping migration runs.
 *
 * @phase 7 - Performance Optimization
 */
export class AddReportPerformanceIndexes1772000000000 implements MigrationInterface {
  name = 'AddReportPerformanceIndexes1772000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Check if report_templates table has scoping columns
    const scopingColumnsExist = await this.checkScopingColumns(queryRunner);

    if (scopingColumnsExist) {
      // Only create this index if scoping columns exist
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_report_templates_scope_lookup
        ON report_templates (system_id, test_environment, workload)
        WHERE is_default = true;
      `);
    }

    // Check if generated_reports table exists (created in later migration)
    const generatedReportsExists = await this.checkTableExists(queryRunner, 'generated_reports');

    if (generatedReportsExists) {
      // These indexes can only be created if the table exists
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_generated_reports_recent
        ON generated_reports (test_run_id, created_at DESC)
        WHERE status IN ('html_complete', 'completed');
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_generated_reports_cleanup
        ON generated_reports (expires_at)
        WHERE expires_at IS NOT NULL AND status = 'completed';
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_generated_reports_share_lookup_optimized
        ON generated_reports (share_id, share_enabled, expires_at)
        WHERE share_enabled = true;
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_generated_reports_retry
        ON generated_reports (status, retry_count, created_at)
        WHERE status = 'failed' AND retry_count < max_retries;
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_report_templates_scope_lookup;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_generated_reports_recent;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_generated_reports_cleanup;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_generated_reports_share_lookup_optimized;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_generated_reports_retry;`);
  }

  /**
   * Check if a table exists
   */
  private async checkTableExists(queryRunner: QueryRunner, tableName: string): Promise<boolean> {
    const result = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      )
    `, [tableName]);

    return result && result[0] && result[0].exists;
  }

  /**
   * Check if report_templates table has the scoping columns
   */
  private async checkScopingColumns(queryRunner: QueryRunner): Promise<boolean> {
    const result = await queryRunner.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'report_templates'
        AND column_name IN ('system_id', 'test_environment', 'workload')
    `);

    return result && result.length === 3;
  }
}
