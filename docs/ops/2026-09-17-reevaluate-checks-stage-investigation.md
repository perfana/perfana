# 2026-09-17 — batch re-evaluate: checks stage is 81% of the job

**Status: finding 1 fixed in v0.2.95.40** (`AggregatedBenchmarkEvaluator` reads `error_percentage` from `test_run_sampler_stats`, raw scan only when the run has no rollup). Findings 2, 4 and 5 are still open. Queries in
`2026-09-17-reevaluate-checks-stage-investigation.sql`; results gathered 2026-09-17 for queries 1, 2,
3b, 4, 4b, 5, 6 (first half), 8 (second half), 9. Query 3 (`pg_stat_statements`) only matched
its own EXPLAIN; 6's conclusions and `SHOW timezone` are still outstanding; 7 is done.

Source: `perfana-api-2026-09-17.log` / `perfana-worker-2026-09-17.log` (12 min window,
14:55–15:08 UTC). Batch job 311, 6 x 3 h runs of `WERKNL / acceptatie / loadtest_perfana`
(00009, 00005, 00004, 00003, 00002, 00001), `refreshMode=reevaluate`,
`recalculateStatistics=false`.

## Outcome

Completed cleanly in 465 s, no errors. All 6 runs: 4 check results, all PASS, marked valid.
ADAPT chunk 1 (5 runs) 69.7 s (~13 s/run, matches the known figure); chunk 2 (00001)
correctly wrote `NO_BASELINES_FOUND`. Control-group statistics on the `rollup(pct_agg)`
fast path, 15.6 s for 5 groups.

| stage | ms | share |
|---|---|---|
| checks-evaluation | 377,372 | 81.2% |
| control-groups-creation | 92 | 0.0% |
| control-group-statistics | 15,576 | 3.4% |
| adapt-difference-detection | 69,729 | 15.0% |

## Findings

### 1. The whole checks stage is one aggregated `error_percentage` SLO

Benchmark `58c8758c-fa8b-4299-ad3d-de27ef056dc5`, per run:

| run | aggregated check | run's whole checks |
|---|---|---|
| 00009 | 3.2 s | 3.4 s |
| 00005 | 120.7 s | 120.8 s |
| 00004 | 69.4 s | 69.5 s |
| 00003 | 135.9 s | 136.0 s |
| 00002 | 39.9 s | 40.1 s |
| 00001 | 7.0 s | 7.1 s |

Apdex (317 transactions) is on the rollup fast path at ~100 ms/run. The aggregated check
(`apps/worker/src/pipelines/checks/AggregatedBenchmarkEvaluator.ts`, `computeMetric`) is a
raw scan:

```sql
SELECT (COUNT(*) FILTER (WHERE success = false))::float / NULLIF(COUNT(*),0) * 100
FROM requests_raw WHERE test_run_id = $1
```

**The compression hypothesis is wrong.** Query 1: every one of the six runs sits in **one
row-store chunk, zero compressed** (`requests_raw` compresses after 7 days; the oldest run is
09-12). Query 3b, run standalone on 00003:

```
Parallel Seq Scan on _hyper_2_378_chunk   rows=1,507,337 x3 loops   Rows Removed by Filter: 13,065,499 x3
  Filter: (test_run_id = '…-00003')       Buffers: shared read=1,364,710 (hit=0)
Execution 9,546 ms   (JIT 1,034 ms of it: 104 functions)
```

Chunk 378 is a pre-1804 **7-day** chunk holding ~43.7 M rows; the run is ~10 % of it. At that
selectivity the planner takes a parallel seq scan over `idx_requests_raw_test_run_time` (the
same query *does* use the index on the 1-day chunk 565, which held 0 rows for 00003), so each
evaluation reads the whole chunk: **~10.4 GB, cold, per run**. That is the fixed cost. What
varies is the I/O environment:

| run | check | when (UTC) | note |
|---|---|---|---|
| 00009 | 3.2 s | 14:59:54 | 09-17 run; in the newer chunk (index scan) or still in cache |
| 00005 | 120.7 s | → 15:01:59 | under the 00008 delete (14:59:38–15:02:22, same chunk) |
| 00004 | 69.4 s | → 15:03:08 | delete's tail (ended 15:02:22) |
| 00003 | 135.9 s | → 15:05:24 | after the delete, yet slowest — unexplained; a WAL-driven checkpoint from the delete is the guess |
| 00002 | 39.9 s | → 15:06:05 | fourth scan of the same chunk — page cache warming |
| 00001 | 7.0 s | → 15:06:12 | fifth |

Query 2 rules out size: 4.50–4.53 M requests per run, flat. The 3 s → 136 s spread is I/O
contention (the delete and the WAL-driven checkpoint it forces — 00003 is unexplained by the
delete alone) followed by the OS page cache filling up with the chunk. Standalone and cold it
is ~10 s, which is already 10 s of pure read for a two-column count that the rollup holds.

It runs under `withTransaction` (10 min default `statement_timeout`), not the 120 s
analytics cap, so it never cancels — it just burns. `checks-evaluation` is not chunked, so a
100-run bulk re-evaluate at ~100 s/run exceeds the orchestrator's 30 min
`JOB_WAIT_TIMEOUT_MS` on this stage alone.

**Fix candidate — confirmed by query 4b.** `SUM(failed_count) / SUM(total_count)` from
`test_run_sampler_stats` with `ramp_up_excluded = true` reproduces the stored `panel_average`
on all six runs (rollup rounded to 4 decimals; raw shown in full):

| run | raw (stored) | rollup `true` | rollup `false` |
|---|---|---|---|
| 00001 | 0.004313 | 0.0043 | 0.0044 |
| 00002 | 0.004564 | 0.0046 | 0.0045 |
| 00003 | 0.012443 | 0.0124 | 0.0117 |
| 00004 | 0.005159 | 0.0052 | 0.0051 |
| 00005 | 0.004660 | 0.0047 | 0.0047 |
| 00009 | 0.004463 | 0.0045 | 0.0044 |

The SLO is `exclude_ramp_up_time = true`, `<= 1` (query 4), and the values sit two orders of
magnitude under the threshold, so a fourth-decimal disagreement could not flip a verdict. The
ramp-down residue (rollup window `[start+rampUp, end-rampDown]`, evaluator applies the start
offset only) is either absent on this workload or below 4 decimals — it does not show here.
Rerun 4b with `round(…, 8)` if an exact match is wanted before shipping; for the verdict it is
settled. Raw scan only when the rollup has no rows for the run (same rule as `ApdexCalculator`).

### 2. The job vanished from the UI at 15:04:55

API: `Evicting stale active-job entry 311 (lastProgressAt 14:59:54.808Z)`. Worker confirms:
zero `progress-reporter` lines between 14:59:54 and 15:06:12. The re-evaluate orchestrator
publishes nothing during the checks stage and nothing `touch()`es the record (only
`PipelineOrchestrator` does that, around heavy stages). Any checks stage > 5 min blanks the
UI while the scope lock still refuses new runs. A `ProgressReporter.touch()` per run in the
checks loop fixes it independently of #1.

### 3. Run 00008 was deleted concurrently with the batch

API timeline (UTC): delete queued 14:59:38 → `DELETE FROM ds_metrics` **127 s** (ended
15:01:46) → `DELETE FROM requests_raw` 25.9 s (ended 15:02:15) → `virtual_users` 5.4 s →
done 15:02:22. Batch started 14:59:54, so 00005's 120 s check ran entirely under the
deletion's I/O — but 00004 and 00003 ran after it and were still 69 / 136 s, so contention
is a contributor, not the cause. 127 s for a `test_run_id`-only delete means 00008 was in
row-store (recent) chunks; that is an API-side job holding a pooled connection for 2+ min.
Control group for 00009 was rebuilt at 15:06:12 with 5 runs, after the deletion. **Query 7:
clean.** Zero rows reference 00008 in `ds_control_groups` (own row or as a `test_runs`
member), `ds_control_group_statistics`, `ds_adapt_results` (as run or as group),
`ds_metric_statistics`, `check_results`, `test_run_sampler_stats`,
`ds_metric_collection_status`. The delete cascaded fully; nothing to repair.

### 4. Logging bugs

- `control-groups-pipeline`: `Reset stuck status for test run undefined: adapt=undefined,
  comparisons=undefined` x2. `manager.query(UPDATE … RETURNING)` returns `[rows, affected]`
  and the loop at `ControlGroupsPipeline.ts:219-223` iterates that tuple. Something *was*
  reset on at least one of the 6 runs and we cannot tell which. Also suspect the predicate:
  `(status->>'lastUpdate')::timestamp < NOW() - INTERVAL '10 minutes'` casts an ISO-Z string
  to `timestamp without time zone` and compares against `NOW()` in session timezone — if the
  DB session is not UTC, every IN_PROGRESS run reads as stuck. Query 8's status half shows
  all six `COMPLETED` / 00001 `NO_BASELINES_FOUND`, `lastUpdate` stored as ISO-Z; `SHOW
  timezone` was not exported, so the cast concern is still open.
- `adapt-analysis`: `process-adapt-results … (0 rows)`, `generate-conclusions (0 rows)`,
  `affected 0 rows` — the `result.length`-on-INSERT bug fixed for control-group-statistics
  in v0.2.95.26, still present in `results-processor.ts:160,297,303,373`. **Query 6 cannot
  confirm it either way**: `ds_adapt_results.updated_at` is copied from
  `ds_metric_statistics.updated_at` (`sql-builder.ts:171`), which a plain re-evaluate never
  rewrites, so `touched_by_batch = 0` for 00002–00004 is expected. 00005 and 00009 read
  15:23 / 15:29 because they were re-analysed later that afternoon, not by batch 311.
  Verify from code, not data; the conclusions half of the query was not exported.

### 5. Minor

- API `pg` `DeprecationWarning: Calling client.query() when the client is already executing
  a query` at 14:59:25 — `test-runs-crud-query.service.ts:417` runs `Promise.all` of three
  queries on the request's single RLS client. Throws in pg@9.
- Apdex logs `N/A (Total:0)` for `Get - bsn_password`, `vts-plaats-terug-bsn`,
  `vts-retrieve-bsn` on every run. **Query 9 overturns the "no rollup row" reading**: all
  three have a `test_run_transaction_stats` row *and* a `test_run_sampler_stats` row on
  00009, and no benchmark names them. So the fast path saw them and answered total 0 — either
  the rows carry `total_count = 0` (a transaction with a name but no successful samples?) or
  the fast path misses on the `ramp_up_excluded` variant. Next query:
  `SELECT transaction_name, ramp_up_excluded, total_count, failed_count FROM
  test_run_transaction_stats WHERE test_run_id = '…-00009' AND transaction_name IN (…)`.
- `No configuration found for test run 00009, defaulting to metric scope` — informational.

Query 5: 4 check results per run, all COMPLETE, all pass, written 15:01:59–15:06:05 (00005
and 00009 overwritten by the later re-evaluate).

## Recommended order

1. Source `error_percentage` from `test_run_sampler_stats` (query 4b agrees with
   `check_results.panel_average` on all six runs). Removes ~370 s of 465; the raw scan reads
   ~10 GB per run whether or not anything else is running.
2. The two `result.length` log bugs.
3. `touch()` per run in the checks loop.
