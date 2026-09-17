import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An Apdex SLO failed on a transaction with 2 observations. `apdex_min_samples` is the
 * fewest samples a transaction needs before its score can fail the SLO; below it the
 * transaction is reported with `below_min_samples: true` and not evaluated.
 *
 * Nullable on purpose: `benchmarks` travels in SUT-transfer bundles, and the import's
 * `json_populate_recordset` yields NULL (not the DEFAULT) for a key an older bundle lacks.
 * Every reader falls back to 50 (`COALESCE` in BenchmarkMatcher, `?? 50` in the mapper).
 */
export class AddBenchmarkApdexMinSamples1808000000000 implements MigrationInterface {
  name = 'AddBenchmarkApdexMinSamples1808000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE public.benchmarks ADD COLUMN IF NOT EXISTS apdex_min_samples integer DEFAULT 50 CHECK (apdex_min_samples IS NULL OR apdex_min_samples >= 1)'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE public.benchmarks DROP COLUMN IF EXISTS apdex_min_samples');
  }
}
