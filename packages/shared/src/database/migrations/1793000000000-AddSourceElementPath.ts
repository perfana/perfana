import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brings an existing database up to the canonical schema for request plan-path metadata.
 *
 * Everything here is also in the consolidated schema, which only runs on a fresh install. This
 * migration is what an already-deployed database gets, so both arrive at the same shape — which
 * matters because the API's chain query names both columns in one COALESCE. A database holding
 * only one of them would fail that query outright and render no bands at all.
 */
export class AddSourceElementPath1793000000000 implements MigrationInterface {
  name = 'AddSourceElementPath1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Where the request sits in the test plan, outermost first, ENDING AT THE SAMPLER ITSELF.
    // Fixed for a given plan position, so it says nothing about which loop pass or which
    // concurrent execution produced a particular request.
    //
    // Adding a nullable column to the hypertable is metadata-only: no table rewrite, and the
    // continuous aggregates over requests_raw select no row detail, so they are unaffected.
    await queryRunner.query(
      `ALTER TABLE "requests_raw" ADD COLUMN IF NOT EXISTS "source_element_path" jsonb`,
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "requests_raw"."source_element_path" IS
        'Configured position in the test plan, outermost first, last entry is the sampler: [{name, class, occurrence}]. occurrence separates same-named siblings. Static per plan position - carries no loop pass or concurrent execution. NULL when the engine does not supply it.'
    `);

    // The runtime-tagged predecessor. Retired upstream and never written again, but historical
    // runs are still read through it, and the API query references it unconditionally.
    await queryRunner.query(
      `ALTER TABLE "requests_raw" ADD COLUMN IF NOT EXISTS "parent_controllers" jsonb`,
    );

    // Only ever populated from parent_controllers, so it takes no new rows after this release.
    // Created here so the rollup pipeline's DELETE does not error on a database that never saw
    // the consolidated schema.
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
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_trs_parallel_group_stats_lookup"
        ON "test_run_parallel_group_stats" ("test_run_id", "transaction_name", "ramp_up_excluded")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // parent_controllers and the stats table are left in place: dropping them would discard the
    // only record of how historical runs were structured, which this migration did not create.
    await queryRunner.query(
      `ALTER TABLE "requests_raw" DROP COLUMN IF EXISTS "source_element_path"`,
    );
  }
}
