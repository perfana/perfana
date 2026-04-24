import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Restore RLS policies on api_keys, url_patterns, and generated_reports after
 * the AddWorkloadToEvents migration removed team_id from those tables.
 *
 * Background:
 * - 1776148518354-AddWorkloadToEvents dropped team_id from these three tables.
 * - PR #125 added DROP POLICY for url_patterns/generated_reports without
 *   recreating them, leaving those tables with RLS ENABLED + FORCED + zero
 *   policies (deny-all if DB_ENABLE_RLS_ROLE is ever flipped on).
 * - api_keys was missed entirely by PR #125, hitting issue #149 on populated
 *   DBs upgrading from 0.2.35.0.
 * - The AddWorkloadToEvents fix in this same release drops api_keys policies
 *   too. After it, all three tables have no policies.
 *
 * This migration restores defense-in-depth for the future RLS enforcement work
 * by introducing 2-arg variants of can_access_resource / can_modify_resource
 * (org + created_by, no team_id) and recreating the four policies on each
 * table using the new signature. The 3-arg helpers stay in place because the
 * other ~30 RLS-protected tables still call them with team_id.
 *
 * Idempotent: safe to run on fresh installs, on DBs that ran the fixed
 * AddWorkloadToEvents naturally, and on production DBs that ran the original
 * broken migration via the manual workaround.
 */
export class RestoreRlsPoliciesPostTeamIdRemoval1777400000000
  implements MigrationInterface
{
  name = 'RestoreRlsPoliciesPostTeamIdRemoval1777400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 2-arg helpers: delegate to the existing 3-arg implementations with
    // resource_team_id := NULL. Keeps semantics identical for the team-skip
    // path and avoids duplicating the policy logic.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.can_access_resource(
        resource_org_id uuid,
        resource_created_by text
      ) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        AS $$
          SELECT public.can_access_resource(resource_org_id, NULL::uuid, resource_created_by);
        $$
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.can_modify_resource(
        resource_org_id uuid,
        resource_created_by text
      ) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        AS $$
          SELECT public.can_modify_resource(resource_org_id, NULL::uuid, resource_created_by);
        $$
    `);

    await this.replacePolicies(queryRunner, 'api_keys', {
      insertCheck: 'true',
    });
    await this.replacePolicies(queryRunner, 'url_patterns', {
      insertCheck:
        '(public.is_global_admin() OR public.can_access_resource(organization_id, (created_by)::text))',
    });
    await this.replacePolicies(queryRunner, 'generated_reports', {
      insertCheck: 'true',
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the policies this migration created. Tables are left with RLS
    // ENABLED + FORCED + zero policies, matching the state immediately after
    // AddWorkloadToEvents runs. Restoring the original 3-arg policies isn't
    // possible because team_id is gone from these tables.
    for (const table of ['api_keys', 'url_patterns', 'generated_reports']) {
      for (const op of ['select', 'insert', 'update', 'delete']) {
        await queryRunner.query(
          `DROP POLICY IF EXISTS rls_${table}_${op} ON "${table}"`,
        );
      }
    }
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.can_access_resource(uuid, text)`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.can_modify_resource(uuid, text)`,
    );
  }

  private async replacePolicies(
    queryRunner: QueryRunner,
    table: string,
    opts: { insertCheck: string },
  ): Promise<void> {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS rls_${table}_${op} ON "${table}"`,
      );
    }
    await queryRunner.query(
      `CREATE POLICY rls_${table}_select ON "${table}" FOR SELECT ` +
        `USING (public.can_access_resource(organization_id, (created_by)::text))`,
    );
    await queryRunner.query(
      `CREATE POLICY rls_${table}_insert ON "${table}" FOR INSERT ` +
        `WITH CHECK (${opts.insertCheck})`,
    );
    await queryRunner.query(
      `CREATE POLICY rls_${table}_update ON "${table}" FOR UPDATE ` +
        `USING (public.can_modify_resource(organization_id, (created_by)::text))`,
    );
    await queryRunner.query(
      `CREATE POLICY rls_${table}_delete ON "${table}" FOR DELETE ` +
        `USING (public.can_modify_resource(organization_id, (created_by)::text))`,
    );
  }
}
