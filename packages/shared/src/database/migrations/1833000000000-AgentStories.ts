import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agent stories through the MCP server (design: docs/designs/test-run-analysis-stories.md,
 * "Agent stories are proposals, and a human publishes them", PR6b).
 *
 * - `test_run_stories.published_by_id` / `published_by_name`: who last published the story. Set
 *   by the API on every publish and kept on unpublish, like `published_at`. For an agent's story
 *   this is the person who reviewed it, so it reads "Proposed by <agent> · reviewed and published
 *   by <user>". Existing rows stay NULL (a user's own story needs no second name).
 * - `rls_test_run_stories_select`: an AGENT's draft (`author_kind = 'agent'`) is visible to
 *   everyone who can see the run, since its author is a key and nobody could review it otherwise.
 *   A user's draft stays visible to its author only, exactly as 1830 wrote it.
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, every statement safe to repeat. The
 * two columns are nullable with no default (metadata-only); replacing a policy takes ACCESS
 * EXCLUSIVE on `test_run_stories`, so the wait is bounded the 1829-1831 way.
 */

const SELECT_1830 = `(public.can_access_resource(organization_id, team_id, (author_id)::text) AND (status = ''published'' OR author_id = public.current_user_id()))`;
const SELECT_1833 = `(public.can_access_resource(organization_id, team_id, (author_id)::text) AND (status = ''published'' OR author_kind = ''agent'' OR author_id = public.current_user_id()))`;

const UP_DDL = `
  ALTER TABLE public.test_run_stories ADD COLUMN IF NOT EXISTS published_by_id character varying(255);
  ALTER TABLE public.test_run_stories ADD COLUMN IF NOT EXISTS published_by_name character varying(255);
  DROP POLICY IF EXISTS rls_test_run_stories_select ON public.test_run_stories;
  CREATE POLICY rls_test_run_stories_select ON public.test_run_stories FOR SELECT USING ${SELECT_1833}
`;

const DOWN_DDL = `
  DROP POLICY IF EXISTS rls_test_run_stories_select ON public.test_run_stories;
  CREATE POLICY rls_test_run_stories_select ON public.test_run_stories FOR SELECT USING ${SELECT_1830};
  ALTER TABLE public.test_run_stories DROP COLUMN IF EXISTS published_by_name;
  ALTER TABLE public.test_run_stories DROP COLUMN IF EXISTS published_by_id
`;

/** Each statement is run with EXECUTE, so quotes inside `ddl` are already doubled. */
const withBoundedLockWait = (ddl: string): string => `
  DO $agent_stories$
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
            'could not alter test_run_stories for agent stories: the table stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $agent_stories$;
`;

export class AgentStories1833000000000 implements MigrationInterface {
  name = 'AgentStories1833000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait(UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait(DOWN_DDL));
  }
}
