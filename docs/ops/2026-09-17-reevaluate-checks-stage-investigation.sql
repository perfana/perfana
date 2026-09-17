-- Evidence queries for docs/ops/2026-09-17-reevaluate-checks-stage-investigation.md
-- Batch re-evaluate job 311, 2026-09-17 14:59:54–15:07:39 UTC, runs
-- WERKNL-acceptatie-loadtest_perfana-{00009,00005,00004,00003,00002,00001}.
-- All read-only except 3b (EXPLAIN ANALYZE runs the raw scan once).
-- `\_` in LIKE patterns is deliberate: `_` is a wildcard.

-- 1. Are the slow runs sitting in compressed requests_raw chunks? (explains 3 s vs 136 s)
SELECT tr.test_run_id, tr.start_time, tr.end_time,
       count(*) FILTER (WHERE c.is_compressed)     AS compressed_chunks,
       count(*) FILTER (WHERE NOT c.is_compressed) AS rowstore_chunks
FROM test_runs tr
LEFT JOIN timescaledb_information.chunks c
       ON c.hypertable_name = 'requests_raw'
      AND c.range_start <= tr.end_time AND c.range_end >= tr.start_time
WHERE tr.test_run_id LIKE 'WERKNL-acceptatie-loadtest\_perfana-0000%'
GROUP BY 1,2,3 ORDER BY tr.start_time;

-- 2. Request volume per run (from the rollup, no raw scan) — does size track the timings?
SELECT test_run_id, sum(total_count) AS requests, sum(failed_count) AS failed
FROM test_run_sampler_stats
WHERE ramp_up_excluded = false
  AND test_run_id LIKE 'WERKNL-acceptatie-loadtest\_perfana-0000%'
GROUP BY 1 ORDER BY 1;

-- 3. What the error_percentage query actually cost (shared_blks_read is the tell)
SELECT calls, round(total_exec_time) AS total_ms, round(mean_exec_time) AS mean_ms,
       round(max_exec_time) AS max_ms, shared_blks_read, shared_blks_hit, temp_blks_read,
       left(query, 160) AS query
FROM pg_stat_statements
WHERE query ILIKE '%FILTER (WHERE success = false)%requests_raw%'
ORDER BY total_exec_time DESC;

-- 3b. Plan for the worst run. Expect a DecompressChunk over the whole segment.
EXPLAIN (ANALYZE, BUFFERS)
SELECT (COUNT(*) FILTER (WHERE success = false))::float / NULLIF(COUNT(*),0) * 100
FROM requests_raw WHERE test_run_id = 'WERKNL-acceptatie-loadtest_perfana-00003';

-- 4. Would the rollup give the same number? Compare against what was stored.
SELECT b.id, b.exclude_ramp_up_time, b.requirement_operator, b.requirement_value
FROM benchmarks b WHERE b.id = '58c8758c-fa8b-4299-ad3d-de27ef056dc5';

-- The aggregated evaluator stores its computed value in `panel_average` (ChecksPipeline.ts
-- `insertAggregatedCheckResult`); there is no `actual_value` column.
SELECT cr.test_run_id, cr.panel_average AS raw_pct,
       round(100.0 * sum(s.failed_count) / nullif(sum(s.total_count),0), 4) AS rollup_pct,
       s.ramp_up_excluded
FROM check_results cr
JOIN test_run_sampler_stats s ON s.test_run_id = cr.test_run_id
WHERE cr.benchmark_id = '58c8758c-fa8b-4299-ad3d-de27ef056dc5'
  AND cr.test_run_id LIKE 'WERKNL-acceptatie-loadtest\_perfana-0000%'
GROUP BY 1,2,4 ORDER BY 1,4;

-- 5. Check results for the batch: 4 per run, all COMPLETE, written in the 14:59–15:07 window
SELECT test_run_id, count(*) AS n,
       count(*) FILTER (WHERE status = 'COMPLETE') AS complete,
       bool_and(coalesce(meets_requirement, true)) AS all_pass,
       min(created_at), max(created_at)
FROM check_results
WHERE test_run_id LIKE 'WERKNL-acceptatie-loadtest\_perfana-0000%'
GROUP BY 1 ORDER BY 1;

-- 6. ADAPT really wrote rows despite the "(0 rows)" log lines
SELECT test_run_id, count(*) AS results,
       count(*) FILTER (WHERE updated_at > '2026-09-17 15:06:00+00') AS touched_by_batch,
       max(updated_at)
FROM ds_adapt_results
WHERE test_run_id LIKE 'WERKNL-acceptatie-loadtest\_perfana-0000%'
GROUP BY 1 ORDER BY 1;

SELECT test_run_id, conclusion, updated_at
FROM ds_adapt_conclusions
WHERE test_run_id LIKE 'WERKNL-acceptatie-loadtest\_perfana-0000%'
ORDER BY 1;

-- 7. Nothing still references the deleted 00008.
--    ds_control_groups: `control_group_id` is the run the group was built FOR, `test_runs`
--    is the array of baseline runs in it. Both directions matter: 00008's own group row, and
--    00008 as a baseline member of another run's group (00009's, rebuilt at 15:06:12).
SELECT 'ds_control_groups.own' t, count(*) FROM ds_control_groups
 WHERE control_group_id = 'WERKNL-acceptatie-loadtest_perfana-00008'
UNION ALL SELECT 'ds_control_groups.member', count(*) FROM ds_control_groups
 WHERE 'WERKNL-acceptatie-loadtest_perfana-00008' = ANY(test_runs)
UNION ALL SELECT 'ds_control_group_statistics', count(*) FROM ds_control_group_statistics WHERE control_group_id = 'WERKNL-acceptatie-loadtest_perfana-00008'
UNION ALL SELECT 'ds_adapt_results.run', count(*) FROM ds_adapt_results WHERE test_run_id = 'WERKNL-acceptatie-loadtest_perfana-00008'
UNION ALL SELECT 'ds_adapt_results.group', count(*) FROM ds_adapt_results WHERE control_group_id = 'WERKNL-acceptatie-loadtest_perfana-00008'
UNION ALL SELECT 'ds_metric_statistics', count(*) FROM ds_metric_statistics WHERE test_run_id = 'WERKNL-acceptatie-loadtest_perfana-00008'
UNION ALL SELECT 'check_results', count(*) FROM check_results WHERE test_run_id = 'WERKNL-acceptatie-loadtest_perfana-00008'
UNION ALL SELECT 'test_run_sampler_stats', count(*) FROM test_run_sampler_stats WHERE test_run_id = 'WERKNL-acceptatie-loadtest_perfana-00008'
UNION ALL SELECT 'ds_metric_collection_status', count(*) FROM ds_metric_collection_status WHERE test_run_id = 'WERKNL-acceptatie-loadtest_perfana-00008';

-- 7b. What 00009's group holds now (should be 5 runs, none of them 00008).
SELECT control_group_id, n_test_runs, test_runs, updated_at
FROM ds_control_groups
WHERE control_group_id = 'WERKNL-acceptatie-loadtest_perfana-00009';

-- 8. The "stuck status" reset: what did the runs look like, and is the timezone comparison sane?
SHOW timezone;
SELECT test_run_id, status->>'evaluatingChecks' AS checks, status->>'evaluatingAdapt' AS adapt,
       status->>'evaluatingComparisons' AS comparisons, status->>'lastUpdate' AS last_update,
       valid, invalid_reason
FROM test_runs
WHERE test_run_id LIKE 'WERKNL-acceptatie-loadtest\_perfana-0000%' ORDER BY 1;

-- 9. The three Apdex N/A transactions — where does the name come from if nothing holds rows?
SELECT 'transaction_stats' src, count(*) FROM test_run_transaction_stats
 WHERE test_run_id = 'WERKNL-acceptatie-loadtest_perfana-00009'
   AND transaction_name IN ('Get - bsn_password','vts-plaats-terug-bsn','vts-retrieve-bsn')
UNION ALL SELECT 'sampler_stats', count(*) FROM test_run_sampler_stats
 WHERE test_run_id = 'WERKNL-acceptatie-loadtest_perfana-00009'
   AND transaction_name IN ('Get - bsn_password','vts-plaats-terug-bsn','vts-retrieve-bsn')
UNION ALL SELECT 'benchmarks/config', count(*) FROM benchmarks
 WHERE transaction_name IN ('Get - bsn_password','vts-plaats-terug-bsn','vts-retrieve-bsn');
