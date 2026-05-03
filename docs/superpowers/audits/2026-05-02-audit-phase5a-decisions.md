# Phase 5a Audit Migration — Decisions & Burndown

**Started:** 2026-05-02. **Spec:** [`docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md`](../specs/2026-05-02-rbac-phase5a-audit-completion-design.md). **Plan:** [`docs/superpowers/plans/2026-05-02-rbac-phase5a-audit-completion.md`](../plans/2026-05-02-rbac-phase5a-audit-completion.md).

This doc is the self-contained reference for the Phase 5a audit-logging migration: the decisions, the migration burndown, and the priority order. The ESLint rule `audit-mutation-must-log` reads `apps/api/.audit-migration-allowlist.json` — every entry there is a service file that mutates an `OwnedResource` without yet calling `auditService.log{Create,Update,Delete}`. As services migrate, they leave the allowlist; when the allowlist empties and the drift agent reports zero new sites for two consecutive runs, Phase 5a's audit migration is done.

## Decisions

Reproduced from the spec for self-contained reference.

| # | Decision | Rationale |
|---|---|---|
| Q1 | Split Phase 5 into 5a (audit) and 5b (RLS); ship 5a first | Independent subsystems; smaller spec lands faster, RLS still needs a benchmarking spike |
| Q2 | Design for forensics + activity feed + (default-everything foundation) | User chose D ("all three") — driver is foundational; security monitoring slice deferred to follow-on phase |
| Q3 | Skip ACCESS events entirely | Reads dominate volume 100:1; reconstructible from logs/metrics; activity feed is a feed of *changes* |
| Q4 | Service-layer explicit `auditService.log{Create,Update,Delete}` calls — NOT a TypeORM subscriber, NOT a method decorator | Reliable diffs, accurate user context, allows field filtering. Manual ⇒ ESLint-enforced (Phase 3 muscle: lint rule + allowlist + burndown + drift agent) |
| Q5 | Native PostgreSQL declarative partitioning, partition by month, single ~24-month retention window | Greenfield (no production audit data yet); `DROP PARTITION` is the right primitive; no extra Postgres extension |
| Q6 | Skip auth events (LOGIN/LOGOUT) entirely | Keycloak is source of truth for human auth; API-key auth events out of scope for 5a |
| Q7 | Two read endpoints: admin filterable + per-resource history | Frontend deferred but backend complete; future activity tab + admin tool both buildable on top |
| Q8 | Skip ACCESS_DENIED in 5a | Phase 3's `withOrgFilter` already silently drops unauthorized rows; explicit deny instrumentation is a security-monitoring concern, deferred |
| Q9 | Repurpose `AuditInterceptor` as `nestjs-cls` request-context provider; no longer writes audit rows | Service-layer audit calls read envelope (userId, IP, UA, requestId) from CLS store. Avoids 7-arg method calls. ALS infrastructure also amortizes into 5b's RLS GUC plumbing |
| Q10 | Per-entity static `auditableFields: string[]` allowlist; default = nothing logged | Default-safe against credential leaks. Adding a sensitive column to an entity does not silently leak it into the audit log |
| Q11 | Per-resource history endpoint shares the resource's existing RBAC | "If you can see it, you can see who edited it." No new capability invented |

## ESLint rule + infrastructure exemption

The rule `audit-mutation-must-log` (`apps/api/eslint-rules/audit-mutation-must-log.js`) flags any service `MethodDefinition` that calls a mutation method (`save`, `delete`, `remove`, `update`, `insert`) on a receiver matching `/repo|Repository|manager/i` without a paired `auditService.log{Create,Update,Delete}` call in the same method body.

**Permanent infrastructure exemption** (hardcoded in the rule, never on the burndown):

- `apps/api/src/modules/audit/audit.service.ts` — the audit writer itself.
- `apps/api/src/modules/audit/audit.module.ts` — wiring.
- `apps/api/src/common/services/authorized-base.service.ts` — base class for authz-aware services; persists internal flags without audit semantics.
- `apps/api/src/common/repositories/typeorm-base.repository.ts` — generic repository wrapper; pure infrastructure.

**Allowlist** (`apps/api/.audit-migration-allowlist.json`): files that mutate but don't yet call `auditService.log*`. Migration removes the entry; the burndown table tracks progress.

## Burndown

Unit: files in `apps/api/.audit-migration-allowlist.json`.

| Date | Total at start | Migrated this round | Remaining | Notes |
|---|---|---|---|---|
| 2026-05-02 | 56 | 0 | 56 | Initial. PR4 lands rule + allowlist + drift + snapshot. |

## Migration order

Priority is driven by audit value (sensitive credentials and membership changes first), demonstrability (test-runs covers batch + soft-delete), then everything else.

1. **api-keys** — sensitive credentials; marquee use case for `auditableFields`-as-redaction.
2. **organizations** — membership changes drive most compliance questions.
3. **teams** — membership changes (parallel to organizations).
4. **test-runs** — high-volume mutation; demonstrates batched patterns + soft-delete.
5. **dynatrace, grafana-dashboards, integrations** — sensitive credentials.
6. Remaining services: profiles, presets (graph/trends/compare), notifications, deep-links, alerts, adapt, awr, benchmarks, events, metrics-sources, provisioning, pyroscope, reports, systems-under-test, tracing, comparisons, handlers.

Each migration PR follows the architecture locked in the plan (PR 5+ section): add `static auditableFields = [...] as const` to the entity, paired `auditService.log*` calls in every mutation method, register the resource type → entity class mapping in `AuditResourceRegistry`, remove the file from the allowlist, update this burndown.

## Notes from PR 4 (this PR)

- The plan's discovery scan regex (`repo(sitory)?\.(save|delete|remove|update)\b`) missed query-builder-style mutations (`createQueryBuilder().delete()`, `createQueryBuilder().insert()`). Six additional files were added to the seed allowlist after the initial lint run flagged them: `test-runs-anomaly.service.ts`, `test-runs-dashboard-query.service.ts`, `application-dashboard.repository.ts`, `compare-filter-preset.repository.ts`, `test-run.repository.ts`, `trends-filter-preset.repository.ts`.
- One pre-existing regression from PR3 (`v0.2.47.51 audit read endpoints`) was uncovered by the lint run: `apps/api/src/modules/audit/audit-query.controller.ts:47` calls `this.authz.isGlobalAdmin(ctx.roles)` directly. The `PR Quality Gate - Test Suite` workflow stopped firing in March, so the regression went unnoticed at merge time. Added that one path to `apps/api/.rbac-migration-allowlist.json` (which Phase 3c had successfully emptied) to keep this PR scope-clean. Migrating it to `getCapabilities()` / `@RequiresCapability` is Phase 3c follow-up work, not Phase 5a.
