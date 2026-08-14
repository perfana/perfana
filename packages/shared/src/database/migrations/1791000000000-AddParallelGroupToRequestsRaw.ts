import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddParallelGroupToRequestsRaw1791000000000 implements MigrationInterface {
  name = 'AddParallelGroupToRequestsRaw1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Names the Parallel Controller a request ran under, so concurrent requests can be told
    // apart from sequential ones. NULL for sequential requests and for every run recorded
    // before the load test tool started reporting it.
    await queryRunner.query(
      `ALTER TABLE "requests_raw" ADD COLUMN IF NOT EXISTS "parallel_group" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "requests_raw" DROP COLUMN IF EXISTS "parallel_group"`,
    );
  }
}
