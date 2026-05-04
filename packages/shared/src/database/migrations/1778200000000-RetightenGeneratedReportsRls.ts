import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5b PR1: Retighten generated_reports RLS policies via test_runs subquery.
 *
 * Background: 1776148518354-AddWorkloadToEvents dropped team_id from
 * generated_reports; PR #125 dropped its policies without recreating; PR #149
 * fixed url_patterns + api_keys but left generated_reports permissive
 * (USING (true)). The original plan assumed Phase 4 restored ownership columns
 * to this table — it did not. The table has no organization_id, created_by,
 * or team_id; only test_run_id, generated_by (a username string), and
 * artifact data (PDF/HTML).
 *
 * Tightening shape: delegate access via the joined test_runs row's
 * organization_id (Phase 5b PR1.4 makes test_runs.organization_id NOT NULL,
 * so this subquery always resolves). One indexed PK lookup per generated_reports
 * row — bounded cost. Real RLS activation without a schema change.
 *
 * UPDATE/DELETE upgrade: was global-admin only, now allows the test_run's org
 * members per the standard can_modify_resource semantics. (Pre-tightening was
 * stricter than necessary; post-tightening matches the rest of the model.)
 */
export class RetightenGeneratedReportsRls1778200000000
  implements MigrationInterface
{
  name = 'RetightenGeneratedReportsRls1778200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS rls_generated_reports_${op} ON "generated_reports"`,
      );
    }
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_select ON generated_reports FOR SELECT
        USING (
          public.is_global_admin()
          OR EXISTS (
            SELECT 1 FROM test_runs tr
            WHERE tr.id = generated_reports.test_run_id
              AND public.can_access_resource(tr.organization_id, NULL::uuid, NULL::text)
          )
        )
    `);
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_insert ON generated_reports FOR INSERT
        WITH CHECK (
          public.is_global_admin()
          OR EXISTS (
            SELECT 1 FROM test_runs tr
            WHERE tr.id = generated_reports.test_run_id
              AND public.can_access_resource(tr.organization_id, NULL::uuid, NULL::text)
          )
        )
    `);
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_update ON generated_reports FOR UPDATE
        USING (
          public.is_global_admin()
          OR EXISTS (
            SELECT 1 FROM test_runs tr
            WHERE tr.id = generated_reports.test_run_id
              AND public.can_modify_resource(tr.organization_id, NULL::uuid, NULL::text)
          )
        )
    `);
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_delete ON generated_reports FOR DELETE
        USING (
          public.is_global_admin()
          OR EXISTS (
            SELECT 1 FROM test_runs tr
            WHERE tr.id = generated_reports.test_run_id
              AND public.can_modify_resource(tr.organization_id, NULL::uuid, NULL::text)
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS rls_generated_reports_${op} ON "generated_reports"`,
      );
    }
    // Restore the pre-tightening permissive policies (matches state after
    // 1777400000000-RestoreRlsPoliciesPostTeamIdRemoval).
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_select ON generated_reports FOR SELECT USING (true)
    `);
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_insert ON generated_reports FOR INSERT WITH CHECK (true)
    `);
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_update ON generated_reports FOR UPDATE
        USING (public.is_global_admin())
    `);
    await queryRunner.query(`
      CREATE POLICY rls_generated_reports_delete ON generated_reports FOR DELETE
        USING (public.is_global_admin())
    `);
  }
}
