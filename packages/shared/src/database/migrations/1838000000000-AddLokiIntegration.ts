import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Loki integration (docs/reference/Features/Loki Log Metrics (spec).md), the Loki twin of 1825:
 *
 * - loki_configs: a Loki datasource on a Grafana instance Perfana already holds credentials for.
 *   No credentials of its own; every query goes through that instance (`/api/ds/query` and the
 *   datasource's resource calls).
 * - loki_stream_mappings: label matchers mapped to a system at sut / environment / workload level.
 * - loki_queries: one panel per row, collected into ds_metrics on an artificial dashboard.
 * - loki_run_patterns / loki_run_samples: per-run snapshots of the top log patterns and the latest
 *   error / warning lines, taken at analysis because Loki's pattern ingester and retention drop
 *   them. Keyed on the run's varchar test_run_id with no FK to test_runs (like
 *   ds_metric_series_groups); the test-run delete removes them, the SUT delete cascades.
 *
 * Owned resources with the four standard RLS policies, copied from 1825. Every FK column has a
 * child-side index (root CLAUDE.md #57). metrics_source_id / application_dashboard_id carry no FK,
 * as on splunk_queries. The REFERENCES on systems_under_test and grafana_instances take SHARE ROW
 * EXCLUSIVE, so the wait is bounded the same way as 1825.
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, no reliance on the batch transaction,
 * idempotent. Not added to schema-sql.ts: a greenfield install runs the consolidated schema and
 * then this migration, which creates them.
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
  CREATE TABLE IF NOT EXISTS public.loki_configs (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    label character varying(255) NOT NULL,
    grafana_instance_id uuid NOT NULL REFERENCES public.grafana_instances(id) ON DELETE CASCADE,
    datasource_uid character varying(255) NOT NULL,
    datasource_name character varying(255),
    level_label character varying(100) NOT NULL DEFAULT 'detected_level',
    max_concurrent_queries integer NOT NULL DEFAULT 2
      CONSTRAINT ck_loki_configs_max_concurrent CHECK (max_concurrent_queries BETWEEN 1 AND 20),
    ${OWNERSHIP},
    CONSTRAINT uq_loki_configs_datasource UNIQUE (grafana_instance_id, datasource_uid)
  );
  CREATE INDEX IF NOT EXISTS idx_loki_configs_grafana_instance ON public.loki_configs (grafana_instance_id);
  ${policies('loki_configs')}

  CREATE TABLE IF NOT EXISTS public.loki_stream_mappings (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    loki_config_id uuid NOT NULL REFERENCES public.loki_configs(id) ON DELETE CASCADE,
    system_under_test_id uuid NOT NULL REFERENCES public.systems_under_test(id) ON DELETE CASCADE,
    test_environment character varying(255),
    workload character varying(255),
    level character varying(50) NOT NULL
      CONSTRAINT ck_loki_stream_mappings_level CHECK (
        (level = 'sut' AND test_environment IS NULL AND workload IS NULL)
        OR (level = 'environment' AND test_environment IS NOT NULL AND workload IS NULL)
        OR (level = 'workload' AND test_environment IS NOT NULL AND workload IS NOT NULL)),
    matchers jsonb NOT NULL,
    selector character varying(4000) NOT NULL,
    labels text[] NOT NULL DEFAULT '{}',
    ${OWNERSHIP},
    CONSTRAINT uq_loki_stream_mappings_slot UNIQUE NULLS NOT DISTINCT
      (system_under_test_id, test_environment, workload, loki_config_id, selector)
  );
  CREATE INDEX IF NOT EXISTS idx_loki_stream_mappings_config ON public.loki_stream_mappings (loki_config_id);
  ${policies('loki_stream_mappings')}

  CREATE TABLE IF NOT EXISTS public.loki_queries (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    loki_config_id uuid NOT NULL REFERENCES public.loki_configs(id) ON DELETE CASCADE,
    system_under_test_id uuid NOT NULL REFERENCES public.systems_under_test(id) ON DELETE CASCADE,
    test_environment character varying(255) NOT NULL,
    workload character varying(255) NOT NULL,
    dashboard_label character varying(255) NOT NULL DEFAULT 'Loki logs',
    application_dashboard_id uuid,
    metrics_source_id uuid,
    panel_title character varying(500) NOT NULL,
    panel_id integer NOT NULL,
    logql text NOT NULL,
    split_by character varying(255),
    aggregation character varying(100) NOT NULL DEFAULT 'count',
    metric_unit character varying(50) NOT NULL DEFAULT 'short',
    max_series integer NOT NULL DEFAULT 20
      CONSTRAINT ck_loki_queries_max_series CHECK (max_series BETWEEN 1 AND 100),
    enabled boolean NOT NULL DEFAULT true,
    ${OWNERSHIP},
    CONSTRAINT uq_loki_queries_panel UNIQUE (system_under_test_id, test_environment, workload, dashboard_label, panel_id)
  );
  CREATE INDEX IF NOT EXISTS idx_loki_queries_config ON public.loki_queries (loki_config_id);
  ${policies('loki_queries')}

  CREATE TABLE IF NOT EXISTS public.loki_run_patterns (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    test_run_id character varying(255) NOT NULL,
    system_under_test_id uuid NOT NULL REFERENCES public.systems_under_test(id) ON DELETE CASCADE,
    loki_config_id uuid,
    pattern text NOT NULL,
    pattern_key text NOT NULL,
    level character varying(50),
    count bigint NOT NULL,
    first_seen timestamptz,
    last_seen timestamptz,
    source character varying(20) NOT NULL DEFAULT 'patterns',
    ${OWNERSHIP}
  );
  CREATE INDEX IF NOT EXISTS idx_loki_run_patterns_run ON public.loki_run_patterns (test_run_id);
  CREATE INDEX IF NOT EXISTS idx_loki_run_patterns_sut ON public.loki_run_patterns (system_under_test_id);
  ${policies('loki_run_patterns')}

  CREATE TABLE IF NOT EXISTS public.loki_run_samples (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    test_run_id character varying(255) NOT NULL,
    system_under_test_id uuid NOT NULL REFERENCES public.systems_under_test(id) ON DELETE CASCADE,
    loki_config_id uuid,
    "time" timestamptz NOT NULL,
    level character varying(50),
    line text NOT NULL,
    labels jsonb NOT NULL DEFAULT '{}',
    ${OWNERSHIP}
  );
  CREATE INDEX IF NOT EXISTS idx_loki_run_samples_run ON public.loki_run_samples (test_run_id);
  CREATE INDEX IF NOT EXISTS idx_loki_run_samples_sut ON public.loki_run_samples (system_under_test_id);
  ${policies('loki_run_samples')}
`;

// Drops the five tables only. Rows Loki collection wrote elsewhere (metrics_sources with
// source_type 'loki', their artificial dashboards, ds_metrics and ds_compare_config) are run
// history and stay, as 1825's down() leaves Splunk's.
const DOWN_DDL = `
  DROP TABLE IF EXISTS public.loki_run_samples;
  DROP TABLE IF EXISTS public.loki_run_patterns;
  DROP TABLE IF EXISTS public.loki_queries;
  DROP TABLE IF EXISTS public.loki_stream_mappings;
  DROP TABLE IF EXISTS public.loki_configs;
`;

const withBoundedLockWait = (label: string, ddl: string): string => `
  DO $loki$
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
            'could not ${label}: systems_under_test or grafana_instances stayed locked across % attempts. Find the long-running transaction (pg_stat_activity, often a SUT deletion) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $loki$;
`;

export class AddLokiIntegration1838000000000 implements MigrationInterface {
  name = 'AddLokiIntegration1838000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('create the Loki tables', UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop the Loki tables', DOWN_DDL));
  }
}
