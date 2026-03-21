import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddComparePresetSeriesConfig1770000000000 implements MigrationInterface {
  name = 'AddComparePresetSeriesConfig1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add series_config column to compare_filter_presets table
    await queryRunner.query(`
      ALTER TABLE "compare_filter_presets"
      ADD COLUMN IF NOT EXISTS "series_config" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove series_config column
    await queryRunner.query(`
      ALTER TABLE "compare_filter_presets"
      DROP COLUMN IF EXISTS "series_config"
    `);
  }
}
