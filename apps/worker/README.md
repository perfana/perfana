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
transfer — has `pct_agg = NULL` and falls back to a raw scan over `ds_metrics` that exceeds
`ANALYTICS_STATEMENT_TIMEOUT_MS` on a large baseline, leaving `ds_control_group_statistics` empty
and ADAPT reporting INSUFFICIENT_DATA against a baseline that is fine.

`backfillMissingSketches()` runs before the aggregation transaction and reruns `StatisticsPipeline`
on those control runs so the fast path applies (#552). It is **best-effort**: any failure is caught
and the legacy scan still runs. `StatisticsPipeline` can also succeed while writing nothing (no
`ds_metrics` rows left), so check `processedRecords`, not `success`, before calling the sketches
repaired.

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
