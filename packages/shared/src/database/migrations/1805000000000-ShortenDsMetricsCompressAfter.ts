import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `compress_after` 7 days → 2 days on `ds_metrics`.
 *
 * This is the step that actually shrinks the row store. On 2026-09-11 production had
 * 227 GB of its 228 GB `ds_metrics` sitting uncompressed in the two open 7-day chunks
 * (10 older chunks: 97 GB → 1.15 GB, 85.8x) at ~16 GB/day of ingest. With 1-day chunks
 * (migration 1804) and a 2-day `compress_after` the uncompressed span is 2–2.5 days
 * (~32–40 GB); everything older sits at ~86x. Reads by `test_run_id` are unaffected —
 * it is the `compress_segmentby` column — so the statistics fast path, the panel render
 * and ADAPT see compressed data exactly as they see hot data.
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
 * whose quiet window is elsewhere. The 12 h `schedule_interval` is TimescaleDB's default
 * for this policy, kept explicit; it is what makes the span 2–2.5 days rather than 2–3.
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

    await queryRunner.query(
      `
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

        -- The worker must be able to decompress a run before it can rewrite it, and that
        -- only became true with migration 1804. Refuse rather than widen the failure.
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'perfana_decompress_chunk') THEN
          RAISE EXCEPTION 'perfana_decompress_chunk is missing: migration 1804 must run (and be proven on this deploy) before compress_after can be shortened';
        END IF;

        PERFORM remove_compression_policy('ds_metrics', if_exists => true);
        PERFORM add_compression_policy(
          'ds_metrics',
          compress_after    => INTERVAL '2 days',
          schedule_interval => INTERVAL '12 hours',
          initial_start     => $1::timestamptz,
          if_not_exists     => true
        );
        RAISE NOTICE 'ds_metrics compress_after set to 2 days; first run at %', $1;
      END $$;
      `.replace(/\$1/g, `'${initialStart}'`),
    );
  }

  /**
   * The next 02:00 UTC, or the operator's override. A static method rather than a module
   * export: the migration runner globs this directory and would try to instantiate a
   * loose exported function as a migration. A value that is not a valid timestamp falls
   * back to the default rather than aborting a deploy.
   */
  static resolveInitialStart(override: string | undefined, now: Date = new Date()): string {
    if (override) {
      const parsed = new Date(override);
      if (!Number.isNaN(parsed.getTime())) {return parsed.toISOString();}
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
        IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'ds_metrics') THEN
          PERFORM remove_compression_policy('ds_metrics', if_exists => true);
          PERFORM add_compression_policy('ds_metrics', INTERVAL '7 days', if_not_exists => true);
        END IF;
      END $$;
    `);
  }
}
