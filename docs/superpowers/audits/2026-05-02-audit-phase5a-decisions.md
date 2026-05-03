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
| 2026-05-03 | 56 | 1 | 55 | PR5: `api-keys.service.ts`. `ApiKey.auditableFields = ['description', 'roles', 'validUntil', 'organization_id']` (excludes the bcrypt `apiKey` hash and the per-auth `lastUsed` touch). `logCreate` after persist + cache; `logDelete` before cache invalidation and `repo.delete`. `ApiKey` doesn't formally `implements OwnedResource` because `created_by?` is nullable on legacy keys — call sites cast `as unknown as OwnedResource`; `AuditService.dispatch` only reads `id` and `organization_id` so the cast is sound. Repository file (`apps/api/src/repositories/api-key.repository.ts`) stays on the allowlist — repository-layer audit migration is a separate workstream. |
| 2026-05-03 | 55 | 2 | 53 | PR6: `organizations.service.ts` + `organization-members.service.ts`. `Organization.auditableFields = ['name', 'description']` and `OrganizationMember.auditableFields = ['user_id', 'roles', 'organization_id']`. Organization is the root of the access-control hierarchy and has no `organization_id` column itself, so every Organization audit envelope is set via `organizationIdOverride: <org.id>` (CREATE after persist, UPDATE with cloned before-snapshot, DELETE before the cascade transaction). `OrganizationMember` rows carry `organization_id` natively, so the dispatch picks it up with no override. Org-level cascade deletions (teams, SUTs, test_runs, organization_members) intentionally not individually audited — they are implied by the org-DELETE row, and the raw `manager.query('DELETE …')` calls would not surface to the audit lint rule's `repo|Repository|manager.<MUTATION_METHODS>` matcher anyway. Module registers both `organizations` and `organization-members` resource types with `AuditResourceRegistry`. Snapshot picked up `OrganizationMember` (organizations entity is excluded from the snapshot because the snapshot filter is "entities with an `organization_id` column"); `Organization.auditableFields` is therefore not pinned by the snapshot — acceptable trade-off, deviation from the snapshot scope is out of PR6 scope. |
| 2026-05-03 | 53 | 2 | 51 | PR7: `teams.service.ts` + `team-members.service.ts` (parallel to PR6). `Team.auditableFields = ['name', 'description', 'organization_id']` and `TeamMember.auditableFields = ['user_id', 'roles', 'team_id']`. The org-context handling is inverted relative to PR6: Team rows carry `organization_id` natively so the dispatch picks it up without override, while TeamMember rows carry only `team_id` and need `organizationIdOverride: member.team.organization_id` (resolved via the eagerly-loaded `team` relation) so org-admin scoped queries see membership events. CREATE after persist, UPDATE with cloned roles array in the before-snapshot, DELETE before `repo.remove`. Team's `restrict_to_team_members` flag is intentionally excluded from `auditableFields` — it's a visibility hint, not a security boundary, and would add diff noise. Module registers both `teams` and `team-members` resource types with `AuditResourceRegistry`. Snapshot picked up `Team` (because Team has an `organization_id` column); `TeamMember.auditableFields` is therefore not pinned by the snapshot — acceptable trade-off, mirrors the PR6 trade-off in reverse. 16 new spec assertions across the two services cover the create/update/delete log invariants, including org-override resolution from the team relation and "log before mutation" ordering. |

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
