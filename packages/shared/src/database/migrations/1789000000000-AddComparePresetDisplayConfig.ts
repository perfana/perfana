import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddComparePresetDisplayConfig1789000000000 implements MigrationInterface {
  name = 'AddComparePresetDisplayConfig1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "compare_filter_presets" ADD COLUMN IF NOT EXISTS "display_config" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "compare_filter_presets" DROP COLUMN IF EXISTS "display_config"`,
    );
  }
}
