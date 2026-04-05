# Auth Module

Keycloak integration for JWT authentication and JWKS proxy.

## Key Files

| File | Purpose |
|---|---|
| `auth.module.ts` | Module definition, imports HttpModule |
| `auth.controller.ts` | Health check (`GET /auth/health`), JWKS proxy (`GET /auth/jwks`) |
| `keycloak-jwt.service.ts` | JWT token validation, Keycloak user extraction |
| `keycloak-admin.service.ts` | Keycloak Admin API client (user management, role queries) |

## How Authentication Works

1. `KeycloakEnhancedAuthGuard` (global guard in `src/guards/`) intercepts all requests
2. Tries **API key auth** first — checks `Authorization: Bearer` header against `api_keys` table
3. Falls back to **Keycloak JWT** — validates token using `keycloak-jwt.service.ts`
4. Attaches `request.user` (Keycloak) or `request.apiKey` (API key metadata) to the request
5. `@UserCtx()` decorator extracts a unified `UserContext` from either auth type

## Public Endpoints

- `GET /auth/health` — health check (decorated with `@Public()`)
- `GET /auth/jwks` — proxies Keycloak JWKS endpoint to avoid CORS issues

## Related

- Guards: `src/guards/keycloak-enhanced-auth.guard.ts`, `src/guards/api-key.guard.ts`
- Decorators: `src/decorators/public.decorator.ts`, `src/decorators/admin-only.decorator.ts`
- User context: `src/common/decorators/user-context.decorator.ts`
- Authorization: `src/common/services/authorization.service.ts`
