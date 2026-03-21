import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameMetricClassificationToProvisionedTemplate1700000000009 implements MigrationInterface {
  name = 'RenameMetricClassificationToProvisionedTemplate1700000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ds_metric_classification
        RENAME TO provisioned_template_ds_compare_configs
    `);

    await queryRunner.query(`
      ALTER TABLE provisioned_template_ds_compare_configs
        ADD COLUMN IF NOT EXISTS config_overrides JSONB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE provisioned_template_ds_compare_configs
        DROP COLUMN IF EXISTS config_overrides
    `);

    await queryRunner.query(`
      ALTER TABLE provisioned_template_ds_compare_configs
        RENAME TO ds_metric_classification
    `);
  }
}
