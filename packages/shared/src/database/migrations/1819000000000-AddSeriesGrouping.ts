import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Series grouping (docs/design/2026-11-01-series-grouping-design.md).
 *
 * `series_grouping_rules` — a user-editable, per-workload rule that rewrites raw series names
 * (Kubernetes pod names) to group names. Owned resource: RLS with the four standard policies,
 * copied from 1783409734007-AddProxyServer.
 *
 * `ds_metric_series_groups` — derived: the raw -> group membership a run's statistics were
 * computed with, written by StatisticsPipeline in the same transaction as ds_metric_statistics.
 * Like ds_metric_statistics it has no policy of its own; the worker writes it as perfana_system,
 * and the API reads it only for runs it has already authorized.
 *
 * Nothing reads either table until a rule exists, so this migration changes no behaviour.
 *
 * Three things are load-bearing:
 *
 * 1. **`UNIQUE NULLS NOT DISTINCT` on the rule slot.** `panel_id` NULL means "every panel on the
 *    dashboard"; with a plain UNIQUE two such rules could coexist, because NULLs never collide in
 *    a btree unique (root CLAUDE.md #36, `uq_benchmarks_unique`). Needs PG15+, which the image is.
 * 2. **Every FK column has a child-side index** (root CLAUDE.md #57): a parent delete otherwise
 *    scans the child once per deleted row. The slot's unique index leads on
 *    system_under_test_id, so it already serves that FK.
 * 3. **The lock wait is bounded.** Each REFERENCES clause takes SHARE ROW EXCLUSIVE on the
 *    referenced table, and the SUT deletion queue can hold ROW EXCLUSIVE on application_dashboards
 *    and systems_under_test for minutes. Postgres' lock queue is FIFO, so an unbounded wait parks
 *    this request in front of every writer that arrives behind it. Same retry as 1814: plpgsql,
 *    because a `lock_timeout` error would otherwise poison the batch's `transaction: "all"`.
 *
 * Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS): schema-sql.ts carries both tables too, and a
 * greenfield install runs the consolidated schema and then this migration.
 */

const UP_DDL = `
  CREATE TABLE IF NOT EXISTS public.series_grouping_rules (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    system_under_test_id uuid NOT NULL REFERENCES public.systems_under_test(id) ON DELETE CASCADE,
    test_environment character varying(255) NOT NULL,
    workload character varying(255) NOT NULL,
    application_dashboard_id uuid NOT NULL REFERENCES public.application_dashboards(id) ON DELETE CASCADE,
    panel_id integer,
    preset character varying(32) NOT NULL
      CONSTRAINT ck_series_grouping_rules_preset CHECK (preset IN ('k8s-pod', 'k8s-daemonset', 'ip-port', 'trailing-id', 'custom')),
    pattern text,
    replacement text NOT NULL DEFAULT '',
    aggregation character varying(8) NOT NULL DEFAULT 'avg'
      CONSTRAINT ck_series_grouping_rules_aggregation CHECK (aggregation IN ('avg', 'sum', 'max')),
    track_member_count boolean NOT NULL DEFAULT false,
    enabled boolean NOT NULL DEFAULT true,
    origin character varying(16) NOT NULL DEFAULT 'manual'
      CONSTRAINT ck_series_grouping_rules_origin CHECK (origin IN ('manual', 'suggestion', 'copy')),
    organization_id uuid NOT NULL,
    team_id uuid,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ck_series_grouping_rules_custom_pattern CHECK ((preset = 'custom') = (pattern IS NOT NULL)),
    CONSTRAINT uq_series_grouping_rules_slot UNIQUE NULLS NOT DISTINCT
      (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id)
  );
  CREATE INDEX IF NOT EXISTS idx_series_grouping_rules_app_dashboard ON public.series_grouping_rules (application_dashboard_id);

  ALTER TABLE public.series_grouping_rules ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.series_grouping_rules FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_series_grouping_rules_select ON public.series_grouping_rules;
  CREATE POLICY rls_series_grouping_rules_select ON public.series_grouping_rules FOR SELECT
    USING (public.can_access_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_series_grouping_rules_insert ON public.series_grouping_rules;
  CREATE POLICY rls_series_grouping_rules_insert ON public.series_grouping_rules FOR INSERT
    WITH CHECK (public.is_global_admin() OR public.can_access_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_series_grouping_rules_update ON public.series_grouping_rules;
  CREATE POLICY rls_series_grouping_rules_update ON public.series_grouping_rules FOR UPDATE
    USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_series_grouping_rules_delete ON public.series_grouping_rules;
  CREATE POLICY rls_series_grouping_rules_delete ON public.series_grouping_rules FOR DELETE
    USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));

  CREATE TABLE IF NOT EXISTS public.ds_metric_series_groups (
    test_run_id character varying(255) NOT NULL,
    application_dashboard_id uuid NOT NULL REFERENCES public.application_dashboards(id) ON DELETE CASCADE,
    panel_id integer NOT NULL,
    metric_name character varying(255) NOT NULL,
    group_name character varying(255) NOT NULL,
    member_count_name character varying(255),
    dashboard_label character varying(255),
    panel_title character varying(255),
    aggregation character varying(8) NOT NULL,
    avg_members real,
    rule_id uuid REFERENCES public.series_grouping_rules(id) ON DELETE SET NULL,
    rule_hash character varying(16) NOT NULL,
    organization_id uuid,
    team_id uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT pk_ds_metric_series_groups PRIMARY KEY (test_run_id, application_dashboard_id, panel_id, metric_name)
  );
  CREATE INDEX IF NOT EXISTS idx_ds_metric_series_groups_group ON public.ds_metric_series_groups (test_run_id, application_dashboard_id, panel_id, group_name);
  CREATE INDEX IF NOT EXISTS idx_ds_metric_series_groups_label ON public.ds_metric_series_groups (test_run_id, dashboard_label, panel_title, panel_id);
  CREATE INDEX IF NOT EXISTS idx_ds_metric_series_groups_app_dashboard ON public.ds_metric_series_groups (application_dashboard_id);
  -- ON DELETE SET NULL probes this column on every rule delete.
  CREATE INDEX IF NOT EXISTS idx_ds_metric_series_groups_rule ON public.ds_metric_series_groups (rule_id);
`;

const DOWN_DDL = `
  DROP TABLE IF EXISTS public.ds_metric_series_groups;
  DROP TABLE IF EXISTS public.series_grouping_rules;
`;

/** Run `ddl` with a 3 s lock_timeout, retried up to 10 times, as 1814 does. */
const withBoundedLockWait = (label: string, ddl: string): string => `
  DO $series_grouping$
  DECLARE
    attempt int := 0;
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    LOOP
      attempt := attempt + 1;
      BEGIN
        ${ddl}
        RETURN;
      EXCEPTION WHEN lock_not_available THEN
        IF attempt >= 10 THEN
          RAISE EXCEPTION
            'could not ${label}: application_dashboards or systems_under_test stayed locked across % attempts. Find the long-running transaction (pg_stat_activity, often a SUT deletion) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $series_grouping$;
`;

export class AddSeriesGrouping1819000000000 implements MigrationInterface {
  name = 'AddSeriesGrouping1819000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('create the series grouping tables', UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop the series grouping tables', DOWN_DDL));
  }
}
