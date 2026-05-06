import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Restore the four standard RLS policies on `public.check_results`.
 *
 * The consolidated schema (`1700000000000-ConsolidatedSchema.ts` via
 * `schema-sql.ts`) ran `ALTER TABLE public.check_results ENABLE ROW LEVEL
 * SECURITY` but never emitted the matching `CREATE POLICY rls_check_results_*`
 * block — sister tables on the same line range (`api_keys`,
 * `application_dashboards`, `benchmarks`, …) all have RLS *and* their four
 * policies. With RLS enabled and zero policies, Postgres denies every row to
 * non-owner roles. Once `1778000000000-CreatePerfanaSystemRole` introduced the
 * `NOBYPASSRLS` `perfana_system` role used by the worker, every benchmark
 * INSERT into `check_results` started failing with
 * `new row violates row-level security policy for table "check_results"`,
 * because `is_global_admin()` had no policy to short-circuit from.
 *
 * Surfaced through worker logs:
 *   [checks-evaluation] Failed to process benchmark <id>:
 *     QueryFailedError: new row violates row-level security policy for table "check_results"
 *   [checks-evaluation] Marked test run <name> as invalid: 10/10 benchmarks failed to process
 *
 * Same class of bug fixed for `api_keys` / `url_patterns` / `generated_reports`
 * in `1777400000000-RestoreRlsPoliciesPostTeamIdRemoval.ts`, and for
 * `profile_grafana_dashboards` / `profile_benchmarks` in
 * `1778600000000-AddProfileChildrenRlsPolicies.ts`. `check_results` was
 * overlooked at the time.
 *
 * Policies mirror the `rls_benchmarks_*` shape exactly — `check_results` has
 * the same ownership columns (`organization_id`, `team_id`, `created_by`) and
 * the same write semantics (worker INSERTs benchmark check rows on behalf of
 * the test run owner). INSERT uses
 * `is_global_admin() OR can_access_resource(...)` so the worker (running as
 * `perfana_system` with `app.current_user_roles='["super-admin"]'`) and
 * regular org users can both write.
 *
 * FORCE is not added here. `check_results.relforcerowsecurity` is currently
 * `f` (matching the schema baseline); flipping it is a separate decision that
 * affects superuser bypass during admin work and is out of scope for this fix.
 *
 * Idempotent: each `CREATE POLICY` is wrapped in a `pg_policies` guard so a
 * partial `up()` run on a hand-patched DB does not error on re-run.
 */
export class RestoreCheckResultsRlsPolicies1778700000000
  implements MigrationInterface
{
  name = 'RestoreCheckResultsRlsPolicies1778700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'check_results' AND policyname = 'rls_check_results_select'
        ) THEN
          CREATE POLICY rls_check_results_select ON public.check_results
            FOR SELECT USING (public.can_access_resource(organization_id, team_id, (created_by)::text));
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'check_results' AND policyname = 'rls_check_results_insert'
        ) THEN
          CREATE POLICY rls_check_results_insert ON public.check_results
            FOR INSERT WITH CHECK (public.is_global_admin() OR public.can_access_resource(organization_id, team_id, (created_by)::text));
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'check_results' AND policyname = 'rls_check_results_update'
        ) THEN
          CREATE POLICY rls_check_results_update ON public.check_results
            FOR UPDATE USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'check_results' AND policyname = 'rls_check_results_delete'
        ) THEN
          CREATE POLICY rls_check_results_delete ON public.check_results
            FOR DELETE USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));
        END IF;
      END$$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS rls_check_results_delete ON public.check_results`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS rls_check_results_update ON public.check_results`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS rls_check_results_insert ON public.check_results`,
    );
    await queryRunner.query(
      `DROP POLICY IF EXISTS rls_check_results_select ON public.check_results`,
    );
  }
}
