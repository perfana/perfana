import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two things production needed on 2026-09-11, when `ds_metrics` was 228 GB on disk of
 * which 227 GB sat in its two open, uncompressed 7-day chunks (10 older chunks: 97 GB
 * → 1.15 GB, 85.8x). Ingest had grown to ~16 GB/day against a `shared_buffers` of 4 GB.
 *
 * 1. **`chunk_time_interval` 7 days → 1 day on `ds_metrics` and `requests_raw`.** Only
 *    chunks created from now on are affected; the open chunk keeps its 7-day range until
 *    it closes. A run's aggregation scan then reads a ~16 GB chunk instead of ~113 GB,
 *    and `decompressChunksForRange` converts one day of other runs to row store instead
 *    of a week. Deliberately NOT shortening `compress_after` here — see the TODO at the
 *    bottom.
 *
 *    Chunk count grows 7x and `ds_metrics` has no retention policy, so ~365 chunks a
 *    year, each with a compressed twin. Every hot query filters on `test_run_id` with no
 *    time predicate and therefore locks every chunk; the lock table is
 *    `max_locks_per_transaction` × `max_connections`, and the default 64 is not sized
 *    for that. docker-compose.infra.yml raises it to 256; a deploy running its own
 *    Postgres has to as well (restart required). A revert restores the setting, not
 *    the chunks it created.
 *
 * 2. **`SECURITY DEFINER` wrappers around `decompress_chunk` / `compress_chunk`.** The
 *    worker connects as `perfana_system`, which does not own the hypertables, and
 *    TimescaleDB refuses both calls with `must be owner of hypertable "ds_metrics"`.
 *    Every `decompressChunksForRange` since v0.2.93.2 has therefore been a silent no-op
 *    (logged as `skipped`), and the ramp-up `UPDATE` it exists to protect ran as DML on
 *    the compressed chunk and hit `tuple decompression limit exceeded` on any run past
 *    100k rows older than `compress_after`. Verified 2026-09-10 with rolled-back
 *    experiments; the wrappers were the fix that worked. They are owned by whoever runs
 *    this migration — the hypertable owner — and `EXECUTE` is granted to
 *    `perfana_system` only.
 *
 * Both halves are idempotent and skip cleanly when TimescaleDB, the hypertable, or the
 * role is absent, so this runs on greenfield (after the consolidated migration) and on
 * existing databases alike.
 *
 * TODO once this has been verified on production (an analysis-window change on a run
 * older than 7 days must succeed): `compress_after` 7 days → 2 days on `ds_metrics`,
 * with `initial_start` in a quiet hour — the previous 113 GB chunk qualifies at once
 * and takes hours to compress. That is the step that turns the 227 GB into ~40 GB.
 */
export class ChunkIntervalAndChunkCompressionWrappers1804000000000 implements MigrationInterface {
  name = 'ChunkIntervalAndChunkCompressionWrappers1804000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        t text;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
          RAISE NOTICE 'timescaledb not installed, skipping chunk interval + wrappers';
          RETURN;
        END IF;

        -- Both halves need the hypertable OWNER (or a superuser): set_chunk_time_interval
        -- checks it, and a SECURITY DEFINER wrapper only helps if its definer passes the
        -- same check inside decompress_chunk. Fail loudly rather than record the migration
        -- as applied with the chunks still at 7 days and the wrappers refusing every call.
        IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'ds_metrics')
           AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
           AND NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = 'public.ds_metrics'::regclass), 'MEMBER') THEN
          RAISE EXCEPTION 'migration 1804 must run as the owner of ds_metrics (%) or a superuser, not %',
            (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.ds_metrics'::regclass), current_user;
        END IF;

        FOREACH t IN ARRAY ARRAY['ds_metrics', 'requests_raw'] LOOP
          BEGIN
            IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = t) THEN
              PERFORM set_chunk_time_interval(t::regclass, INTERVAL '1 day');
              RAISE NOTICE 'chunk_time_interval set to 1 day on %', t;
            END IF;
          EXCEPTION
            WHEN insufficient_privilege THEN RAISE;
            WHEN OTHERS THEN RAISE WARNING 'could not set chunk_time_interval on %: %', t, SQLERRM;
          END;
        END LOOP;

        -- 1-day chunks with no retention policy: every test_run_id-only query locks every
        -- chunk plus its compressed twin, and the lock table is max_locks_per_transaction x
        -- max_connections. Warn here so a self-hosted Postgres hears it at migration time.
        IF current_setting('max_locks_per_transaction')::int < 256 THEN
          RAISE WARNING 'max_locks_per_transaction is % — raise it to 256+ (restart required) before ds_metrics accumulates a few hundred 1-day chunks, or queries fail with "out of shared memory"',
            current_setting('max_locks_per_transaction');
        END IF;

        -- Owned by the migration role, i.e. the hypertable owner. search_path is pinned
        -- because SECURITY DEFINER functions resolve names as the owner, and the argument
        -- is checked against the five compressed public hypertables so the grant does not
        -- hand perfana_system owner-level compress/decompress over every hypertable.
        CREATE OR REPLACE FUNCTION public.perfana_assert_compressible_chunk(chunk regclass) RETURNS void
          LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
          AS $fn$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM timescaledb_information.chunks c
              WHERE format('%I.%I', c.chunk_schema, c.chunk_name)::regclass = chunk
                AND c.hypertable_schema = 'public'
                AND c.hypertable_name IN ('ds_metrics','requests_raw','transactions','virtual_users','requests_error')
            ) THEN
              RAISE EXCEPTION '% is not a chunk of a Perfana compressed hypertable', chunk;
            END IF;
          END
          $fn$;
        CREATE OR REPLACE FUNCTION public.perfana_decompress_chunk(chunk regclass) RETURNS regclass
          LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
          AS 'SELECT perfana_assert_compressible_chunk(chunk); SELECT decompress_chunk(chunk, if_compressed => true)';
        CREATE OR REPLACE FUNCTION public.perfana_compress_chunk(chunk regclass) RETURNS regclass
          LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
          AS 'SELECT perfana_assert_compressible_chunk(chunk); SELECT compress_chunk(chunk, if_not_compressed => true)';

        -- The consolidated migration's ALTER DEFAULT PRIVILEGES hands EXECUTE on every new
        -- function to perfana_app too; the API has no business rewriting chunks.
        REVOKE ALL ON FUNCTION public.perfana_decompress_chunk(regclass) FROM PUBLIC;
        REVOKE ALL ON FUNCTION public.perfana_compress_chunk(regclass) FROM PUBLIC;
        REVOKE ALL ON FUNCTION public.perfana_assert_compressible_chunk(regclass) FROM PUBLIC;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'perfana_app') THEN
          REVOKE ALL ON FUNCTION public.perfana_decompress_chunk(regclass) FROM perfana_app;
          REVOKE ALL ON FUNCTION public.perfana_compress_chunk(regclass) FROM perfana_app;
          REVOKE ALL ON FUNCTION public.perfana_assert_compressible_chunk(regclass) FROM perfana_app;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'perfana_system') THEN
          GRANT EXECUTE ON FUNCTION public.perfana_decompress_chunk(regclass) TO perfana_system;
          GRANT EXECUTE ON FUNCTION public.perfana_compress_chunk(regclass) TO perfana_system;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        t text;
      BEGIN
        DROP FUNCTION IF EXISTS public.perfana_decompress_chunk(regclass);
        DROP FUNCTION IF EXISTS public.perfana_compress_chunk(regclass);
        DROP FUNCTION IF EXISTS public.perfana_assert_compressible_chunk(regclass);

        IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
          RETURN;
        END IF;
        -- Restores the setting for future chunks only; 1-day chunks already created stay.
        FOREACH t IN ARRAY ARRAY['ds_metrics', 'requests_raw'] LOOP
          BEGIN
            IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = t) THEN
              PERFORM set_chunk_time_interval(t::regclass, INTERVAL '7 days');
            END IF;
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'could not restore chunk_time_interval on %: %', t, SQLERRM;
          END;
        END LOOP;
      END $$;
    `);
  }
}
