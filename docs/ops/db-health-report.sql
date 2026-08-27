-- Perfana production DB health report — READ ONLY.
-- Pure SQL: no psql backslash commands, so it also runs in the VS Code
-- PostgreSQL extension, pgAdmin, DBeaver, etc. Section headers are SELECTs.
--
-- psql (best for sharing — one text file):
--   psql "$DB_URL" -X -f db-health-report.sql > db-health.txt 2>&1
--   docker exec -i <pg-container> psql -U perfana -d perfana -X < db-health-report.sql > db-health.txt 2>&1
--
-- VS Code (ms-ossdata.vscode-pgsql): open this file, pick the connection in
-- the status bar, select all (Cmd+A) and Run. Each statement returns its own
-- result grid; use the grid's save/export button per section, or just run the
-- psql command above if you want the whole thing in one file.
--
-- Do NOT pass -v ON_ERROR_STOP=1 (psql) / stop-on-error (GUI). Sections are
-- deliberately independent so a missing view (no TimescaleDB, different TS
-- version, no pg_stat_statements) skips that block instead of killing the run.
-- An "ERROR: relation ... does not exist" is information — keep it when sharing.
--
-- Everything is SELECT / catalog reads: no writes, AccessShare locks only.

SET statement_timeout = '120s';
SET lock_timeout = '5s';

SELECT '================ 1. SERVER / DATABASE ================' AS section;
SELECT version();

SELECT current_database() AS db,
       pg_size_pretty(pg_database_size(current_database())) AS db_size,
       (SELECT count(*) FROM pg_stat_activity) AS backends,
       date_trunc('second', now() - pg_postmaster_start_time()) AS uptime,
       now() AS report_time;

SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size
FROM pg_database WHERE datistemplate = false ORDER BY pg_database_size(datname) DESC;

SELECT extname, extversion FROM pg_extension ORDER BY extname;

SELECT '---- relevant settings ----' AS section;
SELECT name, setting, unit, source
FROM pg_settings
WHERE name IN (
  'shared_buffers','effective_cache_size','work_mem','maintenance_work_mem',
  'max_connections','max_worker_processes','max_parallel_workers',
  'autovacuum','autovacuum_max_workers','autovacuum_vacuum_scale_factor',
  'autovacuum_analyze_scale_factor','autovacuum_naptime',
  'wal_level','max_wal_size','min_wal_size','checkpoint_timeout',
  'default_statistics_target','random_page_cost','statement_timeout',
  'timescaledb.max_background_workers',
  'timescaledb.max_tuples_decompressed_per_dml_transaction'
)
ORDER BY name;

SELECT '---- WAL / replication ----' AS section;
SELECT pg_size_pretty(sum(size)) AS wal_on_disk, count(*) AS wal_segments FROM pg_ls_waldir();

SELECT slot_name, slot_type, active, wal_status,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots;

SELECT '================ 2. STORAGE: BIGGEST RELATIONS ================' AS section;
-- Hypertable parents report ~0 here; their bytes live in the chunks. The
-- rolled-up query below folds chunks back onto the logical table name.
SELECT n.nspname AS schema,
       c.relname AS relation,
       c.relkind,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_size_pretty(pg_table_size(c.oid))          AS table_incl_toast,
       pg_size_pretty(pg_indexes_size(c.oid))        AS indexes,
       to_char(c.reltuples, 'FM999,999,999,999')     AS est_rows,
       round(100.0 * pg_total_relation_size(c.oid)
             / NULLIF(pg_database_size(current_database()), 0), 1) AS pct_of_db
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p','m')
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 40;

SELECT '---- storage rolled up per logical table (chunks folded into parent) ----' AS section;
SELECT COALESCE(ca.view_name, h.hypertable_name, c.relname) AS logical_table,
       count(*) AS physical_relations,
       pg_size_pretty(sum(pg_total_relation_size(c.oid))) AS total,
       round(100.0 * sum(pg_total_relation_size(c.oid))
             / NULLIF(pg_database_size(current_database()), 0), 1) AS pct_of_db
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN timescaledb_information.chunks h
       ON h.chunk_schema = n.nspname AND h.chunk_name = c.relname
-- fold continuous-aggregate chunks onto the view name instead of
-- _materialized_hypertable_NN
LEFT JOIN timescaledb_information.continuous_aggregates ca
       ON ca.materialization_hypertable_name = COALESCE(h.hypertable_name, c.relname)
WHERE c.relkind IN ('r','p','m')
  AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
GROUP BY 1
ORDER BY sum(pg_total_relation_size(c.oid)) DESC
LIMIT 30;

SELECT '================ 3. TIMESCALEDB: HYPERTABLES & COMPRESSION ================' AS section;
SELECT hypertable_schema, hypertable_name, num_dimensions, num_chunks,
       compression_enabled, tablespaces
FROM timescaledb_information.hypertables
ORDER BY hypertable_name;

SELECT '---- hypertable sizes ----' AS section;
SELECT h.hypertable_name,
       pg_size_pretty(s.table_bytes) AS heap,
       pg_size_pretty(s.index_bytes) AS indexes,
       pg_size_pretty(s.toast_bytes) AS toast,
       pg_size_pretty(s.total_bytes) AS total
FROM timescaledb_information.hypertables h,
     LATERAL hypertable_detailed_size(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass) s
ORDER BY s.total_bytes DESC NULLS LAST;

SELECT '---- compressed vs uncompressed chunk counts (all TS 2.x) ----' AS section;
SELECT hypertable_name,
       count(*) AS chunks,
       count(*) FILTER (WHERE is_compressed)     AS compressed,
       count(*) FILTER (WHERE NOT is_compressed) AS uncompressed,
       min(range_start) AS oldest_chunk,
       max(range_end)   AS newest_chunk
FROM timescaledb_information.chunks
GROUP BY 1 ORDER BY 1;

SELECT '---- compression ratio: bytes before/after (may ERROR on TS >= 2.18) ----' AS section;
SELECT h.hypertable_name,
       s.total_chunks, s.number_compressed_chunks,
       pg_size_pretty(s.before_compression_total_bytes) AS before,
       pg_size_pretty(s.after_compression_total_bytes)  AS after,
       round(s.before_compression_total_bytes::numeric
             / NULLIF(s.after_compression_total_bytes, 0), 1) || 'x' AS ratio,
       pg_size_pretty(s.before_compression_total_bytes
                      - s.after_compression_total_bytes) AS saved
FROM timescaledb_information.hypertables h,
     LATERAL hypertable_compression_stats(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass) s
WHERE h.compression_enabled
ORDER BY s.before_compression_total_bytes DESC NULLS LAST;

SELECT '---- compression lag: uncompressed chunks older than the 7d policy ----' AS section;
-- These are bytes the compression policy should already have reclaimed.
-- A long list = the policy job is failing or starved (section 4), or a
-- force-refetch decompressed chunks that were never recompressed.
SELECT hypertable_name, chunk_schema, chunk_name, range_start, range_end,
       pg_size_pretty(pg_total_relation_size(format('%I.%I', chunk_schema, chunk_name)::regclass)) AS size
FROM timescaledb_information.chunks
WHERE NOT is_compressed AND range_end < now() - interval '7 days'
ORDER BY pg_total_relation_size(format('%I.%I', chunk_schema, chunk_name)::regclass) DESC
LIMIT 30;

SELECT '---- growth: chunk bytes per month per hypertable ----' AS section;
SELECT hypertable_name,
       date_trunc('month', range_start)::date AS month,
       count(*) AS chunks,
       count(*) FILTER (WHERE is_compressed) AS compressed,
       pg_size_pretty(sum(pg_total_relation_size(format('%I.%I', chunk_schema, chunk_name)::regclass))) AS size
FROM timescaledb_information.chunks
WHERE range_start > now() - interval '18 months'
  AND range_start < now() + interval '1 month'
GROUP BY 1, 2
ORDER BY 1, 2;

SELECT '---- continuous aggregates ----' AS section;
SELECT view_name, materialization_hypertable_name, compression_enabled,
       materialized_only
FROM timescaledb_information.continuous_aggregates
ORDER BY view_name;

SELECT '================ 4. TIMESCALEDB: BACKGROUND JOBS ================' AS section;
-- Compression, retention and cagg-refresh policies all live here.
SELECT job_id, application_name, proc_name, hypertable_name,
       schedule_interval, config, scheduled, next_start
FROM timescaledb_information.jobs
ORDER BY job_id;

SELECT '---- job run stats (failures / lag) ----' AS section;
SELECT s.job_id, j.proc_name, j.hypertable_name,
       s.last_run_started_at, s.last_successful_finish, s.last_run_status,
       s.job_status, s.last_run_duration,
       s.total_runs, s.total_successes, s.total_failures
FROM timescaledb_information.job_stats s
JOIN timescaledb_information.jobs j USING (job_id)
ORDER BY s.total_failures DESC, s.job_id;

SELECT '================ 5. RETENTION ================' AS section;
SELECT '---- TimescaleDB retention policies (Perfana ships none by default) ----' AS section;
SELECT job_id, hypertable_name, schedule_interval, config
FROM timescaledb_information.jobs
WHERE proc_name = 'policy_retention';

SELECT '---- audit_logs partitions (retention = worker nightly DELETE, AUDIT_RETENTION_MONTHS default 24 — never a partition DROP) ----' AS section;
SELECT c.relname AS partition,
       pg_get_expr(c.relpartbound, c.oid) AS bounds,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       to_char(c.reltuples, 'FM999,999,999') AS est_rows,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_inherits i
JOIN pg_class c ON c.oid = i.inhrelid
WHERE i.inhparent = 'public.audit_logs'::regclass
ORDER BY c.relname;

-- min/max only: a count(*) over every partition is not worth the scan.
SELECT min(timestamp) AS oldest_audit_row, max(timestamp) AS newest_audit_row
FROM audit_logs;

SELECT '---- app data span (what any retention policy would act on) ----' AS section;
SELECT count(*) AS test_runs,
       min(start_time) AS oldest_run,
       max(start_time) AS newest_run,
       count(*) FILTER (WHERE start_time < now() - interval '12 months') AS runs_older_than_1y,
       count(*) FILTER (WHERE start_time < now() - interval '24 months') AS runs_older_than_2y
FROM test_runs;

SELECT 'ds_metrics' AS tbl, approximate_row_count('ds_metrics') AS approx_rows
UNION ALL SELECT 'requests_raw',   approximate_row_count('requests_raw')
UNION ALL SELECT 'transactions',   approximate_row_count('transactions')
UNION ALL SELECT 'requests_error', approximate_row_count('requests_error')
UNION ALL SELECT 'virtual_users',  approximate_row_count('virtual_users');

SELECT '================ 6. VACUUM / BLOAT SIGNALS ================' AS section;
SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 1) AS pct_dead,
       last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
       vacuum_count, autovacuum_count
FROM pg_stat_user_tables
WHERE n_dead_tup > 10000
ORDER BY n_dead_tup DESC
LIMIT 25;

SELECT '---- transaction-id age (wraparound headroom) ----' AS section;
SELECT c.relname, age(c.relfrozenxid) AS xid_age,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','t','m') AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY age(c.relfrozenxid) DESC
LIMIT 10;

SELECT '================ 7. INDEXES ================' AS section;
SELECT '---- never-scanned indexes > 10 MB (deletion candidates) ----' AS section;
SELECT s.schemaname, s.relname AS table_name, s.indexrelname AS index_name,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS size, s.idx_scan
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
  AND pg_relation_size(s.indexrelid) > 10 * 1024 * 1024
  AND s.schemaname <> '_timescaledb_internal'
ORDER BY pg_relation_size(s.indexrelid) DESC
LIMIT 25;

SELECT '---- index bytes vs heap bytes (top 15) ----' AS section;
SELECT relname,
       pg_size_pretty(pg_relation_size(relid)) AS heap,
       pg_size_pretty(pg_indexes_size(relid))  AS indexes,
       round(pg_indexes_size(relid)::numeric / NULLIF(pg_relation_size(relid), 0), 2) AS idx_per_heap
FROM pg_stat_user_tables
WHERE pg_indexes_size(relid) > 10 * 1024 * 1024
ORDER BY pg_indexes_size(relid) DESC
LIMIT 15;

SELECT '================ 8. ACTIVITY ================' AS section;
SELECT state, count(*), max(now() - state_change) AS longest_in_state
FROM pg_stat_activity WHERE datname = current_database()
GROUP BY state ORDER BY count(*) DESC;

SELECT pid, usename, application_name, state,
       now() - xact_start AS xact_age, now() - query_start AS query_age,
       wait_event_type, wait_event,
       left(regexp_replace(query, '\s+', ' ', 'g'), 120) AS query
FROM pg_stat_activity
WHERE datname = current_database() AND state <> 'idle'
  AND now() - query_start > interval '5 seconds'
ORDER BY query_start
LIMIT 20;

SELECT '---- cache hit ratio, temp files, deadlocks (since stats_reset) ----' AS section;
SELECT round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit_pct,
       xact_commit, xact_rollback,
       tup_inserted, tup_updated, tup_deleted,
       temp_files, pg_size_pretty(temp_bytes) AS temp_bytes,
       deadlocks, stats_reset
FROM pg_stat_database WHERE datname = current_database();

SELECT '---- top statements by total time (needs pg_stat_statements) ----' AS section;
SELECT round(total_exec_time)::bigint AS total_ms,
       calls,
       round(mean_exec_time)::bigint AS mean_ms,
       round(100.0 * total_exec_time / NULLIF(sum(total_exec_time) OVER (), 0), 1) AS pct,
       left(regexp_replace(query, '\s+', ' ', 'g'), 140) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

SELECT '================ 9. RLS / ROLES ================' AS section;
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles WHERE rolname LIKE 'perfana%' OR rolsuper OR rolbypassrls
ORDER BY rolname;

SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       count(p.polname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
GROUP BY 1,2,3
HAVING c.relrowsecurity OR count(p.polname) > 0
ORDER BY c.relname;

SELECT '================ 10. MIGRATIONS ================' AS section;
SELECT id, name, to_timestamp(timestamp / 1000) AS applied_marker
FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 15;

SELECT '================ END OF REPORT ================' AS section;
