# RBAC Phase 1 Implementation Plan

## Overview
Phase 1 implements immediate RBAC enforcement by creating the missing RolesGuard and enabling existing @AdminOnly() decorators.

**Goal**: Get basic RBAC working with minimal changes
**Estimated Files**: 4 new files, 6 modified files
**Lines of Code**: ~800 total (including tests)

---

## File Structure

### 1. New Files to Create

#### 1.1 Role Constants
**File**: `apps/api/src/constants/roles.constants.ts`
**Size**: ~30 lines
**Purpose**: Centralized role definitions
**Contents**:
```typescript
export enum SystemRole {
  GLOBAL_ADMIN = 'perfana-admin',
  ADMIN = 'admin', // Alias for backward compatibility
}

export enum OrganizationRole {
  ORG_ADMIN = 'org-admin',
  ORG_MEMBER = 'org-member',
  ORG_VIEWER = 'org-viewer',
}

export enum TeamRole {
  TEAM_ADMIN = 'team-admin',
  TEAM_MEMBER = 'team-member',
  TEAM_VIEWER = 'team-viewer',
}

// Helper function to check if role is global admin
export function isGlobalAdminRole(role: string): boolean {
  return role === SystemRole.GLOBAL_ADMIN || role === SystemRole.ADMIN;
}
```

**Linting**: ✅ Enums, clear naming, no any types
**Maintainability**: ✅ Small, focused, single responsibility
**Tests**: Unit tests in roles.constants.spec.ts

---

#### 1.2 RolesGuard
**File**: `apps/api/src/guards/roles.guard.ts`
**Size**: ~80 lines
**Purpose**: Enforce @Roles() decorator
**Structure**:
```typescript
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Get role options from decorator
    // 2. If no roles required, allow access
    // 3. Extract user roles from request
    // 4. Check role matching based on mode (ANY or ALL)
    // 5. Return true/false
  }

  private checkRoleMatch(
    userRoles: string[],
    requiredRoles: string[],
    mode: RoleMatchingMode
  ): boolean {
    // Implementation
  }
}
```

**Features**:
- Supports ANY matching (default)
- Supports ALL matching (require all roles)
- Works with both Keycloak JWT and API Keys
- Proper error messages
- Logging for debugging

**Linting**: ✅ No any types, proper error handling, clear method names
**Maintainability**: ✅ Small focused class, single responsibility
**Tests**: Comprehensive test suite in roles.guard.spec.ts

---

#### 1.3 RolesGuard Tests
**File**: `apps/api/src/guards/roles.guard.spec.ts`
**Size**: ~600 lines
**Purpose**: Comprehensive test coverage for RolesGuard
**Test Suites**:

```typescript
describe('RolesGuard', () => {
  // Setup and teardown

  describe('Basic Functionality', () => {
    it('should be defined')
    it('should allow access when no roles are required')
    it('should allow access when user has required role')
    it('should deny access when user lacks required role')
  })

  describe('Role Matching Modes', () => {
    it('should use ANY mode by default')
    it('should allow access when user has ANY of the required roles')
    it('should deny access when user has NONE of the required roles')
    it('should allow access in ALL mode only when user has ALL required roles')
    it('should deny access in ALL mode when user lacks any required role')
  })

  describe('Keycloak JWT Authentication', () => {
    it('should extract roles from Keycloak JWT user')
    it('should handle empty roles array')
    it('should handle missing roles field')
    it('should work with multiple roles')
  })

  describe('API Key Authentication', () => {
    it('should extract roles from API key')
    it('should handle API key with empty roles')
    it('should handle API key with multiple roles')
  })

  describe('Global Admin Bypass', () => {
    it('should allow perfana-admin role to access any endpoint')
    it('should allow admin role to access any endpoint')
  })

  describe('Integration with KeycloakEnhancedAuthGuard', () => {
    it('should run after authentication guard')
    it('should access authenticated request data')
  })

  describe('Edge Cases', () => {
    it('should handle missing request object')
    it('should handle missing auth type')
    it('should handle null/undefined roles')
    it('should handle special characters in role names')
    it('should handle case-sensitive role matching')
  })

  describe('Error Handling', () => {
    it('should return false (not throw) when access denied')
    it('should handle reflector errors gracefully')
  })
})
```

**Coverage Target**: 100%
**Linting**: ✅ Test files exempt from strict any rules
**Maintainability**: ✅ Well-organized test suites, clear test names

---

#### 1.4 Role Constants Tests
**File**: `apps/api/src/constants/roles.constants.spec.ts`
**Size**: ~100 lines
**Purpose**: Test role constants and helper functions
**Test Suites**:

```typescript
describe('Role Constants', () => {
  describe('SystemRole', () => {
    it('should have GLOBAL_ADMIN role')
    it('should have ADMIN role')
    it('should use correct role names matching Keycloak')
  })

  describe('OrganizationRole', () => {
    it('should have ORG_ADMIN role')
    it('should have ORG_MEMBER role')
    it('should have ORG_VIEWER role')
  })

  describe('isGlobalAdminRole()', () => {
    it('should return true for perfana-admin')
    it('should return true for admin')
    it('should return false for other roles')
    it('should handle empty string')
    it('should handle null/undefined')
  })
})
```

---

### 2. Files to Modify

#### 2.1 App Module
**File**: `apps/api/src/app.module.ts`
**Change**: Add RolesGuard to global guards (1 provider added)
**Location**: Line 106-117 (providers array)
**Before**:
```typescript
providers: [
  {
    provide: APP_GUARD,
    useClass: KeycloakEnhancedAuthGuard,
  },
  {
    provide: APP_GUARD,
    useClass: EnhancedThrottlerGuard,
  },
]
```

**After**:
```typescript
providers: [
  // Authentication guard (runs first)
  {
    provide: APP_GUARD,
    useClass: KeycloakEnhancedAuthGuard,
  },
  // Authorization guard (runs second, after authentication)
  {
    provide: APP_GUARD,
    useClass: RolesGuard,
  },
  // Rate limiting guard (runs third)
  {
    provide: APP_GUARD,
    useClass: EnhancedThrottlerGuard,
  },
]
```

**Import**: Add `import { RolesGuard } from './guards/roles.guard';`

---

#### 2.2 API Keys Controller
**File**: `apps/api/src/modules/api-keys/api-keys.controller.ts`
**Changes**: Uncomment 5 @AdminOnly() decorators
**Lines to Modify**:
- Line 30: `@Post()` - Uncomment line 30
- Line 52: `@Delete(':id')` - Uncomment line 52
- Line 83: `@Get('cache/stats')` - Uncomment line 83
- Line 92: `@Post('cache/clear')` - Uncomment line 92
- Line 104: `@Post('cache/warm')` - Uncomment line 104

**Import**: Already imported (just commented)

---

#### 2.3 Grafana Instances Controller
**File**: `apps/api/src/modules/grafana/grafana-instances.controller.ts`
**Changes**: Uncomment 3 @AdminOnly() decorators
**Lines to Modify**:
- Line 81: `@Post()` - Uncomment line 81 (create instance)
- Line 99: `@Patch(':id')` - Uncomment line 99 (update instance)
- Line 124: `@Delete(':id')` - Uncomment line 124 (delete instance)

**Import**: Already imported (line 17, just commented)

---

#### 2.4 Tracing Instances Controller (NEW ADMIN PROTECTION)
**File**: `apps/api/src/modules/tracing-instances/tracing-instances.controller.ts`
**Changes**: Add @AdminOnly() decorator to CREATE/UPDATE/DELETE endpoints
**Lines to Modify**:
- Line 89: Add `@AdminOnly()` before `@Post()` (create instance)
- Line 110: Add `@AdminOnly()` before `@Patch(':id')` (update instance)
- Line 133: Add `@AdminOnly()` before `@Delete(':id')` (delete instance)

**Import to Add**: `import { AdminOnly } from '../../decorators/admin-only.decorator';`

**Justification**: Integration instance management should be admin-only, similar to Grafana and Pyroscope

---

#### 2.5 Grafana Dashboards Controller (OPTIONAL ADMIN PROTECTION)
**File**: `apps/api/src/modules/grafana/grafana-dashboards.controller.ts`
**Changes**: Consider adding @AdminOnly() to CREATE/UPDATE/DELETE endpoints
**Lines to Modify** (OPTIONAL):
- Line 74: Add `@AdminOnly()` before `@Post()` (create dashboard)
- Line 90: Add `@AdminOnly()` before `@Patch(':id')` (update dashboard)
- Line 113: Add `@AdminOnly()` before `@Delete(':id')` (delete dashboard)

**Note**: Dashboard CRUD is typically done by the sync service, not users. Admin protection here depends on requirements:
- **Protect**: If manual dashboard management should be admin-only
- **Leave open**: If teams need to create custom dashboards

**Recommendation**: Start without admin protection, add later if needed (Phase 2)

---

#### 2.6 Pyroscope Instances Controller (VERIFY EXISTING)
**File**: `apps/api/src/modules/pyroscope/pyroscope-instances.controller.ts`
**Changes**: VERIFY that @AdminOnly() is already in place
**Expected**: Lines for POST, PATCH, DELETE should already have @AdminOnly()
**Action**: Verify no TODOs to uncomment

---

## Implementation Checklist

### Phase 1.1: Create Core Files (30 min)
- [ ] Create `roles.constants.ts` with all role enums
- [ ] Create `roles.constants.spec.ts` with unit tests
- [ ] Create `roles.guard.ts` with RolesGuard implementation
- [ ] Create `roles.guard.spec.ts` with comprehensive tests
- [ ] Run tests: `npm test roles.guard.spec`
- [ ] Run tests: `npm test roles.constants.spec`
- [ ] Run linter: `npm run lint`

### Phase 1.2: Register Guard (5 min)
- [ ] Update `app.module.ts` to register RolesGuard globally
- [ ] Verify import statements
- [ ] Run app: `npm run dev:api`
- [ ] Check logs for guard initialization

### Phase 1.3: Enable Admin Protection (15 min)
- [ ] Uncomment @AdminOnly() in `api-keys.controller.ts` (5 decorators)
- [ ] Check `grafana-instances.controller.ts` for @AdminOnly() decorators
- [ ] Uncomment @AdminOnly() in `grafana-instances.controller.ts`
- [ ] Check `tracing-instances.controller.ts` for admin endpoints
- [ ] Add @AdminOnly() to create/update/delete in tracing controllers
- [ ] Run linter: `npm run lint`
- [ ] Run type check: `npm run type-check`

### Phase 1.4: Testing & Verification (20 min)
- [ ] Run all tests: `npm test`
- [ ] Test admin endpoint with non-admin user (expect 403)
- [ ] Test admin endpoint with admin user (expect 200)
- [ ] Test admin endpoint with admin API key (expect 200)
- [ ] Test non-admin endpoint with regular user (expect 200)
- [ ] Check logs for ForbiddenException messages
- [ ] Verify no breaking changes to existing functionality

### Phase 1.5: Documentation (10 min)
- [ ] Add JSDoc comments to RolesGuard
- [ ] Add JSDoc comments to role constants
- [ ] Update CLAUDE.md with new guard information
- [ ] Add migration notes if needed

---

## File Size Summary

| File | Lines | Purpose | Test Coverage |
|------|-------|---------|---------------|
| `roles.constants.ts` | ~30 | Role definitions | 100% |
| `roles.constants.spec.ts` | ~100 | Constants tests | N/A |
| `roles.guard.ts` | ~80 | Authorization guard | 100% |
| `roles.guard.spec.ts` | ~600 | Guard tests | N/A |
| `app.module.ts` | +8 | Register guard | Manual |
| `api-keys.controller.ts` | -5 lines | Uncomment decorators (L30, L52, L83, L92, L104) | Existing |
| `grafana-instances.controller.ts` | -4 lines | Uncomment decorators + import (L17, L81, L99, L124) | Existing |
| `tracing-instances.controller.ts` | +4 lines | Add decorators + import | Existing |

**Total New Code**: ~810 lines
**Total Modified Code**: ~16 lines in controllers, +8 lines in app.module

**Note**: Grafana dashboards controller not modified in Phase 1 (deferred to Phase 2)

---

## Linting Strategy

### Auto-fixable Issues
```bash
# Fix formatting
npm run lint -- --fix

# Check for remaining issues
npm run lint
```

### Expected Linting Rules
- ✅ No `any` types in production code
- ✅ Proper TypeScript typing for all parameters
- ✅ Clear function and variable names
- ✅ No unused variables (use `_` prefix if intentional)
- ✅ Consistent formatting (Prettier)
- ✅ Test files can use `any` (exempted in .eslintrc.js)

---

## Maintainability Guidelines

### File Size Limits
- **Guards**: < 150 lines
- **Constants**: < 50 lines
- **Test files**: < 800 lines (split if larger)

### Code Organization
- One class per file
- Clear separation of concerns
- Minimal dependencies
- Composable functions

### Testing Standards
- 100% coverage for guards
- Test all edge cases
- Clear test descriptions
- Arrange-Act-Assert pattern

---

## Rollback Plan

If Phase 1 causes issues:

1. **Remove RolesGuard registration**
   - Revert `app.module.ts` changes
   - Restart API service

2. **Re-comment @AdminOnly() decorators**
   - Revert controller changes
   - Existing behavior restored

3. **Delete new files**
   - Remove `roles.guard.ts`
   - Remove `roles.constants.ts`
   - Remove test files

**Rollback Time**: < 5 minutes

---

## Success Criteria

### Functional
- ✅ RolesGuard enforces @Roles() decorator
- ✅ Admin-only endpoints return 403 for non-admins
- ✅ Admin-only endpoints allow admin users
- ✅ Non-admin endpoints work for all authenticated users
- ✅ Both Keycloak JWT and API Keys work

### Quality
- ✅ 100% test coverage for new code
- ✅ All tests passing
- ✅ Linter passing
- ✅ TypeScript compilation successful
- ✅ No breaking changes

### Performance
- ✅ < 5ms overhead per request
- ✅ No database queries in guard
- ✅ No external API calls

---

## Next Steps After Phase 1

Once Phase 1 is verified:
1. Begin Phase 2: Organization membership infrastructure
2. Add ownership tracking to entities
3. Implement service-layer authorization

---

## Questions Resolved ✅

1. **Grafana Instances Controller**: ✅ Lines 81, 99, 124 have @AdminOnly() commented out
2. **Tracing Instances Controller**: ✅ Lines 89, 110, 133 need @AdminOnly() added (not present)
3. **Grafana Dashboards Controller**: ✅ Dashboard CRUD exists but sync is handled by background service. Recommend leaving open for now (Phase 2 decision)
4. **Pyroscope Instances Controller**: ✅ Already has @AdminOnly() on CREATE/UPDATE/DELETE (verified in plan research)

**Ready to Implement**: All controller details confirmed
