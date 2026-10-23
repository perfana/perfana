import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deleting a system under test timed out in production (2026-10-23, SUT "Polis"):
 *
 *   11:09:23  Starting cascade deletion for system under test "Polis"
 *   11:09:24  Deleted 20 rows from ds_compare_config
 *             query failed: DELETE FROM application_dashboards WHERE system_under_test_id = $1
 *             error: Query read timeout
 *   11:14:24  SlowRequest DELETE /api/systems-under-test/97e75ab9… 500 300966ms
 *
 * That SUT had NO test runs — phases 1 through 4 of the cascade logged nothing, so every one
 * of the 300 s went into the `application_dashboards` DELETE on its own. The cost is not the
 * rows being deleted, it is the parent-side foreign-key check: for each deleted row Postgres
 * probes every referencing table with `SELECT 1 FROM <child> WHERE <fk_col> = $1 FOR KEY
 * SHARE`, and a child with no index leading on that column answers with a full scan.
 *
 * Measured on the dev database, three parents the cascade deletes from had children with no
 * leading index on the referencing column:
 *
 *   application_dashboards  10 of 13 children unindexed
 *   metrics_sources         17 of 17 children unindexed   ← deleted LAST, in phase 6
 *   benchmarks               2 of  N children unindexed   ← deleted in phase 6
 *
 * So fixing only the `application_dashboards` side moves the same timeout into phase 6.
 *
 * This migration indexes the referencing column on every child whose size scales with data
 * volume — runs x dashboards x panels x metrics. The remaining children are deliberately
 * left unindexed: `benchmarks`, `application_dashboards`, `dynatrace_queries`,
 * `provisioned_template_ds_compare_configs` and the two filter-preset tables are bounded by
 * human action, hundreds of rows, and a seq scan of them costs microseconds. An index there
 * would be write overhead bought for nothing.
 *
 * Every column indexed here is additionally nullable on some tables; those get a partial
 * index, matching the existing `IDX_9225364cbd7174db8a78ac4c86` / `IDX_f7ef2f635a3a3e941e19404e76`
 * on the filter presets. An RI probe always searches for a concrete non-null value, so a
 * `WHERE col IS NOT NULL` index serves it in full and stays smaller.
 *
 * `ds_metrics` is NOT indexed here, and the FK it carries is dropped instead — see
 * 1817000000000-DropDsMetricsForeignKeys. Verified on the dev database: an index on a
 * column outside `compress_segmentby` is created on the compressed chunk and never used,
 * because the value lives inside the compressed payload.
 *
 *   Custom Scan (ColumnarScan) on _hyper_21_26_chunk x
 *     Vectorized Filter: (pid = '0000…'::uuid)
 *     Rows Removed by Filter: 1000          <- every row, index ignored
 *     ->  Seq Scan on _hyper_21_26_chunk_compressed
 *
 * The one cost this does not cancel, carried over from 1814's note on the same shape: these
 * columns are random uuids, so each insert now dirties a random leaf page in each new index.
 * `ds_adapt_results` and `ds_metric_statistics` are the two that matter — both are written by
 * upserts already running against a statement-timeout budget (`adapt-analysis` at 120 s,
 * `statistics-calculation` at `AGGREGATION_STATEMENT_TIMEOUT_MS`). Worth one before/after
 * comparison of those stages on a large run rather than assuming it is free.
 *
 * Lock discipline is 1814's, for 1814's reason: CREATE INDEX needs SHARE, which conflicts
 * with the ROW EXCLUSIVE the worker's pipelines hold for minutes, and Postgres' lock queue is
 * FIFO so a waiting SHARE blocks every writer behind it. Nothing stops the worker during a
 * migration. The retry is plpgsql because the batch runs under TypeORM's `transaction: "all"`
 * and a `lock_timeout` error would poison it. Not CONCURRENTLY: a build that dies leaves an
 * INVALID index that `IF NOT EXISTS` then matches forever, so the retry reports success and
 * the index never serves a query.
 */

/** [index name, table, column, partial] — partial means the column is nullable on that table. */
const INDEXES: ReadonlyArray<readonly [string, string, string, boolean]> = [
  // application_dashboards children
  ['idx_ds_adapt_results_app_dashboard', 'ds_adapt_results', 'application_dashboard_id', false],
  ['idx_ds_adapt_tracked_results_app_dashboard', 'ds_adapt_tracked_results', 'application_dashboard_id', false],
  ['idx_ds_change_points_app_dashboard', 'ds_change_points', 'application_dashboard_id', true],
  ['idx_ds_compare_config_app_dashboard', 'ds_compare_config', 'application_dashboard_id', false],
  ['idx_ds_control_group_statistics_app_dashboard', 'ds_control_group_statistics', 'application_dashboard_id', false],
  ['idx_ds_panels_app_dashboard', 'ds_panels', 'application_dashboard_id', false],
  ['idx_ds_tracked_differences_app_dashboard', 'ds_tracked_differences', 'application_dashboard_id', false],
  // metrics_sources children (the column is nullable everywhere)
  ['idx_ds_adapt_results_metrics_source', 'ds_adapt_results', 'metrics_source_id', true],
  ['idx_ds_adapt_tracked_results_metrics_source', 'ds_adapt_tracked_results', 'metrics_source_id', true],
  ['idx_ds_change_points_metrics_source', 'ds_change_points', 'metrics_source_id', true],
  ['idx_ds_compare_config_metrics_source', 'ds_compare_config', 'metrics_source_id', true],
  ['idx_ds_control_group_statistics_metrics_source', 'ds_control_group_statistics', 'metrics_source_id', true],
  ['idx_ds_metric_statistics_metrics_source', 'ds_metric_statistics', 'metrics_source_id', true],
  ['idx_ds_panels_metrics_source', 'ds_panels', 'metrics_source_id', true],
  ['idx_ds_tracked_differences_metrics_source', 'ds_tracked_differences', 'metrics_source_id', true],
  // benchmarks children
  ['idx_ds_metric_statistics_benchmark', 'ds_metric_statistics', 'benchmark_id', true],
  ['idx_ds_tracked_differences_benchmark', 'ds_tracked_differences', 'benchmark_id', true],
];

/**
 * Wraps a list of DDL statements in one plpgsql loop that retries each on `lock_not_available`.
 * `set_config(..., true)` is issued once OUTSIDE the per-statement subtransaction on purpose:
 * a subtransaction rollback reverts settings made inside it, not ones made before it.
 */
function lockSafeBatch(tag: string, statements: readonly string[]): string {
  const array = statements.map((s) => `'${s.replace(/'/g, "''")}'`).join(',\n      ');
  return `
    DO $${tag}$
    DECLARE
      stmt text;
      attempt int;
      stmts text[] := ARRAY[
      ${array}
      ];
    BEGIN
      PERFORM set_config('lock_timeout', '3s', true);
      FOREACH stmt IN ARRAY stmts LOOP
        attempt := 0;
        LOOP
          attempt := attempt + 1;
          BEGIN
            EXECUTE stmt;
            EXIT;
          EXCEPTION WHEN lock_not_available THEN
            IF attempt >= 10 THEN
              RAISE EXCEPTION
                'could not apply "%": the table stayed locked across % attempts. Find the long-running pipeline (pg_stat_activity) and retry the deploy.', stmt, attempt;
            END IF;
            PERFORM pg_sleep(3);
          END;
        END LOOP;
      END LOOP;
    END
    $${tag}$;
  `;
}

export class IndexFkProbeColumns1816000000000 implements MigrationInterface {
  name = 'IndexFkProbeColumns1816000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      lockSafeBatch(
        'create_fk_indexes',
        INDEXES.map(
          ([name, table, column, partial]) =>
            `CREATE INDEX IF NOT EXISTS ${name} ON public.${table} (${column})` +
            (partial ? ` WHERE ${column} IS NOT NULL` : ''),
        ),
      ),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // DROP INDEX needs ACCESS EXCLUSIVE, which conflicts with plain SELECT too, so a waiting
    // drop stalls the API's reads as well as the worker's writes. Same bound as up().
    await queryRunner.query(
      lockSafeBatch(
        'drop_fk_indexes',
        INDEXES.map(([name]) => `DROP INDEX IF EXISTS public.${name}`),
      ),
    );
  }
}
