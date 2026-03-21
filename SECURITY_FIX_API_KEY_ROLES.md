# Security Fix: API Key Role-Based Access Control

**Date:** 2025-01-06
**Severity:** CRITICAL
**Issue:** Privilege Escalation Vulnerability in API Key Authentication

## Executive Summary

Fixed a critical security vulnerability where ALL API keys automatically received admin privileges (`perfana-admin` role), regardless of their intended purpose. This violated the principle of least privilege and could lead to unauthorized access.

## Vulnerability Details

### Location
`apps/api/src/middleware/db-session.middleware.ts:80`

### Problem Code (Before)
```typescript
} else if (req.authType === 'api-key') {
  context.userId = 'api-key-user';
  context.roles = ['perfana-admin']; // ❌ ALL API keys get admin access
  context.organizations = [];
  context.teams = [];
}
```

### Security Impact
- **Privilege Escalation:** All API keys had unrestricted admin access
- **No Least Privilege:** Could not create read-only or limited-scope API keys
- **Compliance Risk:** Violated security best practices for access control
- **Audit Concerns:** No granular tracking of API key permissions

## Solution Implemented

### 1. Database Schema Changes

**Migration:** `1736179200000-AddRolesToApiKeys.ts`

Added `roles` column to `api_keys` table:
- Type: `text[]` (PostgreSQL array)
- Default: `{}` (empty array - principle of least privilege)
- Index: GIN index for efficient role-based queries
- Backward Compatibility: Existing API keys migrated to `['perfana-admin']`

```sql
ALTER TABLE api_keys
ADD COLUMN roles text[] NOT NULL DEFAULT '{}';

-- Migrate existing keys to have admin role
UPDATE api_keys
SET roles = ARRAY['perfana-admin']::text[]
WHERE roles = '{}';

-- Add index for role queries
CREATE INDEX idx_api_keys_roles ON api_keys USING GIN (roles);
```

### 2. Type System Updates

**File:** `apps/api/src/types/auth.types.ts`

Added `ApiKeyInfo` interface to properly track API key details:

```typescript
export interface ApiKeyInfo {
  id: string;
  description: string;
  roles: string[];
  validUntil?: Date;
}

export interface AuthenticatedRequest extends Request {
  user?: KeycloakUser;
  keycloakUser?: KeycloakUser;
  apiKey?: ApiKeyInfo; // New: API key details for role checking
  authType?: AuthType;
  queryRunner?: QueryRunner;
  sessionContext?: SessionContext;
}
```

### 3. Service Layer Changes

**File:** `apps/api/src/modules/api-keys/api-keys.service.ts`

#### CreateApiKey - Store Roles
```typescript
async createApiKey(createDto: CreateApiKeyDto): Promise<{ apiKey: ApiKey; token: string }> {
  // Default to empty roles (principle of least privilege) if not provided
  const roles = createDto.roles || [];

  const apiKey = await this.apiKeyRepository.create({
    apiKey: hashedToken,
    description: createDto.description,
    validUntil: validUntil,
    roles: roles, // ✅ Store actual roles
  } as ApiKey);

  this.logger.log(`API key created: ${createDto.description} with roles: ${roles.join(', ') || 'none'}`);
  return { apiKey, token };
}
```

#### ValidateApiKey - Return API Key Details
```typescript
async validateApiKey(token: string): Promise<ApiKey | null> {
  // ... validation logic ...

  if (isValid) {
    await this.updateLastUsed(apiKeyDoc.id);
    return apiKeyDoc; // ✅ Return full API key including roles
  }

  return null;
}
```

### 4. Authentication Guard Updates

**File:** `apps/api/src/guards/keycloak-enhanced-auth.guard.ts`

#### Attach API Key Info to Request
```typescript
private async tryAuthentication(token: string, request: AuthenticatedRequest) {
  const apiKey = await this.apiKeysService.validateApiKey(token);
  if (apiKey) {
    request.authType = 'api-key';
    // ✅ Attach API key details to request for role checking
    request.apiKey = {
      id: apiKey.id,
      description: apiKey.description,
      roles: apiKey.roles,
      validUntil: apiKey.validUntil,
    };
    return { success: true, authType: 'api-key', userId: `api-key:${apiKey.id}` };
  }
}
```

#### Fixed Role Checking Methods
```typescript
static isAdmin(request: AuthenticatedRequest): boolean {
  if (request.authType === 'keycloak-jwt' && request.user) {
    const roles = request.user.roles || request.user.realm_access?.roles || [];
    return roles.includes('perfana-admin') || roles.includes('admin');
  }

  if (request.authType === 'api-key' && request.apiKey) {
    // ✅ Check if API key has admin role
    return request.apiKey.roles.includes('perfana-admin') ||
           request.apiKey.roles.includes('admin');
  }

  return false;
}

static hasRole(request: AuthenticatedRequest, role: string): boolean {
  if (request.authType === 'keycloak-jwt' && request.user) {
    const roles = request.user.roles || request.user.realm_access?.roles || [];
    return roles.includes(role);
  }

  if (request.authType === 'api-key' && request.apiKey) {
    // ✅ Check if API key has the specified role
    return request.apiKey.roles.includes(role);
  }

  return false;
}

static getRoles(request: AuthenticatedRequest): string[] {
  if (request.authType === 'keycloak-jwt' && request.user) {
    return request.user.roles || request.user.realm_access?.roles || [];
  }

  if (request.authType === 'api-key' && request.apiKey) {
    return request.apiKey.roles; // ✅ Return actual API key roles
  }

  return [];
}
```

### 5. Session Middleware Fix

**File:** `apps/api/src/middleware/db-session.middleware.ts`

```typescript
private extractSessionContext(req: AuthenticatedRequest): SessionContext {
  const context: SessionContext = {
    authType: req.authType,
  };

  if (req.authType === 'keycloak-jwt' && req.keycloakUser) {
    context.userId = req.keycloakUser.sub;
    context.email = req.keycloakUser.email;
    context.roles = req.keycloakUser.roles;
    context.organizations = req.keycloakUser.organizations;
    context.teams = req.keycloakUser.teams;
    context.sessionId = req.keycloakUser.sessionId;
  } else if (req.authType === 'api-key' && req.apiKey) {
    // ✅ Use actual API key roles instead of hardcoded admin
    context.userId = `api-key:${req.apiKey.id}`;
    context.roles = req.apiKey.roles; // ✅ Use the API key's actual roles
    context.organizations = [];
    context.teams = [];
    context.apiKeyId = req.apiKey.id;
  }

  return context;
}
```

### 6. DTO Updates

**File:** `apps/api/src/modules/api-keys/dto/create-api-key.dto.ts`

```typescript
export class CreateApiKeyDto {
  @ApiProperty({
    description: 'Array of role identifiers assigned to this API key. Controls access permissions. Common roles: perfana-admin (full access), perfana-user (standard access), read-only (view-only access). Defaults to empty array (minimal permissions) if not specified.',
    example: ['perfana-user'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(0)
  roles?: string[];
}

export class ApiKeyDto {
  id!: string;
  description!: string;
  roles!: string[]; // ✅ Include roles in response
  validUntil!: Date;
  createdAt!: Date;
  updatedAt!: Date;
  lastUsed?: Date;
}
```

## Migration Instructions

### Step 1: Run the Migration

```bash
# From project root
npm run migration:run
```

This will:
1. Add the `roles` column to the `api_keys` table
2. Set existing API keys to have `['perfana-admin']` role (backward compatibility)
3. Create a GIN index on the roles column

### Step 2: Verify Migration

Check that the roles column exists:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'api_keys'
AND column_name = 'roles';
```

### Step 3: Restart Services

```bash
# Kill and restart all services
lsof -ti:3001,3002,4001 | xargs kill -9 && npm run dev
```

## Usage Examples

### Creating API Keys with Specific Roles

#### Admin API Key (Full Access)
```bash
curl -X POST http://localhost:3001/api/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Admin CI/CD Pipeline",
    "ttl": "90d",
    "roles": ["perfana-admin"]
  }'
```

#### Read-Only API Key
```bash
curl -X POST http://localhost:3001/api/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Monitoring Dashboard",
    "ttl": "365d",
    "roles": ["read-only"]
  }'
```

#### Standard User API Key
```bash
curl -X POST http://localhost:3001/api/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Test Runner",
    "ttl": "30d",
    "roles": ["perfana-user"]
  }'
```

#### Minimal Permissions (No Roles)
```bash
curl -X POST http://localhost:3001/api/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Health Check Only",
    "ttl": "1y",
    "roles": []
  }'
```

## Role Definitions

### Recommended Roles

| Role | Description | Access Level |
|------|-------------|--------------|
| `perfana-admin` | Full system administrator | All operations |
| `perfana-user` | Standard user access | Read + Write test runs |
| `read-only` | Read-only access | View data only |
| `test-writer` | Create/update test runs | Test run CRUD |
| `metrics-reader` | Read metrics and dashboards | Metrics + Grafana |

### Custom Role Implementation

To add custom role checks in controllers:

```typescript
import { KeycloakEnhancedAuthGuard } from '../guards/keycloak-enhanced-auth.guard';

@Post('sensitive-operation')
async sensitivOperation(@Req() req: AuthenticatedRequest) {
  // Check for specific role
  if (!KeycloakEnhancedAuthGuard.hasRole(req, 'perfana-admin')) {
    throw new ForbiddenException('Admin role required');
  }

  // ... operation logic
}
```

## Testing Checklist

- [ ] Run migration successfully
- [ ] Create API key with admin role - verify admin access
- [ ] Create API key with no roles - verify minimal access
- [ ] Create API key with custom roles - verify role-based access
- [ ] Test existing API keys still work (backward compatibility)
- [ ] Verify `KeycloakEnhancedAuthGuard.isAdmin()` respects API key roles
- [ ] Verify `KeycloakEnhancedAuthGuard.hasRole()` respects API key roles
- [ ] Test that API keys without admin role cannot access admin endpoints
- [ ] Verify session context includes correct roles for API keys
- [ ] Check logs show role information when API keys are created/used

## Files Modified

### Core Changes
- `apps/api/src/types/auth.types.ts` - Added ApiKeyInfo interface
- `apps/api/src/modules/api-keys/api-keys.service.ts` - Store and return roles
- `apps/api/src/guards/keycloak-enhanced-auth.guard.ts` - Role checking logic
- `apps/api/src/middleware/db-session.middleware.ts` - Use actual API key roles
- `apps/api/src/guards/api-key.guard.ts` - Attach API key info to request

### Database
- `packages/shared/src/entities/api-key.entity.ts` - Roles field (already present)
- `packages/shared/src/database/migrations/1736179200000-AddRolesToApiKeys.ts` - Migration

### DTOs and Controllers
- `apps/api/src/modules/api-keys/dto/create-api-key.dto.ts` - Roles in DTO
- `apps/api/src/modules/api-keys/api-keys.controller.ts` - Return roles in response

## Security Best Practices

### 1. Principle of Least Privilege
- Always create API keys with minimum required roles
- Default to empty roles array for new keys
- Review and audit API key permissions regularly

### 2. API Key Lifecycle Management
- Set appropriate TTL (time-to-live) based on use case
- Rotate API keys periodically
- Delete unused API keys promptly
- Monitor `last_used` timestamps

### 3. Role Assignment Guidelines
- Use `perfana-admin` sparingly (only for truly admin operations)
- Prefer specific roles over blanket admin access
- Document role assignments and their purpose
- Implement role-based logging for audit trails

### 4. Monitoring and Alerting
- Log all API key creation with roles
- Alert on admin API key usage
- Monitor failed authentication attempts
- Track role escalation attempts

## Rollback Plan

If issues are encountered, rollback by:

1. Revert migration:
```bash
npm run migration:revert
```

2. Revert code changes:
```bash
git revert <commit-hash>
```

3. Restart services

## Future Enhancements

1. **UI for Role Management**
   - Add role selection UI in API key creation form
   - Display current roles in API key list
   - Role management interface for admins

2. **Granular Permissions**
   - Implement resource-based permissions
   - Add organization/team scoping for API keys
   - Support time-based role restrictions

3. **Audit Logging**
   - Log all role checks and denials
   - Create audit trail for role changes
   - Dashboard for security monitoring

4. **Role Validation**
   - Validate roles against a predefined list
   - Prevent typos in role assignments
   - Role hierarchy and inheritance

## References

- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [Principle of Least Privilege](https://en.wikipedia.org/wiki/Principle_of_least_privilege)
- [NestJS Authentication](https://docs.nestjs.com/security/authentication)
- [PostgreSQL Array Types](https://www.postgresql.org/docs/current/arrays.html)

---

**Implementation Status:** ✅ COMPLETE
**Migration Status:** Ready to run
**Backward Compatibility:** ✅ Maintained
**Security Risk:** MITIGATED
