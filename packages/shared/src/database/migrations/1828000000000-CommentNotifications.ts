import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Comment notifications (design: docs/designs/test-run-comments.md, PR3).
 *
 * - `notification_channels.notify_on_comment`: opt-in per channel, off for every existing one.
 * - `test_run_comments.notified_at`: the per-comment claim the API's notification sweep sets
 *   before posting. Existing comments are stamped announced, so the first sweep after this
 *   deploy does not post a backlog of old discussion.
 * - `test_run_comments.notify_after`: set when a batch is released after a transient delivery
 *   failure; the sweep skips the comment until then, so a dead webhook cannot keep its run at
 *   the front of the oldest-first queue.
 * - Partial index serving the sweep's "unannounced, not deleted" scan.
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, every statement safe to repeat.
 * Both tables are small and neither ADD COLUMN rewrites the table.
 */
export class CommentNotifications1828000000000 implements MigrationInterface {
  name = 'CommentNotifications1828000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.notification_channels
        ADD COLUMN IF NOT EXISTS notify_on_comment boolean NOT NULL DEFAULT false;
    `);
    // ponytail: the stamp is gated on the column being new, so a re-run never re-announces nothing
    // and never re-stamps comments a sweep has released for retry.
    await queryRunner.query(`
      DO $comment_notifications$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'test_run_comments'
            AND column_name = 'notified_at'
        ) THEN
          ALTER TABLE public.test_run_comments ADD COLUMN notified_at timestamp with time zone;
          UPDATE public.test_run_comments SET notified_at = now();
        END IF;
      END
      $comment_notifications$;
    `);
    await queryRunner.query(`
      ALTER TABLE public.test_run_comments ADD COLUMN IF NOT EXISTS notify_after timestamp with time zone;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_test_run_comments_unnotified
        ON public.test_run_comments (test_run_id)
        WHERE notified_at IS NULL AND deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS public.idx_test_run_comments_unnotified;
      ALTER TABLE public.test_run_comments DROP COLUMN IF EXISTS notify_after;
      ALTER TABLE public.test_run_comments DROP COLUMN IF EXISTS notified_at;
      ALTER TABLE public.notification_channels DROP COLUMN IF EXISTS notify_on_comment;
    `);
  }
}
