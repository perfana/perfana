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
