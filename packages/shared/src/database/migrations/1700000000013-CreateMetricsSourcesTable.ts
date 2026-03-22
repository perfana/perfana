import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 step 1: Create the metrics_sources table.
 *
 * MetricsSource is the universal adapter that replaces the "artificial
 * Grafana dashboard" pattern. This migration creates the table so that
 * downstream entities can reference it via metrics_source_id.
 */
export class CreateMetricsSourcesTable1700000000013 implements MigrationInterface {
  name = 'CreateMetricsSourcesTable1700000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "metrics_sources" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "system_under_test_id" uuid NOT NULL,
        "test_environment" varchar(255) NOT NULL,
        "workload" varchar(255),
        "source_type" varchar(50) NOT NULL,
        "source_config_id" uuid,
        "external_ref" varchar(255),
        "display_name" varchar(255) NOT NULL,
        "display_label" varchar(255),
        "tags" text[],
        "metadata" jsonb,
        "organization_id" uuid,
        "team_id" uuid,
        "created_by" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_metrics_sources" PRIMARY KEY ("id"),
        CONSTRAINT "uq_metrics_sources_unique"
          UNIQUE ("system_under_test_id", "test_environment", "source_type", "external_ref", "display_name"),
        CONSTRAINT "fk_metrics_sources_sut"
          FOREIGN KEY ("system_under_test_id") REFERENCES "systems_under_test" ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_metrics_sources_sut_env" ON "metrics_sources" ("system_under_test_id", "test_environment")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_metrics_sources_sut" ON "metrics_sources" ("system_under_test_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_metrics_sources_source_type" ON "metrics_sources" ("source_type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_metrics_sources_source_config" ON "metrics_sources" ("source_config_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "metrics_sources"`);
  }
}
