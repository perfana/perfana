import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5b PR1: Strip the pre-Phase-4 escape hatch (`IF resource_org_id IS NULL
 * THEN RETURN TRUE`) from `can_access_resource` and `can_modify_resource`.
 *
 * Phase 4 made `organization_id NOT NULL` on all owned-resource entities. The
 * permissive NULL branch is dead code that misrepresents the security model.
 * Replace with `RETURN FALSE` so any unexpected NULL surfaces as denial, not
 * silent permissibility. (The two intentional NULL holders — audit_logs and
 * url_patterns — have custom policies that don't call these helpers, or call
 * them with a non-null id; see migration 1778400000000 and the existing
 * 1777400000000-RestoreRlsPoliciesPostTeamIdRemoval.)
 *
 * Note: capability semantics in `can_modify_resource` are intentionally LOOSER
 * than service-layer enforcement (any org-member can modify any same-org
 * resource). This is documented as a SQL comment so future maintainers don't
 * "fix" the asymmetry. RLS = coarse backstop; service layer = precise check
 * (Phase 5b spec §4.4).
 */
export class TightenRlsHelpers1778100000000 implements MigrationInterface {
  name = 'TightenRlsHelpers1778100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Tightened can_access_resource (3-arg, the canonical helper).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.can_access_resource(
        resource_org_id uuid,
        resource_team_id uuid,
        resource_created_by text
      ) RETURNS boolean
        LANGUAGE plpgsql STABLE SECURITY DEFINER
        AS $$
        BEGIN
          IF is_global_admin() THEN
            RETURN TRUE;
          END IF;
          -- Phase 4: organization_id is NOT NULL on every owned resource.
          -- A NULL here indicates a bug or misconfigured caller — fail closed.
          IF resource_org_id IS NULL THEN
            RETURN FALSE;
          END IF;
          IF resource_org_id = ANY(current_user_organizations()) THEN
            RETURN TRUE;
          END IF;
          IF resource_team_id IS NOT NULL AND resource_team_id = ANY(current_user_teams()) THEN
            RETURN TRUE;
          END IF;
          IF resource_created_by IS NOT NULL AND resource_created_by = current_user_id() THEN
            RETURN TRUE;
          END IF;
          RETURN FALSE;
        END;
        $$
    `);

    // Tightened can_modify_resource (3-arg).
    //
    // Loose-by-design: any org-member can modify any same-org resource. The
    // service layer adds finer capability gates (e.g., @RequiresCapability,
    // canModifyResource() row-level checks). RLS is the coarse backstop.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.can_modify_resource(
        resource_org_id uuid,
        resource_team_id uuid DEFAULT NULL::uuid,
        resource_created_by text DEFAULT NULL::text
      ) RETURNS boolean
        LANGUAGE plpgsql STABLE SECURITY DEFINER
        AS $$
          DECLARE
            user_id TEXT;
            user_orgs UUID[];
            user_teams UUID[];
            user_roles TEXT;
          BEGIN
            IF is_global_admin() THEN
              RETURN TRUE;
            END IF;
            user_id := current_user_id();
            user_orgs := current_user_organizations();
            user_teams := current_user_teams();
            user_roles := current_setting('app.current_user_roles', true);

            IF user_id IS NULL THEN
              RETURN FALSE;
            END IF;

            -- Phase 4: NOT NULL on owned resources. Fail closed on unexpected NULL.
            IF resource_org_id IS NULL THEN
              RETURN FALSE;
            END IF;

            -- Creator path
            IF resource_created_by IS NOT NULL AND resource_created_by = user_id THEN
              RETURN TRUE;
            END IF;

            -- Org-admin in the resource's organization
            IF resource_org_id = ANY(user_orgs) AND user_roles LIKE '%"org-admin"%' THEN
              RETURN TRUE;
            END IF;

            -- Team-admin in the resource's team
            IF resource_team_id IS NOT NULL AND resource_team_id = ANY(user_teams)
               AND user_roles LIKE '%"team-admin"%' THEN
              RETURN TRUE;
            END IF;

            -- Coarse backstop: org/team membership allows modify.
            -- Loose vs service layer; precise gates live there.
            IF resource_org_id = ANY(user_orgs) THEN
              RETURN TRUE;
            END IF;
            IF resource_team_id IS NOT NULL AND resource_team_id = ANY(user_teams) THEN
              RETURN TRUE;
            END IF;

            RETURN FALSE;
          END;
          $$
    `);

    // The 2-arg variants (added in 1777400000000) delegate to the 3-arg
    // helpers. They pick up the tightened semantics automatically because
    // CREATE OR REPLACE preserves dependent function bodies.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the pre-tightening permissive helpers.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.can_access_resource(
        resource_org_id uuid,
        resource_team_id uuid,
        resource_created_by text
      ) RETURNS boolean
        LANGUAGE plpgsql STABLE SECURITY DEFINER
        AS $$
        BEGIN
          IF is_global_admin() THEN
            RETURN TRUE;
          END IF;
          IF resource_org_id IS NULL AND resource_team_id IS NULL AND resource_created_by IS NULL THEN
            RETURN TRUE;
          END IF;
          IF resource_org_id IS NULL THEN
            RETURN TRUE;
          END IF;
          IF resource_org_id = ANY(current_user_organizations()) THEN
            RETURN TRUE;
          END IF;
          IF resource_team_id IS NOT NULL AND resource_team_id = ANY(current_user_teams()) THEN
            RETURN TRUE;
          END IF;
          IF resource_created_by IS NOT NULL AND resource_created_by = current_user_id() THEN
            RETURN TRUE;
          END IF;
          RETURN FALSE;
        END;
        $$
    `);
    // can_modify_resource: full pre-tightening body restored.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.can_modify_resource(
        resource_org_id uuid,
        resource_team_id uuid DEFAULT NULL::uuid,
        resource_created_by text DEFAULT NULL::text
      ) RETURNS boolean
        LANGUAGE plpgsql STABLE SECURITY DEFINER
        AS $$
          DECLARE
            user_id TEXT;
            user_orgs UUID[];
            user_teams UUID[];
            user_roles TEXT;
          BEGIN
            IF is_global_admin() THEN RETURN TRUE; END IF;
            user_id := current_user_id();
            user_orgs := current_user_organizations();
            user_teams := current_user_teams();
            user_roles := current_setting('app.current_user_roles', true);
            IF user_id IS NULL THEN RETURN FALSE; END IF;
            IF resource_created_by IS NOT NULL AND resource_created_by = user_id THEN
              RETURN TRUE;
            END IF;
            IF resource_org_id IS NULL THEN
              IF user_roles LIKE '%"org-admin"%' THEN RETURN TRUE; END IF;
              RETURN FALSE;
            END IF;
            IF resource_org_id = ANY(user_orgs) THEN
              IF user_roles LIKE '%"org-admin"%' THEN RETURN TRUE; END IF;
            END IF;
            IF resource_team_id IS NOT NULL AND resource_team_id = ANY(user_teams) THEN
              IF user_roles LIKE '%"team-admin"%' THEN RETURN TRUE; END IF;
            END IF;
            IF resource_org_id = ANY(user_orgs) THEN RETURN TRUE; END IF;
            IF resource_team_id IS NOT NULL AND resource_team_id = ANY(user_teams) THEN
              RETURN TRUE;
            END IF;
            RETURN FALSE;
          END;
          $$
    `);
  }
}
