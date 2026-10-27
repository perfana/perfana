import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `systems_under_test.deletion_status`, so SUT deletion can move off the HTTP request and
 * onto a queue — the third part of the 2026-10-23 production failure (see
 * 1816000000000-IndexFkProbeColumns for the first two).
 *
 * The cascade ran inline in `DELETE /api/systems-under-test/:id` and was bounded only by
 * node-postgres' client-side `query_timeout` (300 s, `packages/shared/src/config/typeorm.config.ts`).
 * When that fires the client destroys the connection while Postgres keeps executing the
 * statement, so the user gets a 500 after five minutes, nothing is deleted, and the database is
 * still working on a transaction nobody is waiting for. 1816 and 1817 make the cascade fast
 * enough for the SUT that failed; they do not make it bounded. A system with hundreds of test
 * runs issues five hypertable DELETEs per run plus the rest of the phases, and that is a long
 * transaction whatever the indexes say.
 *
 * Same column, same four states and the same reason as `application_dashboards.deletion_status`
 * (1795) and `test_runs.deletion_status`: NULL when idle, `queued` from the moment the request
 * returns, `deleting` while a worker holds it, `failed` once retries are exhausted. The row
 * stays in the list wearing a badge rather than vanishing and reappearing.
 *
 * Additive, nullable, no default backfill — Postgres records it as metadata, with no table
 * rewrite. The lock discipline is 1795's and it is the part that matters: ADD COLUMN needs
 * ACCESS EXCLUSIVE for an instant, and the database default is to wait for it forever, which
 * would hang start-up behind a live worker transaction and queue every later query behind the
 * wait. The retry lives in plpgsql because TypeORM runs the batch in ONE transaction, where a
 * `lock_timeout` error poisons everything after it — including the sleep between attempts.
 */
export class AddSystemUnderTestDeletionStatus1818000000000 implements MigrationInterface {
  name = 'AddSystemUnderTestDeletionStatus1818000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $add_column$
      DECLARE
        attempt int := 0;
      BEGIN
        PERFORM set_config('lock_timeout', '3s', true);
        LOOP
          attempt := attempt + 1;
          BEGIN
            EXECUTE 'ALTER TABLE systems_under_test ADD COLUMN IF NOT EXISTS deletion_status character varying(20) DEFAULT NULL';
            RETURN;
          EXCEPTION WHEN lock_not_available THEN
            IF attempt >= 10 THEN
              RAISE EXCEPTION
                'could not add systems_under_test.deletion_status: the table stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
            END IF;
            PERFORM pg_sleep(3);
          END;
        END LOOP;
      END
      $add_column$;
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "systems_under_test"."deletion_status" IS
        'Background-deletion state: NULL when idle, queued before the job is enqueued, deleting while a worker holds it, failed once retries are exhausted. Lets the row show a badge instead of vanishing and reappearing.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "systems_under_test" DROP COLUMN IF EXISTS "deletion_status"`,
    );
  }
}
