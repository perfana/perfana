import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds composite (system_under_test, test_environment, scenario_name, time DESC)
 * indexes on the three largest request hypertables so Grafana panels stop
 * falling back to a parallel index-scan-on-time + filter.
 *
 * Grafana panels query these tables with
 *   WHERE system_under_test = ? AND test_environment = ? AND scenario_name = ?
 *     AND time BETWEEN ? AND ?
 * Without a matching composite, a 30-minute window on a ~10M-row weekly chunk
 * took ~57s and returned 0 rows when the scenario didn't match. The new index
 * collapses that to a targeted lookup.
 *
 * Storage footprint: ~300 MB per hypertable at current production size
 * (measured on performance-praegus, 2026-04-19 after manual apply).
 *
 * Idempotent: uses CREATE INDEX IF NOT EXISTS so environments where the
 * indexes were pre-created manually (e.g. performance-praegus) are no-ops.
 *
 * Lock note: `WITH (timescaledb.transaction_per_chunk)` would be ideal to
 * keep writes flowing on other chunks during the build, but Timescale rejects
 * that option inside a transaction block and TypeORM runs migrations inside
 * one ("migrationsTransactionMode: all"). On production the indexes were
 * applied manually with the per-chunk option for zero-downtime; this
 * migration formalizes parity for fresh installs and smaller environments
 * where a brief build-time write lock is acceptable.
 */
export class AddCompositeSutEnvScenIndexes1777000000000 implements MigrationInterface {
  name = 'AddCompositeSutEnvScenIndexes1777000000000';

  private readonly tables = ['requests_error', 'requests_raw', 'transactions'] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      const indexName = `idx_${table}_sut_env_scen_time`;
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "${indexName}" ` +
          `ON "${table}" (system_under_test, test_environment, scenario_name, "time" DESC)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      const indexName = `idx_${table}_sut_env_scen_time`;
      await queryRunner.query(`DROP INDEX IF EXISTS "${indexName}"`);
    }
  }
}
