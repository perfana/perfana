# Autoconfiguration Organization Tracking

## Summary

Implemented organization inheritance for all records created by the Grafana Sync autoconfiguration service. All auto-created resources now inherit the `organization_id` from the test run that triggered them.

## Changes Made

### 1. **Application Dashboards** - Inherit Organization from Test Run

**File**: `apps/grafana-sync/src/modules/auto-config/auto-config-updates.service.ts`

- Added `organizationId?: string` to `ApplicationDashboardInsertData` interface
- Updated `insertApplicationDashboard` method to save `organization_id` field
- Organization is set from `testRun.organizationId`

**File**: `apps/grafana-sync/src/modules/auto-config/services/application-dashboard-creator.service.ts`

- Updated `createOneApplicationDashboard` to pass `organizationId: testRun.organizationId`
- Updated `createSeparateDashboardForValue` to pass `organizationId: testRun.organizationId`

### 2. **Benchmarks** - Inherit Organization from Test Run

**File**: `apps/grafana-sync/src/modules/auto-config/auto-config-updates.service.ts`

- Updated `insertBenchmarkBasedOnProfileBenchmark` method to include `organization_id` in benchmark data
- Organization is set from `testRun.organizationId`

## Data Flow

```
Test Run (has organization_id)
    ↓
Auto-configuration processes test run
    ↓
Creates Application Dashboards → organization_id = testRun.organizationId
    ↓
Creates Benchmarks → organization_id = testRun.organizationId
```

## Entities Affected

1. **application_dashboards** - Auto-created dashboards for test runs
2. **benchmarks** - Auto-created benchmarks from profile benchmarks

## Backward Compatibility

- `organization_id` field is **nullable** on all entities
- Resources created before this change have `NULL` organization_id
- Resources with `NULL` organization_id are accessible to all users (backward compatibility)
- Resources created after this change inherit the test run's organization

## Example

Given:
- Test Run A: `organization_id = "org-123"`
- Auto-config processes Test Run A

Results in:
- Application Dashboard created with `organization_id = "org-123"` ✅
- Benchmark created with `organization_id = "org-123"` ✅

These resources will only be accessible to users in organization "org-123" (or global admins).

## Benefits

1. **Multi-tenant isolation** - Auto-created resources respect organization boundaries
2. **Consistent RBAC** - All resources follow the same access control rules
3. **Audit trail** - Clear ownership and organization tracking
4. **Security** - Prevents cross-organization data access

## Related Changes

This change complements:
- Organization-based profile filtering (see `ORGANIZATION_PROFILE_FILTERING.md`)
- Test run organization filtering in the API
- System under test organization filtering

## Testing

To verify organization inheritance:

```sql
-- Check that application dashboards have organization_id
SELECT id, dashboard_label, organization_id
FROM application_dashboards
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- Check that benchmarks have organization_id
SELECT id, panel_title, organization_id
FROM benchmarks
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- Verify they match the test run's organization
SELECT
    tr.test_run_id,
    tr.organization_id as test_run_org,
    ad.dashboard_label,
    ad.organization_id as dashboard_org
FROM test_runs tr
LEFT JOIN application_dashboards ad ON ad.system_under_test_id = tr.system_under_test_id
    AND ad.test_environment = tr.test_environment
WHERE tr.created_at > NOW() - INTERVAL '1 hour'
    AND ad.organization_id IS NOT NULL;
```

## Files Modified

- `apps/grafana-sync/src/modules/auto-config/auto-config-updates.service.ts`
- `apps/grafana-sync/src/modules/auto-config/services/application-dashboard-creator.service.ts`

## RBAC Phase

This change is part of **RBAC Phase 3** - service-layer authorization and resource ownership tracking.
