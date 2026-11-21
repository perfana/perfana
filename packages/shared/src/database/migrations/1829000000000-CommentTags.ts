import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Comment tags (design: docs/designs/test-run-analysis-stories.md, "Tags", PR2).
 *
 * - `test_run_comments.tag`: one optional tag per ROOT comment from a fixed vocabulary.
 * - `ck_test_run_comments_tag`: the vocabulary. Kept equal to `COMMENT_TAGS`
 *   (`packages/shared/src/constants/comment-cards.ts`) by `__tests__/1829-comment-tags.spec.ts`;
 *   a new tag needs a new migration that replaces this constraint.
 * - `ck_test_run_comments_tag_root`: roots only. A reply discusses its root; tagging it would
 *   make a thread mean two things.
 *
 * A soft-deleted comment keeps its tag (the delete rule wipes `body` and `chart_context` only),
 * so neither CHECK mentions `deleted_at`.
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, every statement safe to repeat.
 * Adding a CHECK takes ACCESS EXCLUSIVE on `test_run_comments` and scans it (small: one row per
 * comment), so the wait is bounded the 1821 way, with the previous `lock_timeout` restored on
 * both exit paths.
 */
export const COMMENT_TAG_CHECK_VALUES = ['symptom', 'hypothesis', 'evidence', 'ruled-out', 'root-cause', 'action'] as const;

const UP_DDL = `
  ALTER TABLE public.test_run_comments ADD COLUMN IF NOT EXISTS tag character varying(32);
  ALTER TABLE public.test_run_comments DROP CONSTRAINT IF EXISTS ck_test_run_comments_tag;
  ALTER TABLE public.test_run_comments ADD CONSTRAINT ck_test_run_comments_tag CHECK (
    tag IS NULL OR tag IN (${COMMENT_TAG_CHECK_VALUES.map((t) => `''${t}''`).join(', ')})
  );
  ALTER TABLE public.test_run_comments DROP CONSTRAINT IF EXISTS ck_test_run_comments_tag_root;
  ALTER TABLE public.test_run_comments ADD CONSTRAINT ck_test_run_comments_tag_root CHECK (
    tag IS NULL OR parent_id IS NULL
  );
`;

const DOWN_DDL = `
  ALTER TABLE public.test_run_comments DROP CONSTRAINT IF EXISTS ck_test_run_comments_tag_root;
  ALTER TABLE public.test_run_comments DROP CONSTRAINT IF EXISTS ck_test_run_comments_tag;
  ALTER TABLE public.test_run_comments DROP COLUMN IF EXISTS tag;
`;

/** Each statement is run with EXECUTE, so quotes inside `ddl` are already doubled. */
const withBoundedLockWait = (ddl: string): string => `
  DO $comment_tags$
  DECLARE
    attempt int := 0;
    prev_lock_timeout text := current_setting('lock_timeout');
    stmt text;
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    LOOP
      attempt := attempt + 1;
      BEGIN
        FOREACH stmt IN ARRAY ARRAY[${ddl
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => `'${s}'`)
          .join(',\n          ')}]
        LOOP
          EXECUTE stmt;
        END LOOP;
        PERFORM set_config('lock_timeout', prev_lock_timeout, true);
        RETURN;
      EXCEPTION WHEN lock_not_available THEN
        IF attempt >= 10 THEN
          PERFORM set_config('lock_timeout', prev_lock_timeout, true);
          RAISE EXCEPTION
            'could not alter test_run_comments.tag: the table stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $comment_tags$;
`;

export class CommentTags1829000000000 implements MigrationInterface {
  name = 'CommentTags1829000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait(UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait(DOWN_DDL));
  }
}
