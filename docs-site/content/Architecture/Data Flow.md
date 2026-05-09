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
PipelineOrchestrator executes 10 stages sequentially:

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
  └── Stores results in ds_adapt_results
```

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
