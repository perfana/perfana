import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Side-by-side CAGGs carrying success-filtered percentile sketches
 * (`pct_agg_passed = percentile_agg(response_time) FILTER (WHERE success)`).
 * Used by the live Apdex fast path in TestRunsPerformanceQueryService —
 * combined with the existing `transactions_5s` / `requests_raw_5s` CAGGs
 * (which carry `pct_agg` over all rows + n/n_ok/n_err) to compute the
 * exact same Apdex the post-test rollup table delivers, but in O(buckets).
 *
 * Side-by-side rather than ALTERing the existing CAGGs because Timescale
 * does not support adding aggregate columns to a continuous aggregate;
 * DROP+CREATE on `transactions_5s` would dark out the throughput panels
 * for the duration of the rematerialization. New CAGGs materialize in
 * the background; until they catch up, the live Apdex code falls
 * through to the raw-scan path (clampSinceMinutes + withStatementTimeout
 * already added in PR #302).
 *
 * Sketch family: `percentile_agg` returns `uddsketch`. The companion
 * existing CAGGs use the same family, so `rollup(pct_agg)` and
 * `rollup(pct_agg_passed)` and any cross-CAGG operations stay in-family.
 * (The per-test-run rollup tables use `tdigest` — different family, but
 * we never mix sketches across the two paths.)
 *
 * Related: rollup-table equivalent is migration 1779000000000 (#298).
 * This migration is the CAGG-side analog: same idea, applied to the
 * live aggregation path so the live Apdex score stops counting failed
 * rows as satisfied/tolerating and the query stops scanning raw rows.
 */
export class AddPctAggPassedCaggs1779100000000 implements MigrationInterface {
  name = 'AddPctAggPassedCaggs1779100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- transactions_passed family -----------------------------------------

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_passed_5s
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 seconds'::interval, time)             AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        transaction_name,
        percentile_agg(response_time::double precision)
          FILTER (WHERE success)                              AS pct_agg_passed
      FROM transactions
      GROUP BY 1, 2, 3, 4, 5
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_passed_1m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 minute'::interval, bucket)            AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        transaction_name,
        rollup(pct_agg_passed)                                AS pct_agg_passed
      FROM transactions_passed_5s
      GROUP BY 1, 2, 3, 4, 5
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_passed_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes'::interval, bucket)           AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        transaction_name,
        rollup(pct_agg_passed)                                AS pct_agg_passed
      FROM transactions_passed_1m
      GROUP BY 1, 2, 3, 4, 5
      WITH NO DATA;
    `);

    // --- requests_raw_passed family -----------------------------------------

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_passed_5s
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 seconds'::interval, time)             AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        sampler_name,
        transaction_name,
        location,
        percentile_agg(response_time::double precision)
          FILTER (WHERE success)                              AS pct_agg_passed
      FROM requests_raw
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_passed_1m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 minute'::interval, bucket)            AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        sampler_name,
        transaction_name,
        location,
        rollup(pct_agg_passed)                                AS pct_agg_passed
      FROM requests_raw_passed_5s
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_passed_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes'::interval, bucket)           AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        sampler_name,
        transaction_name,
        location,
        rollup(pct_agg_passed)                                AS pct_agg_passed
      FROM requests_raw_passed_1m
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      WITH NO DATA;
    `);

    // --- refresh policies ---------------------------------------------------
    // Match the existing transactions_5s / requests_raw_5s family from
    // migration 1777500000000.

    const refreshPolicies = [
      { view: 'transactions_passed_5s',  start: '1 hour',  end: '1 minute',  schedule: '30 seconds' },
      { view: 'transactions_passed_1m',  start: '2 hours', end: '2 minutes', schedule: '1 minute' },
      { view: 'transactions_passed_5m',  start: '1 day',   end: '5 minutes', schedule: '5 minutes' },
      { view: 'requests_raw_passed_5s',  start: '1 hour',  end: '1 minute',  schedule: '30 seconds' },
      { view: 'requests_raw_passed_1m',  start: '2 hours', end: '2 minutes', schedule: '1 minute' },
      { view: 'requests_raw_passed_5m',  start: '1 day',   end: '5 minutes', schedule: '5 minutes' },
    ];

    for (const p of refreshPolicies) {
      await queryRunner.query(`
        SELECT add_continuous_aggregate_policy('${p.view}',
          start_offset      => INTERVAL '${p.start}',
          end_offset        => INTERVAL '${p.end}',
          schedule_interval => INTERVAL '${p.schedule}',
          if_not_exists     => TRUE
        );
      `);
    }

    // --- retention policies -------------------------------------------------
    // 90 days, matching the existing CAGG family.
    const views = [
      'transactions_passed_5s',  'transactions_passed_1m',  'transactions_passed_5m',
      'requests_raw_passed_5s',  'requests_raw_passed_1m',  'requests_raw_passed_5m',
    ];
    for (const view of views) {
      await queryRunner.query(`
        SELECT add_retention_policy('${view}',
          drop_after    => INTERVAL '90 days',
          if_not_exists => TRUE
        );
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const views = [
      'transactions_passed_5m', 'transactions_passed_1m', 'transactions_passed_5s',
      'requests_raw_passed_5m', 'requests_raw_passed_1m', 'requests_raw_passed_5s',
    ];
    for (const view of views) {
      await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS ${view} CASCADE`);
    }
  }
}
