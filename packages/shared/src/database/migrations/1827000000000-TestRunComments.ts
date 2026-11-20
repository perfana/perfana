import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Test-run comments and per-card read marks (design: docs/designs/test-run-comments.md, PR1).
 *
 * - `test_run_comments` hangs off `test_runs.id` (the uuid, not the human `test_run_id`) with
 *   ON DELETE CASCADE, so a run's discussion goes with it. Replies point at their root through
 *   `parent_id` (also CASCADE); the service checks a reply's parent is a root on the same run
 *   and card. `(parent_id)` is indexed because a parent-side FK check is a scan per child
 *   without it (root CLAUDE.md #57).
 * - The body CHECK encodes the delete rule: a live comment has 1..10000 characters, a
 *   soft-deleted one has exactly ''.
 * - Marker columns (`marker_seq`, `marker_time`, `chart_context`) are created now so the
 *   schema is decided once; PR2 writes them. `marker_seq` is unique per run and never reused,
 *   because a marker root is only ever soft-deleted.
 * - A root may be anchored to one item of its card (`item_key`, with `item_label` as the text the
 *   anchor showed when written): an SLO row, an anomaly metric, a transaction. Keys are built by
 *   the web card from fields stable within the run (an anomaly key carries a metric name of up
 *   to 255 characters plus its dashboard and panel, hence 1024); replies inherit the root's anchor.
 * - `test_run_comment_reads` is keyed (user, run, card). A missing row means unread.
 * - RLS: any member who can see the run's organization can read and write comments (the
 *   service enforces author-only edit and author/org-admin delete); a read row is visible only
 *   to its own user.
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, every statement safe to repeat,
 * and the lock wait on `test_runs` (the FK takes a SHARE ROW EXCLUSIVE lock) bounded with the
 * previous `lock_timeout` restored on both exit paths.
 */
const UP_DDL = `
  CREATE TABLE IF NOT EXISTS public.test_run_comments (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    test_run_id uuid NOT NULL REFERENCES public.test_runs(id) ON DELETE CASCADE,
    card_key character varying(64) NOT NULL,
    parent_id uuid REFERENCES public.test_run_comments(id) ON DELETE CASCADE,
    body text NOT NULL,
    author_id character varying(255) NOT NULL,
    author_name character varying(255) NOT NULL,
    marker_seq integer,
    marker_time timestamp with time zone,
    chart_context jsonb,
    organization_id uuid NOT NULL,
    team_id uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_test_run_comments_body CHECK (
      (deleted_at IS NULL AND length(body) BETWEEN 1 AND 10000)
      OR (deleted_at IS NOT NULL AND body = '')
    ),
    CONSTRAINT ck_test_run_comments_marker CHECK ((marker_seq IS NULL) = (marker_time IS NULL)),
    CONSTRAINT ck_test_run_comments_marker_root CHECK (marker_seq IS NULL OR parent_id IS NULL)
  );

  ALTER TABLE public.test_run_comments ADD COLUMN IF NOT EXISTS item_key character varying(1024);
  ALTER TABLE public.test_run_comments ADD COLUMN IF NOT EXISTS item_label character varying(255);
  ALTER TABLE public.test_run_comments DROP CONSTRAINT IF EXISTS ck_test_run_comments_item;
  ALTER TABLE public.test_run_comments ADD CONSTRAINT ck_test_run_comments_item CHECK (
    (item_key IS NULL) = (item_label IS NULL) AND (item_key IS NULL OR parent_id IS NULL)
  );

  CREATE INDEX IF NOT EXISTS idx_test_run_comments_run_created
    ON public.test_run_comments (test_run_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_test_run_comments_parent
    ON public.test_run_comments (parent_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_test_run_comments_marker_seq
    ON public.test_run_comments (test_run_id, marker_seq) WHERE marker_seq IS NOT NULL;

  ALTER TABLE public.test_run_comments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.test_run_comments FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_test_run_comments_select ON public.test_run_comments;
  CREATE POLICY rls_test_run_comments_select ON public.test_run_comments FOR SELECT
    USING (public.can_access_resource(organization_id, team_id, (author_id)::text));
  DROP POLICY IF EXISTS rls_test_run_comments_insert ON public.test_run_comments;
  CREATE POLICY rls_test_run_comments_insert ON public.test_run_comments FOR INSERT
    WITH CHECK (public.can_access_resource(organization_id, team_id, NULL::text));
  DROP POLICY IF EXISTS rls_test_run_comments_update ON public.test_run_comments;
  CREATE POLICY rls_test_run_comments_update ON public.test_run_comments FOR UPDATE
    USING (public.can_access_resource(organization_id, team_id, NULL::text));
  DROP POLICY IF EXISTS rls_test_run_comments_delete ON public.test_run_comments;
  CREATE POLICY rls_test_run_comments_delete ON public.test_run_comments FOR DELETE
    USING (public.can_access_resource(organization_id, team_id, NULL::text));

  CREATE TABLE IF NOT EXISTS public.test_run_comment_reads (
    user_id character varying(255) NOT NULL,
    test_run_id uuid NOT NULL REFERENCES public.test_runs(id) ON DELETE CASCADE,
    card_key character varying(64) NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    organization_id uuid NOT NULL,
    CONSTRAINT pk_test_run_comment_reads PRIMARY KEY (user_id, test_run_id, card_key)
  );
  CREATE INDEX IF NOT EXISTS idx_test_run_comment_reads_run
    ON public.test_run_comment_reads (test_run_id);

  ALTER TABLE public.test_run_comment_reads ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.test_run_comment_reads FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS rls_test_run_comment_reads_own ON public.test_run_comment_reads;
  CREATE POLICY rls_test_run_comment_reads_own ON public.test_run_comment_reads FOR ALL
    USING (public.is_global_admin() OR (user_id = public.current_user_id()
      AND public.can_access_resource(organization_id, NULL::uuid, NULL::text)))
    WITH CHECK (user_id = public.current_user_id()
      AND public.can_access_resource(organization_id, NULL::uuid, NULL::text));
`;

const DOWN_DDL = `
  DROP TABLE IF EXISTS public.test_run_comment_reads;
  DROP TABLE IF EXISTS public.test_run_comments;
`;

const withBoundedLockWait = (label: string, ddl: string): string => `
  DO $test_run_comments$
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
            'could not ${label}: test_runs stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $test_run_comments$;
`;

export class TestRunComments1827000000000 implements MigrationInterface {
  name = 'TestRunComments1827000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('add test-run comments', UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop test-run comments', DOWN_DDL));
  }
}
