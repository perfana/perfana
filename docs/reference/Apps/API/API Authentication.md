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

The `DatabaseSessionMiddleware` sets PostgreSQL session variables on every request:

1. Loads user's organization memberships from database
2. Validates the `X-Organization-Id` header
3. Sets session variables for RLS policy enforcement
4. Optionally downgrades role to `perfana_app` for enforced RLS

> [!warning] Multi-tenant Security
> All queries are automatically filtered by `organization_id` through RLS policies. Worker pipelines needed explicit organization filtering fixes — see [[Multi-tenancy]] for details.

## Related

- [[API Overview]]
- [[RBAC]] — Role-based access control details
- [[Multi-tenancy]] — Organization scoping
- [[API Endpoints]] — Endpoint reference
