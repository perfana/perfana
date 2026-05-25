import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalysisEndOffset1779990000000 implements MigrationInterface {
  name = 'AddAnalysisEndOffset1779990000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE test_runs
      ADD COLUMN IF NOT EXISTS ramp_down INTEGER DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE test_runs DROP COLUMN IF EXISTS ramp_down
    `);
  }
}
