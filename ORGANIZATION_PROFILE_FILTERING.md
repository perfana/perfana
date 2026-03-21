# Organization-Based Profile Filtering in Auto-Configuration

## Summary

Implemented organization-based filtering for profiles in the Grafana Sync auto-configuration service to ensure that auto-configuration only processes profiles that belong to the same organization as the test run.

## Changes Made

### 1. **MappedTestRun Interface** (`apps/grafana-sync/src/modules/auto-config/test-run-finder.service.ts`)
- Added `organizationId?: string` field to the `MappedTestRun` interface
- This allows test runs to carry organization context through the auto-config pipeline

### 2. **Test Run Mapping** (`apps/grafana-sync/src/modules/auto-config/test-run-finder.service.ts`)
- Updated `findRecentTestRuns()` to include `organizationId` when mapping test runs
- The organization ID is now passed along with other test run data

### 3. **Profile Filtering Logic** (`apps/grafana-sync/src/modules/auto-config/auto-config.service.ts`)
- Enhanced `processTestRun()` method to filter profiles by organization ID
- **Filtering Rules:**
  - If test run has an `organizationId`:
    - Include profiles with matching `organizationId`
    - Include profiles with `null` or `undefined` `organizationId` (backward compatibility)
    - Exclude profiles from different organizations
  - If test run has no `organizationId`:
    - Include all profiles (backward compatibility)
- Added logging to show organization context and matched profile count

### 4. **Test Coverage** (`apps/grafana-sync/src/modules/auto-config/auto-config.service.spec.ts`)
- Added test case: "should filter profiles by organization_id when test run has organizationId"
  - Verifies that only profiles in the same organization (or with null org) are processed
  - Confirms profiles from different organizations are excluded
- Added test case: "should include all profiles when test run has no organizationId"
  - Ensures backward compatibility for test runs without organization context
- Updated `mockTestRun` to include `organizationId: undefined` for backward compatibility

## Behavior

### Before
- Auto-configuration processed **all** profiles with matching tags, regardless of organization
- This could lead to cross-organization data leakage in multi-tenant environments

### After
- Auto-configuration respects organization boundaries
- Only profiles belonging to the test run's organization are considered
- Profiles with `null` organization are still accessible for backward compatibility
- Test runs without organization ID continue to work with all profiles (backward compatibility)

## Backward Compatibility

The implementation maintains full backward compatibility:
1. Test runs without `organizationId` can access all profiles
2. Profiles without `organizationId` are accessible to all organizations
3. Existing data and workflows continue to function unchanged

## Example

Given:
- Test Run A: `organizationId = "org-123"`, tags = `["profile-1"]`
- Profile 1: `organizationId = "org-123"`, tags = `["profile-1"]` ✅ **Matched**
- Profile 2: `organizationId = "org-456"`, tags = `["profile-1"]` ❌ **Excluded**
- Profile 3: `organizationId = null`, tags = `["profile-1"]` ✅ **Matched (backward compat)**

Result: Auto-configuration processes Profile 1 and Profile 3 for Test Run A.

## Related Files

- `apps/grafana-sync/src/modules/auto-config/test-run-finder.service.ts`
- `apps/grafana-sync/src/modules/auto-config/auto-config.service.ts`
- `apps/grafana-sync/src/modules/auto-config/auto-config.service.spec.ts`
- `packages/shared/src/entities/test-run.entity.ts` (already had `organizationId`)
- `packages/shared/src/entities/profile.entity.ts` (already had `organizationId`)

## Testing

Run the auto-config service tests:
```bash
cd apps/grafana-sync
npm test -- auto-config.service.spec.ts
```

All 19 tests pass, including the new organization filtering test cases.

## RBAC Context

This change is part of **RBAC Phase 3** - service-layer authorization enforcement. It ensures that the Grafana Sync service respects organization boundaries when automatically configuring dashboards and benchmarks for test runs.
