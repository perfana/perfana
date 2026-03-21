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
| `analyze-test` | perfana-analyze | Main pipeline (9 stages) |
| `metrics-collection` | perfana-analyze | Grafana/Dynatrace data extraction |
| `statistics-pipeline` | perfana-analyze | Statistical aggregations |
| `checks-evaluation` | perfana-analyze | SLO threshold evaluation |
| `adapt-analysis` | perfana-analyze | Regression detection (768MB) |
| `reevaluate-checks` | perfana-analyze | Re-run checks with updated benchmarks |
| `collect-metrics-incremental` | perfana-analyze | Real-time collection for running tests |
| `orchestrate-reevaluate-batch` | perfana-batch | Complex batch operations |

## Analysis Pipeline (9 Stages)

When a test run completes, the `PipelineOrchestrator` executes these stages sequentially:

```
Stage 1: Dynatrace Collection
  └── Fetches service/host metrics from Dynatrace API

Stage 2: Panels Processing
  └── Creates dashboard panel documents from Grafana config

Stage 3: Performance Test Metrics
  └── Extracts JMeter/Gatling/k6 raw metrics

Stage 4: Metrics Collection
  └── Pulls time-series data from Grafana/Prometheus/InfluxDB
  └── Stores in ds_metrics hypertable

Stage 5: Statistics Calculation
  └── Computes p50, p95, p99, min, max, mean, stddev
  └── Stores in ds_metric_statistics

Stage 6: Checks Evaluation
  └── Evaluates SLO thresholds → check_results
  └── Compares against baselines → compare_results

Stage 7: Control Groups
  └── Groups similar historical test runs

Stage 8: Control Group Statistics
  └── Aggregates statistics across control group

Stage 9: ADAPT Analysis
  └── Automated regression detection
  └── Stores in ds_adapt_results
```

## Pipeline Implementations

10 pipeline classes in `apps/worker/src/pipelines/`:

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
| `IncrementalMetricsPipeline` | Metrics for running tests |

## Key Services

| Service | Purpose |
|---|---|
| `PipelineOrchestrator` | Coordinates all 10 pipeline implementations |
| `JobLockService` | Prevents concurrent jobs on same scope |
| `ProgressReporter` | Redis pub/sub for real-time UI progress |
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
