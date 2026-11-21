import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Story publish notifications (design: docs/designs/test-run-analysis-stories.md, "Notifications", PR5).
 *
 * - `test_run_stories.notified_at`: the claim the API's comment notification sweep sets before it
 *   announces a published story. It is never cleared by an unpublish, so a republish does not
 *   announce again. Stories that already exist are stamped announced (only when the column is
 *   new), so the first sweep after this deploy posts no backlog of old analyses.
 * - `test_run_stories.notify_after`: the retry backoff set when a claim is released after a
 *   transient delivery failure, as on `test_run_comments` (1828), so a dead webhook cannot keep
 *   one story at the front of the sweep's queue.
 * - Partial index serving the sweep's "published, not yet announced" scan.
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, every statement safe to repeat, and
 * the ACCESS EXCLUSIVE lock the ADD COLUMNs take on `test_run_stories` is waited for in bounded
 * attempts, with the previous `lock_timeout` restored on both exit paths. Neither ADD COLUMN
 * rewrites the table.
 */
const UP_DDL = `
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'test_run_stories' AND column_name = 'notified_at'
  ) THEN
    ALTER TABLE public.test_run_stories ADD COLUMN notified_at timestamp with time zone;
    UPDATE public.test_run_stories SET notified_at = now();
  END IF;
  ALTER TABLE public.test_run_stories ADD COLUMN IF NOT EXISTS notify_after timestamp with time zone;
  CREATE INDEX IF NOT EXISTS idx_test_run_stories_unnotified
    ON public.test_run_stories (published_at)
    WHERE status = 'published' AND notified_at IS NULL;
`;

const DOWN_DDL = `
  DROP INDEX IF EXISTS public.idx_test_run_stories_unnotified;
  ALTER TABLE public.test_run_stories DROP COLUMN IF EXISTS notify_after;
  ALTER TABLE public.test_run_stories DROP COLUMN IF EXISTS notified_at;
`;

const withBoundedLockWait = (label: string, ddl: string): string => `
  DO $story_notifications$
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
            'could not ${label}: test_run_stories stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $story_notifications$;
`;

export class StoryNotifications1832000000000 implements MigrationInterface {
  name = 'StoryNotifications1832000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('add story notification columns', UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop story notification columns', DOWN_DDL));
  }
}
