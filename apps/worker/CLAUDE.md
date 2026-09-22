# CLAUDE.md — apps/worker

BullMQ pipelines: metrics collection, statistics, ADAPT regression detection, SLO checks.
Root [CLAUDE.md](../../CLAUDE.md) has the stack, env vars and the symptom index ("Common Issues")
that points back here. Pipeline tutorials: [docs/reference/tutorials.md](../../docs/reference/tutorials.md).

## Gotchas

### ADAPT's baseline depends on the `pct_agg` sketch

`ds_metric_statistics.pct_agg` is the per-run t-digest added in #289. `ControlGroupStatisticsPipeline` pools those sketches with `rollup(pct_agg)` — the fast path. Rows written before #289, or restored from a backup or a SUT transfer, have `pct_agg = NULL`, which forces the legacy path: a raw scan over `ds_metrics`. On a large baseline that scan runs out of time, `ds_control_group_statistics` is left empty, and ADAPT reports INSUFFICIENT_DATA against a baseline that is actually fine.

**Which timeout applies changed in v0.2.93.3.** Both aggregation transactions now call `BasePipelineTypeORM.setAggregationBudget()` as their first statement, so they run under `AGGREGATION_STATEMENT_TIMEOUT_MS` (default 540s) rather than the `ANALYTICS_STATEMENT_TIMEOUT_MS` cap (default 120s) that the rest of the analytics pool uses. Both live in `apps/worker/src/config/environment.ts`. Two consequences when you are reading a timeout in the log: the number you are up against is 540s unless the deploy lowered it, and **lowering `ANALYTICS_STATEMENT_TIMEOUT_MS` no longer shortens these two jobs** — it never reaches them.

Four things to know before touching this path:

1. **The pipeline self-heals first (v0.2.90.0, #552).** `backfillMissingSketches()` runs *before* the aggregation transaction: it finds control runs whose `ds_metric_statistics` rows have `pct_agg IS NULL` and reruns `StatisticsPipeline` on them, so the fast path applies instead of walking into a known timeout. It is **best-effort by contract** — any failure is caught and the legacy raw scan still runs, which is why the legacy-path warning now says the backfill did not repair the rows. `StatisticsPipeline` can also succeed while writing nothing (no `ds_metrics` rows left), so success alone does not mean the sketches exist; the code checks `processedRecords` and logs which happened.
2. **The manual escape hatch is `POST /api/data/recalculate-statistics/:testRunId`** → `BullMQClientService.enqueueStatisticsCalculation()` on the **`perfana-analyze`** queue (not the batch queue `addJob` uses), jobId `statistics-<testRunId>` so repeated clicks coalesce. The job record is *not* retained after it settles — BullMQ refuses an `add` whose jobId still exists, so retention would make every later click a silent no-op behind a "started" toast. In the UI it is the **Recalculate baseline statistics** button rendered by `AnomalyDetectionSubsection` (`EvaluationResultsSection.tsx`) beside the ADAPT message itself — deliberately not a permanent menu item, since it helps for exactly one cause. It posts for each id in the conclusion's `details.controlRuns`, so it repairs the **baseline** runs rather than the run showing the error, and the user never has to know that.
3. **Recalculating fetches nothing.** `StatisticsPipeline` reads only `ds_metrics` and rewrites `ds_metric_statistics`, so it is safe on old runs whose Grafana/Dynatrace window has long expired.
4. **Pass the canonical `test_run_id` to a pipeline, never the UUID.** `verifyTestRunAccess` accepts either and now *returns* `test_run_id`; every pipeline filters on that column, so forwarding the UUID enqueues a job that matches zero rows and reports success.

5. **A timeout in `control-group-statistics` is not always a missing sketch.** The org-scope filter used to be two `IN (SELECT … WHERE organization_id = tr.organization_id)` subqueries correlated on a `test_runs` join. Correlated subqueries cannot be pulled up into a semi-join, so the planner emitted `Join Filter: ((SubPlan 1) OR (SubPlan 2))` — a seq scan of `application_dashboards` plus a sort+unique over `dynatrace_queries` — re-run for **every** `ds_metrics` row. 2.9 M rows × 163 dashboards ≈ 473 M subplan row evaluations. Fixed in v0.2.93.1 by resolving the org once into a `scoped_dashboards` CTE (17.8 s → 3.2 s on the legacy path, 751 ms → 315 ms on the fast path, byte-identical output). Keep it uncorrelated; both `organization_id` columns are NOT NULL, so the old `OR … IS NULL` arms were dead. On a deploy whose DB role lacks `BYPASSRLS` this shape is far worse still, because each of those rows also invokes the PL/pgSQL `can_access_resource` policy — the giveaway in the error is `where: 'PL/pgSQL function can_access_resource(uuid,uuid,text)'`.

   The same planner failure recurs in a second disguise: an **OR between two `IN` subqueries** on the dashboard filter. An OR of two subqueries cannot be pulled up into a semi-join either, so the planner emits `Filter: ((hashed SubPlan 1) OR (hashed SubPlan 2))` and re-evaluates it per candidate row. Three sites are known, all now fixed — the control-group aggregation above, `buildValidDashboardFilterSQL()` in `apps/worker/src/pipelines/helpers/adapt/control-group-processor.ts` (single caller `results-processor.ts:135`), and the empty-control-group probe in `apps/worker/src/pipelines/helpers/adapt/adapt-validator.ts`; the latter two sat on the ADAPT insert path at 102 s and 5.2 M buffer hits. Write a new one as a single `IN` over a `UNION` of the two id sets, with a `WHERE application_dashboard_id IS NOT NULL` arm on the `dynatrace_queries` side (or as a MATERIALIZED CTE where the query owns its own CTE list). The plan then goes from that `Filter` over a full scan to a `Hash Join` over `Index Only Scan using uniq_ds_metric_statistics`, and the two dashboard-id sets are provably the same — a FULL JOIN of old against new returns 0 differing rows.

6. **`ds_metrics` is compressed with `compress_segmentby = 'test_run_id'`, so anything that touches it per-group is a trap — and the write side is worse than the read side.** A compressed chunk holds one segment per run; nothing below `test_run_id` can be pushed into it. Compression starts at 2 days (migration 1805, v0.2.95.18; 7 days before that) and every run the sketch backfill visits is older than that, so this is the backfill's normal path, not an edge case. A dev database — where chunks are typically uncompressed — will never show either half. Both were fixed in v0.2.93.2:

   - **Reads: one probe per output group.** `StatisticsPipeline` fetched `last_value` with a `LEFT JOIN LATERAL`. TimescaleDB *does* push `ORDER BY time DESC LIMIT 1` into the columnar scan, so a metric still reporting at the end of the run was found in the first batch (~0.04 ms/loop) — the cost is metrics that **stop reporting early**, which force a deep backward walk (~0.97 ms/loop, 24x worse). Enough of those and you exceed the budget (this was measured against the 120 s `ANALYTICS_STATEMENT_TIMEOUT_MS` cap that applied before v0.2.93.3): 60.1 s over 12,370 groups, against 1.19 s for `last(value, time)` in the aggregate pass already running. Aggregate in the single pass. `last()` is core `timescaledb` (not toolkit), `PARALLEL SAFE`, and deterministic here because `uniq_ds_metrics_upsert` is UNIQUE on the group key plus `time`, so no group can hold two rows at the same instant. It needs its own `FILTER (WHERE value IS NOT NULL)`: unlike every other aggregate there, `last()` returns the value *at* the greatest time even when that value is NULL.
   - **Writes: a predicate on a non-segmentby column decompresses the whole run as DML.** `refreshRampUpFlags` runs `UPDATE ds_metrics … WHERE m.ramp_up IS DISTINCT FROM <expr>` immediately before the aggregation, in the same transaction. `ramp_up` is neither segmentby nor orderby, so TimescaleDB decompresses the run's entire segment just to evaluate the guard — **even when zero rows change**. Measured: 53.7 s and 2,620,348 tuples on a 2.6 M-row run whose flags were already correct, ending in `tuple decompression limit exceeded by operation` (`max_tuples_decompressed_per_dml_transaction` defaults to 100 000). "Only rows that actually change are written" does not make such an UPDATE cheap — the guard *is* the expensive part. Ask with a SELECT first (a read decompresses transiently and rewrites nothing: 939 ms on 2.6 M rows, scaling roughly linearly — budget ~8 s on a 20 M-row run — and the chunks stay compressed), and when a write really is needed call `decompressChunksForRange` outside the transaction first, the way `StatisticsPipeline.refreshRampUpFlags` does. It is the only caller left — the force-refetch delete used to be the other one and no longer needs it; see the two v0.2.95.16 bullets below.

   - **Decompression only works through the `perfana_decompress_chunk` / `perfana_compress_chunk` wrappers (migration 1804, v0.2.95.17).** The worker connects as `perfana_system`, which does not own the hypertables, and TimescaleDB refuses a direct `decompress_chunk` with `must be owner of hypertable "ds_metrics"` — so every `decompressChunksForRange` before this was a silent no-op (logged as `skipped`) and the ramp-up `UPDATE` it guards ran as DML on the compressed chunk. The wrappers are `SECURITY DEFINER`, owned by the migration role (the hypertable owner), `EXECUTE` granted to `perfana_system` only (revoked from `perfana_app`, which the consolidated migration's default privileges would otherwise hand it). A database that has not run 1804 falls back to the old behaviour; the `skipped:` warning then names the missing function.
   - **`ds_metrics` and `requests_raw` use 1-day chunks from migration 1804 on.** Existing chunks keep their 7-day range until they close. That is what bounds the collateral of a decompression to one day of other runs, and what makes a run's aggregation read ~16 GB instead of ~113 GB of chunk. The price is chunk count: no retention policy on `ds_metrics`, so ~365 chunks a year plus compressed twins, and every hot query (`test_run_id`, no time predicate) locks all of them — `max_locks_per_transaction` must be raised (256 in `docker-compose.infra.yml`; a deploy on its own Postgres has to do it too, restart required) or the symptom is `out of shared memory` under concurrency. **A re-analysis of a run older than `compress_after` re-collects into columnstore** — the window-change dialog *without* "apply to all" enqueues a full `analyze-test`, whose `metrics-collection` stage upserts every panel into the compressed chunk and sits at "Metric collection" until the DML decompression limit stops it. Since v0.2.95.18 `PipelineOrchestrator` decompresses the run's span first (`decompressRunSpanForCollection`, a no-op on fresh runs) and `analyze.ts` recompresses in its `finally`. The gate test for shortening the window is the **apply-to-all** path (re-evaluate with `recalculateStatistics`), which never collects. Migration 1805 (v0.2.95.18) then shortens `compress_after` on `ds_metrics` to **2 days** (12 h schedule → 2–3 days of row store, ~32–48 GB at 16 GB/day instead of 227 GB). It refuses to run if `perfana_decompress_chunk` is absent, but it cannot check the wrappers *work* on the deploy — prove that first (analysis-window change on a >7-day-old run). Its first run compresses the previous ~113 GB chunk in one call, so `initial_start` is the next 02:00 UTC, overridable via `DS_METRICS_COMPRESS_INITIAL_START` (ISO-8601 with a zone, in the future) at migration time. It also refuses if `perfana_system` cannot EXECUTE the wrapper, and skips cleanly where compression was never enabled. `requests_raw`/`transactions`/`requests_error` stay at 7 days: their CAGGs refresh with `start_offset` 7 days to match.
   - **Decompress the narrowest span that works, per run — widening it is not free (v0.2.93.3).** `decompress_chunk` works at **chunk** granularity and a chunk holds every run in its time range, so an over-wide range converts other runs' data to row store too, and every later query over that window scans row store until the compression policy catches up. `findRunsWithStaleRampUpFlags` therefore returns `MIN(m.time)`/`MAX(m.time)` **over the disagreeing rows** rather than the run's `start_time`/`end_time`, and both `decompressChunksForRange` and the `UPDATE` are bound to those per-run bounds — one statement per run, never one global min/max across a batch. A stale trailing flag spans minutes; the run-wide bounds it replaced decompressed hours, and a batch of stale runs spanning months decompressed the months between them. The per-run `UPDATE` also earns chunk exclusion: `test_run_id` is `compress_segmentby` and `time` is `compress_orderby`, so TimescaleDB can skip whole batches on their min/max metadata instead of decompressing the run's entire segment to evaluate the `ramp_up` guard. Splitting per run does **not** buy each run its own decompression budget — `max_tuples_decompressed_per_dml_transaction` is charged per **transaction** and all N statements share one. The up-front `decompressChunksForRange` is the only thing keeping the loop under it, which is why its "skipped" path logs at **warn**, not debug (v0.2.93.3): when it silently no-ops (`perfana_decompress_chunk` missing on a database that has not run migration 1804, recompressed in between, TimescaleDB error) the caller hits `tuple decompression limit exceeded` with nothing in the log explaining why.

   - **A DELETE filtered on `test_run_id` ALONE needs no decompression at all — one extra predicate destroys that (v0.2.95.16, #563).** `test_run_id` is `compress_segmentby`, so `DELETE FROM ds_metrics WHERE test_run_id = $1` drops whole compressed segments. The force-refetch delete carried one more column — `metrics_source_id IN (SELECT id FROM metrics_sources WHERE source_type = 'performance_test')` — and that alone forced TimescaleDB to decompress the run's segments as DML, which is the entire reason `decompressChunksForRange` had to run in front of it. Measured on one 2,453,285-row run in a compressed chunk (TimescaleDB 2.28.3 / PG 15.18), each in a rolled-back transaction: `decompress_chunk` + filtered delete **162,743 ms / 11 GB WAL** (153.5 s of it decompression); the filtered delete alone **54,233 ms / 4,023 MB, then `ERROR: tuple decompression limit exceeded`**; `DELETE WHERE test_run_id = $1` **181 ms / 41 MB**. ~900x faster, ~275x less WAL.

     **When you need to delete less than the whole run, preserve and restore — do not narrow the predicate.** `WorkerDatabaseService.deletePerfTestMetricsForRun` copies the rows that must survive into a `TEMP TABLE ... ON COMMIT DROP`, deletes the run wholesale, and re-inserts them, all three statements in one transaction so the survivors cannot be lost in between. The *read* is allowed to touch `metrics_source_id`: a SELECT decompresses transiently and rewrites nothing (~1 s on 2.6 M rows), unlike the DML guard. That trade only holds while the keep-set is small — ~3k rows per run here, against a run of millions — so it is not a general licence to round-trip a table through a temp copy.

     **What survives is every non-`performance_test` row, regardless of what is being re-collected, and that is deliberately not a coverage question.** Grafana and Dynatrace are external and may no longer hold the window — retention expires, tokens lapse — and Perfana exists to keep those metrics after the source has dropped them. The delete this replaced only ever removed perf-test rows and let the other sources upsert over their own, so a re-collection that returned nothing left the old rows intact; deleting them on the promise of a refetch destroys the only remaining copy. Perf-test rows are the one exception, because they rebuild from `requests_raw`/`transactions` in this same database. A row with a NULL `metrics_source_id` belongs to no source and nothing re-collects it either: `getRunMetricsSourceTypes` reports it as `'unknown'` and it is preserved with the rest.

   - **Decompression is one chunk per transaction, and this process puts its own chunks back (v0.2.95.16).** `decompressChunksForRange` used to be a single `SELECT decompress_chunk(...) FROM timescaledb_information.chunks WHERE ...`, which decompresses every matching chunk inside **one** transaction: 267 s and climbing on a 134 GB `ds_metrics`, pinning the xmin horizon throughout — so none of the ~49 M rows the caller then deleted could be vacuumed, and unrelated tables sat at 2100% dead tuples. Discovery and decompression are now separate statements, one chunk each. What keeps a batch of runs sharing a time window from decompressing the same chunk N times is the `is_compressed` predicate itself, since a chunk already decompressed no longer matches; do not "optimise" that into a cache that can go stale against a policy run.

     `recompressTouchedChunks()` puts back exactly what this process decompressed, **once, in the re-evaluate orchestrator's `finally`, after every stage**. Not at the end of the force-refetch stage and not inside `StatisticsPipeline`: the statistics stage runs next in the same job and `refreshRampUpFlags` needs those same chunks uncompressed, and with `REEVALUATE_CHUNK_SIZE` splitting a batch into several statistics jobs it would re-decompress once per chunk of runs — at the 153 s per decompression measured here, that turns the saving into a regression. It is best-effort by contract, since the caller has already committed, and a chunk it cannot recompress is left to the columnstore policy — where all of them used to be left unconditionally, and which during the #563 measurement had not run for 10.5 h. `WorkerDatabaseService` is a process singleton, so statistics jobs the orchestrator awaits share its tracking set; one that lands on another worker process leaves its chunks to the policy, exactly as before.

   The two failure modes are told apart only by the error string: the read side is `canceling statement due to statement timeout` inside `aggregateMetricStatistics`; the write side is `tuple decompression limit exceeded` before it. If neither appears and ADAPT still reports INSUFFICIENT_DATA, check whether the chunks are compressed at all — a deploy whose TimescaleDB job scheduler is starved of worker slots (see the Postgres worker budget note in the root [CLAUDE.md](../../CLAUDE.md)) never runs the compression policy, and neither of these is then your problem.

7. **Do not add a diagnostic that groups raw `ds_metrics` by anything other than its physical key (v0.2.93.3).** `ds_metrics` is organised by `test_run_id` and `time` and nothing else, so a `GROUP BY` on any other combination reads the entire run to return almost nothing. Take the number from `ds_metric_statistics`, where it has already been computed, or from the row count the real work returns anyway. Three counts existed only to write "will process N unique metrics" into the log and to warn on an expected-vs-actual mismatch, and all three read `ds_metrics` in full: `COUNT(*)` over a run's data points (16 s on 20.6 M rows), `COUNT(DISTINCT (test_run_id, dashboard, panel, metric))` (32 s on that same run — a composite `DISTINCT` cannot be parallelised and spills an external sort of anonymous `ROW()` values, which cost 4.7 s and ~370 MB of temp I/O even on a run of only 1.58 M rows), and the control-group twin, which scanned raw `ds_metrics` for every baseline run **on the fast path too** — the one path that exists to avoid exactly that scan. Together they could outlast the statement timeout before the real work started. What survives is the smallest thing that changes a decision: an `EXISTS` probe in `StatisticsPipeline`, which stops at the first row and exists solely to guard the `DELETE` (a run whose `ds_metrics` have aged out must keep its statistics rather than have them wiped and replaced with nothing). Every number the removed logs carried is already in the `INSERT`'s own row count. A zero result after a positive `EXISTS` is now a real problem — most likely org-scoping dropped every dashboard — and is logged as such, because "nothing to do" returned earlier.

   The rule is not confined to those two pipelines — `DataSanityCheckPipeline` was never covered by it and paid the most. Its sparse-metric check grouped raw `ds_metrics` by `(metric_name, dashboard_label, panel_title)` with `HAVING COUNT(*) < $2`; none of those three columns is `compress_segmentby`, so every run was read in full to surface a handful of thin metrics. Profiled with `pg_stat_statements` across a re-evaluate of 4 large runs it was **92% of all block reads on the deployment**: 4 calls, 12,613,099 shared blocks read (~103 GB) against 1,154,636 hits, 70,062 ms, 6,234 rows returned — 16.5 MB read per row returned. It now sums the per-metric `count` that `StatisticsPipeline` writes into `ds_metric_statistics` in the stage immediately before (`SUM(count) … GROUP BY metric_name, dashboard_label, panel_title HAVING SUM(count) < $2`). That changes what the threshold means, deliberately: `ds_metric_statistics` counts only non-null values inside the analysis window (`ramp_up = false`) and only org-scoped dashboards, where the old count included ramp-up rows and NULLs — so it now measures points that actually reach analysis. Two consequences, both deliberate. It fires **more** often: a metric with 1000 raw points of which 998 are in a long ramp-up used to count 1000 and stay silent, and now counts 2 and warns — expect new warnings on existing runs with a large `analysisStartOffset`. And it fires **less** on one case: a metric whose points are *entirely* in ramp-up (or that sits on a dashboard outside the org scope) gets no `ds_metric_statistics` row at all, so it is not a group and cannot be flagged. That gap is **not** covered by the "No steady-state data" reason — that branch only runs when the whole run has zero statistics, so a handful of all-ramp-up metrics inside an otherwise healthy run now go unreported. Two smaller reads in the same pipeline went the same way: `SELECT COUNT(*) FROM ds_metrics WHERE test_run_id = $1`, whose result was only ever compared against zero, is an `EXISTS` probe (it was 11.1 s and 66k blocks), and the `avg_timestep_sec` in the warning text — the only remaining reason to pull `MIN(time)`/`MAX(time)` off that scan — is gone, replaced by the run duration the message already had in scope. Do not "restore" it by dividing the duration by the point count: 3 points clustered in the first 90 s of a 3600 s run are 45 s apart and that arithmetic would call them 1800 s.

   **Nor is it confined to diagnostics — a user-facing read has the same shape (v0.2.95.3).** `MetricsService.getAvailableDashboards` (`apps/api/src/modules/metrics/metrics.service.ts`) builds the panel dropdown in the trends, compare and graphs cards and backs the MCP `get_available_metrics` tool. Its obvious form — `COUNT(DISTINCT metric_name)` and `ARRAY_AGG(DISTINCT metric_name)` grouped by `(dashboard_label, panel_title, panel_id, unit)` — made both aggregates walk every data point the run recorded: 2035 ms on a 12.8 M-row run, to describe 381 panels. Reducing to distinct `(dashboard_label, panel_title, panel_id, unit, metric_name)` tuples in a subquery and aggregating those is 927 ms and byte-identical, because the inner `DISTINCT` is index-only over `idx_ds_metrics_panel_lookup`, which carries exactly those columns after `test_run_id`. `metric_count` deliberately stays a bigint so the response contract does not move.

   Three things measured on the way, each of which cost a dead end to learn:

   - **A single-column `SELECT DISTINCT` over `ds_metrics` is not automatically slow. EXPLAIN before assuming it is.** TimescaleDB applies a native `Custom Scan (SkipScan)` when the leading index columns are fixed: `SELECT DISTINCT metric_name` for one panel of one run is **3.9 ms**, an Index Only Scan over `uniq_ds_metrics_upsert` with `Heap Fetches: 0`, returning 81 names out of 75,026 points. Hand-rolling a recursive-CTE loose index scan for that shape reimplements what the engine already does, for nothing.
   - **A multi-column `GROUP BY` carrying `COUNT(DISTINCT)` / `ARRAY_AGG(DISTINCT)` gets no such help.** SkipScan covers one distinct column, not a grouped aggregate over a distinct one, which is why the same table answers in 3.9 ms one way and 2035 ms the other. Make the inner set distinct first and let the outer query aggregate the few hundred rows that survive.
   - **A recursive-CTE loose index scan is NULL-unsafe and fails silently.** Postgres row comparison `(a,b,c) > (x,y,z)` returns NULL rather than true at the deciding column, so the recursion terminates early and the result is quietly truncated — and `ds_metrics.unit` is NULL on 20,292 rows here. The trap is the verification, not the SQL: an `EXCEPT`-both-ways check of the rewrite against the baseline returned **0 differences and was a false pass**, because every NULL-unit panel in that data happens to carry exactly one metric, so the hazard was never exercised. A diff against production data proves the rewrite agrees *on that data*, nothing more; when a rewrite has a NULL-dependent failure mode, construct the row that exercises it.

8. **The analysis offsets must FIT inside the run, and the check lives in three mirrored places (v0.2.93.3, extended v0.2.95.0).** The analysis window is `[start + analysisStartOffset, end - analysisEndOffset]`. When a short run meets offsets configured for a long one, the leading and trailing exclusions overlap, every sample matches one of them, and the entire run is flagged outside the window. Nothing downstream reports that as a misconfiguration: `ds_metric_statistics` comes out empty, the Apdex rollup misses on every transaction and falls back to the slow path, and ADAPT writes INSUFFICIENT_DATA against a run that plainly has data. It is also the worst case for `refreshRampUpFlags`, which then rewrites every row of a compressed run instead of the boundary band the per-run bounds exist to narrow it to. The fallback is to analyse the **whole** run — the offsets are a request to trim, not to discard — guarded by `EXTRACT(EPOCH FROM (end_time - start_time)) > ramp_up + ramp_down`.

   **Measure the run from its timestamps, never from `test_runs.duration`.** `duration` is client-supplied (an updating test posts it, see `update-test-run.handler.ts`), so it can be seeded from a planned duration or left behind by an aborted run and disagree with the timestamps arbitrarily. `RAMP_UP_EXPR` uses the timestamps, so anything that measures a run differently lets the API and the pipeline disagree about the same run — accepting offsets the pipeline then silently ignores, while the user is told the trim was applied.

   The guard now exists in **three** places, and changing one means changing all three or a run's flags flip depending on which path last touched it: `MetricsPipeline` bakes the flag at ingestion; `RAMP_UP_EXPR` in `StatisticsPipeline` recomputes it on recalculation; and `offsetsFitRun` in `apps/api/src/modules/test-runs/handlers/update-analysis-time-range.handler.ts` (v0.2.95.0) refuses the write up front, so a bad combination is a 400 rather than a silent fallback. The API check is the SUM of both offsets on purpose: `AdaptValidator.checkTooShortTestRuns` only ever tested `ramp_up >= duration` and never looked at `ramp_down`, so a pair that overruns only in total passed it and landed on the whole-run fallback instead.

Related: `control-group-statistics` is registered with `softFail`, so a failed aggregation still completes its BullMQ job. The reevaluate orchestrator reads the job's return value through the exported `assertStageSucceeded()` (`apps/worker/src/workers/simple-orchestrate-reevaluate-batch.ts`) instead of logging a green tick and running ADAPT on an empty baseline. Any new stage waiting on a `softFail` pipeline has to do the same.

### The live perf-test statistics pass is throttled, not incremental

`upsertPerfTestStatistics` (`pipelines/helpers/perf-metrics-writer.ts`) recomputes
`ds_metric_statistics` for the run's perf-test dashboards, and
`PerformanceTestMetricsPipeline` calls it on every non-final pass — i.e. every 60 s tick
of a live run. It reads the **run**, not the tick (deliberately, so the live numbers are
cumulative rather than the latest slice), so its cost rises with the run while the ticks
stay 60 s apart: the total across a run is **quadratic in run length**.

That is not a theoretical cost. Profiled on production with `pg_stat_statements`
(2026-09-22, ordered by `shared_blks_read`) it was the largest consumer of I/O on the
whole deployment by a factor of 8: **7055 calls, 5509 GB read, 18.5 hours of database
time, 9432 ms mean**, ~780 MB per call.

**It runs only while a test is live**, so its effect is bounded to the run window — on
this deployment the nightly 03:00-06:00 slot. Do not reach for it to explain a slow API
read outside that window: the four `SlowRequest` entries that led to this investigation
(2026-09-22 16:01, a run that had ended at 06:07) all carried `jobs=none` and
`0waiting`, i.e. no worker job and no pool contention, and were slow on their own
volume. Where it is worth checking is the recurring ~06:00 UTC API stall at nightly test
end, which is exactly when the last and most expensive ticks of a long run fire.

Since v0.2.96.10 `runHasGrownEnough` gates it: the pass runs only when the run has grown
by `PERF_TEST_STATS_MIN_GROWTH` (default 0.3) of its own length since the last one, which
turns the sum from ~93x one final pass into ~4.3x on a 3-hour run. Four things about it:

1. **What makes throttling safe is that nothing a tick writes survives analysis.**
   `StatisticsPipeline` deletes and rewrites every `ds_metric_statistics` row of the run
   from `ds_metrics`, scoped by organisation only and with **no source filter**, so the
   perf-test rows are in its scope. A skipped tick can only ever stale the LIVE display.
   If that ever stops being true — a source filter, a partial rewrite — the throttle
   becomes a correctness bug and has to go back to every tick.
2. **The skip cannot lose a metric, only delay it.** The pass it skips would have
   aggregated the same rows the next one will; it is the same query over a growing
   prefix, not a slice. There is no window to miss.
3. **The watermark is `MAX(updated_at)` over the run's own statistics rows, not
   worker-local state.** Ticks for one run are not pinned to a worker process, so an
   in-memory counter would be split across workers and reset by a restart. One statement
   writes every row, so the MAX is the last pass's timestamp exactly.
4. **It fails OPEN.** A throttle that cannot read its own watermark must not be the
   reason a live run never gets statistics; any error there runs the pass and warns.

The real fix is incremental accumulation — every aggregate in that statement is
combinable (`count`/`sum_value`/`sum_sq_value` add, `min`/`max` extend, `pct_agg` rolls
up), so a stable-prefix accumulator plus a recomputed tail would make each tick O(tick)
instead of O(run). That needs somewhere to keep the stable half separate from the
published total, i.e. a migration, and it was not done here. `ponytail:` throttle with a
known ceiling — ~4.3x one pass per run; upgrade to the accumulator if that still shows on
the I/O profile.

### The transaction rollup is written in two halves, and one can be silently empty

`transaction-stats-rollup` writes `test_run_transaction_stats` (from `transactions`) and `test_run_sampler_stats` (from `requests_raw`) in one transaction. It runs at position 4 of the analyze pipeline, ~0.2 s after the run is marked completed, and `requests_raw` ingestion can still be in flight then — observed up to 36 s past `end_time`. The transaction half succeeds, the sampler half aggregates an empty table, and the whole thing **commits looking healthy**. Nothing retried it, because `getRollupStatus` reads the half that did get written and answers `ready` forever after. Every transaction row-expand then falls to the CAGG path: 95 ms warm / 737 ms cold against 0.95 ms for the rollup read, on a 1.4 M-request run. Six of the ten most recent runs on the deploy where this was found were in that state.

The API now detects it on the read path — `repairEmptySamplerRollup` in `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` — and re-enqueues the job. Three rules if you touch it:

1. **The probe must stay strict, because the job deletes before it rebuilds.** `TransactionStatsRollupPipeline`'s first act is an unconditional delete of all three rollup tables for the run. A re-run you cannot be sure will rebuild both halves lets a *read* destroy a working transaction rollup. So one round trip checks every precondition the job has: `completed`, non-null `start_time` **and** `end_time` (all three of the pipeline's early returns — both timestamps are nullable in the entity and the DDL, so neither is implied by `completed`), rows in `transactions`, rows in `requests_raw` with `transaction_name IS NOT NULL` (mirroring `SAMPLER_ROLLUP_BASE_SQL`'s own predicate), zero sampler rows for the *whole* run, and the org filter. Loosen any of them and you get either data loss or a repair that re-fires on every expand forever.
2. **Do not time-bound the probe.** The rollup has no `time` predicate either, so a row arriving outside the recorded window — the 36 s-late case that causes this in the first place — is one the rollup would aggregate but a bounded probe would miss, stranding the run on the slow path. Unbounded is cheap: `test_run_id` leads `idx_requests_raw_test_run_id_time` and is the `compress_segmentby` key, so a miss is a 1.9 ms index-only descent with `Heap Fetches: 0`.
3. **The enqueue is deferred, the probe is savepointed.** `runAfterRequestCommit` keeps the Redis round trip out of the request's open RLS transaction — awaiting it holds a pooled Postgres connection idle-in-transaction for the length of a Redis stall, and at pool max 50 that starves unrelated endpoints from a cheap GET. The probe runs *inside* that transaction, so it is wrapped in a `SAVEPOINT`: an error there without one puts the transaction into 25P02 and the CAGG read this method exists to let proceed fails with "current transaction is aborted".

**The other reader of the transaction half is the Apdex SLO check, and on a re-evaluate it repairs an EMPTY rollup itself (v0.2.95.25).** `ApdexCalculator` takes a rollup fast path — since v0.2.95.32 one `unnest` statement for every transaction of the workload, per transaction before that — and falls back to a raw `transactions` scan for each transaction the rollup cannot answer. A run whose analyze died before position 4 has no rollup at all, and a re-evaluate has no rollup stage, so every re-evaluate of that run scanned raw: on WERKNL-00002 that was 317 per-transaction scans plus a `DISTINCT` over the run, 45 s for a check that takes under a second from the rollup. `ChecksPipeline.ensureTransactionRollup` now runs `TransactionStatsRollupPipeline` inline, before the checks transaction, when `test_run_transaction_stats` has **zero** rows for the run AND `transactions` has at least one. Four bounds keep it from becoming the problem it fixes:

1. **Re-evaluate only.** The re-evaluate orchestrator enqueues `checks-evaluation` with `repairRollup: true`; the analyze path never sets it, because its own `transaction-stats-rollup` stage ran three positions earlier and a soft-failed one re-run inside the checks stage's 600 s wall-clock race would abandon the checks promise (an orphaned `ChecksPipeline` then writes `valid = true` after the sanity check).
2. **One rollup per job.** `checks-evaluation` is not chunked and the orchestrator waits 30 min on it; N rollups of up to 540 s each would blow that, so the first run in the batch that needs one gets it and the rest take the raw path. A bulk of unrolled history is `apps/worker/scripts/backfill-test-run-stats-rollup.ts`'s job.
3. **The `transactions` arm is load-bearing.** The rollup deletes all three tables before it rebuilds, and a run with `requests_raw` but no `transactions` has an empty transaction half beside a populated sampler half that must not be wiped on every pass. `completed` / `start_time` / `end_time` are left to the rollup pipeline's own early returns (it then answers `skipped`, which the checks stage logs at warn).
4. **`ROLLUP_STATEMENT_TIMEOUT_MS` defaults to 540000, not 600000, from this version.** The pool's client-side `query_timeout` is 600000; at equal deadlines node-postgres tears the socket, `Connection terminated` is in `TRANSIENT_ERRORS`, and `db.transaction`'s `withRetry` re-ran the whole DELETE+INSERT rollup up to 3x while the orphaned statement kept running. Same rule as `AGGREGATION_STATEMENT_TIMEOUT_MS`.

Best-effort like `backfillMissingSketches` (a failure logs and the raw path runs as before), with no negative cache and outside `HeavyStageMutex` — exactly as the analyze stage that normally writes it. It is deliberately not gated on there being an Apdex benchmark: the rollup is what Performance Analysis reads too. The checks stage publishes no progress while the rollup runs, so on a run that takes longer than 5 min the UI blanks until the next stage starts; the scope lock is unaffected.

Two things it does not fix. If the job exhausts its BullMQ retries it stays in the failed set under the same jobId, where a later `add` is a silent no-op, and the repair goes quiet for that run until the failed job is cleared. And runs that can never gain sampler rows (no usable `requests_raw`) are left alone by design rather than re-probed on every click.

The matching operator tool is `apps/worker/scripts/backfill-test-run-stats-rollup.ts`, which now selects runs missing **either** half — its old transaction-only predicate skipped exactly these runs — and terminates on "a poll returned no ids it has not already served this invocation" rather than on an empty poll, since an unrepairable run stays a candidate forever and would otherwise pin the head of `ORDER BY end_time DESC LIMIT 50`.

### An Apdex SLO has a sample floor, and `meets_requirement = NULL` is "not evaluated", not "failed"

A transaction that ran twice scored 0.0 and failed the whole workload SLO. Since v0.2.95.34 every
Apdex SLO carries `benchmarks.apdex_min_samples` (default 50, migration 1808; `apdexMinSamples` on
`POST`/`PUT /benchmarks/apdex`, "Minimum samples per transaction" in both dialogs). A transaction
with fewer executions than the floor is still reported with its score and counts, but
`ApdexCalculator` writes `meets_requirement: null` with `below_min_samples: true` on its target
rather than a verdict. Four things about it are easy to get backwards:

1. **The floor counts EVERY execution, failed ones included — not the count that feeds the score.**
   `ApdexResult` carries two totals: `total_count` (the scored rows, success-only unless
   `include_failed_requests`) and `observed_count` (every row in the window). The floor is checked
   against `observed_count`, and the success filter moved from the `WHERE` into the per-aggregate
   `FILTER` so the SQL can return both from one scan. Checking the scored count instead would let a
   transaction with 960 errors and 40 successes read "too few samples" and pass, while a transaction
   with zero successes still fails on `NO_DATA` as before (`total_count = 0` is checked first, so the
   floor never turns a no-data failure into a pass).
2. **`NULL` counts as a pass in the run verdict, on purpose.** `ChecksPipeline` decides
   `valid` with `bool_and(COALESCE(meets_requirement, true))`, so an unevaluated transaction — or a
   workload SLO in which nothing at all reached the floor — does not fail the run. Every reader has
   to key on `=== false` for "failed", never on `!== true`: `slo-renderer` and `getSloSummary` in
   the report did the latter and drew a red FAIL pill for a NULL row until this version. They now
   render NULL as a neutral N/A (a warn ERROR pill when `status = 'ERROR'`), which also changes how
   pre-existing errored or NO_DATA aggregated checks render — from FAIL to ERROR / N/A, matching the
   worker's own verdict. Consolidated results and the Slack/Teams message builders still read "SLOs
   Passed" for a run in which nothing was judged; that tri-state is the open TODOS.md item.
3. **The column is nullable, and that is not a mistake to tighten.** `benchmarks` is a `core`
   resource in SUT-transfer bundles, and `sut-import.service.ts` inserts every table via
   `json_populate_recordset(null::t, $1::json)`, which yields NULL (not the column DEFAULT) for a
   key the bundle lacks. `NOT NULL DEFAULT 50` would therefore have rejected every pre-1808 bundle
   with 23502 and failed the whole import. So the migration adds `integer DEFAULT 50 CHECK (>= 1)`
   nullable, and every reader COALESCEs (`BenchmarkMatcher`'s two queries, `?? 50` in
   `BenchmarkMapper` and the API create/update paths). The same trap is armed for the next
   `NOT NULL DEFAULT x` column on any exported table — see the SUT transfer entry in TODOS.md.
4. **Existing `check_results` keep their stored verdict.** The floor is applied when the check runs,
   so a run evaluated before the SLO gained its floor still shows the old FAIL until it is
   re-evaluated. `requirement.min_samples` in the stored result says which floor was in force.

**Performance Analysis has its own, display-only floor (v0.2.96.7).** The card's Apdex column is
not a check result — it is `apdexScoreSql` read live off the rollup's all-rows sketch, which
includes the failed executions' response times, so a transaction that failed 100% of the time read
as "Excellent". `apdexRating` in
`apps/web/app/test-runs/[id]/components/performance-analysis/utils/performance-formatters.ts` is the
single gate every Apdex surface on that card now goes through (row, sampler, both detail modals,
the scenario row, the overall tile and the collapsed KPI): no successful executions → **No data**,
fewer than `APDEX_MIN_SAMPLES` (50, matching the SLO default) → **Too few**, and neither
contributes to `calculateScenarioMetrics`' weighted score, which weights by `passed_count` over the
scoreable rows only. It suppresses the rating, it does not change the SQL — a transaction that
failed *most* of its executions still shows a score computed partly over failures. Fixing that
means switching the four `apdexScoreSql` sites still on `pct_agg` to `pct_agg_passed`, which the
four CAGG sites already use, and handling rows written before #298 whose `pct_agg_passed` is NULL.

Residue: the rollup fast path and the raw `transactions` fallback in `ApdexCalculator` count the
window differently (the raw scan applies only the start offset and drops NULL response times), so a
transaction near the floor can be "Too few" on one path and evaluated on the other. Also in
TODOS.md.

### A Trend SLO judges the slope of a series, and `%/h` is its unit whatever the panel measures

A run whose response times climb for the whole steady state passes every scalar SLO — the average,
the p95, even the last value can all sit under the threshold — and when every baseline run
degrades the same way, ADAPT passes it too (WERKNL-00011, `WNL_WG_EXTRA_10_VolgendeCV`: +26 %/h at
r 0.66, green everywhere). Since v0.2.96.4 `evaluate_type = 'trend'` judges the drift *within* the
run: `StatisticsPipeline` writes `ds_metric_statistics.trend_pct_per_hour` (the OLS slope of value
against time, normalised to % of the series mean per hour so one threshold fits a 40 ms and a 4 s
series alike) and `trend_corr` (Pearson r), and `DataAggregator` maps `trend` onto the first the
way it maps `avg` onto `mean`. Five things about it are easy to get backwards:

1. **A slope is only judged when it is a trend, and a non-trend PASSES (v0.2.96.7).** A series with
   `|r| < TREND_MIN_CORR` (0.5), fewer than `TREND_MIN_POINTS` (10) points, or a NULL/NaN r (a
   constant series has no correlation; one NaN sample poisons `corr`) is reported with its slope and
   `trend_corr`, flagged `weak_trend: true`, and written `meets_requirement: true` — the SLO exists
   to flag a series that *is* drifting, so nothing to flag is nothing to fail, and judging the noise
   slope against the threshold would be a verdict on a number the floor already called meaningless.
   It is still left out of the panel average, so an unjudged value cannot tip an `average_all`
   verdict. Until v0.2.96.7 it was `meets_requirement: null` (the Apdex tri-state) and a check whose
   series were all weak read `None of the N targets could be evaluated`; both now read as a pass.
   The floors are module constants in `DataAggregator`, not benchmark columns (TODOS.md). The
   "nothing was judged" arm survives for the **match pattern**: an SLO of any type whose pattern
   excludes every series on a run is `meets_requirement: null` with that message, never an
   affirmative pass. The run verdict is unchanged either way
   (`bool_and(COALESCE(meets_requirement, true))`), and readers key on `=== false` as before. The
   series table renders `+12.3 %/h (r 0.66)`, and a weak row gets a pass-styled "No clear trend"
   chip in place of a bare Pass. The failed count in the message counts `meets_requirement ===
   false` rows only — it used to count every target with a value, so `15 of 15 targets failed` when
   one did.
2. **`metric_unit` is `%/h`, and three writers enforce it.** The slope is a percentage of the
   series' own mean, so the panel's unit is meaningless for it. `BenchmarkMutationService`
   (`TREND_UNIT`) forces it on create and update, and on an update that switches *away* from trend
   restores the panel unit from the merged `configuration.yAxesFormat`, writing `null` rather than
   `undefined` because TypeORM's `update()` skips undefined keys and would leave `%/h` on an average
   SLO. `ProfilesService` forces it on profile benchmarks and clears it on a switch away unless the
   update resends `metricUnit` (grafana-sync copies the profile's unit verbatim, so it inherits the
   rule); `ProvisioningService` forces it on provisioned ones. The web side matches:
   `getUnitChipLabel` answers `%/h` for a trend, and both SLO handlers skip the `percentunit` ÷100
   on save, which would otherwise turn a 10 %/h threshold into 0.1. A fourth writer needs the same
   two lines, or the SLO card shows the panel's unit against a percentage.
3. **Migration 1809 adds the columns; nothing backfills them.** Rows written before it hold NULL
   until the run's statistics are recalculated (a re-evaluate with "recalculate statistics", or the
   Recalculate baseline statistics button), and NULL is "no value" to `DataAggregator`: the series
   produces no target at all, so a trend SLO on an old run is `ERROR` / `No targets found for
   processing`, not a weak trend. `upsertPerfTestStatistics` — the live tick's writer — sets both
   columns to NULL on every conflict on purpose: it recomputes `mean` over the re-collected rows and
   must not keep a slope computed over the previous ones, so during a live run every perf-test
   series is absent to a trend SLO until `statistics-calculation` runs. The ALTER itself takes
   `lock_timeout` 3 s with a plpgsql retry (same discipline as 1795): the table is held for up to
   540 s by a running aggregation, and an unbounded ALTER would queue every read behind it. A
   worker rolled out before the migration lands fails every `statistics-calculation` and
   `checks-evaluation` with 42703 — the worker has no boot-time column probe (TODOS.md).
4. **A constant series is a flat line, not "no data".** `regr_slope` is 0 for it, but the
   normalisation divides by `ABS(AVG(value))`, which is 0 for an error count with no errors. The
   SQL is `CASE WHEN AVG(value) <> 0 THEN slope * 3600 / ABS(AVG(value)) * 100 WHEN MIN(value) =
   MAX(value) THEN 0 END`, so that series emits `0` and takes the weak-trend path (its `corr` is
   NULL) instead of vanishing from the targets. The same reasoning skips the single-constant-series
   artificial `default` shortcut for trend: judging a flat series on its `mean` would compare a
   value in the panel's unit against a threshold in %/h. The one artificial row a trend does judge
   is the `validate_with_default_if_no_data` default, whose value sits in `mean` and is taken as
   the slope it claims to be.
5. **`date_part('epoch', time)`, not `EXTRACT`.** On PG14+ `EXTRACT` returns `numeric`, and the
   per-row numeric divide and cast cost +75 % on a 1.66 M-row run (measured); `date_part` is
   `float8`. The `/ 3600` is applied once, after aggregation, which is exact because the slope is
   linear in x.
6. **The chart opens on ONE series, and a single-point series must not be a bar (v0.2.96.8).**
   Every series of a panel on one linear axis is unreadable for a trend — the question is the
   shape of one series' drift — so `defaultTrendTarget` (`metric-series-table-utils.ts`) opens on
   the failing series, else the steepest, and the table underneath is the selector. Deselecting
   stores `''`, never a deleted key: a deleted key reads as "never touched" and the row snaps
   straight back to the auto-pick. The fitted line (`buildTrendLineTrace`) draws the **stored**
   `%/h`, never a refit — a refit would disagree with the number in the row beside it — anchored
   on the mean of the charted points inside `analysisWindowBounds`, the same bounds
   `buildChartLayout` shades to (that mean is not the worker's normalisation base; see TODOS.md).
   No requirement line is drawn for a trend: the threshold is in `%/h` and the axis is the panel's
   own unit. Colour comes from the worker's `meets_requirement`, because "every value under the
   requirement" is a level test and a trend judges slope. The single-point rule is **not**
   trend-specific: a one-point series drawn as a **bar** puts Plotly's x-axis into category mode,
   so every timestamp of every other series on the panel becomes its own tick label — the wall of
   dates that hit average and maximum SLOs too. Bars only when nothing on the chart is a time
   series. `formatTrendPctPerHour` (`slo-formatters.ts`) is shared by the table and the fitted
   line's legend label, so the two cannot format the same number differently.

Residue: the floors are not per-SLO, the stored result does not say which floor applied (unlike
`requirement.min_samples` for Apdex), and `GET /metrics/ds-metric-statistics`' default
`evaluateType` list does not include `trend`. The chart's fitted line has two of its own: it is
normalised by the charted mean rather than the worker's, and it can be drawn from a `%/h` fitted
under analysis offsets that have since changed. All in TODOS.md.

### A profile SLO can target the perf-test scenario dashboards, and the profile row is a regex

Auto-config provisions `benchmarks` rows from `profile_benchmarks` by matching
`application_dashboards.template_dashboard_uid` against the profile row's `dashboard_uid`. The
worker-written `Performance test metrics <scenario>` dashboards have no template (`DashboardManager`
writes `template_dashboard_uid` NULL), so before v0.2.96.6 no profile could reach them and every
per-scenario SLO was clicked in by hand (22 on WERKNL). A profile benchmark with
`source = 'performance-metrics'` (`PERF_TEST_PROFILE_SOURCE`, `packages/shared/src/constants/perf-test-profile.ts`)
has `profile_dashboard_id` NULL (migration 1810 dropped the NOT NULL) and its `dashboard_uid` is a
**regex** over the app-dashboard uid; `BenchmarkProcessorService` fans it out over every matching
scenario dashboard of the SUT/env/org through `findApplicationDashboardsByUidPattern`. Six things hold
it together:

1. **The regex is validated twice and pinned once.** `ProfilesService.resolveDashboardColumns` and
   `ProvisioningService` reject it with `validateRegexPattern` on write; the processor re-checks it
   before the query (rows written by SQL); the finder ANDs `LIKE 'performance-test-metrics-%'` so a
   stray `.` cannot fan an SLO out over the SUT's Grafana and Dynatrace dashboards. It runs in
   Postgres ARE, is validated by the JS engine — keep patterns to the common subset (`\b` is a
   backspace in ARE). The default excludes `all-aggregated` and `default`, and because the uid is
   lossy so is a real scenario literally named either (decision D2, 2026-09-22: keep both excluded).
2. **`resolveDashboardColumns` is shared by create and update**, so a `PUT` that switches source
   re-resolves `profile_dashboard_id` / `grafana_instance` / `dashboard_uid` the way `POST` does.
   Cleared columns are written as `null`, never `undefined` — TypeORM's `save()` skips undefined and
   the old template label would survive the switch.
3. **The panel list is static.** The SUT dialog reads panels from `ds_metric_statistics`; a profile
   has no run to read, so `PERF_TEST_PROFILE_PANELS` is a hand copy of the worker's
   `METRIC_TYPE_PANEL_NAMES` pinned by `perf-test-profile-panels.test.ts` — minus 301-303, whose
   single point at `end_time` is flagged `ramp_up` by any ramp-down offset and never gets a
   statistics row (TODOS.md, Worker pipeline). `panelId` is validated against it.
4. **`AutoConfigService.loadAutoConfigContext` must not abort on zero profile dashboards.** It used
   to, before the benchmark step ran, so a JMeter-only org with a perf-test-only profile was never
   provisioned — the WERKNL e2e passed only because its profile also carried a Grafana template.
5. **`findApplicationDashboardsByUidPattern` fails closed without an org.** SUT names are unique per
   organization only; the sibling template lookup still has the legacy `OR IS NULL` arm.
6. **The fan-out catches per dashboard.** One 23505 (two grafana-sync replicas on the same tick) or
   a transient error used to abort the remaining scenarios of that pass.

Two bugs came out with it. `insertBenchmarkBasedOnProfileBenchmark` never wrote
`benchmarks.evaluate_type` — only `configuration.evaluateType` — and the worker reads the column
(`benchmark.evaluate_type || 'mean'`), so every profile-provisioned SLO was judged as an average
(12 `max` SLOs on the dev DB); migration 1810 backfills it and verdicts may change on the next
evaluation. And `mapAggregationTypeToField` had no `q50` key while both SLO dialogs offer it.

Residue: provisioned rows are write-once and the 5-minute auto-config window can miss a scenario
dashboard written by a parked analyze (both TODOS.md); the profile form has no field for the regex
(API only).

### The perf-test error-rate SLO reads the transaction rollup, not the mean of the buckets

The stored series on the perf-test **Transaction Error Rate** (panel 105) and **Request Error
Rate** (205) is `errors / count` **per bucket**, and `ds_metric_statistics.mean` averages those
buckets unweighted: a bucket holding one failed execution counts 100 %, beside a bucket of 40
successes at 0 %. On a sparse transaction the SLO read 10.97 % where Performance Analysis showed
7.49 % for the same run and window (WERKNL-00011, `WG_VAC_16_Stuur_Email`). Since v0.2.96.1 an
`avg` check on those two panels is the rollup's third reader: `DataAggregator.pooledErrorRates`
substitutes `SUM(failed_count) / SUM(total_count)` from `test_run_transaction_stats` /
`test_run_sampler_stats` for `mean` before the targets are built, the same figure Performance
Analysis and the Apdex fast path use. `max` and percentile checks on these panels still read the
per-bucket series. Five things about it are deliberate:

1. **Scoped by the pipeline-written label, never by `benchmarks.dashboard_label`.** The scenario
   comes from `ds_metric_statistics.dashboard_label` (`Performance test metrics <scenario>`
   verbatim; the uid is lossy), and a label the prefix does not match returns an empty map. The
   benchmark's own label column is nullable and user-editable, so it is neither safe to dereference
   nor to scope by. The `all aggregated` dashboard pools every scenario into the one `All aggregated`
   series; the processors label a NULL scenario `default` where the rollup writes `''`, and the query
   maps between them. The web's Performance Analysis overview has a third spelling,
   `NO_SCENARIO_LABEL`, and `scenarioFilterKey` (`performance-analysis/utils/scenario-filter.ts`)
   maps `default` onto it for the row menus' same-tab "View in Performance Analysis" drill-down — so
   a scenario literally named `default` cannot be drilled into (TODOS.md, "Row-menu drill-downs").
   The perf-test source is proven by an `EXISTS` on `metrics_sources`
   `(system_under_test_id, test_environment, external_ref = dashboard_uid)` rather than the
   `application_dashboards.metrics_source_id` FK, which `DashboardManager` never populates for these
   rows (TODOS.md).
2. **Always the `ramp_up_excluded = true` row.** That is the window the bucket mean it replaces was
   computed over (`ds_metric_statistics` holds `ramp_up = false` only), and
   `benchmarks.exclude_ramp_up_time` has never applied to metric SLOs.
3. **A miss keeps the bucket mean, and says so.** A series the rollup does not know falls back to
   `mean` and is named in a worker warning (`Pooled error rate unavailable for N/M series on panel
   …`); a rollup read that throws logs the cause at error and falls back the same way, so a missing or
   half-written rollup is visible rather than silent and never turns a verdict into "no result". Two
   misses are expected and not warned: the artificial `default` row from
   `createArtificialMetricStatistic`, and on panel 205 a sampler outside any Transaction Controller
   (stored under its bare name; `SAMPLER_ROLLUP_BASE_SQL` drops NULL-transaction rows, so it never
   has a rollup row).
4. **The request-level series name is one shared SQL fragment.** `samplerMetricNameSql` in
   `apps/worker/src/constants/performance-metrics.ts` (drop the transaction prefix when it is NULL,
   `''`, `overall` or equal to the sampler) is used by the writer (`requests-processor.ts`) and by
   this reader. A second copy would drift silently: the failure is a map miss and a bucket-mean
   fallback, not an error. The web has an unavoidable TypeScript mirror of both rules —
   `perfTestSeriesRef` in `apps/web/app/test-runs/[id]/components/shared/metric-card-links.tsx`
   composes the label (`Performance test metrics <scenario>`, NULL scenario `default`) and the
   `transaction.sampler` name for the row menus' "Open in Graphs / Compare / Trends" links
   (v0.2.96.5). Its failure mode is just as silent: the cascade disarms at the first level it
   cannot match and the series picker stays empty. `metric-card-links.test.ts` pins the prefix rule;
   change `samplerMetricNameSql` or `generateScenarioDashboardLabel` and change that mirror too.
5. **It inherits the rollup's stale states.** The verdict is now pinned to a table that can be
   *partial* (a sampler half written while `requests_raw` was still ingesting) or *behind* (an
   analysis-window change enqueues the rollup and the re-evaluate independently), and the fallback
   fires only when the row is *absent*. Both are in TODOS.md under "The error-rate SLO is now pinned
   to the transaction rollup". Existing `check_results` keep their stored value until the run is
   re-evaluated.

### `ds_metrics` carries one group-key statistics object, on the PARENT

`StatisticsPipeline` groups `ds_metrics` by `(test_run_id, application_dashboard_id, panel_id,
metric_name)`. Postgres has no combined `n_distinct` for that tuple and derives one that lands far
too high — measured on production, **8,404,581 estimated groups against 20,598 actual (408x)**. That
one number costs twice:

- The planner sizes the hash table off it, decides a sort is cheaper, and spills:
  `external merge Disk: 5205304kB` on 20.6M rows. **Raising `AGGREGATION_WORK_MEM` does not help** —
  the choice is made on the estimate, not on what the aggregation needs.
- It suppresses parallelism, because gathering millions of estimated rows looks expensive.

`1801000000000-AddDsMetricsGroupKeyStatistics` fixes it with **one** `CREATE STATISTICS (ndistinct)`
on `public.ds_metrics` plus a daily `ANALYZE` of the parent.

**The parent is the whole point, and putting it on chunks instead makes the migration silently
inert.** The real aggregation joins `ds_metrics` to the `run_orgs` MATERIALIZED CTE and semi-joins
`allowed_dashboards`. Those joins block TimescaleDB's chunkwise-aggregation pushdown, so the plan
carries a single `GroupAggregate` **above** the joins rather than a `Partial HashAggregate` per
chunk, and `estimate_num_groups` resolves the grouping Vars to the parent relation. Measured on the
real query with the same data, only the object moved:

| Statistics object | Estimate | Actual | Error |
|---|---|---|---|
| per chunk | 741,991 | 17,882 | 41x |
| **on the parent** | **21,372** | 17,882 | **1.2x** |

A join-free query (`SELECT dashboard, panel, metric, count(*) FROM ds_metrics WHERE test_run_id = …`)
*does* get the per-chunk pushdown and *does* read per-chunk objects. That is what makes this an easy
mistake: it benchmarks beautifully and then does nothing for the query you care about. Always confirm
a `Partial HashAggregate` exists in the **real** plan before reasoning about per-chunk statistics.

Two operational notes:

- **The daily `ANALYZE` job is not optional.** Autovacuum analyzes chunks, never an inheritance
  parent, so without `job_analyze_ds_metrics` the statistics object exists and holds nothing. If the
  estimate looks wrong again, check `stxdinherit` is `true` and the job is succeeding:
  `SELECT s.stxname, d.stxdinherit, d.stxdndistinct FROM pg_statistic_ext s JOIN pg_statistic_ext_data d ON d.stxoid = s.oid WHERE s.stxname = 'ds_metrics_groupkey';`
- Needs **PG15+** for `pg_statistic_ext_data.stxdinherit` (extended statistics across an inheritance
  tree). The image is `timescaledb-ha:pg15`. On an older server the CREATE succeeds and ANALYZE
  collects nothing, so it degrades to a no-op rather than breaking.

**A dev database reproduces the estimate but not the timing.** The bad plan shape and the 41x error
show up on a few million rows; the 5.2 GB spill needs production scale.

### `ds_metric_statistics` is not a faster `ds_metrics`

It looks like the obvious source for anything that needs to know which metrics a run has: already
aggregated, one row per `(test_run_id, application_dashboard_id, panel_id, metric_name)`, and the
panel-dropdown query reads it in **59 ms** against 2035 ms over `ds_metrics`. Sourcing a picker from
it is wrong twice over, and both failures are silent — the endpoint returns a plausible, shorter
list rather than an error.

1. **It has two writers on different schedules, so "non-empty" does not mean "complete".**
   `StatisticsPipeline.aggregateMetricStatistics` writes the Grafana and Dynatrace panels
   atomically, in one `withAnalyticsTransaction`, at analyze time.
   `upsertPerfTestStatistics` (`apps/worker/src/pipelines/helpers/perf-metrics-writer.ts`) writes
   **one `INSERT … SELECT` over `ds_metrics`, on every incremental tick of a live run** (it reads
   the run rather than the tick, so a live run's numbers are cumulative and its percentiles no
   longer shift when analysis lands). So for the whole duration of a
   running test the table holds performance-test rows and nothing else. A read that treats a
   non-empty result as ready therefore returns the perf-test panels and omits every Grafana and
   Dynatrace dashboard for that run — and because the result is not empty, a "fall back when empty"
   guard never fires.
2. **It is filtered, so it is strictly narrower than the chart it would feed.** Rows exist only for
   `ramp_up = false AND value IS NOT NULL AND application_dashboard_id IN (allowed_dashboards)`
   (`StatisticsPipeline.ts:439-442`). A metric that reports solely during ramp-up, or is all-NULL,
   or sits on a dashboard outside the run's org scope, has no row at all — while `getMetricTimeSeries`
   still plots its points, since `excludeRampUp` defaults to `false`. The picker would then offer
   fewer metrics than the graph endpoint can draw, on a run whose other metrics all return rows, so
   again nothing looks broken.

The distinction to hold on to: `ds_metric_statistics` answers "what did analysis measure",
`ds_metrics` answers "what did the run record". Anything feeding a chart wants the second. Where the
first is genuinely the right source — the sparse-metric check in `DataSanityCheckPipeline`, item 7
above — that is a deliberate change in what the number means, and it is documented as one.

### The perf-test pipeline writes one extra dashboard, and its series name was already taken

`PerformanceTestMetricsPipeline` writes one dashboard per JMeter/Gatling scenario. Since v0.2.95.4
it writes one more: **`Performance test metrics all aggregated`** (uid
`performance-test-metrics-all-aggregated`), generated from the pseudo-scenario
`ALL_AGGREGATED_SCENARIO = 'all aggregated'` in
`apps/worker/src/constants/performance-metrics.ts`. It carries the same panels as any scenario
dashboard with exactly **one** series on each, named `All aggregated`, rolled up over every
scenario, transaction and sampler in the run.

It is an ordinary `application_dashboards` + `metrics_sources` row with the usual
`performance-test-metrics-` uid prefix, so all four dropdown surfaces — the trends, compare and
graphs cards and the report configuration cascade — list it with no client-side plumbing at all.
That is the design; do not add a special case to surface it.

Seven things a future reader will otherwise "fix":

1. **The roll-up is a second `GROUPING SETS` entry — one of three — and it is free.**
   `transactions-processor.ts` and `requests-processor.ts` add `(bd.bucket_time)` for the run-wide
   roll-up and `(bd.scenario_name, bd.bucket_time)` for the per-scenario `total` series, beside the
   existing group key. It shares the
   one scan, and the percentiles and Apdex brackets are computed over the raw rows — exact, not an
   average of per-transaction values. Measured *faster*: requests 2994 ms → 2337 ms on a 1.4 M-row
   run. The ordered-set aggregates (`PERCENTILE_CONT`) had already ruled out a HashAggregate, so
   Postgres serves both levels from one sort, and `bucket_time` at the head of that sort matches the
   hypertable's physical order and earns an Incremental Sort. Splitting it into a second query or a
   JS pass over the per-transaction rows costs a scan and loses the exact percentiles.
2. **The `ORDER BY` was deleted from both queries, deliberately.** It used to be a prefix of the
   group-key sort and therefore free; with `bucket_time` now leading that sort it is a second,
   top-level sort that spills — 22 MB (requests) / 3 MB (transactions) on that same run, growing
   with the number of series. No consumer reads row order: the aggregate feeds an
   `INSERT … SELECT` and never reaches JS.
3. **It is display-only — no `ds_compare_config` rows are written for it**, in any of the four
   processors, so ADAPT never evaluates it. A run-wide average moves whenever the traffic mix
   shifts, so trending it would fail runs in which no individual transaction regressed. Adding the
   configs is a one-line change that puts every run's verdict at the mercy of its mix.
4. **`DataSanityCheckPipeline` excludes the scenario-level panels by TITLE** — `Error Count`,
   `Avg Active Threads`, `Max Active Threads` — not only by metric name. Those panels hold one point
   by construction (written once at `end_time`). The pre-existing exclusion matched the
   *per-scenario* metric-name spelling; on this dashboard the same three metrics are named
   `All aggregated`, so without the title filter every run reports three sparse metrics, forever.
5. **`All aggregated` was already a name, and the guards separating the two are load-bearing.**
   `ALL_AGGREGATED_OPTION = 'All aggregated'` in `apps/web/lib/aggregated-perf-series.ts` has been a
   **synthetic** dropdown entry since v0.2.61 — offered on ten response-time panels only, and
   answered by `GET /test-runs/:id/aggregated-metric-timeseries`, which computes a run-wide figure on
   the fly precisely because no stored row existed for it. On the new dashboard the identical string
   is an ordinary `ds_metrics` / `ds_metric_statistics` row, on *every* panel. Four guards keep them
   apart and each one fails silently if removed:
   - `shouldOfferAllAggregated(source, panelId, existingNames)` — the third parameter is **required
     and must stay required**. Defaulting it to `[]` reads as "the name is not already there, so
     offer it", i.e. fail-open, and the dropdown lists the entry twice.
   - `isAllAggregatedDashboard(labelOrUid)` at the three web add-series sites (`useTrendsData`,
     `useGraphsData`, `useCompareHandlers`). On this dashboard the name must not be routed to
     `/aggregated-metric-*`, whose spec covers ten panels and returns nothing for the rest. Since
     v0.2.95.31 the three cards pick series through one shared
     `apps/web/app/test-runs/[id]/components/shared/MetricSeriesCascade.tsx` (option loaders in
     `shared/metric-options.ts`; `compare/utils/metric-options.ts` is a re-export shim), and its
     `storedName` is a fourth site: it composes the stored name only off this dashboard, so an
     already-added aggregate greys out in the picker.
   - `isSyntheticAllAggregated()` in `apps/api/src/modules/reports/services/url-perf-panels.ts`,
     folded into the three interception sites in `report-data-fetcher.service.ts`. That one was a
     real bug, not a precaution: a report selection on the new dashboard was intercepted, so on
     panels 101-104 / 201-204 the report answered from a *different* computation than the stored row
     (a raw `PERCENTILE_CONT` over the run against the pipeline's per-bucket roll-up), and on every
     other panel `aggregatedKindFor` is null, so the name was stripped from the selection with
     nothing substituted and the section rendered blank.
   - `presetAggregateSpec()` in the same file (v0.2.95.5), read by `getGraphPresetPanels` and, since
     v0.2.95.31, by `getTrendsPresetSeries` (a Custom Graphs section can also select **trends
     presets**, `trendsPresetIds`). A saved **graph preset** or **trends preset** stores the composed
     name `All aggregated — <panel title>` rather than the bare option, so this one matches on the
     PREFIX; drop its `ALL_AGGREGATED_DASHBOARD_LABEL` check and a preset on the real dashboard is
     answered from the raw tables instead of its own stored row.
     Its panel table `AGGREGATED_PERF_SPECS` is a hand copy of `AGGREGATABLE_PERF_PANELS`, pinned
     against drift by `url-perf-panels.spec.ts`. It does **not** check `series.source`, matching
     `useGraphsData`'s restore path, which does not either — a Grafana panel in the 101-105/201-205
     range whose series is named `All aggregated …` is misrouted identically in both, so the report
     agrees with the card. Fixing that means fixing both sides at once; see TODOS.md.

   The dashboard label and uid are **duplicated as literals** in `aggregated-perf-series.ts` and
   `url-perf-panels.ts` rather than imported from the worker: the worker derives both from
   `ALL_AGGREGATED_SCENARIO` through `generateScenarioDashboardLabel` /
   `generateScenarioDashboardUid`, so sharing the constant would share the wrong half.
   `apps/worker/src/test/unit/pipelines/all-aggregated-dashboard.test.ts` pins those generators to
   the exact literals so the copies cannot drift unnoticed.

   **`ReportDataFetcherService.getAggregatedSeries` must stay value-identical to
   `/aggregated-metric-timeseries`, not merely equivalent.** The Graphs card draws a preset's
   synthetic series from the endpoint and the report draws the same series from this method, side by
   side in the same review. Two things were divergent until v0.2.95.5, and both were invisible —
   the report rendered a plausible line, just not the card's. It used exact `PERCENTILE_CONT` where
   the endpoint uses `approx_percentile(percentile_agg(...))` (measured up to 21% / 580 ms apart on a
   spiky p95 bucket; exact is the better number in isolation and the wrong one here), and it applied
   only the START of the analysis window. That second one also broke a single chart internally:
   `ds_metrics.ramp_up` is baked to exclude the ramp-DOWN band too, so a stored series and an
   aggregate on one preset chart ended at different x positions. `getAnalysisWindowBounds` now
   returns both cutoffs and `getRampUpCutoffTime` delegates to it.

   The per-run twin is `getAggregatedTrendValues` (v0.2.95.31), which must stay value-identical to
   `/test-runs/:id/aggregated-metric-statistic` (`getAggregatedMetricStatistics`): same rollup
   tables (`test_run_transaction_stats` / `test_run_sampler_stats`), same
   `bool_or(ramp_up_excluded)` window rule, same tdigest estimators. Both the Trend Charts section's
   `getAggregatedTrends` and a Custom Graphs trends preset read through it — the former used a raw
   `PERCENTILE_CONT` over `transactions` until then, so the report's aggregated trend line was not the
   Trends card's line. Trends presets take their runs from `getTrendRunWindow`, the Trend Charts
   window (same workload, completed, not stale, since the last ADAPT change point, at most 10 runs)
   without `getTrendsData`'s per-run percentile LATERAL.
6. **A real scenario literally named `all aggregated` has its own row dropped in favour of the
   roll-up.** Both datasets land on the same dashboard and the two rows share
   `(dashboard, panel, metric_name, time)` in one statement, which Postgres rejects outright and
   which would fail the whole pipeline — a unique violation on a full collection's plain `INSERT`,
   a `cardinality_violation` on an incremental tick's `ON CONFLICT DO UPDATE`. `ErrorsProcessor` (both branches) and
   `VirtualUsersProcessor` filter the real scenario out before appending the roll-up; the request and
   transaction processors get it from the grouping set, where the roll-up row is the one with
   `GROUPING(bd.scenario_name) = 1`. Losing one pathologically-named scenario's row beats failing
   every run.
7. **The virtual-user roll-up is JS arithmetic, and grouping the raw rows does not work.**
   Concurrent threads add across scenarios, so the run-wide figure is a sum — but each scenario's
   average covers only its own samples, so a scenario active for a fraction of the run would
   otherwise contribute its full average to the whole run. `VirtualUsersProcessor` weights each
   scenario's average by its sample count against the longest-running scenario, which is that
   fraction. Summing raw `virtual_users` rows grouped on `time` was tried and rejected: the samples
   are sub-second and independent per scenario, so on real data only 6,662 of 128,919 distinct
   timestamps carry more than one scenario and the sum degenerates to individual sample values —
   **65.7 against an actual 1249**. The exact answer needs `time_bucket_gapfill` + `locf` per
   scenario, which needs both window bounds, and `end_time` is null on a running test. The max is
   the plain sum of per-scenario maxima — an upper bound when scenarios peak at different moments,
   marked with a `ponytail:` comment rather than silently presented as a true peak.

The roll-up is written at ingestion, so it appears on runs analysed from v0.2.95.4 onwards;
re-analysing an older run produces it.

**Transaction Concurrency (108) / Request Concurrency (219) are the Top 10 ranking figure inside
ADAPT (v0.2.95.38 as "Impact" in ms/s; renamed and made unitless in v0.2.95.41).** Each is
`SUM(response_time) / 1000 / bucket_seconds` — `throughput x avg_rt`, i.e. the average number of
requests of that transaction in flight (Little's law: 4.8 means ~4.8 always being served; the sum
over all transactions is the run's total concurrency, ≈ thread count in a closed model with no
think time). `SUM(value x 1000 x bucket)` over the analysis window approximates
`test_run_transaction_stats.impact_score` (exact except for NULL response times, which the rollup's
`AVG x COUNT(*)` counts and `SUM` skips, and for a window edge inside a bucket). `response_time` is
integer, so the `::double precision` cast before `/ 1000 / $4` is load-bearing — `$4` is only float
there because of the `INTERVAL` above. The division by `$4` is load-bearing too: bucket size is a
step function of run length (15 s → 30 s at ~62 min), so a per-bucket sum doubles when a run
overruns a boundary and ADAPT flags every series. Both are classified `RED_duration`, lower is
better, `mean`, unit `''`. Five more things. **Runs analysed on v0.2.95.38–40 hold the panel in
ms/s under the old title** — same `panel_id`, so they pool into the baseline 1000x too large until
force re-fetched. The tell is NOT in the new run's ADAPT table — `ds_adapt_results.panel_title`
comes from the test run, so it reads `Transaction Concurrency` throughout — it is
`ds_control_group_statistics.unit = 'ms/s'` on panel 108/219, or a control value ≈ 1000x the
test value. Two runs need the same force re-fetch and are not caught by "analysed on .38–40": a
run that was **live** across the deploy (the `tail` plan keeps its pre-deploy buckets in ms/s and
certifies the run final, and the statistics row's `MIN(unit)` hides the mix), and any regression
**tracked** on the panel in that window (the historical control group is frozen and title/unit
agnostic, so the tracked result re-judges as a ~99.9 % `improvement` until every run of that
group is re-fetched). The incremental upsert also updates `panel_title`/`dashboard_label` from
this version, so the 60 s tick overlap no longer leaves the new value under the old title.
Two more things saved in that window key on the old shape and are not touched by a re-fetch: a
graph/trends/report preset stores the literal `panelTitle`, so one saved as `Transaction Impact`
matches zero rows on a newer run and the series silently vanishes (re-save it); and an
`absoluteThreshold` on the 108/219 compare config was entered in ms/s and is now 1000x too lax
(divide it by 1000 or clear it — the pipeline's `ON CONFLICT DO NOTHING` never rewrites it).
What the number is sensitive to depends on the load model: with a fixed arrival rate (open model)
its percentage change is identical to RT Avg's, and with fixed threads and no think time it is
pinned at the thread count and an RT regression surfaces on the Throughput panel instead — its
own signal is the *absolute* cost a shift adds to the run, and because ADAPT's pct check is
mandatory for a full `regression` (an `absoluteThreshold` alone yields `partial regression`, a
difference not a regression), the sub-15% case it exists for is caught only by lowering
`percentageThreshold` on this panel's own compare config — and the IQR check, when valid, must
agree too, or the label stays `partial regression`. A run finalised before the deploy never gains
the panel from a plain re-analyse: the perf-test stage `skip`s a finalised run, so only a **force
re-fetch** writes it (a live run straddling the deploy likewise gets a series that starts at the
deploy, via the `tail` plan) — but not on a SUT-imported run without `requests_raw`/`transactions`:
the force path deletes the perf-test rows first and cannot rebuild them (TODOS.md, Worker
pipeline). Against a baseline with no control row the result is `incomparable`, but
`ControlGroupStatisticsPipeline` pools whichever control runs have the row, so the first runs after
the deploy are judged against a 1-, 2-, 3-run baseline on this panel only — expect noisier
verdicts until the group fills. And the request id is 219, not 210, because 210-218 are the web's
**virtual URL panels** (`isUrlPanel` in both `url-perf-panels.ts` files) and a stored 210 would be
routed through the sampler-URL rollup — `isRequestPanel` lists the stored ids (201-209, 219) for
the same reason.

### ADAPT runs with JIT off, on purpose

`AdaptPipeline` sets `jit = off` for its own transaction (`set_config('jit','off',true)`, first
statement inside `withAnalyticsTransaction`). It is **not** in the shared helper, and moving it
there would be a regression.

Postgres decides whether to JIT from the estimated **plan cost**, which is driven by row count.
JIT's compile cost is driven by how large and deeply nested the compiled expressions are. The
`ds_adapt_results` upsert is where those two diverge: a generated jsonb target list
(`buildStatisticsColumns` + `buildConclusionLogic` + the three threshold CTEs) over a moderate row
count, estimated at 2,561,177 — clearing `jit_above_cost` and the 500k inline/optimize thresholds,
so LLVM runs -O3 over it. Measured on a 20,598-metric run: **64,215 ms in the JIT footer** on an
87.3 s statement that takes 13.3 s with JIT off. Read the JIT footer figure, not the totals — the
two arms ran in sequence so the second had a warmer cache, and ~9.8 s of the gap is unexplained.

Do not generalise it to "many functions compile slowly": `StatisticsPipeline` compiles **102**
functions in 2,155 ms against this one's **73** in 64,215 ms, and both clear the same thresholds.

The other two `withAnalyticsTransaction` callers were measured and deliberately left alone:

| Pipeline | JIT on | JIT off | Verdict |
|---|---|---|---|
| `AdaptPipeline` upsert | 87,308 ms | 13,255 ms | off — the 64.2 s is compile |
| `StatisticsPipeline` | 157,032 ms | 174,672 ms | **keep on** — pays across millions of rows |
| `ControlGroupStatisticsPipeline` | cost 93,338 | — | never JITs (under `jit_above_cost`) |

Two things follow. `AdaptPipeline` never calls `setAggregationBudget`, so it runs on the **120 s**
`ANALYTICS_STATEMENT_TIMEOUT_MS` cap, not 540 s — at 87.3 s a single run was at 73% of budget and
the 2-run batch that surfaced this was at 109 s (91%), so this was a cancellation waiting to
happen, not just slowness. And the hardcode cannot backfire on a large batch: rows scale with
batch size while the compile cost stays fixed, so JIT would only pay past ~5 runs, but at ~13 s/run
a 9-run batch already exceeds the 120 s cap.

The estimate itself may be an artifact worth removing — see the `temp_config_cache` item in
TODOS.md, which is un-`ANALYZE`d and joined four times.

### `ds_adapt_results` is written by an upsert, so it also needs a delete

`ResultsProcessor.processAdaptResults` is a pure `INSERT … ON CONFLICT DO UPDATE` sourced from
`ds_metric_statistics`. It adds and updates; until v0.2.94.7 nothing removed a row it had stopped
producing. Narrowing a run's analysis time range makes `StatisticsPipeline` delete and rewrite
`ds_metric_statistics` from the new `ramp_up`/`ramp_down` offsets, so the excluded metrics vanish
from it — and their old `ds_adapt_results` rows survived, still carrying the verdict they had under
the **previous** window. `buildConclusionSQL` aggregates every row for the run with no freshness
predicate, so one leftover `regression` pinned the run at REGRESSION forever, on a metric with no
samples inside the window at all. `TestRunsAnomalyService.getAnomalyDetectionResults` returned them
too. **`is_stale` does not cover this**: only the `mark_results_stale_on_config_change` trigger sets
it, and neither the conclusion SQL nor the read path consults it.

`ResultsProcessor.deleteOrphanedResults()` runs from `AdaptPipeline` immediately after the upsert,
as its own `delete-orphaned-results` substage, scoped to the same `metricFilter` (a single-metric
re-analysis must not delete every other metric's results). Three things about it are load-bearing:

1. **The `EXISTS` guard is not defensive padding — remove it and a read-shaped edge case destroys
   unrebuildable history.** It refuses to act on a run with **zero** `ds_metric_statistics` rows,
   because "every metric is orphaned" is never a real state; it means the statistics computation
   produced nothing. `StatisticsPipeline` reaches exactly that while returning `{ success: true }`
   — it warns `Metrics exist … but no statistics were written` when org-scoping drops every
   dashboard. Until v0.2.95.0 its own `EXISTS` probe was evaluated **batch-wide** while its
   `DELETE` was too, so one live run could authorise wiping the statistics of an aged-out run
   beside it; the probe is now per run (`filterRunsWithMetrics`) and the DELETE binds to the runs
   that passed it. `AdaptValidator.checkEmptyControlGroups` cannot screen those out
   either: it selects `FROM ds_metric_statistics` and `GROUP BY test_run_id`, so a run with no rows
   forms no group and is never reported as empty. Same rule, same reason as
   `repairEmptySamplerRollup`: the probe stays strict because the statement deletes.
2. **It covers one orphan class only.** The unique key is
   `(test_run_id, control_group_id, application_dashboard_id, panel_id, metric_name)` and the
   `DELETE` deliberately ignores `control_group_id` — it matches on the metric identity, not the
   baseline. A metric that keeps its statistics but loses its control-group row therefore keeps its
   stale verdict. That is the known baseline-timeout case above, unchanged.
3. **The `EXISTS` guard is keyed on the unnested run list, never correlated on the row being
   deleted (v0.2.95.26).** The upsert inserts the run's `ds_adapt_results` rows in the same
   transaction, so on a **first** analysis the planner's statistics still say the table holds ~1
   row for the run. With the guard written `EXISTS (… WHERE ms_any.test_run_id = ar.test_run_id)`
   it nested that whole-run probe inside the per-row loop and re-ran it for every row: metrics x
   metrics. Measured across the four first analyses of 2026-09-14: 4.4k metrics 5 s, 12k 25 s,
   21k 115 s (90 % of ADAPT), 26.5k past the 120 s cap `AdaptPipeline` runs under — and every
   re-evaluate of that run then failed identically, because the rolled-back rows never land and
   the estimate never changes. A re-evaluate of an already-analysed run was fine all along
   (163 ms, merge anti-join), which is why it took a fresh large run to surface. Local repro on
   15,195 rows inserted in-transaction: 9,473 ms against 87 ms with the guard as
   `ar.test_run_id IN (SELECT r.test_run_id FROM unnest($1::text[]) r WHERE EXISTS (…r…))` —
   nothing in it references `ar`, so the planner evaluates it once and materialises it whichever
   join order it picks. Two things about the shape are deliberate: it stays in the **same
   statement** as the anti-join (a probe in its own statement leaves a snapshot window in which
   a concurrent empty statistics rewrite lands between probe and DELETE — the one outcome the
   guard exists to prevent), and the anti-join stays correlated on all four columns of
   `uniq_ds_metric_statistics`, which makes it a per-row index probe however `ar` is estimated.

   Same trap in a different disguise as the planner items under "ADAPT's baseline depends on
   the `pct_agg` sketch": a whole-run predicate the planner is allowed to push inside a per-row
   loop. When a statement reads rows the same transaction wrote, assume the planner has no idea
   how many there are — and write every run-level predicate against the run list, not the row.

### Gap-filling a completed run must never fall back to a full re-collection

`PipelineOrchestrator.executeSequentialPipeline` runs `checkAndFillMetricGaps()` before any stage.
When the run has `ds_metric_collection_status` rows it retries every missing and failed range per
source through `IncrementalMetricsPipeline`, and then **skips all four collection stages whether or
not every source came out complete** (v0.2.95.20). Until then the skip was gated on
`isCollectionComplete()`, and one source with a range that still failed sent the run down the full
path: `dynatrace-collection`, `panels-processing`, `performance-test-metrics`, `metrics-collection`,
every source, whole window. That path is not a superset of the gap fill — it opens with
`PerformanceTestMetricsPipeline`'s `DELETE FROM ds_metrics WHERE test_run_id = $1` (every row of the
run, **all** sources, and on a fresh run a row-store delete, not the cheap segment drop) and then
re-fetches from Grafana and Dynatrace exactly the ranges the retry could not fetch either. Measured
on 2026-09-12 with two large runs completing together: 500 k deletes/s, 98 k inserts/s, 203 MB/s
WAL, a WAL-driven checkpoint every minute, and `/api/test` unreachable long enough for a third test
to be closed by the stale detector. The warning that path emitted has always read
`proceeding with partial data`; the code now does what it says.

Three things to hold on to:

1. **The full collection path is for runs with no incremental data** — a SUT import, a run from
   before incremental collection, a legacy re-analyse. It is the only case that still runs those
   stages, and there "replace everything" is correct. Do not reintroduce a completeness condition.
2. **Incomplete sources stay `is_complete = false` on purpose.** The sanity check scores their
   coverage against `SANITY_CHECK_MIN_COVERAGE`, the run carries `[COLLECTION WARNING] …`
   annotations naming the ranges, and the next re-analysis retries the failed ranges again (capped
   at 5 attempts per range). A gap fill that throws part-way keeps the data too: the flag is
   "incremental collection existed", set as soon as the status rows are read.
3. **The perf-test status row has `source_id = ''`, not NULL, and `performance-test-metrics`
   is never one of the skipped stages (v0.2.95.22).** `getConfiguredSourceKeys` whitelisted
   `'performance_test::null'` from before #146 made the column `NOT NULL DEFAULT ''`, while the
   sweeps built `${source_type}::${source_id ?? 'null'}` — `performance_test::` on a real row.
   So every analyze swept the perf-test row first, and a JMeter-only run then had **no** status
   rows left and took the full path above (58 s delete, 7–8 min rebuild), while a run with a
   Grafana or Dynatrace row beside it skipped all four stages in ~2 min. The unit fixtures used
   `source_id: null`, which is why the tests never saw it. All key building now goes through
   `collectionSourceKey()` in `collectable-sources.ts`.

   Fixing the key exposed the second half: the skip list included `performance-test-metrics`,
   and the ticks do **not** write what the rebuild writes. A tick's window is ~60 s, so
   `calculateBucketSize` gives 1 s buckets where the rebuild gives run-sized ones (60 s on a
   3 h run); the scenario-level `Error Count` / `Active Threads` panels get one point per tick
   with that minute's count where the rebuild writes one run-total point at `end_time`; a
   bucket straddling a tick edge is overwritten by its second half; and a `requests_raw` row
   arriving after its tick is never aggregated. Every baseline was written by the rebuild, so
   skipping it makes ADAPT compare errors-per-minute against errors-per-run. The mixed-source
   runs that already took the skip path have been carrying exactly that. Now the rebuild always
   runs — it reads `requests_raw` in this database, so it is always possible — and its DELETE is
   `deletePerfTestMetricsForRun`, which preserves the gap-filled Grafana/Dynatrace rows beside
   it. Three guards keep the two paths apart: `detectGaps` never reports a `performance_test`
   gap (every caller — the orchestrator, the re-evaluate missing-data branch — would otherwise
   tick over the tail and splice 1 s buckets into the rebuilt run), `calculateCoverage` leaves
   the perf-test row out of the average (it is 100% by construction and used to be excluded by
   the accidental sweep; a JMeter-only run reads 100%), and a perf-test tick for a run that is
   already `completed` exits without collecting, so the one queued just before completion
   cannot race the rebuild. The rebuild also refuses to delete when the run has no
   `requests_raw`/`transactions` to rebuild from — a SUT import without the `raw` group — and
   keeps the imported rows instead.

   **Since v0.2.95.23 the ticks write the rebuild's shape, and the stage rebuilds only when
   they did not.** One bucket rule, `perfTestBucketSizes` in `apps/worker/src/utils/time-bucketing.ts`:
   a live tick sizes from `planned_duration` (60 s when the test posted none), a completed run
   from its actual length — keyed on `completed`, never on `end_time`, which the keep-alive
   update moves to "now" on every post. Every tick re-aggregates `PERF_TEST_OVERLAP_SECONDS`
   (60 s) of the previous window aligned down to a bucket boundary, so the bucket straddling
   the tick edge and a `requests_raw` row that lands late are recomputed from all their
   samples. The scenario-level `Error Count` / `Active Threads` points are counted from
   `start_time` on every tick and written at `start_time` (the one timestamp a live run knows;
   `scenarioMetricTime`), and moved to `end_time` by the full pass. At analyze,
   `PerformanceTestMetricsPipeline.planFullCollection` picks one of three: **skip** (the
   perf-test status row is `is_complete` and the rows sit on the final grid), **tail** (same
   size, not finalised: decompress the tail's span — a no-op on a fresh run, and what saves a
   late first analysis on a compressed chunk from the DML limit — aggregate from the last
   tick, drop the interim points; it does NOT re-run `upsertPerfTestStatistics`, since the
   ticks did that every minute and `statistics-calculation` follows in the same analyze), or
   **rebuild** (no status row, `tick !== final` — an aborted run or no plan
   — or rows off the grid). Six things about it hold the design together:

   - **`is_complete` is the finalisation marker and only a full pass sets it** (this stage
     after writing anything, and the force re-fetch). `PipelineOrchestrator.checkAndFillMetricGaps`
     used to be a third writer — it marks every source `detectGaps` does not report, and
     `detectGaps` never reports the perf-test row — so it now skips that row, and
     `isCollectionComplete` ignores it the way `calculateCoverage` already did. The grid probe
     also refuses a run with zero perf-test rows, so a stray `is_complete` cannot certify an
     empty run. The ticks' recorded range is NOT proof:
     a stale-closed run's `end_time` is its last heartbeat and the scheduler ticks on for
     ~30 s past it, so the range routinely reaches past `end_time` on a run whose scenario
     points are still interim at `start_time` — where `ramp_up` hides them from statistics
     and ADAPT sees the metric as absent. Deciding `skip` from the range shipped that bug to
     review and was caught there.
   - **The grid probe is what makes the transition safe**: pre-v0.2.95.23 ticks wrote 1 s
     buckets, which fail it and rebuild as before. It is an `EXISTS` over the run's perf-test
     rows (~8 ms on a miss, 0.5–1.1 s on a 1.9 M-row pass — the planner scans the run's rows
     in its chunk whichever perf-test predicate is used; scoping by `application_dashboard_id`
     was measured and changes nothing). Its blind spot is a tick size that is a multiple of
     the final one; `tick !== final` covers it on every unfinalised run, and a finalised run
     was written at `final`. A `planned_duration` that changes mid-run to a multiple of the
     old size is the one way through — see TODOS.md.
   - **The full pass holds the tick's key lock** (`perfTestTickLockKey`, up to 3 min). The
     worker stops ticks that *start* after completion; one that started before can land after
     the pass, overwrite a finished bucket with its partial one and put the interim point
     back — permanently, now that the pass marks the run final. The lock is best-effort: a
     Redis error or a holder past 3 min is logged as `proceeding without it` and the pass
     runs unlocked, so a second scenario point at `start_time` after such a warning is the
     expected residue, not a lock bug.
   - **A rebuild on a ticked run resets the status row before its DELETE.** The rebuild is
     not atomic; with the ticks' ranges still recorded, one that died between DELETE and the
     transactions INSERT would be *tailed* from the last tick next time and then certified.
   - **Nothing is certified when nothing was written**, or an empty run skips forever.
   - The range is recorded only when a status row already exists (creating one for a SUT
     import would make the orchestrator skip its Grafana/Dynatrace stages next time), and
     `PipelineOrchestrator` never skips this stage itself — the decision lives in the pipeline
     so the force re-fetch, the ticks and the analyze all share it.
4. **A tick fails only when its collector throws; a panel or query that answers with an error
   does not fail it.** Both collectors save the data of the panels/queries that succeeded and record
   the range as collected. Grafana carries the per-panel errors in the tick result's `errors[]`
   (`metric-processor.ts:processDocumentErrors`) with `success` still true; Dynatrace swallows
   per-query errors earlier (`DynatraceAPIClient.executeBatchQueries` → `DataProcessor`, which
   builds no document for them) so they never reach `errors[]` at all. What throws — and so lands
   the range in `failed_ranges` — is the upsert itself (`upsertMetricsToDatabase` is outside the
   per-document `try`), a config row that no longer exists, or the query/panel load failing. Do not
   "align" Grafana to `success: errors.length === 0`: one broken panel would then fail every tick
   of that instance for the whole run. The consequence of the two designs is that an expired
   Dynatrace token reads as "no data", not as a failure — root CLAUDE.md, Common Issues #22 — and a run whose only
   incomplete source is one that threw at every tick was already carrying the real error in
   `failed_ranges` before this change.
5. **A live Dynatrace tick queries two minutes further back than its window; the completed-run
   paths must not (v0.2.95.27).** Some hosts' minute buckets reach the Dynatrace API more than a
   minute after the minute closes. A tick that queried exactly `[last tick, now]` saw nothing for
   them, and because the *other* hosts answered, the range was recorded as collected and never
   asked for again — the zero-width-range retry (`incremental-metrics.ts`, `dataPoints === 0`)
   fires only when the whole tick returned nothing. `DynatraceCollector` therefore queries from
   `DYNATRACE_INGEST_LOOKBACK_MS` (2 min, clamped at `start_time`) before the window while the
   run is not `completed`; the `ds_metrics` upsert overwrites the overlap, which also replaces a
   partial current-minute bucket with the full one. Off on a completed run on purpose:
   `checkAndFillMetricGaps` and the re-evaluate missing-data branch decompress exactly
   `[from, to]` before they query, so rows outside that span would be DML on a compressed chunk,
   and the echoed rows would count as "new data" for a gap that is actually empty. The recorded
   range is unchanged except that `incremental-metrics.ts` clamps `maxDataTimestamp` to
   `fromTime` — with the lookback, Dynatrace can return only rows older than the cursor, and an
   inverted range subtracts from `calculateCoverage`. Residue: a slow host still loses its last
   one or two minutes, and every live Dynatrace row is written up to three times (TODOS.md).

### `cleanupStaleApplicationDashboards` must never be pointed at a hypertable

`BasePipelineTypeORM.cleanupStaleApplicationDashboards(tables)` deletes rows whose
`application_dashboard_id` no longer exists, with **no `test_run_id` predicate**. On the small
result tables that is a cheap anti-join. `MetricsPipeline` also ran it on `ds_metrics` at the
start of every `metrics-collection` stage: a DELETE across every chunk of a 134 GB compressed
hypertable, i.e. DML decompression until the tuple limit — measured 175–187 s per analyze on
2026-09-13, then a failure the `catch` swallowed (and logged without the error text, because the
`logger.warn(msg, error)` argument order was pino's backwards). A stage with zero panel
documents took three minutes for this alone, and it ran beside the other runs' aggregations.
Removed in v0.2.95.22; the helper's doc comment now says small tables only.

**And on an FK-backed table it is dead work.** Every result table except `check_results` carries
a validated foreign key on `application_dashboard_id`, so the `NOT IN (SELECT id FROM
application_dashboards)` can never match — each call was a full sequential scan of the table
per job (54 ms / 62 ms on dev at 210 k / 349 k rows, growing with the table) to delete nothing.
v0.2.95.32 removed the calls in `PanelsPipeline`, `DynatracePipeline`, `StatisticsPipeline`,
`ControlGroupStatisticsPipeline` and `AdaptPipeline`; the one in `ChecksPipeline` stays because
`check_results` has no such FK. Before adding a call, check `pg_constraint` for the table.

### A source that is switched off must not be registered for collection

`MetricCollectionGapService.calculateCoverage` sums the merged `collected_ranges` of **every** row
in `ds_metric_collection_status` for the run and divides by (run duration x number of rows), and
`DataSanityCheckPipeline` invalidates the run below `SANITY_CHECK_MIN_COVERAGE` (default `80`, read
straight from `process.env`, not from `environment.ts`). Coverage is therefore an average over
*registered* sources: one that can never contribute drags the number down, and a run whose only
registered sources are all dead reads **0%** — failed for a config toggle.

Nothing else recovers it. `incremental-metrics.ts` records a **zero-width** range when
`dataPoints === 0`, on purpose, so the same window is retried rather than skipped past data the API
had not published yet. The incremental ticks never accumulate coverage by themselves; the single
full-span range written at analyze time is the only thing that makes coverage read 100%.

Two switches say "this source is off", and the code that decided a source *exists* read neither
(v0.2.95.12): `dynatrace_queries.enabled = false` (filtered by `DynatraceRepository` and the
incremental collector, but not the scheduler) and the Grafana `no-anomaly-detection` tag (honoured by
`createPanelDocuments`, which skips a tagged dashboard so it yields no `ds_panels`, but nowhere
else). The artificial `grafana_dashboards` placeholders belong with them: they carry a
`grafana_instance_id` on their `application_dashboards` row, so anything reading only that column
mistakes them for Grafana dashboards.

**All three call sites now share `services/collectable-sources.ts`.** They used to answer "which
sources exist" independently — the scheduler, `PipelineOrchestrator.removeOrphanedCollectionSources`
(which runs FIRST, before any stage, and had neither filter) and the identically-named method in
`DataSanityCheckPipeline` (which runs last). A row the sanity check would have swept survived the
orchestrator's sweep, got gap-filled, and could flip `isCollectionComplete()` to true.

Four rules for anything in this path:

1. **Detect an artificial row by `grafana_json`, never by a `grafana_id` range** — see
   "`grafana_dashboards` is a mixed table" in the root [CLAUDE.md](../../CLAUDE.md). Resolve through `grafana_dashboard_id`, not
   `dashboard_uid`: a uid is unique only within an instance.
2. **The filter fails OPEN, including on its own error.** No FK, a deleted row, or a throwing query
   all keep the dashboard. It runs inside the tick that also enqueues the Dynatrace and
   performance-test jobs, so an exception there would abandon all collection for that minute.
3. **`NO_ANOMALY_DETECTION_MARKER` lives in `constants/dashboard-tags.ts`**, a leaf module, so the
   resolver can share it without pulling in the panel builder's module-level logger.
4. **"Complete" is sticky and suppresses re-collection — never set it on a maybe.** Only a
   force-refetch reevaluate clears `is_complete`, and `PipelineOrchestrator` skips
   `dynatrace-collection`, `panels-processing` and `metrics-collection` whenever the run had an
   incremental collection at all (`performance-test-metrics` always runs and decides for itself whether to rebuild, v0.2.95.22/23). `metricsDocuments.length === 0` is the SAME signal for "ran
   fine, no data" and "every query failed" — `executeBatchQueries` catches per query and returns
   `{ result: null, error }`, and `DataProcessor` only builds a document when `!result.error` — so
   completing there would make an expired token permanent. A Dynatrace config is marked complete only
   when its batch ran and every query succeeded; configs the loop skips (row gone, no api token, SaaS
   without a platform token) execute nothing and are not marked. `MetricsPipeline` does not complete
   the Grafana source on its "no panel documents" path either: an empty `ds_panels` is frequently a
   transient config state. A source that is genuinely off is handled by not registering it, not by
   completing it.

Related: **`ds_panels` has two writers and its reader has no source filter.** `PanelsPipeline` writes
the real Grafana panels, `DynatracePipeline` writes its own, and `getDsPanelsByTestRun` is a bare
find on `test_run_id`. So `MetricsPipeline`'s `panels.length === 0` guard turns on rows it does not
own, and `DynatracePipeline` early-returns at "no queries configured" *before* writing any.

### A worker that reports failure by RETURNING is silently succeeding

`simple-workers.ts` wraps every registered processor as `return await processor(job)`. Returning a
value — any value, including `{ status: 'failed', errors: [...] }` — **resolves** that promise, and
BullMQ records the job as **completed**. No retry (`attempts` never fires), no entry in the failed
set, nothing for an operator to find. The only way a job fails is to throw.

This is not a style preference, and it is repo-wide: grep `status: 'failed'` under
`apps/worker/src/workers/` before adding another one. Two sites were fixed in v0.2.95.0 and the
remaining ones are deliberate, so know which kind you are writing:

- **`simple-orchestrate-reevaluate-batch.ts` now throws** on a scope-lock refusal and rethrows from
  its catch-all. Returning left `test_runs.ramp_up` written while `ds_metric_statistics` was never
  recalculated and ADAPT never re-ran — permanently, behind a green job and a UI reporting success.
  With chunking, a mid-chunk failure additionally leaves the earlier chunks rewritten and the rest
  on the old window, so a silent success is a half-applied batch nobody learns about. The retry
  policy that applies is the one `reevaluateBatch` sets at enqueue time (`bullmq-client.service.ts`:
  `attempts: 2`, fixed 10 s), **not** the queue-level default in `simple-queues.ts` — a reader
  chasing this finds the wrong one first.
- **`analyze.ts` now throws from both branches (v0.2.95.13).** The scope-lock refusal threw from
  v0.2.95.0; the catch-all followed. Returning there recorded a run whose ten-stage analysis blew
  up as *completed*, and it also meant the retry policy the job type has always carried
  (`attempts: 3`, exponential from 5 s — `SIMPLE_JOB_OPTIONS['analyze-test']` and the
  `perfana-analyze` queue default agree) never once fired. Retrying is safe because every stage
  deletes and rewrites its own rows, and the `sut:env:workload` lock is released in the `finally`
  before BullMQ reschedules — that release is what the retry depends on, so it is pinned by a test.
  The `partial` return above it is untouched: that one is the orchestrator deliberately reporting a
  stage failure under `errorHandling: 'abort'`, not an unhandled exception.
  The lock branch mattered because a bulk analysis-window apply holds `sut:env:workload` across all
  of its chunks, and every run that finishes during that window used to take the returning branch
  and be recorded as analysed without ever being analysed: no benchmarks, no ADAPT, no rollup.
- **`incremental-metrics.ts` returns on purpose.** A scheduler re-drives it on the next cycle, so a
  BullMQ failure would double up the retry. Leave it.

Distinct from, and easily confused with, `softFail` (below): that one is a *deliberate* return of
`{ status: 'failed' }` by a pipeline whose caller reads `returnvalue` via `assertStageSucceeded()`.
A worker with no such reader gets no such contract.

### The heavy analyze stages run one at a time, and their wall-clock timeout is gone

`statistics-calculation`, `control-group-statistics` and `adapt-analysis` each run a multi-minute
aggregation over `ds_metrics`. Two of them on the same Postgres at once evict each other's pages
and spill each other's sorts: on 2026-09-11 four large runs finished together, the cache hit
ratio fell to 16 %, temp files hit 90 MB/s, and three of the four analyses failed. Nothing was
waiting on a lock — the "Sessions waiting on a lock" panel was empty — the jobs blocked each
other on the database itself. Two things changed in v0.2.95.17, and they only work as a pair:

1. **`HeavyStageMutex`** (`apps/worker/src/services/HeavyStageMutex.ts`) is a deployment-wide
   Redis `SET NX PX` lock, held around those three stages — and, since v0.2.95.22,
   `performance-test-metrics`, whose `upsertPerfTestStatistics` is a `percentile_agg` over the
   run's whole `ds_metrics` (same shape as `statistics-calculation`; one of two running side by
   side crossed the 600 s wall clock and was recorded completed with the analysis dropped) — by **whichever job runs the
   pipeline**: `PipelineOrchestrator` for `analyze-test`, and the registry processor
   (`pipeline-registry.ts:withHeavyStageLock`) for the same job names when the re-evaluate
   orchestrator enqueues them. The **child** holds it, never the re-evaluate orchestrator: that
   one runs on `perfana-batch` while `analyze-test` jobs park on `perfana-analyze` waiting for
   the same lock, so an orchestrator-held lock could pin both analyze slots behind a child that
   can never be picked up. The cheap stages still overlap; only the aggregation is serialised.
   `ponytail:` it is a single lock, not a semaphore — make it one if one heavy stage at a time
   leaves the database idle.
2. **`executeStage` no longer races the `HEAVY_STAGES` against a `setTimeout`.** The race only
   ever abandoned the promise: the aggregation kept running on Postgres until `statement_timeout`
   (540 s) while the job returned `partial` (BullMQ *completed*, so the failed count never moved),
   released its scope lock and its concurrency slot, and the next queued job started on top of the
   orphan. Postgres already bounds every statement they run, so the wall-clock race is kept only
   for the stages outside `HEAVY_STAGES` (Grafana/Dynatrace collection, panels, checks,
   control-group creation, rollup), where an HTTP call can hang. `performance-test-metrics` is
   in the set since v0.2.95.22 and so is exempt like the rest: bounded by `statement_timeout`. The `timeoutMs` in `analyze.ts` is
   **per stage**, not per pipeline, despite what its old comment said.

Eight consequences to know about:

- **A parked job publishes `status: 'waiting'`, and keeps publishing it.** The API evicts a job
  whose `lastProgressAt` is 5 min old and `StuckJobScanner` releases its scope lock at 10, so the
  mutex's `onWaiting` fires on every 5 s poll and `ProgressReporter.setWaiting` publishes each
  time. The UI renders `waiting` as a **Queued** chip with the reason in place of the stage line.
  A job still in BullMQ's waiting list gets the same record from `QueuedJobAnnouncer`
  (`apps/worker/src/services/QueuedJobAnnouncer.ts`, every 30 s) — nothing else can publish for a
  job no processor has picked up yet.
- **The re-evaluate orchestrator's `waitForJobs` no longer counts parked time.** It polls the
  child every 10 s and charges the slice to a running clock (`JOB_WAIT_TIMEOUT_MS`, 30 min since v0.2.95.19 — the child now decompresses for real, up to 540 s per chunk, before it aggregates) or a
  parked clock (`JOB_PARKED_CEILING_MS`, 1 h) depending on whether the child is in BullMQ's
  waiting list or active with progress `{ queuedBehind }`. Before this a child queued behind two
  analyses hit the 600 s wait, was removed, and failed the whole re-evaluate.
- **A parked analyze job still occupies its `perfana-analyze` slot.** With
  `WORKER_ANALYZE_CONCURRENCY=2`, holder + parked fills the queue, so incremental-collection
  ticks for live tests and re-evaluate children wait for the whole heavy stage rather than
  sharing the database with it. Throughput is unchanged (before, both slots ran heavy work
  concurrently and slowly); latency for a tick is now bounded by the heavy stage. Raise the
  concurrency to 3 if that shows up as coverage warnings.
- **A run refused by its workload's scope lock is re-parked, not retried.** `analyze.ts` used
  to throw on `sut:env:workload` refusal and rely on the job's retry policy (3 attempts at
  5 s / 10 s). Now that a holder's heavy stages queue behind every other analysis, a holder
  can sit on the scope for an hour, and two runs of one workload finishing together is the
  normal case — the second would have been dropped ~15 s after pickup, with no progress
  record ever created. It is now `moveToDelayed` + `DelayedError` (no attempt consumed),
  60 s at a time for up to 2 h (`blockedSince` in the job data), and only then the thrown
  refusal. The processor takes BullMQ's `token` for that; `simple-workers.ts` and the
  factory pass it through.
- **A heavy-stage lock give-up, or a Redis error inside `acquire`, is RETRYABLE, not
  `partial`.** The orchestrator tags the stage result `code: 'RETRYABLE'` and `analyze.ts`
  rethrows it into the retry policy. Left as `partial` it would be a BullMQ-completed job
  with the analysis silently dropped — the exact failure mode the "returning is succeeding"
  section describes.
- **A heavy stage keeps its progress record alive.** The record expires after
  `LOCK_TTL_SECONDS` (5 min), a heavy stage publishes nothing while it runs and now has no
  wall-clock bound, and the API evicts a job whose record is gone — so the UI went blank
  while the scope lock still refused new runs. `PipelineOrchestrator` calls
  `ProgressReporter.touch()` every 60 s around a heavy stage. Note `StuckJobScanner`
  cannot be what catches this: it needs 10 min without progress on a record that expires
  at 5, so for a non-terminal record it is inert; the 5 min expiry is the real cliff.
- **A dead holder's statement outlives its lock.** The lock TTL frees the mutex 5 min
  after the worker dies, but Postgres notices a closed socket only on its next write and an
  aggregation writes nothing until it finishes, so the next holder overlaps the orphan for
  up to the statement budget. `docker-compose.infra.yml` sets
  `client_connection_check_interval=10000`; a deploy on its own Postgres has to as well.
- **Every wait has a ceiling and names the holder.** `HeavyStageMutex` gives up after 1 h with
  `held by <jobId>` in the message; a job that queues longer than that has a stuck holder, not a
  busy one. The lock TTL is 5 min with a 60 s heartbeat, so a dead holder frees it by itself.

### An analysis window belongs to a workload, not to a run

Trimming one run's analysis window in isolation quietly breaks the comparison it feeds. ADAPT
measures a run against a baseline of earlier runs, and `ds_control_group_statistics` pools those
runs' `ds_metric_statistics`, each computed under whatever offsets its own run happens to carry —
so a narrowed run is compared against untrimmed history. `PUT /test-runs/:id/analysis-time-range`
therefore takes `applyToAll`, which writes the same offsets across every run of the target's
`(system_under_test, environment, workload)` and re-evaluates them all (v0.2.95.0).

Four things about that path are not obvious:

1. **The write is a preview and a write, and they must not drift.** `GET
   :id/analysis-time-range/scope` answers the same question read-only so the dialog can name the
   blast radius before the user commits. Both call the same
   `partitionAnalysisTimeRangeScope`; two implementations would drift, and the drift would be
   invisible — a dialog promising a count the write does not honour. The preview's projection
   (`ANALYSIS_TIME_RANGE_SCOPE_COLUMNS`) has to carry every column the partition reads: drop
   `startTime`/`endTime` and the preview answers the fit question from the client-supplied
   `duration` while the write answers it from the timestamps.
2. **`MAX_BULK_ANALYSIS_TIME_RANGE_RUNS = 100` refuses, it does not truncate.** The scope is every
   run a workload ever produced, which on a nightly workload is thousands. The number matches
   `data-science.controller.ts`'s existing `.slice(0, 100)` on a caller-supplied run set, but
   truncating here would leave the remainder as untrimmed baseline — exactly the apples-to-oranges
   comparison the feature exists to prevent. The preview reports `exceedsCap` so the refusal is not
   a surprise at submit time.
3. **Three reasons a sibling is skipped, and all three are reported rather than silent.**
   `not-writable` (outside the target's `(organizationId, teamId)` — `test_runs.team_id` is a
   per-row nullable column, *not* derived from the system under test, so a workload can span teams
   and the caller proved write permission on one pair only); `running` (`MetricsPipeline` bakes
   `ds_metrics.ramp_up` at ingestion, so moving the offsets mid-run leaves rows flagged under two
   settings); `too-short` (the offsets do not fit — item 8 above). The target itself is checked too
   and rejected outright, because writing impossible offsets onto the run the user is looking at
   while skipping a sibling for the same reason is the inconsistency the check exists to prevent.
4. **Every completed run that was written needs its `transaction-stats-rollup` re-enqueued, not
   just the target.** The rollup recomputes the `ramp_up_excluded` rows from the offsets, and
   `getRollupStatus` reads a populated table and answers `ready` forever — so a sibling that is
   never re-enqueued serves previous-window numbers in Performance Analysis indefinitely with
   nothing logged. `repairEmptySamplerRollup` does **not** cover this: it fires only when the table
   is *empty*, and here it is populated with the old window's numbers. That is also why
   `ROLLUP_JOB_OPTIONS` sets `removeOnComplete: true`: BullMQ refuses an `add` whose jobId still
   exists in any state, so a retained `rollup-<id>` record makes every later enqueue for that run a
   silent no-op, and the obvious user loop (apply → look → adjust → apply again) rebuilds nothing.

The follow-up work is queued from `runAfterRequestCommit`, which keeps the Redis round trips out of
the request's open RLS transaction — but note the caller still waits for them:
`RlsTransactionInterceptor` awaits every after-commit hook before Nest builds the response. What
deferring buys is the Postgres connection, not the latency. Because the caller is waiting, the
enqueues are batched (`enqueueTransactionStatsRollupBulk`) rather than looped; and because
`runAfterRequestCommit` dispatches as `void Promise.resolve().then(fn)` when there is no request
entity manager, an escaping rejection is an unhandled rejection that terminates the process — so
everything in that hook logs and swallows.

