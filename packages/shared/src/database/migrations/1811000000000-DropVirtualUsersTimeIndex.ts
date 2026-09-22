import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop `virtual_users_time_idx`, TimescaleDB's auto-created default index on the
 * time column. Nothing in this codebase can use it, and the planner keeps choosing
 * it over `idx_virtual_users_test_run_id_time` at a ~50x cost in buffers.
 *
 * Measured on production 2026-09-22, `GET /test-runs/:id/virtual-users` on a 3h07m
 * run (WERKNL-...-00012, 313,617 virtual_users rows), both plans warm:
 *
 *   via virtual_users_time_idx   592,940 buffers   473 ms   reads 590,949 -> returns 261,597
 *   via the composite index       11,975 buffers   265 ms   reads 313,617 -> returns 261,597
 *
 * The 329,352 extra rows are other tests: four nightly runs share the 7-day chunk's
 * time range (261,596 / 156,412 / 145,832 / 27,109 rows in the window), so the time
 * index matches all of them and `test_run_id` only gets to be a post-filter. Across
 * the deployment that index had read 1.65 BILLION tuples with `idx_tup_fetch` at
 * 99.97% of `idx_tup_read` — the signature of fetching every heap row and discarding
 * most of it.
 *
 * WHY THE PLANNER PREFERS IT, AND WHY YOU CANNOT FIX THAT WITH ANALYZE
 * Not stale statistics: the chunk had been autoanalyzed 52 times, most recently the
 * same day, and `test_run_id` carries all 18 of its distinct values in the MCV list.
 * It is correlated-predicate underestimation. Each nightly run occupies its own band
 * of the night, so the time-range and `test_run_id` predicates are strongly
 * correlated, and Postgres multiplies their selectivities as if they were
 * independent: it estimated 26,315 rows per worker against 87,199 actual (3.3x low)
 * and costed the time index at 22,801 against the composite's 63,072. `time` also
 * has correlation 0.9974, which makes a range scan on it look almost sequential.
 * Extended statistics would be the principled fix, but on a hypertable the planner
 * reads the CHUNK's statistics, and `CREATE STATISTICS` is not propagated to chunks
 * created later — so it would silently stop working for every new chunk.
 *
 * WHY DROPPING IS SAFE HERE
 * Every read of `virtual_users` in the repo filters by `test_run_id`:
 * `test-runs-performance-query.service.ts` (the overall and per-scenario queries),
 * `report-data-fetcher.service.ts` (same pair for reports), and the worker's
 * `scenario-processors.ts`. None filters on time alone, and the composite index
 * carries `time` as its second column, so a time-ordered scan within one run is
 * still index-served. A future time-only query would fall back to a scan bounded by
 * TimescaleDB chunk exclusion (~one chunk), not a scan of the whole hypertable.
 *
 * Verified against TimescaleDB 2.28.3 in a rolled-back transaction: after the drop,
 * a newly created chunk carries only `idx_virtual_users_test_run_id_time`. The
 * default index is created from the hypertable's index set at chunk creation, so
 * dropping it on the parent stops new chunks inheriting it.
 *
 * GREENFIELD TOO, DELIBERATELY NOT VIA ConsolidatedSchema
 * Removing the `CREATE INDEX virtual_users_time_idx` from `schema-sql.ts` would not
 * work on its own: `createHypertables()` calls `create_hypertable()` with the default
 * `create_default_indexes => TRUE`, which creates a time index when none exists, so
 * the index would come straight back on a new install under the same name. Suppressing
 * that would mean passing `create_default_indexes => FALSE` for this one table and
 * hand-creating the rest. Letting this migration run after the consolidated one
 * instead gives both new and existing databases the same single code path.
 *
 * DROP INDEX takes an ACCESS EXCLUSIVE lock on each chunk's index, held only for the
 * catalog update, so this is fast — but it will queue behind a long-running read of
 * `virtual_users`. `lock_timeout` bounds that rather than letting it block ingestion
 * behind an analyze; a failure here is harmless and the migration can be re-run.
 */
export class DropVirtualUsersTimeIndex1811000000000 implements MigrationInterface {
  name = 'DropVirtualUsersTimeIndex1811000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    // Dropping the hypertable's index drops every chunk's copy with it.
    await queryRunner.query('DROP INDEX IF EXISTS virtual_users_time_idx');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreating costs a full build over every chunk; only worth it to undo.
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS virtual_users_time_idx ON virtual_users USING btree ("time" DESC)'
    );
  }
}
