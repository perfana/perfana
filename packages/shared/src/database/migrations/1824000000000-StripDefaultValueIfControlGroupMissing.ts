import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the `defaultValueIfControlGroupMissing: 0` that three writers stored on every compare
 * config by default, so that ADAPT, which reads the key from v0.2.97.66, treats those rows as "off".
 *
 * Until v0.2.97.66 nothing read the key. The anomaly card saved `|| 0`, the golden-path applier's
 * `INSERT_BASE` carried `0`, and the perf-test pipeline seeded `0` on every panel. Now that ADAPT
 * judges a series with no baseline row against the configured value, a stored 0 would turn every
 * new series on those panels from `incomparable` into a verdict against zero: a new transaction's
 * response time would read as a regression of infinite percent. None of those 0s was a choice
 * (the anomaly card had no field for it), so all of them go. A value other than 0 was written
 * through the API on purpose and is kept, and so is a template that names the key: the applier
 * puts a template's 0 back on the next completed run, which is that template's explicit choice.
 *
 * The key goes from `config_data` and from `template_base` (migration 1822). `template_base` has to
 * match the new `INSERT_BASE` exactly, or the applier stops recognising the rows it inserted and no
 * longer deletes them when their template goes.
 *
 * `trigger_mark_stale_on_config_update` is held off for the statement: removing a key ADAPT never
 * read changes no verdict, so no result is stale.
 *
 * **Numbered above 1791**, whose `COMMIT` ends the batch transaction on a fresh install (root
 * CLAUDE.md #64): no SAVEPOINT, and no reliance on the batch to undo a half-done step. The disable,
 * both updates and the enable are one plpgsql block, so an error undoes all four. Same lock
 * discipline as 1822/1823: `ALTER TABLE … DISABLE TRIGGER` needs SHARE ROW EXCLUSIVE, which queues
 * behind a running ADAPT transaction, so the wait is bounded at 3 s and retried ten times, and the
 * previous `lock_timeout` is restored on both exit paths. Safe to repeat: a second run finds no 0s.
 */
export class StripDefaultValueIfControlGroupMissing1824000000000 implements MigrationInterface {
  name = 'StripDefaultValueIfControlGroupMissing1824000000000';

  static readonly SQL = `
  DO $strip$
  DECLARE
    attempt int := 0;
    prev_lock_timeout text := current_setting('lock_timeout');
    stripped_config int;
    stripped_base int;
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    LOOP
      attempt := attempt + 1;
      BEGIN
        ALTER TABLE public.ds_compare_config DISABLE TRIGGER trigger_mark_stale_on_config_update;
        UPDATE public.ds_compare_config
           SET config_data = config_data - 'defaultValueIfControlGroupMissing'
         WHERE jsonb_typeof(config_data) = 'object'
           AND config_data->'defaultValueIfControlGroupMissing' = '0'::jsonb;
        GET DIAGNOSTICS stripped_config = ROW_COUNT;
        UPDATE public.ds_compare_config
           SET template_base = template_base - 'defaultValueIfControlGroupMissing'
         WHERE jsonb_typeof(template_base) = 'object'
           AND template_base->'defaultValueIfControlGroupMissing' = '0'::jsonb;
        GET DIAGNOSTICS stripped_base = ROW_COUNT;
        ALTER TABLE public.ds_compare_config ENABLE TRIGGER trigger_mark_stale_on_config_update;
        PERFORM set_config('lock_timeout', prev_lock_timeout, true);
        RAISE NOTICE 'defaultValueIfControlGroupMissing: 0 removed from % config_data and % template_base value(s)',
          stripped_config, stripped_base;
        RETURN;
      EXCEPTION WHEN lock_not_available THEN
        IF attempt >= 10 THEN
          PERFORM set_config('lock_timeout', prev_lock_timeout, true);
          RAISE EXCEPTION
            'could not strip defaultValueIfControlGroupMissing: ds_compare_config stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $strip$;
`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(StripDefaultValueIfControlGroupMissing1824000000000.SQL);
  }

  /**
   * Nothing to restore. Putting the 0 back would switch the default ON for every row under the
   * v0.2.97.66 worker, and an older worker never read the key, so an absent key is right for both.
   */
  public async down(): Promise<void> {}
}
