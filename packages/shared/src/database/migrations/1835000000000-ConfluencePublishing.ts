import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Publish a generated report to Confluence (docs/reference/Features/Confluence Publishing.md).
 *
 * - `confluence_configs`: one Confluence space per row, org-owned, with the four standard RLS
 *   policies copied from 1825. `api_token` is encrypted by the entity transformer.
 * - `generated_reports` gains where the report was last published, so publishing again updates
 *   that page instead of creating a second one. `confluence_config_id` carries no FK on purpose:
 *   deleting a connection must not touch report rows, and a stale id only means the next publish
 *   creates a fresh page.
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, every statement safe to repeat, and
 * the ACCESS EXCLUSIVE wait on `generated_reports` bounded, with the previous `lock_timeout`
 * restored on both exit paths. The three columns are nullable with no default, so adding them is
 * catalog-only and rewrites nothing.
 */
const UP_BODY = `
  CREATE TABLE IF NOT EXISTS public.confluence_configs (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    label character varying(255) NOT NULL,
    base_url character varying(500) NOT NULL,
    deployment character varying(20) NOT NULL DEFAULT 'cloud'
      CONSTRAINT ck_confluence_configs_deployment CHECK (deployment IN ('cloud', 'datacenter')),
    username character varying(255),
    api_token text NOT NULL,
    space_key character varying(255) NOT NULL,
    parent_page_id character varying(64),
    use_proxy boolean NOT NULL DEFAULT false,
    organization_id uuid NOT NULL,
    team_id uuid,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    updated_at timestamp without time zone NOT NULL DEFAULT now()
  );
  ALTER TABLE public.confluence_configs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.confluence_configs FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_confluence_configs_select ON public.confluence_configs;
  CREATE POLICY rls_confluence_configs_select ON public.confluence_configs FOR SELECT
    USING (public.can_access_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_confluence_configs_insert ON public.confluence_configs;
  CREATE POLICY rls_confluence_configs_insert ON public.confluence_configs FOR INSERT
    WITH CHECK (public.is_global_admin() OR public.can_access_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_confluence_configs_update ON public.confluence_configs;
  CREATE POLICY rls_confluence_configs_update ON public.confluence_configs FOR UPDATE
    USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_confluence_configs_delete ON public.confluence_configs;
  CREATE POLICY rls_confluence_configs_delete ON public.confluence_configs FOR DELETE
    USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));

  ALTER TABLE public.generated_reports ADD COLUMN IF NOT EXISTS confluence_config_id uuid;
  ALTER TABLE public.generated_reports ADD COLUMN IF NOT EXISTS confluence_page_id character varying(64);
  ALTER TABLE public.generated_reports ADD COLUMN IF NOT EXISTS confluence_page_url character varying(1000);
  ALTER TABLE public.generated_reports ADD COLUMN IF NOT EXISTS confluence_published_at timestamp with time zone;
`;

// Published pages stay in Confluence; only Perfana's record of them goes.
const DOWN_BODY = `
  ALTER TABLE public.generated_reports DROP COLUMN IF EXISTS confluence_published_at;
  ALTER TABLE public.generated_reports DROP COLUMN IF EXISTS confluence_page_url;
  ALTER TABLE public.generated_reports DROP COLUMN IF EXISTS confluence_page_id;
  ALTER TABLE public.generated_reports DROP COLUMN IF EXISTS confluence_config_id;
  DROP TABLE IF EXISTS public.confluence_configs;
`;

const withBoundedLockWait = (label: string, body: string): string => `
  DO $confluence$
  DECLARE
    attempt int := 0;
    prev_lock_timeout text := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    LOOP
      attempt := attempt + 1;
      BEGIN
        ${body}
        PERFORM set_config('lock_timeout', prev_lock_timeout, true);
        RETURN;
      EXCEPTION WHEN lock_not_available THEN
        IF attempt >= 10 THEN
          PERFORM set_config('lock_timeout', prev_lock_timeout, true);
          RAISE EXCEPTION
            'could not ${label}: generated_reports stayed locked across % attempts. Find the long-running transaction (pg_stat_activity, often a report or PDF job) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $confluence$;
`;

export class ConfluencePublishing1835000000000 implements MigrationInterface {
  name = 'ConfluencePublishing1835000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('add Confluence publishing', UP_BODY));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop Confluence publishing', DOWN_BODY));
  }
}
