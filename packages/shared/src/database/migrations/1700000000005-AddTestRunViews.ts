import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add test_run_views table to track which test runs a user has viewed.
 * Used by the dashboard to filter out already-reviewed failures.
 */
export class AddTestRunViews1700000000005 implements MigrationInterface {
  name = 'AddTestRunViews1700000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS test_run_views (
        user_id varchar(255) NOT NULL,
        test_run_id uuid NOT NULL,
        viewed_at timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_test_run_views PRIMARY KEY (user_id, test_run_id),
        CONSTRAINT fk_test_run_views_test_run FOREIGN KEY (test_run_id)
          REFERENCES test_runs(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_test_run_views_user_id ON test_run_views (user_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_test_run_views_test_run_id ON test_run_views (test_run_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS test_run_views`);
  }
}
