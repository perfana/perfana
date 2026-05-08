import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist per-(test_run, dashboard, panel, metric) sketch + central-moment
 * components so `ControlGroupStatisticsPipeline` can pool across control runs
 * without rescanning `ds_metrics` (issue #289).
 *
 * The current pipeline scans `ds_metrics` raw and computes
 * `percentile_agg(value)` over the union of every control run. On a populated
 * lab DB that's 100+ s of cold reads per re-evaluate, contending with
 * autovacuum on the same hypertable chunk.
 *
 * `StatisticsPipeline` already builds a `percentile_agg(value)` sketch per run
 * to extract scalar quantiles for `ds_metric_statistics`. Persisting that same
 * sketch here makes pooling across runs a small `rollup(pct_agg)` over ~N
 * pre-aggregated rows, the same trick used by the `requests_raw_*` and
 * `transactions_*` continuous aggregates plus the per-test-run
 * `test_run_*_stats` rollup tables. `rollup()` over `uddsketch` is associative
 * (TimescaleDB toolkit ≥ 1.15), so the pooled distribution matches what the
 * raw-scan path produces, modulo the standard sketch approximation bound.
 *
 * Why uddsketch and not tdigest:
 *   `StatisticsPipeline` already calls `percentile_agg(value)` (which returns
 *   `uddsketch`) to derive the per-run scalar quantiles. Storing the very same
 *   value avoids changing the per-run sketch type — the pre-existing tail
 *   accuracy and the new pooled-control-group accuracy stay identical.
 *
 * `sum_value` and `sum_sq_value` are the two extra moments needed to
 * recompute exact pooled population mean and population standard deviation
 * across the control runs without rescanning raw. (uddsketch / tdigest
 * sketches don't preserve enough information to derive `STDDEV_POP` exactly
 * across a pooled distribution.) All three columns are nullable so existing
 * rows continue to work; the pipeline falls back to the raw-scan path when
 * any control run is missing them.
 *
 * Related: #283/#287/#288 are the API-side counterparts of this same
 * "per-run sketch already exists, pool with rollup() instead of rescanning
 * raw" pattern — applied to `requests_raw` / `transactions`. This is the
 * worker-side counterpart for the ADAPT control-group pooling step.
 */
export class AddDsMetricStatisticsPctAgg1778900000000 implements MigrationInterface {
  name = 'AddDsMetricStatisticsPctAgg1778900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ds_metric_statistics
        ADD COLUMN IF NOT EXISTS pct_agg uddsketch,
        ADD COLUMN IF NOT EXISTS sum_value double precision,
        ADD COLUMN IF NOT EXISTS sum_sq_value double precision
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ds_metric_statistics
        DROP COLUMN IF EXISTS sum_sq_value,
        DROP COLUMN IF EXISTS sum_value,
        DROP COLUMN IF EXISTS pct_agg
    `);
  }
}
