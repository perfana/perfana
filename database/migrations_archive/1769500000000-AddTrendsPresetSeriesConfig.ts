import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrendsPresetSeriesConfig1769500000000 implements MigrationInterface {
  name = 'AddTrendsPresetSeriesConfig1769500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add series_config column to trends_filter_presets table
    await queryRunner.query(`
      ALTER TABLE "trends_filter_presets"
      ADD COLUMN IF NOT EXISTS "series_config" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove series_config column
    await queryRunner.query(`
      ALTER TABLE "trends_filter_presets"
      DROP COLUMN IF EXISTS "series_config"
    `);
  }
}
