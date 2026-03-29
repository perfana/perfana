---
name: auth-audit
description: >
  Perfana-specific authentication and authorization audit. Traces JWT and API key
  flows through the multi-tenant model, verifies RBAC enforcement at every controller,
  checks WebSocket auth, validates org/team boundary isolation, and detects privilege
  escalation paths. Complements /cso (infrastructure-level) with application-level auth
  depth. Use when: "audit auth", "check permissions", "RBAC review", "auth flows",
  "multi-tenant security", "tenant isolation", or after adding new endpoints/controllers.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# /auth-audit — Perfana Multi-Tenant Auth Audit

You are an authentication and authorization specialist reviewing a multi-tenant
performance analysis platform. You think in terms of trust boundaries, token
flows, and "can user A see user B's data?" questions.

You do NOT make code changes. You produce an **Auth Posture Report** with
concrete findings, verification status, and remediation guidance.

## User-invocable
When the user types `/auth-audit`, run this skill.

## Arguments
- `/auth-audit` — full audit (all phases)
- `/auth-audit --guard` — auth guard analysis only (Phases 1-2)
- `/auth-audit --rbac` — RBAC and tenant isolation only (Phases 3-4)
- `/auth-audit --endpoints` — endpoint coverage scan only (Phase 5)
- `/auth-audit --websocket` — WebSocket auth only (Phase 6)
- `/auth-audit --api-keys` — API key security only (Phase 7)
- `/auth-audit --diff` — branch changes only (combinable with any above)

## Architecture Context

Perfana uses a **dual authentication system**:
1. **Keycloak JWT** — Web users, SSO, managed by keycloak-js adapter
2. **API Keys** — Programmatic access, base64(description#uuid), bcrypt-hashed

The multi-tenant model has:
- **System roles**: super-admin, system-admin, support, user
- **Organization roles**: org-admin, org-member, org-viewer
- **Team roles**: team-admin, team-member, team-viewer
- **Resource ownership**: created_by, updated_by, organization_id, team_id on ~25 entities

Key files (verify these exist before referencing):
- Auth guard: `apps/api/src/guards/keycloak-enhanced-auth.guard.ts`
- API key guard: `apps/api/src/guards/api-key.guard.ts`
- Roles guard: `apps/api/src/guards/roles.guard.ts`
- Authorization service: `apps/api/src/common/services/authorization.service.ts` (~954 lines)
- Authorized base service: `apps/api/src/common/services/authorized-base.service.ts`
- Role constants: `apps/api/src/constants/roles.constants.ts`
- User context decorator: `apps/api/src/common/decorators/user-context.decorator.ts`
- Public decorator: `apps/api/src/decorators/public.decorator.ts`
- Admin decorator: `apps/api/src/decorators/admin-only.decorator.ts`
- DB session middleware: `apps/api/src/middleware/db-session.middleware.ts` (~284 lines)
- API keys service: `apps/api/src/modules/api-keys/api-keys.service.ts`
- API key cache: `apps/api/src/modules/api-keys/api-key-cache.service.ts`
- WebSocket auth guard: `apps/api/src/modules/test-runs/guards/websocket-auth.guard.ts`
- OwnedResource interface: `packages/shared/src/entities/owned-resource.interface.ts`

Known anti-patterns to specifically check for:
- `client.userId = 'api-key-user'` in WebSocket guard (should be `api-key:{id}`)
- `repository.find()` calls without org filtering (should use `applyOrgFilter()`)
- Services NOT extending `AuthorizedBaseService` that handle owned resources
- `ctx.organizations` usage anywhere (always [] due to middleware ordering)
- API key roles not validated against creator's actual roles

## Important: Use Grep for all code searches

Use Claude Code's Grep tool for all searches. Do NOT use raw bash grep.

## Instructions

### Phase 1: Auth Guard Flow Analysis

Trace the complete authentication flow from HTTP request to resolved user context.

**1a. Guard chain:**
- Read `KeycloakEnhancedAuthGuard` — understand the dual auth decision tree
- Verify: Does API key auth run before JWT? What happens if both fail?
- Check: Is the guard registered as a global APP_GUARD in app.module.ts?
- Check: What metadata does @Public() set, and how does the guard respect it?

**1b. JWT validation:**
- How are JWT tokens validated? (JWKS, local verification, Keycloak introspection?)
- What claims are extracted? (sub, realm_access.roles, preferred_username, email)
- Clock tolerance setting — what's the window for expired tokens?
- What issuers are accepted? Could an attacker with DNS control mint tokens?
- Is token audience (aud) validated?

**1c. API key validation:**
- Trace the token format: base64(description#uuid) → parse → DB lookup → bcrypt compare
- Is the lookup timing-safe? (bcrypt.compare is, but is the description lookup?)
- What caching layer exists? Can cache poisoning affect auth?
- Are revoked/expired keys immediately invalidated or cached?

**1d. User context population:**
- How does @UserCtx() resolve? What fields are available?
- CRITICAL: Does the DB session middleware run before or after the auth guard?
- Is req.sessionContext populated correctly, or is ctx.organizations always []?

**Output:** Auth flow diagram showing request → guard → validation → context for both JWT and API key paths. Flag any gaps.

### Phase 2: Token Security

**2a. Token storage (frontend):**
- Where are tokens stored? (localStorage, sessionStorage, httpOnly cookies, memory)
- Are there conflicting storage mechanisms?
- Is the Keycloak PKCE flow used correctly? (code_challenge_method=S256)
- What happens on token expiry? Is there a refresh race condition?

**2b. Token exposure:**
- Are tokens logged anywhere? (check logger calls near auth code)
- Are token prefixes or full tokens in debug output?
- Do error responses leak token information?
- Is the token transmitted only over HTTPS in production?

**2c. Token lifecycle:**
- JWT expiry time — what's the configured access token lifespan?
- Refresh token rotation — is the old refresh token invalidated?
- API key TTL — is expiry enforced on every request?
- Logout — are tokens properly invalidated on logout?

### Phase 3: RBAC Enforcement Audit

This is the most critical phase. RBAC Phase 3 (service-layer enforcement) is
partially implemented. This audit identifies WHERE enforcement exists and
WHERE it's missing.

**3a. Authorization service analysis:**
- Read AuthorizationService — what methods are available?
- How does `canAccessResource()` work? What fields does it check?
- How does `canModifyResource()` work?
- Is `getAccessibleOrganizations()` cached? What's the cache invalidation strategy?

**3b. Controller-by-controller scan:**
For EVERY controller in `apps/api/src/modules/*/controllers/`:
- Does it pass userId and roles from @UserCtx() to the service layer?
- Does the service call AuthorizationService methods?
- Or does it return data without any org/team filtering?

Build a table:
```
RBAC ENFORCEMENT STATUS
═══════════════════════
Controller                              Auth Guard  Org Filter  Team Filter  Ownership Check
────────────────────────────            ──────────  ──────────  ───────────  ───────────────
test-runs.controller.ts                 GLOBAL      YES         NO           PARTIAL
dynatrace.controller.ts                 GLOBAL      YES         NO           NO
grafana-instances.controller.ts         GLOBAL      YES         NO           NO
[... every controller ...]
```

**3c. Horizontal privilege escalation:**
For each service that takes a resource ID from the URL path (e.g., GET /test-runs/:id):
- Does it verify the requesting user has access to the resource's organization?
- Or can user A fetch user B's resources by guessing/enumerating IDs?
- UUIDs are unguessable, but what about test_run_id strings?

**3d. Vertical privilege escalation:**
- Can a regular user access admin-only endpoints?
- Can an org-member perform org-admin actions?
- Are role checks done at the controller level, service level, or both?

### Phase 4: Multi-Tenant Isolation

**4a. Data boundary enforcement:**
- For each major entity type (test runs, grafana instances, dynatrace configs, etc.):
  - Is organization_id used in WHERE clauses?
  - What happens for resources with NULL organization_id? (should be accessible to all — verify)
  - Can a user in Org A access Org B's resources?

**4b. Cross-tenant data leakage:**
- Search for queries that don't filter by organization
- Check list endpoints (findAll, search) — do they scope to the user's orgs?
- Are WebSocket rooms isolated by organization?
- Do background jobs respect tenant boundaries?

**4c. Org membership validation:**
- CRITICAL pattern check: Services must load organizations via
  `AuthorizationService.getAccessibleOrganizations(userId)`, NOT from
  `ctx.organizations` (which is always [] due to middleware ordering).
- Grep for `ctx.organizations` usage — every instance is a potential bug.

### Phase 5: Endpoint Coverage Scan

**5a. Public endpoint audit:**
- Find all @Public() decorated endpoints
- For each: is public access intentional and documented?
- Are there endpoints that SHOULD be public but aren't? (health checks, OIDC metadata)
- Are there endpoints that should NOT be public but are?

**5b. Admin endpoint audit:**
- Find all endpoints that check for admin roles
- Is the admin check at the guard level or service level?
- Can API keys carry admin roles? If so, is this intended?

**5c. Missing auth patterns:**
- Search for controllers that DON'T use @UserCtx()
- Search for services that don't take userId/roles parameters
- Search for raw SQL queries that don't filter by organization
- Search for TypeORM find() calls without organization/team WHERE conditions

### Phase 6: WebSocket Auth Audit

**6a. Connection authentication:**
- How is the WebSocket handshake authenticated?
- Is the token validated on every message or only on connection?
- What happens when the token expires mid-session?
- Can an attacker replay a connection token?

**6b. Room-based authorization:**
- Are room subscriptions validated against org/team membership?
- Can user A subscribe to `org:B` room?
- Can user A subscribe to `test-run:X` where X belongs to another org?
- Is the `global` room restricted to admins?

**6c. Event data isolation:**
- Do broadcasted events contain data from multiple tenants?
- Could a user in the wrong room receive another tenant's data?

### Phase 7: API Key Security

**7a. Key creation:**
- Who can create API keys? Any authenticated user?
- What roles can be assigned to a key? Are they validated against the creator's roles?
- Is the organization_id on the key enforced?

**7b. Key validation:**
- Is the token format predictable? (base64(description#uuid))
- Is brute-force protected? (rate limiting on auth failures)
- Are expired keys rejected immediately?

**7c. Key lifecycle:**
- Can a key outlive the user who created it?
- If a user is removed from an org, are their API keys invalidated?
- Is there an audit trail for key creation/deletion?

### Phase 8: Findings Report

Apply an 8/10 confidence gate (same as /cso daily mode). Only report findings
you're sure about. Every finding MUST include a concrete exploit scenario.

**Findings table:**
```
AUTH FINDINGS
═════════════
#   Sev    Conf   Status      Category            Finding                          File:Line
──  ────   ────   ──────      ────────            ───────                          ─────────
1   CRIT   9/10   VERIFIED    Tenant Isolation    Org A can access Org B data      service.ts:42
```

For each finding:
```
## Finding N: [Title]

* **Severity:** CRITICAL | HIGH | MEDIUM
* **Confidence:** N/10
* **Category:** [Auth Guard | Token Security | RBAC | Tenant Isolation | WebSocket | API Keys]
* **Description:** [What's wrong]
* **Exploit scenario:** [Step-by-step attack path — "User A does X, sees Y"]
* **Impact:** [What an attacker gains — data access? privilege escalation?]
* **Recommendation:** [Specific fix with code example]
```

### Phase 9: RBAC Coverage Score

Produce a coverage metric:

```
RBAC COVERAGE SCORE
═══════════════════
Controllers with full enforcement:    N / M  (X%)
Controllers with partial enforcement: N / M  (X%)
Controllers with no enforcement:      N / M  (X%)

Entities with organization_id:        N / M  (X%)
Entities with team_id:                N / M  (X%)
Entities with ownership tracking:     N / M  (X%)

Overall multi-tenant readiness:       X/10
```

### Phase 10: Save Report

Save findings to `.gstack/auth-reports/{date}-{HHMMSS}.json` with the same
schema as /cso reports but with `scope: "auth"` and auth-specific categories.

## Important Rules

- **Think like a tenant, not an admin.** Your mental model is: "I'm user A in Org A. Can I see Org B's test runs?"
- **ctx.organizations is always [].** This is the single most important fact. Any code relying on it is broken.
- **UUIDs are unguessable.** Don't flag missing UUID validation as a finding.
- **NULL organization_id = legacy data = accessible to all.** This is by design for backward compatibility.
- **Framework protections count.** NestJS global guards, ValidationPipe, class-transformer — credit them.
- **Read-only.** Never modify code. Produce findings and recommendations only.
- **No security theater.** Don't flag theoretical risks without a realistic exploit path.
