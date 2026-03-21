# API Key Roles - Quick Start Guide

## TL;DR

API keys now support role-based access control. No more automatic admin privileges!

## Running the Migration

```bash
# From project root
npm run migration:run

# Restart services
lsof -ti:3001,3002,4001 | xargs kill -9 && npm run dev
```

## Creating API Keys with Roles

### Admin Access
```bash
curl -X POST http://localhost:3001/api/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Admin Key",
    "ttl": "90d",
    "roles": ["perfana-admin"]
  }'
```

### Standard User
```bash
curl -X POST http://localhost:3001/api/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Test Runner",
    "ttl": "30d",
    "roles": ["perfana-user"]
  }'
```

### Read-Only
```bash
curl -X POST http://localhost:3001/api/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Monitoring",
    "ttl": "365d",
    "roles": ["read-only"]
  }'
```

### No Roles (Minimal Access)
```bash
curl -X POST http://localhost:3001/api/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Health Check",
    "ttl": "1y",
    "roles": []
  }'
```

## Checking Roles in Code

### Check if Admin
```typescript
import { KeycloakEnhancedAuthGuard } from '../guards/keycloak-enhanced-auth.guard';

@Post('admin-operation')
async adminOperation(@Req() req: AuthenticatedRequest) {
  if (!KeycloakEnhancedAuthGuard.isAdmin(req)) {
    throw new ForbiddenException('Admin access required');
  }
  // ... operation
}
```

### Check Specific Role
```typescript
@Post('operation')
async operation(@Req() req: AuthenticatedRequest) {
  if (!KeycloakEnhancedAuthGuard.hasRole(req, 'test-writer')) {
    throw new ForbiddenException('test-writer role required');
  }
  // ... operation
}
```

### Get All Roles
```typescript
@Get('my-roles')
async getMyRoles(@Req() req: AuthenticatedRequest) {
  const roles = KeycloakEnhancedAuthGuard.getRoles(req);
  return { roles };
}
```

## Common Roles

| Role | Access Level |
|------|--------------|
| `perfana-admin` | Full admin access |
| `perfana-user` | Standard user access |
| `read-only` | View-only access |
| `test-writer` | Create/update tests |
| `metrics-reader` | Read metrics |

## Important Notes

1. **Existing API keys** maintain their admin access (backward compatibility)
2. **New API keys** default to NO roles (principle of least privilege)
3. **Always specify roles** when creating new API keys
4. **Review API key permissions** regularly

## Troubleshooting

### API Key Has No Access
- Check the roles assigned to the API key
- Verify the endpoint requires the roles the API key has
- Check the API key hasn't expired

### Migration Failed
- Check database connection in `.env` file
- Ensure PostgreSQL is running
- Check for syntax errors in migration file

### Still Getting Admin Access When You Shouldn't
- Clear API key caches: `POST /api/api-keys/cache/clear`
- Restart the API service
- Verify migration ran successfully

## Documentation

For complete details, see: [SECURITY_FIX_API_KEY_ROLES.md](./SECURITY_FIX_API_KEY_ROLES.md)
