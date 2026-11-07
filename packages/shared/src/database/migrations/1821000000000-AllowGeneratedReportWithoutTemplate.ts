import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a generated report outlive the template it was made from.
 *
 * `generated_reports.template_id` was NOT NULL with `FK ... ON DELETE SET NULL`, two rules that
 * cannot both hold. Deleting any template with a report pointing straight at it made the FK action
 * violate the column, so the delete failed with 23502 and the API answered 500. Reports generated
 * in the UI never hit it, because they point at a hidden ad-hoc copy of the template; a report from
 * `POST /reports/generate`, which is the CI path, points at the template itself, so one CI report
 * made a template undeletable for good.
 *
 * Dropping NOT NULL is the rule the FK and the code already assume: RLS and the organization filters
 * on this table go through `test_runs`, every reader uses `report.template?.`, and a stored report
 * needs no template to be read, downloaded or shared. Only regenerating one does, and
 * `POST /reports/:id/retry` refuses that with a 400.
 *
 * Dropping NOT NULL needs no table scan, but it does need ACCESS EXCLUSIVE, so the lock discipline
 * is 1818's: a plpgsql retry with a short `lock_timeout`, since nothing orders a migration behind a
 * running API and an unbounded wait would queue every later query on this table behind it.
 */
const alterWithRetry = (statement: string): string => `
  DO $alter$
  DECLARE
    attempt int := 0;
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    LOOP
      attempt := attempt + 1;
      BEGIN
        EXECUTE '${statement}';
        RETURN;
      EXCEPTION WHEN lock_not_available THEN
        IF attempt >= 10 THEN
          RAISE EXCEPTION
            'could not alter generated_reports.template_id: the table stayed locked across % attempts. Find the long-running transaction (pg_stat_activity) and retry the deploy.', attempt;
        END IF;
        PERFORM pg_sleep(3);
      END;
    END LOOP;
  END
  $alter$;
`;

export class AllowGeneratedReportWithoutTemplate1821000000000 implements MigrationInterface {
  name = 'AllowGeneratedReportWithoutTemplate1821000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      alterWithRetry('ALTER TABLE generated_reports ALTER COLUMN template_id DROP NOT NULL'),
    );
  }

  /**
   * Fails on a database holding a report whose template was deleted, and that is deliberate:
   * nothing can be put back in that column, and deleting a user's report is not a rollback's call.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      alterWithRetry('ALTER TABLE generated_reports ALTER COLUMN template_id SET NOT NULL'),
    );
  }
}
