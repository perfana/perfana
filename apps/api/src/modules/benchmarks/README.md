# benchmarks

SLO (Service Level Objective) management for performance benchmarks, including metric-based SLOs and Apdex SLOs, with tag synchronization against MetricsSource.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/benchmarks` | List benchmarks; filter by `systemUnderTestId`, `testEnvironment`, `workload`, `enabled`, `valid`, `benchmarkType` |
| GET | `/benchmarks/:id` | Single benchmark by UUID |
| POST | `/benchmarks` | Create a metric-based SLO |
| PUT | `/benchmarks/:id` | Update a metric-based SLO |
| DELETE | `/benchmarks/:id` | Delete a benchmark |
| POST | `/benchmarks/:id/duplicate` | Clone an SLO into its own SUT / environment / workload. The clone arrives **disabled** |
| POST | `/benchmarks/copy` | Copy SLOs from one scope to another |
| POST | `/benchmarks/aggregated` | Create an aggregated (whole-panel) SLO |
| PUT | `/benchmarks/aggregated/:id` | Update an aggregated SLO |
| GET | `/benchmarks/system/:systemId/config-options` | Available environments and workloads for a system |
| GET | `/benchmarks/tag-sync-status` | Sync status between benchmark tags and MetricsSource tags |
| POST | `/benchmarks/sync-tags` | Trigger tag synchronization with MetricsSource |
| GET | `/benchmarks/apdex/threshold` | Resolve Apdex threshold for a scope (with fallback chain) |
| GET | `/benchmarks/apdex/transactions/:testRunId` | List transaction names available for a test run |
| POST | `/benchmarks/apdex` | Create an Apdex SLO |
| PUT | `/benchmarks/apdex/:id` | Update an Apdex SLO |
| POST | `/benchmarks/apdex/preview` | Calculate Apdex score preview without persisting |

## Key files

| File | Purpose |
|------|---------|
| `benchmarks.module.ts` | Module registration; imports sub-services |
| `benchmarks.controller.ts` | Single controller; all routes under `/benchmarks` |
| `benchmarks.service.ts` | Facade — delegates to sub-services; enforces org-scoped access |
| `services/benchmark-query.service.ts` | Read queries: list, find-one, tag sync status |
| `services/benchmark-mutation.service.ts` | Write operations: create, update, delete, copy, Apdex SLO mutations |
| `services/benchmark-calculator.service.ts` | Pure Apdex calculation logic (preview and threshold resolution) |
| `services/benchmark-tag.helper.ts` | Tag synchronization helpers against MetricsSource entities |
| `services/benchmark.mapper.ts` | Maps DB rows to response DTOs |
| `dto/copy-benchmarks.dto.ts` | DTO for the copy-scope operation |

## Notes

- The `benchmarkType` filter accepts `'metric'` or `'apdex'`; omitting it returns both types.
- `GET /benchmarks/apdex/threshold` resolves with a fallback chain: transaction-level → workload-level → system default. The response includes a `source` field indicating which level was used.
- Org-scoped access is enforced via `ctx.organizations` (the list of org IDs the user belongs to); global admins bypass this check.
- `POST /benchmarks/copy` supports cross-environment and cross-workload bulk SLO copying; the response reports `{ copied, skipped, total }`. Since v0.2.96.15 `skipped` carries two different outcomes — the caller's `conflictStrategy: skip` on a row the `conflictKey` probe found, and a row `uq_benchmarks_active_metric_target` refused — and only the server log tells them apart (open TODOS.md item).
- **`uq_benchmarks_active_metric_target` refuses a second *enabled* metric SLO on the same panel, series and aggregation** (migration 1812, v0.2.96.15). `create` and `update` answer 23505 on it with a **409** carrying `DUPLICATE_TARGET_MESSAGE`; `copyToScope` counts it as `skipped`. Three rules for anyone writing to this table:
  - The 409 is a **hard refusal**, not the repo's idempotent-provisioning 409 — no resource comes back. The controller's `create` catch block must keep its `if (error instanceof HttpException) throw error;` guard or the ConflictException flattens into a 500.
  - Recognise the violation with `isDuplicateSloTargetError` from `@perfana/shared` (`utils/duplicate-slo-target.ts`), never a local copy of the index name: grafana-sync's `AutoConfigUpdatesService` writes the same table and has to agree about what the refusal means.
  - Swallowing 23505 inside a request needs a SAVEPOINT. `RlsTransactionInterceptor` wraps the request in one transaction and `POST /benchmarks/copy` has no `@SkipRls`, so catching without rolling back leaves an aborted transaction (25P02) and a 500. `saveSkippingDuplicateTarget` does this, gated on `getRequestEm() !== null`.
- `POST /benchmarks/:id/duplicate` clones **disabled** on purpose: until it is edited the clone is identical to its source in every column the index keys on, and `WHERE valid AND enabled` is the only thing keeping it legal. Enabling it unedited gets the 409 from `update`. `enabled` is settable through `PUT /benchmarks/:id` (the Enabled checkbox in the edit dialog), which is how a clone is recovered — note the body is still an untyped inline type, so nothing validates or documents the field yet (open TODOS.md item).
- Tag sync (`sync-tags`) aligns benchmark tags with the tags defined on MetricsSource entities — necessary when Grafana panel tags change.
- DTOs for `CreateBenchmarkDto`, `UpdateBenchmarkDto`, `CreateApdexSloDto`, and `UpdateApdexSloDto` are exported from `services/index.ts`.
- `POST`/`PUT /benchmarks/apdex` take `apdexMinSamples` (v0.2.95.34): the fewest executions a transaction needs before its Apdex score can fail the SLO. Integer `1..2147483647`, 400 otherwise (`assertApdexMinSamples` in `benchmark-mutation.service.ts`); create defaults to 50, and `null` on update resets to 50. The stored column `benchmarks.apdex_min_samples` is nullable (SUT imports from before migration 1808 insert NULL), so `BenchmarkMapper` returns `apdex_min_samples ?? 50`. The floor counts every execution, failed ones included; a transaction below it gets `meets_requirement: null` and `below_min_samples: true` from the worker, which the run verdict treats as a pass.
- `evaluateType: 'trend'` (v0.2.96.4) judges the drift of a series *within* the run: `StatisticsPipeline` writes `ds_metric_statistics.trend_pct_per_hour` (OLS slope of value against time, as % of the series mean per hour) and `trend_corr` (Pearson r), and `DataAggregator` maps `trend` onto the first. It catches what neither a scalar SLO nor ADAPT does — a run that starts fine and degrades, on a workload whose baseline runs all degrade the same way. `metric_unit` is forced to `%/h` on create and update, whatever the panel's unit. A series with `|r| < 0.5` or fewer than 10 points is reported with its slope but passed rather than judged against the threshold (`meets_requirement: true`, `weak_trend: true`, `trend_corr` on the target, and left out of the panel average) — v0.2.96.7; it was `null` before that, which made a check whose series were all weak read `None of the N targets could be evaluated`. The UI shows "No clear trend". The floors are module constants in `DataAggregator` (`TREND_MIN_CORR`, `TREND_MIN_POINTS`), not benchmark columns; NaN r counts as weak. A check whose *match pattern* excludes every series still gets `meets_requirement: null` and the message `None of the N targets could be evaluated` — never an affirmative pass — and the `%/h` rule is applied by every writer of `metric_unit` (`BenchmarkMutationService`, `ProfilesService`, `ProvisioningService`; grafana-sync copies the profile's unit). Rows written before migration 1809 have NULL trend columns until the run's statistics are recalculated, so a trend SLO on an old run reports no targets.
