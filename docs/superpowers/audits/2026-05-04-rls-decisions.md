# RBAC Phase 5b — RLS Activation Decisions

**Spec:** [`2026-05-04-rbac-phase5b-rls-design.md`](../specs/2026-05-04-rbac-phase5b-rls-design.md)
**Plan:** [`2026-05-04-rbac-phase5b-rls.md`](../plans/2026-05-04-rbac-phase5b-rls.md)

## Brainstorm decisions (locked 2026-05-04)

| # | Decision | Rationale |
|---|----------|-----------|
| Q1 | Activation + audit (no helper redesign) | Existing infra mostly correct. |
| Q2 | Transaction-scoped `SET LOCAL` via interceptor | Strongest isolation; zero leak risk. |
| Q3 | `perfana_system` role + identity GUCs for non-API processes | Audit identity matches DB identity. |
| Q4 | Single boolean flag, env-gated rollout | Reversible by config rollback. |
| Q5 | Keep service-layer + RLS as belt-and-suspenders | RLS = defense-in-depth, not replacement. |
| Q6 | Full per-entity test matrix (26 × 7 × 4) | Pin policy expressions; service-layer tests don't cover. |
| Q7 | Tighten `test_runs`; special-case `audit_logs` | Backfill `test_runs.organization_id` from SUT. |

## Lint coverage notes (PR3)

The lint rule `owned-resource-must-use-request-em` matches `@InjectRepository(<EntityName>)` against the `OWNED_RESOURCE_ENTITIES` set. To match the actual code, the set includes both the canonical class names and the import-alias forms used in the codebase:

| Canonical | Alias used in code |
|-----------|--------------------|
| `ApplicationDashboard` | `ApplicationDashboardEntity` |
| `Benchmark` | `BenchmarkEntity` |
| `DeepLink` | `DeepLinkEntity` |
| `GenericDeepLink` | `GenericDeepLinkEntity` |
| `GrafanaDashboard` | `GrafanaDashboardEntity` |
| `GrafanaInstance` | `GrafanaInstanceEntity` |
| `MetricsSource` | `MetricsSourceEntity` |
| `PyroscopeInstance` | `PyroscopeInstanceEntity` |
| `TestRun` | `TestRunEntity` |
| `TracingInstance` | `TracingInstanceEntity` |

Without the alias entries, ~28 service / handler files using the aliased forms (the test-runs handler suite, all grafana services, benchmark services, etc.) would never trigger the rule. Adding new aliases for an already-owned entity requires updating the set; adding a new owned entity requires adding both the canonical and any alias.

The allowlist (58 entries at PR3 merge) includes:

- **Owned-resource services and controllers** that inject owned entities directly. These are the bulk migration targets for PR4–PR18.
- **Custom repositories** under `apps/api/src/repositories/` and `apps/api/src/modules/*/...repository.ts`. The `TypeOrmBaseRepository` migration in PR4 covers all standard CRUD; PR5 covers the bespoke methods.
- **`AuthorizationService`** (`apps/api/src/common/services/authorization.service.ts`) — special case. The `RlsTransactionInterceptor` itself depends on this service to load `getAccessibleOrganizations(userId)` before opening the transaction. Wrapping its repo calls in `withRequestEm()` would create a chicken-and-egg: the interceptor needs the org list to set the GUC, but `withRequestEm()` needs the GUC to be set first. This is documented in the audit doc and resolved during PR4–PR18 by either (a) keeping `AuthorizationService` permanently allowlisted with the rationale spelled out, or (b) using the system data source factory for the bootstrap query path. The decision is deferred to whichever PR migrates this file.

False-positive pruning: `apps/api/src/common/services/authorized-base.service.ts` matched the discovery regex via a JSDoc example (`*     @InjectRepository(TestRun)`) but has no real injection; excluded from the allowlist.

## Migration burndown

(Updated as service-migration PRs land. Each PR removes entries from `apps/api/.rls-em-migration-allowlist.json`.)

| PR | Service group | Files migrated | Allowlist size after |
|----|---------------|----------------|----------------------|
| PR3 | (initial allowlist) | 0 | 58 |
| PR4 | TypeOrmBaseRepository (standard CRUD across 8 Pattern A repos) | 1 file (base class) | 58 (Pattern A files stay until PR5 covers bespoke methods) |
| PR5 | Pattern A bespoke methods (8 custom repos) | 8 files | TBD |
| PR6 | Pattern B services (initial batch) | TBD | TBD |
| PR7 | dynatrace + grafana batch | TBD | TBD |
| PR8 | tracing + pyroscope | TBD | TBD |
| PR9 | presets (graph, compare, trends) | TBD | TBD |
| PR10 | deep-links + generic-deep-links | TBD | TBD |
| PR11 | notifications + alerts | TBD | TBD |
| PR12 | profiles + profile-children | TBD | TBD |
| PR13 | systems-under-test | TBD | TBD |
| PR14 | test-runs handlers + services (largest) | TBD | TBD |
| PR15 | benchmarks + expected-config-change | TBD | TBD |
| PR16 | reports | TBD | TBD |
| PR17 | metrics-sources + sparse-metric-exclusion + alert-tag-filters | TBD | TBD |
| PR18 | provisioning + cleanup | TBD | TBD |

## PR notes

(Each PR appends a section with anything non-mechanical.)

### PR1 (2026-05-04 → 2026-05-04, merged in #260) — schema tightening

Tightened RLS helpers and policy expressions to match the post-Phase-4 NOT-NULL invariant on `organization_id`. Special-cased `audit_logs` (kept nullable) and `test_runs` (backfilled from SUT, then tightened). Fixed dormant policies that never had `ENABLE ROW LEVEL SECURITY` applied.

### PR2 (2026-05-04 → 2026-05-04, merged in #261) — interceptor + system data sources

- `withRequestEm()` helper (CLS-aware repo wrapper).
- `@SkipRls()` decorator for streaming endpoints.
- `RlsTransactionInterceptor` registered globally.
- System data source factory (`perfana_system` role with identity GUCs) wired into worker / grafana-sync / perfana-report.
- Connection draining at boot for the system data source.
- `/api/users/me/db-context` health endpoint.

### PR3 (2026-05-04 → 2026-05-05, merged in #262) — lint rule + allowlist + drift agent

This file. Adds the migration scaffolding so PR4–PR18 can land service-by-service with lint enforcement of the wrapping pattern. No runtime behavior change.

### PR4 (2026-05-05 → ?) — `TypeOrmBaseRepository` to `withRequestEm`

Wraps every `this.repository.X(...)` call in the base class with `withRequestEm(...)`. Single base-class change covers standard CRUD across the 8 custom repositories that extend it. Pattern A files (api-key, application-dashboard, compare-filter-preset, expected-config-change, test-run-configuration, test-run, tracing-service, trends-filter-preset) remain on the allowlist until PR5 migrates their bespoke methods. `getRepository()` accessor is intentionally left unwrapped — it returns the bare repo for subclasses to use directly, and those direct uses are caught by the lint rule on a per-file basis.
