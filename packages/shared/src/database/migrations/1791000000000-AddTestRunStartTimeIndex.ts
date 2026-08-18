import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index the previous-run baseline lookup.
 *
 * A comparisons section configured with the `previous` baseline resolves, per report, the run
 * immediately before the reported one in the same system, environment and workload — ordered by
 * `start_time`. The nearest existing composite ends in `created_at`, which is ingest order
 * rather than run order, so Postgres could prune on the first three columns but then had to
 * sort every matching run to take a single row. Cost grew with the system's run history.
 *
 * Greenfield deploys get this from the consolidated schema; this migration is for databases
 * that already exist.
 *
 * CONCURRENTLY so the build does not hold a write lock on test_runs, which is a hot table.
 * That forbids running inside a transaction, hence the explicit COMMIT.
 */
export class AddTestRunStartTimeIndex1791000000000 implements MigrationInterface {
  name = 'AddTestRunStartTimeIndex1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`COMMIT`);
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_runs_system_env_workload_start
       ON public.test_runs USING btree (system_under_test_id, test_environment, workload, start_time)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`COMMIT`);
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS idx_test_runs_system_env_workload_start`,
    );
  }
}
