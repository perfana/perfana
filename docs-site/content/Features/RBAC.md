---
aliases:
  - Role-Based Access Control
  - Roles
  - Permissions
tags:
  - feature
  - security
---

# RBAC

Perfana implements Role-Based Access Control through Keycloak with a multi-phase implementation.

## Role Hierarchy

| Role | Level | Capabilities |
|---|---|---|
| `admin` | Global | Full system access, org management, user management |
| `org_admin` | Organization | Manage org settings, teams, members |
| `team_admin` | Team | Manage team settings and members |
| `user` | Default | View and interact within assigned scope |
| `readonly` | Restricted | View-only access |

## Implementation Phases

### Phase 1: Core RBAC Framework
- Keycloak JWT role extraction
- `@Roles()` decorator for endpoint protection
- `RolesGuard` for authorization enforcement
- `AuthorizationService` with Redis caching

### Phase 2: Organization-Level Authorization
- Organization membership validation
- `X-Organization-Id` header requirement
- Database middleware for org scoping

### Phase 3: Team-Level Authorization
- Team membership and role inheritance
- Team admin capabilities
- Cross-team access rules

### Phase 4: Resource-Level Authorization
- Fine-grained resource ownership
- `created_by` columns on entities
- Owner vs member access rules

### Phase 5: API Key Authorization
- API keys with assigned roles
- Organization-scoped API keys
- Rate limiting per key type

### Phase 6: UI Integration
- Role-based UI rendering
- Admin-only settings pages
- Conditional action buttons
- Organization selector behavior (admin vs non-admin)

## Guard Execution Order

```
Request
  │
  ▼
KeycloakEnhancedAuthGuard ──▶ "Who are you?"
  │                              ├── JWT token → Keycloak roles
  │                              └── API key → stored roles
  ▼
RolesGuard ──▶ "Are you allowed?"
  │            ├── @Public() → skip
  │            ├── @AdminOnly() → require admin
  │            └── @Roles({roles, mode}) → check
  ▼
EnhancedThrottlerGuard ──▶ "Too many requests?"
  │
  ▼
Controller
```

## Authorization Patterns

### Decorator-Based
```typescript
@AdminOnly()
@Get('sensitive-data')
async getSensitiveData() { ... }

@Roles({ roles: ['admin', 'org_admin'], mode: RoleMatchingMode.ANY })
@Post('create-team')
async createTeam() { ... }
```

### Programmatic (Service Layer)
```typescript
const ctx = this.authorizationService.checkAccess(userId, resourceId);
if (!ctx.canEdit) throw new ForbiddenException();
```

## Keycloak Integration

- Roles defined in Keycloak realm
- Extracted from JWT claims: `realm_access.roles` and `resource_access.{audience}.roles`
- Token refresh every 60 seconds
- JWKS validation for token integrity

## Related

- [[API Authentication]] — Authentication details
- [[Multi-tenancy]] — Organization scoping
- [[API Overview]] — Guard chain
