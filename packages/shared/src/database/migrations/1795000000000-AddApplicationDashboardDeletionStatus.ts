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
    await queryRunner.query(
      `ALTER TABLE "application_dashboards" ADD COLUMN IF NOT EXISTS "deletion_status" character varying(20) DEFAULT NULL`,
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "application_dashboards"."deletion_status" IS
        'Background-deletion state: NULL when idle, queued before the jobs are enqueued, deleting while a worker holds it, failed once retries are exhausted. Lets the row show a badge instead of vanishing and reappearing.'
    `);

    // The column this one mirrors. It predates the consolidated schema, but a database old
    // enough to be missing one may be missing the other, and the symptom is identical: the
    // test-run list query names a column that is not there and the page comes back empty.
    await queryRunner.query(
      `ALTER TABLE "test_runs" ADD COLUMN IF NOT EXISTS "deletion_status" character varying(20) DEFAULT NULL`,
    );
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
