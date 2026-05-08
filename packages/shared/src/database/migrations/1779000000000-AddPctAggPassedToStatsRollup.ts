import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add `pct_agg_passed` (success-filtered tdigest) to the per-test-run stats
 * rollup tables so the Apdex fast path can fire even when failed rows exist
 * (issue #298).
 *
 * Background — the existing `pct_agg` column (added in #150/#151 and consumed
 * by `ApdexCalculator.calculateApdexFromRollup` since #296) is built over
 * every transaction row, success and failure alike. When a benchmark sets
 * `include_failed_requests = false` (the SLO default), the fast path needs a
 * sketch built only over passing rows; subtracting failed-row response_times
 * from a single all-rows sketch is not a tdigest operation. Today the fast
 * path bails out and falls back to the legacy `FROM transactions` scan
 * whenever any rollup row has `failed_count > 0`. On workloads with
 * non-trivial failure rates (soak tests, error-budget validation, chaos
 * runs) that's every row → fast path never fires → ~50× regression in
 * checks-evaluation wall time vs the all-pass shape.
 *
 * The `tdigest(100, response_time) FILTER (WHERE success)` aggregate runs in
 * the same single pass over `transactions` / `requests_raw` that the existing
 * pipeline already does, so populating the new column has no measurable
 * extra cost.
 *
 * NULLABLE on purpose: existing rollup rows from #296 / earlier won't have
 * the new sketch. The Apdex fast path treats `pct_agg_passed IS NULL` on any
 * matching row as a miss and falls back to the legacy scan, identical to the
 * shape #296 used for the original pct_agg rollout. A `StatisticsPipeline`
 * rerun (or any normal completion path that runs `TransactionStatsRollupPipeline`)
 * repopulates without a one-shot backfill.
 *
 * Type: `tdigest` (NOT `uddsketch` / NOT `percentile_agg`). The companion
 * column `pct_agg` on these tables is `tdigest`, and the calculator's
 * `rollup(CASE WHEN ... pct_agg ELSE pct_agg_passed END)` requires both
 * branches share the same sketch family. See #278 for the type-mismatch
 * incident that originally locked the schema to tdigest here.
 */
export class AddPctAggPassedToStatsRollup1779000000000 implements MigrationInterface {
  name = 'AddPctAggPassedToStatsRollup1779000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE test_run_transaction_stats
        ADD COLUMN IF NOT EXISTS pct_agg_passed tdigest
    `);
    await queryRunner.query(`
      ALTER TABLE test_run_sampler_stats
        ADD COLUMN IF NOT EXISTS pct_agg_passed tdigest
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE test_run_sampler_stats
        DROP COLUMN IF EXISTS pct_agg_passed
    `);
    await queryRunner.query(`
      ALTER TABLE test_run_transaction_stats
        DROP COLUMN IF EXISTS pct_agg_passed
    `);
  }
}
