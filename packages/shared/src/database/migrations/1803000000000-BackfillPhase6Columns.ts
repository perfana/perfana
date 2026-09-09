import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Phase 6 columns of the consolidated schema that never got an incremental
 * migration of their own.
 *
 * Phase 6 exists for columns added AFTER the baseline pg_dump in `schema-sql.ts`.
 * By construction every one of them post-dates the consolidated migration, so a
 * database provisioned before a given Phase 6 line was written does not have that
 * column — while the entity declares it and TypeORM names it in every SELECT. That
 * is the `dynatrace_entity_mappings.labels` failure (migration 1802), and these four
 * are the same shape, still open:
 *
 *   benchmarks.aggregate_metric      benchmarks.aggregate_stat
 *   test_runs.ramp_down              requests_error.session_variables
 *
 * `use_proxy` is not here: 1783409734007-AddProxyServer already covers all five of
 * its tables.
 *
 * Every statement is `IF NOT EXISTS`, so this is a no-op on any database provisioned
 * after the corresponding Phase 6 line landed — which is most of them. It exists so
 * that "column is in Phase 6" implies "an existing database can get it", which is
 * what `scripts/check-entity-migrations.mjs` now enforces.
 */
export class BackfillPhase6Columns1803000000000 implements MigrationInterface {
  name = 'BackfillPhase6Columns1803000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Definitions copied verbatim from Phase 6 of 1700000000000-ConsolidatedSchema.
    await queryRunner.query(
      `ALTER TABLE "benchmarks" ADD COLUMN IF NOT EXISTS "aggregate_metric" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "benchmarks" ADD COLUMN IF NOT EXISTS "aggregate_stat" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "test_runs" ADD COLUMN IF NOT EXISTS "ramp_down" integer DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE public.requests_error ADD COLUMN IF NOT EXISTS session_variables jsonb`,
    );
  }

  /**
   * Deliberately empty. These columns predate this migration on nearly every
   * database, so dropping them on revert would delete data this migration never
   * created. Reverting the *feature* is what should drop them, if ever.
   */
  public async down(): Promise<void> {
    // no-op
  }
}
