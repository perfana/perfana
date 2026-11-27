import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-application view of the Loki card (docs/reference/Features/Loki Log Metrics (spec).md,
 * "Applications"):
 *
 * - loki_configs.service_label: the label that names an application (default `service_name`, which
 *   Loki 3 derives for every stream).
 * - loki_run_services: per run and service, the lines / error lines / warning lines in the run
 *   window, snapshotted at analysis like loki_run_patterns. The card's per-application error rate
 *   and its baseline come from here, independent of how the panels are set up.
 * - loki_run_patterns.service / loki_run_samples.service: the application a snapshot row belongs
 *   to; NULL for the rows taken over all mapped streams, which is what the card showed before.
 *
 * Every ADD COLUMN is nullable or has a constant default, so none rewrites the table. The new
 * table copies 1838's shape: owned resource, four RLS policies, child-side FK index, varchar
 * test_run_id with no FK (the test-run delete removes it), system FK ON DELETE CASCADE.
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, idempotent, lock waits bounded.
 */

const OWNERSHIP = `
    organization_id uuid NOT NULL,
    team_id uuid,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    updated_at timestamp without time zone NOT NULL DEFAULT now()
`;

const UP_DDL = `
  ALTER TABLE public.loki_configs ADD COLUMN IF NOT EXISTS service_label character varying(100) NOT NULL DEFAULT 'service_name';
  ALTER TABLE public.loki_run_patterns ADD COLUMN IF NOT EXISTS service character varying(255);
  ALTER TABLE public.loki_run_samples ADD COLUMN IF NOT EXISTS service character varying(255);

  CREATE TABLE IF NOT EXISTS public.loki_run_services (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    test_run_id character varying(255) NOT NULL,
    system_under_test_id uuid NOT NULL REFERENCES public.systems_under_test(id) ON DELETE CASCADE,
    loki_config_id uuid,
    service character varying(255) NOT NULL,
    total_lines bigint NOT NULL,
    error_lines bigint NOT NULL,
    warn_lines bigint NOT NULL,
    ${OWNERSHIP}
  );
  CREATE INDEX IF NOT EXISTS idx_loki_run_services_run ON public.loki_run_services (test_run_id);
  CREATE INDEX IF NOT EXISTS idx_loki_run_services_sut ON public.loki_run_services (system_under_test_id);
  ALTER TABLE public.loki_run_services ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.loki_run_services FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_loki_run_services_select ON public.loki_run_services;
  CREATE POLICY rls_loki_run_services_select ON public.loki_run_services FOR SELECT
    USING (public.can_access_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_loki_run_services_insert ON public.loki_run_services;
  CREATE POLICY rls_loki_run_services_insert ON public.loki_run_services FOR INSERT
    WITH CHECK (public.is_global_admin() OR public.can_access_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_loki_run_services_update ON public.loki_run_services;
  CREATE POLICY rls_loki_run_services_update ON public.loki_run_services FOR UPDATE
    USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_loki_run_services_delete ON public.loki_run_services;
  CREATE POLICY rls_loki_run_services_delete ON public.loki_run_services FOR DELETE
    USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));
`;

const DOWN_DDL = `
  DROP TABLE IF EXISTS public.loki_run_services;
  ALTER TABLE public.loki_run_samples DROP COLUMN IF EXISTS service;
  ALTER TABLE public.loki_run_patterns DROP COLUMN IF EXISTS service;
  ALTER TABLE public.loki_configs DROP COLUMN IF EXISTS service_label;
`;

const withBoundedLockWait = (label: string, ddl: string): string => `
  DO $loki_apps$
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
            'could not ${label}: a Loki table or systems_under_test stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $loki_apps$;
`;

export class LokiApplications1839000000000 implements MigrationInterface {
  name = 'LokiApplications1839000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('add the Loki application columns', UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop the Loki application columns', DOWN_DDL));
  }
}
