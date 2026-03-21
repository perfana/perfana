import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to add metric_name column to dynatrace_queries table.
 *
 * This enables explicit metric naming for Dynatrace host metrics, allowing:
 * - dashboardLabel: "Dynatrace host metrics" (shared across all hosts)
 * - panelTitle: host name (e.g., "demo-master1")
 * - metric_name: metric type (e.g., "CPU Usage", "Memory Usage")
 *
 * Previously, the metric_name was derived from DQL field names which resulted
 * in generic names like "Value" or "value" instead of descriptive names.
 */
export class AddDynatraceMetricName1768000000000 implements MigrationInterface {
  name = 'AddDynatraceMetricName1768000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add metric_name column to dynatrace_queries
    await queryRunner.query(`
      ALTER TABLE dynatrace_queries
      ADD COLUMN IF NOT EXISTS metric_name VARCHAR(255)
    `);

    // Add comment for documentation
    await queryRunner.query(`
      COMMENT ON COLUMN dynatrace_queries.metric_name IS 'Explicit metric name for storage (e.g., "CPU Usage", "Memory Usage"). Used instead of deriving from DQL field names.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dynatrace_queries
      DROP COLUMN IF EXISTS metric_name
    `);
  }
}
