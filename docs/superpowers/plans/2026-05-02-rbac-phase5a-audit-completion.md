# RBAC Phase 5a — Audit Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the audit-logging slice (Phase 5a) of the originally-deferred RBAC Phase 5: complete forensic + activity-feed coverage of every owned-resource mutation, on a partitioned table, with diffs, lint-enforced service-layer call sites, and two read endpoints.

**Architecture:** Repurpose the existing `AuditInterceptor` into a `nestjs-cls`-backed request-context provider; service methods make explicit `auditService.logCreate/Update/Delete` calls; the audit row is built from the per-entity `auditableFields` allowlist (default-nothing-logged for safety) and inserted into a monthly-partitioned `audit_logs` table via fire-and-forget `setImmediate`. Read endpoints live behind `RolesGuard` (admin) or the resource's existing RBAC (per-resource history).

**Tech Stack:** NestJS 10 + `nestjs-cls` (new dep) + TypeORM (Postgres native partitioning) + `@nestjs/schedule` (BullMQ scheduler for the partition manager) + custom ESLint rule (loaded via `--rulesdir`, mirroring `apps/api/eslint-rules/no-direct-is-global-admin.js`).

**Spec:** [`docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md`](../specs/2026-05-02-rbac-phase5a-audit-completion-design.md) — read this first; design decisions Q1–Q11 are locked there.

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `apps/api/src/common/context/request-context.module.ts` | `nestjs-cls` module wrapper |
| `apps/api/src/common/context/request-context.ts` | `RequestContextStore` type + `REQ_CTX` symbol + helper |
| `apps/api/src/common/interceptors/audit-context.interceptor.ts` | Populates the CLS store; replaces the old `AuditInterceptor` |
| `apps/api/src/common/interceptors/audit-context.interceptor.spec.ts` | Unit tests for the context interceptor |
| `apps/api/src/modules/audit/audit-diff.ts` | `pickAuditable`, `diff`, `truncateOversizedFields` helpers |
| `apps/api/src/modules/audit/audit-diff.spec.ts` | Unit tests for diff helpers |
| `apps/api/src/modules/audit/audit-resource-registry.ts` | `Map<resource_type, EntityClass>` for the per-resource read endpoint |
| `apps/api/src/modules/audit/audit-query.controller.ts` | `GET /api/audit-logs` + `GET /api/audit-logs/resource/:resourceType/:resourceId` |
| `apps/api/src/modules/audit/audit-query.controller.spec.ts` | Controller unit tests |
| `apps/api/src/modules/audit/dto/audit-filter.dto.ts` | Query DTO for the admin endpoint |
| `apps/api/src/modules/audit/audit.integration.test.ts` | End-to-end audit flow integration |
| `apps/api/eslint-rules/audit-mutation-must-log.js` | ESLint rule blocking un-audited mutation sites |
| `apps/api/eslint-rules/audit-mutation-must-log.spec.js` | RuleTester unit tests for the rule |
| `apps/api/.audit-migration-allowlist.json` | Initial allowlist of un-migrated services (populated from a script) |
| `apps/worker/src/schedulers/AuditPartitionManager.ts` | Daily partition maintenance scheduler |
| `apps/worker/src/test/unit/schedulers/AuditPartitionManager.test.ts` | Vitest unit tests |
| `packages/shared/src/database/migrations/<ts>-CreatePartitionedAuditLogs.ts` | DB migration: drop+recreate `audit_logs` as partitioned |
| `docs/superpowers/scheduled-agents/audit-burndown-drift.md` | `/schedule` agent definition (clones the RBAC drift agent) |
| `docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md` | Burndown table for the migration rollout |

### Modified

| Path | Why |
|---|---|
| `apps/api/package.json` | Add `nestjs-cls` dependency |
| `pnpm-lock.yaml` | Lockfile after install |
| `apps/api/.eslintrc.js` | Register the new lint rule + add audit-infrastructure permanent-exempt set |
| `apps/api/src/app.module.ts` | Replace `AuditInterceptor` with `AuditContextInterceptor`; import `RequestContextModule` |
| `apps/api/src/modules/audit/audit.module.ts` | Slim exports; new public surface |
| `apps/api/src/modules/audit/audit.service.ts` | New `logCreate/Update/Delete` API; `findByFilter`/`findByResource`; remove unused methods |
| `apps/api/src/modules/audit/audit.service.spec.ts` | Rewritten against new API |
| `packages/shared/src/entities/audit-log.entity.ts` | `AuditAction` enum reduced to `CREATE\|UPDATE\|DELETE` |
| `packages/shared/src/entities/owned-resource.interface.ts` | Documented contract for `auditableFields` static prop |
| Each `OwnedResource` entity (~26 files) | Add `static auditableFields = [...] as const` |
| Each owned-resource service mutation method (~30 sites) | Add `auditService.log{Create,Update,Delete}` call |
| `apps/worker/src/schedulers/schedulers.module.ts` | Register `AuditPartitionManager` |
| `apps/api/CODING_RULES.md` | Document the audit conventions |
| `CLAUDE.md` | Update RBAC table: 5a status row |

### Deleted

| Path | Why |
|---|---|
| `apps/api/src/common/interceptors/audit.interceptor.ts` | Replaced by `audit-context.interceptor.ts` |
| `apps/api/src/common/interceptors/audit.interceptor.spec.ts` | Replaced by `audit-context.interceptor.spec.ts` |

---

## Sequencing

| PR | Scope | Depends on | Approx. lines |
|---|---|---|---|
| 1 | CLS infrastructure + AuditService API refactor + interceptor repurpose | — | ~700 |
| 2 | Partitioned `audit_logs` migration + partition manager | PR 1 | ~500 |
| 3 | Admin + per-resource read endpoints | PR 1, 2 | ~600 |
| 4 | ESLint rule + initial allowlist + drift agent | PR 1 | ~500 |
| 5+ | Service migration rollout (one PR per service group, ~6–10 PRs) | PR 4 | varies |
| Final | Cleanup: remove unused enum values, dead methods, stale docs; update CLAUDE.md | allowlist empty | ~200 |

PRs 1–4 are fully expanded as TDD tasks below. PRs 5+ follow the worked-first-task pattern modeled after Phase 3c's master-plan rollout.

---

## PR 1 — CLS infrastructure + AuditService refactor

### Task 1.1: Install `nestjs-cls`

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the dependency**

```bash
cd apps/api && pnpm add nestjs-cls
```

Expected: `package.json` gains `"nestjs-cls": "^4.x"` under `dependencies`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Verify version compatibility**

`nestjs-cls` v4+ supports NestJS 10. Confirm `package.json` shows `^4` or higher; if pnpm pulled v3, run `pnpm add nestjs-cls@^4`.

- [ ] **Step 3: Run typecheck to confirm clean install**

```bash
cd apps/api && npm run type-check
```

Expected: PASS (no usage yet, no compilation impact).

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add nestjs-cls dependency for Phase 5a request context"
```

---

### Task 1.2: Create `RequestContextStore` types and symbol

**Files:**
- Create: `apps/api/src/common/context/request-context.ts`
- Create: `apps/api/src/common/context/request-context.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/common/context/request-context.spec.ts
import { isRequestContextStore, REQ_CTX } from './request-context';

describe('RequestContextStore', () => {
  it('REQ_CTX is a unique symbol', () => {
    expect(typeof REQ_CTX).toBe('symbol');
    expect(REQ_CTX.toString()).toBe('Symbol(request-context)');
  });

  it('isRequestContextStore validates a complete store', () => {
    expect(isRequestContextStore({
      userId: 'kc-123',
      userEmail: 'a@b.c',
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla',
      requestId: 'req-1',
      authType: 'keycloak',
    })).toBe(true);
  });

  it('isRequestContextStore rejects missing required fields', () => {
    expect(isRequestContextStore({ userId: 'kc-123' })).toBe(false);
    expect(isRequestContextStore(null)).toBe(false);
    expect(isRequestContextStore(undefined)).toBe(false);
  });

  it('isRequestContextStore accepts nullable optional fields', () => {
    expect(isRequestContextStore({
      userId: 'kc-123',
      userEmail: null,
      ipAddress: null,
      userAgent: null,
      requestId: 'req-1',
      authType: null,
    })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/api && npx jest src/common/context/request-context.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/common/context/request-context.ts

/**
 * Per-request context populated by `AuditContextInterceptor` and read by
 * `AuditService` to attach actor/IP/UA metadata to audit rows. Backed by
 * `nestjs-cls` AsyncLocalStorage.
 */
export type RequestContextStore = {
  userId: string;
  userEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
  authType: 'keycloak' | 'api-key' | null;
};

/** CLS namespace key for the request context store. */
export const REQ_CTX = Symbol('request-context');

/** Runtime guard — used in defensive paths and tests. */
export function isRequestContextStore(value: unknown): value is RequestContextStore {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.userId === 'string'
    && (v.userEmail === null || typeof v.userEmail === 'string')
    && (v.ipAddress === null || typeof v.ipAddress === 'string')
    && (v.userAgent === null || typeof v.userAgent === 'string')
    && typeof v.requestId === 'string'
    && (v.authType === null || v.authType === 'keycloak' || v.authType === 'api-key');
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
cd apps/api && npx jest src/common/context/request-context.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/context/
git commit -m "feat(api): RequestContextStore type + REQ_CTX symbol (Phase 5a)"
```

---

### Task 1.3: Create `RequestContextModule` (`nestjs-cls` wrapper)

**Files:**
- Create: `apps/api/src/common/context/request-context.module.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/common/context/request-context.module.spec.ts
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { RequestContextModule } from './request-context.module';

describe('RequestContextModule', () => {
  it('provides ClsService as global', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RequestContextModule],
    }).compile();

    const cls = moduleRef.get(ClsService, { strict: false });
    expect(cls).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/api && npx jest src/common/context/request-context.module.spec.ts
```

Expected: FAIL — `RequestContextModule` not exported.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/common/context/request-context.module.ts
import { Module } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ClsModule } from 'nestjs-cls';

/**
 * Wraps `nestjs-cls` for the API: registers the CLS module as global with a
 * UUIDv4 request-id generator. AuditContextInterceptor writes into the store;
 * AuditService reads from it.
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: () => randomUUID(),
      },
    }),
  ],
  exports: [ClsModule],
})
export class RequestContextModule {}
```

- [ ] **Step 4: Run to confirm pass**

```bash
cd apps/api && npx jest src/common/context/request-context.module.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/context/request-context.module.ts
git commit -m "feat(api): RequestContextModule wrapping nestjs-cls (Phase 5a)"
```

---

### Task 1.4: Build `AuditContextInterceptor` (write CLS store, no audit writes)

**Files:**
- Create: `apps/api/src/common/interceptors/audit-context.interceptor.ts`
- Create: `apps/api/src/common/interceptors/audit-context.interceptor.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/common/interceptors/audit-context.interceptor.spec.ts
import { ExecutionContext } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { of } from 'rxjs';
import { AuditContextInterceptor } from './audit-context.interceptor';
import { REQ_CTX, RequestContextStore } from '../context/request-context';

function makeCtx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
    getType: () => 'http',
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({ getData: () => ({}), getContext: () => ({}) }),
    switchToWs: () => ({ getClient: () => ({}), getData: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('AuditContextInterceptor', () => {
  let cls: ClsService;
  let interceptor: AuditContextInterceptor;

  beforeEach(async () => {
    cls = new ClsService(/** @ts-expect-error simplified store */ ({}));
    interceptor = new AuditContextInterceptor(cls);
  });

  it('populates CLS store from authenticated keycloak request', (done) => {
    const req = {
      user: { sub: 'kc-user-123', email: 'daniel@perfana.io' },
      authType: 'keycloak',
      headers: {
        'user-agent': 'Mozilla/5.0',
        'x-forwarded-for': '10.42.1.7, 10.0.0.1',
      },
      ip: '127.0.0.1',
      method: 'PATCH',
      url: '/api/api-keys/abc',
    };

    cls.run(() => {
      interceptor.intercept(makeCtx(req), { handle: () => of('result') }).subscribe({
        next: () => {
          const stored = cls.get(REQ_CTX) as RequestContextStore | undefined;
          expect(stored).toBeDefined();
          expect(stored!.userId).toBe('kc-user-123');
          expect(stored!.userEmail).toBe('daniel@perfana.io');
          expect(stored!.ipAddress).toBe('10.42.1.7');
          expect(stored!.userAgent).toBe('Mozilla/5.0');
          expect(stored!.authType).toBe('keycloak');
          expect(stored!.requestId).toBeTruthy();
          done();
        },
      });
    });
  });

  it('falls back to req.ip when no X-Forwarded-For header', (done) => {
    const req = { user: { sub: 'kc-1' }, authType: 'keycloak', headers: {}, ip: '127.0.0.1' };
    cls.run(() => {
      interceptor.intercept(makeCtx(req), { handle: () => of('r') }).subscribe(() => {
        expect(cls.get<RequestContextStore>(REQ_CTX)?.ipAddress).toBe('127.0.0.1');
        done();
      });
    });
  });

  it('skips populating store for unauthenticated requests', (done) => {
    const req = { headers: {}, ip: '1.2.3.4' };
    cls.run(() => {
      interceptor.intercept(makeCtx(req), { handle: () => of('r') }).subscribe(() => {
        expect(cls.get<RequestContextStore>(REQ_CTX)).toBeUndefined();
        done();
      });
    });
  });

  it('does not perform any audit writes (regression: phase 5a repurpose)', (done) => {
    const req = { user: { sub: 'kc-1' }, authType: 'keycloak', headers: {}, ip: '1.2.3.4' };
    let auditCalled = false;
    // @ts-expect-error inject a fake AuditService that should never be touched
    interceptor.auditService = { log: () => { auditCalled = true; } };
    cls.run(() => {
      interceptor.intercept(makeCtx(req), { handle: () => of('r') }).subscribe(() => {
        expect(auditCalled).toBe(false);
        done();
      });
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/api && npx jest src/common/interceptors/audit-context.interceptor.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/common/interceptors/audit-context.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import { REQ_CTX, RequestContextStore } from '../context/request-context';

/**
 * AuditContextInterceptor (Phase 5a)
 *
 * Replaces the legacy `AuditInterceptor`. This interceptor's only job is to
 * populate the per-request CLS store with `{userId, userEmail, ipAddress,
 * userAgent, requestId, authType}`. It does NOT write audit rows — those are
 * emitted by service-layer `auditService.log{Create,Update,Delete}` calls.
 *
 * Skips population for unauthenticated requests (login, public endpoints).
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      user?: { sub?: string; email?: string };
      authType?: 'keycloak' | 'api-key';
      headers?: Record<string, string | string[] | undefined>;
      ip?: string;
      connection?: { remoteAddress?: string };
    }>();

    const userId = req.user?.sub;
    if (userId) {
      const store: RequestContextStore = {
        userId,
        userEmail: req.user?.email ?? null,
        ipAddress: this.extractIp(req),
        userAgent: this.extractUserAgent(req),
        requestId: randomUUID(),
        authType: req.authType ?? null,
      };
      this.cls.set(REQ_CTX, store);
    }

    return next.handle();
  }

  private extractIp(req: { headers?: Record<string, string | string[] | undefined>; ip?: string; connection?: { remoteAddress?: string } }): string | null {
    const xff = req.headers?.['x-forwarded-for'];
    if (xff) {
      const raw = Array.isArray(xff) ? xff[0] : xff;
      const first = raw?.split(',')[0]?.trim();
      if (first) return first;
    }
    const xri = req.headers?.['x-real-ip'];
    if (xri) return Array.isArray(xri) ? xri[0]! : xri;
    return req.ip ?? req.connection?.remoteAddress ?? null;
  }

  private extractUserAgent(req: { headers?: Record<string, string | string[] | undefined> }): string | null {
    const ua = req.headers?.['user-agent'];
    if (Array.isArray(ua)) return ua[0] ?? null;
    return ua ?? null;
  }
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
cd apps/api && npx jest src/common/interceptors/audit-context.interceptor.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/interceptors/audit-context.interceptor.ts apps/api/src/common/interceptors/audit-context.interceptor.spec.ts
git commit -m "feat(api): AuditContextInterceptor — CLS-only, no audit writes (Phase 5a)"
```

---

### Task 1.5: Wire `RequestContextModule` and replace global interceptor in `AppModule`

**Files:**
- Modify: `apps/api/src/app.module.ts`
- Delete: `apps/api/src/common/interceptors/audit.interceptor.ts`
- Delete: `apps/api/src/common/interceptors/audit.interceptor.spec.ts`

- [ ] **Step 1: Read the current registration**

```bash
sed -n '125,145p' apps/api/src/app.module.ts
```

Confirms `AuditInterceptor` registered at lines 141-143 via `APP_INTERCEPTOR`.

- [ ] **Step 2: Replace import + registration**

In `apps/api/src/app.module.ts`:
- Replace `import { AuditInterceptor } from './common/interceptors/audit.interceptor';` with:
  ```ts
  import { AuditContextInterceptor } from './common/interceptors/audit-context.interceptor';
  import { RequestContextModule } from './common/context/request-context.module';
  ```
- Add `RequestContextModule` to the `imports:` array (alongside other infrastructure modules).
- Replace the `useClass: AuditInterceptor` line with `useClass: AuditContextInterceptor`.

- [ ] **Step 3: Delete the old interceptor + its spec**

```bash
git rm apps/api/src/common/interceptors/audit.interceptor.ts
git rm apps/api/src/common/interceptors/audit.interceptor.spec.ts
```

- [ ] **Step 4: Run typecheck + targeted unit tests**

```bash
cd apps/api && npm run type-check && npx jest src/common/interceptors src/common/context
```

Expected: typecheck PASS; existing context + interceptor specs PASS. NOTE: any other test that imported `AuditInterceptor` will fail here — fix imports as you find them (typically only `app.module.ts` referenced it).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "feat(api): replace AuditInterceptor with AuditContextInterceptor + register CLS (Phase 5a)"
```

---

### Task 1.6: Add `auditableFields` contract to `OwnedResource`

**Files:**
- Modify: `packages/shared/src/entities/owned-resource.interface.ts`

- [ ] **Step 1: Decide on shape**

We use a static prop on the entity class (not an instance prop), populated as `static auditableFields = [...] as const;`. The interface itself can't enforce a static — we instead add a documented convention plus a runtime-typed helper:

- [ ] **Step 2: Modify the interface file**

Append to `packages/shared/src/entities/owned-resource.interface.ts`:

```ts
/**
 * Static prop convention for audit-loggable owned resources.
 *
 * Each `OwnedResource` entity class SHOULD declare:
 *   static auditableFields = ['name', 'organization_id', ...] as const;
 *
 * Phase 5a default: nothing logged unless declared. Sensitive fields
 * (token hashes, secrets, credentials) are NEVER added to this list.
 *
 * Type guard: use `getAuditableFields(EntityClass)` to read at runtime.
 */
export interface AuditableEntityClass<T extends OwnedResource = OwnedResource> {
  auditableFields?: readonly (keyof T & string)[];
}

export function getAuditableFields<T extends OwnedResource>(
  entityClass: AuditableEntityClass<T>
): readonly (keyof T & string)[] | null {
  return entityClass.auditableFields ?? null;
}
```

- [ ] **Step 3: Write the test**

```ts
// packages/shared/src/entities/owned-resource.interface.spec.ts
import { getAuditableFields } from './owned-resource.interface';

describe('getAuditableFields', () => {
  it('returns null when not declared', () => {
    class Bare { organization_id!: string; created_by!: string; }
    expect(getAuditableFields(Bare as any)).toBeNull();
  });
  it('returns the declared array', () => {
    class WithFields {
      static auditableFields = ['organization_id'] as const;
      organization_id!: string;
      created_by!: string;
    }
    expect(getAuditableFields(WithFields as any)).toEqual(['organization_id']);
  });
});
```

- [ ] **Step 4: Run**

```bash
cd packages/shared && npx jest src/entities/owned-resource.interface.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/entities/owned-resource.interface.ts packages/shared/src/entities/owned-resource.interface.spec.ts
git commit -m "feat(shared): AuditableEntityClass contract on OwnedResource (Phase 5a)"
```

---

### Task 1.7: Build `audit-diff.ts` helpers

**Files:**
- Create: `apps/api/src/modules/audit/audit-diff.ts`
- Create: `apps/api/src/modules/audit/audit-diff.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/audit/audit-diff.spec.ts
import { pickAuditable, diff, truncateOversizedFields, AUDIT_MAX_FIELD_BYTES } from './audit-diff';

describe('pickAuditable', () => {
  it('returns only allowlisted fields', () => {
    const e = { id: '1', name: 'x', secret: 'leaky' };
    expect(pickAuditable(e, ['id', 'name'])).toEqual({ id: '1', name: 'x' });
  });
  it('omits undefined fields', () => {
    expect(pickAuditable({ name: 'x', desc: undefined as unknown as string }, ['name', 'desc']))
      .toEqual({ name: 'x' });
  });
  it('returns {} for null/undefined entity', () => {
    expect(pickAuditable(null as unknown as object, ['x'])).toEqual({});
    expect(pickAuditable(undefined as unknown as object, ['x'])).toEqual({});
  });
});

describe('diff', () => {
  const allow = ['name', 'description'] as const;

  it('returns the changed fields with before/after subsets', () => {
    const a = { name: 'old', description: 'same', secret: 's1' };
    const b = { name: 'new', description: 'same', secret: 's2' };
    const out = diff(a, b, allow);
    expect(out.fields).toEqual(['name']);
    expect(out.before).toEqual({ name: 'old' });
    expect(out.after).toEqual({ name: 'new' });
  });

  it('returns fields=[] when nothing in the allowlist changed', () => {
    const a = { name: 'x', description: 'y', secret: 's1' };
    const b = { name: 'x', description: 'y', secret: 's2' };
    expect(diff(a, b, allow).fields).toEqual([]);
  });

  it('treats null `before` (CREATE) as an after-only diff over all allowlisted fields', () => {
    const b = { name: 'x', description: 'y' };
    const out = diff(null, b, allow);
    expect(out.fields).toEqual(['name', 'description']);
    expect(out.before).toEqual({});
    expect(out.after).toEqual({ name: 'x', description: 'y' });
  });

  it('treats null `after` (DELETE) as a before-only diff over all allowlisted fields', () => {
    const a = { name: 'x', description: 'y' };
    const out = diff(a, null, allow);
    expect(out.fields).toEqual(['name', 'description']);
    expect(out.before).toEqual({ name: 'x', description: 'y' });
    expect(out.after).toEqual({});
  });
});

describe('truncateOversizedFields', () => {
  it('replaces fields above AUDIT_MAX_FIELD_BYTES with a truncation marker', () => {
    const big = 'x'.repeat(AUDIT_MAX_FIELD_BYTES + 100);
    const out = truncateOversizedFields({ small: 'a', big });
    expect(out.small).toBe('a');
    expect(out.big).toEqual({ truncated: true, originalLength: big.length });
  });
  it('leaves fields under the cap unchanged', () => {
    const out = truncateOversizedFields({ a: 1, b: 'short' });
    expect(out).toEqual({ a: 1, b: 'short' });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/api && npx jest src/modules/audit/audit-diff.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/audit/audit-diff.ts

/** Default 4 KB per field. Override via env in AuditService (not here). */
export const AUDIT_MAX_FIELD_BYTES = 4096;

/** Pick only allowlisted, defined keys from an entity. */
export function pickAuditable<T extends object>(
  entity: T | null | undefined,
  allow: readonly (keyof T & string)[]
): Partial<T> {
  if (!entity) return {};
  const out: Partial<T> = {};
  for (const k of allow) {
    const v = (entity as Record<string, unknown>)[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Compute the changed-fields diff between `before` and `after` over the allowlist. */
export function diff<T extends object>(
  before: T | null,
  after: T | null,
  allow: readonly (keyof T & string)[]
): { before: Partial<T>; after: Partial<T>; fields: (keyof T & string)[] } {
  const fields: (keyof T & string)[] = [];
  const beforeOut: Partial<T> = {};
  const afterOut: Partial<T> = {};

  for (const k of allow) {
    const b = before ? (before as Record<string, unknown>)[k] : undefined;
    const a = after ? (after as Record<string, unknown>)[k] : undefined;
    const isCreate = before === null && a !== undefined;
    const isDelete = after === null && b !== undefined;
    const isChange = before !== null && after !== null && !shallowEqual(b, a);

    if (isCreate || isDelete || isChange) {
      fields.push(k);
      if (b !== undefined) (beforeOut as Record<string, unknown>)[k] = b;
      if (a !== undefined) (afterOut as Record<string, unknown>)[k] = a;
    }
  }
  return { before: beforeOut, after: afterOut, fields };
}

/** Replace any field whose JSON length exceeds AUDIT_MAX_FIELD_BYTES with a marker. */
export function truncateOversizedFields<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const json = JSON.stringify(v ?? null);
    out[k] = json.length > AUDIT_MAX_FIELD_BYTES
      ? { truncated: true, originalLength: json.length }
      : v;
  }
  return out as T;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  // Deeper structural equality is left to JSON-string compare for simplicity.
  return JSON.stringify(a) === JSON.stringify(b);
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
cd apps/api && npx jest src/modules/audit/audit-diff.spec.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/audit/audit-diff.ts apps/api/src/modules/audit/audit-diff.spec.ts
git commit -m "feat(api): audit-diff helpers (pickAuditable/diff/truncate) (Phase 5a)"
```

---

### Task 1.8: Slim `AuditService` to the new public API

**Files:**
- Modify: `apps/api/src/modules/audit/audit.service.ts`
- Modify: `apps/api/src/modules/audit/audit.service.spec.ts` (rewrite)

- [ ] **Step 1: Write the new failing test surface**

Replace the entire content of `apps/api/src/modules/audit/audit.service.spec.ts` with the new spec below. (You can `git rm` and recreate, or open and replace.) The spec exercises the new API only.

```ts
// apps/api/src/modules/audit/audit.service.spec.ts
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditAction, OwnedResource } from '@perfana/shared/entities';
import { AuditService } from './audit.service';
import { REQ_CTX, RequestContextStore } from '../../common/context/request-context';

class FakeEntity implements OwnedResource {
  static auditableFields = ['name', 'description', 'organization_id'] as const;
  id!: string;
  name!: string;
  description?: string;
  organization_id!: string;
  team_id?: string;
  created_by!: string;
  updated_by?: string;
}

const ctxStore: RequestContextStore = {
  userId: 'kc-1',
  userEmail: 'a@b.c',
  ipAddress: '10.0.0.1',
  userAgent: 'Mozilla',
  requestId: 'req-1',
  authType: 'keycloak',
};

describe('AuditService (Phase 5a)', () => {
  let service: AuditService;
  let repo: jest.Mocked<Repository<AuditLog>>;
  let cls: ClsService;

  beforeEach(async () => {
    repo = {
      insert: jest.fn().mockResolvedValue({ identifiers: [{ id: 'audit-1' }] }),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    } as unknown as jest.Mocked<Repository<AuditLog>>;

    cls = new ClsService(/** @ts-expect-error */ ({}));
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: repo },
        { provide: ClsService, useValue: cls },
      ],
    }).compile();
    service = moduleRef.get(AuditService);
  });

  describe('logUpdate', () => {
    it('writes a row with the diff over auditableFields', (done) => {
      const before: FakeEntity = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'old', description: 'd', organization_id: 'o-1', created_by: 'kc-1',
      });
      const after: FakeEntity = Object.assign(new FakeEntity(), { ...before, name: 'new' });

      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        service.logUpdate(before, after);
        setImmediate(() => {
          expect(repo.insert).toHaveBeenCalledTimes(1);
          const row = repo.insert.mock.calls[0][0] as Partial<AuditLog>;
          expect(row.action).toBe(AuditAction.UPDATE);
          expect(row.userId).toBe('kc-1');
          expect(row.organizationId).toBe('o-1');
          expect(row.changes).toEqual({ before: { name: 'old' }, after: { name: 'new' }, fields: ['name'] });
          done();
        });
      });
    });

    it('skips insert when no auditableField changed', (done) => {
      const before = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'x', description: 'd', organization_id: 'o-1', created_by: 'kc-1',
      });
      const after = Object.assign(new FakeEntity(), { ...before });
      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        service.logUpdate(before, after);
        setImmediate(() => { expect(repo.insert).not.toHaveBeenCalled(); done(); });
      });
    });

    it('warns once when entity has no auditableFields and writes changes:null', (done) => {
      class Naked implements OwnedResource {
        id!: string; organization_id!: string; created_by!: string;
      }
      const e = Object.assign(new Naked(), { id: 'r-1', organization_id: 'o-1', created_by: 'kc-1' });
      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        service.logUpdate(e, e);
        setImmediate(() => {
          expect(repo.insert).toHaveBeenCalled();
          const row = repo.insert.mock.calls[0][0] as Partial<AuditLog>;
          expect(row.changes).toBeNull();
          done();
        });
      });
    });

    it('skips insert when CLS context is missing', (done) => {
      const e = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'x', organization_id: 'o-1', created_by: 'kc-1',
      });
      cls.run(() => {
        // intentionally NOT setting REQ_CTX
        service.logUpdate(e, { ...e, name: 'y' } as FakeEntity);
        setImmediate(() => { expect(repo.insert).not.toHaveBeenCalled(); done(); });
      });
    });

    it('never throws when repo.insert rejects', (done) => {
      repo.insert.mockRejectedValueOnce(new Error('db down'));
      const before = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'a', organization_id: 'o-1', created_by: 'kc-1',
      });
      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        expect(() => service.logUpdate(before, { ...before, name: 'b' } as FakeEntity)).not.toThrow();
        setImmediate(() => done());
      });
    });
  });

  describe('logCreate', () => {
    it('writes after-only diff', (done) => {
      const e = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'x', organization_id: 'o-1', created_by: 'kc-1',
      });
      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        service.logCreate(e);
        setImmediate(() => {
          const row = repo.insert.mock.calls[0][0] as Partial<AuditLog>;
          expect(row.action).toBe(AuditAction.CREATE);
          expect(row.changes).toEqual({ before: {}, after: { name: 'x', organization_id: 'o-1' }, fields: ['name', 'organization_id'] });
          done();
        });
      });
    });
  });

  describe('logDelete', () => {
    it('writes before-only diff', (done) => {
      const e = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'x', organization_id: 'o-1', created_by: 'kc-1',
      });
      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        service.logDelete(e);
        setImmediate(() => {
          const row = repo.insert.mock.calls[0][0] as Partial<AuditLog>;
          expect(row.action).toBe(AuditAction.DELETE);
          expect(row.changes).toEqual({ before: { name: 'x', organization_id: 'o-1' }, after: {}, fields: ['name', 'organization_id'] });
          done();
        });
      });
    });
  });

  describe('actorOverride', () => {
    it('overrides CLS values with the explicit override', (done) => {
      const e = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'x', organization_id: 'o-1', created_by: 'system',
      });
      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        service.logCreate(e, { actorOverride: { userId: 'system:grafana-sync', userEmail: null, ipAddress: null } });
        setImmediate(() => {
          const row = repo.insert.mock.calls[0][0] as Partial<AuditLog>;
          expect(row.userId).toBe('system:grafana-sync');
          expect(row.userEmail).toBeNull();
          expect(row.ipAddress).toBeNull();
          done();
        });
      });
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/api && npx jest src/modules/audit/audit.service.spec.ts
```

Expected: FAIL — old `AuditService` API doesn't match.

- [ ] **Step 3: Replace `audit.service.ts`**

Rewrite `apps/api/src/modules/audit/audit.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { AuditLog, AuditAction, AuditLogChanges, AuditLogMetadata } from '@perfana/shared/entities';
import { OwnedResource, getAuditableFields } from '@perfana/shared/entities';
import { REQ_CTX, RequestContextStore } from '../../common/context/request-context';
import { diff, truncateOversizedFields } from './audit-diff';

export type AuditOptions = {
  resourceName?: string;
  resourceTypeOverride?: string;
  organizationIdOverride?: string;
  actorOverride?: {
    userId: string;
    userEmail?: string | null;
    ipAddress?: string | null;
  };
  success?: boolean;
  errorMessage?: string;
};

export type AuditFilter = {
  resourceType?: string;
  resourceId?: string;
  userId?: string;
  action?: AuditAction;
  organizationId?: string;
  organizationIds?: string[]; // applied via withOrgFilter for org-admin scoping
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly warnedAboutMissingFields = new Set<string>();

  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
    private readonly cls: ClsService,
  ) {}

  // ---------------------------------------------------------------- Mutations
  logCreate(entity: OwnedResource, options: AuditOptions = {}): void {
    this.dispatch(AuditAction.CREATE, null, entity, options);
  }

  logUpdate(before: OwnedResource, after: OwnedResource, options: AuditOptions = {}): void {
    this.dispatch(AuditAction.UPDATE, before, after, options);
  }

  logDelete(entity: OwnedResource, options: AuditOptions = {}): void {
    this.dispatch(AuditAction.DELETE, entity, null, options);
  }

  // ---------------------------------------------------------------- Queries
  async findByFilter(filter: AuditFilter): Promise<{ rows: AuditLog[]; total: number }> {
    const where = this.buildWhere(filter);
    const [rows, total] = await this.repo.findAndCount({
      where,
      order: { timestamp: 'DESC' },
      take: filter.limit ?? 100,
      skip: filter.offset ?? 0,
    });
    return { rows, total };
  }

  async findByResource(resourceType: string, resourceId: string, opts: { limit?: number; offset?: number } = {}): Promise<AuditLog[]> {
    return this.repo.find({
      where: { resourceType, resourceId },
      order: { timestamp: 'DESC' },
      take: opts.limit ?? 100,
      skip: opts.offset ?? 0,
    });
  }

  // ---------------------------------------------------------------- Internals
  private dispatch(action: AuditAction, before: OwnedResource | null, after: OwnedResource | null, options: AuditOptions): void {
    const ctx = this.cls.get<RequestContextStore | undefined>(REQ_CTX);
    if (!ctx && !options.actorOverride) {
      this.logger.warn(`audit ${action} call outside request context — skipping`);
      return;
    }

    // The reference entity is whichever side is non-null (after for CREATE/UPDATE, before for DELETE).
    const ref = (after ?? before) as OwnedResource;
    const klass = ref.constructor as { auditableFields?: readonly string[] };
    const allow = getAuditableFields(klass as never);

    let changes: AuditLogChanges | null = null;
    if (allow) {
      const d = diff(before, after, allow as readonly (keyof OwnedResource & string)[]);
      if (d.fields.length === 0 && action === AuditAction.UPDATE) {
        return; // no auditable change → no row
      }
      changes = {
        before: truncateOversizedFields(d.before as Record<string, unknown>),
        after: truncateOversizedFields(d.after as Record<string, unknown>),
        fields: d.fields,
      };
    } else {
      const klassName = klass.constructor.name || 'unknown';
      if (!this.warnedAboutMissingFields.has(klassName)) {
        this.warnedAboutMissingFields.add(klassName);
        this.logger.warn(`Entity ${klassName} has no auditableFields — audit row will record action+actor only`);
      }
    }

    const actor = options.actorOverride ?? {
      userId: ctx!.userId,
      userEmail: ctx!.userEmail,
      ipAddress: ctx!.ipAddress,
    };

    const metadata: AuditLogMetadata = {
      request_id: ctx?.requestId,
      auth_type: ctx?.authType ?? undefined,
    };

    const orgId = options.organizationIdOverride ?? ref.organization_id ?? null;

    setImmediate(() => {
      this.repo
        .insert({
          userId: actor.userId,
          userEmail: actor.userEmail ?? null,
          organizationId: orgId,
          action,
          resourceType: options.resourceTypeOverride ?? defaultResourceType(klass.constructor.name),
          resourceId: (ref as { id?: string }).id ?? undefined,
          resourceName: options.resourceName,
          changes,
          metadata,
          success: options.success ?? true,
          errorMessage: options.errorMessage,
          ipAddress: actor.ipAddress ?? null,
          userAgent: ctx?.userAgent ?? null,
        })
        .catch((err) => {
          this.logger.error(
            `audit insert failed (${action} ${klass.constructor.name}): ${
              err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'unknown'
            }`,
          );
        });
    });
  }

  private buildWhere(f: AuditFilter): FindOptionsWhere<AuditLog> | FindOptionsWhere<AuditLog>[] {
    const base: FindOptionsWhere<AuditLog> = {};
    if (f.resourceType) base.resourceType = f.resourceType;
    if (f.resourceId) base.resourceId = f.resourceId;
    if (f.userId) base.userId = f.userId;
    if (f.action) base.action = f.action;
    if (f.organizationId) base.organizationId = f.organizationId;
    if (f.startDate && f.endDate) base.timestamp = Between(f.startDate, f.endDate);
    else if (f.startDate) base.timestamp = MoreThanOrEqual(f.startDate);
    else if (f.endDate) base.timestamp = LessThanOrEqual(f.endDate);

    if (f.organizationIds?.length) {
      // OR each accessible org id (org-admin scoping)
      return f.organizationIds.map((id) => ({ ...base, organizationId: id }));
    }
    return base;
  }
}

function defaultResourceType(className: string): string {
  // "ApiKey" → "api-keys" — keeps URL conventions consistent with controller paths.
  return className
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/-?$/, 's')
    .replace(/^-+/, '');
}
```

- [ ] **Step 4: Run the new spec to confirm pass**

```bash
cd apps/api && npx jest src/modules/audit/audit.service.spec.ts
```

Expected: PASS, ~7 tests.

- [ ] **Step 5: Update `audit.module.ts`**

```ts
// apps/api/src/modules/audit/audit.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '@perfana/shared/entities';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

- [ ] **Step 6: Run full unit suite for the audit module**

```bash
cd apps/api && npx jest src/modules/audit src/common/context src/common/interceptors
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/audit/
git commit -m "refactor(api): slim AuditService to logCreate/Update/Delete + queries (Phase 5a)"
```

---

### Task 1.9: Remove unused `AuditAction` enum values

**Files:**
- Modify: `packages/shared/src/entities/audit-log.entity.ts`

The current enum has `CREATE | UPDATE | DELETE | ACCESS | ACCESS_DENIED | LOGIN | LOGOUT`. We trim down to `CREATE | UPDATE | DELETE` only. Phase 5c (security monitoring) will reintroduce ACCESS_DENIED with proper service-layer wiring.

- [ ] **Step 1: Edit the enum**

Replace the `AuditAction` enum body with:

```ts
export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}
```

- [ ] **Step 2: Compile-test other apps**

```bash
npm run type-check
```

Expected: any worker/grafana-sync references to ACCESS/ACCESS_DENIED/LOGIN/LOGOUT will fail. There should be NONE — verify by:

```bash
grep -rn "AuditAction\.\(ACCESS\|LOGIN\|LOGOUT\)" apps/ packages/ --include='*.ts'
```

Expected: no matches outside the entity file. (If matches exist, raise to user — implies a hidden consumer not anticipated in the spec.)

- [ ] **Step 3: Run all relevant suites**

```bash
cd apps/api && npx jest src/modules/audit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/entities/audit-log.entity.ts
git commit -m "feat(shared): trim AuditAction to CREATE/UPDATE/DELETE (Phase 5a)"
```

---

### Task 1.10: Open PR 1

- [ ] **Step 1: Push branch**

```bash
git push -u origin rbac/5a-audit-completion-spec
```

(Or follow repo convention: rename branch to `rbac/5a-pr1-cls-and-audit-service`.)

- [ ] **Step 2: Open PR with `/ship` skill**

Use the `gstack /ship` workflow. PR title: `v0.2.X.Y refactor(api): Phase 5a PR1 — CLS context + AuditService refactor`. Body: link the spec, list tasks 1.1–1.9, note no functional change yet (pre-rollout).

- [ ] **Step 3: Wait for CI green + merge**

---

## PR 2 — Partitioned `audit_logs` schema + partition manager

### Task 2.1: TypeORM migration to drop+recreate `audit_logs` as partitioned

**Files:**
- Create: `packages/shared/src/database/migrations/<unix-ms>-CreatePartitionedAuditLogs.ts`

> **Greenfield.** CLAUDE.md and PR #228 confirm Phase 5 had not started before this plan; the existing `audit_logs` rows in dev are scaffolding artefacts with no production value. The migration drops the table and recreates it partitioned.

- [ ] **Step 1: Generate the migration filename**

```bash
ls packages/shared/src/database/migrations/ | tail -3
```

Pick a timestamp greater than the highest existing one (e.g., if the latest is `1777700000000`, use `1777800000000`).

- [ ] **Step 2: Write the migration**

```ts
// packages/shared/src/database/migrations/1777800000000-CreatePartitionedAuditLogs.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePartitionedAuditLogs1777800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Greenfield: drop the existing non-partitioned table. Phase 5a starts a new lineage.
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs CASCADE`);

    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id              uuid           NOT NULL DEFAULT gen_random_uuid(),
        timestamp       timestamptz    NOT NULL DEFAULT now(),
        user_id         varchar(255)   NOT NULL,
        user_email      varchar(255),
        organization_id uuid,
        action          varchar(20)    NOT NULL,
        resource_type   varchar(100)   NOT NULL,
        resource_id     varchar(255),
        resource_name   varchar(255),
        changes         jsonb,
        metadata        jsonb,
        success         boolean        NOT NULL DEFAULT true,
        error_message   text,
        ip_address      varchar(45),
        user_agent      text,
        PRIMARY KEY (id, timestamp)
      ) PARTITION BY RANGE (timestamp)
    `);

    await queryRunner.query(`CREATE INDEX idx_audit_logs_timestamp        ON audit_logs (timestamp DESC)`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_user_id          ON audit_logs (user_id, timestamp DESC)`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_organization_id  ON audit_logs (organization_id, timestamp DESC) WHERE organization_id IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_resource         ON audit_logs (resource_type, resource_id, timestamp DESC) WHERE resource_id IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_action           ON audit_logs (action, timestamp DESC)`);

    // Bootstrap: current month + next two months.
    const now = new Date();
    for (let offset = 0; offset < 3; offset++) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const part = `audit_logs_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
      await queryRunner.query(
        `CREATE TABLE ${part} PARTITION OF audit_logs FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Down restores the prior non-partitioned table; data lost is acceptable per greenfield contract.
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs CASCADE`);
    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp       timestamptz    NOT NULL DEFAULT now(),
        user_id         varchar(255)   NOT NULL,
        user_email      varchar(255),
        organization_id uuid,
        action          varchar(50)    NOT NULL,
        resource_type   varchar(100)   NOT NULL,
        resource_id     varchar(255),
        resource_name   varchar(255),
        changes         jsonb,
        metadata        jsonb,
        success         boolean        NOT NULL DEFAULT true,
        error_message   text,
        ip_address      varchar(45),
        user_agent      text
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_timestamp ON audit_logs (timestamp)`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id)`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_organization_id ON audit_logs (organization_id)`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_resource ON audit_logs (resource_type, resource_id)`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_action ON audit_logs (action)`);
  }
}
```

- [ ] **Step 3: Run the migration locally**

```bash
docker compose -f docker-compose.infra.yml up -d
npm run dev:api &  # starts API which runs migrations on boot
sleep 10
psql -h localhost -U perfana -d perfana -c '\d+ audit_logs' | head
```

Expected: table is partitioned (`Partition key: RANGE (timestamp)`), 3 child partitions exist (`audit_logs_YYYY_MM` for current + next 2 months).

- [ ] **Step 4: Insert smoke test**

```bash
psql -h localhost -U perfana -d perfana <<'SQL'
INSERT INTO audit_logs (user_id, action, resource_type, resource_id, organization_id)
VALUES ('test-user', 'CREATE', 'api-keys', 'r-1', gen_random_uuid())
RETURNING id, timestamp;
SELECT count(*) FROM audit_logs;
SQL
```

Expected: row inserted; count = 1.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/database/migrations/1777800000000-CreatePartitionedAuditLogs.ts
git commit -m "feat(shared): partition audit_logs by month (Phase 5a)"
```

---

### Task 2.2: Build the `AuditPartitionManager` scheduler

**Files:**
- Create: `apps/worker/src/schedulers/AuditPartitionManager.ts`
- Create: `apps/worker/src/test/unit/schedulers/AuditPartitionManager.test.ts`
- Modify: `apps/worker/src/schedulers/schedulers.module.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/src/test/unit/schedulers/AuditPartitionManager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditPartitionManager } from '../../../schedulers/AuditPartitionManager.js';

function fakeDataSource() {
  const calls: string[] = [];
  return {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      // Return shape varies — for SELECT existence it returns array, for DDL nothing.
      if (sql.startsWith('SELECT')) return [];
      return undefined;
    }),
    calls,
  };
}

describe('AuditPartitionManager', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-05-15T12:00:00Z')));

  it('creates current month + next 2 months idempotently', async () => {
    const ds = fakeDataSource();
    const manager = new AuditPartitionManager(ds as any);
    await manager.runOnce({ retentionMonths: 24 });

    const ddls = ds.calls.filter((s) => s.includes('CREATE TABLE') && s.includes('PARTITION OF'));
    expect(ddls).toHaveLength(3);
    expect(ddls[0]).toContain('audit_logs_2026_05');
    expect(ddls[1]).toContain('audit_logs_2026_06');
    expect(ddls[2]).toContain('audit_logs_2026_07');
    // Idempotency: each CREATE uses IF NOT EXISTS
    expect(ddls.every((s) => s.includes('IF NOT EXISTS'))).toBe(true);
  });

  it('drops partitions older than retentionMonths', async () => {
    const ds = fakeDataSource();
    // Pretend pg_tables returns three old partitions for 2024-01 .. 2024-03
    ds.query = vi.fn(async (sql: string) => {
      ds.calls.push(sql);
      if (sql.includes('pg_tables') && sql.includes('audit_logs_')) {
        return [
          { tablename: 'audit_logs_2024_01' },
          { tablename: 'audit_logs_2024_02' },
          { tablename: 'audit_logs_2024_03' },
          { tablename: 'audit_logs_2026_05' },
        ];
      }
      return undefined;
    });
    const manager = new AuditPartitionManager(ds as any);
    await manager.runOnce({ retentionMonths: 24 });

    const drops = ds.calls.filter((s) => s.startsWith('DROP TABLE'));
    // Today is 2026-05-15. 24 months back is 2024-05. So 2024-01..2024-04 are droppable.
    expect(drops.some((s) => s.includes('audit_logs_2024_01'))).toBe(true);
    expect(drops.some((s) => s.includes('audit_logs_2024_02'))).toBe(true);
    expect(drops.some((s) => s.includes('audit_logs_2024_03'))).toBe(true);
    expect(drops.some((s) => s.includes('audit_logs_2026_05'))).toBe(false);
  });

  it('does not drop partitions when no partitions are old enough', async () => {
    const ds = fakeDataSource();
    ds.query = vi.fn(async (sql: string) => {
      ds.calls.push(sql);
      if (sql.includes('pg_tables') && sql.includes('audit_logs_')) {
        return [{ tablename: 'audit_logs_2026_05' }];
      }
      return undefined;
    });
    const manager = new AuditPartitionManager(ds as any);
    await manager.runOnce({ retentionMonths: 24 });
    expect(ds.calls.some((s) => s.startsWith('DROP TABLE'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/worker && npx vitest run src/test/unit/schedulers/AuditPartitionManager.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/worker/src/schedulers/AuditPartitionManager.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { getDataSource } from '../common/database-accessor.js';

const RETENTION_MONTHS = Number.parseInt(process.env.AUDIT_RETENTION_MONTHS ?? '24', 10);

/**
 * AuditPartitionManager (Phase 5a)
 *
 * Daily 03:00 UTC: ensures partitions exist for current_month + next 2 months,
 * drops partitions older than AUDIT_RETENTION_MONTHS. Idempotent.
 */
@Injectable()
export class AuditPartitionManager {
  private readonly logger = new Logger(AuditPartitionManager.name);

  constructor(private readonly dataSource: DataSource = getDataSource()) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'UTC' })
  async cron(): Promise<void> {
    try {
      await this.runOnce({ retentionMonths: RETENTION_MONTHS });
    } catch (err) {
      this.logger.error(
        `partition manager run failed: ${
          err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'unknown'
        }`,
      );
    }
  }

  async runOnce(opts: { retentionMonths: number }): Promise<void> {
    const now = new Date();
    // 1) Ensure look-ahead partitions
    for (let offset = 0; offset < 3; offset++) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const part = partitionName(start);
      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS ${part} PARTITION OF audit_logs FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`,
      );
      this.logger.debug(`ensured ${part}`);
    }

    // 2) Drop old partitions
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - opts.retentionMonths, 1));
    const rows = await this.dataSource.query<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename LIKE 'audit_logs_%'`,
    );
    for (const { tablename } of rows) {
      const m = tablename.match(/audit_logs_(\d{4})_(\d{2})/);
      if (!m) continue;
      const partStart = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
      if (partStart < cutoff) {
        await this.dataSource.query(`DROP TABLE IF EXISTS ${tablename}`);
        this.logger.log(`dropped expired partition ${tablename}`);
      }
    }
  }
}

function partitionName(start: Date): string {
  return `audit_logs_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Register in `schedulers.module.ts`**

```ts
// apps/worker/src/schedulers/schedulers.module.ts (modify)
import { AuditPartitionManager } from './AuditPartitionManager.js';

@Module({
  imports: [ScheduleModule.forRoot(), CommonModule],
  providers: [IncrementalCollectionScheduler, AuditPartitionManager],
  exports: [IncrementalCollectionScheduler, AuditPartitionManager],
})
export class SchedulersModule {}
```

- [ ] **Step 5: Run tests**

```bash
cd apps/worker && npx vitest run src/test/unit/schedulers/AuditPartitionManager.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/schedulers/
git commit -m "feat(worker): AuditPartitionManager — daily look-ahead + drop expired (Phase 5a)"
```

---

### Task 2.3: Smoke-test the partition manager against a real local database

- [ ] **Step 1: Start worker locally**

```bash
docker compose -f docker-compose.infra.yml up -d
npm run dev:worker &
```

- [ ] **Step 2: Force a manual run**

Add a one-shot invocation hook (e.g., via NestJS shell-style `nest run` or a temporary HTTP debug endpoint). Or call the scheduler manually in a Node REPL using `getDataSource()`.

```bash
node -e "
const { DataSource } = require('typeorm');
const { AuditPartitionManager } = require('./apps/worker/dist/schedulers/AuditPartitionManager.js');
// ...wire up a DataSource and call runOnce({retentionMonths: 24})
"
```

Or simpler: `psql ... -c "\d+ audit_logs"` after the cron has had a chance to run (force tick by editing `@Cron` to `EVERY_30_SECONDS` temporarily, then revert).

- [ ] **Step 3: Confirm partitions are created**

```bash
psql -h localhost -U perfana -d perfana -c "\d+ audit_logs" | grep audit_logs_
```

Expected: at least 3 child partitions visible.

- [ ] **Step 4: Revert any temporary debug changes**

- [ ] **Step 5: Commit (only if changes were made)**

---

### Task 2.4: Open PR 2

- [ ] Push branch, ship via `/ship`. Title: `v0.2.X.Y feat(api): Phase 5a PR2 — partitioned audit_logs + manager`. Wait for CI green + merge.

---

## PR 3 — Read endpoints (admin + per-resource)

### Task 3.1: Build `AuditResourceRegistry`

**Files:**
- Create: `apps/api/src/modules/audit/audit-resource-registry.ts`
- Create: `apps/api/src/modules/audit/audit-resource-registry.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/audit/audit-resource-registry.spec.ts
import { AuditResourceRegistry } from './audit-resource-registry';

class ApiKey { static auditableFields = ['name'] as const; }
class TestRun { static auditableFields = ['status'] as const; }

describe('AuditResourceRegistry', () => {
  it('registers and resolves by string', () => {
    const r = new AuditResourceRegistry();
    r.register('api-keys', ApiKey);
    r.register('test-runs', TestRun);
    expect(r.resolve('api-keys')).toBe(ApiKey);
    expect(r.resolve('test-runs')).toBe(TestRun);
  });
  it('returns null for unknown type', () => {
    const r = new AuditResourceRegistry();
    expect(r.resolve('unknown')).toBeNull();
  });
  it('lists all registered types', () => {
    const r = new AuditResourceRegistry();
    r.register('a', ApiKey);
    r.register('b', TestRun);
    expect(r.knownTypes()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/api && npx jest src/modules/audit/audit-resource-registry.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/audit/audit-resource-registry.ts
import { Injectable } from '@nestjs/common';

export type EntityClass = { new (...args: unknown[]): object; auditableFields?: readonly string[] };

@Injectable()
export class AuditResourceRegistry {
  private readonly map = new Map<string, EntityClass>();

  register(resourceType: string, entityClass: EntityClass): void {
    this.map.set(resourceType, entityClass);
  }

  resolve(resourceType: string): EntityClass | null {
    return this.map.get(resourceType) ?? null;
  }

  knownTypes(): string[] {
    return Array.from(this.map.keys()).sort();
  }
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
cd apps/api && npx jest src/modules/audit/audit-resource-registry.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/audit/audit-resource-registry.ts apps/api/src/modules/audit/audit-resource-registry.spec.ts
git commit -m "feat(api): AuditResourceRegistry (Phase 5a)"
```

---

### Task 3.2: Define `AuditFilterDto`

**Files:**
- Create: `apps/api/src/modules/audit/dto/audit-filter.dto.ts`

- [ ] **Step 1: Implement (DTO + class-validator decorators consistent with existing modules)**

```ts
// apps/api/src/modules/audit/dto/audit-filter.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, IsInt, Min, Max, IsDateString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction } from '@perfana/shared/entities';

export class AuditFilterDto {
  @ApiPropertyOptional() @IsOptional() @IsString() resourceType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() resourceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() userId?: string;
  @ApiPropertyOptional({ enum: ['CREATE', 'UPDATE', 'DELETE'] })
  @IsOptional() @IsIn(['CREATE', 'UPDATE', 'DELETE']) action?: AuditAction;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/api && npm run type-check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/audit/dto/audit-filter.dto.ts
git commit -m "feat(api): AuditFilterDto for admin endpoint (Phase 5a)"
```

---

### Task 3.3: Build `AuditQueryController`

**Files:**
- Create: `apps/api/src/modules/audit/audit-query.controller.ts`
- Create: `apps/api/src/modules/audit/audit-query.controller.spec.ts`
- Modify: `apps/api/src/modules/audit/audit.module.ts` (re-export the controller and registry)

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/audit/audit-query.controller.spec.ts
import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditQueryController } from './audit-query.controller';
import { AuditService } from './audit.service';
import { AuditResourceRegistry } from './audit-resource-registry';
import { AuthorizationService } from '../../common/services/authorization.service';

const mockUserCtx = (overrides: Partial<any> = {}) => ({
  userId: 'kc-1', roles: ['user'], organizations: [], ...overrides,
});

describe('AuditQueryController', () => {
  let ctl: AuditQueryController;
  let svc: jest.Mocked<AuditService>;
  let reg: jest.Mocked<AuditResourceRegistry>;
  let authz: jest.Mocked<AuthorizationService>;

  beforeEach(async () => {
    svc = {
      findByFilter: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      findByResource: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<AuditService>;
    reg = { resolve: jest.fn(), knownTypes: jest.fn().mockReturnValue([]) } as unknown as jest.Mocked<AuditResourceRegistry>;
    authz = {
      isGlobalAdmin: jest.fn().mockReturnValue(false),
      getAccessibleOrganizations: jest.fn().mockResolvedValue([]),
      canAccessResource: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<AuthorizationService>;

    const m = await Test.createTestingModule({
      controllers: [AuditQueryController],
      providers: [
        { provide: AuditService, useValue: svc },
        { provide: AuditResourceRegistry, useValue: reg },
        { provide: AuthorizationService, useValue: authz },
      ],
    }).compile();
    ctl = m.get(AuditQueryController);
  });

  describe('GET /api/audit-logs', () => {
    it('super-admin sees cross-org rows (no filter)', async () => {
      authz.isGlobalAdmin.mockReturnValue(true);
      await ctl.findByFilter({}, mockUserCtx({ roles: ['super-admin'] }));
      expect(svc.findByFilter).toHaveBeenCalledWith(expect.objectContaining({ organizationIds: undefined }));
    });
    it('org-admin filtered to accessible orgs', async () => {
      authz.getAccessibleOrganizations.mockResolvedValue(['o1', 'o2']);
      await ctl.findByFilter({}, mockUserCtx({ roles: ['org-admin'] }));
      expect(svc.findByFilter).toHaveBeenCalledWith(expect.objectContaining({ organizationIds: ['o1', 'o2'] }));
    });
  });

  describe('GET /api/audit-logs/resource/:type/:id', () => {
    it('returns 404 for unknown resourceType', async () => {
      reg.resolve.mockReturnValue(null);
      await expect(ctl.findByResource('unknown', 'r-1', mockUserCtx())).rejects.toBeInstanceOf(NotFoundException);
    });
    it('returns 403 when caller lacks read access to the resource', async () => {
      class Fake { static auditableFields = ['id'] as const; id!: string; organization_id!: string; created_by!: string; }
      reg.resolve.mockReturnValue(Fake as any);
      // The controller loads the entity, then asks canAccessResource — stub the load via a per-test entityLoader.
      (ctl as any).loadResource = jest.fn().mockResolvedValue(Object.assign(new Fake(), { id: 'r-1', organization_id: 'o-1', created_by: 'kc-9' }));
      authz.canAccessResource.mockResolvedValue({ allowed: false, reason: 'No org access' });
      await expect(ctl.findByResource('api-keys', 'r-1', mockUserCtx())).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('returns history when caller has read access', async () => {
      class Fake { static auditableFields = ['id'] as const; id!: string; organization_id!: string; created_by!: string; }
      reg.resolve.mockReturnValue(Fake as any);
      (ctl as any).loadResource = jest.fn().mockResolvedValue(Object.assign(new Fake(), { id: 'r-1', organization_id: 'o-1', created_by: 'kc-9' }));
      authz.canAccessResource.mockResolvedValue({ allowed: true, reason: 'org-member' });
      svc.findByResource.mockResolvedValue([{ id: 'a-1' }] as any);
      const out = await ctl.findByResource('api-keys', 'r-1', mockUserCtx());
      expect(out).toEqual([{ id: 'a-1' }]);
      expect(svc.findByResource).toHaveBeenCalledWith('api-keys', 'r-1', expect.any(Object));
    });
    it('returns 404 when the resource itself does not exist', async () => {
      class Fake { static auditableFields = ['id'] as const; id!: string; organization_id!: string; created_by!: string; }
      reg.resolve.mockReturnValue(Fake as any);
      (ctl as any).loadResource = jest.fn().mockResolvedValue(null);
      await expect(ctl.findByResource('api-keys', 'r-missing', mockUserCtx())).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/api && npx jest src/modules/audit/audit-query.controller.spec.ts
```

Expected: FAIL — controller not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/audit/audit-query.controller.ts
import { Controller, Get, Query, Param, ForbiddenException, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles, RoleMatchingMode } from 'nest-keycloak-connect';
import { AuditService, AuditFilter } from './audit.service';
import { AuditResourceRegistry } from './audit-resource-registry';
import { AuditFilterDto } from './dto/audit-filter.dto';
import { AuthorizationService } from '../../common/services/authorization.service';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';

@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditQueryController {
  constructor(
    private readonly auditService: AuditService,
    private readonly registry: AuditResourceRegistry,
    private readonly authz: AuthorizationService,
  ) {}

  /**
   * Admin filterable search across audit logs.
   * - super-admin / system-admin / support → cross-org
   * - org-admin → scoped to accessible organizations via organizationIds
   * - Anyone else → 403 (RolesGuard enforces)
   */
  @Get()
  @Roles({ roles: ['super-admin', 'system-admin', 'support', 'org-admin'], mode: RoleMatchingMode.ANY })
  @ApiOperation({ summary: 'Filterable search of audit log rows' })
  async findByFilter(@Query() dto: AuditFilterDto, @UserCtx() ctx: UserContext): Promise<{ rows: unknown[]; total: number }> {
    const isAdmin = this.authz.isGlobalAdmin(ctx.roles);
    const filter: AuditFilter = {
      resourceType: dto.resourceType,
      resourceId: dto.resourceId,
      userId: dto.userId,
      action: dto.action,
      organizationId: dto.organizationId,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      limit: dto.limit ?? 100,
      offset: dto.offset ?? 0,
    };
    if (!isAdmin) {
      filter.organizationIds = await this.authz.getAccessibleOrganizations(ctx.userId);
      // If caller passed organizationId explicitly, intersect with accessible.
      if (dto.organizationId && !filter.organizationIds.includes(dto.organizationId)) {
        return { rows: [], total: 0 };
      }
      if (dto.organizationId) filter.organizationIds = [dto.organizationId];
    }
    return this.auditService.findByFilter(filter);
  }

  /**
   * Per-resource history. RBAC: caller must have read access to the resource
   * — controller loads the entity, then calls canAccessResource(userId, roles, resource).
   */
  @Get('resource/:resourceType/:resourceId')
  @ApiOperation({ summary: 'Audit history for a single resource' })
  async findByResource(
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<unknown[]> {
    const klass = this.registry.resolve(resourceType);
    if (!klass) throw new NotFoundException('unknown resourceType');
    const resource = await this.loadResource(klass, resourceId);
    if (!resource) throw new NotFoundException('resource not found');
    const result = await this.authz.canAccessResource(ctx.userId, ctx.roles, resource);
    if (!result.allowed) throw new ForbiddenException(result.reason ?? 'No read access');
    return this.auditService.findByResource(resourceType, resourceId);
  }

  /**
   * Loads the entity by id using the DataSource. Separated for testability —
   * specs override this method to avoid hitting the DB.
   */
  protected async loadResource(klass: EntityClass, id: string): Promise<OwnedResource | null> {
    const repo = this.dataSource.getRepository(klass);
    return (await repo.findOne({ where: { id } as FindOptionsWhere<{ id: string }> })) as OwnedResource | null;
  }
}
```

The `loadResource` method needs `DataSource` injected in the constructor:

```ts
constructor(
  private readonly auditService: AuditService,
  private readonly registry: AuditResourceRegistry,
  private readonly authz: AuthorizationService,
  @InjectDataSource() private readonly dataSource: DataSource,
) {}
```

Add the imports at the top of the file:

```ts
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { OwnedResource } from '@perfana/shared/entities';
import { EntityClass } from './audit-resource-registry';
```

- [ ] **Step 4: Update `audit.module.ts`**

```ts
// apps/api/src/modules/audit/audit.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '@perfana/shared/entities';
import { AuditService } from './audit.service';
import { AuditResourceRegistry } from './audit-resource-registry';
import { AuditQueryController } from './audit-query.controller';
import { AuthorizationModule } from '../../common/services/authorization.module';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), AuthorizationModule],
  controllers: [AuditQueryController],
  providers: [AuditService, AuditResourceRegistry],
  exports: [AuditService, AuditResourceRegistry],
})
export class AuditModule {}
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && npx jest src/modules/audit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/audit/
git commit -m "feat(api): AuditQueryController — admin + per-resource endpoints (Phase 5a)"
```

---

### Task 3.4: Integration test against a real DB

**Files:**
- Create: `apps/api/src/modules/audit/audit.integration.test.ts`

- [ ] **Step 1: Implement** (use the existing test-DB pattern: see `apps/api/src/modules/test-runs/test-runs.e2e-spec.ts` for the pattern)

The integration test boots a minimal Nest app with the real `AuditModule` + `RequestContextModule`, posts to a stub mutation controller (built ad-hoc inside the test), and asserts the audit row was written to the correct partition with the correct diff.

```ts
// apps/api/src/modules/audit/audit.integration.test.ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as request from 'supertest';
import { AuditLog, AuditAction } from '@perfana/shared/entities';
import { AuditModule } from './audit.module';
import { RequestContextModule } from '../../common/context/request-context.module';
import { AuditContextInterceptor } from '../../common/interceptors/audit-context.interceptor';
import { ClsService } from 'nestjs-cls';
import { ApiKey } from '@perfana/shared/entities';
// ... import your test DB helpers

describe('Audit flow (integration)', () => {
  let app: INestApplication;
  let repo: Repository<AuditLog>;

  beforeAll(async () => {
    const m = await Test.createTestingModule({
      imports: [
        // Boot the test DB module — copy the wiring from test-runs.e2e-spec.ts
        TypeOrmModule.forRoot({ /* test DB config */ }),
        TypeOrmModule.forFeature([AuditLog, ApiKey]),
        RequestContextModule,
        AuditModule,
      ],
    }).compile();
    app = m.createNestApplication();
    app.useGlobalInterceptors(new AuditContextInterceptor(app.get(ClsService)));
    await app.init();
    repo = app.get(getRepositoryToken(AuditLog));
  });

  afterAll(async () => app.close());

  it('records UPDATE diffs end-to-end', async () => {
    // Stub a mutation endpoint that calls auditService.logUpdate, then assert the row exists
    // (full body left to engineer — pattern matches test-runs e2e)
  });

  it('respects auditableFields allowlist (sensitive field not in changes)', async () => { /* ... */ });

  it('writes into the correct monthly partition', async () => {
    const part = await repo.query(`SELECT pg_relation_size('audit_logs_${new Date().getUTCFullYear()}_${String(new Date().getUTCMonth() + 1).padStart(2, '0')}')`);
    expect(part).toBeDefined();
  });
});
```

> **Implementation note:** the full e2e mutation stub is left to the engineer because it depends on the test-DB scaffolding pattern already used by `test-runs.e2e-spec.ts`. Copy that pattern; do not invent a new one.

- [ ] **Step 2: Run**

```bash
cd apps/api && npx jest src/modules/audit/audit.integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/audit/audit.integration.test.ts
git commit -m "test(api): integration test for audit flow (Phase 5a)"
```

---

### Task 3.5: Wire `AuditQueryController` into `AppModule` if not auto-discovered

If `AuditModule` is already imported in `AppModule`, the controller is auto-registered. Verify:

- [ ] **Step 1: Confirm**

```bash
grep -n "AuditModule" apps/api/src/app.module.ts
```

If not present, add `import { AuditModule } from './modules/audit/audit.module';` and add `AuditModule` to the `imports:` array.

- [ ] **Step 2: Boot smoke test**

```bash
npm run dev:api &
sleep 5
curl -i http://localhost:3001/api/audit-logs
```

Expected: 401 (unauthenticated) — confirms route is registered.

- [ ] **Step 3: Commit (if AppModule changed)**

---

### Task 3.6: Open PR 3

- [ ] Push, ship via `/ship`. Title: `v0.2.X.Y feat(api): Phase 5a PR3 — audit read endpoints`. Wait for green + merge.

---

## PR 4 — ESLint rule + initial allowlist + drift agent

### Task 4.1: Generate the initial allowlist from a static scan

**Files:**
- Create: `apps/api/.audit-migration-allowlist.json`

- [ ] **Step 1: Run a discovery scan**

```bash
# Find every service file that calls repo.save / repo.delete / repo.remove / repo.update
# on an OwnedResource repository.
rg -l "repo(sitory)?\.(save|delete|remove|update)\b" apps/api/src --type ts -g '!*.spec.ts' \
  | xargs grep -l "OwnedResource\|@Entity" 2>/dev/null \
  | sort -u
```

This returns the candidate files. Some may be infrastructure (e.g., `authorized-base.service.ts`); exclude those (they go in the rule's `INFRASTRUCTURE_FILES` permanent-exempt set instead).

- [ ] **Step 2: Build the JSON file**

```json
[
  "apps/api/src/modules/api-keys/api-keys.service.ts",
  "apps/api/src/modules/test-runs/test-runs.service.ts",
  "apps/api/src/modules/dynatrace/dynatrace.service.ts",
  "apps/api/src/modules/grafana-dashboards/grafana-dashboards.service.ts",
  "..."
]
```

(Final list determined by the scan — populate it by running the scan and pasting the result.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/.audit-migration-allowlist.json
git commit -m "chore(api): seed audit migration allowlist (Phase 5a)"
```

---

### Task 4.2: Build the ESLint rule

**Files:**
- Create: `apps/api/eslint-rules/audit-mutation-must-log.js`
- Create: `apps/api/eslint-rules/audit-mutation-must-log.spec.js`

Mirrors `apps/api/eslint-rules/no-direct-is-global-admin.js` (use that as the structural template).

- [ ] **Step 1: Write the rule**

```js
// apps/api/eslint-rules/audit-mutation-must-log.js
const fs = require('fs');
const path = require('path');

let cache = null;

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, 'apps/api/.audit-migration-allowlist.json');
    if (fs.existsSync(candidate)) return { allowlistPath: candidate, repoRoot: dir };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadCache(cwd) {
  if (cache !== null) return cache;
  try {
    const found = findRepoRoot(cwd);
    if (!found) {
      cache = { allowlist: new Set(), repoRoot: cwd };
    } else {
      const entries = JSON.parse(fs.readFileSync(found.allowlistPath, 'utf8'));
      cache = { allowlist: new Set(entries), repoRoot: found.repoRoot };
    }
  } catch {
    cache = { allowlist: new Set(), repoRoot: cwd };
  }
  return cache;
}

// Permanently exempt: audit infrastructure itself + base services that legitimately persist
// without "audit-shaped" semantics.
const INFRASTRUCTURE_FILES = new Set([
  'apps/api/src/modules/audit/audit.service.ts',
  'apps/api/src/modules/audit/audit.module.ts',
  'apps/api/src/common/services/authorized-base.service.ts',
]);

const MUTATION_METHODS = new Set(['save', 'delete', 'remove', 'update', 'insert']);
const AUDIT_LOG_METHODS = new Set(['logCreate', 'logUpdate', 'logDelete']);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Service mutations on OwnedResource entities must call auditService.log{Create,Update,Delete}.',
    },
    schema: [],
    messages: {
      missing: "Service mutation '{{call}}' requires an auditService.log{Create,Update,Delete} call in the same method body, or the file must be on .audit-migration-allowlist.json. See docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md.",
    },
  },
  create(context) {
    const cwd = context.getCwd ? context.getCwd() : process.cwd();
    const { allowlist, repoRoot } = loadCache(cwd);
    const filename = context.getFilename();
    const relPath = path.relative(repoRoot, filename).replace(/\\/g, '/');
    if (INFRASTRUCTURE_FILES.has(relPath)) return {};
    if (allowlist.has(relPath)) return {};
    if (filename.endsWith('.spec.ts') || filename.endsWith('.test.ts')) return {};

    // Per-method scan: track inside each method body.
    return {
      MethodDefinition(node) {
        const body = node.value && node.value.body;
        if (!body) return;
        const mutationCalls = [];
        let sawAuditCall = false;
        const visit = (n) => {
          if (!n || typeof n !== 'object') return;
          if (n.type === 'CallExpression') {
            const callee = n.callee;
            if (
              callee.type === 'MemberExpression' &&
              callee.property &&
              callee.property.type === 'Identifier'
            ) {
              const propName = callee.property.name;
              const objText = context.getSourceCode().getText(callee.object);
              if (MUTATION_METHODS.has(propName) && /repo|Repository|manager/i.test(objText)) {
                mutationCalls.push({ node: n, call: `${objText}.${propName}` });
              }
              if (AUDIT_LOG_METHODS.has(propName) && /audit/i.test(objText)) {
                sawAuditCall = true;
              }
            }
          }
          for (const k of Object.keys(n)) {
            const v = n[k];
            if (Array.isArray(v)) v.forEach(visit);
            else if (v && typeof v === 'object' && v.type) visit(v);
          }
        };
        visit(body);
        if (mutationCalls.length > 0 && !sawAuditCall) {
          for (const m of mutationCalls) {
            context.report({ node: m.node, messageId: 'missing', data: { call: m.call } });
          }
        }
      },
    };
  },
};
```

- [ ] **Step 2: Write the rule's RuleTester spec**

```js
// apps/api/eslint-rules/audit-mutation-must-log.spec.js
const { RuleTester } = require('eslint');
const rule = require('./audit-mutation-must-log');

const tester = new RuleTester({ parser: require.resolve('@typescript-eslint/parser') });

tester.run('audit-mutation-must-log', rule, {
  valid: [
    { code: `class S { async update() { const x = await this.repo.save(e); this.auditService.logUpdate(b, x); } }`, filename: 'apps/api/src/modules/foo/foo.service.ts' },
    { code: `class S { async delete() { this.auditService.logDelete(e); await this.repo.remove(e); } }`, filename: 'apps/api/src/modules/foo/foo.service.ts' },
    { code: `class S { async update() { await this.repo.save(e); } }`, filename: 'apps/api/src/modules/audit/audit.service.ts' }, // infrastructure
    { code: `class S { async update() { await this.repo.save(e); } }`, filename: 'apps/api/src/modules/foo/foo.service.spec.ts' }, // spec
  ],
  invalid: [
    {
      code: `class S { async update() { await this.repo.save(e); } }`,
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      errors: [{ messageId: 'missing' }],
    },
    {
      code: `class S { async create() { await this.repo.insert(e); } }`,
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      errors: [{ messageId: 'missing' }],
    },
  ],
});
```

- [ ] **Step 3: Run the spec**

```bash
cd apps/api && node eslint-rules/audit-mutation-must-log.spec.js
```

Expected: PASS (no thrown assertions).

- [ ] **Step 4: Wire into `.eslintrc.js`**

```js
// apps/api/.eslintrc.js (modify)
module.exports = {
  extends: ['../../.eslintrc.js'],
  rules: {
    'no-direct-is-global-admin': 'error',
    'audit-mutation-must-log': 'error',
  },
  overrides: [
    {
      files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts'],
      rules: {
        'no-direct-is-global-admin': 'off',
        'audit-mutation-must-log': 'off',
      },
    },
  ],
};
```

- [ ] **Step 5: Run lint across api to confirm allowlist is honored**

```bash
cd apps/api && npm run lint
```

Expected: PASS — every file in the allowlist is exempt; non-allowlisted files have the audit calls (none yet, since no migration done). The lint should be clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/eslint-rules/audit-mutation-must-log.js apps/api/eslint-rules/audit-mutation-must-log.spec.js apps/api/.eslintrc.js
git commit -m "chore(api): ESLint rule audit-mutation-must-log + register (Phase 5a)"
```

---

### Task 4.3: Author the burndown audit document

**Files:**
- Create: `docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md`

- [ ] **Step 1: Write the doc**

Header + decisions (mirror Q1–Q11 from the spec) + initial burndown table:

```markdown
# Phase 5a Audit Migration — Decisions & Burndown

**Started:** 2026-05-02. **Spec:** `docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md`.

## Decisions
(reproduce Q1–Q11 from the spec for self-contained reference)

## Burndown

Unit: files in `apps/api/.audit-migration-allowlist.json`.

| Date | Total at start | Migrated this round | Remaining | Notes |
|---|---|---|---|---|
| 2026-05-02 | <N> | 0 | <N> | Initial. PR4 lands rule + allowlist. |

## Migration order
1. api-keys (sensitive credentials — high audit value)
2. organizations (membership changes)
3. teams (membership changes)
4. test-runs (high-volume, demonstrates batch patterns)
5. (remaining services in arbitrary order)
```

Replace `<N>` with the actual count from PR 4's allowlist.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md
git commit -m "docs(rbac): Phase 5a audit migration burndown doc (Phase 5a)"
```

---

### Task 4.4: Author the drift-check `/schedule` agent

**Files:**
- Create: `docs/superpowers/scheduled-agents/audit-burndown-drift.md`

- [ ] **Step 1: Write the agent**

```markdown
# Audit Burndown Drift Check

**Cadence:** every 2 weeks.

**Trigger:** `/schedule "every 2 weeks: run docs/superpowers/scheduled-agents/audit-burndown-drift.md"`.

**Job:** audit `apps/api/src` for un-audited mutations on `OwnedResource` entities outside the migration allowlist. Catches drift the ESLint rule missed.

**Steps:**

1. Read `apps/api/.audit-migration-allowlist.json`.
2. Run:
   ```bash
   rg -l "(repo|repository|manager)\.(save|delete|remove|update|insert)\(" apps/api/src --type ts -g '!*.spec.ts' \
     | xargs grep -L "auditService\.\(logCreate\|logUpdate\|logDelete\)" 2>/dev/null \
     | grep -vFf <(jq -r '.[]' apps/api/.audit-migration-allowlist.json)
   ```
3. If output is non-empty, those are NEW sites that snuck past the lint rule. For each:
   - Open a PR adding the audit calls.
   - If the migration isn't trivial, add the file to the allowlist with a comment explaining why and open a follow-up issue.
4. Report burndown: count remaining allowlist entries, compare to last run. Zero progress in 14 days ⇒ flag stalled migration.

**Stop condition:** allowlist empty AND no new sites detected for two consecutive runs. Disable the schedule.
```

- [ ] **Step 2: Schedule it**

```bash
/schedule "every 2 weeks: run docs/superpowers/scheduled-agents/audit-burndown-drift.md"
```

(User-side action — record in the doc that it has been scheduled.)

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/scheduled-agents/audit-burndown-drift.md
git commit -m "ops(rbac): Phase 5a audit burndown drift /schedule agent"
```

---

### Task 4.5: Snapshot test for `auditableFields` across all `OwnedResource` entities

**Files:**
- Create: `packages/shared/src/entities/__tests__/auditable-fields.snapshot.spec.ts`
- Create: `packages/shared/src/entities/__tests__/__snapshots__/auditable-fields.snapshot.spec.ts.snap` (generated)

The snapshot test enumerates every `OwnedResource` entity and records its current `auditableFields` declaration (or `null`). Adding a new field to an entity ⇒ the snapshot diff in PR forces a reviewer conversation: "log this" (add to `auditableFields`) or "redact" (deliberately omit).

- [ ] **Step 1: Write the test**

```ts
// packages/shared/src/entities/__tests__/auditable-fields.snapshot.spec.ts
import * as entities from '../index';
import { getAuditableFields } from '../owned-resource.interface';

describe('auditableFields snapshot — every OwnedResource entity', () => {
  it('has a stable declaration', () => {
    const out: Record<string, readonly string[] | null> = {};
    for (const [name, exported] of Object.entries(entities)) {
      if (typeof exported !== 'function') continue;
      const proto = (exported as { prototype?: { organization_id?: unknown } }).prototype;
      if (!proto || !('organization_id' in (proto ?? {}))) continue; // only OwnedResource entities
      out[name] = getAuditableFields(exported as any);
    }
    expect(out).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run to generate the snapshot**

```bash
cd packages/shared && npx jest src/entities/__tests__/auditable-fields.snapshot.spec.ts -u
```

Expected: snapshot file created. Initially most entities map to `null`; declarations land in PR 5+.

- [ ] **Step 3: Verify the test fails when an entity is changed without snapshot update**

Manually add an `auditableFields` to one entity, re-run without `-u`:

```bash
cd packages/shared && npx jest src/entities/__tests__/auditable-fields.snapshot.spec.ts
```

Expected: FAIL with snapshot mismatch. Revert the entity change.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/entities/__tests__/
git commit -m "test(shared): auditableFields snapshot test (Phase 5a)"
```

---

### Task 4.6: Repo smoke test — allowlist JSON validity + path resolution

**Files:**
- Create: `apps/api/src/__tests__/audit-migration-allowlist.spec.ts`

- [ ] **Step 1: Write the test**

```ts
// apps/api/src/__tests__/audit-migration-allowlist.spec.ts
import * as fs from 'fs';
import * as path from 'path';

describe('apps/api/.audit-migration-allowlist.json', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const allowlistPath = path.join(repoRoot, 'apps/api/.audit-migration-allowlist.json');

  it('exists and is valid JSON', () => {
    const raw = fs.readFileSync(allowlistPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('is an array of strings', () => {
    const arr = JSON.parse(fs.readFileSync(allowlistPath, 'utf8')) as unknown;
    expect(Array.isArray(arr)).toBe(true);
    for (const e of arr as unknown[]) expect(typeof e).toBe('string');
  });

  it('every entry resolves to an existing file', () => {
    const arr: string[] = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    for (const rel of arr) {
      const abs = path.join(repoRoot, rel);
      expect(fs.existsSync(abs)).toBe(true);
    }
  });

  it('contains no duplicates', () => {
    const arr: string[] = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    expect(new Set(arr).size).toBe(arr.length);
  });
});
```

- [ ] **Step 2: Run**

```bash
cd apps/api && npx jest src/__tests__/audit-migration-allowlist.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/audit-migration-allowlist.spec.ts
git commit -m "test(api): allowlist JSON validity smoke test (Phase 5a)"
```

---

### Task 4.7: Update `apps/api/CODING_RULES.md`

- [ ] **Step 1: Read the existing doc and append a new section**

Add a "Audit logging" section: convention for `auditableFields`, when to add `auditService.log*` calls, link to the spec.

- [ ] **Step 2: Commit**

```bash
git add apps/api/CODING_RULES.md
git commit -m "docs(api): document Phase 5a audit conventions"
```

---

### Task 4.8: Open PR 4

- [ ] Push, ship via `/ship`. Title: `v0.2.X.Y chore(api): Phase 5a PR4 — audit lint rule + allowlist + drift + snapshot`. Wait for green + merge.

---

## PR 5+ — Service migration rollout

### Architecture (locked)

Each migration PR follows the **same shape** for one service group:

1. Add `static auditableFields = [...] as const` on every `OwnedResource` entity owned by that service.
2. For every mutation method in the service, add a `auditService.log{Create,Update,Delete}` call in the appropriate place (after save for updates/creates, before remove for deletes).
3. Inject `AuditService` into the service constructor; ensure the service's module imports `AuditModule`.
4. Register the resource type → entity class mapping with `AuditResourceRegistry` in the module's `onModuleInit` (or in the `AuditModule`'s registry initializer — whichever the team picks; document the choice in the burndown).
5. Remove the file from `apps/api/.audit-migration-allowlist.json`.
6. Update the burndown table with the migrated entry.
7. Add a unit test in the service's spec confirming `auditService.logXxx` was called with the expected arguments.

### Migration order (priority)

1. **api-keys** (sensitive — Phase 5a's marquee use case for `auditableFields`-as-redaction)
2. **organizations + teams + members** (membership changes drive most compliance questions)
3. **test-runs** (high-volume mutation, demonstrates batched patterns + soft-delete)
4. **dynatrace, grafana-dashboards, integrations** (sensitive credentials)
5. Remaining: profiles, presets, notification channels, etc.

Each PR: ~200–400 lines + 1–2 entity declarations + 3–8 `auditService.log*` calls.

### Worked first task: PR 5 — `api-keys`

**Files:**
- Modify: `packages/shared/src/entities/api-key.entity.ts` — add `auditableFields`
- Modify: `apps/api/src/modules/api-keys/api-keys.service.ts` — add `auditService.log*` calls
- Modify: `apps/api/src/modules/api-keys/api-keys.module.ts` — import `AuditModule`, register entity in `AuditResourceRegistry`
- Modify: `apps/api/src/modules/api-keys/api-keys.service.spec.ts` — assert audit calls
- Modify: `apps/api/.audit-migration-allowlist.json` — remove `api-keys.service.ts`
- Modify: `docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md` — burndown row

#### Task 5.1: Declare `auditableFields` on `ApiKey`

- [ ] **Step 1: Determine sensitive fields**

Read `packages/shared/src/entities/api-key.entity.ts`. Identify:
- **Auditable** (safe to log): `name`, `description`, `organization_id`, `team_id`, `expires_at`, `created_by`, `revoked_at`
- **NEVER auditable** (sensitive): `key_hash`, `prefix`, any token material

- [ ] **Step 2: Add the static prop**

```ts
@Entity('api_keys')
export class ApiKey implements OwnedResource {
  static auditableFields = ['name', 'description', 'organization_id', 'team_id', 'expires_at', 'revoked_at'] as const;
  // ... rest of entity unchanged
}
```

- [ ] **Step 3: Refresh the snapshot**

The snapshot test from Task 4.5 lives at `packages/shared/src/entities/__tests__/auditable-fields.snapshot.spec.ts`. After adding `auditableFields` to `ApiKey`, the snapshot's stored value flips from `null` to the declared array — re-record:

```bash
cd packages/shared && npx jest src/entities/__tests__/auditable-fields.snapshot.spec.ts -u
```

Expected: snapshot updated. The diff in your PR shows the new entry — reviewer signs off it's the right shape.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/entities/api-key.entity.ts
git commit -m "feat(shared): ApiKey.auditableFields (Phase 5a, api-keys)"
```

#### Task 5.2: Add `auditService.log*` calls in `ApiKeysService`

- [ ] **Step 1: Open the service**

```bash
code apps/api/src/modules/api-keys/api-keys.service.ts
```

- [ ] **Step 2: For each mutation method, add the audit call**

Pattern for `create`:
```ts
async create(dto: CreateApiKeyDto, ctx: UserContext): Promise<ApiKey> {
  const key = this.repo.create({ ...dto, created_by: ctx.userId });
  const saved = await this.repo.save(key);
  this.auditService.logCreate(saved);
  return saved;
}
```

Pattern for `update`:
```ts
async update(id: string, dto: UpdateApiKeyDto, ctx: UserContext): Promise<ApiKey> {
  const before = await this.repo.findOneByOrFail({ id });
  Object.assign(before, dto, { updated_by: ctx.userId });
  const after = await this.repo.save(before);
  this.auditService.logUpdate(before, after);
  return after;
}
```

Pattern for `delete`:
```ts
async delete(id: string, ctx: UserContext): Promise<void> {
  const entity = await this.repo.findOneByOrFail({ id });
  this.auditService.logDelete(entity);  // BEFORE the remove
  await this.repo.remove(entity);
}
```

- [ ] **Step 3: Inject `AuditService`**

```ts
constructor(
  @InjectRepository(ApiKey) private readonly repo: Repository<ApiKey>,
  private readonly auditService: AuditService,
  // ... existing deps
) {}
```

- [ ] **Step 4: Update module to import `AuditModule`**

```ts
// apps/api/src/modules/api-keys/api-keys.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([ApiKey]), AuditModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
})
export class ApiKeysModule {}
```

- [ ] **Step 5: Register in `AuditResourceRegistry`**

In `api-keys.module.ts`, add an `onModuleInit`:

```ts
export class ApiKeysModule implements OnModuleInit {
  constructor(private readonly registry: AuditResourceRegistry) {}
  onModuleInit() { this.registry.register('api-keys', ApiKey); }
}
```

- [ ] **Step 6: Update spec to assert audit calls**

```ts
// In api-keys.service.spec.ts:
it('logs UPDATE on update()', async () => {
  // ... arrange
  await service.update('id-1', { description: 'new' }, ctx);
  expect(auditService.logUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'id-1' }), expect.objectContaining({ id: 'id-1', description: 'new' }));
});
```

(Repeat for `logCreate` on `create()` and `logDelete` on `delete()`.)

- [ ] **Step 7: Run unit tests**

```bash
cd apps/api && npx jest src/modules/api-keys
```

Expected: PASS.

- [ ] **Step 8: Run lint to confirm allowlist no longer needed**

```bash
cd apps/api && npm run lint -- --no-warn-ignored
```

Expected: PASS — `api-keys.service.ts` no longer triggers the rule.

#### Task 5.3: Remove from allowlist + update burndown

- [ ] **Step 1: Edit `apps/api/.audit-migration-allowlist.json`** — remove the line for `api-keys.service.ts`.

- [ ] **Step 2: Edit `docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md`** — append a row to the burndown table showing the new `Migrated this round: 1` and decremented `Remaining`.

- [ ] **Step 3: Run lint one more time, then commit**

```bash
cd apps/api && npm run lint
git add apps/api/src/modules/api-keys apps/api/.audit-migration-allowlist.json docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md
git commit -m "feat(api): wire audit logging in api-keys (Phase 5a, PR5)"
```

#### Task 5.4: Open PR 5

- [ ] Push, ship via `/ship`. Title: `v0.2.X.Y feat(api): Phase 5a PR5 — audit logging in api-keys`. Wait for green + merge.

### Remaining migration PRs (PR 6 through PR ~12)

Repeat the **exact same shape** as PR 5 above, one PR per service group, in priority order. Each PR delivers:

- One or more `auditableFields` declarations on entities
- All `auditService.log*` calls in the service's mutation methods
- Module wiring (`AuditModule` import + `AuditResourceRegistry` registration)
- Spec assertions
- Allowlist entry removed
- Burndown updated

When the allowlist reaches `[]`: proceed to the cleanup PR.

---

## PR Final — Cleanup

### Task F.1: Delete unused `AuditService` query methods (if any remain)

If the slimmed `AuditService` from PR 1 left any back-compat shims, remove them now (the original spec called for none, so this should be a no-op verification).

- [ ] **Step 1: grep for any usage of removed methods**

```bash
rg "logAccess|logAccessDenied|getResourceAuditLog|getUserAuditLog|getOrganizationAuditLog|getAccessDeniedEvents|getAuditStats" apps/ packages/ --type ts -g '!*.spec.ts' | grep -v "audit.service.ts"
```

Expected: zero matches.

- [ ] **Step 2: Confirm legacy enum values not referenced**

```bash
rg "AuditAction\.\(ACCESS\|LOGIN\|LOGOUT\)" apps/ packages/ --type ts
```

Expected: zero matches.

### Task F.2: Update `CLAUDE.md` RBAC table

- [ ] **Step 1: Edit the RBAC Implementation Status table**

Split the Phase 5 row:

```
| Phase 5a | Audit logging | ✅ Completed (2026-MM-DD — N services migrated, allowlist empty) |
| Phase 5b | Row-Level Security | 🚧 Pending — separate spec at docs/superpowers/specs/<...>-phase5b-rls-design.md |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark RBAC Phase 5a complete + 5b pending (Phase 5a)"
```

### Task F.3: Disable the drift `/schedule` agent

- [ ] Per the agent's stop condition, disable it: `/schedule list` → identify → `/schedule delete <id>`.
- [ ] Append a "Closed" line to `docs/superpowers/scheduled-agents/audit-burndown-drift.md`.

### Task F.4: Open PR Final

- [ ] Push, ship via `/ship`. Title: `v0.2.X.Y chore(rbac): Phase 5a audit completion cleanup`. Wait for green + merge.

---

## Done criteria (whole plan)

Mirroring §8 of the spec:

1. ✅ Every owned-resource service mutation method has an `auditService.log{Create,Update,Delete}` call site, lint rule + drift agent enforce it, allowlist empty.
2. ✅ Every `OwnedResource` entity has a static `auditableFields` declaration.
3. ✅ `audit_logs` is a partitioned table with at least 3 months of partitions ahead and the manager running on schedule.
4. ✅ `GET /api/audit-logs?...` and `GET /api/audit-logs/resource/:resourceType/:resourceId` return correct data; integration test green.
5. ✅ `AuditAction` enum reduced to `CREATE | UPDATE | DELETE`; legacy methods removed; old `AuditInterceptor` HTTP-method routing logic gone.
6. ✅ CLAUDE.md "RBAC Implementation Status" table updated: Phase 5 → 5a (✅ Audit) / 5b (🚧 RLS).

---

## References

- Master plan: [`docs/superpowers/plans/2026-04-27-rbac-completion.md`](./2026-04-27-rbac-completion.md) — § "Phase 5 (deferred)" line 2212.
- Spec: [`docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md`](../specs/2026-05-02-rbac-phase5a-audit-completion-design.md).
- Phase 3 lint pattern: `apps/api/eslint-rules/no-direct-is-global-admin.js` + `apps/api/.rbac-migration-allowlist.json` + `apps/api/.eslintrc.js`.
- Phase 3 drift agent: `docs/superpowers/scheduled-agents/rbac-drift-check.md`.
- Existing audit scaffolding entry points: `apps/api/src/modules/audit/`, `apps/api/src/common/interceptors/audit.interceptor.ts`, `packages/shared/src/entities/audit-log.entity.ts`.
