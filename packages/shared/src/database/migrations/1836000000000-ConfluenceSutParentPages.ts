import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-system Confluence parent pages (docs/reference/Features/Confluence Publishing.md).
 *
 * `systems_under_test.confluence_parent_pages` maps a Confluence connection id to a page path
 * ("Performance / MyApp"), resolved under that connection's parent page on publish. A jsonb map on
 * the system rather than a table: it is edited with the system, deleted with it, and a key naming a
 * connection that no longer exists (or one from another environment after a SUT import) is ignored.
 *
 * **Numbered above 1791** (root CLAUDE.md #64): no SAVEPOINT, safe to repeat, and the ACCESS
 * EXCLUSIVE wait on `systems_under_test` bounded with the previous `lock_timeout` restored on both
 * exit paths. A constant default makes the ADD COLUMN catalog-only; nothing is rewritten.
 */
const withBoundedLockWait = (label: string, body: string): string => `
  DO $confluence_sut$
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
            'could not ${label}: systems_under_test stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $confluence_sut$;
`;

export class ConfluenceSutParentPages1836000000000 implements MigrationInterface {
  name = 'ConfluenceSutParentPages1836000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('add confluence_parent_pages',
      `ALTER TABLE public.systems_under_test ADD COLUMN IF NOT EXISTS confluence_parent_pages jsonb NOT NULL DEFAULT '{}'::jsonb;`));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(withBoundedLockWait('drop confluence_parent_pages',
      'ALTER TABLE public.systems_under_test DROP COLUMN IF EXISTS confluence_parent_pages;'));
  }
}
