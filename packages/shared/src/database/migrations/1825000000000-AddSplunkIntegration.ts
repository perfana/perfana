import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splunk integration (docs/reference/Features/Splunk Log Metrics (spec).md):
 * splunk_configs, splunk_entity_mappings, splunk_queries. Owned resources with the four standard
 * RLS policies, copied from 1819.
 *
 * - The two child tables reference systems_under_test ON DELETE CASCADE, so the SUT deletion queue
 *   needs no Splunk-specific phase; every FK column has a child-side index (root CLAUDE.md #57).
 * - metrics_source_id / application_dashboard_id carry no FK on purpose, like dynatrace_queries'
 *   application_dashboard_id: the worker fills them on first collection and a dashboard delete
 *   must not be blocked by a query row.
 * - The REFERENCES on systems_under_test takes SHARE ROW EXCLUSIVE, so the wait is bounded the same
 *   way as 1819 (plpgsql, lock_timeout captured and restored — transaction: "all" spans the batch).
 * - No SAVEPOINT, no reliance on the batch transaction (root CLAUDE.md #64).
 *
 * Idempotent; nothing reads these tables until a Splunk config exists. Not added to schema-sql.ts:
 * a greenfield install runs the consolidated schema and then this migration, which creates them.
 */

const policies = (table: string): string => `
  ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_${table}_select ON public.${table};
  CREATE POLICY rls_${table}_select ON public.${table} FOR SELECT
    USING (public.can_access_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_${table}_insert ON public.${table};
  CREATE POLICY rls_${table}_insert ON public.${table} FOR INSERT
    WITH CHECK (public.is_global_admin() OR public.can_access_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_${table}_update ON public.${table};
  CREATE POLICY rls_${table}_update ON public.${table} FOR UPDATE
    USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_${table}_delete ON public.${table};
  CREATE POLICY rls_${table}_delete ON public.${table} FOR DELETE
    USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));
`;

const OWNERSHIP = `
    organization_id uuid NOT NULL,
    team_id uuid,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    updated_at timestamp without time zone NOT NULL DEFAULT now()
`;

const UP_DDL = `
  CREATE TABLE IF NOT EXISTS public.splunk_configs (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    label character varying(255) NOT NULL,
    host character varying(500) NOT NULL,
    client_url character varying(500),
    api_token text,
    username character varying(255),
    password text,
    splunk_app character varying(100) NOT NULL DEFAULT 'search',
    verify_tls boolean NOT NULL DEFAULT true,
    use_proxy boolean NOT NULL DEFAULT false,
    max_concurrent_searches integer NOT NULL DEFAULT 2
      CONSTRAINT ck_splunk_configs_max_concurrent CHECK (max_concurrent_searches BETWEEN 1 AND 20),
    ${OWNERSHIP}
  );
  ${policies('splunk_configs')}

  CREATE TABLE IF NOT EXISTS public.splunk_entity_mappings (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    splunk_config_id uuid NOT NULL REFERENCES public.splunk_configs(id) ON DELETE CASCADE,
    system_under_test_id uuid NOT NULL REFERENCES public.systems_under_test(id) ON DELETE CASCADE,
    test_environment character varying(255),
    workload character varying(255),
    level character varying(50) NOT NULL
      CONSTRAINT ck_splunk_entity_mappings_level CHECK (
        (level = 'sut' AND test_environment IS NULL AND workload IS NULL)
        OR (level = 'environment' AND test_environment IS NOT NULL AND workload IS NULL)
        OR (level = 'workload' AND test_environment IS NOT NULL AND workload IS NOT NULL)),
    index_name character varying(255) NOT NULL,
    sourcetype character varying(255),
    host_pattern character varying(500),
    labels text[] NOT NULL DEFAULT '{}',
    ${OWNERSHIP},
    CONSTRAINT uq_splunk_entity_mappings_slot UNIQUE NULLS NOT DISTINCT
      (system_under_test_id, test_environment, workload, splunk_config_id, index_name, sourcetype, host_pattern)
  );
  CREATE INDEX IF NOT EXISTS idx_splunk_entity_mappings_config ON public.splunk_entity_mappings (splunk_config_id);
  ${policies('splunk_entity_mappings')}

  CREATE TABLE IF NOT EXISTS public.splunk_queries (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    splunk_config_id uuid NOT NULL REFERENCES public.splunk_configs(id) ON DELETE CASCADE,
    system_under_test_id uuid NOT NULL REFERENCES public.systems_under_test(id) ON DELETE CASCADE,
    test_environment character varying(255) NOT NULL,
    workload character varying(255) NOT NULL,
    dashboard_label character varying(255) NOT NULL DEFAULT 'Splunk logs',
    application_dashboard_id uuid,
    metrics_source_id uuid,
    panel_title character varying(500) NOT NULL,
    panel_id integer NOT NULL,
    spl text NOT NULL,
    split_by character varying(255),
    aggregation character varying(100) NOT NULL DEFAULT 'count',
    metric_unit character varying(50) NOT NULL DEFAULT 'short',
    max_series integer NOT NULL DEFAULT 20
      CONSTRAINT ck_splunk_queries_max_series CHECK (max_series BETWEEN 1 AND 100),
    enabled boolean NOT NULL DEFAULT true,
    ${OWNERSHIP},
    CONSTRAINT uq_splunk_queries_panel UNIQUE (system_under_test_id, test_environment, workload, dashboard_label, panel_id)
  );
  CREATE INDEX IF NOT EXISTS idx_splunk_queries_config ON public.splunk_queries (splunk_config_id);
  ${policies('splunk_queries')}
`;

// Drops the three tables only. Rows Splunk collection wrote elsewhere stay on purpose: the
// metrics_sources rows with source_type 'splunk', their artificial application_dashboards and
// grafana_dashboards placeholders, and the ds_metrics / ds_compare_config rows under them. They are
// run history; nothing reads source_type 'splunk' once the integration is gone.
const DOWN_DDL = `
  DROP TABLE IF EXISTS public.splunk_queries;
  DROP TABLE IF EXISTS public.splunk_entity_mappings;
  DROP TABLE IF EXISTS public.splunk_configs;
`;

const withBoundedLockWait = (label: string, ddl: string): string => `
  DO $splunk$
  DECLARE
    attempt int := 0;
    prev_lock_timeout text := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    LOOP
      attempt := attempt + 1;
      BEGIN
        ${ddl}
        PERFORM set_config('lock_timeout', prev_lock_timeout, true);
        RETURN;
      EXCEPTION WHEN lock_not_available THEN
        IF attempt >= 10 THEN
          PERFORM set_config('lock_timeout', prev_lock_timeout, true);
          RAISE EXCEPTION
            'could not ${label}: systems_under_test stayed locked across % attempts. Find the long-running transaction (pg_stat_activity, often a SUT deletion) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $splunk$;
`;

export class AddSplunkIntegration1825000000000 implements MigrationInterface {
  name = 'AddSplunkIntegration1825000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('create the Splunk tables', UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop the Splunk tables', DOWN_DDL));
  }
}
