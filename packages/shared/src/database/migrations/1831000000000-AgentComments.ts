import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agent comments through the MCP server (design: docs/designs/test-run-analysis-stories.md,
 * "MCP: an AI agent can comment and build a story", PR6a).
 *
 * - `test_run_comments.author_kind`: `user` or `agent`, set by the API from the principal and
 *   never from the request. An `agent` comment was written by an API key carrying the
 *   `comments:write` role; the UI shows an AI chip beside its author. Existing rows are `user`.
 * - `test_run_comments.client_ref`: an agent's idempotency key. A repeated create with the same
 *   `(test_run_id, author_id, client_ref)` returns the first comment instead of a second one;
 *   `uq_test_run_comments_client_ref` is what makes that hold under a race.
 *
 * Stories gain their own `author_kind` in their own migration; this one touches comments only.
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, every statement safe to repeat.
 * Adding a column with a constant DEFAULT is metadata-only, the CHECK scans the (small) table,
 * and the partial unique index is built on a table of one row per comment. All of it takes
 * ACCESS EXCLUSIVE or SHARE on `test_run_comments`, so the wait is bounded the 1829 way.
 */
export const COMMENT_AUTHOR_KIND_CHECK_VALUES = ['user', 'agent'] as const;

const UP_DDL = `
  ALTER TABLE public.test_run_comments ADD COLUMN IF NOT EXISTS author_kind character varying(16) NOT NULL DEFAULT ''user'';
  ALTER TABLE public.test_run_comments DROP CONSTRAINT IF EXISTS ck_test_run_comments_author_kind;
  ALTER TABLE public.test_run_comments ADD CONSTRAINT ck_test_run_comments_author_kind CHECK (
    author_kind IN (${COMMENT_AUTHOR_KIND_CHECK_VALUES.map((t) => `''${t}''`).join(', ')})
  );
  ALTER TABLE public.test_run_comments ADD COLUMN IF NOT EXISTS client_ref character varying(64);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_test_run_comments_client_ref
    ON public.test_run_comments (test_run_id, author_id, client_ref) WHERE client_ref IS NOT NULL
`;

const DOWN_DDL = `
  DROP INDEX IF EXISTS public.uq_test_run_comments_client_ref;
  ALTER TABLE public.test_run_comments DROP COLUMN IF EXISTS client_ref;
  ALTER TABLE public.test_run_comments DROP CONSTRAINT IF EXISTS ck_test_run_comments_author_kind;
  ALTER TABLE public.test_run_comments DROP COLUMN IF EXISTS author_kind
`;

/** Each statement is run with EXECUTE, so quotes inside `ddl` are already doubled. */
const withBoundedLockWait = (ddl: string): string => `
  DO $agent_comments$
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
            'could not alter test_run_comments for agent comments: the table stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $agent_comments$;
`;

export class AgentComments1831000000000 implements MigrationInterface {
  name = 'AgentComments1831000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait(UP_DDL));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait(DOWN_DDL));
  }
}
