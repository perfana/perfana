# Plan: Pre-computed per-test-run transaction + sampler stats rollup

Issues: [#150](https://github.com/perfana/perfana/issues/150), [#151](https://github.com/perfana/perfana/issues/151)

## Assessment — do the suggested changes make sense?

**Yes, with caveats.** Both issues describe the same underlying problem from different angles:

- **#150** (broad): the two Apdex queries still scan 1–30M rows per test run after the #139/#148 rewrite. Agg-then-join helped; raw volume is now the wall.
- **#151** (concrete): measured `getAggregatedSamplerStats` at 135–213s for a test run with 11,350,178 `requests_raw` rows. 5 calls × 140s mean. Only 12 rows returned.

The core proposal — **compute per-test-run aggregates once at finalization, store the tdigest sketch, let dashboards read ~N rows instead of ~Nm** — is sound and fits the codebase pattern already established by `ds_metric_statistics` (`PerformanceTestMetricsPipeline` writes these at analyze time with identical `INSERT ... ON CONFLICT DO UPDATE` shape).

### Why this works here

1. **Test runs are immutable once completed.** No invalidation problem on the aggregate side.
2. **tdigest is mergeable and queryable.** Storing `percentile_agg(response_time)` as a `tdigest` lets `approx_percentile(0.95, pct_agg)` and `approx_percentile_rank(threshold, pct_agg)` read the digest directly — no re-scan. This is what makes the "threshold-on-the-fly" design cheap (see below).
3. **A natural hook exists.** `TestRunsMutationService.handleCompletedTest` (apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts:209) already enqueues `analyze-test`. The `analyze-test` worker (apps/worker/src/workers/analyze.ts:106) runs a 9-stage pipeline. Adding a rollup stage between `performance-test-metrics` and `statistics-calculation` is the obvious slot — same lock scope, same retry semantics, same progress reporter.
4. **The expensive inputs are already scoped to one chunk segment.** `requests_raw` and `transactions` both have `segmentby=(test_run_id, transaction_name)` (packages/shared/src/database/migrations/1700000000010-AddTimescaleDBCompressionPolicies.ts:33,43). One-shot aggregation at completion reads exactly the chunks that belong to this test run, once.

### Caveats worth addressing in the plan

- **In-progress test runs**: dashboards must not show empty state while a test is running. Fallback to the live-aggregation path when no rollup row exists yet. The existing query becomes the fallback.
- **Apdex threshold changes**: storing a materialized `apdex_score` column means any `workload_apdex_thresholds` edit invalidates every historical row. Per user decision: **compute `apdex_score` on the fly from the stored `pct_agg` + current threshold** — threshold edits take effect immediately, query still reads ~N rollup rows.
- **Backfill scope**: production has ~years of test runs. One-shot backfill of every historical run in a single migration is not viable. Backfill needs to be a separate, resumable job.
- **tdigest storage cost**: ~1–5 KB per row. Per the issue's table projections (tens to thousands of rows per test run) this is fine. Retention should tie to #138 when it lands.

### Scope decisions (from user AskUserQuestion)

1. **Bundle #150 + #151 into one PR** — same migration, one pipeline writes both rollup tables, both dashboard queries switch together.
2. **Apdex on the fly** — rollup stores `pct_agg` (tdigest) only; dashboard queries compute `active_threshold` and `apdex_score` at read time from current threshold tables.
3. **BullMQ job path** — new `transaction-stats-rollup` stage in the `analyze-test` pipeline, not a synchronous INSERT in the API request.
4. **Two variants per group — full and ramp-up-excluded.** The Overview-tab expand defaults `excludeRampUp=true` (apps/web/app/test-runs/[id]/components/performance-analysis/hooks/usePerformanceAnalysisData.ts:93), so without this, the biggest UI win falls back to live aggregation. Trade: ~2× rollup storage and ~30–50% more worker compute at rollup time. Required side-hook: `TestRunsMutationService.updateAnalysisStartOffset` (test-runs-mutation.service.ts:306) must re-enqueue the rollup job, since editing ramp-up post-completion invalidates the ramp-up-excluded rows.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ API: POST /api/test-runs/:id/running → TestRunsMutationService      │
│ → handleCompletedTest() → bullmq.analyzeTest(testRunId, adapt=true) │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ analyze-test worker (apps/worker/src/workers/analyze.ts)            │
│   1. dynatrace-collection                                           │
│   2. panels-processing                                              │
│   3. performance-test-metrics                                       │
│ ▶ 4. transaction-stats-rollup  ◀── NEW STAGE                        │
│   5. statistics-calculation                                         │
│   6. checks-evaluation                                              │
│   7. control-groups-creation                                        │
│   8. control-group-statistics                                       │
│   9. adapt-analysis (if enabled)                                    │
│  10. data-sanity-check                                              │
└─────────────────────────────────────────────────────────────────────┘
                              │ writes
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  test_run_transaction_stats  (rolled up from `transactions`)        │
│  test_run_sampler_stats      (rolled up from `requests_raw`)        │
└─────────────────────────────────────────────────────────────────────┘
                              │ reads (fast)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ TestRunsPerformanceQueryService                                     │
│   getTransactionStats  → reads test_run_transaction_stats           │
│   getTransactionSamples → reads test_run_sampler_stats              │
│   (fallback to live aggregation if no rollup row exists yet)        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation steps

### 1. Migration — new rollup tables

File: `packages/shared/src/database/migrations/<timestamp>-CreateTestRunStatsRollup.ts`

```sql
-- Transaction-level rollup (fills from `transactions` table)
CREATE TABLE test_run_transaction_stats (
  test_run_id             text        NOT NULL,
  transaction_name        text        NOT NULL,
  scenario_name           text,
  ramp_up_excluded        boolean     NOT NULL,  -- false = full run, true = ramp-up-filtered
  system_under_test_id    uuid        NOT NULL,
  test_environment        text        NOT NULL,
  workload                text,
  total_count             bigint      NOT NULL,
  passed_count            bigint      NOT NULL,
  failed_count            bigint      NOT NULL,
  avg_response_time       numeric(10,2),
  impact_score            numeric,
  pct_agg                 tdigest     NOT NULL,
  computed_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (test_run_id, transaction_name, COALESCE(scenario_name, ''), ramp_up_excluded)
);
CREATE INDEX idx_trs_tx_stats_sut_env_wl
  ON test_run_transaction_stats (system_under_test_id, test_environment, workload);

-- Sampler-level rollup (fills from `requests_raw`)
CREATE TABLE test_run_sampler_stats (
  test_run_id             text        NOT NULL,
  transaction_name        text        NOT NULL,
  sampler_name            text        NOT NULL,
  scenario_name           text,
  ramp_up_excluded        boolean     NOT NULL,
  url_hash                text,
  system_under_test       text        NOT NULL,
  test_environment        text        NOT NULL,
  total_count             bigint      NOT NULL,
  passed_count            bigint      NOT NULL,
  failed_count            bigint      NOT NULL,
  avg_response_time       numeric(10,2),
  min_response_time       integer,
  max_response_time       integer,
  avg_latency             numeric(10,2),
  avg_connect_time        numeric(10,2),
  total_request_size      bigint,
  total_response_size     bigint,
  pct_agg                 tdigest     NOT NULL,
  computed_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (test_run_id, transaction_name, sampler_name, COALESCE(scenario_name, ''), ramp_up_excluded)
);
CREATE INDEX idx_trs_sampler_stats_lookup
  ON test_run_sampler_stats (test_run_id, transaction_name, ramp_up_excluded);
```

Notes:
- `active_threshold` and `apdex_score` are **intentionally not stored** — computed on the fly so threshold edits take immediate effect (user decision).
- `ramp_up_excluded` in the PK gives two rows per group: `false` = stats over the full test run, `true` = stats from `start_time + ramp_up` onward. Query layer picks one by `WHERE ramp_up_excluded = $excludeRampUp`.
- When `test_runs.ramp_up` is 0 or null, both rows are identical but still written — keeps the read path uniform. Wasted storage is ~2 KB per group; acceptable.
- `system_under_test_id` (uuid, normalized) in the transaction rollup matches `test_runs.system_under_test_id`; `system_under_test` (text, legacy denormalized) in the sampler rollup matches `requests_raw.system_under_test` + `url_patterns.system_under_test` for the URL-pattern join. This preserves the current query shapes exactly.
- No foreign keys to `test_runs` / `systems_under_test` — cascade behavior is handled by the test-run deletion processor (it already cleans up `ds_metrics`, `ds_metric_statistics`, etc.). Add the two new tables to that cleanup.

Reversible: down() drops both tables.

### 2. Worker pipeline — `TransactionStatsRollupPipeline`

File: `apps/worker/src/pipelines/TransactionStatsRollupPipeline.ts`

Extends `BasePipelineTypeORM`. `execute({ testRunId })`:

1. Load `test_runs` row → `system_under_test_id`, `test_environment`, `workload`, `start_time`, `ramp_up`, `completed`.
2. Sanity-check: `completed = true`. If not, skip (log + return success — matches existing pattern of not re-running stale stages).
3. Compute `$cutoff = start_time + ramp_up seconds` (null-safe: when `ramp_up` is 0 or null, `$cutoff = start_time` so the `FILTER` clause matches everything and both rows become identical).
4. **Compute-and-upsert transaction rollup** — one scan, `FILTER`-computed pair per group, emitted as two rows via `UNION ALL`:

```sql
WITH base AS (
  SELECT
    t.test_run_id, t.transaction_name, t.scenario_name,
    tr.system_under_test_id, tr.test_environment, tr.workload,
    -- Full run
    COUNT(*)                                               AS total_full,
    COUNT(*) FILTER (WHERE t.success)                      AS passed_full,
    COUNT(*) FILTER (WHERE NOT t.success)                  AS failed_full,
    ROUND(AVG(t.response_time)::numeric, 2)                AS avg_full,
    ROUND((AVG(t.response_time) * COUNT(*))::numeric, 2)   AS impact_full,
    percentile_agg(t.response_time::double precision)      AS pct_full,
    -- Ramp-up excluded
    COUNT(*)                                 FILTER (WHERE t.time >= $2) AS total_excl,
    COUNT(*) FILTER (WHERE t.success         AND t.time >= $2)           AS passed_excl,
    COUNT(*) FILTER (WHERE NOT t.success     AND t.time >= $2)           AS failed_excl,
    ROUND(AVG(t.response_time)
          FILTER (WHERE t.time >= $2)::numeric, 2)                       AS avg_excl,
    ROUND((AVG(t.response_time) FILTER (WHERE t.time >= $2)
           * COUNT(*) FILTER (WHERE t.time >= $2))::numeric, 2)          AS impact_excl,
    percentile_agg(t.response_time::double precision)
          FILTER (WHERE t.time >= $2)                                    AS pct_excl
  FROM transactions t
  JOIN test_runs tr ON tr.test_run_id = t.test_run_id
  WHERE t.test_run_id = $1
  GROUP BY t.test_run_id, t.transaction_name, t.scenario_name,
           tr.system_under_test_id, tr.test_environment, tr.workload
)
INSERT INTO test_run_transaction_stats (
  test_run_id, transaction_name, scenario_name, ramp_up_excluded,
  system_under_test_id, test_environment, workload,
  total_count, passed_count, failed_count,
  avg_response_time, impact_score, pct_agg
)
SELECT test_run_id, transaction_name, scenario_name, false,
       system_under_test_id, test_environment, workload,
       total_full, passed_full, failed_full, avg_full, impact_full, pct_full
FROM base
UNION ALL
SELECT test_run_id, transaction_name, scenario_name, true,
       system_under_test_id, test_environment, workload,
       total_excl, passed_excl, failed_excl, avg_excl, impact_excl,
       COALESCE(pct_excl, percentile_agg(ARRAY[]::double precision[]))
FROM base
ON CONFLICT (test_run_id, transaction_name, COALESCE(scenario_name, ''), ramp_up_excluded)
DO UPDATE SET
  total_count       = EXCLUDED.total_count,
  passed_count      = EXCLUDED.passed_count,
  failed_count      = EXCLUDED.failed_count,
  avg_response_time = EXCLUDED.avg_response_time,
  impact_score      = EXCLUDED.impact_score,
  pct_agg           = EXCLUDED.pct_agg,
  computed_at       = now();
```

Params: `$1 = test_run_id`, `$2 = cutoff timestamptz` (= `start_time + ramp_up` seconds). When the group has zero rows in the excluded window, `pct_excl` is null — the `COALESCE` emits an empty tdigest so the NOT NULL constraint holds and the read path sees `total_count = 0` (rendered as "no data" in the UI).

5. **Compute-and-upsert sampler rollup** — same shape against `requests_raw`, grouped by `(sampler_name, scenario_name, system_under_test, test_environment)`, PK includes `ramp_up_excluded`. The `ARRAY_AGG(url_hash ORDER BY time DESC)[1]` trick is done twice (full + filtered) at rollup time.
6. Wrap both upserts in a single transaction with `SET LOCAL work_mem = '512MB'` (same as the current online queries do).
7. Return `PipelineResult` with counts (rows inserted full + excluded).

Size budget: ~200–300 lines. Tests cover: empty test run, single-transaction, multi-scenario, re-run idempotency.

### 3. Wire the pipeline into the worker

- `apps/worker/src/types/jobs.ts`: add `TRANSACTION_STATS_ROLLUP: 'transaction-stats-rollup'` to `JOB_NAMES`, add `TransactionStatsRollupJobSchema` (just `{ testRunId: string }`), add `JOB_QUEUE_CONFIGS` entry (`teamSize: 3`, `teamConcurrency: 1` — aggregation is CPU+IO heavy), add a `JobQueueConfig` entry.
- `apps/worker/src/workers/pipeline-registrations.ts`: add `registerPipeline({ jobName: JOB_NAMES.TRANSACTION_STATS_ROLLUP, schema: TransactionStatsRollupJobSchema, createPipeline: (logger) => new TransactionStatsRollupPipeline(logger), successMessage: 'Transaction stats rollup' })`.
- `apps/worker/src/workers/analyze.ts`: insert `'transaction-stats-rollup'` into the `stages` array between `'performance-test-metrics'` and `'statistics-calculation'` (line 106).
- The `PipelineOrchestrator.executeSequentialPipeline` already dispatches by stage name; no orchestrator change needed beyond registering.

### 4. Dashboard query switch — `TestRunsPerformanceQueryService`

File: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`

**`getTransactionStats`** (line 100): replace the `agg` CTE (line 146) with a direct SELECT from `test_run_transaction_stats`, filtered by `ramp_up_excluded = $excludeRampUp`. Keep `thresholds` and `scored` CTEs exactly as they are — they already use `approx_percentile` / `approx_percentile_rank` against `pct_agg` and that works unchanged against the stored tdigest.

```sql
WITH agg AS (
  SELECT
    trs.transaction_name,
    trs.scenario_name,
    trs.system_under_test_id,
    trs.test_environment,
    trs.workload,
    trs.total_count,
    trs.passed_count,
    trs.failed_count,
    trs.avg_response_time,
    trs.pct_agg,
    trs.impact_score
  FROM test_run_transaction_stats trs
  JOIN test_runs tr ON tr.test_run_id = trs.test_run_id
  JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
  WHERE trs.test_run_id = $1
    AND trs.ramp_up_excluded = $2        -- picks full vs ramp-up-excluded variant
    AND trs.total_count > 0              -- hides empty ramp-up-excluded rows
    ${orgFilterClause}
),
thresholds AS ( ... same ... ),
scored AS ( ... same, using a.pct_agg ... )
SELECT ... FROM scored ORDER BY transaction_name ASC;
```

**`sinceMinutes`**: still not servable by the rollup (would need a per-arbitrary-window aggregate). When set, fall through to the live-aggregation path (unchanged query text).

**`excludeRampUp`**: **now served by the rollup** — `ramp_up_excluded = $2` picks the correct variant. No fallback needed.

**In-progress fallback**: wrap the rollup-read path with an existence check:
```sql
SELECT 1 FROM test_run_transaction_stats WHERE test_run_id = $1 LIMIT 1
```
If zero, fall through to live aggregation. This handles: (a) in-progress runs, (b) legacy runs before backfill completes, (c) any run where the rollup stage failed.

**`getTransactionSamples`** (line 279): same pattern — `agg` CTE becomes a SELECT from `test_run_sampler_stats` filtered by `ramp_up_excluded = $excludeRampUp`, `threshold_config` CTE stays, URL-pattern LEFT JOIN stays. Fallback identical.

### 5. Ramp-up edit hook — invalidate and recompute

File: `apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts:306` (`updateAnalysisStartOffset`).

After the existing `updateAnalysisStartOffsetHandler.execute(...)` call, enqueue a `transaction-stats-rollup` job for that `testRunId` if the run is completed. Rationale: `ramp_up_excluded = true` rows are computed against the cutoff that was in effect at rollup time. Editing `analysisStartOffset` post-completion makes those rows silently wrong. The job is idempotent (UPSERT with `DO UPDATE`), so re-running is safe and cheap.

```ts
// after updateAnalysisStartOffsetHandler.execute(...)
if (result.completed) {
  await this.bullmqClientService.rollupTransactionStats(testRunId);
}
```

`bullmqClientService.rollupTransactionStats` is a thin wrapper that enqueues `JOB_NAMES.TRANSACTION_STATS_ROLLUP` with `{ testRunId }` — same entry point used by the backfill script.

### 6. Test-run deletion cleanup

File: `apps/api/src/modules/test-runs/processors/test-run-deletion.processor.ts` (already handles `ds_*` cleanup).

Add: `DELETE FROM test_run_transaction_stats WHERE test_run_id = $1` and the matching sampler table DELETE. Same transaction as existing cleanup.

### 7. Backfill

Separate, one-shot, resumable job. **Not** part of the migration — it runs against live production.

File: `apps/api/src/modules/test-runs/commands/backfill-test-run-stats.command.ts` (or a standalone script under `scripts/`).

Approach:
```sql
SELECT test_run_id FROM test_runs
WHERE completed = true
  AND test_run_id NOT IN (SELECT DISTINCT test_run_id FROM test_run_transaction_stats)
ORDER BY end_time DESC
LIMIT $batch_size;
```

For each batch, enqueue a `transaction-stats-rollup` job (same pipeline path as finalization — one code path, not two). Batch size configurable (default 50), poll interval 30s. Stops when the query returns zero rows.

Document in the migration commit message: "after deploy, run `npm run backfill:test-run-stats` (or equivalent) to populate existing runs." Not automatic because (a) blast radius is large, (b) ops needs to see the queue depth build up gradually.

### 8. Tests

**Worker (Vitest)**:
- `apps/worker/src/test/unit/pipelines/TransactionStatsRollupPipeline.test.ts`
  - empty test run → inserts 0 rows, returns success
  - single transaction, multi-sampler → correct counts + tdigest
  - re-run on already-rolled-up test run → idempotent via ON CONFLICT
- `apps/worker/src/test/integration/transaction-stats-rollup.integration.test.ts`
  - Against a real Timescale container: insert synthetic `transactions` + `requests_raw`, run pipeline, assert rollup rows + `approx_percentile(0.95, pct_agg)` matches `PERCENTILE_CONT(0.95)` on raw within <1% error.

**API (Jest)**:
- `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts`
  - mocks: rollup row exists → reads from rollup
  - mocks: no rollup row → falls back to live query
  - mocks: `sinceMinutes != null` → uses live query even if rollup exists
  - threshold change reflects on next read (no recompute needed)

**Performance verification (manual / documented in PR)**:
- On a real DB, run the exact test-run from the issue (`Schatkamer-production-streamWorkload-00018`, transaction `stream_download_segment`, 11.35M rows) and capture `EXPLAIN ANALYZE` before/after. Target: <1s end-to-end (acceptance criterion from #151).

### 9. Acceptance criteria (merged from both issues)

- [ ] Two rollup tables with appropriate PKs, indexed, documented.
- [ ] `transaction-stats-rollup` stage runs in the `analyze-test` pipeline; failure logs but does not abort the rest of the pipeline.
- [ ] `getTransactionStats` and `getTransactionSamples` read from rollup when available (both `excludeRampUp=true` and `false`); fall back to live aggregation when rollup rows are missing or `sinceMinutes` is set.
- [ ] Editing `analysisStartOffset` on a completed run re-enqueues the rollup job and the updated ramp-up-excluded rows reflect the new cutoff.
- [ ] No change to the returned DTO shape for either endpoint.
- [ ] `stream_download_segment` on `Schatkamer-production-streamWorkload-00018` returns in <1s (measured, captured in PR).
- [ ] p95/p99/Apdex still use `approx_percentile` / `approx_percentile_rank` on the stored tdigest — threshold edits take effect without a recompute job.
- [ ] Unit + integration tests pass: empty run, single-sampler, multi-scenario, p95/p99 correctness within <1% vs `PERCENTILE_CONT` on raw (for both `ramp_up_excluded` variants), idempotent re-run, ramp-up edit hook recomputes correctly.
- [ ] Fallback path has a regression test (in-progress run returns correct data from live query).
- [ ] Backfill script documented, dry-run safe, resumable.
- [ ] Test-run deletion cleans up rollup rows.
- [ ] `npm run test` + `npm run type-check` + `npm run lint` green.

---

## Out of scope

- **Time-bucket dashboards (RPS over time)** — belongs in #147 (continuous aggregates for `requests_raw` / `transactions`). Different access pattern, different data structure.
- **Retention** — belongs in #138. When it lands, add the two new rollup tables to the retention policy (keep longer than raw, since they're the long-term summary).
- **Materialized apdex_score snapshot** — deliberately not storing to avoid threshold-change invalidation complexity (user decision).
- **Arbitrary-window rollup (sinceMinutes)** — out of scope. Continuous aggregates (#147) are the better home for arbitrary time windows.
- **Composite (sut, env, scenario, time) indexes** — belongs in #137. Won't help this issue (filter is by `test_run_id`) but is useful for cross-run trending queries.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Rollup stage fails silently during analyze, dashboards show fallback query (slow) | Log error + surface via existing ProgressReporter; health check on rollup coverage (% of completed runs with rollup rows) |
| Backfill load spikes DB CPU during rollout | Batch + throttle; manual gated rollout documented in PR |
| `tdigest` storage size on very large test runs | Measure during integration test. Timescale tdigest default ~200-centroid sketch ≈ 2KB per row; storing both variants = ~4KB per row. Worst realistic case: 10k sampler groups × 4KB = 40MB per test run — fine. |
| `analysisStartOffset` edited post-completion invalidates `ramp_up_excluded=true` rows | `updateAnalysisStartOffset` enqueues the rollup job (step 5). Covered by regression test. |
| Threshold join still slow if `workload_apdex_thresholds` grows | Current tables are ~dozens of rows per SUT; not a concern until it is. No change from current code. |
| Test runs where `completed=true` but `transactions` / `requests_raw` still writing (race) | `handleCompletedTest` is the only writer to `completed=true` in the non-error path; rollup job runs inside the analyze-test lock which serializes against other analyze runs for the same `(sut, env, workload)` scope. |

---

## Files touched (estimated)

- NEW: `packages/shared/src/database/migrations/<ts>-CreateTestRunStatsRollup.ts`
- NEW: `apps/worker/src/pipelines/TransactionStatsRollupPipeline.ts` (~250 lines)
- NEW: `apps/worker/src/test/unit/pipelines/TransactionStatsRollupPipeline.test.ts`
- NEW: `apps/worker/src/test/integration/transaction-stats-rollup.integration.test.ts`
- NEW: backfill command/script
- EDIT: `apps/worker/src/types/jobs.ts` (~20 lines)
- EDIT: `apps/worker/src/workers/pipeline-registrations.ts` (~5 lines)
- EDIT: `apps/worker/src/workers/analyze.ts` (1 line — stages array)
- EDIT: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` (~80 lines — two query rewrites + existence check, bind `ramp_up_excluded` param)
- EDIT: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts`
- EDIT: `apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts` (~5 lines — re-enqueue rollup on `updateAnalysisStartOffset`)
- EDIT: `apps/api/src/modules/test-runs/processors/test-run-deletion.processor.ts` (2 DELETEs)

Total blast radius: ~9 files edited, ~5 files created. Reasonable for the impact.
