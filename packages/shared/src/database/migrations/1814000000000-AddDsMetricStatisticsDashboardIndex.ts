import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `ds_metric_statistics` had exactly two indexes — the `id` primary key and
 * `uniq_ds_metric_statistics (test_run_id, application_dashboard_id, panel_id, metric_name)`.
 * Nothing leads with `application_dashboard_id`, so the `hasData` filter behind every metric
 * picker (`ApplicationDashboardsService.filterToDashboardsWithData`) scanned the whole table
 * on every dialog open.
 *
 * Measured on production 2026-10-06, 1,231,739 rows / 1613 MB:
 *
 *   Parallel Index Only Scan using uniq_ds_metric_statistics
 *     rows=110263 loops=3   Rows Removed by Filter: 300317   Heap Fetches: 213726
 *     Buffers: shared hit=235391        Execution Time: 932 ms   (warm)
 *
 * and over the day, from pg_stat_statements: 220 calls, 1932 ms mean, 628,633 blocks read
 * (4.9 GB). Cold it is far worse — the API log for the same day has that endpoint at
 * 10,663 ms and 23,604 ms, with two more client aborts at 11,229 ms and 5,483 ms.
 *
 * The comment this replaces said to measure first and then add the index CONCURRENTLY out of
 * band. The measurement is above; the index is here instead, plain, following
 * 1807000000000-AddDsPanelsTestRunIndex. This table is NOT a hypertable
 * (`createHypertables` covers ds_metrics, requests_raw, requests_error, transactions and
 * virtual_users only), so none of 1813's per-chunk machinery — the `transaction_per_chunk`
 * build, `assertFullCoverage`, the refused CONCURRENTLY — applies here, and a plain build
 * that fails fast is genuinely safe.
 *
 * **Do not reach for CONCURRENTLY here, and not for the usual reason.** "It cannot run inside
 * the migration transaction" is only sometimes true: 1813 issues a bare `COMMIT` two
 * migrations earlier, so under the production runner's `transaction: "all"` this one runs in
 * autocommit on any deploy that carries 1813 in the same batch, and inside the transaction on
 * a deploy already past it. The reason that holds either way is the failure mode: a
 * CONCURRENTLY build that dies leaves an INVALID index behind, which `IF NOT EXISTS` then
 * matches forever — the retry reports success and the index never serves a query. That is
 * 1813's silent-partial-build trap in a different costume, and the plain build does not have
 * it.
 *
 * The lock discipline is 1809's, on this same table, and it is the part that matters.
 * 1807 is the precedent for the SHAPE, not for this: `ds_panels` has no long-running writer,
 * and `ds_metric_statistics` is held for up to `AGGREGATION_STATEMENT_TIMEOUT_MS` (540 s) by
 * a running aggregation. CREATE INDEX needs SHARE, which conflicts with the ROW EXCLUSIVE
 * `StatisticsPipeline` and `ControlGroupStatisticsPipeline` hold, so the build does not just
 * take seconds — it can WAIT minutes first, and Postgres' lock queue is FIFO, so the waiting
 * SHARE request then blocks every writer that arrives behind it. Nothing stops the worker
 * during a migration: no service in docker-compose.infra.yml declares
 * `depends_on: perfana-migration`. The retry is plpgsql because the batch runs under
 * TypeORM's default `transaction: "all"` and a `lock_timeout` error would poison it.
 *
 * Not a covering index on purpose. With this in place the query is rewritten to one index
 * probe per dashboard id that stops at the first match (see the service), so it never reads
 * enough entries for an index-only scan's heap fetches to matter — and the heap fetches are
 * exactly what made the old plan slow, 213,726 of them against a 1258 MB heap.
 *
 * It also closes a missing foreign-key index: `FK_30d5e9b699656dce6b211718780
 * (application_dashboard_id)` had no leading index, so every `application_dashboards` delete
 * scanned 1.2 M rows to verify the constraint.
 *
 * One cost the win does not cancel: `application_dashboard_id` is a random uuid, so each
 * statistics row insert now dirties a random leaf page in this index — extra WAL inside the
 * transactions already running against that 540 s budget. Worth one before/after comparison
 * of a `statistics-calculation` stage on a large run rather than assuming it is free.
 */
export class AddDsMetricStatisticsDashboardIndex1814000000000 implements MigrationInterface {
  name = 'AddDsMetricStatisticsDashboardIndex1814000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $create_index$
      DECLARE
        attempt int := 0;
      BEGIN
        PERFORM set_config('lock_timeout', '3s', true);
        LOOP
          attempt := attempt + 1;
          BEGIN
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ds_metric_statistics_app_dashboard ON public.ds_metric_statistics (application_dashboard_id)';
            RETURN;
          EXCEPTION WHEN lock_not_available THEN
            IF attempt >= 10 THEN
              RAISE EXCEPTION
                'could not create idx_ds_metric_statistics_app_dashboard: the table stayed locked across % attempts. Find the long-running aggregation (pg_stat_activity) and retry the deploy.', attempt;
            END IF;
            PERFORM pg_sleep(3);
          END;
        END LOOP;
      END
      $create_index$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // DROP INDEX needs ACCESS EXCLUSIVE, which conflicts with plain SELECT too, so a waiting
    // drop stalls the API's reads as well as the worker's writes. Same bound as up().
    await queryRunner.query(`
      DO $drop_index$
      DECLARE
        attempt int := 0;
      BEGIN
        PERFORM set_config('lock_timeout', '3s', true);
        LOOP
          attempt := attempt + 1;
          BEGIN
            EXECUTE 'DROP INDEX IF EXISTS idx_ds_metric_statistics_app_dashboard';
            RETURN;
          EXCEPTION WHEN lock_not_available THEN
            IF attempt >= 10 THEN
              RAISE EXCEPTION
                'could not drop idx_ds_metric_statistics_app_dashboard: the table stayed locked across % attempts.', attempt;
            END IF;
            PERFORM pg_sleep(3);
          END;
        END LOOP;
      END
      $drop_index$;
    `);
  }
}
