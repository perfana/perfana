import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ensures the four unique constraints required by INSERT … ON CONFLICT upserts in
 * TestRunLookupService are present.
 *
 * AddWorkloadToEvents (1776148518354) dropped these at the start of its up() but only
 * recreated three of them at the end. organizations_name_key was never put back, so any
 * fresh database running through all migrations ends up missing it, causing
 * SQLSTATE 42P10 on the first POST /api/init call.
 *
 * All four checks are idempotent (IF NOT EXISTS) so the migration is safe to run on
 * databases where some or all of the constraints already exist.
 */
export class AddMissingUniqueConstraints1776500000000 implements MigrationInterface {
  name = 'AddMissingUniqueConstraints1776500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // organizations UNIQUE (name) — dropped in AddWorkloadToEvents, never recreated
    const orgConstraint = await queryRunner.query(`
      SELECT 1 FROM pg_constraint
      WHERE conname = 'organizations_name_key'
        AND conrelid = 'organizations'::regclass
    `);
    if (orgConstraint.length === 0) {
      await queryRunner.query(
        `ALTER TABLE "organizations" ADD CONSTRAINT "organizations_name_key" UNIQUE ("name")`,
      );
    }

    // systems_under_test UNIQUE (name, organization_id) — created as a unique index
    const sutIndex = await queryRunner.query(`
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'systems_under_test'
        AND indexname = 'uq_system_under_test_name_org'
    `);
    if (sutIndex.length === 0) {
      await queryRunner.query(
        `CREATE UNIQUE INDEX "uq_system_under_test_name_org" ON "systems_under_test" ("name", "organization_id")`,
      );
    }

    // system_under_test_test_environments UNIQUE (system_under_test_id, name)
    const envConstraint = await queryRunner.query(`
      SELECT 1 FROM pg_constraint
      WHERE conname = 'system_under_test_test_environments_system_under_test_id_name_k'
        AND conrelid = 'system_under_test_test_environments'::regclass
    `);
    if (envConstraint.length === 0) {
      await queryRunner.query(
        `ALTER TABLE "system_under_test_test_environments" ADD CONSTRAINT "system_under_test_test_environments_system_under_test_id_name_k" UNIQUE ("system_under_test_id", "name")`,
      );
    }

    // system_under_test_workloads UNIQUE (system_under_test_test_environment_id, name)
    const workloadConstraint = await queryRunner.query(`
      SELECT 1 FROM pg_constraint
      WHERE conname = 'application_test_types_application_test_environment_id_name_key'
        AND conrelid = 'system_under_test_workloads'::regclass
    `);
    if (workloadConstraint.length === 0) {
      await queryRunner.query(
        `ALTER TABLE "system_under_test_workloads" ADD CONSTRAINT "application_test_types_application_test_environment_id_name_key" UNIQUE ("system_under_test_test_environment_id", "name")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_name_key"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_system_under_test_name_org"`);
    await queryRunner.query(
      `ALTER TABLE "system_under_test_test_environments" DROP CONSTRAINT IF EXISTS "system_under_test_test_environments_system_under_test_id_name_k"`,
    );
    await queryRunner.query(
      `ALTER TABLE "system_under_test_workloads" DROP CONSTRAINT IF EXISTS "application_test_types_application_test_environment_id_name_key"`,
    );
  }
}
