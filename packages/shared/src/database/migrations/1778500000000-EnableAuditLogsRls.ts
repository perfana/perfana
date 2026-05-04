import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5b PR1: Enable + force RLS on the `audit_logs` partitioned parent table.
 *
 * The Phase 5a migration `1777800000000-CreatePartitionedAuditLogs.ts` created
 * audit_logs and added 4 policies to it, but never ran `ALTER TABLE audit_logs
 * ENABLE ROW LEVEL SECURITY`. As a result, the policies were inert — they
 * existed in pg_policies but were not enforced because RLS was disabled at the
 * table level. Phase 5b's policy snapshot test surfaced this immediately.
 *
 * Force flag: needed because the table owner (perfana) would otherwise bypass
 * RLS, identical reasoning to every other RLS-protected table in the schema.
 *
 * Idempotent: ENABLE / FORCE are no-ops if already set.
 */
export class EnableAuditLogsRls1778500000000 implements MigrationInterface {
  name = 'EnableAuditLogsRls1778500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE audit_logs NO FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY`);
  }
}
