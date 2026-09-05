---
tags:
  - architecture
  - data-flow
---

# Data Flow

## Test Run Lifecycle

A test run goes through several phases from creation to final analysis.

### 1. Test Run Initialization

```
Performance Tool (JMeter, Gatling, k6)
  │
  ▼
POST /api/test-runs/init  ──▶  API creates TestRun record
  │                              │
  ▼                              ▼
Metrics streaming begins    Status: INITIALIZING
```

The test tool sends an init request with:
- `systemUnderTestId`, `testEnvironment`, `workload`
- Test configuration metadata
- Start timestamp

### 2. Real-time Metric Collection (During Test)

```
Test Running
  │
  ├──▶ IncrementalCollectionScheduler (every 2 min)
  │      │
  │      ▼
  │    Grafana API ──▶ ds_metrics (TimescaleDB hypertable)
  │    Dynatrace API ──▶ ds_metrics
  │
  ├──▶ WebSocket ──▶ Frontend (live updates)
  │
  ▼
Test Completes ──▶ Status: COMPLETED
```

### 3. Analysis Pipeline (Post-Test)

When a test run completes, the API enqueues an `analyze-test` job to the Worker:

```
API enqueues job ──▶ Redis (BullMQ) ──▶ Worker picks up
  │
  ▼
PipelineOrchestrator executes stages 1-10 sequentially, then the worker runs stage 11:

Stage 1: Dynatrace Collection
  └── Fetches service/host metrics from Dynatrace API

Stage 2: Panels Processing
  └── Creates dashboard panel documents from Grafana config

Stage 3: Performance Test Metrics
  └── Extracts JMeter/Gatling raw metrics

Stage 4: Transaction Stats Rollup
  └── Pre-computes per-run transaction + sampler aggregates (count, tdigest, impact score)
  └── Stores in test_run_transaction_stats / test_run_sampler_stats
  └── Backs /test-runs/:id/transactions — p95/p99/Apdex computed at read time via approx_percentile on the stored tdigest
  └── While a run is still in flight (rollup table empty), live Apdex queries are served from the
      transactions_passed_* / requests_raw_passed_* continuous aggregates so the page stays fast on
      10M-row in-flight runs. See Database/Continuous Aggregates.md for the CAGG family.

Stage 5: Metrics Collection
  └── Pulls time-series data from Grafana/Prometheus/InfluxDB
  └── Stores in ds_metrics hypertable

Stage 6: Statistics Calculation
  └── Computes p50, p95, p99, min, max, mean, stddev
  └── Stores in ds_metric_statistics

Stage 7: Checks Evaluation
  └── Evaluates SLO thresholds (check_results)
  └── Compares against baselines (compare_results)

Stage 8: Control Groups
  └── Groups similar historical test runs
  └── Identifies baseline candidates

Stage 9: Control Group Statistics
  └── Aggregates statistics across control group

Stage 10: ADAPT Analysis
  └── Automated regression detection algorithm
  └── Upserts results into ds_adapt_results, then deletes the ones whose metric no
      longer has statistics (a narrowed analysis time range leaves them behind)

Stage 11: Data Sanity Check (run by analyzeTestWorker, not the orchestrator)
  └── Marks the run invalid on any of: no start/end time, no dashboard panels, no metrics
      data, statistics not calculated, ADAPT ran but produced no results
  └── Never fails the job — the verdict comes back as `dataSanity` in the job result
```

The orchestrator only knows the ten stage names in its exported `ORCHESTRATED_STAGES` list. A
name outside that list returns `success: false` and, under `errorHandling: 'abort'`, fails the
whole run — which is why `analyze.ts` keeps `orchestratedStages` (what runs) separate from
`stages` (what the progress bar counts).

### 4. Progress Reporting

```
Worker (each stage)
  │
  ▼
Redis Pub/Sub (progress channel)
  │
  ▼
API (RealtimeService)
  │
  ▼
WebSocket ──▶ Frontend (progress bar, stage indicator)
```

The terminal event must be published **after** the last stage the UI lists. The web client stops
accepting progress for a job the moment `job:completed` arrives, so anything reported later is
dropped. The late write also costs retention: `complete()` sets the progress key's TTL to 1 hour
and `fail()` to 2 hours, but a stage reported afterwards rewrites the key at the ordinary 5-minute
progress TTL, so the post-mortem record expires far sooner than intended.
`analyzeTestWorker` therefore passes `finalizeProgress: false` to `executeSequentialPipeline` and
publishes `complete()` / `fail()` itself once stage 11 is done.

### 5. Grafana Dashboard Sync

Independent of test runs, runs continuously:

```
Grafana Sync Service (every 30s)
  │
  ├──▶ Fetch dashboards from Grafana API
  │      │
  │      ▼
  │    Compare with DB records
  │      │
  │      ├── New? ──▶ Store in application_dashboards
  │      ├── Changed? ──▶ Update in DB
  │      └── Missing in Grafana? ──▶ Restore from DB
  │
  └──▶ Auto-Config (optional)
         │
         ├── Find candidate dashboards
         ├── Discover variables (service, pod, etc.)
         └── Create application_dashboard entries
```

## Data Sources

```
                    ┌─────────────┐
                    │  Grafana    │──── InfluxDB
                    │             │──── Prometheus
                    └──────┬──────┘
                           │
┌─────────────┐    ┌───────▼───────┐    ┌──────────────┐
│  Dynatrace  │───▶│   Perfana     │◀───│  JMeter/     │
│  (APM)      │    │   Worker      │    │  Gatling/k6  │
└─────────────┘    └───────┬───────┘    └──────────────┘
                           │
┌─────────────┐    ┌───────▼───────┐
│  Pyroscope  │───▶│   PostgreSQL  │
│  (Profiles) │    │  TimescaleDB  │
└─────────────┘    └───────────────┘
┌─────────────┐
│  Tempo      │
│  (Traces)   │
└─────────────┘
```

## Related

- [[Architecture Overview]]
- [[Worker Overview]] — Pipeline processing details
- [[ADAPT Algorithm]] — Regression detection analysis
- [[Integrations]] — External data source configuration
