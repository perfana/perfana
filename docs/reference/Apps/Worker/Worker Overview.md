---
aliases:
  - Worker
  - Job Processor
tags:
  - app/worker
---

# Worker Overview

The Worker service is the core processing engine for performance analysis. It runs background pipelines using BullMQ (Redis-backed job queue) to collect metrics, compute statistics, and detect regressions.

> [!info] Location
> `apps/worker/` — No HTTP port — Connects to Redis and PostgreSQL

## Architecture

- **Framework**: NestJS
- **Job Queue**: BullMQ with Redis
- **ORM**: TypeORM (PostgreSQL)
- **Queues**: 2 simplified queues (`perfana-analyze`, `perfana-batch`)
- **Blocking mode**: BRPOPLPUSH for <10ms job pickup latency

## Job Types

| Job | Queue | Description |
|---|---|---|
| `analyze-test` | perfana-analyze | Main pipeline (11 stages — 10 orchestrated + data sanity check) |
| `metrics-collection` | perfana-analyze | Grafana/Dynatrace data extraction |
| `statistics-pipeline` | perfana-analyze | Statistical aggregations |
| `checks-evaluation` | perfana-analyze | SLO threshold evaluation |
| `adapt-analysis` | perfana-analyze | Regression detection (768MB) |
| `transaction-stats-rollup` | perfana-analyze | Per-test-run transaction/sampler tdigest rollup |
| `reevaluate-checks` | perfana-analyze | Re-run checks with updated benchmarks |
| `collect-metrics-incremental` | perfana-analyze | Real-time collection for running tests |
| `orchestrate-reevaluate-batch` | perfana-batch | Batch re-evaluation — see [[#Re-evaluation batches are chunked]] |

## Analysis Pipeline (11 Stages)

When a test run completes, `analyzeTestWorker` reports 11 stages to the UI (10 when `adapt=false`,
which drops stage 10). The orchestrated stages run first, inside `PipelineOrchestrator`; the data
sanity check runs in the worker afterwards.

```
Stage 1: Dynatrace Collection
  └── Fetches service/host metrics from Dynatrace API

Stage 2: Panels Processing
  └── Creates dashboard panel documents from Grafana config

Stage 3: Performance Test Metrics
  └── Extracts JMeter/Gatling/k6 raw metrics

Stage 4: Transaction Stats Rollup
  └── Pre-computes per-run transaction + sampler aggregates (count, tdigest, impact score)
  └── Stores in test_run_transaction_stats / test_run_sampler_stats
  └── Soft-fail: remaining stages continue if this times out

Stage 5: Metrics Collection
  └── Pulls time-series data from Grafana/Prometheus/InfluxDB
  └── Stores in ds_metrics hypertable

Stage 6: Statistics Calculation
  └── Computes p50, p95, p99, min, max, mean, stddev
  └── Stores in ds_metric_statistics

Stage 7: Checks Evaluation
  └── Evaluates SLO thresholds → check_results
  └── Compares against baselines → compare_results

Stage 8: Control Groups
  └── Groups similar historical test runs

Stage 9: Control Group Statistics
  └── Aggregates statistics across control group

Stage 10: ADAPT Analysis (optional — skipped when adapt=false)
  └── Automated regression detection
  └── Upserts into ds_adapt_results, then deletes the results whose metric no longer
      has a ds_metric_statistics row (`delete-orphaned-results`), then concludes

Stage 11: Data Sanity Check (runs outside the orchestrator)
  └── Collects invalidating reasons: no start/end time, no dashboard panels, no metrics
      data, statistics not calculated, ADAPT ran but produced no results
  └── valid = reasons.length === 0
  └── Never fails the job — the verdict is returned as `dataSanity` in the job result
```

> [!warning] Stage 11 is not an orchestrator stage
> `PipelineOrchestrator.executeStage` can only dispatch the names in its exported
> `ORCHESTRATED_STAGES` list (stages 1-10). Anything else falls through to the `default` branch,
> returns `success: false`, and under `errorHandling: 'abort'` fails the whole run. Passing
> `'data-sanity-check'` in the execution plan is exactly what made every analysis report
> `'partial'` until v0.2.74.0. Declare an execution plan as `OrchestratedStage[]` so a stage with
> no case in the orchestrator is a compile error — a caller-side discipline, not an enforced one:
> `executeSequentialPipeline` still accepts `stages: string[]`.
>
> A third list, `PIPELINE_STAGES` in `packages/shared/src/types/job-progress.types.ts`, maps stage
> ids to display names. A stage missing from it renders in the UI as its raw id.
>
> The two lists are deliberately separate in `analyze.ts`: `orchestratedStages` is what runs,
> `stages` is what the progress bar counts. The worker also passes `finalizeProgress: false` and
> publishes `complete()` / `fail()` itself once the sanity check is done — the web client stops
> accepting progress the moment `job:completed` arrives, so a stage reported after finalization is
> never rendered.

## Pipeline Implementations

12 pipeline classes in `apps/worker/src/pipelines/`:

| Pipeline | Purpose |
|---|---|
| `MetricsPipeline` | Extract metrics from Grafana/Dynatrace |
| `StatisticsPipeline` | Calculate statistical aggregations |
| `ChecksPipeline` | Evaluate against SLO thresholds |
| `ControlGroupsPipeline` | Group similar historical test runs |
| `ControlGroupStatisticsPipeline` | Aggregate control group stats |
| `AdaptPipeline` | ADAPT regression detection algorithm |
| `PanelsPipeline` | Create dashboard panel documents |
| `DynatracePipeline` | Dynatrace synthetic metrics |
| `PerformanceTestMetricsPipeline` | JMeter/LoadRunner raw metrics |
| `TransactionStatsRollupPipeline` | Per-test-run tdigest rollup for transactions / samplers (backs `/test-runs/:id/transactions`) |
| `IncrementalMetricsPipeline` | Metrics for running tests |
| `DataSanityCheckPipeline` | Post-analysis validation — the only pipeline the orchestrator does not own; `analyzeTestWorker` calls it directly |

## Key Services

| Service | Purpose |
|---|---|
| `PipelineOrchestrator` | Coordinates 11 pipeline implementations; dispatches the 10 stage names in `ORCHESTRATED_STAGES` |
| `JobLockService` | Prevents concurrent jobs on same scope |
| `ProgressReporter` | Redis pub/sub for real-time UI progress. `complete()` / `fail()` are terminal — publish them only after the last stage the UI lists, or that stage is never rendered |
| `StuckJobScanner` | Scans every 2 min for jobs stuck >10 min |
| `MetricCollectionGapService` | Detects and fills incomplete collections |
| `DatabaseService` | TypeORM wrapper for all data access |

## Resource Allocation

| Pipeline | Workers | Memory |
|---|---|---|
| ADAPT | 2 | 768MB each |
| Metrics | 8 | 256MB each |
| Statistics | 3-6 | 256-384MB each |
| Checks | 3-6 | 256-384MB each |

These are **worker process** budgets. The heavy aggregation transactions in `StatisticsPipeline` and `ControlGroupStatisticsPipeline` also carry a **database-side** budget, set per transaction by `BasePipelineTypeORM.setAggregationBudget()`: `AGGREGATION_STATEMENT_TIMEOUT_MS` (default 540s) and `AGGREGATION_WORK_MEM` (default 128MB). Both are separate from `ANALYTICS_STATEMENT_TIMEOUT_MS`, which stays a lowerable 120s cap on ordinary analytics reads and no longer applies to these two jobs. The `work_mem` value is charged per hash/sort node, per parallel worker, and per concurrent job — size it against the database host's RAM rather than the worker container's. See [[Environment Variables]].

## Re-evaluation batches are chunked

`simpleOrchestrateReevaluateBatchWorker` re-runs analysis for a set of test runs without collecting
new data. Since v0.2.95.0 it splits its three heaviest stages — `statistics-recalculation`,
`control-group-statistics` and `adapt-analysis` — into sequential child jobs of at most
`REEVALUATE_CHUNK_SIZE` runs (default 5). Each of those pipelines does its work in one transaction
over every id it is handed, against a ceiling that scales with the batch: ADAPT's 120s statement
timeout, the per-transaction decompression budget shared by the `ramp_up` updates, and the 540s
aggregation budget inside a 600s wait for the child job.

The chunking has to happen **inside** the one job rather than by enqueuing several batch jobs,
because `JobLockService` keys its lock on `{systemUnderTestId}:{testEnvironment}:{workload}` — a
second job for the same workload is refused, not queued. `checks-evaluation` and
`control-groups-creation` still receive the whole list.

Two consequences for anyone reading its logs:

- A refused lock or a mid-run error now **throws**. Returning `{ status: 'failed' }` resolved the
  processor promise, so BullMQ recorded the job as completed and nothing retried it — see
  `apps/worker/README.md` for the repo-wide shape of that trap and which sites still do it.
- `recalculateStatistics` in the job payload runs the statistics stage with no data collection, for
  an analysis-window change that no data fetch can detect. It is printed in the config line so a
  rolling deploy where an older worker strips the unknown field shows up in the log rather than as
  a silent no-op.

## Queue Configuration

```
Default retry: 3 attempts with exponential backoff
Job retention: 10 completed, 5 failed
Rate limiting: 100 jobs/minute per worker
Redis prefix: "bull"
maxRetriesPerRequest: null (BullMQ requirement)
enableReadyCheck: false
```

## Scheduled Tasks

| Task | Interval | Purpose |
|---|---|---|
| `IncrementalCollectionScheduler` | Every 2 min | Collect metrics for running tests |
| `StuckJobScanner` | Every 2 min | Detect and recover stuck jobs |
| `AuditRetentionManager` | On boot + 03:00 UTC daily | Delete `audit_logs` rows past `AUDIT_RETENTION_MONTHS` (default 24), 10k at a time. The boot pass is not awaited, so it never delays BullMQ worker registration. |

> [!note] Schedulers cannot issue DDL
> The worker's pool enters every connection as `perfana_system` (`createSystemDataSource`), which
> has `USAGE` but not `CREATE` on schema `public` and owns no table. A scheduled task can read and
> write rows; it cannot create, alter or drop one. `AuditRetentionManager` replaced a partition
> manager that had been failing silently on exactly this for months.

## Startup Sequence

1. Load environment config
2. Bootstrap NestJS (TypeORM DI)
3. Initialize Redis pool (20 max, 5 min connections)
4. Test connections
5. Register simplified workers
6. Start StuckJobScanner
7. Setup graceful shutdown handlers

> [!warning] Multi-tenant Security Fix
> Worker pipelines originally did NOT filter by `organization_id`, causing cross-organization data leakage. This was identified as a critical security issue and fixed by adding `organization_id` filtering to all `WorkerDatabaseService` query methods. See [[Multi-tenancy]].

## Related

- [[Data Flow]] — Pipeline execution in context
- [[ADAPT Algorithm]] — Regression detection details
- [[Architecture Overview]]
