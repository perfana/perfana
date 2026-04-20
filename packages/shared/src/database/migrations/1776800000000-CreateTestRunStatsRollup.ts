import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pre-computed per-test-run transaction and sampler statistics (#150, #151).
 *
 * `getTransactionStats` and `getAggregatedSamplerStats` aggregate over
 * 1M–30M rows in `transactions` / `requests_raw` on every dashboard refresh.
 * After the tdigest rewrite in #139/#148, raw row volume is the remaining wall
 * (measured: 135–213s for `stream_download_segment` at 11.35M rows).
 *
 * Because a completed test run is immutable on the aggregate side, compute the
 * stats once at finalization and store them here. Dashboard queries then read
 * ~N rollup rows instead of ~Nm raw rows.
 *
 * Two rows per group (full + ramp-up-excluded). The Overview-tab expand
 * defaults `excludeRampUp=true`, so storing both variants keeps every UI path
 * on the fast path. Editing `analysisStartOffset` on a completed run triggers
 * the rollup job to recompute the `ramp_up_excluded=true` rows.
 *
 * `pct_agg` is the TimescaleDB toolkit tdigest sketch — `approx_percentile` and
 * `approx_percentile_rank` read it directly, so p95/p99 and Apdex (computed
 * against the *current* threshold at read time, not materialized) stay cheap.
 */
export class CreateTestRunStatsRollup1776800000000 implements MigrationInterface {
  name = 'CreateTestRunStatsRollup1776800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE test_run_transaction_stats (
        test_run_id             text        NOT NULL,
        transaction_name        text        NOT NULL,
        scenario_name           text        NOT NULL DEFAULT '',
        ramp_up_excluded        boolean     NOT NULL,
        system_under_test_id    uuid        NOT NULL,
        test_environment        text        NOT NULL,
        workload                text,
        total_count             bigint      NOT NULL,
        passed_count            bigint      NOT NULL,
        failed_count            bigint      NOT NULL,
        avg_response_time       numeric(10,2),
        impact_score            numeric,
        pct_agg                 tdigest     NOT NULL,
        computed_at             timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (test_run_id, transaction_name, scenario_name, ramp_up_excluded)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_trs_tx_stats_sut_env_wl
        ON test_run_transaction_stats (system_under_test_id, test_environment, workload)
    `);

    await queryRunner.query(`
      CREATE TABLE test_run_sampler_stats (
        test_run_id             text        NOT NULL,
        transaction_name        text        NOT NULL,
        sampler_name            text        NOT NULL,
        scenario_name           text        NOT NULL DEFAULT '',
        ramp_up_excluded        boolean     NOT NULL,
        url_hash                text,
        system_under_test       text        NOT NULL,
        test_environment        text        NOT NULL,
        total_count             bigint      NOT NULL,
        passed_count            bigint      NOT NULL,
        failed_count            bigint      NOT NULL,
        avg_response_time       numeric(10,2),
        min_response_time       integer,
        max_response_time       integer,
        avg_latency             numeric(10,2),
        avg_connect_time        numeric(10,2),
        total_request_size      bigint,
        total_response_size     bigint,
        pct_agg                 tdigest     NOT NULL,
        computed_at             timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (test_run_id, transaction_name, sampler_name, scenario_name, ramp_up_excluded)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_trs_sampler_stats_lookup
        ON test_run_sampler_stats (test_run_id, transaction_name, ramp_up_excluded)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS test_run_sampler_stats`);
    await queryRunner.query(`DROP TABLE IF EXISTS test_run_transaction_stats`);
  }
}
