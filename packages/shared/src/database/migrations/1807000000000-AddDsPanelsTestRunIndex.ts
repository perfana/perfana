import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `ds_panels` had no index on `test_run_id`. Every incremental Grafana tick
 * (`grafana-collector.ts`, per instance), every `getDsPanelsByTestRun` and the
 * `DELETE` in `PanelsPipeline` were a sequential scan of the whole table.
 *
 * Plain (non-CONCURRENT) CREATE INDEX on purpose: CONCURRENTLY cannot run inside the
 * migration transaction. The table holds one row per panel per analysed run with no
 * retention (~225 rows/run; 9 k rows on dev), so on a long-lived deploy it is millions of
 * rows — the build then takes seconds to low tens of seconds, during which it blocks
 * ds_panels WRITERS (PanelsPipeline, DynatracePipeline) but not reads.
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
