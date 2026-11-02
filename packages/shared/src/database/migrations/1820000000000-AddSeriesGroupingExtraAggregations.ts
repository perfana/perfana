import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * More than one aggregation per grouping rule
 * (docs/design/2026-11-02-series-grouping-multi-aggregation.md).
 *
 * A rule picks one of `avg` / `sum` / `max`, so a Kubernetes panel shows one row of the table
 * that tells a scale-out apart from a regression. `extra_aggregations` lets it emit the others
 * beside the primary one, as `<group> (sum)` series.
 *
 * Three things are load-bearing:
 *
 * 1. **The existing `aggregation` column does not move.** The primary aggregation keeps emitting
 *    the bare group name, so this migration is purely additive: `ds_metric_statistics`,
 *    `ds_adapt_results`, `benchmarks` and `ds_compare_config` all key on `metric_name` and
 *    nothing migrates a stored name. A `DEFAULT '{}'` on both tables means every existing row
 *    reads as "no extras" and every existing reader keeps working untouched.
 * 2. **`ds_metric_series_groups` gets the column too.** Its row records what a run's statistics
 *    were actually computed with — the reason `aggregation` is already duplicated onto it — and
 *    `SeriesGroupResolver` reads membership in preference to the live rule, so a chart agrees
 *    with the numbers beside it after the rule changes. The primary key does not move: extras
 *    are a property of the group, so they ride on the existing per-raw-series row as an array.
 * 3. **The column is NULLABLE, and that is load-bearing, not an oversight.** Both tables are
 *    `core` resources in `SUT_RESOURCES` (`sut-resource-graph.ts`), and `sut-import.service.ts`
 *    inserts bundle rows with `json_populate_recordset(null::<table>, …)`, which yields **NULL —
 *    not the column DEFAULT** — for a key the bundle JSON lacks. With `NOT NULL` here, every
 *    bundle exported from a v0.2.97.43 deployment that holds grouping rows fails to import with
 *    23502, and because the whole import is one transaction that kills the entire bundle (the
 *    importer maps only 23505, so the operator sees a generic failure). Reproduced on the dev
 *    database 2026-11-02 against the real `json_populate_recordset` mechanism. This is exactly
 *    the trap `1808000000000-AddBenchmarkApdexMinSamples.ts` documents and avoids on purpose.
 *    Every reader already coalesces (`Array.isArray(...) ? ... : []`, `?? []`, and the membership
 *    INSERT's own `COALESCE(..., '{}')`), so NULL costs nothing downstream.
 * 4. **The lock wait is bounded, like 1819's — and the timeout is reset.** Both tables are
 *    written inside the analytics transaction, which runs for up to
 *    `AGGREGATION_STATEMENT_TIMEOUT_MS` (540 s), and `ALTER TABLE` needs ACCESS EXCLUSIVE.
 *    Postgres' lock queue is FIFO, so an unbounded wait parks this request in front of every
 *    writer that arrives behind it. Same plpgsql retry, because a `lock_timeout` error would
 *    otherwise poison the batch's `transaction: "all"` — and for the same reason the timeout is
 *    reset on both exit paths rather than left to leak into migration 1821.
 *
 * The CHECK's second clause is what stops a rule emitting `afterburner-fe` and
 * `afterburner-fe (avg)` as two copies of one series. Uniqueness WITHIN the array is not
 * expressible in a cheap CHECK and is enforced by the DTO and `normalizeExtraAggregations`
 * instead; a duplicate would produce two identical extra series, not anything unsafe.
 *
 * The `<@` clause is also the NULL-ELEMENT guard, and it is the only one: verified on PG15 that
 * `ARRAY[NULL]::varchar(8)[] <@ ARRAY['avg','sum','max']` is FALSE, while
 * `NOT ('avg' = ANY (ARRAY['sum',NULL]))` is NULL — and a CHECK passes on NULL. Do not weaken or
 * reorder it. A third clause, `array_length(extra_aggregations, 1) IS DISTINCT FROM 0`, was
 * dropped before release: `array_length` of an empty array is NULL, not 0, so the clause was
 * true for every possible value including the DEFAULT. It constrained nothing and would have
 * read as a real rule in `check:schema-constraints` output forever.
 *
 * Idempotent (IF NOT EXISTS / a guarded ADD CONSTRAINT): schema-sql.ts carries the column too,
 * and a greenfield install runs the consolidated schema and then this migration.
 */

const UP_DDL = `
  ALTER TABLE public.series_grouping_rules
    ADD COLUMN IF NOT EXISTS extra_aggregations character varying(8)[] DEFAULT '{}';

  ALTER TABLE public.ds_metric_series_groups
    ADD COLUMN IF NOT EXISTS extra_aggregations character varying(8)[] DEFAULT '{}';

  ALTER TABLE public.series_grouping_rules
    DROP CONSTRAINT IF EXISTS ck_series_grouping_rules_extra_aggregations;
  ALTER TABLE public.series_grouping_rules
    ADD CONSTRAINT ck_series_grouping_rules_extra_aggregations
    CHECK (extra_aggregations <@ ARRAY['avg', 'sum', 'max']::character varying(8)[]
           AND NOT (aggregation = ANY (extra_aggregations)));
`;

const DOWN_DDL = `
  ALTER TABLE public.series_grouping_rules
    DROP CONSTRAINT IF EXISTS ck_series_grouping_rules_extra_aggregations;
  ALTER TABLE public.ds_metric_series_groups DROP COLUMN IF EXISTS extra_aggregations;
  ALTER TABLE public.series_grouping_rules DROP COLUMN IF EXISTS extra_aggregations;
`;

/** Run `ddl` with a 3 s lock_timeout, retried up to 10 times, as 1819 does. */
const withBoundedLockWait = (label: string, ddl: string): string => `
  DO $series_grouping_extras$
  DECLARE
    attempt int := 0;
    -- Captured on entry so both exit paths can put back exactly what was in effect, rather than a
    -- constant. '0' would be WRONG: it means lock_timeout UNLIMITED, not "the configured value", so
    -- on a deployment whose postgresql.conf sets a non-zero lock_timeout it would strip that
    -- protection from the rest of the batch — the opposite of what this block is for. 'DEFAULT'
    -- (migration 1813's form) is closer but resolves to the conf value, so it would also clobber a
    -- SET LOCAL an earlier migration in the same transaction had set for itself. Verified on PG:
    -- with lock_timeout at 7s on entry, this restores 7s where '0' leaves 0.
    prev_lock_timeout text := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    LOOP
      attempt := attempt + 1;
      BEGIN
        ${ddl}
        -- Restore before returning. set_config(..., true) is transaction-local, and the migration
        -- runner uses TypeORM's default transaction: "all" — one transaction for the WHOLE batch
        -- — so a 3s lock_timeout left in place would leak forward to every migration numbered
        -- above this one in the same deploy, where it surfaces as 55P03 instead of a wait and
        -- poisons the batch. 1819 has the same shape and was given the same restore in
        -- v0.2.97.44 — without it, a combined 1819+1820 install had THIS block capture 1819's
        -- leaked 3s on entry and faithfully restore it, so the leak outlived the fix. Editing a
        -- shipped migration is safe here precisely because the leak is transaction-scoped: a
        -- database that already ran 1819 ended that transaction long ago and needs nothing.
        PERFORM set_config('lock_timeout', prev_lock_timeout, true);
        RETURN;
      EXCEPTION WHEN lock_not_available THEN
        IF attempt >= 10 THEN
          PERFORM set_config('lock_timeout', prev_lock_timeout, true);
          RAISE EXCEPTION
            'could not ${label}: the series grouping tables stayed locked across % attempts. Find the long-running transaction (pg_stat_activity, often an analytics aggregation) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $series_grouping_extras$;
`;

export class AddSeriesGroupingExtraAggregations1820000000000 implements MigrationInterface {
  name = 'AddSeriesGroupingExtraAggregations1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('add the extra_aggregations columns', UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop the extra_aggregations columns', DOWN_DDL));
  }
}
