import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fix the group-count misestimate that makes StatisticsPipeline's aggregation
 * spill to disk and run single-threaded.
 *
 * ── The problem ──────────────────────────────────────────────────────────────
 *
 * StatisticsPipeline groups ds_metrics by
 * (test_run_id, application_dashboard_id, panel_id, metric_name). Postgres has no
 * combined n_distinct for that tuple, so it derives one from the per-column
 * values and lands far too high: measured on production, an estimate of
 * 8,404,581 groups against 20,598 actual — 408x.
 *
 * That single number costs twice:
 *   - The planner sizes the hash table off it, decides a sort is cheaper, and
 *     spills. Measured: 20.6M rows as `external merge Disk: 5205304kB`.
 *     Raising AGGREGATION_WORK_MEM does NOT help — the decision is made on the
 *     ESTIMATE, not on what the aggregation actually needs.
 *   - It suppresses parallelism, because gathering millions of estimated rows
 *     looks expensive.
 *
 * ── The fix, and why it goes on the PARENT ───────────────────────────────────
 *
 * ONE statistics object on the hypertable parent, not one per chunk.
 *
 * This is the whole design decision, and getting it wrong makes the migration
 * silently do nothing. The real aggregation joins ds_metrics to the `run_orgs`
 * MATERIALIZED CTE and semi-joins `allowed_dashboards`. Those joins block
 * TimescaleDB's chunkwise-aggregation pushdown, so the plan carries a single
 * GroupAggregate ABOVE the joins rather than a Partial HashAggregate per chunk:
 *
 *     GroupAggregate                          <- estimate is made HERE
 *       Group Key: m.test_run_id, m.application_dashboard_id, m.panel_id, m.metric_name
 *       -> Sort
 *         -> Nested Loop                      <- run_orgs
 *           -> Hash Join                      <- allowed_dashboards
 *             -> Append (chunks)
 *
 * `estimate_num_groups` resolves those grouping Vars to the base relation, which
 * for a hypertable is the PARENT `public.ds_metrics`. Per-chunk statistics
 * objects are never consulted on this plan shape. A join-free query
 * (`SELECT dashboard, panel, metric, count(*) FROM ds_metrics WHERE test_run_id = ...`)
 * DOES get the per-chunk pushdown and DOES read per-chunk objects — which is
 * exactly how an earlier version of this migration came to target chunks. Do not
 * reintroduce that: measured on the real query, per-chunk objects left the
 * estimate at 741,991 against 17,882 actual, while this parent-level object
 * brought it to 21,372. Same query, same data, only the object moved.
 *
 * Needs PG15+ for `pg_statistic_ext_data.stxdinherit` (extended statistics across
 * an inheritance tree). The deploy image is timescaledb-ha:pg15. On an older
 * server the CREATE still succeeds but ANALYZE collects nothing for the tree, so
 * the migration degrades to a no-op rather than breaking.
 *
 * ── Why the scheduled ANALYZE ────────────────────────────────────────────────
 *
 * Autovacuum analyzes chunks, never the inheritance parent, so nothing else will
 * ever populate this object. Without the job the CREATE is inert. `add_job` runs
 * it as its owner, which also sidesteps the worker's perfana_system role having
 * no rights here.
 *
 * Daily, not hourly: ANALYZE on the parent samples across the whole inheritance
 * tree, so it is much heavier than a catalog check. n_distinct for this key moves
 * with how many dashboards/panels/metrics a deploy has, which changes on the
 * order of days, not minutes.
 *
 * The job deliberately does NOT run inline at migrate time. `add_job` schedules
 * its first run immediately (measured `next_start - now()` of -0.05s, and the
 * sweep completed within 10s), so an inline call buys nothing and costs
 * a lot: the production runner is Dockerfile.migrations -> runMigrations() with
 * no options (TypeORM's default transaction:'all'), so an ANALYZE there holds
 * locks until the whole batch commits, with the deploy waiting on it.
 *
 * ── Not included ─────────────────────────────────────────────────────────────
 *
 * An earlier draft also set chunk_time_interval 7 days -> 1 day. Split out: it is
 * unmeasured, it is a one-way ratchet for the chunks it creates (a revert
 * restores the setting, not the chunks), ds_metrics has NO retention policy so
 * chunk count would grow unbounded, and this deploy's background-worker pool is
 * already starved (21 `failed to start job` on the compression policy). See
 * TODOS.md.
 */
export class AddDsMetricsGroupKeyStatistics1801000000000 implements MigrationInterface {
    name = 'AddDsMetricsGroupKeyStatistics1801000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Remove the superseded per-chunk implementation. It never reached main,
        // but the branch was pushed, so a dev database may carry it — and the
        // class `name` changed, so this migration WILL run on such a database.
        // Leaving those behind would keep an hourly job creating objects that the
        // real query provably never reads.
        await queryRunner.query(`
            DO $$
            DECLARE rec record;
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                    BEGIN
                        PERFORM delete_job(job_id)
                        FROM timescaledb_information.jobs
                        WHERE proc_name = 'job_ds_metrics_chunk_statistics';
                    EXCEPTION WHEN OTHERS THEN
                        RAISE WARNING 'could not delete superseded per-chunk job: %', SQLERRM;
                    END;

                    FOR rec IN
                        SELECT n.nspname AS schema_name, s.stxname AS stats_name
                        FROM timescaledb_information.chunks c
                        JOIN pg_namespace n ON n.nspname = c.chunk_schema
                        JOIN pg_statistic_ext s
                          ON s.stxnamespace = n.oid
                         AND s.stxname = c.chunk_name || '_groupkey'
                        WHERE c.hypertable_name = 'ds_metrics'
                          AND c.hypertable_schema = 'public'
                    LOOP
                        BEGIN
                            EXECUTE format('DROP STATISTICS %I.%I', rec.schema_name, rec.stats_name);
                        EXCEPTION WHEN OTHERS THEN
                            RAISE WARNING 'could not drop superseded statistics %.%: %',
                                rec.schema_name, rec.stats_name, SQLERRM;
                        END;
                    END LOOP;
                END IF;
            END $$;
        `);
        await queryRunner.query(`DROP PROCEDURE IF EXISTS public.job_ds_metrics_chunk_statistics(integer, jsonb)`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS public.ensure_ds_metrics_chunk_statistics()`);

        // IF NOT EXISTS so a re-run is a no-op. Schema-qualified on both sides so
        // a same-named table in another schema cannot be picked up.
        await queryRunner.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relname = 'ds_metrics' AND n.nspname = 'public'
                ) THEN
                    RAISE WARNING 'public.ds_metrics not found, skipping statistics creation';
                    RETURN;
                END IF;

                CREATE STATISTICS IF NOT EXISTS public.ds_metrics_groupkey (ndistinct)
                    ON test_run_id, application_dashboard_id, panel_id, metric_name
                    FROM public.ds_metrics;
            END $$;
        `);

        // Populate it immediately for the object we just created, but ONLY when
        // that is cheap: on greenfield the table is empty, and this keeps a fresh
        // install from waiting a day for its first estimate. On a populated
        // database the scheduled job does it, off the deploy's critical path.
        await queryRunner.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM public.ds_metrics LIMIT 1) THEN
                    ANALYZE public.ds_metrics;
                    RAISE NOTICE 'ds_metrics is empty, analyzed inline';
                ELSE
                    RAISE NOTICE 'ds_metrics has rows; leaving ANALYZE to the scheduled job';
                END IF;
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING 'inline ANALYZE of ds_metrics skipped: %', SQLERRM;
            END $$;
        `);

        await queryRunner.query(`
            CREATE OR REPLACE PROCEDURE public.job_analyze_ds_metrics(
                job_id integer, config jsonb
            )
            LANGUAGE plpgsql
            AS $proc$
            BEGIN
                -- Populates ds_metrics_groupkey. Autovacuum analyzes chunks, never
                -- the inheritance parent, so without this the statistics object
                -- exists and holds nothing.
                ANALYZE public.ds_metrics;
            END $proc$;
        `);

        await queryRunner.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                    RAISE WARNING 'timescaledb not installed; ds_metrics_groupkey will not be '
                        'maintained. Schedule ANALYZE public.ds_metrics by other means.';
                    RETURN;
                END IF;
                IF EXISTS (
                    SELECT 1 FROM timescaledb_information.jobs
                    WHERE proc_name = 'job_analyze_ds_metrics'
                ) THEN
                    RAISE NOTICE 'ds_metrics ANALYZE job already scheduled';
                    RETURN;
                END IF;
                BEGIN
                    PERFORM add_job('public.job_analyze_ds_metrics', INTERVAL '1 day');
                    RAISE NOTICE 'scheduled daily ANALYZE of ds_metrics';
                EXCEPTION WHEN OTHERS THEN
                    -- Loud, because a swallowed failure here leaves the statistics
                    -- object permanently empty while CLAUDE.md says it is working.
                    RAISE WARNING 'could not schedule ds_metrics ANALYZE job (%). '
                        'ds_metrics_groupkey will stay empty until ANALYZE public.ds_metrics '
                        'runs by other means.', SQLERRM;
                END;
            END $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                    RETURN;
                END IF;
                BEGIN
                    PERFORM delete_job(job_id)
                    FROM timescaledb_information.jobs
                    WHERE proc_name = 'job_analyze_ds_metrics';
                EXCEPTION WHEN OTHERS THEN
                    RAISE WARNING 'could not delete ds_metrics ANALYZE job: %', SQLERRM;
                END;

                -- Refuse to drop the procedure while a job still points at it:
                -- the scheduler would fail hourly into job_errors with nothing
                -- explaining why. delete_job can fail invisibly, because
                -- timescaledb_information.jobs filters rows by ownership.
                IF EXISTS (
                    SELECT 1 FROM timescaledb_information.jobs
                    WHERE proc_name = 'job_analyze_ds_metrics'
                ) THEN
                    RAISE EXCEPTION 'ds_metrics ANALYZE job still scheduled after delete_job; '
                        'refusing to drop the procedure it calls. Remove it manually and re-run.';
                END IF;
            END $$;
        `);

        await queryRunner.query(`DROP PROCEDURE IF EXISTS public.job_analyze_ds_metrics(integer, jsonb)`);
        await queryRunner.query(`DROP STATISTICS IF EXISTS public.ds_metrics_groupkey`);
    }
}
