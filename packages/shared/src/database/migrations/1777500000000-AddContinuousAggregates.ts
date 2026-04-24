import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TimescaleDB continuous aggregates (CAGGs) over the three high-volume
 * hypertables `requests_raw`, `transactions`, `requests_error` at 5 s / 1 min /
 * 5 min granularities (9 CAGGs total). Grafana panels pick the CAGG matching
 * `$__interval` via a `$cagg_suffix` template variable, cutting p50 panel
 * latency from ~4 s (raw scan of 12 M index entries) to <200 ms (lookup in
 * pre-materialized bucketed rows).
 *
 * Hierarchy: 5s rolls from the raw hypertable, 1m rolls from 5s, 5m rolls from
 * 1m. Associative aggregates (count, sum, avg-via-sum/count, min, max,
 * percentile_agg tdigest) make this safe.
 *
 * `transaction = false` because `CREATE MATERIALIZED VIEW … WITH
 * (timescaledb.continuous)` and `add_continuous_aggregate_policy` both reject
 * transaction context. TypeORM will not wrap `up` / `down` in BEGIN/COMMIT.
 *
 * Related: issue #147. Overlaps with #139 (approx_percentile) and #150/#151
 * (per-test-run rollup table). This plan is dashboard-facing; #150/#151 is
 * API-facing — the two optimizations are complementary.
 */
export class AddContinuousAggregates1777500000000 implements MigrationInterface {
  name = 'AddContinuousAggregates1777500000000';

  // Opt out of TypeORM's auto-transaction. Required because CAGG DDL and
  // `add_continuous_aggregate_policy` cannot run inside a transaction block.
  public transaction = false as const;

  public async up(_queryRunner: QueryRunner): Promise<void> {
    // Filled in by Tasks 2–6.
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Filled in by Task 7.
  }
}
