---
aliases:
  - Authentication
  - Auth
tags:
  - app/api
  - security
---

# API Authentication

Perfana uses a **dual authentication** system: Keycloak JWT for users and API keys for programmatic access.

## Authentication Types

### 1. Keycloak JWT

Enterprise SSO via OpenID Connect. Primary authentication for the web UI.

- Token extracted from `Authorization: Bearer <token>` header
- JWKS fetched from Keycloak's well-known endpoint
- Supports multiple issuers (Docker/localhost scenarios)
- Roles extracted from `realm_access.roles` and `resource_access.{audience}.roles`

**Flow**:
1. Frontend initializes Keycloak JS client
2. User redirected to Keycloak login page
3. On success, JWT stored in `sessionStorage`
4. All API calls include `Authorization: Bearer <jwt>` header
5. API validates JWT signature against JWKS
6. Token refresh every 60 seconds

### 2. API Keys

Static bearer tokens for CI/CD integrations and test tools.

- Stored in database (hashed)
- Optional expiration (`validUntil`)
- Associated with roles and organization
- Cached in Redis for performance

**Usage**:
```bash
curl -H "Authorization: Bearer pfn_xxxxxxxxxxxx" \
     https://perfana.example.com/api/test-runs
```

## Guard Chain

Guards execute in this order on every request:

1. **`KeycloakEnhancedAuthGuard`** — Authentication (JWT or API Key)
2. **`RolesGuard`** — Role-based authorization
3. **`EnhancedThrottlerGuard`** — Rate limiting

## Decorators

| Decorator | Purpose |
|---|---|
| `@Public()` | Skip authentication (health checks, JWKS) |
| `@AdminOnly()` | Require admin role |
| `@Roles({roles, mode})` | Require specific roles |
| `@RequireRoles('r1', 'r2')` | Require ANY of the listed roles |
| `@RequireAllRoles('r1', 'r2')` | Require ALL listed roles |
| `@CurrentUser()` | Inject user from JWT |
| `@UserCtx()` | Inject full user context (userId, roles, orgs, teams) |
| `@AuthType()` | Inject authentication type used |
| `@ThrottleConfig(limit, ttl)` | Custom rate limit per endpoint |
| `@SkipThrottle()` | Disable rate limiting |

## Rate Limiting

| Scope | Limit |
|---|---|
| Authentication endpoints | 5 req/min |
| Authenticated users | 1000 req/min |
| Write operations (unauthenticated) | 20 req/min |
| Public endpoints | 100 req/min |

Rate limits tracked per user ID (JWT) or IP address (API key/public). Storage backed by Redis.

## Row-Level Security (RLS)

`RlsTransactionInterceptor` (`apps/api/src/common/interceptors/rls-transaction.interceptor.ts`) wraps each request in a transaction and establishes the RLS context on it:

1. Resolves the caller's accessible organizations via `AuthorizationService.getAccessibleOrganizations(ctx.userId)`
2. Opens a per-request transaction and runs `SET LOCAL ROLE perfana_app`
3. Sets four `app.current_*` GUCs — including `app.current_user_organizations` — that the policies read
4. Commits or rolls back at the end of the request

Repository calls only see that context if they go through `withRequestEm()`. A call on the plain pooled repository runs on a different connection with none of the GUCs set. The lint rule `owned-resource-must-use-request-em` enforces this.

> [!warning] Multi-tenant Security
> Queries routed through `withRequestEm()` are filtered by `organization_id` at the database level through RLS policies. Worker pipelines run outside this interceptor and need explicit organization filtering — see [[Multi-tenancy]] for details.

> [!note] The one deliberate bypass
> The API-key branch of `getAccessibleOrganizations` / `isOrganizationMember` reads `api_keys` on the pooled connection on purpose: its result *becomes* `app.current_user_organizations`, so it cannot be read through a policy that consumes it. Because `api_keys` is `FORCE ROW LEVEL SECURITY`, that read works only while the API's login role bypasses RLS (`rolsuper`/`rolbypassrls`). See [[RBAC]] §1.

## Related

- [[API Overview]]
- [[RBAC]] — Role-based access control details
- [[Multi-tenancy]] — Organization scoping
- [[API Endpoints]] — Endpoint reference
