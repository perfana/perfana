import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to add Apdex SLO support to benchmarks table.
 *
 * Apdex (Application Performance Index) measures user satisfaction based on response times:
 * - Satisfied: response_time <= T (threshold)
 * - Tolerating: T < response_time <= 4T
 * - Frustrated: response_time > 4T
 *
 * Apdex Score = (Satisfied + Tolerating * 0.5) / Total
 */
export class AddApdexBenchmarkFields1767000000000 implements MigrationInterface {
  name = 'AddApdexBenchmarkFields1767000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add benchmark_type column to distinguish between metric and Apdex SLOs
    await queryRunner.query(`
      ALTER TABLE benchmarks
      ADD COLUMN IF NOT EXISTS benchmark_type VARCHAR(20) DEFAULT 'metric' NOT NULL
    `);

    // Add transaction_name for transaction-specific Apdex SLOs
    // NULL means workload-level Apdex (aggregate across all transactions)
    await queryRunner.query(`
      ALTER TABLE benchmarks
      ADD COLUMN IF NOT EXISTS transaction_name VARCHAR(255)
    `);

    // Add apdex_threshold_ms (T value in milliseconds)
    await queryRunner.query(`
      ALTER TABLE benchmarks
      ADD COLUMN IF NOT EXISTS apdex_threshold_ms INTEGER
    `);

    // Add min_apdex_score (minimum required Apdex score, 0.000 - 1.000)
    await queryRunner.query(`
      ALTER TABLE benchmarks
      ADD COLUMN IF NOT EXISTS min_apdex_score DECIMAL(4,3)
    `);

    // Add include_failed_requests flag
    await queryRunner.query(`
      ALTER TABLE benchmarks
      ADD COLUMN IF NOT EXISTS include_failed_requests BOOLEAN DEFAULT false NOT NULL
    `);

    // Add constraint to ensure Apdex benchmarks have required fields
    await queryRunner.query(`
      ALTER TABLE benchmarks
      ADD CONSTRAINT check_apdex_required_fields
      CHECK (
        benchmark_type = 'metric' OR
        (benchmark_type = 'apdex' AND min_apdex_score IS NOT NULL)
      )
    `);

    // Add constraint for valid benchmark_type values
    await queryRunner.query(`
      ALTER TABLE benchmarks
      ADD CONSTRAINT check_benchmark_type_valid
      CHECK (benchmark_type IN ('metric', 'apdex'))
    `);

    // Add constraint for valid min_apdex_score range
    await queryRunner.query(`
      ALTER TABLE benchmarks
      ADD CONSTRAINT check_min_apdex_score_range
      CHECK (min_apdex_score IS NULL OR (min_apdex_score >= 0 AND min_apdex_score <= 1))
    `);

    // Add constraint for positive apdex_threshold_ms
    await queryRunner.query(`
      ALTER TABLE benchmarks
      ADD CONSTRAINT check_apdex_threshold_positive
      CHECK (apdex_threshold_ms IS NULL OR apdex_threshold_ms > 0)
    `);

    // Create index for Apdex benchmark lookups by transaction
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_benchmarks_apdex_transaction
      ON benchmarks (system_under_test_id, test_environment, workload, transaction_name)
      WHERE benchmark_type = 'apdex'
    `);

    // Create index for filtering by benchmark_type
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_benchmarks_type
      ON benchmarks (benchmark_type)
    `);

    // Add comment for documentation
    await queryRunner.query(`
      COMMENT ON COLUMN benchmarks.benchmark_type IS 'Type of benchmark: metric (Grafana-based) or apdex (transaction response time based)'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN benchmarks.transaction_name IS 'Transaction name for Apdex SLOs. NULL means workload-level aggregate.'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN benchmarks.apdex_threshold_ms IS 'Apdex T threshold in milliseconds. Satisfied: <=T, Tolerating: T<x<=4T, Frustrated: >4T'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN benchmarks.min_apdex_score IS 'Minimum required Apdex score (0.0-1.0). Benchmark passes if calculated >= this value.'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN benchmarks.include_failed_requests IS 'Whether to include failed requests in Apdex calculation (default: false)'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop constraints
    await queryRunner.query(`
      ALTER TABLE benchmarks
      DROP CONSTRAINT IF EXISTS check_apdex_required_fields
    `);

    await queryRunner.query(`
      ALTER TABLE benchmarks
      DROP CONSTRAINT IF EXISTS check_benchmark_type_valid
    `);

    await queryRunner.query(`
      ALTER TABLE benchmarks
      DROP CONSTRAINT IF EXISTS check_min_apdex_score_range
    `);

    await queryRunner.query(`
      ALTER TABLE benchmarks
      DROP CONSTRAINT IF EXISTS check_apdex_threshold_positive
    `);

    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_benchmarks_apdex_transaction
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_benchmarks_type
    `);

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE benchmarks
      DROP COLUMN IF EXISTS include_failed_requests
    `);

    await queryRunner.query(`
      ALTER TABLE benchmarks
      DROP COLUMN IF EXISTS min_apdex_score
    `);

    await queryRunner.query(`
      ALTER TABLE benchmarks
      DROP COLUMN IF EXISTS apdex_threshold_ms
    `);

    await queryRunner.query(`
      ALTER TABLE benchmarks
      DROP COLUMN IF EXISTS transaction_name
    `);

    await queryRunner.query(`
      ALTER TABLE benchmarks
      DROP COLUMN IF EXISTS benchmark_type
    `);
  }
}
