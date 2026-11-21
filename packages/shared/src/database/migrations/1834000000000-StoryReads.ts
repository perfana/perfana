import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Unread state for analysis stories, shown in the UI as "investigations" (design:
 * docs/designs/test-run-analysis-stories.md, "Investigation read state", PR7).
 *
 * - `test_run_story_reads` is keyed (user, story): the caller's last look at one story, written by
 *   `PUT /stories/:id/seen` when the reader opens it. A missing row means "never looked". The FK
 *   cascades from the story, so a deleted story takes its read marks with it. `(story_id)` is
 *   indexed on its own because the primary key leads on `user_id`, and a parent-side FK check is a
 *   scan per child without it (root CLAUDE.md #57).
 * - RLS mirrors `test_run_comment_reads` (1827): a row is visible to, and writable by, its own user
 *   in an organization they can access; a global admin can read them.
 * - `test_run_stories.activity_at`: when the story last changed in a way that makes it unread for
 *   the people who can see it — set by the API on every publish (first or re-), on a steps change
 *   while it is published, and on an AI agent's own writes to its draft. A title or summary edit
 *   by a person does not move it. NOT NULL DEFAULT now(), so a new row needs nothing from the
 *   writer; existing rows are backfilled once, from `published_at` for a published story and
 *   `updated_at` otherwise, only in the run that adds the column.
 *
 * Read state is per user and per environment, so the SUT export never carries this table, as for
 * `test_run_comment_reads`. `activity_at` travels with its story; an older bundle without it
 * imports with the column DEFAULT (root CLAUDE.md #80).
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, every statement safe to repeat, and
 * the lock wait on `test_run_stories` (the FK takes SHARE ROW EXCLUSIVE, the column ACCESS
 * EXCLUSIVE) bounded, with the previous `lock_timeout` restored on both exit paths.
 */
const UP_BODY = `
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'test_run_stories' AND column_name = 'activity_at'
  ) THEN
    ALTER TABLE public.test_run_stories
      ADD COLUMN activity_at timestamp with time zone NOT NULL DEFAULT now();
    UPDATE public.test_run_stories
       SET activity_at = CASE WHEN status = 'published' THEN COALESCE(published_at, updated_at) ELSE updated_at END;
  END IF;

  CREATE TABLE IF NOT EXISTS public.test_run_story_reads (
    user_id character varying(255) NOT NULL,
    story_id uuid NOT NULL REFERENCES public.test_run_stories(id) ON DELETE CASCADE,
    last_seen_at timestamp with time zone NOT NULL,
    organization_id uuid NOT NULL,
    CONSTRAINT pk_test_run_story_reads PRIMARY KEY (user_id, story_id)
  );
  CREATE INDEX IF NOT EXISTS idx_test_run_story_reads_story
    ON public.test_run_story_reads (story_id);

  ALTER TABLE public.test_run_story_reads ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.test_run_story_reads FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_test_run_story_reads_own ON public.test_run_story_reads;
  CREATE POLICY rls_test_run_story_reads_own ON public.test_run_story_reads FOR ALL
    USING (public.is_global_admin() OR (user_id = public.current_user_id()
      AND public.can_access_resource(organization_id, NULL::uuid, NULL::text)))
    WITH CHECK (user_id = public.current_user_id()
      AND public.can_access_resource(organization_id, NULL::uuid, NULL::text));
`;

const DOWN_BODY = `
  DROP TABLE IF EXISTS public.test_run_story_reads;
  ALTER TABLE public.test_run_stories DROP COLUMN IF EXISTS activity_at;
`;

const withBoundedLockWait = (label: string, body: string): string => `
  DO $story_reads$
  DECLARE
    attempt int := 0;
    prev_lock_timeout text := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    LOOP
      attempt := attempt + 1;
      BEGIN
        ${body}
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
  $story_reads$;
`;

export class StoryReads1834000000000 implements MigrationInterface {
  name = 'StoryReads1834000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('add investigation read state', UP_BODY));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop investigation read state', DOWN_BODY));
  }
}
