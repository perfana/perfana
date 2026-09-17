import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `ds_panels` had no index on `test_run_id`. Every incremental Grafana tick
 * (`grafana-collector.ts`, per instance), every `getDsPanelsByTestRun` and the
 * `DELETE` in `PanelsPipeline` were a sequential scan of the whole table.
 *
 * Plain (non-CONCURRENT) CREATE INDEX on purpose: the table is small (~9 k rows on
 * dev) and CONCURRENTLY cannot run inside the migration transaction.
 */
export class AddDsPanelsTestRunIndex1807000000000 implements MigrationInterface {
  name = 'AddDsPanelsTestRunIndex1807000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_ds_panels_test_run_dashboard ON ds_panels (test_run_id, application_dashboard_id)'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_ds_panels_test_run_dashboard');
  }
}
