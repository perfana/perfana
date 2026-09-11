# Heavy-stage serialisation + chunk interval: rollout and follow-ups

Ships in v0.2.95.17 (`fix/heavy-stage-mutex`). What is in the PR, what has to happen after
it merges, and when. Timings assume the production deploy that produced the 2026-09-11
snapshot (~16 GB/day of `ds_metrics` ingest, 7-day chunks, `shared_buffers` 4 GB).

## What the PR changes (recap)

| Piece | Effect on the deploy |
|---|---|
| `HeavyStageMutex` around statistics / control-group statistics / ADAPT | One heavy aggregation at a time across the deployment; the others show **Queued** |
| No wall-clock race on those three stages | Postgres `statement_timeout` bounds them; no more orphaned aggregations behind a `partial` job |
| `waitForJobs` two-clock rewrite | A re-evaluate no longer fails because its child sat behind two analyses |
| `QueuedJobAnnouncer` | Jobs still in BullMQ's waiting list show **Queued** in the UI |
| Migration 1804 (1-day chunks + SECURITY DEFINER decompress/compress wrappers) | Future chunks are 1 day; the worker can decompress for the first time |
| `max_locks_per_transaction=256` in `docker-compose.infra.yml` | Only the dev compose; production must set it itself |

## Day 0 — deploy

1. **Before the deploy: set `max_locks_per_transaction=256` on production Postgres and
   restart it.** The migration warns if it is below 256 but does not refuse. Order matters:
   the chunk count starts growing the day the migration lands.
2. Deploy api + worker + web. Migration 1804 runs under `Dockerfile.migrations`; it raises
   if the migration role does not own `ds_metrics` (it must, or the wrappers are useless).
3. Confirm the migration landed:
   ```sql
   SELECT hypertable_name, time_interval FROM timescaledb_information.dimensions
    WHERE hypertable_name IN ('ds_metrics','requests_raw');           -- both '1 day'
   SELECT proname, proacl FROM pg_proc WHERE proname LIKE 'perfana_%chunk';  -- perfana_system=X only
   ```
4. Watch the worker log for the first analysis: `Heavy-stage lock acquired by <job> after Ns`
   appears only when a second analysis was parked. `decompressChunksForRange ... skipped`
   must NOT say `must be owner of hypertable` any more.

## Day 0–1 — prove the two fixes on real load

5. **Mutex:** trigger two analyses within a minute of each other (re-analyse two finished
   runs). Expected: the second shows the **Queued** chip with
   "waiting for another analysis to finish its database-heavy stage" while the first is in
   statistics / control-group statistics / ADAPT, then proceeds. Both succeed. The
   Grafana cache-hit-ratio panel should not fall below ~60 % during either.
6. **Wrappers:** change the analysis window on a run **older than 7 days** (its chunks are
   compressed). Expected: `Decompressing ds_metrics chunk _hyper_… [range]` in the worker
   log, the statistics stage succeeds, and `Recompressed N/N chunk(s)` at the end of the
   re-evaluate. Before this PR that path failed with `tuple decompression limit exceeded`.
   This is the gate for step 9: do not shorten `compress_after` until this is green.
   Budget: the first such decompression is of a legacy 7-day chunk (~10 GB row store) and
   is bounded at 540 s per chunk; if it is cancelled, the chunk is remembered as
   undecompressable for that process and the run stays as it was.
7. **Queued announcer:** start 3+ analyses at once. The ones still in BullMQ's waiting list
   should show **Queued** ("waiting for a free analysis worker") within 30 s. A run whose
   workload already has a running analysis is deliberately not announced.

## Day ≤ 7 — first 1-day chunks

8. The open 7-day chunk closes at its boundary; from then on `ds_metrics` and
   `requests_raw` get one chunk per day. Check
   `SELECT count(*), max(range_end) - min(range_start) FROM timescaledb_information.chunks WHERE hypertable_name='ds_metrics' AND range_start > now() - interval '3 days';`
   shows daily ranges.

## Day 7–10 — shrink the 227 GB (migration 1805, v0.2.95.18)

9. **`compress_after` 7 days → 2 days on `ds_metrics`** — written as
   `1805000000000-ShortenDsMetricsCompressAfter`; **merge only after step 6 is green.** Effect:
   row store drops from 7–14 days (~110–230 GB) to 2–3 days (~32–48 GB); the rest sits at
   ~86x. The migration refuses if the 1804 wrappers are absent, schedules the first policy
   run at the next 02:00 UTC (override: `DS_METRICS_COMPRESS_INITIAL_START` on the
   migration runner), and keeps the 12 h schedule. That first run compresses the previous
   ~113 GB chunk in one call — hours of I/O — which is why it is scheduled, not immediate.
   `requests_raw` is untouched: the 15 CAGGs have `start_offset` 7 days chosen to match it.
   Before `initial_start` fires on production, check: free space on the data volume
   (compressing the 113 GB chunk was measured at ~1 GB WAL + ~1.7 GB temp per 4.7 GB of
   row store → budget ~26 GB WAL, ~41 GB temp), `temp_file_limit`, `max_wal_size`, no
   `statement_timeout` on the hypertable owner role, and that the compression job's
   recent `job_history` has no `failed to start job` (a starved scheduler misses the
   02:00 slot and compresses whenever a worker frees). Runs from the legacy 7-day chunks
   cannot be decompressed within the worker's 540 s budget once compressed (~45 min for
   113 GB), so analysis-window changes on Sep 3–10 runs are frozen either way.
   Per-series chart reads on compressed runs cost 15–18 ms on a 2.45 M-row run (bloom
   index prunes); a metric-first orderby was measured and rejected (TODOS.md).
10. Re-measure the TODOS.md conclusion that a `time BETWEEN start_time AND end_time` bound
    on the aggregation buys nothing — it was taken under 7-day chunks. Under 1-day chunks
    a run spans one or two chunks and chunk exclusion may finally pay; it would also stop
    the per-query lock count growing with the chunk count.

## Day 30 — decide retention

11. `ds_metrics` has no retention policy. At 365 chunks/year (plus compressed twins) the
    lock table and planning time grow linearly; `max_locks_per_transaction=256` covers
    roughly two years. Decide a retention policy (or a compaction plan for aged chunks)
    and write the answer in TODOS.md even if it is "none for now". Also measure planning
    time on the panel-render path (`metrics.service.ts`) against ~365 chunks.

## Deferred, with their trigger

- **Counting semaphore instead of a single lock** — if one heavy stage at a time leaves the
  database visibly idle (cache hit ratio ~100 % with a queue of parked jobs).
- **Incremental ticks on their own queue** — if coverage warnings appear on runs that were
  live while two analyses held both `perfana-analyze` slots.
- **Leader key for `QueuedJobAnnouncer`** — only with more than one worker replica.
- **API-side guard: never let a `waiting` frame replace an `active` scope entry** — belt
  and braces for the announcer's scope-lock check; do it if the "Queued" chip is ever seen
  replacing a running job's frame.
- **`waitForJobs` parked-ceiling abort on an `active` (mutex-parked) child** — BullMQ
  refuses `remove()` on a locked job, so the child runs the stale stage later unobserved.
  Pre-existing shape; would need a cancel flag the child polls.
