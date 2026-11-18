import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Series grouping rules in profiles (design: docs/design/2026-11-01-series-grouping-design.md, v1.1
 * "rules in profiles, so provisioning creates them").
 *
 * - `profile_series_grouping_rules` holds a rule on a profile dashboard: the rule fields of
 *   `series_grouping_rules` (same CHECKs) with the slot replaced by (profile dashboard, panel).
 *   Deleting the profile dashboard deletes its rules.
 * - `series_grouping_rules.profile_rule_id` names the profile rule a row was provisioned from.
 *   grafana-sync's auto-config writes one row per matching application dashboard and workload,
 *   and the API carries a profile-rule edit to every row the profile still owns.
 *   **Ownership is `updated_by IS NULL`**, the profile-SLO rule: a provisioned row is written with
 *   `created_by = 'system:profile'` and no `updated_by`, and any save through the rules API stamps
 *   the user, which detaches the row for good.
 * - `profile_rule_id` has NO foreign key, like `benchmarks.generic_check_id`: a SUT export carries
 *   the column into another environment where that profile rule does not exist, and an FK would
 *   reject the import. The API deletes owned rows itself when their profile rule goes.
 * - `origin` gains `'profile'`.
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, every statement safe to repeat, and
 * the lock wait bounded with the previous `lock_timeout` restored on both exit paths (1819).
 */
const UP_DDL = `
  CREATE TABLE IF NOT EXISTS public.profile_series_grouping_rules (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    profile_dashboard_id uuid NOT NULL
      REFERENCES public.profile_grafana_dashboards(id) ON DELETE CASCADE,
    panel_id integer,
    preset character varying(32) NOT NULL
      CONSTRAINT ck_profile_series_grouping_rules_preset CHECK (preset IN ('k8s-pod', 'k8s-daemonset', 'ip-port', 'trailing-id', 'custom')),
    pattern text,
    replacement text NOT NULL DEFAULT '',
    aggregations character varying(8)[] NOT NULL DEFAULT '{avg}'
      CONSTRAINT ck_profile_series_grouping_rules_aggregations
      CHECK (aggregations <@ ARRAY['avg', 'sum', 'max', 'count']::character varying(8)[]
             AND array_length(aggregations, 1) >= 1),
    enabled boolean NOT NULL DEFAULT true,
    organization_id uuid NOT NULL,
    team_id uuid,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ck_profile_series_grouping_rules_custom_pattern CHECK ((preset = 'custom') = (pattern IS NOT NULL)),
    CONSTRAINT uq_profile_series_grouping_rules_slot UNIQUE NULLS NOT DISTINCT (profile_dashboard_id, panel_id)
  );

  ALTER TABLE public.profile_series_grouping_rules ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.profile_series_grouping_rules FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_profile_series_grouping_rules_select ON public.profile_series_grouping_rules;
  CREATE POLICY rls_profile_series_grouping_rules_select ON public.profile_series_grouping_rules FOR SELECT
    USING (public.can_access_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_profile_series_grouping_rules_insert ON public.profile_series_grouping_rules;
  CREATE POLICY rls_profile_series_grouping_rules_insert ON public.profile_series_grouping_rules FOR INSERT
    WITH CHECK (public.is_global_admin() OR public.can_access_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_profile_series_grouping_rules_update ON public.profile_series_grouping_rules;
  CREATE POLICY rls_profile_series_grouping_rules_update ON public.profile_series_grouping_rules FOR UPDATE
    USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));
  DROP POLICY IF EXISTS rls_profile_series_grouping_rules_delete ON public.profile_series_grouping_rules;
  CREATE POLICY rls_profile_series_grouping_rules_delete ON public.profile_series_grouping_rules FOR DELETE
    USING (public.can_modify_resource(organization_id, team_id, (created_by)::text));

  ALTER TABLE public.series_grouping_rules ADD COLUMN IF NOT EXISTS profile_rule_id uuid NULL;
  CREATE INDEX IF NOT EXISTS idx_series_grouping_rules_profile_rule
    ON public.series_grouping_rules (profile_rule_id) WHERE profile_rule_id IS NOT NULL;
  ALTER TABLE public.series_grouping_rules DROP CONSTRAINT IF EXISTS ck_series_grouping_rules_origin;
  ALTER TABLE public.series_grouping_rules ADD CONSTRAINT ck_series_grouping_rules_origin
    CHECK (origin IN ('manual', 'suggestion', 'copy', 'profile'));
`;

const DOWN_DDL = `
  DELETE FROM public.series_grouping_rules WHERE origin = 'profile' AND updated_by IS NULL;
  UPDATE public.series_grouping_rules SET origin = 'manual' WHERE origin = 'profile';
  ALTER TABLE public.series_grouping_rules DROP CONSTRAINT IF EXISTS ck_series_grouping_rules_origin;
  ALTER TABLE public.series_grouping_rules ADD CONSTRAINT ck_series_grouping_rules_origin
    CHECK (origin IN ('manual', 'suggestion', 'copy'));
  DROP INDEX IF EXISTS public.idx_series_grouping_rules_profile_rule;
  ALTER TABLE public.series_grouping_rules DROP COLUMN IF EXISTS profile_rule_id;
  DROP TABLE IF EXISTS public.profile_series_grouping_rules;
`;

const withBoundedLockWait = (label: string, ddl: string): string => `
  DO $profile_grouping$
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
            'could not ${label}: series_grouping_rules or profile_grafana_dashboards stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $profile_grouping$;
`;

export class ProfileSeriesGroupingRules1826000000000 implements MigrationInterface {
  name = 'ProfileSeriesGroupingRules1826000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('add profile series grouping rules', UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop profile series grouping rules', DOWN_DDL));
  }
}
