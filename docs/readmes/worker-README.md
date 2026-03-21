# @perfana/worker — BullMQ Pipeline Processor

## Pipeline Index

| Pipeline | File | Registry name | Purpose |
|----------|------|--------------|---------|
| Metrics | `stages/metrics.pipeline.ts` | `'metrics'` | Collects from Grafana via MetricsSource |
| Statistics | `stages/statistics.pipeline.ts` | `'statistics'` | TimescaleDB percentile aggregation |
| **ADAPT** | `stages/adapt.pipeline.ts` | `'adapt'` | **Core IP** — regression detection |
| Checks | `stages/checks.pipeline.ts` | `'checks'` | SLO benchmark evaluation |
| Control Groups | `stages/control-groups.pipeline.ts` | `'control-groups'` | Baseline management |
| Panels | `stages/panels.pipeline.ts` | `'panels'` | Panel config + Dynatrace support |
| Perf Test Metrics | `stages/performance-test-metrics.pipeline.ts` | `'performance-test-metrics'` | JMeter/Gatling extraction (5 sub-stages) |
| Reevaluate | `stages/reevaluate.pipeline.ts` | `'reevaluate'` | Re-run checks after config changes |

ADAPT helper files in `stages/adapt/`: `adapt-config.ts`, `adapt-results-sql.ts`, `adapt-conclusion-sql.ts`

## Analysis Sequence

```
┌─────────┐   ┌────────┐   ┌─────────┐   ┌────────────┐   ┌──────────────┐   ┌───────┐   ┌────────┐
│ Panels  │──▶│ Perf   │──▶│ Metrics │──▶│ Statistics │──▶│ Control      │──▶│ ADAPT │──▶│ Checks │
│         │   │ Test   │   │ Collect │   │ Compute    │   │ Groups       │   │       │   │ SLOs   │
└─────────┘   └────────┘   └─────────┘   └────────────┘   └──────────────┘   └───────┘   └────────┘
```

Defined in `pipelines/sequences.ts` as `ANALYSIS_SEQUENCE`.

## Pipeline Registry Pattern

Replaces the original hard-wired `PipelineOrchestrator`. Adding a new pipeline:

1. Create `stages/<name>.pipeline.ts` extending `BasePipeline<Input, Output>`
2. Set `name = '<name>'` property
3. Implement `execute(input): Promise<Result<Output, PipelineError>>`
4. Register in registry: `registry.register('<name>', new MyPipeline())`
5. Add to sequence constant if it belongs in a standard flow

```typescript
// Every pipeline returns a discriminated union — no exceptions for flow control
type Result<T, E> = { ok: true; data: T } | { ok: false; error: E };
```

## ADAPT Algorithm (Summary)

The ADAPT pipeline compares test run metrics against control group baselines:

1. **Config lookup** (hierarchical): metric → panel → dashboard → global → default
2. **Threshold calculation**: percentage (15%), IQR (2x), absolute
3. **Conclusion**: improvement / regression / no-difference / incomparable
4. **Tracked re-evaluation**: re-checks historical regressions with new data

Full algorithm documented in `stages/adapt.pipeline.ts` header comment.

## Queue Architecture

| Queue | Name | Concurrency | Jobs |
|-------|------|-------------|------|
| Analyze | `perfana-analyze` | 5 | analyze-test, metrics-collection, statistics, adapt, checks, panels, control-groups, dynatrace, reevaluate |
| Batch | `perfana-batch` | 2 | batch-analysis, reevaluation-batch |

Config in `config/queues.ts`. Per-job retry options with exponential backoff.

## Job Handlers

| Handler | File | Triggers |
|---------|------|----------|
| Analyze | `jobs/analyze.job.ts` | Single test run through full pipeline sequence |
| Reevaluate Batch | `jobs/reevaluate-batch.job.ts` | Batch re-evaluation (missing-data or force mode) |

## Key Files

| File | Purpose |
|------|---------|
| `worker.ts` | Entry point — NestJS context, Redis, BullMQ workers, shutdown |
| `app.module.ts` | Root module (ConfigModule, TypeOrmModule, WorkerModule) |
| `common/worker-database.service.ts` | TypeORM repositories for all worker entities |
| `pipelines/base.pipeline.ts` | `BasePipeline<T,U>` abstract class, `Result<T,E>` type |
| `pipelines/registry.ts` | `PipelineRegistry` — register, get, runSequence |
| `config/environment.ts` | Zod-validated worker config |
| `config/queues.ts` | Queue names, job routing, retry options |
