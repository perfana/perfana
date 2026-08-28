-- Perfana continuous-aggregate refresh diagnostic — READ ONLY.
--
-- Run this when test run details feels slow and nothing is in the logs. That
-- symptom has no error attached to it: the 5s CAGGs are REAL-TIME aggregates,
-- so a window the refresh policy never materialised does not return zeros and
-- does not fail. The query silently unions the materialised part with a live
-- aggregation over the raw hypertable, and the page just crawls.
--
-- Three independent things have to be true for a run's window to be fast.
-- This script checks all three and names which one is broken:
--   1. Postgres has enough worker processes for the scheduler to launch jobs
--   2. the refresh policies have a start_offset long enough to reach the run
--   3. the run's window is actually below the CAGG watermark
--
-- Pure SQL: no psql backslash commands, so it also runs in the VS Code
-- PostgreSQL extension, pgAdmin, DBeaver, etc. Section headers are SELECTs.
--
-- psql (best for sharing — one text file):
--   psql "$DB_URL" -X -f cagg-refresh-diagnostic.sql > cagg-diag.txt 2>&1
--   docker exec -i <pg-container> psql -U perfana -d perfana -X < cagg-refresh-diagnostic.sql > cagg-diag.txt 2>&1
--
-- Do NOT pass -v ON_ERROR_STOP=1 (psql) / stop-on-error (GUI). Sections are
-- deliberately independent so a missing view (no TimescaleDB, different TS
-- version) skips that block instead of killing the run. An "ERROR: relation
-- ... does not exist" is information — keep it when sharing.
--
-- Everything is SELECT / catalog reads: no writes, AccessShare locks only.

SET statement_timeout = '120s';
SET lock_timeout = '5s';

SELECT '================ 1. VERSION ================' AS section;
SELECT version();
SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';

SELECT '================ 2. WORKER BUDGET (cause #1) ================' AS section;
-- TimescaleDB needs max_worker_processes >= max_background_workers + max_parallel_workers + 1.
-- Under that, the scheduler loses the race for a slot, logs "failed to start a
-- background worker", and the refresh policies below never actually run --
-- no matter how wide their start_offset is.
SELECT
  current_setting('max_worker_processes')::int                AS max_worker_processes,
  current_setting('timescaledb.max_background_workers')::int  AS ts_background_workers,
  current_setting('max_parallel_workers')::int                AS max_parallel_workers,
  current_setting('timescaledb.max_background_workers')::int
    + current_setting('max_parallel_workers')::int + 1        AS required_minimum,
  CASE
    WHEN current_setting('max_worker_processes')::int
         >= current_setting('timescaledb.max_background_workers')::int
            + current_setting('max_parallel_workers')::int + 1
    THEN 'OK'
    ELSE 'TOO LOW -- refresh jobs cannot get a worker; fix this first'
  END AS verdict;

SELECT '================ 3. IS THE MIGRATION EVEN DEPLOYED? ================' AS section;
-- If this returns no rows the v0.2.84.0 migration never ran here. A common
-- cause is an image built from a tree with a stale packages/shared/dist, which
-- silently omits migrations rather than failing.
SELECT id, timestamp, name
FROM typeorm_migrations
WHERE name LIKE '%WidenCaggRefreshWindows%'
ORDER BY timestamp DESC;

SELECT '--- last 5 migrations applied (for context) ---' AS note;
SELECT id, timestamp, name FROM typeorm_migrations ORDER BY id DESC LIMIT 5;

SELECT '================ 4. REFRESH POLICY WINDOWS (cause #2) ================' AS section;
-- Post-v0.2.84.0 every start_offset should read "7 days". A "01:00:00" here
-- means the migration did not take effect on this database.
SELECT
  j.hypertable_name,
  j.config ->> 'start_offset' AS start_offset,
  j.config ->> 'end_offset'   AS end_offset,
  j.schedule_interval,
  CASE WHEN (j.config ->> 'start_offset') = '7 days'
       THEN 'OK' ELSE 'NOT WIDENED' END AS verdict
FROM timescaledb_information.jobs j
WHERE j.proc_name = 'policy_refresh_continuous_aggregate'
ORDER BY j.hypertable_name;

SELECT '================ 5. ARE THE REFRESH JOBS ACTUALLY RUNNING? ================' AS section;
-- total_failures climbing with last_run_status = Failed is the signature of
-- the worker starvation in section 2. last_successful_finish far in the past
-- means nothing has been materialised since then.
SELECT
  j.job_id,
  j.hypertable_name,
  s.last_run_status,
  s.last_successful_finish,
  s.total_runs,
  s.total_failures,
  s.total_successes
FROM timescaledb_information.jobs j
LEFT JOIN timescaledb_information.job_stats s USING (job_id)
WHERE j.proc_name = 'policy_refresh_continuous_aggregate'
ORDER BY s.total_failures DESC NULLS LAST, j.hypertable_name;

SELECT '================ 6. CAGG WATERMARKS (cause #3) ================' AS section;
-- The watermark is the boundary: buckets at or above it are NOT materialised
-- and are served by a live scan of the raw hypertable on every query.
-- to_timestamp(watermark / 1e6) avoids the version-specific helper function.
SELECT
  ca.user_view_name,
  to_timestamp(w.watermark / 1000000.0)                       AS watermark,
  now() - to_timestamp(w.watermark / 1000000.0)               AS watermark_age,
  CASE WHEN to_timestamp(w.watermark / 1000000.0) < now() - interval '1 hour'
       THEN 'STALE -- anything newer than the watermark is a raw scan'
       ELSE 'current' END                                     AS verdict
FROM _timescaledb_catalog.continuous_agg ca
JOIN _timescaledb_catalog.continuous_aggs_watermark w USING (mat_hypertable_id)
WHERE ca.user_view_name LIKE '%\_5s'
ORDER BY ca.user_view_name;

SELECT '================ 7. RECENT RUNS: MATERIALISED OR NOT? ================' AS section;
-- This is the answer to "why is THIS run slow". A run whose window sits at or
-- above the requests_raw_5s watermark re-aggregates the raw hypertable on
-- every page load. Runs older than the 7-day refresh window are expected to
-- show NOT MATERIALISED until backfilled by hand -- that is a known gap, not
-- a regression.
SELECT
  tr.test_run_id,
  s.name AS system_under_test,
  tr.test_environment,
  tr.duration AS duration_s,
  tr.start_time,
  tr.end_time,
  CASE
    WHEN tr.end_time IS NULL OR tr.start_time IS NULL THEN 'in flight / no window'
    WHEN tr.end_time   <= wm.ts THEN 'materialised (fast)'
    WHEN tr.start_time >= wm.ts THEN 'NOT MATERIALISED -- raw scan every load'
    ELSE 'PARTIAL -- tail is a raw scan'
  END AS cagg_status,
  CASE WHEN tr.start_time < now() - interval '7 days'
       THEN 'older than the refresh window -- needs a manual backfill'
       ELSE '' END AS note
FROM test_runs tr
JOIN systems_under_test s ON s.id = tr.system_under_test_id
CROSS JOIN LATERAL (
  SELECT to_timestamp(w.watermark / 1000000.0) AS ts
  FROM _timescaledb_catalog.continuous_agg ca
  JOIN _timescaledb_catalog.continuous_aggs_watermark w USING (mat_hypertable_id)
  WHERE ca.user_view_name = 'requests_raw_5s'
) wm
WHERE tr.start_time IS NOT NULL
ORDER BY tr.start_time DESC
LIMIT 25;

SELECT '================ 8. LONGEST RUNS (the ones that hurt most) ================' AS section;
-- A run longer than the old 1-hour start_offset could never be fully covered.
-- These are the runs where the raw-scan fallback costs the most.
SELECT
  tr.test_run_id,
  s.name AS system_under_test,
  tr.duration AS duration_s,
  round(tr.duration / 3600.0, 2) AS duration_h,
  tr.start_time
FROM test_runs tr
JOIN systems_under_test s ON s.id = tr.system_under_test_id
WHERE tr.duration IS NOT NULL
ORDER BY tr.duration DESC
LIMIT 15;
