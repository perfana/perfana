import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shorten the uncompressed window on the raw ingest hypertables, the way 1804 + 1805 did
 * for `ds_metrics`:
 *
 *   - `requests_raw`: `compress_after` 7 days → 2 days. Its `chunk_time_interval` is
 *     already 1 day (migration 1804).
 *   - `transactions`, `requests_error`: `chunk_time_interval` 7 days → 1 day (new chunks
 *     only, as 1804 did) AND `compress_after` 7 days → 2 days.
 *   - `virtual_users`: deliberately unchanged. ~12 MB on the deploy measured against
 *     184 MB for `requests_raw`; 1-day chunks would only compress it worse, because
 *     `compress_segmentby = test_run_id` needs rows per segment to earn its ratio.
 *   - The 15 continuous-aggregate refresh windows (1799, `start_offset` 7 days) are
 *     unchanged. See "The 7-day coupling" below — it is a performance coupling, and with
 *     live-only ingest it no longer binds.
 *
 * Measured row widths on the deploy (`pg_column_size` averaged over every row): 526 B for
 * `requests_raw`, 145 B for `transactions`, 1,140 B for `requests_error`. Whole-hypertable
 * compression ratios: 33.9x, 38.8x and 3.4x respectively — `requests_error` compresses
 * badly because it stores request/response headers, bodies and assertions, so it is the
 * one whose *uncompressed* window costs the most per row.
 *
 * Effect: data stays in the row store for at most ~3 days (chunks are 00:00-aligned and
 * qualify only once `range_end` is 2 days old) instead of 8 for `requests_raw` and 14 for
 * `transactions` / `requests_error`.
 *
 * ── The 7-day coupling that 1799 and 1805 both cite ──────────────────────────────────
 *
 * Both say `compress_after` on these tables must stay at 7 days to match the CAGG
 * `start_offset`, "so refreshes stay in the uncompressed region". That was written when the
 * JTL upload was the normal ingest path: a bundle arrives when the run finishes, so its
 * early buckets are invalidated hours or days after their timestamps and the refresh then
 * has to read back into the window. JTL upload is being retired and all ingest is now live
 * from the backend listener at ~now(), so a bucket is invalidated and materialised within
 * minutes of being written — long before its chunk reaches 2 days.
 *
 * The coupling is a PERFORMANCE one, not a correctness one, and it is worth being precise
 * about what is left of it: a CAGG refresh reads the raw hypertable, and reads of compressed
 * chunks work, they are just slower. So a late invalidation of a 3-to-7-day-old bucket still
 * refreshes correctly, it just reads compressed data to do it. What remains that can cause
 * one: a SUT import (`SUT_TRANSFER_ENABLED`, admin-only, default off) writes historical rows
 * at their original timestamps. That is now a read-back-into-compressed path rather than a
 * row-store one. It is slower and it is not a failure — INSERT into a compressed chunk is
 * supported (verified on this deploy's TimescaleDB 2.30.2 in a rolled-back transaction); the
 * new rows sit in the chunk's uncompressed region until the next policy run recompresses it.
 *
 * ── Why this needs no decompression plumbing, unlike `ds_metrics` ────────────────────
 *
 * 1805 refuses to run unless 1804's `perfana_decompress_chunk` wrapper is present, because
 * every write to an old `ds_metrics` run — the ramp-up `UPDATE`, the force-refetch upserts —
 * has to decompress first. These four tables have no such path, audited at the call sites:
 *
 *   - `decompressChunksForRange` is called from five places and every one passes
 *     `'ds_metrics'` (`PerformanceTestMetricsPipeline`, `StatisticsPipeline`,
 *     `PipelineOrchestrator`, and twice in `simple-orchestrate-reevaluate-batch`).
 *   - there is no `UPDATE` of any of the four anywhere in the tree.
 *   - every `DELETE` is `WHERE test_run_id = $1`, i.e. on `compress_segmentby` alone, which
 *     is segment-targeted and does not decompress (`delete-test-run.handler.ts`,
 *     `delete-system-under-test.handler.ts`, and the SUT import's purge-by-run). Migration
 *     1788 has the measurement for why that single-column form matters: 181 ms / 41 MB
 *     against 162,743 ms / 11 GB WAL once a non-segmentby predicate is added.
 *
 * 1804's `perfana_assert_compressible_chunk` already whitelists all five hypertables, so the
 * wrappers need no change either — they would simply work if a decompression path were ever
 * added here.
 *
 * ── Soak tests: `RAW_COMPRESS_AFTER` ────────────────────────────────────────────────
 *
 * A test longer than `compress_after` plus one chunk has its early chunks compressed while
 * it is still running, and the live statistics pass then re-reads compressed data on every
 * tick. Correct, slower. `RAW_COMPRESS_AFTER` (e.g. `'4 days'`) raises the window for a
 * deploy that runs multi-day soaks: **set it above your longest test.** Accepted values are
 * a whole number of hours or days (`'36 hours'`, `'2 days'`); anything else falls back to
 * the default with a warning rather than aborting the deploy, and the value is re-validated
 * against a strict pattern before it reaches SQL because it is interpolated as a literal.
 *
 * ── Timing: 03:00 UTC, not 02:00 ────────────────────────────────────────────────────
 *
 * The first run of each policy compresses that table's whole 2-to-7-day backlog in one
 * `compress_chunk` call per chunk, so `initial_start` is off-peak and `schedule_interval` is
 * 24 h, exactly as 1805 argued for `ds_metrics`.
 *
 * It is **03:00** UTC here, an hour after 1805's 02:00, on purpose: 1805 put `ds_metrics` —
 * by far the largest table — at 02:00, and firing three more backlog compressions in the
 * same hour on a deploy that applies both migrations together would stack four multi-GB
 * compressions, each holding an ExclusiveLock on the chunk it writes. Overlapping that with
 * the analysis `DELETE FROM ds_metrics` is what the 238,643 ms lock-wait incident looked
 * like (root `CLAUDE.md` issue #39: the DELETE carries no `time` predicate, so it waits on
 * every chunk of the hypertable, and its duration is uncorrelated with its row count).
 * Override with `RAW_COMPRESS_INITIAL_START` (ISO-8601 with a zone, in the future).
 *
 * ── Locks: the floor is a product, and lowering `max_connections` lowers it ──────────
 *
 * 1804 warned when `max_locks_per_transaction < 256`. That number alone is not the budget:
 * the shared lock table holds `max_locks_per_transaction × (max_connections +
 * max_prepared_transactions)` entries, and a transaction may exceed 256 on its own as long
 * as the table has room. This migration therefore warns on the product.
 *
 * Measured on the deploy: a `SELECT ... WHERE test_run_id = $1` with no time predicate on
 * `requests_raw` (12 chunks) took **136** relation locks, and a two-table join with
 * `transactions` (21 chunks total) took **230** — about **11 locks per chunk**, because each
 * chunk brings its compressed twin and the indexes on both, not one lock each.
 *
 * Daily chunks and no retention policy on any raw hypertable means ~365 chunks per table per
 * year. Projected a year out at 11 locks/chunk: ~4,015 locks per table, so ~8,030 for the
 * two-table run query above and ~16,060 for one touching all four daily-chunked tables.
 * Against the deploy's 256 × (500 + 0) = 128,000 entries that is comfortable. At
 * `max_connections = 100` — a reasonable memory-protection setting on Kubernetes/OpenShift —
 * the table is 25,600 entries and three concurrent year-old join queries exhaust it, which
 * is the counterintuitive part: **lowering `max_connections` shrinks the lock table.**
 *
 * `down()` restores 7-day chunk intervals and 7-day compression policies. Chunks already
 * compressed stay compressed (the old policy would have reached them days later anyway) and
 * 1-day chunks already created keep their range — `set_chunk_time_interval` only affects
 * chunks created after it.
 */
export class ShortenRawIngestCompression1815000000000 implements MigrationInterface {
  name = 'ShortenRawIngestCompression1815000000000';

  /** Every table whose `compress_after` this migration shortens. */
  private static readonly COMPRESS_TABLES = ['requests_raw', 'transactions', 'requests_error'];

  /** Only the two that are still on 7-day chunks; `requests_raw` got 1-day chunks in 1804. */
  private static readonly RECHUNK_TABLES = ['transactions', 'requests_error'];

  /** Measured on the deploy: ~11 relation locks per chunk (chunk + compressed twin + indexes). */
  private static readonly LOCKS_PER_CHUNK = 11;

  /** Daily chunks, and none of these tables has a retention policy. */
  private static readonly PROJECTED_CHUNKS_PER_YEAR = 365;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const compressAfter = ShortenRawIngestCompression1815000000000.resolveCompressAfter(
      process.env.RAW_COMPRESS_AFTER,
    );
    const initialStart = ShortenRawIngestCompression1815000000000.resolveInitialStart(
      process.env.RAW_COMPRESS_INITIAL_START,
    );

    // TypeORM's default logging does not forward NOTICEs, so say it here too.
    console.log(
      `  raw ingest compress_after -> ${compressAfter} (requests_raw, transactions, requests_error);` +
        ` 1-day chunks on transactions + requests_error; first policy run at ${initialStart}`,
    );

    // Both interpolated values are validated above and can only be a digits+unit interval or
    // Date#toISOString() output, so neither can carry anything else into the DO block.
    await queryRunner.query(`
      DO $$
      DECLARE
        t text;
        lock_capacity bigint;
        projected_locks bigint;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
          RAISE NOTICE 'timescaledb not installed, skipping raw ingest compression change';
          RETURN;
        END IF;

        -- set_chunk_time_interval checks for the hypertable owner. Fail loudly rather than
        -- record the migration as applied with the chunks still at 7 days.
        FOREACH t IN ARRAY ARRAY['transactions', 'requests_error'] LOOP
          IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = t)
             AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
             AND NOT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = format('public.%I', t)::regclass), 'MEMBER') THEN
            RAISE EXCEPTION 'migration 1815 must run as the owner of % (%) or a superuser, not %',
              t,
              (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = format('public.%I', t)::regclass),
              current_user;
          END IF;
        END LOOP;

        -- 1. chunk_time_interval 7 days -> 1 day. New chunks only; the open chunk keeps its
        --    7-day range until it closes, exactly as 1804 behaved.
        FOREACH t IN ARRAY ARRAY['transactions', 'requests_error'] LOOP
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

        -- 2. compress_after 7 days -> ${compressAfter} on the three ingest tables.
        FOREACH t IN ARRAY ARRAY['requests_raw', 'transactions', 'requests_error'] LOOP
          IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = t) THEN
            RAISE NOTICE '% is not a hypertable, skipping its compress_after change', t;
            CONTINUE;
          END IF;
          -- Migration 1788 tolerates a build where compression could not be enabled (it is
          -- TSL-only); add_compression_policy would abort the whole batch there.
          IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = t AND compression_enabled) THEN
            RAISE NOTICE 'compression not enabled on %, skipping its compress_after change', t;
            CONTINUE;
          END IF;

          -- Replace, not keep: no if_not_exists, so a policy that somehow survived the remove
          -- errors instead of silently leaving compress_after at 7 days.
          PERFORM remove_compression_policy(t::regclass, if_exists => true);
          PERFORM add_compression_policy(
            t::regclass,
            compress_after    => INTERVAL '${compressAfter}',
            schedule_interval => INTERVAL '24 hours',
            initial_start     => '${initialStart}'::timestamptz
          );
          RAISE NOTICE '% compress_after set to ${compressAfter}; first run at %', t, '${initialStart}';
        END LOOP;

        -- 3. Lock budget. The shared table is max_locks_per_transaction x (max_connections +
        --    max_prepared_transactions); a single transaction may exceed the per-transaction
        --    figure while the table has room, so the product is what matters. Four tables now
        --    accumulate ~365 daily chunks a year with no retention policy, and a run query
        --    carries no time predicate, so it locks every chunk plus its compressed twin plus
        --    their indexes — measured at ~11 locks per chunk on this deploy.
        lock_capacity := current_setting('max_locks_per_transaction')::bigint
                         * (current_setting('max_connections')::bigint
                            + current_setting('max_prepared_transactions')::bigint);
        projected_locks := 2 * ${ShortenRawIngestCompression1815000000000.PROJECTED_CHUNKS_PER_YEAR}
                           * ${ShortenRawIngestCompression1815000000000.LOCKS_PER_CHUNK};
        IF lock_capacity < projected_locks * 8 THEN
          RAISE WARNING 'lock table holds % entries (max_locks_per_transaction % x max_connections %). A two-table run query with no time predicate is projected at ~% locks after a year of 1-day chunks, so fewer than 8 can run concurrently. Raise max_locks_per_transaction (restart required) — and note that LOWERING max_connections shrinks this table.',
            lock_capacity,
            current_setting('max_locks_per_transaction'),
            current_setting('max_connections'),
            projected_locks;
        END IF;
        IF current_setting('max_locks_per_transaction')::int < 256 THEN
          RAISE WARNING 'max_locks_per_transaction is % — 1804 asked for 256+ when ds_metrics and requests_raw went to 1-day chunks, and this migration adds two more such tables',
            current_setting('max_locks_per_transaction');
        END IF;
      END $$;
    `);
  }

  /**
   * The `compress_after` interval. A whole number of hours or days only.
   *
   * Interpolated into the DO block as a literal, so the pattern is the guard, not a
   * convenience: it is anchored, allows no quotes, and bounds the magnitude. A fractional,
   * zero, negative, differently-worded (`'1 week'`) or oversized value falls back to the
   * default with a warning rather than aborting the deploy — the same posture 1805 takes
   * for a bad `initial_start`.
   *
   * A static method rather than a module export: the migration runner globs this directory
   * and would try to instantiate a loose exported function as a migration.
   */
  static resolveCompressAfter(override: string | undefined, defaultValue = '2 days'): string {
    if (override) {
      const match = /^(\d{1,4}) (hours?|days?)$/.exec(override.trim());
      const amount = match ? Number(match[1]) : 0;
      // 365 days is already far past any soak test and keeps the row store bounded.
      const withinRange = match && amount >= 1 && (match[2]!.startsWith('day') ? amount <= 365 : amount <= 8760);
      if (withinRange) {
        return `${amount} ${match![2]}`;
      }
      console.warn(
        `  RAW_COMPRESS_AFTER=${JSON.stringify(override)} ignored (needs a whole number of hours or days, e.g. "4 days"); using ${defaultValue}`,
      );
    }
    return defaultValue;
  }

  /**
   * The next 03:00 UTC, or the operator's override — an hour after 1805's 02:00 so a deploy
   * applying both does not stack four backlog compressions in one hour.
   *
   * An override must be ISO-8601 WITH a zone designator (V8 parses a zone-less value in
   * local time, so a laptop and the UTC container would disagree by hours), within
   * years 1..9999 (JS accepts extended years Postgres rejects), and in the future (a past
   * initial_start fires on the scheduler's next tick, which is the deploy-window
   * compression the default exists to avoid).
   */
  static resolveInitialStart(override: string | undefined, now: Date = new Date()): string {
    if (override) {
      const parsed = new Date(override);
      const isoWithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(override);
      if (isoWithZone && !Number.isNaN(parsed.getTime()) && parsed > now) {return parsed.toISOString();}
      console.warn(
        `  RAW_COMPRESS_INITIAL_START=${JSON.stringify(override)} ignored (needs ISO-8601 with a zone, in the future); using the next 03:00 UTC`,
      );
    }
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0));
    if (next <= now) {next.setUTCDate(next.getUTCDate() + 1);}
    return next.toISOString();
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        t text;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
          RETURN;
        END IF;

        -- Restores the setting for future chunks only; 1-day chunks already created stay.
        FOREACH t IN ARRAY ARRAY['transactions', 'requests_error'] LOOP
          BEGIN
            IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = t) THEN
              PERFORM set_chunk_time_interval(t::regclass, INTERVAL '7 days');
            END IF;
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'could not restore chunk_time_interval on %: %', t, SQLERRM;
          END;
        END LOOP;

        -- Mirrors up(): a hypertable without compression enabled has no policy to restore.
        FOREACH t IN ARRAY ARRAY['requests_raw', 'transactions', 'requests_error'] LOOP
          IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = t AND compression_enabled) THEN
            PERFORM remove_compression_policy(t::regclass, if_exists => true);
            PERFORM add_compression_policy(t::regclass, INTERVAL '7 days');
          END IF;
        END LOOP;
      END $$;
    `);
  }
}
