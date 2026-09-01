import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Browser-facing Dynatrace URL, for deploys where the API reaches Dynatrace at a
 * different address than the user's browser does (proxy, split DNS).
 *
 * Also in the consolidated schema, which only a fresh install runs — this is what an
 * already-deployed database gets. Nullable: deep links fall back to `host`, so
 * existing configs keep working untouched.
 */
export class AddDynatraceClientUrl1800000000000 implements MigrationInterface {
  name = 'AddDynatraceClientUrl1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "dynatrace_configs" ADD COLUMN IF NOT EXISTS "client_url" character varying(500)`,
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "dynatrace_configs"."client_url" IS
        'Browser-facing base URL for deep links. NULL means deep links use host; the API normalises a cleared value to NULL.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "dynatrace_configs" DROP COLUMN IF EXISTS "client_url"`);
  }
}
