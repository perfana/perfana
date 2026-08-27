import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a user park a Dynatrace query without deleting it.
 *
 * Also in the consolidated schema, which only a fresh install runs — this is what an
 * already-deployed database gets. Both collection paths (DynatraceRepository's full
 * fetch and the incremental collector) filter on the column unconditionally, so a
 * database missing it would fail every Dynatrace collection outright.
 *
 * Default true: existing queries keep collecting.
 */
export class AddDynatraceQueryEnabled1798000000000 implements MigrationInterface {
  name = 'AddDynatraceQueryEnabled1798000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "dynatrace_queries" ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "dynatrace_queries"."enabled" IS
        'False parks the query: no collection path executes it and it writes nothing to ds_metrics. The Dynatrace card hosts tab is unaffected - it reads the Dynatrace API live.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "dynatrace_queries" DROP COLUMN IF EXISTS "enabled"`);
  }
}
