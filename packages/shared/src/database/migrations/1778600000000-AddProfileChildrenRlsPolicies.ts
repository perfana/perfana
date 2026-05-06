import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5b: Add the missing four CRUD policies to `profile_grafana_dashboards`
 * and `profile_benchmarks`.
 *
 * The consolidated schema (`1700000000000-ConsolidatedSchema.ts` via
 * `schema-sql.ts`) ran `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on both
 * tables but never created any policies. With RLS enabled and zero policies,
 * Postgres denies every row to non-owner roles — so `perfana_system` (used by
 * grafana-sync, worker, perfana-report, audit-partition-manager) gets back
 * empty result sets even with `app.current_user_roles='["super-admin"]'` set,
 * because there is no policy for `is_global_admin()` to short-circuit.
 *
 * Surfaced through grafana-sync's `AutoConfigService` cron logging
 * "No auto config dashboards found. AutoConfig processing skipped." while a
 * tagged test run was actively in flight: `findAutoConfigGrafanaDashboards`
 * was reading zero rows from `profile_grafana_dashboards` despite 16 rows
 * being present.
 *
 * Policies match the standard `can_access_resource` / `can_modify_resource`
 * pattern used by `profiles`, `test_runs`, `benchmarks`, and the other 23
 * RLS-protected tables. INSERT uses `WITH CHECK (true)` to match the inert
 * insert policy that every other table has — the service layer enforces
 * write authorization, RLS is the coarse backstop on read paths.
 *
 * FORCE is not added here. The parent `profiles` table is FORCE'd; these two
 * children are not in the schema baseline. Adding FORCE is a separate
 * decision that affects superuser bypass during migrations and admin work,
 * and is out of scope for this fix.
 *
 * Idempotent: `CREATE POLICY` is wrapped in a guard against `pg_policies`
 * so re-running the migration after a partial up() does not error.
 */
export class AddProfileChildrenRlsPolicies1778600000000 implements MigrationInterface {
  name = 'AddProfileChildrenRlsPolicies1778600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tables = ['profile_grafana_dashboards', 'profile_benchmarks'] as const;

    for (const table of tables) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = '${table}' AND policyname = 'rls_${table}_select'
          ) THEN
            CREATE POLICY rls_${table}_select ON public.${table}
              FOR SELECT USING (public.can_access_resource(organization_id, team_id, (created_by)::text));
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = '${table}' AND policyname = 'rls_${table}_insert'
          ) THEN
            CREATE POLICY rls_${table}_insert ON public.${table}
              FOR INSERT WITH CHECK (true);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = '${table}' AND policyname = 'rls_${table}_update'
          ) THEN
            CREATE POLICY rls_${table}_update ON public.${table}
              FOR UPDATE USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = '${table}' AND policyname = 'rls_${table}_delete'
          ) THEN
            CREATE POLICY rls_${table}_delete ON public.${table}
              FOR DELETE USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));
          END IF;
        END$$;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = ['profile_grafana_dashboards', 'profile_benchmarks'] as const;
    for (const table of tables) {
      await queryRunner.query(`DROP POLICY IF EXISTS rls_${table}_delete ON public.${table}`);
      await queryRunner.query(`DROP POLICY IF EXISTS rls_${table}_update ON public.${table}`);
      await queryRunner.query(`DROP POLICY IF EXISTS rls_${table}_insert ON public.${table}`);
      await queryRunner.query(`DROP POLICY IF EXISTS rls_${table}_select ON public.${table}`);
    }
  }
}
