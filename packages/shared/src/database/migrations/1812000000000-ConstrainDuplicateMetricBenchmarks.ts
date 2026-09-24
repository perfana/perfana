import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The dedupe key, written once. The `UPDATE`'s `PARTITION BY` and the unique index's column
 * list have to agree exactly: if they ever drift, the UPDATE dedupes on one key while the
 * index enforces another, and `CREATE UNIQUE INDEX` then fails *after* the UPDATE has already
 * disabled rows. Sharing the string makes that impossible.
 *
 * The match-pattern COALESCE mirrors `withColumnMatchPattern` in
 * `apps/worker/src/pipelines/checks/BenchmarkMatcher.ts`, which prefers
 * `configuration->>'matchPattern'` and falls back to the `match_pattern` column. Keying on
 * either source alone would let two rows that evaluate the same series read as different.
 */
const TARGET_KEY_SQL = `
  system_under_test_id,
  test_environment,
  workload,
  application_dashboard_id,
  (configuration->>'id'),
  COALESCE(NULLIF(configuration->>'matchPattern', ''), NULLIF(match_pattern, ''), ''),
  COALESCE(configuration->>'invertMatchPattern', 'false'),
  average_all,
  COALESCE(evaluate_type, '')`;

/**
 * The rows this mechanism applies to. Mirrors `BenchmarkMatcher`'s own
 * `valid = true AND enabled = true` filter, narrowed to the metric benchmarks that carry a
 * dashboard — apdex and aggregated SLOs have a NULL `application_dashboard_id` and the UI
 * keys their results on `benchmark_id`, so they cannot collide.
 *
 * `configuration ? 'id'` is load-bearing and must stay in BOTH readers. `configuration->>'id'`
 * is NULL when the key is absent, and a btree unique never collides NULLs — the very
 * `generic_check_id` trap this migration exists to close — while `PARTITION BY` *does* group
 * them. Without this clause the dedupe would disable rows the index would then have accepted:
 * destructive over-reach with no compensating benefit. Restricting both halves to rows that
 * actually carry a panel id makes the NULL semantics moot instead of merely consistent.
 *
 * The predicate is deliberately WIDER than `BenchmarkMatcher`'s in one respect: the matcher
 * also requires `requirement_operator IS NOT NULL OR requirement_value IS NOT NULL`. A metric
 * benchmark with neither is never evaluated, so it occupies an index slot for nothing. It is
 * unreachable through the API (`CreateBenchmarkDto.requirementOperator` is required) and only
 * a hand-written or imported row can be in that state, so the extra strictness is left in.
 */
const TARGET_SCOPE_SQL = `valid AND enabled
        AND COALESCE(benchmark_type, 'metric') = 'metric'
        AND application_dashboard_id IS NOT NULL
        AND configuration ? 'id'`;

export const UQ_BENCHMARKS_ACTIVE_METRIC_TARGET = `
CREATE UNIQUE INDEX IF NOT EXISTS uq_benchmarks_active_metric_target
ON public.benchmarks (${TARGET_KEY_SQL}
)
WHERE ${TARGET_SCOPE_SQL}`;

/**
 * Two SLOs on the same panel, evaluating the same series the same way, produce two
 * `check_results` rows that are identical in everything the run view keys on
 * (application_dashboard_id, panel_id, metric_name) — so the SLO list rendered them with the
 * same React key, dropped the duplicate on the first re-render, and neither row could be
 * expanded.
 *
 * `uq_benchmarks_unique` did not stop the pair: its last column is `generic_check_id`, which
 * is NULL for every UI-created SLO, and NULLs never collide in a btree unique. So the
 * constraint is inert for exactly the SLO type the Add-SLO dialog and the Duplicate button
 * create.
 *
 * **This index is defence in depth, not the fix for that symptom.** The rendering bug is
 * fixed independently in the same change by putting `benchmark_id` into the row key
 * (`apps/web/.../service-level-objectives/utils/slo-formatters.ts`), so duplicates already
 * render and expand correctly. What the index adds is preventing the redundant pair from
 * being created in the first place — two SLOs that evaluate the same series the same way are
 * indistinguishable to a reader whatever the key does.
 *
 * That is why `up()` is **non-destructive**. It disables the redundant rows so the index can
 * build, and touches nothing else. In particular it does NOT delete their `check_results`:
 * those are per-run history, `test_runs.consolidated_result` is a stored verdict derived from
 * them, and nothing here recomputes it — deleting the rows would leave a finished run whose
 * header says FAILED with every SLO row green and no evidence left to explain it. A duplicate
 * check-result row is now renderable anyway.
 *
 * Deliberately NOT in the key: `requirement_operator` / `requirement_value` and
 * `exclude_ramp_up_time`. Two SLOs differing only in those still collapse to a single
 * check-result key, which is the bug — the stricter one simply hides the other.
 *
 * `WHERE valid AND enabled` is what makes the Duplicate button still work: `duplicate()`
 * clones an SLO disabled, so the clone sits outside the index until it has been edited into a
 * variant and switched on.
 */
export class ConstrainDuplicateMetricBenchmarks1812000000000 implements MigrationInterface {
  name = 'ConstrainDuplicateMetricBenchmarks1812000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Disable (never delete) every redundant row but the oldest of each group. Disabling is
    // recoverable: the Enabled checkbox in the edit dialog switches one back on, and the
    // description marker below says which rows this was.
    //
    // The writable CTE is wrapped in an outer SELECT on purpose. TypeORM's
    // PostgresQueryRunner returns `[raw.rows, raw.rowCount]` when the top-level command is
    // UPDATE or DELETE, so a bare `UPDATE ... RETURNING` hands back a 2-element array whose
    // `.map(r => r.id)` is `[undefined, undefined]`.
    const disabled: { id: string; config_title: string | null }[] = await queryRunner.query(`
      WITH ranked AS (
        SELECT id,
               row_number() OVER (
                 PARTITION BY ${TARGET_KEY_SQL}
                 ORDER BY created_at, id
               ) AS rn
        FROM public.benchmarks
        WHERE ${TARGET_SCOPE_SQL}
      ),
      upd AS (
        UPDATE public.benchmarks b
        SET enabled = false,
            description = COALESCE(NULLIF(b.description, ''), '') ||
                          CASE WHEN COALESCE(b.description, '') = '' THEN '' ELSE ' — ' END ||
                          'Disabled by migration 1812: duplicate of an identical SLO on the same panel',
            updated_at = now()
        FROM ranked r
        WHERE b.id = r.id AND r.rn > 1
        RETURNING b.id, b.config_title
      )
      SELECT id, config_title FROM upd
    `);

    const rows = (Array.isArray(disabled) ? disabled : []).filter(
      (row): row is { id: string; config_title: string | null } => typeof row?.id === 'string',
    );

    if (rows.length > 0) {
      console.log(
        `1812: disabled ${rows.length} duplicate SLO(s); their check results are kept. ` +
          rows.map((r) => `${r.id} (${r.config_title ?? 'untitled'})`).join(', '),
      );
    }

    // `benchmarks` is FORCE ROW LEVEL SECURITY, and the migration runner sets none of the
    // `app.current_user_*` GUCs that `can_modify_resource` reads. A login that owns the table
    // without being superuser or BYPASSRLS therefore updates zero rows here and then fails
    // the index build below on rows it could not see — an opaque 23505 that blocks the deploy.
    // Fail with the cause named instead. Every supported deploy runs migrations as a
    // superuser, so this should never fire.
    const [remaining]: [{ groups: string }] = await queryRunner.query(`
      SELECT count(*)::text AS groups FROM (
        SELECT 1 FROM public.benchmarks
        WHERE ${TARGET_SCOPE_SQL}
        GROUP BY ${TARGET_KEY_SQL}
        HAVING count(*) > 1
      ) dup
    `);
    if (Number(remaining?.groups ?? 0) > 0) {
      throw new Error(
        `1812: ${remaining.groups} duplicate benchmark group(s) still present after the dedupe, ` +
          'so uq_benchmarks_active_metric_target cannot be built. The usual cause is a migration ' +
          'role that owns public.benchmarks without superuser/BYPASSRLS, which silently reads and ' +
          'updates zero rows under FORCE ROW LEVEL SECURITY.',
      );
    }

    await queryRunner.query(UQ_BENCHMARKS_ACTIVE_METRIC_TARGET);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Honest rollback: up() only dropped the index and flipped `enabled`, so both are undone.
    // The marker written into `description` is what identifies the rows to restore.
    await queryRunner.query('DROP INDEX IF EXISTS public.uq_benchmarks_active_metric_target');
    await queryRunner.query(`
      UPDATE public.benchmarks
      SET enabled = true,
          description = NULLIF(
            regexp_replace(
              description,
              '( — )?Disabled by migration 1812: duplicate of an identical SLO on the same panel$',
              ''
            ), ''),
          updated_at = now()
      WHERE NOT enabled
        AND description LIKE '%Disabled by migration 1812: duplicate of an identical SLO on the same panel'
    `);
  }
}
