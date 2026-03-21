import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSparseMetricExclusions1700000000008 implements MigrationInterface {
  name = 'AddSparseMetricExclusions1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sparse_metric_exclusions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        system_under_test_id UUID NOT NULL REFERENCES systems_under_test(id) ON DELETE CASCADE,
        test_environment VARCHAR(255) NOT NULL,
        workload VARCHAR(255) NOT NULL,
        dashboard_label VARCHAR(255) NOT NULL,
        metric_name VARCHAR(255) NOT NULL,
        reason TEXT,
        organization_id UUID,
        team_id UUID,
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_sparse_metric_exclusion UNIQUE (system_under_test_id, test_environment, workload, dashboard_label, metric_name)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_sparse_metric_exclusions_scope
        ON sparse_metric_exclusions (system_under_test_id, test_environment, workload)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sparse_metric_exclusions`);
  }
}
