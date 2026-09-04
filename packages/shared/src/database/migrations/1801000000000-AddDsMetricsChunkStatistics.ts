import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Two changes that together cut StatisticsPipeline's aggregation cost on a large
 * run. Both target ds_metrics only — that is where the cost was measured.
 *
 * ── 1. Multi-column statistics on the aggregation group key ──────────────────
 *
 * StatisticsPipeline groups ds_metrics by
 * (test_run_id, application_dashboard_id, panel_id, metric_name). Postgres has
 * no combined n_distinct for that tuple, so it multiplies the per-column values
 * out. Measured on a production chunk: 10 x 59 x 26 x 3547 -> an estimate of
 * 8,404,581 groups against 20,598 actual, a 408x overestimate.
 *
 * That estimate is what makes the plan bad, in two compounding ways:
 *   - At an estimated 3.4 GB hash table the planner rejects HashAggregate and
 *     sorts instead. Measured: 20.6M rows spilled as `external merge Disk:
 *     5205304kB`. Raising work_mem does NOT fix this — the decision is made on
 *     the ESTIMATE, which exceeds AGGREGATION_WORK_MEM (128MB) just as it
 *     exceeds the 32MB default.
 *   - It also suppresses parallelism, because gathering 5.4M estimated rows
 *     looks expensive.
 *
 * With the statistics object in place the per-chunk estimate became 17,562
 * against 20,598 actual, and the same query went from 48,024 ms to 24,879 ms
 * with near-identical I/O (4,164,567 vs 4,164,471 blocks read, so this is a real
 * plan improvement and not a warm cache). The 5.2 GB sort is expected to
 * disappear as well — 20,598 groups x 400 bytes is ~8 MB, which fits trivially —
 * though that was not measured separately.
 *
 * WHY PER CHUNK, and why a scheduled job rather than one statement:
 * the estimate that matters is the per-chunk `Partial HashAggregate`, so the
 * statistics object has to exist ON THE CHUNK. TimescaleDB propagates indexes
 * and constraints to new chunks but NOT statistics objects, and chunks are
 * created continuously. Hence a job.
 *
 * It must be a TimescaleDB job and not worker code: CREATE STATISTICS is DDL and
 * the worker's perfana_system role has no CREATE on schema public, so a worker
 * implementation would fail silently — the same way audit_logs partition
 * creation did. add_job runs the procedure as its owner.
 *
 * The job only CREATEs + ANALYZEs chunks that do not have the object yet. Once
 * it exists, normal autoanalyze maintains it, so steady-state cost is one
 * catalog query per run.
 *
 * Compressed chunks are skipped deliberately. They are read via ColumnarScan
 * with test_run_id as the segmentby key and cost ~2 buffers for this query —
 * there is no aggregation misestimate to fix.
 *
 * ── 2. chunk_time_interval 7 days -> 1 day ───────────────────────────────────
 *
 * The active chunk was 79 GB / 82.5M rows against shared_buffers of 4 GB, so the
 * scan ran almost entirely off disk (194,290 buffer hits vs 4,171,222 reads, a
 * 4.4% hit ratio). A run's rows are ~25% of such a chunk and are scattered
 * (correlation on test_run_id measured at -0.027, because concurrent runs
 * interleave), so no index helps and a seq scan is genuinely the right plan.
 * Smaller chunks are the only lever that reduces how much has to be read.
 *
 * At the measured ingest rate (~11.3 GB/day) 1 day gives ~11 GB chunks: a ~7x
 * smaller scan, at ~365 chunks/year. Going smaller tracks TimescaleDB's own
 * guidance (active chunk within ~25% of shared_buffers, i.e. ~2 hours here) but
 * multiplies chunk count by 12 and with it the planning cost of every query that
 * cannot exclude chunks. 1 day is the compromise; re-run the sizing query in
 * TODOS.md if the ingest rate changes materially.
 *
 * AFFECTS NEW CHUNKS ONLY. Existing 7-day chunks keep their span until they age
 * out, so this does nothing for a run already ingested.
 *
 * Deliberately NOT changed here: compress_after (still 7 days). Compressing
 * sooner would remove the scan entirely, but recent runs are exactly the ones
 * force-refetch touches, and that path calls decompressChunksForRange against
 * max_tuples_decompressed_per_dml_transaction, which is charged per transaction.
 * That is a real trade rather than a free win, so it is left alone.
 *
 * Idempotent: safe on greenfield (after the consolidated migration creates the
 * hypertable) and safe to re-run on existing databases.
 */
export class AddDsMetricsChunkStatistics1801000000000 implements MigrationInterface {
    name = 'AddDsMetricsChunkStatistics1801000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // The worker that creates the statistics objects. Kept as a normal
        // function so it can be called directly for a backfill, with a thin
        // procedure wrapper below for add_job's (job_id, config) signature.
        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION public.ensure_ds_metrics_chunk_statistics()
            RETURNS integer
            LANGUAGE plpgsql
            AS $fn$
            DECLARE
                rec        record;
                stats_name text;
                created    integer := 0;
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                    RAISE NOTICE 'timescaledb not installed, skipping';
                    RETURN 0;
                END IF;

                FOR rec IN
                    SELECT c.chunk_schema, c.chunk_name
                    FROM timescaledb_information.chunks c
                    WHERE c.hypertable_name = 'ds_metrics'
                      -- Compressed chunks are read columnar via the segmentby key
                      -- and have no misestimate to fix.
                      AND NOT c.is_compressed
                LOOP
                    -- Deterministic name so re-runs are no-ops. Chunk names are
                    -- unique within _timescaledb_internal, and the 63-char
                    -- identifier limit is not reachable from '<chunk>_groupkey'.
                    stats_name := rec.chunk_name || '_groupkey';

                    BEGIN
                        IF EXISTS (
                            SELECT 1 FROM pg_statistic_ext s
                            JOIN pg_namespace n ON n.oid = s.stxnamespace
                            WHERE s.stxname = stats_name
                              AND n.nspname = rec.chunk_schema
                        ) THEN
                            -- Already present. Do NOT re-ANALYZE: autoanalyze
                            -- maintains extended statistics once the object exists,
                            -- and re-analyzing every chunk hourly would be pure cost.
                            CONTINUE;
                        END IF;

                        EXECUTE format(
                            'CREATE STATISTICS %I.%I (ndistinct) ON '
                            || 'test_run_id, application_dashboard_id, panel_id, metric_name '
                            || 'FROM %I.%I',
                            rec.chunk_schema, stats_name, rec.chunk_schema, rec.chunk_name
                        );

                        -- CREATE STATISTICS only declares the object; without an
                        -- ANALYZE it holds nothing and the planner keeps its old
                        -- multiplied-out estimate.
                        EXECUTE format('ANALYZE %I.%I', rec.chunk_schema, rec.chunk_name);

                        created := created + 1;
                        RAISE NOTICE 'created statistics % on %.%', stats_name, rec.chunk_schema, rec.chunk_name;
                    EXCEPTION WHEN OTHERS THEN
                        -- A chunk can be dropped or compressed between the catalog
                        -- read and the DDL. Never fail the whole sweep for one chunk.
                        RAISE WARNING 'could not create statistics on %.%: %',
                            rec.chunk_schema, rec.chunk_name, SQLERRM;
                    END;
                END LOOP;

                RETURN created;
            END $fn$;
        `);

        // add_job requires exactly (job_id integer, config jsonb).
        await queryRunner.query(`
            CREATE OR REPLACE PROCEDURE public.job_ds_metrics_chunk_statistics(
                job_id integer, config jsonb
            )
            LANGUAGE plpgsql
            AS $proc$
            DECLARE
                n integer;
            BEGIN
                n := public.ensure_ds_metrics_chunk_statistics();
                IF n > 0 THEN
                    RAISE NOTICE 'ds_metrics chunk statistics: created % object(s)', n;
                END IF;
            END $proc$;
        `);

        // Backfill now so existing uncompressed chunks benefit immediately,
        // rather than waiting for the first scheduled run.
        await queryRunner.query(`
            DO $$
            DECLARE n integer;
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                    RETURN;
                END IF;
                BEGIN
                    n := public.ensure_ds_metrics_chunk_statistics();
                    RAISE NOTICE 'ds_metrics chunk statistics backfill: % object(s) created', n;
                EXCEPTION WHEN OTHERS THEN
                    RAISE WARNING 'ds_metrics chunk statistics backfill failed: %', SQLERRM;
                END;
            END $$;
        `);

        // Hourly, not daily: with 1-day chunks a daily schedule can leave the
        // active chunk without statistics for most of a day, which is exactly the
        // chunk every recalculation reads. The sweep is one catalog query when
        // there is nothing to do.
        await queryRunner.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                    RETURN;
                END IF;
                IF EXISTS (
                    SELECT 1 FROM timescaledb_information.jobs
                    WHERE proc_name = 'job_ds_metrics_chunk_statistics'
                ) THEN
                    RAISE NOTICE 'ds_metrics chunk statistics job already scheduled';
                    RETURN;
                END IF;
                BEGIN
                    PERFORM add_job(
                        'public.job_ds_metrics_chunk_statistics',
                        INTERVAL '1 hour'
                    );
                    RAISE NOTICE 'scheduled ds_metrics chunk statistics job';
                EXCEPTION WHEN OTHERS THEN
                    RAISE WARNING 'could not schedule ds_metrics chunk statistics job: %', SQLERRM;
                END;
            END $$;
        `);

        // New chunks only; existing 7-day chunks keep their span.
        await queryRunner.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                    RETURN;
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM timescaledb_information.hypertables
                    WHERE hypertable_name = 'ds_metrics'
                ) THEN
                    RETURN;
                END IF;
                BEGIN
                    PERFORM set_chunk_time_interval('ds_metrics', INTERVAL '1 day');
                    RAISE NOTICE 'ds_metrics chunk_time_interval set to 1 day (new chunks only)';
                EXCEPTION WHEN OTHERS THEN
                    RAISE WARNING 'could not set chunk_time_interval on ds_metrics: %', SQLERRM;
                END;
            END $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            DECLARE
                rec record;
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                    RETURN;
                END IF;

                BEGIN
                    PERFORM delete_job(job_id)
                    FROM timescaledb_information.jobs
                    WHERE proc_name = 'job_ds_metrics_chunk_statistics';
                EXCEPTION WHEN OTHERS THEN
                    RAISE WARNING 'could not delete chunk statistics job: %', SQLERRM;
                END;

                -- Drop only the objects this migration owns. Matched by an exact
                -- join against ds_metrics' own chunks rather than a LIKE pattern:
                -- the names contain underscores, so a pattern needs backslash
                -- escaping that is easy to get wrong and silently matches nothing.
                -- This set is exactly what up() creates. Chunks dropped by
                -- retention take their statistics objects with them, so there is
                -- nothing to orphan.
                FOR rec IN
                    SELECT n.nspname AS schema_name, s.stxname AS stats_name
                    FROM timescaledb_information.chunks c
                    JOIN pg_namespace n ON n.nspname = c.chunk_schema
                    JOIN pg_statistic_ext s
                      ON s.stxnamespace = n.oid
                     AND s.stxname = c.chunk_name || '_groupkey'
                    WHERE c.hypertable_name = 'ds_metrics'
                LOOP
                    BEGIN
                        EXECUTE format('DROP STATISTICS %I.%I', rec.schema_name, rec.stats_name);
                    EXCEPTION WHEN OTHERS THEN
                        RAISE WARNING 'could not drop statistics %.%: %',
                            rec.schema_name, rec.stats_name, SQLERRM;
                    END;
                END LOOP;

                BEGIN
                    PERFORM set_chunk_time_interval('ds_metrics', INTERVAL '7 days');
                EXCEPTION WHEN OTHERS THEN
                    RAISE WARNING 'could not restore chunk_time_interval: %', SQLERRM;
                END;
            END $$;
        `);

        await queryRunner.query(`DROP PROCEDURE IF EXISTS public.job_ds_metrics_chunk_statistics(integer, jsonb)`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS public.ensure_ds_metrics_chunk_statistics()`);
    }
}
