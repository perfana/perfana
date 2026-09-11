import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `compress_after` 7 days → 2 days on `ds_metrics`.
 *
 * This is the step that actually shrinks the row store. On 2026-09-11 production had
 * 227 GB of its 228 GB `ds_metrics` sitting uncompressed in the two open 7-day chunks
 * (10 older chunks: 97 GB → 1.15 GB, 85.8x) at ~16 GB/day of ingest. With 1-day chunks
 * (migration 1804) and a 2-day `compress_after` the uncompressed span is 2–3 days
 * (~32–48 GB; chunks are aligned to 00:00 UTC and qualify only once their range_end is
 * 2 days old); everything older sits at ~86x.
 *
 * ── What compression costs on the READ side (measured, TimescaleDB 2.28.3) ───────────
 *
 * `compress_segmentby = test_run_id` makes whole-run reads (the statistics aggregation,
 * ADAPT) as cheap on compressed data as on hot data. Per-series reads are NOT: the
 * orderby is `time DESC` only, so every 1000-row batch holds a few timestamps of EVERY
 * metric in the run and nothing can prune a batch by metric. Measured on a 94,810-row
 * compressed run against a row-store one: one series of one panel 7.9 ms (all 95
 * batches decompressed, 94,668 rows filtered out) vs 0.3 ms; the `getAvailableDashboards`
 * shape 179 ms with a 10 MB external sort vs 97 ms. Per row that is ~150x and ~10x,
 * linear in run size — roughly 200 ms per series on a 2.6 M-row run, 1 s on 12.8 M —
 * and a trends/compare card issues one such query per series. Before this migration that
 * cost applied to runs older than ~7.5 days; after it, to runs older than ~3 days. The
 * structural fix is an orderby that carries metric identity
 * (`application_dashboard_id, panel_id, metric_name, time DESC`), which only affects
 * chunks compressed after it lands — filed in TODOS.md, not part of this migration.
 *
 * Only `ds_metrics`. `requests_raw`/`transactions`/`requests_error` stay at 7 days on
 * purpose: their 15 continuous aggregates refresh with `start_offset` 7 days, chosen to
 * match `compress_after` so refreshes stay in row store (1799000000000-WidenCaggRefreshWindows).
 *
 * ── Precondition: migration 1804's decompress wrappers, PROVEN on the deploy ──────────
 *
 * Every WRITE to a run older than `compress_after` — the ramp-up `UPDATE` behind an
 * analysis-window change, the force-refetch upserts, the perf-test re-insert — needs
 * `decompressChunksForRange` to have decompressed first, and until 1804 that was a
 * silent no-op (`must be owner of hypertable`). Runs 2–7 days old are exactly the ones
 * people go back and re-tune, so shortening the window without working wrappers turns a
 * bug nobody hit into one everybody hits. This migration refuses to run if the wrappers
 * are absent. It cannot check that they WORK on this deploy: before merging, change the
 * analysis window on a run older than 7 days and confirm `Decompressing ds_metrics
 * chunk` in the worker log and a green statistics stage
 * (docs/superpowers/plans/2026-09-11-heavy-stage-mutex-rollout.md, Day 0–1).
 *
 * ── Timing ───────────────────────────────────────────────────────────────────────────
 *
 * `add_compression_policy` schedules its first run at `initial_start`, which defaults
 * to "now". The moment the policy exists, the previous 7-day chunk (~113 GB on that
 * deploy) qualifies and gets compressed in one `compress_chunk` call — hours of I/O and
 * WAL competing with whatever analysis is running. So `initial_start` is the next
 * 02:00 UTC, overridable with `DS_METRICS_COMPRESS_INITIAL_START` (ISO-8601) for a deploy
 * whose quiet window is elsewhere. A value in the past, without a time zone, or outside
 * years 1..9999 is rejected the same way as an unparseable one (falls back, with a
 * warning): a past `initial_start` runs on the scheduler's next tick, which is the
 * deploy-window compression the default exists to avoid. `schedule_interval` is 24 h, not
 * TimescaleDB's 12 h default: with `initial_start` fixing the cadence, 12 h would put the
 * second run at 14:00 UTC — a multi-GB compress, holding an ExclusiveLock on the chunk it
 * compresses, in European business hours. Chunks are 00:00-aligned, so a daily 02:00 run
 * loses nothing: the span stays 2–3 days.
 *
 * `down()` restores the 7-day policy; chunks already compressed stay compressed, which is
 * fine — the old policy would have compressed them a few days later anyway.
 */
export class ShortenDsMetricsCompressAfter1805000000000 implements MigrationInterface {
  name = 'ShortenDsMetricsCompressAfter1805000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const initialStart = ShortenDsMetricsCompressAfter1805000000000.resolveInitialStart(
      process.env.DS_METRICS_COMPRESS_INITIAL_START,
    );

    // TypeORM's default logging does not forward NOTICEs, so say it here too.
    console.log(`  ds_metrics compress_after -> 2 days; first policy run at ${initialStart}`);

    // initialStart is always Date#toISOString() output (digits, -, T, :, ., Z), so the
    // literal interpolation cannot carry anything else into the DO block.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
          RAISE NOTICE 'timescaledb not installed, skipping compress_after change';
          RETURN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'ds_metrics') THEN
          RAISE NOTICE 'ds_metrics is not a hypertable, skipping compress_after change';
          RETURN;
        END IF;
        -- Migration 1788 tolerates a build where compression could not be enabled (it is
        -- TSL-only); add_compression_policy would abort the whole batch there.
        IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'ds_metrics' AND compression_enabled) THEN
          RAISE NOTICE 'compression not enabled on ds_metrics, skipping compress_after change';
          RETURN;
        END IF;

        -- The worker must be able to decompress a run before it can rewrite it, and that
        -- only became true with migration 1804. Check the property that matters — the
        -- worker role can EXECUTE the wrapper — and refuse rather than widen the failure.
        IF NOT EXISTS (
          SELECT 1 FROM pg_proc WHERE proname = 'perfana_decompress_chunk' AND pronamespace = 'public'::regnamespace
        ) OR (
          EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'perfana_system')
          AND NOT has_function_privilege('perfana_system', 'public.perfana_decompress_chunk(regclass)', 'EXECUTE')
        ) THEN
          RAISE EXCEPTION 'perfana_decompress_chunk is missing or not executable by perfana_system: migration 1804 must run (and be proven on this deploy) before compress_after can be shortened';
        END IF;

        -- Replace, not keep: no if_not_exists, so a policy that somehow survived the remove
        -- errors instead of silently leaving compress_after at 7 days.
        PERFORM remove_compression_policy('ds_metrics', if_exists => true);
        PERFORM add_compression_policy(
          'ds_metrics',
          compress_after    => INTERVAL '2 days',
          schedule_interval => INTERVAL '24 hours',
          initial_start     => '${initialStart}'::timestamptz
        );
        RAISE NOTICE 'ds_metrics compress_after set to 2 days; first run at %', '${initialStart}';
      END $$;
    `);
  }

  /**
   * The next 02:00 UTC, or the operator's override. A static method rather than a module
   * export: the migration runner globs this directory and would try to instantiate a
   * loose exported function as a migration.
   *
   * An override must be ISO-8601 WITH a zone designator (V8 parses a zone-less value in
   * local time, so a laptop and the UTC container would disagree by hours), within
   * years 1..9999 (JS accepts extended years Postgres rejects), and in the future (a past
   * initial_start fires on the scheduler's next tick). Anything else falls back to the
   * default with a warning rather than aborting the deploy.
   */
  static resolveInitialStart(override: string | undefined, now: Date = new Date()): string {
    if (override) {
      const parsed = new Date(override);
      const isoWithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(override);
      if (isoWithZone && !Number.isNaN(parsed.getTime()) && parsed > now) {return parsed.toISOString();}
      console.warn(
        `  DS_METRICS_COMPRESS_INITIAL_START=${JSON.stringify(override)} ignored (needs ISO-8601 with a zone, in the future); using the next 02:00 UTC`,
      );
    }
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 0, 0));
    if (next <= now) {next.setUTCDate(next.getUTCDate() + 1);}
    return next.toISOString();
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
          RETURN;
        END IF;
        -- Mirrors up(): a hypertable without compression enabled has no policy to restore.
        IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'ds_metrics' AND compression_enabled) THEN
          PERFORM remove_compression_policy('ds_metrics', if_exists => true);
          PERFORM add_compression_policy('ds_metrics', INTERVAL '7 days');
        END IF;
      END $$;
    `);
  }
}
