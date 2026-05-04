import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5b PR1: Replace audit_logs RLS policies with a special-case shape that
 * accommodates the table's intentional `organization_id` nullability.
 *
 *   - SELECT: super-admin sees all rows including null-org system events.
 *             org-admins see only their accessible orgs' events.
 *   - INSERT: permissive (true). The AuditService is the only writer; it
 *             populates organization_id truthfully or leaves it NULL by intent.
 *   - UPDATE: super-admin only (audit log is append-only).
 *   - DELETE: super-admin only (partition manager DROP TABLE bypasses RLS via DDL).
 */
export class RewriteAuditLogsRls1778400000000 implements MigrationInterface {
  name = 'RewriteAuditLogsRls1778400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS rls_audit_logs_${op} ON "audit_logs"`,
      );
    }
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_select ON audit_logs FOR SELECT
        USING (
          public.is_global_admin()
          OR (organization_id IS NOT NULL
              AND public.can_access_resource(organization_id, NULL, NULL))
        )
    `);
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_insert ON audit_logs FOR INSERT
        WITH CHECK (true)
    `);
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_update ON audit_logs FOR UPDATE
        USING (public.is_global_admin())
    `);
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_delete ON audit_logs FOR DELETE
        USING (public.is_global_admin())
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS rls_audit_logs_${op} ON "audit_logs"`,
      );
    }
    // Restore the standard 3-arg policy shape (matches state when audit_logs
    // was created in 1777800000000-CreatePartitionedAuditLogs).
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_select ON audit_logs FOR SELECT
        USING (public.can_access_resource(organization_id, NULL, (user_id)::text))
    `);
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_insert ON audit_logs FOR INSERT WITH CHECK (true)
    `);
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_update ON audit_logs FOR UPDATE
        USING (public.can_modify_resource(organization_id, NULL, (user_id)::text))
    `);
    await queryRunner.query(`
      CREATE POLICY rls_audit_logs_delete ON audit_logs FOR DELETE
        USING (public.can_modify_resource(organization_id, NULL, (user_id)::text))
    `);
  }
}
