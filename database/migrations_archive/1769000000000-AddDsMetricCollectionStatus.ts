import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Migration to add ds_metric_collection_status table for tracking metric collection progress.
 *
 * This table enables the data science module to track metric collection status from various sources:
 * - Grafana instances (dashboards/panels)
 * - Dynatrace queries
 * - Performance test data
 *
 * Key features:
 * - Tracks collected and failed time ranges as JSONB arrays
 * - Supports partial collection with is_complete flag
 * - Unique constraint per (test_run_id, source_type, source_id) combination
 * - Optimized indexes for incomplete status queries
 */
export class AddDsMetricCollectionStatus1769000000000 implements MigrationInterface {
  name = 'AddDsMetricCollectionStatus1769000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the ds_metric_collection_status table
    await queryRunner.createTable(
      new Table({
        name: 'ds_metric_collection_status',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'test_run_id',
            type: 'varchar',
            isNullable: false,
            comment: 'Test run identifier (supports both UUID and custom test_run_id)',
          },
          {
            name: 'source_type',
            type: 'varchar',
            isNullable: false,
            comment: 'Source type: grafana, dynatrace, or performance_test',
          },
          {
            name: 'source_id',
            type: 'varchar',
            isNullable: true,
            comment: 'Optional source identifier (e.g., Grafana/Dynatrace instance ID)',
          },
          {
            name: 'collected_ranges',
            type: 'jsonb',
            default: "'[]'",
            comment: 'Array of successfully collected time ranges as JSON objects with start/end timestamps',
          },
          {
            name: 'failed_ranges',
            type: 'jsonb',
            default: "'[]'",
            comment: 'Array of failed time ranges as JSON objects with start/end timestamps and error details',
          },
          {
            name: 'last_collected_at',
            type: 'timestamp with time zone',
            isNullable: true,
            comment: 'Timestamp of last successful collection attempt',
          },
          {
            name: 'is_complete',
            type: 'boolean',
            default: false,
            comment: 'Indicates if all metrics have been collected for this source',
          },
          {
            name: 'total_data_points',
            type: 'integer',
            default: 0,
            comment: 'Total number of data points collected from this source',
          },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    // Create unique constraint on (test_run_id, source_type, source_id)
    // This ensures only one collection status entry per source per test run
    await queryRunner.createIndex(
      'ds_metric_collection_status',
      new TableIndex({
        name: 'uq_collection_status',
        columnNames: ['test_run_id', 'source_type', 'source_id'],
        isUnique: true,
      }),
    );

    // Create index on test_run_id for lookups
    await queryRunner.createIndex(
      'ds_metric_collection_status',
      new TableIndex({
        name: 'idx_collection_status_test_run',
        columnNames: ['test_run_id'],
      }),
    );

    // Create partial index for incomplete collections
    // This optimizes queries for finding pending collection jobs
    await queryRunner.query(`
      CREATE INDEX idx_collection_status_incomplete
      ON ds_metric_collection_status(test_run_id)
      WHERE is_complete = false
    `);

    // Add column comments for documentation
    await queryRunner.query(`
      COMMENT ON TABLE ds_metric_collection_status IS 'Tracks metric collection progress from various sources (Grafana, Dynatrace, performance tests) for data science analysis'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the table (indexes are dropped automatically)
    await queryRunner.dropTable('ds_metric_collection_status');
  }
}
