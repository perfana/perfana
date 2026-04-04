import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScalingSessions1700000000025 implements MigrationInterface {
  name = 'CreateScalingSessions1700000000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scaling_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "description" text,
        "system_under_test_id" uuid NOT NULL,
        "test_environment" varchar(255) NOT NULL,
        "workload" varchar(255) NOT NULL,
        "baseline_test_run_id" varchar(255),
        "target_load" varchar(255),
        "status" varchar(50) NOT NULL DEFAULT 'active',
        "organization_id" uuid,
        "team_id" uuid,
        "created_by" varchar(255),
        "updated_by" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_scaling_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "fk_scaling_sessions_system_under_test"
          FOREIGN KEY ("system_under_test_id") REFERENCES "systems_under_test" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_scaling_sessions_system_env_workload" ON "scaling_sessions" ("system_under_test_id", "test_environment", "workload")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_scaling_sessions_organization_id" ON "scaling_sessions" ("organization_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_scaling_sessions_status" ON "scaling_sessions" ("status")`);

    // Add scaling_session_id to test_runs
    await queryRunner.query(`ALTER TABLE "test_runs" ADD COLUMN IF NOT EXISTS "scaling_session_id" uuid`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_test_runs_scaling_session_id" ON "test_runs" ("scaling_session_id")`);
    await queryRunner.query(`
      ALTER TABLE "test_runs"
      ADD CONSTRAINT "fk_test_runs_scaling_session"
      FOREIGN KEY ("scaling_session_id") REFERENCES "scaling_sessions" ("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "test_runs" DROP CONSTRAINT IF EXISTS "fk_test_runs_scaling_session"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_test_runs_scaling_session_id"`);
    await queryRunner.query(`ALTER TABLE "test_runs" DROP COLUMN IF EXISTS "scaling_session_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "scaling_sessions"`);
  }
}
