# RBAC Phase 5a — Audit Completion (Design Spec)

**Status:** Approved by user 2026-05-02. Implementation plan to follow via `superpowers:writing-plans`.

**Predecessors:** RBAC Phases 1–4 (capabilities, ownership, service-layer authorization, null-org closure) — all complete as of `109b0c0` / PR #228.

**Successors:** Phase 5b (Row-Level Security) and a future Phase 5c (security monitoring: ACCESS_DENIED + auth event mirroring) — separate specs/plans.

---

## 1. Purpose & Scope

The original RBAC plan grouped two unrelated subsystems under "Phase 5": Postgres Row-Level Security (RLS) policies, and audit logging. This spec covers **only the audit-logging slice (Phase 5a)**.

### 1.1 Use cases this phase serves

- **Forensics / compliance.** "If a user disputes that a resource was deleted or modified, prove who did it, when, and what changed." Implies before/after diffs, durable retention, complete coverage of mutations.
- **Activity feed.** "Show org members and admins the history of changes to a specific resource (or to their org's resources)." Implies a per-resource history endpoint with the same RBAC as the resource itself.

### 1.2 Use cases deferred to a later phase

- **Security monitoring** (ACCESS_DENIED detection, recon pattern alerting, real-time SIEM stream). Out of scope for 5a; revisit when there's a concrete monitoring requirement that names a specific threat to detect.
- **Auth event capture** (LOGIN, LOGOUT, failed-auth). Keycloak is the source of truth for human-user auth events; querying it through the Admin API or its event store is the right pattern. API-key auth events are also out of scope for 5a.

### 1.3 What's already shipped

The codebase has substantial scaffolding from earlier work:

- `packages/shared/src/entities/audit-log.entity.ts` — full schema (actor, org, action, resource, before/after JSONB, IP, UA, success, error).
- `apps/api/src/modules/audit/audit.service.ts` — `log()` plus 5 convenience methods plus 5 query methods plus health check.
- `apps/api/src/common/interceptors/audit.interceptor.ts` — global interceptor registered in `app.module.ts:141-143`, auto-logs every CRUD-ish HTTP request.

This spec **repurposes** that scaffolding (rather than discarding it) and trims it back to what 5a needs.

---

## 2. Decisions (locked through brainstorming, 2026-05-02)

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

---

## 3. Architecture

```
                                         Request
                                            │
                         ┌──────────────────▼──────────────────┐
                         │  KeycloakEnhancedAuthGuard           │
                         │  → req.user, req.authType            │
                         └──────────────────┬──────────────────┘
                                            │
                         ┌──────────────────▼──────────────────┐
                         │  AuditContextInterceptor (global)   │
                         │  Repurposed from AuditInterceptor.  │
                         │  Opens nestjs-cls store with:        │
                         │    {userId, userEmail, ipAddress,    │
                         │     userAgent, requestId, authType}  │
                         │  Does NOT write audit rows.          │
                         └──────────────────┬──────────────────┘
                                            │
                         ┌──────────────────▼──────────────────┐
                         │  Controller → Service                │
                         │  Mutation methods call:              │
                         │    auditService.logCreate(after)     │
                         │    auditService.logUpdate(b, a)      │
                         │    auditService.logDelete(before)    │
                         └──────────────────┬──────────────────┘
                                            │
                         ┌──────────────────▼──────────────────┐
                         │  AuditService                        │
                         │  - Reads envelope from CLS store     │
                         │  - Computes diff against allowlist   │
                         │  - setImmediate(insert) — never      │
                         │    blocks the originating mutation   │
                         └──────────────────┬──────────────────┘
                                            │
                         ┌──────────────────▼──────────────────┐
                         │  audit_logs (partitioned by month)   │
                         │  audit_logs_YYYY_MM child tables.    │
                         │  Daily partition manager (BullMQ):   │
                         │   - ensures next 3 months exist      │
                         │   - drops partitions > 24 months old │
                         └─────────────────────────────────────┘
```

### 3.1 Trust boundary

Audit writes are **fire-and-forget**: a failed audit insert MUST NOT fail the originating mutation. The forensics use case accepts that a single missed event is preferable to a user-facing 500. Misses are observable in `Logger.error` output (alert candidate).

Audit writes happen on the next event-loop tick (`setImmediate`); they are deliberately NOT coupled to the originating mutation's transaction. This means a rare double-bookkeeping case is possible (mutation rolls back, audit row remains). Mitigated by setting `success: false` from the catch path in service code at the small set of sites where this matters.

### 3.2 Surface area added by 5a

| Component | Status | Path |
|---|---|---|
| `AuditModule` | exists; imports updated | `apps/api/src/modules/audit/audit.module.ts` |
| `AuditService` | exists; trimmed | `apps/api/src/modules/audit/audit.service.ts` |
| `AuditContextInterceptor` | rename + repurpose existing `AuditInterceptor` | `apps/api/src/common/interceptors/audit-context.interceptor.ts` |
| `AuditQueryController` | new | `apps/api/src/modules/audit/audit-query.controller.ts` |
| `AuditQueryModule` | new | `apps/api/src/modules/audit/audit-query.module.ts` |
| `pickAuditable` / `diff` helpers | new | `apps/api/src/modules/audit/audit-diff.ts` |
| Resource registry (resource_type → entity class) | new | `apps/api/src/modules/audit/audit-resource-registry.ts` |
| `RequestContextModule` (`nestjs-cls` wrapper) | new | `apps/api/src/common/context/request-context.module.ts` |
| ESLint rule `local/audit-mutation-must-log` | new | `apps/api/eslint-plugin-local/rules/audit-mutation-must-log.js` |
| Migration allowlist | new | `apps/api/.audit-migration-allowlist.json` |
| Partition manager job | new | `apps/worker/src/jobs/audit-partition-manager.ts` |
| `auditableFields` declarations | new on every `OwnedResource` entity | `packages/shared/src/entities/*.entity.ts` |
| Drift-check `/schedule` agent | new (clone of Phase 3 agent) | `docs/superpowers/scheduled-agents/audit-burndown-drift.md` |

---

## 4. Components

### 4.1 `audit_logs` partitioned table

```sql
CREATE TABLE audit_logs (
  id           uuid           NOT NULL DEFAULT gen_random_uuid(),
  timestamp    timestamptz    NOT NULL DEFAULT now(),
  user_id      varchar(255)   NOT NULL,
  user_email   varchar(255),
  organization_id uuid,                        -- nullable: keeps room for system-level events
  action       varchar(20)    NOT NULL,        -- CREATE | UPDATE | DELETE (enum trimmed in 5a)
  resource_type varchar(100)  NOT NULL,
  resource_id  varchar(255),
  resource_name varchar(255),
  changes      jsonb,                          -- {before, after, fields[]} — picked through auditableFields
  metadata     jsonb,                          -- {request_id, route, method, duration_ms, auth_type}
  success      boolean        NOT NULL DEFAULT true,
  error_message text,
  ip_address   varchar(45),
  user_agent   text,
  PRIMARY KEY (id, timestamp)                   -- partition-key requirement
) PARTITION BY RANGE (timestamp);

CREATE INDEX idx_audit_logs_timestamp        ON audit_logs (timestamp DESC);
CREATE INDEX idx_audit_logs_user_id          ON audit_logs (user_id, timestamp DESC);
CREATE INDEX idx_audit_logs_organization_id  ON audit_logs (organization_id, timestamp DESC) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_audit_logs_resource         ON audit_logs (resource_type, resource_id, timestamp DESC) WHERE resource_id IS NOT NULL;
```

Indexes are inherited by every child partition. The migration creates the initial partition for the current month plus the next two months. The `(id, timestamp)` PK is forced by Postgres' rule that a partitioned table's unique constraints must include the partition key.

### 4.2 Partition lifecycle

A BullMQ-scheduled job `audit-partition-manager` runs daily at 03:00 UTC:

- Ensures partitions for `current_month`, `current_month + 1`, `current_month + 2` exist (3-month look-ahead — defense against late-night writes near a month boundary).
- Drops partitions older than `AUDIT_RETENTION_MONTHS` (env var, default `24`).
- Idempotent: re-running the job in the same day is a no-op.
- Logs both actions to the worker log; no backfill of missed partitions.
- Bootstrapped once on app start to schedule itself if not already scheduled.

Lives in `apps/worker/src/jobs/audit-partition-manager.ts`.

### 4.3 `nestjs-cls` request context

```ts
// apps/api/src/common/context/request-context.module.ts
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true, generateId: true, idGenerator: () => randomUUID() },
    }),
  ],
})
export class RequestContextModule {}

// apps/api/src/common/context/request-context.ts
export type RequestContextStore = {
  userId: string;
  userEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
  authType: 'keycloak' | 'api-key' | null;
};

export const REQ_CTX = Symbol('request-context');
```

`AuditContextInterceptor` populates the store after `KeycloakEnhancedAuthGuard` runs (so `userId`/`authType` are known). For unauthenticated requests, the store stays empty; audit calls won't fire because authenticated routes are the only ones that mutate owned resources.

### 4.4 `AuditService` (slimmed)

```ts
class AuditService {
  // Mutation logging — synchronous, returns void, never throws
  logCreate(entity: OwnedResource, options?: AuditOptions): void;
  logUpdate(before: OwnedResource, after: OwnedResource, options?: AuditOptions): void;
  logDelete(entity: OwnedResource, options?: AuditOptions): void;

  // Query (read endpoints)
  findByFilter(filter: AuditFilterDto): Promise<{ rows: AuditLog[]; total: number }>;
  findByResource(resourceType: string, resourceId: string, opts?: PaginationOpts): Promise<AuditLog[]>;
}

type AuditOptions = {
  resourceName?: string;
  resourceTypeOverride?: string;
  organizationIdOverride?: string;
  actorOverride?: { userId: string; userEmail?: string | null; ipAddress?: string | null };
  success?: boolean;
  errorMessage?: string;
};
```

- `logCreate/Update/Delete` are synchronous-returning-void; internally `setImmediate(() => insert)`. Never block the calling request. Errors logged via `Logger.error`.
- `AuditOptions` is the escape hatch for entities whose default extraction is wrong, for failed-mutation logging, and for system-context callers.

**Removed in 5a:** `logAccess`, `logAccessDenied`, raw `log`, `getResourceAuditLog`, `getUserAuditLog`, `getOrganizationAuditLog`, `getAccessDeniedEvents`, `getAuditStats`. Replaced by the two narrow query methods.

### 4.5 Diff helper + `auditableFields` convention

Each `OwnedResource` entity gets a static prop:

```ts
@Entity('api_keys')
export class ApiKey implements OwnedResource {
  static auditableFields = ['name', 'description', 'organizationId', 'teamId', 'expiresAt'] as const;
  // keyHash, prefix, etc. NOT in auditableFields → never logged
}
```

```ts
// apps/api/src/modules/audit/audit-diff.ts
function pickAuditable<T>(entity: T, allow: readonly (keyof T)[]): Partial<T>;

function diff<T>(
  before: T | null,
  after: T | null,
  allow: readonly (keyof T)[]
): { before: Partial<T>; after: Partial<T>; fields: (keyof T)[] };
```

- Entity without `auditableFields` declared ⇒ `Logger.warn` once per class, audit row written with `changes = null`. Fail-safe: never leaks data, surfaces missing metadata.
- Field value serialised > `AUDIT_MAX_FIELD_BYTES` (default `4096`) ⇒ replaced with `{ truncated: true, originalLength: N }` marker. Caps row size against giant JSON config blobs.
- `fields.length === 0` (no auditable change) ⇒ skip the insert. Idempotent updates don't pollute the log.

### 4.6 `AuditQueryController` (new)

Two endpoints under `/api/audit-logs`:

```
GET /api/audit-logs?
  resourceType=&resourceId=&userId=&action=&startDate=&endDate=&organizationId=
  &limit=&offset=

  Auth:    @Roles({ roles: ['super-admin', 'org-admin'] }) (RolesGuard, runs after KeycloakEnhancedAuthGuard)
  Scoping: super-admin sees all rows;
           org-admin filtered to their accessible orgs via withOrgFilter on organization_id.
  Returns: { rows: AuditLog[], total: number }


GET /api/audit-logs/resource/:resourceType/:resourceId?limit=&offset=

  Auth:    caller must have read access to (:resourceType, :resourceId);
           enforced by routing into the resource type's existing AuthorizationService check
           via the resource registry.
  Returns: AuditLog[] sorted by timestamp DESC.
  404:     unknown :resourceType (not registered).
  403:     caller lacks read access to the specific resource.
```

The resource-type → entity-class lookup is a `Map<string, EntityClass>` populated at module init from a registry of `OwnedResource` subclasses. Unknown `resourceType` ⇒ 404 with body `"unknown resourceType"`. No way to enumerate org-isolated rows by guessing.

### 4.7 Migration tooling (mirrors Phase 3)

- **Custom ESLint rule `local/audit-mutation-must-log`.** Fires when a service method calls `repo.save / repo.delete / repo.remove / repo.update / em.transaction(...)` against an `OwnedResource` repository AND the same method body does NOT call `auditService.log{Create,Update,Delete}`. Allowlist: `apps/api/.audit-migration-allowlist.json`.
- **Burndown table** appended to `docs/superpowers/audits/2026-04-26-audit-decisions.md` (or a new audit doc; decision deferred to plan).
- **Drift-check `/schedule` agent** every 2 weeks (clones `docs/superpowers/scheduled-agents/<rbac-drift>.md`).
- File entries removed from the allowlist as each service is migrated; allowlist empty = phase complete.

---

## 5. Data flow

### 5.1 Worked example: PATCH /api/api-keys/:id (description change)

```
1. KeycloakEnhancedAuthGuard
   → req.user = { sub: 'kc-user-123', email: 'daniel@perfana.io', roles: [...] }
   → req.authType = 'keycloak'

2. AuditContextInterceptor
   → cls.set(REQ_CTX, {
       userId: 'kc-user-123',
       userEmail: 'daniel@perfana.io',
       ipAddress: '10.42.1.7',  // X-Forwarded-For first hop, fallback req.ip
       userAgent: 'Mozilla/5.0...',
       requestId: <uuid>,
       authType: 'keycloak',
     })
   → does NOT write any audit row

3. ApiKeysController.update(id, dto, userCtx)
   → authzService.canModifyResource(...) — passes or throws 403
   → apiKeysService.update(id, dto, userCtx)

4. ApiKeysService.update(id, dto, userCtx)
   a. before = await repo.findOneByOrFail({ id })
   b. Object.assign(before, dto)
   c. after = await repo.save(before)
   d. this.auditService.logUpdate(before, after)   // ← service-layer call site
   e. return after

5. AuditService.logUpdate(before, after)
   a. ctx = cls.get(REQ_CTX)
   b. Klass = before.constructor; allow = Klass.auditableFields ?? [warn-once]
   c. { before: b, after: a, fields } = diff(before, after, allow)
   d. if (fields.length === 0) return
   e. setImmediate(() =>
        repo.insert({
          userId: ctx.userId,
          userEmail: ctx.userEmail,
          organizationId: after.organizationId,   // post-Phase-4: NOT NULL on the entity
          action: 'UPDATE',
          resourceType: 'api-keys',
          resourceId: after.id,
          resourceName: after.name,
          changes: { before: b, after: a, fields },
          metadata: { request_id: ctx.requestId, route: '/api-keys/:id', method: 'PATCH', auth_type: ctx.authType },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          success: true,
          timestamp: new Date(),
        })
        .catch(err => logger.error('audit insert failed', err))
      )

6. Response returns 200 with updated ApiKey
   The audit insert resolves on the next tick — the user's response is not blocked.
```

### 5.2 Flow variations

- **CREATE.** Same shape. `before = null`; `after = saved entity`. `changes = { after: pick(entity, allow), fields: allow }`.
- **DELETE (hard).** `auditService.logDelete(entity)` called BEFORE `repo.remove(entity)`. `changes = { before: pick(entity, allow), fields: allow }`. Reason: post-delete the entity may be unrecoverable (cascades fired, soft-delete columns nulled).
- **Soft delete.** Treated as an UPDATE on the soft-delete column (e.g., `deletedAt`). The entity's `auditableFields` must include the marker for this to record. Documented in the engineer-facing migration guide.
- **Failed mutation.** Optional pattern at deliberately-instrumented sites: `try { repo.save(); auditService.logUpdate(before, after) } catch (e) { auditService.logUpdate(before, before, { success: false, errorMessage: e.message }); throw e }`. Default: no audit row on failure.
- **Bulk operations.** N entities → N rows. The fire-and-forget `setImmediate` per entity is cheap. If profiling reveals back-pressure, add `auditService.logBatch*` (single multi-row INSERT) — measure-then-fix follow-up, not pre-optimization.
- **System contexts (worker, grafana-sync, migrations).** No request, no CLS store. Audit calls in those processes either skip the log (default — worker pipelines today don't expose user-actionable mutations through APIs) or pass an `actorOverride` (e.g., `{ userId: 'system:grafana-sync', ipAddress: null }`).

---

## 6. Failure modes

| Failure | What happens | Why it's safe |
|---|---|---|
| Audit DB insert fails (network, missing partition) | `setImmediate` callback catches, logs `Logger.error('audit insert failed', err)`. Originating mutation already returned 200. | Forensics gap of one event ≪ user-facing 500 cost. Misses are observable. |
| `cls.get(REQ_CTX)` returns undefined | `AuditService.log*` returns early after `Logger.warn('audit call outside request context — skipping')`. No row written. | Surfaces the bug (audit call outside any request) without leaking partial data. |
| Entity has no `auditableFields` | `Logger.warn(once-per-class)` and proceed with `changes = null`. Action + resource + actor + timestamp still recorded. | Audit row stays useful (something changed); discoverable metadata bug, not a data leak. |
| Service forgets to call `auditService.logXxx` | ESLint rule `local/audit-mutation-must-log` errors at lint time; CI fails. Adding the file to `.audit-migration-allowlist.json` is the only bypass and is visible in PR diff. | Cannot reach `main` silently. Allowlist requires reviewer sign-off. |
| Allowlist drift | `/schedule` drift agent every 2 weeks scans for un-migrated sites + new `repo.save` calls in allowlisted files; posts a comment. | Same pattern as Phase 3 RBAC drift agent. Surfaces silent regressions. |
| Partition for the current month doesn't exist | Postgres raises `no partition of relation "audit_logs" found for row`. The `setImmediate` insert catches, logs, drops. | Manager runs daily with 3-month look-ahead — only happens if manager has been down >2 months (alert, not data recovery). |
| Diff JSONB exceeds row size | `pickAuditable` clamps each field's serialised value to `AUDIT_MAX_FIELD_BYTES` (default 4 KB); over-cap fields replaced with `{ truncated: true, originalLength: N }`. | Caps row size; observable via the marker. |
| `setImmediate` queue back-pressure under bulk ops | Asynchronous but unthrottled; low thousands queued could starve the event loop briefly. | Acceptable for 5a; if observed, add `logBatch*` and switch hot bulk paths to it. |
| Resource type → entity-class lookup misses on read endpoint | `GET /api/audit-logs/resource/:unknown/:id` → 404 `"unknown resourceType"`. | No row enumeration by guessing types. |
| Caller asks per-resource history for a resource they can't see | RBAC check (resource's existing `canAccessResource`) returns false → 403. | Audit data shares the resource's RBAC by design. |
| Caller asks `/api/audit-logs?...` without admin role | `RolesGuard` returns 403 before controller runs (guard order: Keycloak → Roles → Throttler). | Admin endpoint gated via `@Roles({ roles: ['super-admin', 'org-admin'] })`. |
| Org-admin queries `/api/audit-logs?...` for events outside their org | Controller runs `withOrgFilter(query, accessibleOrgs)` on `organization_id`. Other orgs' events not returned. | Same primitive Phase 3 standardised on. |

### 6.1 Out of scope for 5a (each is a future opportunity)

- **Tamper-evidence (hash-chained log).** Cryptographic chaining for forensics-grade integrity. Not required for current compliance posture.
- **Append-only enforcement at the DB level.** Revoking UPDATE/DELETE on `audit_logs` for the app role; requires a separate role + migration.
- **Real-time security monitoring stream** (`LISTEN/NOTIFY` to a SIEM).
- **Event sourcing / replayability.** Audit rows record actions, not full entity state.

---

## 7. Testing

### 7.1 Unit tests

| Module | Spec | Coverage |
|---|---|---|
| `AuditService` | `audit.service.spec.ts` (rewrite) | `logCreate/Update/Delete` against mock CLS + mock repo: diff captures only `auditableFields`; missing `auditableFields` → warn + insert with `changes: null`; missing CLS → warn + skip; insert failure → caught/logged/never thrown; `fields.length === 0` → skip; over-cap field → truncation marker; `actorOverride` overrides CLS |
| `pickAuditable` / `diff` helpers | `audit-diff.spec.ts` (new) | Pure: nested objects, arrays, undefined fields, equal values, type changes, unknown-key allowlist |
| `AuditContextInterceptor` | `audit-context.interceptor.spec.ts` (rewrite of existing `audit.interceptor.spec.ts`) | Populates CLS from `KeycloakEnhancedAuthGuard`-attached request; X-Forwarded-For first hop + req.ip fallback; missing `userId` → store empty; does NOT call `auditService.log*` (regression test for repurposing) |
| `AuditQueryController` | `audit-query.controller.spec.ts` (new) | Admin filter: super-admin cross-org, org-admin org-scoped, non-admin → 403; per-resource: caller without read access → 403; with access → ordered rows; unknown `resourceType` → 404 |
| ESLint rule `local/audit-mutation-must-log` | `eslint-plugin-local/rules/audit-mutation-must-log.test.ts` | Positive (save without log → error); negative (save with log → ok); allowlisted file (no error); nested call (em.transaction-wrapped saves → still detected) |
| Partition manager | `audit-partition-manager.spec.ts` (worker) | Creates next 3 months idempotently; drops partitions > `AUDIT_RETENTION_MONTHS`; does not touch retained partitions; safety: skip drop if cutoff would remove unexpected partitions |

### 7.2 Integration tests

`apps/api/src/modules/audit/audit.integration.test.ts` boots a minimal Nest app with real Postgres + real `nestjs-cls`:

```
audit-flow.integration.test.ts
  it('records UPDATE diffs end-to-end')
  it('respects auditableFields allowlist')
  it('writes into the correct monthly partition')
  it('per-resource endpoint returns history')
  it('admin endpoint is org-scoped via withOrgFilter')
  it('non-admin gets 403 from /api/audit-logs')
```

Uses the existing test-DB pattern (Phase 3 set the precedent).

### 7.3 Migration / lint / drift tests

- Repo-level smoke test: `apps/api/.audit-migration-allowlist.json` exists, well-formed JSON, every entry resolves to an existing file (clone of Phase 3 RBAC test).
- Snapshot test: a JSON file checked into the repo records the current `auditableFields` declaration on every `OwnedResource` entity. Adding a new field to an entity without updating its `auditableFields` ⇒ snapshot diff in PR ⇒ reviewer signs off either "yes, log this" or "redact this." Forces the conversation.

### 7.4 Not tested in 5a

- Performance under load (the back-pressure question). Instrument with `Logger.debug` counters on `setImmediate` queue length; revisit if production tells us to.
- Failure recovery from a multi-month partition manager outage. Documented as an alert, not a test.
- Cross-process audit (worker writing audit rows). Out of scope per §5.2.

---

## 8. Done criteria

A reviewer should be able to verify Phase 5a is complete by:

1. Every owned-resource service mutation method has an `auditService.log{Create,Update,Delete}` call site **and** the lint rule + drift agent enforce it (allowlist empty or shrinking weekly).
2. Every `OwnedResource` entity has a static `auditableFields` declaration (snapshot test passing).
3. `audit_logs` is a partitioned table with at least 3 months of partitions ahead and the manager running on schedule.
4. `GET /api/audit-logs?...` and `GET /api/audit-logs/resource/:resourceType/:resourceId` return correct data; integration test green.
5. `AuditAction` enum reduced to `CREATE | UPDATE | DELETE`; `logAccess`/`logAccessDenied`/legacy `log`/legacy query methods removed; old `AuditInterceptor` HTTP-method routing logic gone.
6. CLAUDE.md "RBAC Implementation Status" table updated: Phase 5 row split into 5a (✅ Audit) / 5b (🚧 RLS).

---

## 9. Sequencing & PR shape (sketch — refined in plan)

Rough breakdown the implementation plan will expand:

1. **Foundation PR** — `nestjs-cls` integration, `AuditContextInterceptor` repurpose, `AuditService` slim-down, partition migration + manager job, `AuditQueryController` skeleton with both endpoints. Lands all infrastructure with zero migration of existing services.
2. **Lint + allowlist + drift PR** — ESLint rule, initial allowlist (every owned-resource service file), burndown doc, drift-check `/schedule` agent. Lands the migration tooling.
3. **Migration PRs (N)** — one per service group (test-runs, api-keys, dynatrace, grafana-dashboards, …). Each: declare `auditableFields` on the relevant entities, add `auditService.log*` calls, remove file from allowlist. Drips in via adjacent feature work too (mirroring Phase 3c rollout).
4. **Cleanup PR** — once allowlist is empty: delete unused `AuditAction` enum values, delete unused `AuditService` methods, delete dead spec files. Update CLAUDE.md.

Each PR follows the existing Perfana ship workflow (`/ship` skill).

---

## 10. References

- Master RBAC plan: `docs/superpowers/plans/2026-04-27-rbac-completion.md` (§ "Phase 5 (deferred): Row-level security + audit logging" at line 2212).
- Audit decision log: `docs/superpowers/audits/2026-04-26-audit-decisions.md`.
- Phase 3 lint+allowlist+drift pattern: `apps/api/.rbac-migration-allowlist.json` + `local/no-direct-is-global-admin` rule.
- Phase 4 closure: PR #228 (commit `c7d94ee`), 2026-05-02.
- Existing audit scaffolding: `apps/api/src/modules/audit/`, `apps/api/src/common/interceptors/audit.interceptor.ts`, `packages/shared/src/entities/audit-log.entity.ts`.
