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
| POST | `/benchmarks/copy` | Copy SLOs from one scope to another |
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
- `POST /benchmarks/copy` supports cross-environment and cross-workload bulk SLO copying; the response reports `{ copied, skipped, total }`.
- Tag sync (`sync-tags`) aligns benchmark tags with the tags defined on MetricsSource entities — necessary when Grafana panel tags change.
- DTOs for `CreateBenchmarkDto`, `UpdateBenchmarkDto`, `CreateApdexSloDto`, and `UpdateApdexSloDto` are exported from `services/index.ts`.
