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
 * percentile_agg tdigest) make this safe on TimescaleDB toolkit ≥ 1.15 via
 * `rollup(tdigest)`.
 *
 * Related: issue #147. Overlaps with #139 (approx_percentile) and #150/#151
 * (per-test-run rollup table). This plan is dashboard-facing; #150/#151 is
 * API-facing — the two optimizations are complementary.
 */
export class AddContinuousAggregates1777500000000 implements MigrationInterface {
  name = 'AddContinuousAggregates1777500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- requests_raw family -------------------------------------------------

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_5s
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 seconds'::interval, time)          AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        sampler_name,
        transaction_name,
        location,
        count(*)                                           AS n,
        count(*) FILTER (WHERE success)                    AS n_ok,
        count(*) FILTER (WHERE NOT success)                AS n_err,
        avg(response_time)                                 AS avg_rt,
        min(response_time)                                 AS min_rt,
        max(response_time)                                 AS max_rt,
        avg(response_connect_time)                         AS avg_connect,
        avg(response_latency)                              AS avg_latency,
        sum(response_size)::bigint                         AS bytes_in,
        sum(request_size)::bigint                          AS bytes_out,
        avg(response_size)                                 AS avg_response_size,
        percentile_agg(response_time::double precision)    AS pct_agg
      FROM requests_raw
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_1m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 minute'::interval, bucket)          AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        sampler_name,
        transaction_name,
        location,
        sum(n)::bigint                                     AS n,
        sum(n_ok)::bigint                                  AS n_ok,
        sum(n_err)::bigint                                 AS n_err,
        sum(avg_rt * n) / NULLIF(sum(n), 0)                AS avg_rt,
        min(min_rt)                                        AS min_rt,
        max(max_rt)                                        AS max_rt,
        sum(avg_connect * n) / NULLIF(sum(n), 0)           AS avg_connect,
        sum(avg_latency * n) / NULLIF(sum(n), 0)           AS avg_latency,
        sum(bytes_in)::bigint                              AS bytes_in,
        sum(bytes_out)::bigint                             AS bytes_out,
        sum(avg_response_size * n) / NULLIF(sum(n), 0)     AS avg_response_size,
        rollup(pct_agg)                                    AS pct_agg
      FROM requests_raw_5s
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes'::interval, bucket)         AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        sampler_name,
        transaction_name,
        location,
        sum(n)::bigint                                     AS n,
        sum(n_ok)::bigint                                  AS n_ok,
        sum(n_err)::bigint                                 AS n_err,
        sum(avg_rt * n) / NULLIF(sum(n), 0)                AS avg_rt,
        min(min_rt)                                        AS min_rt,
        max(max_rt)                                        AS max_rt,
        sum(avg_connect * n) / NULLIF(sum(n), 0)           AS avg_connect,
        sum(avg_latency * n) / NULLIF(sum(n), 0)           AS avg_latency,
        sum(bytes_in)::bigint                              AS bytes_in,
        sum(bytes_out)::bigint                             AS bytes_out,
        sum(avg_response_size * n) / NULLIF(sum(n), 0)     AS avg_response_size,
        rollup(pct_agg)                                    AS pct_agg
      FROM requests_raw_1m
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      WITH NO DATA;
    `);

    console.log('  Created requests_raw_5s / requests_raw_1m / requests_raw_5m');

    // --- transactions family -------------------------------------------------

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_5s
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 seconds'::interval, time)          AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        transaction_name,
        count(*)                                           AS n,
        count(*) FILTER (WHERE success)                    AS n_ok,
        count(*) FILTER (WHERE NOT success)                AS n_err,
        avg(response_time)                                 AS avg_rt,
        min(response_time)                                 AS min_rt,
        max(response_time)                                 AS max_rt,
        percentile_agg(response_time::double precision)    AS pct_agg
      FROM transactions
      GROUP BY 1, 2, 3, 4, 5
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_1m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 minute'::interval, bucket)          AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        transaction_name,
        sum(n)::bigint                                     AS n,
        sum(n_ok)::bigint                                  AS n_ok,
        sum(n_err)::bigint                                 AS n_err,
        sum(avg_rt * n) / NULLIF(sum(n), 0)                AS avg_rt,
        min(min_rt)                                        AS min_rt,
        max(max_rt)                                        AS max_rt,
        rollup(pct_agg)                                    AS pct_agg
      FROM transactions_5s
      GROUP BY 1, 2, 3, 4, 5
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes'::interval, bucket)         AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        transaction_name,
        sum(n)::bigint                                     AS n,
        sum(n_ok)::bigint                                  AS n_ok,
        sum(n_err)::bigint                                 AS n_err,
        sum(avg_rt * n) / NULLIF(sum(n), 0)                AS avg_rt,
        min(min_rt)                                        AS min_rt,
        max(max_rt)                                        AS max_rt,
        rollup(pct_agg)                                    AS pct_agg
      FROM transactions_1m
      GROUP BY 1, 2, 3, 4, 5
      WITH NO DATA;
    `);

    console.log('  Created transactions_5s / transactions_1m / transactions_5m');

    // --- requests_error family -----------------------------------------------

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS requests_error_5s
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 seconds'::interval, time)          AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        sampler_name,
        transaction_name,
        node_name,
        response_code,
        count(*)                                           AS n
      FROM requests_error
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS requests_error_1m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 minute'::interval, bucket)          AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        sampler_name,
        transaction_name,
        node_name,
        response_code,
        sum(n)::bigint                                     AS n
      FROM requests_error_5s
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS requests_error_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes'::interval, bucket)         AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        sampler_name,
        transaction_name,
        node_name,
        response_code,
        sum(n)::bigint                                     AS n
      FROM requests_error_1m
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
      WITH NO DATA;
    `);

    console.log('  Created requests_error_5s / requests_error_1m / requests_error_5m');
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Filled in by Task 7.
  }
}
