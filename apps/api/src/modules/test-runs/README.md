# test-runs

Domain module for the full lifecycle of a performance test run — from init through metrics analysis and SLO evaluation.

## Endpoints

| Method | Path | Controller | Purpose |
|--------|------|------------|---------|
| GET | `/test-runs` | Crud | Paginated list with org/role filtering |
| GET | `/test-runs/dashboard/statistics` | Crud | Aggregate stats for dashboard (24h/7d/30d) |
| GET | `/test-runs/dashboard/recent-failures` | Crud | Recent failed runs list |
| GET | `/test-runs/dashboard/systems-summary` | Crud | Pass/fail ratio per system |
| GET | `/test-runs/:testRunId` | Crud | Single run; accepts `system+environment+workload` query params |
| PUT | `/test-runs/:id/annotations` | Crud | Update annotation tags |
| PUT | `/test-runs/:id/tags` | Crud | Update free-form tags |
| DELETE | `/test-runs/:id` | Crud | Hard-delete a run |
| POST | `/test/init` | Crud | Reserve a `testRunId` before a test starts |
| POST | `/test` | Crud | Event-reporting endpoint (throttled 200 req/min) |
| POST | `/test-runs/jtl-upload` | Crud | JTL zip upload — stub, wired in Phase 3 |
| GET | `/test-runs/baseline-candidates` | Analysis | Completed runs eligible for baseline comparison |
| GET | `/test-runs/test-runs-after-changepoint` | Analysis | Runs after the most recent changepoint |
| GET | `/test-runs/test-runs-more-recent-than` | Analysis | Runs newer than a given `baseTestRunId` |
| POST | `/test-runs/mark-changepoint` | Analysis | Tag a run as a changepoint |
| DELETE | `/test-runs/remove-changepoint` | Analysis | Un-tag a changepoint |
| GET/POST/PUT/DELETE | `/test-runs/ds-compare-config` | Analysis | CRUD for datasource comparison config |
| GET | `/test-runs/:id/ds-adapt-result` | Analysis | ADAPT anomaly data for a panel/metric |
| GET | `/test-runs/:id/anomaly-detection` | Analysis | Anomaly detection results |
| DELETE | `/test-runs/:id/anomaly-data` | Analysis | Delete anomaly data (scope: metric/panel, range: run/all) |
| PUT | `/test-runs/:id/adapt-config` | Analysis | Toggle ADAPT differences-accepted flag |
| POST | `/test-runs/:id/classify-metric` | Analysis | Classify a metric for analysis |
| GET/POST/DELETE | `/config/key`, `/config/keys`, `/config/json` | Config | Ingest key-value config pairs from CI |
| GET | `/config/systems` | Config | All systems with environments and workloads |
| GET | `/test-runs/:id/configs` | Config | Config items attached to a run |
| GET | `/test-runs/:id/related` | Config | Runs sharing the same system/environment/workload |
| GET | `/test-runs/:id/check-results` | Config | SLO check results for a run |
| GET | `/test-runs/config-keys/latest` | Config | Distinct config keys from the most recent run |
| GET/POST/DELETE | `/test-runs/expected-config-changes` | Config | CRUD for expected config change suppressions |
| GET/POST/DELETE | `/test-runs/sparse-metric-exclusions` | Config | CRUD for sparse metric exclusion rules |
| GET | `/test-runs/:id/transactions` | Metrics | Transaction stats with Apdex scores |
| GET | `/test-runs/:id/transactions/:name/samples` | Metrics | Per-transaction sampler breakdown |
| GET | `/test-runs/:id/transactions/:name/timeseries` | Metrics | Time-series for a transaction |
| GET | `/test-runs/:id/transactions/:name/samplers/:name/timeseries` | Metrics | Time-series for a single sampler |
| GET | `/test-runs/:id/virtual-users` | Metrics | Virtual user counts (overall and by scenario) |
| GET | `/test-runs/:id/throughput` | Metrics | Peak throughput stats |
| GET | `/test-runs/:id/errors` | Metrics | Grouped error statistics |
| GET/PUT | `/test-runs/:id/apdex-threshold` | Metrics | Workload-level Apdex threshold |
| GET/PUT/DELETE | `/test-runs/:id/transactions/:name/apdex-threshold` | Metrics | Per-transaction Apdex threshold |
| GET | `/test-runs/:id/transactions/:name/apdex-preview` | Metrics | Preview Apdex with a hypothetical threshold (Phase 3) |
| POST | `/test-runs/:id/baseline-apdex/preview` | Metrics | Preview optimal threshold calculation (Phase 3) |
| POST | `/test-runs/:id/baseline-apdex/apply` | Metrics | Apply optimal Apdex thresholds (Phase 3) |

## Key files

| File | Purpose |
|------|---------|
| `test-runs.module.ts` | Module wiring — imports sub-services and registers all four controllers |
| `test-runs.service.ts` | Thin facade; delegates every call to Query or Mutation sub-service |
| `services/test-runs-query.service.ts` | All read operations (Phase 3 stubs throw `NotImplementedException`) |
| `services/test-runs-mutation.service.ts` | All write operations (Phase 3 stubs throw `NotImplementedException`) |
| `controllers/test-runs-crud.controller.ts` | CRUD, dashboard, init, event-reporting, JTL upload |
| `controllers/test-runs-analysis.controller.ts` | Changepoints, ADAPT, anomaly detection, DS compare config |
| `controllers/test-runs-config.controller.ts` | CI config ingestion, related runs, SLO checks, sparse exclusions |
| `controllers/test-runs-metrics.controller.ts` | Transactions, Apdex thresholds, virtual users, errors |

## Notes

- All routes require JWT bearer auth via the global `JwtAuthGuard` except explicit `@Public()` endpoints.
- `@UserCtx()` injects `{ userId, roles, organizationId, organizations }` from the JWT; services use this for row-level access control.
- The `POST /test` endpoint carries `@ThrottleConfig(200, 60000)` — 200 requests per minute — to protect against CI storms.
- Several Metrics endpoints are Phase 3 stubs: they accept requests and return 400 with a descriptive message rather than 501, so the Swagger UI remains usable.
- The four-controller split keeps files small; `TestRunsService` is the single DI injection point so controllers never import sub-services directly.
- `GET /test-runs/:id/transactions` and `/test-runs/:id/transactions/:name/samples` read from the per-run rollup tables (`test_run_transaction_stats`, `test_run_sampler_stats`) when a row exists for the requested `(test_run_id, ramp_up_excluded)` variant. p95/p99 and Apdex are computed at read time from the stored tdigest via `approx_percentile` / `approx_percentile_rank`, so editing `workload_apdex_thresholds` takes effect immediately with no recompute. The service falls back to live aggregation over `requests_raw` for in-progress runs, un-backfilled runs, or when a `sinceMinutes` window is specified. The rollup is populated by the `transaction-stats-rollup` worker stage in the `analyze-test` pipeline (runs after `performance-test-metrics`, before `metrics-collection`) (see `apps/worker/src/pipelines/TransactionStatsRollupPipeline.ts`) and by `apps/worker/scripts/backfill-test-run-stats-rollup.ts` for historical runs.
