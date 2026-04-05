# Perfana Worker

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
| ReevaluateChecksPipeline | `reevaluate-checks` | Re-evaluate check results |

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
