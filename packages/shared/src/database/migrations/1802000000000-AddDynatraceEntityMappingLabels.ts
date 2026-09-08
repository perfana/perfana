import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Free-form role labels on a Dynatrace entity mapping ("appserver", "database", …).
 * Presentation only — nothing filters metrics on them.
 *
 * Also in the consolidated schema, which only a fresh install runs — this is what an
 * already-deployed database gets. Every existing mapping gets `{}` from the default,
 * so no backfill is needed and NOT NULL is safe.
 */
export class AddDynatraceEntityMappingLabels1802000000000 implements MigrationInterface {
  name = 'AddDynatraceEntityMappingLabels1802000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "dynatrace_entity_mappings" ADD COLUMN IF NOT EXISTS "labels" text[] NOT NULL DEFAULT '{}'::text[]`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "dynatrace_entity_mappings" DROP COLUMN IF EXISTS "labels"`,
    );
  }
}
