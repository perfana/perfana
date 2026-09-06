# Perfana Worker

> Back to [CLAUDE.md](../../CLAUDE.md) for project-wide context.

Background job processing service using **BullMQ** with Redis for queue management and PostgreSQL for data storage.

## Architecture

- **Queue System**: BullMQ v5 with Redis (multi-queue: critical, processing, background, batch, delayed)
- **Pipeline Pattern**: All pipelines extend `BasePipelineTypeORM` — provides DB access, transactions, structured logging
- **Registration**: Pipelines registered declaratively in `src/workers/pipeline-registrations.ts`

## Pipelines

| Pipeline | Job Name | Purpose |
|---|---|---|
| MetricsPipeline | `metrics-collection` | Grafana data extraction |
| StatisticsPipeline | `statistics-calculation` | Statistical aggregations |
| AdaptPipeline | `adapt-analysis` | ADAPT regression detection |
| ControlGroupsPipeline | `control-groups-pipeline` | Baseline comparison groups |
| ControlGroupStatisticsPipeline | `control-group-statistics` | Control group stats |
| ChecksPipeline | `checks-evaluation` | Performance requirement evaluation |
| PanelsPipeline | `panels-processing` | Dashboard panel processing |
| DynatracePipeline | `dynatrace-collection` | Dynatrace monitoring data |
| PerformanceTestMetricsPipeline | `performance-test-metrics` | Perf test source metrics |
| TransactionStatsRollupPipeline | `transaction-stats-rollup` | Per-test-run tdigest rollup for transactions/samplers (#150, #151) |
| ReevaluateChecksPipeline | `reevaluate-checks` | Re-evaluate check results |
| DataSanityCheckPipeline | _(none)_ | Post-analysis validation — no job name; called directly by `analyzeTestWorker` |

`statistics-calculation` is also enqueued on its own, outside an analysis run: the API's
`POST /data/recalculate-statistics/:testRunId` puts it on `perfana-analyze` so a run's
`ds_metric_statistics` can be rebuilt from `ds_metrics` already in the database. It fetches nothing
from Grafana or Dynatrace, so it is safe on a run whose dashboard window has expired.

`transaction-stats-rollup` is likewise enqueued from outside an analysis run, by the API's read
path. The stage writes `test_run_transaction_stats` (from `transactions`) and
`test_run_sampler_stats` (from `requests_raw`) in one transaction, but it runs ~0.2s after the run
is marked completed, and `requests_raw` ingestion can still be in flight — observed up to 36s past
`end_time`. The transaction half then succeeds, the sampler half aggregates an empty table, and the
job commits looking healthy; nothing retries it, because every readiness check reads the half that
was written. `repairEmptySamplerRollup` in the API detects the mismatch on the first row expand and
re-enqueues this job. Two consequences for anyone changing the pipeline: its first act is an
**unconditional delete** of all three rollup tables for the run, so the API's probe has to prove
both halves can be rebuilt before asking for a re-run — a re-run that cannot would let a read
destroy the working half; and if the job exhausts its retries it stays in BullMQ's failed set under
the same jobId, where a later `add` is a silent no-op and the repair goes quiet until that job is
cleared. `scripts/backfill-test-run-stats-rollup.ts` is the operator-side fix: it selects runs
missing **either** half (a transaction-only predicate skipped exactly the affected runs) and stops
when a poll returns no ids it has not already served this invocation, since an unrepairable run
stays a candidate forever.

### `ds_adapt_results` is upserted, so `AdaptPipeline` also has to delete

`ResultsProcessor.processAdaptResults` is a pure `INSERT … ON CONFLICT DO UPDATE` sourced from
`ds_metric_statistics`. Narrowing a run's analysis time range makes `StatisticsPipeline` delete and
rewrite that table from the new offsets, so the excluded metrics vanish from it — and until
v0.2.94.7 their `ds_adapt_results` rows survived, still labelled from the old window.
`buildConclusionSQL` counts every row for the run with no freshness predicate, so one orphan pinned
the run at REGRESSION forever. `is_stale` does not help: only the
`mark_results_stale_on_config_change` trigger sets it, and neither the conclusion SQL nor the API
read path reads it.

`ResultsProcessor.deleteOrphanedResults()` now runs right after the upsert as the
`delete-orphaned-results` substage, scoped to the same `metricFilter` so a single-metric
re-analysis cannot delete anything else. Two rules if you touch it:

- **Keep the `EXISTS` guard.** It refuses to run against a test run with zero
  `ds_metric_statistics` rows. "Every metric is orphaned" is never real — it means the statistics
  computation produced nothing, and deleting on that reading destroys history that cannot be
  rebuilt once `ds_metrics` has aged out. `StatisticsPipeline` reaches that state while returning
  `{ success: true }` (it warns `Metrics exist … but no statistics were written` when org-scoping
  drops every dashboard), and `AdaptValidator.checkEmptyControlGroups` selects `FROM
  ds_metric_statistics` and groups by `test_run_id`, so a run with no rows forms no group and is
  never reported as empty. Same reasoning as `repairEmptySamplerRollup` in the API: the probe stays
  strict because the statement deletes. (Until v0.2.95.0 `StatisticsPipeline`'s own metrics probe
  was evaluated batch-wide while its `DELETE` was too, so one live run could authorise wiping an
  aged-out run's statistics — see "The metrics probe is per run" below.)
- **It fixes one orphan class only.** The unique key carries `control_group_id`; the `DELETE`
  ignores it on purpose and matches on metric identity. A metric that keeps its statistics but
  loses its control-group row keeps its stale verdict — that is the `pct_agg` baseline case below,
  and it is unchanged.

### The control-group fast path needs `pct_agg`

`ControlGroupStatisticsPipeline` pools per-run t-digests with `rollup(pct_agg)` (#289). A control
run whose `ds_metric_statistics` rows predate that column — or that came from a backup or a SUT
transfer — has `pct_agg = NULL` and falls back to a raw scan over `ds_metrics` that runs out of
time on a large baseline, leaving `ds_control_group_statistics` empty and ADAPT reporting
INSUFFICIENT_DATA against a baseline that is fine.

`backfillMissingSketches()` runs before the aggregation transaction and reruns `StatisticsPipeline`
on those control runs so the fast path applies (#552). It is **best-effort**: any failure is caught
and the legacy scan still runs. `StatisticsPipeline` can also succeed while writing nothing (no
`ds_metrics` rows left), so check `processedRecords`, not `success`, before calling the sketches
repaired.

It **chunks itself**, on the same `REEVALUATE_CHUNK_SIZE` the orchestrator uses (v0.2.95.0).
Chunking the caller does not bound it: the orchestrator chunks *control groups*, and this expands
each group to its member test runs, so a 5-group chunk routinely becomes 50+ runs. Those all land
in one `StatisticsPipeline` invocation sharing a single transaction's
`max_tuples_decompressed_per_dml_transaction` budget — which reintroduces `tuple decompression
limit exceeded` through the back door, where the catch above swallows it into the legacy raw scan
that then blows the 540s aggregation budget. The constant is imported from `lib/utils/chunking.ts`
rather than redeclared, so the two cannot drift while bounding the same budget.

### The metrics probe is per run

`StatisticsPipeline.filterRunsWithMetrics` probes each run individually for any `ds_metrics` rows,
and the decompression, the `ramp_up` refresh and the aggregation all run on exactly that filtered
set. Two rules:

- **Per run, not per batch.** A batch-wide answer let one run with live metrics authorise deleting
  the statistics of every aged-out run beside it, while the re-`INSERT` only refilled the runs that
  still had raw data. For an older run that is unrecoverable. Harmless while batches were small and
  hand-picked; an analysis-window apply across a workload mixes recent and aged-out runs by
  construction, which is what made it reachable. Each probe is an index descent stopping at the
  first row (`test_run_id` leads the index and is the `compress_segmentby` key), so N probes cost
  effectively nothing.
- **It asks only whether rows EXIST, never whether any are in-window.** A `ramp_up = false` probe
  would answer against the very flags `refreshRampUpFlags` is about to rewrite, and its answer
  decides whether the run gets new flags at all. "The new window excludes every sample" is also a
  correct outcome that should produce empty statistics, not a skipped run stranded with new flags
  and the previous window's statistics. The cost is that a zero-row result after a positive probe
  now has two causes — org-scoping dropped every dashboard, or the window legitimately excludes
  everything — so it warns rather than asserts.

### Heavy aggregations get their own budget (v0.2.93.3)

`StatisticsPipeline` and `ControlGroupStatisticsPipeline` call
`BasePipelineTypeORM.setAggregationBudget(manager)` as the **first** statement inside
`withAnalyticsTransaction`. It applies `AGGREGATION_STATEMENT_TIMEOUT_MS` (default `540000`) and
`AGGREGATION_WORK_MEM` (default `128MB`) via `set_config(name, value, true)` — bound, not
interpolated, so an operator-supplied env string never reaches the parser.

Three rules if you touch this:

- **First statement, not next to the `INSERT`.** `SET LOCAL` is transaction-scoped. Placing it
  beside the aggregation leaves every earlier statement on the 120s cap, including
  `StatisticsPipeline`'s `ramp_up` refresh, which rewrites a compressed run and is the statement
  most likely to exceed it. In `ControlGroupStatisticsPipeline` it is set once for the whole batch
  rather than per group, because a per-group `SET LOCAL` would silently widen the budget for every
  later group anyway.
- **Separate from `ANALYTICS_STATEMENT_TIMEOUT_MS` on purpose.** That one is a *cap* on runaway
  reads and has to stay lowerable; these two are the job's own work and a 20M-row run needs more
  than 120s. Lowering the analytics cap no longer shortens these jobs.
- **Keep the timeout strictly below `600000`** — the analytics pool's client-side `query_timeout`
  (`src/config/typeorm.config.ts`). At equal deadlines node-postgres destroys the connection instead
  of letting Postgres cancel the statement, so you lose the clean rollback and get a torn socket
  instead of `canceling statement due to statement timeout`.

Read from `process.env` rather than `getConfig()`, mirrored in `src/config/environment.ts` so a bad
value is rejected at boot — same reason `TransactionStatsRollupPipeline` reads
`ROLLUP_STATEMENT_TIMEOUT_MS` directly: the full schema needs secrets a unit test has no reason to
provide.

### Updating `ramp_up` on compressed `ds_metrics`

`ds_metrics` is compressed with `compress_segmentby = 'test_run_id'` from 7 days on, and `ramp_up`
is neither segmentby nor orderby — so an `UPDATE` guarded on it decompresses the run's entire
segment as DML even when zero rows change, up to
`max_tuples_decompressed_per_dml_transaction` (100k, charged per **transaction**).

`StatisticsPipeline` handles this in three steps, and all three matter:

1. `findRunsWithStaleRampUpFlags` asks with a **SELECT** (a read decompresses transiently and
   rewrites nothing) and returns `MIN(m.time)`/`MAX(m.time)` over the **disagreeing rows** — not
   the run's `start_time`/`end_time`.
2. `decompressChunksForRange` is then called **per run, outside the transaction**, over those
   bounds. `decompress_chunk` is chunk-granular and a chunk holds every run in its time range, so a
   wider range converts other runs' data to row store too and slows every later query over that
   window until the compression policy catches up. A stale trailing flag spans minutes; run-wide
   bounds decompressed hours, and a batch spanning months decompressed the months between.
3. The `UPDATE` runs once per run, bound to the same `test_run_id` + `time` bounds — both
   compression-aware columns, so TimescaleDB skips whole batches on their min/max metadata.

Its "skipped" path logs at **warn**: a silent no-op (chunk owned by another role, recompressed in
between, TimescaleDB error) surfaces later as `tuple decompression limit exceeded` with nothing in
the log explaining why.

**Do not add a diagnostic `COUNT` back to either pipeline.** Three of them existed only to log
"will process N unique metrics" and warn on an expected-vs-actual mismatch, and each read
`ds_metrics` in full — 16s for a `COUNT(*)` on 20.6M rows, 32s on that same run for a composite
`COUNT(DISTINCT ...)` (unparallelisable, spills an external sort of anonymous `ROW()` values, and
still costs 4.7s / ~370MB of temp I/O on a run of only 1.58M rows), and the control-group twin,
which scanned raw `ds_metrics` **on the fast path too**. Only an `EXISTS` probe survives, guarding
the `DELETE` so a run whose `ds_metrics` have aged out keeps its statistics instead of having them
wiped and replaced with nothing. Every number the removed logs carried is in the `INSERT`'s row
count already.

### Complex Workers (custom logic)

- `analyzeTestWorker` — orchestrates full test analysis (`analyze-test`)
- `incrementalMetricsWorker` — incremental metric collection (`collect-metrics-incremental`)
- `simpleOrchestrateReevaluateBatchWorker` — batch re-evaluation orchestration

## Quick Start

```bash
npm install
npm run dev        # Development with watch
npm run build      # Production build
npm start          # Run built output
```

## Environment

Uses the same database env vars as the API service:
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`

Grafana URLs and API tokens are fetched from the `grafana_instances` table.

Worker-specific tuning (full schema and defaults in `src/config/environment.ts`):

| Variable | Default | What it does |
|---|---|---|
| `ANALYTICS_STATEMENT_TIMEOUT_MS` | `120000` | Cap on analytics reads, to stop a runaway query holding a connection. Lowerable. Does **not** apply to the two heavy aggregations below. |
| `AGGREGATION_STATEMENT_TIMEOUT_MS` | `540000` | Budget for `StatisticsPipeline` / `ControlGroupStatisticsPipeline`. Must stay strictly under the analytics pool's client-side `query_timeout` (600000). |
| `AGGREGATION_WORK_MEM` | `128MB` | `work_mem` for those two. Keeps ~20k `percentile_agg` sketches in a HashAggregate; spilling turns the aggregation into a GroupAggregate that sorts every input row to disk. Charged per hash/sort node, per parallel worker, and per concurrent job — deploy-wide peak is roughly this x (1 + `max_parallel_workers_per_gather`) x 4. |
| `REEVALUATE_CHUNK_SIZE` | `5` | Runs per `statistics-calculation` / `control-group-statistics` / `adapt-analysis` job inside the re-evaluate orchestrator, and per `StatisticsPipeline` invocation inside `backfillMissingSketches`. Read in `lib/utils/chunking.ts`, not `environment.ts`, so a pipeline can import it without pulling in BullMQ. |
| `WORKER_ANALYZE_CONCURRENCY` / `WORKER_BATCH_CONCURRENCY` | `2` / `2` | Concurrent jobs per queue. Both multiply the `work_mem` peak above. |
| `AUDIT_RETENTION_MONTHS` | `24` | `AuditRetentionManager` deletes `audit_logs` rows older than this on boot and daily at 03:00 UTC. |

## Adding a Pipeline

1. Create a class in `src/pipelines/` extending `BasePipelineTypeORM`
2. Add a job name to `JOB_NAMES` in `src/types/jobs.ts` (+ Zod schema, queue config)
3. Register in `src/workers/pipeline-registrations.ts` via `registerPipeline()`

See [Tutorial 2 in CLAUDE.md](../../CLAUDE.md) for the full walkthrough.

### Adding a stage to the analyze-test pipeline

A stage that runs inside `PipelineOrchestrator` needs **both** a `case` in `executeStage` and its
name in the exported `ORCHESTRATED_STAGES` list. A name with no case there is not a runtime
warning: it returns `success: false` and, under `errorHandling: 'abort'`, fails the whole run.
That is how `'data-sanity-check'` sat in the analyze plan and made every analysis report
`'partial'` until v0.2.74.0.

Declare your execution plan as `OrchestratedStage[]` so a bad name is a compile error. Note this
is a caller-side discipline, not something the orchestrator enforces — `executeSequentialPipeline`
still takes `stages: string[]`, so an un-annotated caller can pass any string and get no type
error at all.

If the stage runs *outside* the orchestrator (like the data sanity check), add it to the worker's
UI-facing `stages` list only, pass `finalizeProgress: false` to `executeSequentialPipeline`, and
publish `complete()` / `fail()` yourself after it finishes — the web client discards progress once
the terminal event lands.

Either way, add the stage id to `PIPELINE_STAGES` in
`packages/shared/src/types/job-progress.types.ts` or the UI shows the raw id: `getStageName()`
falls back to the id it was given rather than failing.

### Waiting on a `softFail` pipeline

A pipeline registered with `softFail: true` returns `{ status: 'failed' }` instead of throwing, so
BullMQ marks the job **completed**. Waiting for the job to finish therefore proves nothing about
whether the work succeeded. Read the job's `returnvalue` — `simple-orchestrate-reevaluate-batch.ts`
exports `assertStageSucceeded(stage, returnValue)` for exactly this — or the orchestrator logs a
green tick and the next stage runs on empty data. That is how a failed `control-group-statistics`
used to reach ADAPT with no baseline and get the baseline blamed (#552).

### Reporting failure by returning marks the job COMPLETED

`simple-workers.ts` wraps every processor as `return await processor(job)`. Returning any value —
`{ status: 'failed', errors: [...] }` included — resolves that promise, so BullMQ records the job
as **completed**: `attempts` never fires, nothing lands in the failed set, and no operator can find
it. Throwing is the only way a job fails.

`softFail` above is the one place the return *is* the contract, because a named caller reads
`returnvalue`. Everywhere else, grep `status: 'failed'` under `src/workers/` before adding another:

| Site | Behaviour |
|---|---|
| `simple-orchestrate-reevaluate-batch.ts` | **Throws** since v0.2.95.0, on a scope-lock refusal and from its catch-all. Returning left `test_runs.ramp_up` written with `ds_metric_statistics` never recalculated, behind a green job; with chunking it also leaves earlier chunks rewritten and the rest on the old window. Retries come from the enqueue (`bullmq-client.service.ts`: `attempts: 2`, fixed 10s), **not** the queue default in `simple-queues.ts`. |
| `analyze.ts` | **Throws on the scope-lock refusal only** (v0.2.95.0). Its catch-all still returns — a remaining instance, not a fixed one. The lock branch mattered because a workload-wide analysis-window apply holds `sut:env:workload` across all its chunks, and every run finishing in that window was recorded as analysed without benchmarks, ADAPT or rollup. |
| `incremental-metrics.ts` | Returns **deliberately** — a scheduler re-drives it next cycle, so a BullMQ failure would double the retry. |

### The re-evaluate orchestrator chunks its heavy stages

`simpleOrchestrateReevaluateBatchWorker` splits `statistics-recalculation`,
`control-group-statistics` and `adapt-analysis` into sequential jobs of at most
`REEVALUATE_CHUNK_SIZE` runs (default 5, `lib/utils/chunking.ts`). Each of those pipelines does its
work in one transaction over every id it is handed, against a ceiling that scales with the batch —
ADAPT's 120s `ANALYTICS_STATEMENT_TIMEOUT_MS` (it never calls `setAggregationBudget`), the
decompression budget shared by `refreshRampUpFlags`' per-run UPDATEs, and the 540s aggregation
budget inside a 600s `JOB_WAIT_TIMEOUT_MS` wait.

Three things to keep in mind:

- **Chunk inside the one job, never by issuing several batch jobs.** The scope lock is keyed on
  `sut:env:workload`, so a second job for the same workload is refused, not queued.
- **Sequential, not parallel.** The chunks contend for the same analytics pool and the same
  compressed chunks. A chunk's `storeTrackedResults` also reads other chunks' `ds_adapt_results`,
  so an earlier chunk sees its later siblings' pre-refresh rows — the same staleness a two-batch
  re-evaluate has always had, and better than the timeout it replaces.
- **`checks-evaluation` and `control-groups-creation` are still unchunked.** `ControlGroupsPipeline`
  wraps its loop over every run in a single `withTransaction`; both must finish inside
  `JOB_WAIT_TIMEOUT_MS`. At the API's 100-run bulk cap those are the tightest remaining constraint
  in the chain and have not been measured — see TODOS.md.

`waitForJobs` now removes the orphaned child job on timeout. Abandoning only the wait was
survivable while the orchestrator returned a failure BullMQ recorded as completed; now that it
throws and retries, the retry would re-enqueue the same stage for the same ids while the orphan is
still running.

`recalculateStatistics` (a boolean on `OrchestrateReevaluateBatchJobSchema`) runs
`statistics-recalculation` with no data collection, for the case where the analysis *window* moved
but the data did not. The two `refreshMode` branches gate that stage on a fetch having returned new
rows, which no window edit can satisfy — so without this flag the stage was advertised, marked
complete, and did nothing. The orchestrator prints the flag in its config line on purpose: Zod
strips unknown keys, so during a rolling deploy an older worker drops the field silently and the
user's edit becomes an unexplained no-op.

### The analyze-test job result

`JobResult.data` for `analyze-test` carries `dataSanity`, the sanity check's verdict. At runtime it
is `{ valid, reasons, warnings }` as returned by `DataSanityCheckPipeline`; `analyze.ts` narrows it
to `{ valid?: boolean; reasons?: string[] }` inline, so `warnings` is present in the payload but
absent from the type. `JobResult` in `src/types/jobs.ts` still types `data` as
`Record<string, unknown>`, so a CI consumer reading `dataSanity` has no checked contract — treat
the field as best-effort until it is typed properly.

## Key Base Class Methods

```typescript
// BasePipelineTypeORM provides:
abstract execute(input: unknown): Promise<PipelineResult>
protected withTransaction<T>(op: (manager: EntityManager) => Promise<T>): Promise<T>
protected query<T>(sql: string, params?: any[]): Promise<T[]>
protected writeQuery<T>(sql: string, params?: any[]): Promise<T[]>
protected logPerformance(operation: string, startTime: number, details?: Record<string, unknown>): void
protected logError(error: Error, context?: Record<string, unknown>): void
```

## Testing

- **Framework**: Vitest
- **Unit tests**: `src/test/unit/` — `npx vitest run`
- **Integration tests**: `src/test/integration/` — `npm run test:integration`
- **Real-world tests**: `src/test/integration/real-world/` — `npm run test:real-world` (requires production DB)
- **Config**: `vitest.config.ts` (unit), `vitest.integration.config.ts` (integration)
