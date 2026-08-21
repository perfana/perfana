import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `application_dashboards.deletion_status` to an existing database.
 *
 * The column shipped in v0.2.68.7 with the background-deletion badge, and landed in
 * `1700000000000-ConsolidatedSchema.ts` only — the schema a FRESH database is built from. No
 * incremental migration carried it to a database that already existed, so every deployment that
 * was not created from that schema kept a table without the column.
 *
 * The entity declares it, and TypeORM names every declared column in its SELECT. So on the first
 * request after upgrading, the dashboard list query asks for `ad.deletion_status`, Postgres
 * answers "column does not exist", and the endpoint fails. `useDashboardManagement.ts` catches
 * any failure with `setDashboards([])`, so the UI shows an empty list and no error: the SUT
 * configuration view lists no dashboards for any system, and the compare card offers none,
 * while all the rows sit untouched in the table.
 *
 * Reported as "deploying the last version deleted all application dashboards" (2026-08-21).
 *
 * Additive, nullable, no default backfill — Postgres records it as metadata, with no table
 * rewrite and no lock worth the name, whatever the table's size.
 */
export class AddApplicationDashboardDeletionStatus1795000000000 implements MigrationInterface {
  name = 'AddApplicationDashboardDeletionStatus1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ADD COLUMN needs ACCESS EXCLUSIVE for an instant, but the database default is to wait for
    // it forever. This runs while the worker and grafana-sync are live and holding transactions
    // on test_runs, so an unbounded wait would hang start-up and queue every later query behind
    // it. Short timeout, retried: once granted, the lock is held for microseconds, so a retry
    // almost always lands.
    //
    // The retry lives in plpgsql rather than TypeScript because TypeORM runs a migration inside
    // ONE transaction: a lock_timeout error there poisons it, and every following statement —
    // including the sleep between attempts — dies with "current transaction is aborted". A
    // plpgsql EXCEPTION block sets an implicit savepoint, so it can actually recover and retry.
    const addColumn = async (table: string) => {
      await queryRunner.query(`
        DO $add_column$
        DECLARE
          attempt int := 0;
        BEGIN
          PERFORM set_config('lock_timeout', '3s', true);
          LOOP
            attempt := attempt + 1;
            BEGIN
              EXECUTE 'ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS deletion_status character varying(20) DEFAULT NULL';
              RETURN;
            EXCEPTION WHEN lock_not_available THEN
              IF attempt >= 10 THEN
                -- Ten attempts over ~30s means something holds this table open indefinitely.
                -- Fail loudly: a failed migration is one restart away, a hung one takes the
                -- database's throughput with it.
                RAISE EXCEPTION
                  'could not add ${table}.deletion_status: the table stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
              END IF;
              PERFORM pg_sleep(3);
            END;
          END LOOP;
        END
        $add_column$;
      `);
    };

    await addColumn('application_dashboards');
    await queryRunner.query(`
      COMMENT ON COLUMN "application_dashboards"."deletion_status" IS
        'Background-deletion state: NULL when idle, queued before the jobs are enqueued, deleting while a worker holds it, failed once retries are exhausted. Lets the row show a badge instead of vanishing and reappearing.'
    `);

    // The column this one mirrors. It predates the consolidated schema, but a database old
    // enough to be missing one may be missing the other, and the symptom is identical: the
    // test-run list query names a column that is not there and the page comes back empty.
    await addColumn('test_runs');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only the column this migration is named for. test_runs.deletion_status is not dropped:
    // this migration may not be what created it, and dropping a column another release depends
    // on would reproduce the outage in the other direction.
    await queryRunner.query(
      `ALTER TABLE "application_dashboards" DROP COLUMN IF EXISTS "deletion_status"`,
    );
  }
}
