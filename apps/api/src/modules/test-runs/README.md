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
| PUT | `/test-runs/:id/analysis-start-offset` | Crud | Set the ramp-up offset only |
| PUT | `/test-runs/:id/analysis-time-range` | Crud | Set both offsets. `applyToAll: true` writes them across the run's whole (system, environment, workload) and re-evaluates it — capped at 100 runs, 400 past that. Rejects offsets whose SUM leaves no analysis window |
| GET | `/test-runs/:id/analysis-time-range/scope` | Crud | Read-only preview of that apply: applicable count, total, per-run skip reasons (`running` / `too-short` / `not-writable`), and `exceedsCap` |
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
| GET | `/test-runs/:id/transactions/:name/timeseries` | Metrics | Time-series for a transaction (`aggregationSeconds` optional — omit to let the server pick from run duration) |
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

- All routes are protected by the global `KeycloakEnhancedAuthGuard` (Keycloak JWT *or* API key) except explicit `@Public()` endpoints.
- `@UserCtx()` injects `{ userId, roles, organizationId, organizations }`. Use `ctx.userId` and `ctx.roles` only — `ctx.organizations` is JWT-only and is often `[]`. Services resolve organizations themselves via `AuthorizationService.getAccessibleOrganizations(userId)`.
- Authorization splits two shapes. List methods in `services/test-runs-crud-query.service.ts` use `withOrgFilter` / `withTeamFilter`. Per-resource methods (`findByTestRunId`, `findOne`, `getTestRunByTestRunId`) delegate to the private `denialReason()` helper, which checks `isOrganizationMember` / `canViewTeamResources` against the joined `SystemUnderTest`. `denialReason()` fails closed: a missing `systemUnderTest` relation is a denial, not a skip.
- All five denial causes return an indistinguishable refusal to the caller (404, or `null` from `getTestRunByTestRunId`) so nobody learns whether a run exists. The server log is the only place they are distinguishable, so a new caller of `denialReason()` must log the returned reason before refusing, and must pass caller-supplied ids through `forLog()` to keep CR/LF out of the denial stream.
- The `POST /test` endpoint carries `@ThrottleConfig(200, 60000)` — 200 requests per minute — to protect against CI storms.
- Several Metrics endpoints are Phase 3 stubs: they accept requests and return 400 with a descriptive message rather than 501, so the Swagger UI remains usable.
- The four-controller split keeps files small; `TestRunsService` is the single DI injection point so controllers never import sub-services directly.
- `GET /test-runs/:id/transactions` and `/test-runs/:id/transactions/:name/samples` read from the per-run rollup tables (`test_run_transaction_stats`, `test_run_sampler_stats`) when a row exists for the requested `(test_run_id, ramp_up_excluded)` variant. p95/p99 and Apdex are computed at read time from the stored tdigest via `approx_percentile` / `approx_percentile_rank`, so editing `workload_apdex_thresholds` takes effect immediately with no recompute. While a run is still in flight (rollup table empty for the run window), the service serves Apdex from the `transactions_passed_*` / `requests_raw_passed_*` continuous aggregates (success-filtered `pct_agg_passed` sketch — same correctness as the post-test rollup) via the private `loadCaggApdexScope` / `getTransactionStatsFromCagg` / `getTransactionSamplesFromCagg` helpers in `services/test-runs-performance-query.service.ts`. Only when *both* the rollup table and the CAGG are empty does the controller emit HTTP 202 (rollup-pending) — the `getRollupStatus` helper is one of two signals for that gate. The raw-scan path over `requests_raw` is retained as a final fallback for un-backfilled runs and explicit `sinceMinutes` windows where neither the rollup nor the CAGG covers the requested timeframe. The rollup is populated by the `transaction-stats-rollup` worker stage in the `analyze-test` pipeline (runs after `performance-test-metrics`, before `metrics-collection`) (see `apps/worker/src/pipelines/TransactionStatsRollupPipeline.ts`) and by `apps/worker/scripts/backfill-test-run-stats-rollup.ts` for historical runs. CAGGs are created by migration `1779100000000-AddPctAggPassedCaggs`; production rollout requires phased backfill of historical data via `CALL refresh_continuous_aggregate(...)` in 1-day chunks during low-load hours.
- **The rollup is written in two halves that can disagree, and the read path repairs it (v0.2.94.2).** `transaction-stats-rollup` builds `test_run_transaction_stats` from `transactions` and `test_run_sampler_stats` from `requests_raw` in one transaction, but it runs ~0.2 s after the run is marked completed and `requests_raw` ingestion can still be in flight then — observed up to 36 s past `end_time`. The transaction half succeeds, the sampler half aggregates an empty table, and the whole thing commits looking healthy. Nothing retries it: `getRollupStatus` reads `test_run_transaction_stats`, so it answers `ready` forever after and every row expand falls to the CAGG path instead — measured 95 ms warm / 737 ms cold against 0.95 ms for the rollup read, on a 1.4 M-request run. `repairEmptySamplerRollup` in `services/test-runs-performance-query.service.ts` detects this on fall-through case 2 (rollup ready, no sampler row for the transaction) and re-enqueues the job. Four things about it are load-bearing. The job's first act is an **unconditional delete** of all three rollup tables for the run, so the probe checks every precondition the job needs — `completed`, non-null `start_time` **and** `end_time`, rows in `transactions`, rows in `requests_raw` with `transaction_name IS NOT NULL` (mirroring `SAMPLER_ROLLUP_SQL`'s own predicate), zero sampler rows for the *whole* run, and the org filter — in one round trip, because a re-run that cannot rebuild both halves would let a read destroy a working transaction rollup. The probe is deliberately **not** time-bounded: the rollup has no `time` predicate either, so a row arriving outside the recorded window is one the rollup would aggregate but a bounded probe would miss; unbounded is cheap because `test_run_id` leads `idx_requests_raw_test_run_id_time` and is the `compress_segmentby` key (1.9 ms, `Heap Fetches: 0`). It carries its own org filter because it runs *before* `loadCaggApdexScope`, which is what would otherwise be doing that scoping. And the enqueue is deferred through `runAfterRequestCommit` rather than awaited, so a Redis stall cannot hold a pooled Postgres connection idle-in-transaction; the probe itself runs on the caller's open RLS transaction behind a `SAVEPOINT`, so a failure there cannot put the transaction into 25P02 and break the CAGG read it exists to let proceed. Caveat: if the job exhausts its BullMQ retries it stays in the failed set under the same jobId, where a later `add` is a silent no-op — the repair goes quiet for that run until the failed job is cleared.
- `apps/worker/scripts/backfill-test-run-stats-rollup.ts` selects runs missing **either** half for the same reason — the old transaction-only predicate skipped exactly the affected runs, which are the ones that need it. It also terminates on "a poll returned no ids it has not already served *this invocation*", not on an empty poll: a run whose `requests_raw` holds nothing the rollup will aggregate never gains sampler rows, stays a candidate forever, and would otherwise pin the head of `ORDER BY end_time DESC LIMIT 50` and spin the script on the same page. The per-invocation exclusion set is re-sent in full on every poll, so a backfill over tens of thousands of runs degrades toward the end — an accepted ceiling for a manual operator tool; swap it for a keyset cursor on `(end_time, created_at)` if it ever needs to scale.
- `GET /test-runs/:id/transactions/:name/timeseries` returns a padded `transaction_data` series and an **unpadded** `sampler_data` map, on purpose. Padding the per-sampler series against the bucket grid costs buckets x samplers rows — a 3 h run with 19 samplers produced 41,420 rows for 560 rows of data, an 11.8 MB response. The web client re-grids the sampler series against `transaction_data` before plotting (`buildSamplerTraces`), because Plotly's `stackgaps: 'infer zero'` cannot fill a bucket that no trace in the stackgroup carries — without the re-grid an idle window renders as a solid band. Both halves are load-bearing; see CLAUDE.md, "The transaction time-series route pads one series and deliberately not the other".
- On that same route `aggregationSeconds` is optional (`ParseIntPipe({ optional: true })`, no `DefaultValuePipe`). Omitted, the service picks a bucket from the run duration via `AGGREGATION_LADDER` in `services/test-runs-timeseries-query.service.ts`, targeting ~360 points per series, and echoes the choice back as `aggregation_seconds` — clients divide throughput counts by that, not by 5. The resolution happens *after* the org access check so an unauthorized caller cannot probe run durations. The sibling single-sampler route `/samplers/:name/timeseries` still defaults to 5 s.
