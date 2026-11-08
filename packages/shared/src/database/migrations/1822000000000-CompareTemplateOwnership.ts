import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The identity of a compare-config template, written once. The duplicate pre-check below and the
 * unique index both read it, so they cannot disagree about which rows collide. The same five terms
 * are computed in TypeScript by `templateKey()` in
 * `apps/api/src/modules/provisioning/compare-template-codec.ts`; its spec reads this constant to
 * keep the two in step.
 *
 * The panel title is part of the identity only when there is no panel id: beside a panel id it is a
 * descriptive attribute that can be edited without changing which template the row is.
 */
export const COMPARE_TEMPLATE_KEY_SQL = `
  COALESCE(organization_id::text, 'install'),
  COALESCE(dashboard_uid, ''),
  regex,
  COALESCE(panel_id::text, 'title:' || panel_title),
  COALESCE(metric_name, '')`;

/**
 * Template rows only. `classifyMetric` (`POST /test-runs/:id/classify-metric`) writes rows with a
 * `system_under_test_id` into the same table; they are not templates and stay outside every path
 * that reads this key. Retiring that endpoint is filed in TODOS.md.
 */
const TEMPLATE_SCOPE_SQL = 'system_under_test_id IS NULL';

export const UQ_COMPARE_TEMPLATE_KEY = `
CREATE UNIQUE INDEX IF NOT EXISTS uq_provisioned_template_ds_compare_configs_key
ON public.provisioned_template_ds_compare_configs (${COMPARE_TEMPLATE_KEY_SQL}
)
WHERE ${TEMPLATE_SCOPE_SQL}`;

/**
 * DDL that needs a table lock runs under 1819's discipline: a short `lock_timeout` and a bounded
 * retry. `ds_compare_config` is read by the worker's ADAPT transactions for up to minutes, and an
 * ACCESS EXCLUSIVE request that waits queues every later reader behind it (the lock queue is FIFO),
 * so an unbounded wait stalls analysis for the whole deployment while the migration sits there.
 *
 * The previous `lock_timeout` is restored on both exit paths: `set_config(..., true)` lasts until
 * the transaction ends, and on an existing deploy that is the whole batch (`transaction: "all"`),
 * so a 3s left in place would make every later migration in the deploy fail with 55P03 instead of
 * waiting. Dollar-quoted so the statement may carry its own string literals.
 */
const withLockRetry = (what: string, statement: string): string => `
  DO $ddl$
  DECLARE
    attempt int := 0;
    prev_lock_timeout text := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    LOOP
      attempt := attempt + 1;
      BEGIN
        EXECUTE $stmt$${statement}$stmt$;
        PERFORM set_config('lock_timeout', prev_lock_timeout, true);
        RETURN;
      EXCEPTION WHEN lock_not_available THEN
        IF attempt >= 10 THEN
          PERFORM set_config('lock_timeout', prev_lock_timeout, true);
          RAISE EXCEPTION
            'could not ${what}: the table stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $ddl$;
`;

/**
 * Lets a compare-config template keep the rows it seeded in step with it.
 *
 * Before this, `applyGoldenPathClassifications` wrote a template's fields into a `ds_compare_config`
 * row once and never looked at it again, so editing the template in git changed nothing for any
 * workload it had already reached. Two columns on `ds_compare_config` make a re-merge possible:
 *
 * - `template_base`: the row's configuration before any template applied. A template-owned row is
 *   rebuilt from it plus the fields the current winning template names, so a field the template
 *   stops naming reverts instead of sticking.
 * - `template_id`: which template last applied, for display only. A plain uuid with **no foreign
 *   key**: it never gates ownership, a deleted template simply reads as "template removed", and the
 *   SUT export carries it as ordinary data without dragging live templates along.
 *
 * Both sit outside `config_data`, so writing them never fires `trigger_mark_stale_on_config_update`.
 *
 * On the template table:
 *
 * - `read_only` marks the rows the provisioning file owns. Backfilled for every row provisioning
 *   created, so the first boot after upgrade prunes provisioned templates no longer in the file.
 *   Nullable with a default, not NOT NULL: the table travels in SUT bundles (the classify-metric
 *   rows), and the importer's `json_populate_recordset` yields NULL, not the default, for a key an
 *   older bundle lacks, which would fail the whole import. Every reader treats NULL as false.
 * - The unique index makes `COMPARE_TEMPLATE_KEY_SQL` an actual identity. Before it, two concurrent
 *   boots, or the old upsert's narrower lookup, could leave two rows for one key.
 * - The CHECK closes the one key the index cannot see: with no panel id and no panel title the
 *   panel term is NULL, and NULLs never collide in a btree unique.
 * - `config_overrides.higherIsBetter` gives the direction presence semantics: a template that names
 *   it (explicit null included) forces it, one that does not leaves the row's own value alone.
 *   Backfilled from the column, so every template that set a direction keeps setting it.
 *
 * **Numbered above 1791**, whose `COMMIT` ends the batch transaction for everything after it on a
 * fresh install. So this migration does not rely on a rollback: the pre-check runs first and touches
 * nothing, and every later statement is safe to repeat, so a run that failed partway is fixed by
 * correcting the data and deploying again.
 */
export class CompareTemplateOwnership1822000000000 implements MigrationInterface {
  name = 'CompareTemplateOwnership1822000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // FIRST, before any DDL: refuse to start on data the index or the CHECK would reject, naming the
    // rows. Failing in the middle instead would leave the columns added and the index missing.
    //
    // The writable-CTE trap from 1812 does not apply (this is a plain SELECT), but the shape of the
    // result is still checked rather than trusted.
    const problems: { kind: string; ids: string[] }[] = await queryRunner.query(`
      SELECT 'duplicate key' AS kind, array_agg(id::text ORDER BY created_at, id) AS ids
        FROM public.provisioned_template_ds_compare_configs
       WHERE ${TEMPLATE_SCOPE_SQL}
       GROUP BY ${COMPARE_TEMPLATE_KEY_SQL}
      HAVING count(*) > 1
      UNION ALL
      SELECT 'no panel id and no panel title' AS kind, array_agg(id::text ORDER BY id) AS ids
        FROM public.provisioned_template_ds_compare_configs
       WHERE ${TEMPLATE_SCOPE_SQL} AND panel_id IS NULL AND panel_title IS NULL
      HAVING count(*) > 0
    `);
    const found = (Array.isArray(problems) ? problems : []).filter((p) => Array.isArray(p?.ids));
    if (found.length > 0) {
      throw new Error(
        '1822: provisioned_template_ds_compare_configs holds template rows the new key cannot accept. ' +
          found.map((p) => `${p.kind}: ${p.ids.join(', ')}`).join('; ') +
          '. For each duplicate group delete all but one row (the first id listed is the oldest); ' +
          'give each panel-less row a panel_id or panel_title, or delete it. Then deploy again — ' +
          'this migration is safe to re-run.',
      );
    }

    await queryRunner.query(
      withLockRetry(
        'add read_only to provisioned_template_ds_compare_configs',
        'ALTER TABLE public.provisioned_template_ds_compare_configs ADD COLUMN IF NOT EXISTS read_only boolean DEFAULT false',
      ),
    );

    // The rows the provisioning file created. Repeatable: a second run finds them already true.
    await queryRunner.query(`
      UPDATE public.provisioned_template_ds_compare_configs
         SET read_only = true
       WHERE created_by = 'system:provisioning' AND ${TEMPLATE_SCOPE_SQL} AND read_only IS NOT TRUE
    `);

    // A NULL column on a legacy row reads as "not named", which is what the YAML meant by omitting it.
    await queryRunner.query(`
      UPDATE public.provisioned_template_ds_compare_configs
         SET config_overrides = COALESCE(config_overrides, '{}'::jsonb)
                                || jsonb_build_object('higherIsBetter', higher_is_better)
       WHERE higher_is_better IS NOT NULL
         AND ${TEMPLATE_SCOPE_SQL}
         AND NOT (COALESCE(config_overrides, '{}'::jsonb) ? 'higherIsBetter')
    `);

    await queryRunner.query(
      withLockRetry(
        'add ck_provisioned_template_ds_compare_configs_panel',
        `DO $ck$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_constraint
                           WHERE conname = 'ck_provisioned_template_ds_compare_configs_panel') THEN
             ALTER TABLE public.provisioned_template_ds_compare_configs
               ADD CONSTRAINT ck_provisioned_template_ds_compare_configs_panel
               CHECK (system_under_test_id IS NOT NULL OR panel_id IS NOT NULL OR panel_title IS NOT NULL);
           END IF;
         END $ck$`,
      ),
    );

    // A template table is tens to hundreds of rows, so the build itself is instant; the retry is
    // for the SHARE lock, which waits behind a boot-time provisioning write.
    await queryRunner.query(withLockRetry('build uq_provisioned_template_ds_compare_configs_key', UQ_COMPARE_TEMPLATE_KEY));

    await queryRunner.query(
      withLockRetry(
        'add template_id to ds_compare_config',
        'ALTER TABLE public.ds_compare_config ADD COLUMN IF NOT EXISTS template_id uuid NULL',
      ),
    );
    await queryRunner.query(
      withLockRetry(
        'add template_base to ds_compare_config',
        'ALTER TABLE public.ds_compare_config ADD COLUMN IF NOT EXISTS template_base jsonb NULL',
      ),
    );
  }

  /**
   * Drops what `up()` added. The `higherIsBetter` key it backfilled into `config_overrides` is left
   * in place: it repeats the column's value, the old reader ignores it, and stripping it would also
   * strip keys a newer provisioning run wrote on purpose.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      withLockRetry('drop template_base', 'ALTER TABLE public.ds_compare_config DROP COLUMN IF EXISTS template_base'),
    );
    await queryRunner.query(
      withLockRetry('drop template_id', 'ALTER TABLE public.ds_compare_config DROP COLUMN IF EXISTS template_id'),
    );
    await queryRunner.query(
      withLockRetry(
        'drop uq_provisioned_template_ds_compare_configs_key',
        'DROP INDEX IF EXISTS public.uq_provisioned_template_ds_compare_configs_key',
      ),
    );
    await queryRunner.query(
      withLockRetry(
        'drop ck_provisioned_template_ds_compare_configs_panel',
        'ALTER TABLE public.provisioned_template_ds_compare_configs DROP CONSTRAINT IF EXISTS ck_provisioned_template_ds_compare_configs_panel',
      ),
    );
    await queryRunner.query(
      withLockRetry(
        'drop read_only',
        'ALTER TABLE public.provisioned_template_ds_compare_configs DROP COLUMN IF EXISTS read_only',
      ),
    );
  }
}
