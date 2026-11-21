import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Analysis stories (design: docs/designs/test-run-analysis-stories.md, "Stories", PR4).
 *
 * - `test_run_stories` hangs off `test_runs.id` (the uuid) with ON DELETE CASCADE, like
 *   `test_run_comments`. A story is a title, an optional conclusion (`summary`) and a status;
 *   drafts are private to their author (enforced in the service, and again in the SELECT policy).
 *   `published_at` is set on the first publish and kept on unpublish.
 * - `author_kind` ('user' | 'agent') ships now so no story ever exists without it. PR4's API always
 *   writes 'user' and never reads it from a request; agent stories (MCP) are PR6.
 * - `test_run_story_steps` is the ordered list of ROOT comments a story walks. PK
 *   `(story_id, comment_id)`: a comment appears at most once per story. `position` is 1-based and
 *   dense, unique per story. `comment_id` is ON DELETE NO ACTION, a backstop: the service never
 *   hard-deletes a comment that is a step (it soft-deletes it instead). It is DEFERRABLE INITIALLY
 *   DEFERRED, and that is load-bearing: a run delete cascades to comments and to stories, but each
 *   cascade is its own statement inside the RI trigger, and the comments cascade fires first (its
 *   FK is older), so an immediate NO ACTION check ran while the steps still existed and refused
 *   every run delete with 23503. Measured against Postgres, not reasoned; checked at commit, by
 *   which time the stories cascade has removed the steps. `(comment_id)`
 *   is indexed because a parent-side FK check is a scan per child without it (root CLAUDE.md #57);
 *   `story_id` is covered by the primary key.
 * - Steps carry `organization_id` (copied from the story) for RLS.
 * - RLS: as `test_run_comments` (1827), plus a SELECT predicate that hides another user's draft.
 *   Steps are visible across the organization, because the comment delete rule must see every
 *   story a comment is a step of, drafts included. Grants come from the consolidated schema's
 *   ALTER DEFAULT PRIVILEGES, as for 1827.
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, every statement safe to repeat, and
 * the lock waits on `test_runs` and `test_run_comments` (each FK takes SHARE ROW EXCLUSIVE on its
 * parent) bounded, with the previous `lock_timeout` restored on both exit paths.
 */
const UP_DDL = `
  CREATE TABLE IF NOT EXISTS public.test_run_stories (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    test_run_id uuid NOT NULL REFERENCES public.test_runs(id) ON DELETE CASCADE,
    title character varying(200) NOT NULL,
    summary text,
    status character varying(16) NOT NULL DEFAULT 'draft',
    author_id character varying(255) NOT NULL,
    author_name character varying(255) NOT NULL,
    author_kind character varying(16) NOT NULL DEFAULT 'user',
    published_at timestamp with time zone,
    organization_id uuid NOT NULL,
    team_id uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ck_test_run_stories_title CHECK (char_length(title) >= 1),
    CONSTRAINT ck_test_run_stories_summary CHECK (summary IS NULL OR char_length(summary) <= 10000),
    CONSTRAINT ck_test_run_stories_status CHECK (status IN ('draft', 'published')),
    CONSTRAINT ck_test_run_stories_author_kind CHECK (author_kind IN ('user', 'agent'))
  );
  CREATE INDEX IF NOT EXISTS idx_test_run_stories_run_created
    ON public.test_run_stories (test_run_id, created_at);

  CREATE TABLE IF NOT EXISTS public.test_run_story_steps (
    story_id uuid NOT NULL REFERENCES public.test_run_stories(id) ON DELETE CASCADE,
    comment_id uuid NOT NULL REFERENCES public.test_run_comments(id) ON DELETE NO ACTION
      DEFERRABLE INITIALLY DEFERRED,
    position integer NOT NULL,
    note text,
    organization_id uuid NOT NULL,
    CONSTRAINT pk_test_run_story_steps PRIMARY KEY (story_id, comment_id),
    CONSTRAINT uq_test_run_story_steps_position UNIQUE (story_id, position),
    CONSTRAINT ck_test_run_story_steps_position CHECK (position >= 1),
    CONSTRAINT ck_test_run_story_steps_note CHECK (note IS NULL OR char_length(note) <= 2000)
  );
  CREATE INDEX IF NOT EXISTS idx_test_run_story_steps_comment
    ON public.test_run_story_steps (comment_id);

  ALTER TABLE public.test_run_stories ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.test_run_stories FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_test_run_stories_select ON public.test_run_stories;
  CREATE POLICY rls_test_run_stories_select ON public.test_run_stories FOR SELECT
    USING (public.can_access_resource(organization_id, team_id, (author_id)::text)
      AND (status = 'published' OR author_id = public.current_user_id()));
  DROP POLICY IF EXISTS rls_test_run_stories_insert ON public.test_run_stories;
  CREATE POLICY rls_test_run_stories_insert ON public.test_run_stories FOR INSERT
    WITH CHECK (public.can_access_resource(organization_id, team_id, NULL::text));
  DROP POLICY IF EXISTS rls_test_run_stories_update ON public.test_run_stories;
  CREATE POLICY rls_test_run_stories_update ON public.test_run_stories FOR UPDATE
    USING (public.can_access_resource(organization_id, team_id, NULL::text));
  DROP POLICY IF EXISTS rls_test_run_stories_delete ON public.test_run_stories;
  CREATE POLICY rls_test_run_stories_delete ON public.test_run_stories FOR DELETE
    USING (public.can_access_resource(organization_id, team_id, NULL::text));

  ALTER TABLE public.test_run_story_steps ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.test_run_story_steps FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_test_run_story_steps_all ON public.test_run_story_steps;
  CREATE POLICY rls_test_run_story_steps_all ON public.test_run_story_steps FOR ALL
    USING (public.can_access_resource(organization_id, NULL::uuid, NULL::text))
    WITH CHECK (public.can_access_resource(organization_id, NULL::uuid, NULL::text));
`;

const DOWN_DDL = `
  DROP TABLE IF EXISTS public.test_run_story_steps;
  DROP TABLE IF EXISTS public.test_run_stories;
`;

const withBoundedLockWait = (label: string, ddl: string): string => `
  DO $analysis_stories$
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
            'could not ${label}: test_runs or test_run_comments stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $analysis_stories$;
`;

export class AnalysisStories1830000000000 implements MigrationInterface {
  name = 'AnalysisStories1830000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('add analysis stories', UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop analysis stories', DOWN_DDL));
  }
}
