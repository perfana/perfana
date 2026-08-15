import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddParallelGroupStats1792000000000 implements MigrationInterface {
  name = 'AddParallelGroupStats1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Identifies one execution of a Parallel Controller — the requests a single virtual user
    // issued concurrently in one pass. Every request of that pass shares the value, which is
    // what makes the group's own elapsed time measurable rather than approximable.
    await queryRunner.query(
      `ALTER TABLE "requests_raw" ADD COLUMN IF NOT EXISTS "parallel_group_id" text`,
    );

    // Per-group statistics, computed once by the transaction-stats-rollup pipeline. The metric
    // is the group's elapsed time per pass (last finish minus first start), so percentiles here
    // describe real observed durations. Deriving this live would mean scanning requests_raw on
    // every request-table expansion, which is the cost the rollup tables exist to avoid.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "test_run_parallel_group_stats" (
        "test_run_id"        text NOT NULL,
        "transaction_name"   text NOT NULL,
        "parallel_group"     text NOT NULL,
        "scenario_name"      text NOT NULL DEFAULT ''::text,
        "ramp_up_excluded"   boolean NOT NULL,
        "system_under_test"  text,
        "test_environment"   text,
        "executions"         bigint NOT NULL,
        "passed_count"       bigint NOT NULL,
        "failed_count"       bigint NOT NULL,
        "request_count"      bigint NOT NULL,
        "avg_elapsed"        numeric,
        "min_elapsed"        integer,
        "max_elapsed"        integer,
        "pct_agg"            public.tdigest NOT NULL,
        "computed_at"        timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "test_run_parallel_group_stats_pkey"
          PRIMARY KEY ("test_run_id", "transaction_name", "parallel_group", "scenario_name", "ramp_up_excluded")
      )
    `);

    // Mirrors idx_trs_sampler_stats_lookup: the read path fetches every group of one
    // transaction for one ramp-up setting.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_trs_parallel_group_stats_lookup"
        ON "test_run_parallel_group_stats" ("test_run_id", "transaction_name", "ramp_up_excluded")
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "requests_raw"."parallel_group_id" IS
        'Identifies one concurrent pass through a Parallel Controller. Shared by every request of that pass. NULL when the request ran sequentially or the load test tool does not report it.'
    `);
    await queryRunner.query(`
      COMMENT ON TABLE "test_run_parallel_group_stats" IS
        'Per parallel-group statistics over the group''s own elapsed time per pass (last finish minus first start). Populated by the transaction-stats-rollup pipeline.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "test_run_parallel_group_stats"`);
    await queryRunner.query(
      `ALTER TABLE "requests_raw" DROP COLUMN IF EXISTS "parallel_group_id"`,
    );
  }
}
