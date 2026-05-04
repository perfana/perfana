import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Denormalize `system_under_test_id` onto `audit_logs` so the audit viewer
 * can scope rows to a single SUT (and all its descendants — workloads,
 * benchmarks, dashboards, expected-config-changes, etc.) without joining
 * against every owned table at query time.
 *
 * The audit dispatcher (`audit.service.ts#dispatch`) populates this column
 * from the entity at write time. Existing rows stay NULL — there is no
 * backfill: audit history pre-dating this migration is unaffected and the
 * SUT filter simply won't match older rows.
 */
export class AuditLogsAddSystemUnderTestId1777900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS system_under_test_id uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_system_under_test_id
         ON audit_logs (system_under_test_id, timestamp DESC)
         WHERE system_under_test_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audit_logs_system_under_test_id`);
    await queryRunner.query(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS system_under_test_id`);
  }
}
