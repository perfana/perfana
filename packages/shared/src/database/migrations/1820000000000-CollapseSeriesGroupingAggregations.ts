import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Collapses the three aggregation columns on the two series-grouping tables into one
 * `aggregations` array, for a database that already ran the v0.2.97.43 shape of 1819.
 *
 * WHY THIS EXISTS, given that 1819 was rewritten in the same release.
 *
 * 1819 creates the collapsed shape directly, which is enough for a database that has never
 * run it — a fresh install, where 1819 and this migration land in the same batch and this
 * one finds nothing to do. It is NOT enough for a database that ran v0.2.97.43, which is
 * merged to main and shipped `aggregation varchar(8)`, `track_member_count boolean` and
 * `extra_aggregations varchar(8)[]` on `series_grouping_rules`, plus `aggregation` and
 * `member_count_name` on `ds_metric_series_groups`. Editing a migration never reaches a
 * database that already executed it: TypeORM keys on the recorded name, so the rewritten
 * 1819 is skipped and the old columns stay. Meanwhile the entities declare `aggregations`
 * and TypeORM names every declared column in its SELECT, so every read of either table
 * fails with "column does not exist" — the 0.2.68.7 and 0.2.95.7 incidents, which is what
 * `npm run check:entity-migrations` is there to prevent.
 *
 * Deliberately NOT a re-create of the tables. `series_grouping_rules` rows are user-authored
 * (a regex and a preset per workload) and `ds_metric_series_groups` records what each run's
 * statistics were actually computed with — the resolver prefers it over the live rule so a
 * chart agrees with the numbers beside it, so dropping it silently re-points finished runs at
 * whatever the rule says today.
 *
 * Idempotent, and ordered so that a partial run can be repeated: every step is guarded on the
 * column it is about rather than on a version, because the three states in the wild (fresh,
 * v0.2.97.43, half-converted) are told apart only by the catalog.
 */
export class CollapseSeriesGroupingAggregations1820000000000 implements MigrationInterface {
  name = 'CollapseSeriesGroupingAggregations1820000000000';

  /**
   * Canonical order is the order of SERIES_GROUPING_AGGREGATIONS in
   * packages/shared/src/utils/series-grouping.ts, and it has to match: the rule hash is taken
   * over this list and decides whether a run reads as stale, so a set written in a different
   * order would mark every grouped run for recalculation.
   */
  private static readonly CANONICAL = `ARRAY['avg', 'sum', 'max', 'count']::character varying(8)[]`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nothing to convert on a database that has not seen these tables at all. 1819 runs
    // before this migration in the same batch, so on a fresh install they DO exist, already
    // collapsed, and every guard below is false.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.series_grouping_rules') IS NULL THEN
          RAISE NOTICE 'series_grouping_rules absent, nothing to collapse';
          RETURN;
        END IF;

        -- ---------------------------------------------------------------- rules
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'series_grouping_rules'
                     AND column_name = 'aggregation') THEN

          ALTER TABLE public.series_grouping_rules
            ADD COLUMN IF NOT EXISTS aggregations character varying(8)[]
              NOT NULL DEFAULT '{avg}';

          -- Union of the old primary, the old extras, and the count switch, projected back
          -- through the canonical list so the result is ordered and de-duplicated. A row can
          -- never end up empty: the old aggregation column was NOT NULL, so one element survives.
          UPDATE public.series_grouping_rules SET aggregations = ARRAY(
            SELECT a FROM unnest(${CollapseSeriesGroupingAggregations1820000000000.CANONICAL}) AS a
             WHERE a = ANY(ARRAY[aggregation]::character varying(8)[]
                           || COALESCE(extra_aggregations, ARRAY[]::character varying(8)[]))
                OR (a = 'count' AND track_member_count)
          );

          ALTER TABLE public.series_grouping_rules
            DROP CONSTRAINT IF EXISTS ck_series_grouping_rules_aggregation;
          ALTER TABLE public.series_grouping_rules DROP COLUMN IF EXISTS aggregation;
          ALTER TABLE public.series_grouping_rules DROP COLUMN IF EXISTS track_member_count;
          ALTER TABLE public.series_grouping_rules DROP COLUMN IF EXISTS extra_aggregations;
        END IF;

        -- The CHECK is added outside the guard: a half-converted database may already carry
        -- the column without it. It is the same predicate 1819 now creates.
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'ck_series_grouping_rules_aggregations') THEN
          ALTER TABLE public.series_grouping_rules
            ADD CONSTRAINT ck_series_grouping_rules_aggregations
            CHECK (aggregations <@ ${CollapseSeriesGroupingAggregations1820000000000.CANONICAL}
                   AND array_length(aggregations, 1) >= 1);
        END IF;

        -- ----------------------------------------------------------- membership
        IF to_regclass('public.ds_metric_series_groups') IS NOT NULL
           AND EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'ds_metric_series_groups'
                         AND column_name = 'aggregation') THEN

          ALTER TABLE public.ds_metric_series_groups
            ADD COLUMN IF NOT EXISTS aggregations character varying(8)[];

          -- Same projection, with one asymmetry against the rules table: a group the rule did
          -- NOT rename must end up with an EMPTY array. It passes through under its own name,
          -- so it emits no derived series at all, and the whole-panel readers pair
          -- allSeriesOf() with an exclude list built from the members. Give it {avg} — which is
          -- what the projection yields, since the old aggregation column was NOT NULL on every
          -- row including these — and the resolver starts offering "<name> (avg)" for a series
          -- that should keep its own name, and the pickers gain a duplicate that draws nothing.
          -- Measured on a real v0.2.97.43 database: 16 of 124 membership rows were this case.
          --
          -- The old shape recorded no renamed flag, so it is derived the only way available:
          -- a membership row whose group_name equals its metric_name named itself. An identity
          -- replacement lands here too, which is correct — it renamed nothing either.
          --
          -- The count series is recorded here by the PRESENCE of member_count_name, not by a
          -- boolean — that column held the series' own name.
          UPDATE public.ds_metric_series_groups SET aggregations =
            CASE WHEN group_name = metric_name THEN ARRAY[]::character varying(8)[]
            ELSE ARRAY(
              SELECT a FROM unnest(${CollapseSeriesGroupingAggregations1820000000000.CANONICAL}) AS a
               WHERE a = ANY(ARRAY[aggregation]::character varying(8)[]
                             || COALESCE(extra_aggregations, ARRAY[]::character varying(8)[]))
                  OR (a = 'count' AND member_count_name IS NOT NULL)
            ) END;

          -- NOT NULL only once every row has a value, or the ALTER fails on its own backfill.
          ALTER TABLE public.ds_metric_series_groups
            ALTER COLUMN aggregations SET NOT NULL;

          ALTER TABLE public.ds_metric_series_groups DROP COLUMN IF EXISTS aggregation;
          ALTER TABLE public.ds_metric_series_groups DROP COLUMN IF EXISTS extra_aggregations;
          ALTER TABLE public.ds_metric_series_groups DROP COLUMN IF EXISTS member_count_name;
        END IF;
      END $$;
    `);
  }

  /**
   * Restores the v0.2.97.43 columns. The first element of `aggregations` becomes the primary
   * and the rest become extras, which is lossless in the direction that matters — the old
   * reader took `aggregation` as the unsuffixed series — but it does NOT restore which one a
   * user originally picked as primary, because the collapsed model does not record that. A
   * rule that emitted only `{count}` cannot be expressed at all in the old shape (its
   * `aggregation` was constrained to avg/sum/max), so it is restored as `avg` with the count
   * switch on, which is the nearest representable rule.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.series_grouping_rules') IS NULL THEN RETURN; END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'series_grouping_rules'
                     AND column_name = 'aggregations') THEN
          ALTER TABLE public.series_grouping_rules
            DROP CONSTRAINT IF EXISTS ck_series_grouping_rules_aggregations;
          ALTER TABLE public.series_grouping_rules
            ADD COLUMN IF NOT EXISTS aggregation character varying(8) NOT NULL DEFAULT 'avg',
            ADD COLUMN IF NOT EXISTS track_member_count boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS extra_aggregations character varying(8)[] NOT NULL DEFAULT '{}';

          UPDATE public.series_grouping_rules SET
            aggregation = COALESCE((SELECT a FROM unnest(aggregations) AS a
                                     WHERE a <> 'count' LIMIT 1), 'avg'),
            track_member_count = 'count' = ANY(aggregations),
            extra_aggregations = ARRAY(SELECT a FROM unnest(aggregations) AS a
                                        WHERE a <> 'count'
                                        OFFSET 1);

          ALTER TABLE public.series_grouping_rules
            ADD CONSTRAINT ck_series_grouping_rules_aggregation
            CHECK (aggregation IN ('avg', 'sum', 'max'));
          ALTER TABLE public.series_grouping_rules DROP COLUMN IF EXISTS aggregations;
        END IF;

        IF to_regclass('public.ds_metric_series_groups') IS NOT NULL
           AND EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'ds_metric_series_groups'
                         AND column_name = 'aggregations') THEN
          ALTER TABLE public.ds_metric_series_groups
            ADD COLUMN IF NOT EXISTS aggregation character varying(8),
            ADD COLUMN IF NOT EXISTS extra_aggregations character varying(8)[],
            ADD COLUMN IF NOT EXISTS member_count_name character varying(255);

          UPDATE public.ds_metric_series_groups SET
            aggregation = COALESCE((SELECT a FROM unnest(aggregations) AS a
                                     WHERE a <> 'count' LIMIT 1), 'avg'),
            extra_aggregations = ARRAY(SELECT a FROM unnest(aggregations) AS a
                                        WHERE a <> 'count'
                                        OFFSET 1),
            member_count_name = CASE WHEN 'count' = ANY(aggregations)
                                     THEN group_name || ' (count)' END;

          ALTER TABLE public.ds_metric_series_groups ALTER COLUMN aggregation SET NOT NULL;
          ALTER TABLE public.ds_metric_series_groups DROP COLUMN IF EXISTS aggregations;
        END IF;
      END $$;
    `);
  }
}
