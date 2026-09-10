import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Enable TimescaleDB native compression + a 7-day compression policy on the
 * time-series hypertables. ds_metrics alone is ~70% of the DB and compresses
 * ~97% (measured), so this is a large storage win.
 *
 * segmentby = test_run_id: all rows for a run land in the same compressed
 * segments, which is the natural access + delete unit.
 *
 * That choice is what makes a force-refetch cheap, and only while the DELETE stays
 * on test_run_id ALONE. Adding a NON-segmentby predicate (metrics_source_id) forces
 * TimescaleDB to decompress the run's segments as DML and hit
 * timescaledb.max_tuples_decompressed_per_dml_transaction (default 100k): measured at
 * 162,743 ms / 11 GB WAL against 181 ms / 41 MB for the single-column form (#563).
 * WorkerDatabaseService.deletePerfTestMetricsForRun therefore preserves the rows that
 * must survive around a wholesale delete rather than narrowing the predicate, and the
 * force-refetch no longer decompresses at all. decompressChunksForRange survives for
 * StatisticsPipeline.refreshRampUpFlags, whose guard is on ramp_up (neither segmentby
 * nor orderby) and genuinely cannot avoid it.
 *
 * Idempotent: also runs on greenfield (after the consolidated migration creates
 * the hypertables) and re-runs safely on existing DBs.
 */
export class AddHypertableCompression1788000000000 implements MigrationInterface {
    name = 'AddHypertableCompression1788000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            DECLARE
                t text;
                tables text[] := ARRAY['ds_metrics','requests_raw','transactions','virtual_users','requests_error'];
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                    RAISE NOTICE 'timescaledb not installed, skipping compression setup';
                    RETURN;
                END IF;
                FOREACH t IN ARRAY tables LOOP
                    BEGIN
                        IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = t) THEN
                            EXECUTE format(
                                'ALTER TABLE %I SET (timescaledb.compress, timescaledb.compress_segmentby = %L, timescaledb.compress_orderby = %L)',
                                t, 'test_run_id', 'time DESC'
                            );
                            PERFORM add_compression_policy(t, INTERVAL '7 days', if_not_exists => true);
                            RAISE NOTICE 'compression enabled on %', t;
                        END IF;
                    EXCEPTION WHEN OTHERS THEN
                        RAISE WARNING 'could not enable compression on %: %', t, SQLERRM;
                    END;
                END LOOP;
            END $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            DECLARE
                t text;
                tables text[] := ARRAY['ds_metrics','requests_raw','transactions','virtual_users','requests_error'];
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                    RETURN;
                END IF;
                FOREACH t IN ARRAY tables LOOP
                    BEGIN
                        IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = t) THEN
                            PERFORM remove_compression_policy(t, if_exists => true);
                            -- must decompress every chunk before disabling compression
                            PERFORM decompress_chunk(c, if_compressed => true) FROM show_chunks(t::regclass) c;
                            EXECUTE format('ALTER TABLE %I SET (timescaledb.compress = false)', t);
                        END IF;
                    EXCEPTION WHEN OTHERS THEN
                        RAISE WARNING 'could not disable compression on %: %', t, SQLERRM;
                    END;
                END LOOP;
            END $$;
        `);
    }
}
