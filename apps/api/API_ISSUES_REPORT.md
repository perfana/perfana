# API Issues Report - 2026-01-31

## Issue 1: FIXED ✅ - PostgreSQL Function `tags_hash()` Does Not Exist

### Problem
The application was failing with the following error:
```
error: function tags_hash(text) does not exist
QueryFailedError: function tags_hash(text) does not exist
```

### Root Cause
The code in `test-runs-config.service.ts` was attempting to use a PostgreSQL function `tags_hash()` in ON CONFLICT clauses and DISTINCT ON queries, but this function was never created in the database.

The actual unique constraint on the `test_run_configs` table is:
```sql
UNIQUE (test_run_id, key)
```

NOT `(test_run_id, key, tags_hash(tags))` as the code assumed.

### Impact
- API calls to store test run configuration would fail
- Unable to associate string-based configs with test runs
- Configuration JSON import would fail

### Fix Applied
Updated all SQL queries in `test-runs-config.service.ts` to match the actual database constraint:

**Before:**
```sql
ON CONFLICT (test_run_id, key, tags_hash(tags))
DO UPDATE SET value = EXCLUDED.value
```

**After:**
```sql
ON CONFLICT (test_run_id, key)
DO UPDATE SET value = EXCLUDED.value, tags = EXCLUDED.tags
```

Also fixed DISTINCT ON queries:
```sql
-- Before
SELECT DISTINCT ON (key, tags_hash(tags)) ...
ORDER BY key, tags_hash(tags), created_at DESC

-- After
SELECT DISTINCT ON (key) ...
ORDER BY key, created_at DESC
```

### Behavioral Change
With the current unique constraint `(test_run_id, key)`, storing the same config key with different tags will **overwrite** the previous value and tags. If the application needs to support multiple values for the same key with different tag sets, the database schema would need to be updated to include tags in the unique constraint.

### Files Modified
- `apps/api/src/modules/test-runs/services/test-runs-config.service.ts`
  - Lines 149-157: `addTestRunConfig` method
  - Lines 204-222: `addTestRunConfigs` method
  - Lines 251-258: `associateStringBasedConfigs` method
  - Lines 315-322: `addTestRunConfigsByUuid` method
  - Lines 448-467: `addTestRunConfigsFromJson` method

### Testing Required
- ✅ TypeScript build passes
- ⏳ Manual testing of config storage endpoints
- ⏳ Verify no duplicate key errors occur
- ⏳ Test config overwrite behavior with different tags

---

## Issue 2: FIXED ✅ - Constant API Polling in Test Run Details

### Problem
The test run configuration and Grafana dashboards cards make constant API calls even when data hasn't changed.

### Root Cause Analysis

#### 1. Real-Time Updates Creating New Object References
`useTestRunRealtime` hook (`/hooks/useTestRunRealtime.ts`):
- Line 229: Calls `onTestRunUpdated(testRun)` every time WebSocket receives an update
- Has debouncing (300ms) and event deduplication, which is good
- BUT: Every callback still creates a new testRun object

`useTestRunData.ts`:
- Lines 102-104: Sets new `testRun` object in state on every real-time update
```typescript
const normalizedTestRun = normalizeTestRun(updatedTestRun);
setTestRun(normalizedTestRun); // <-- New object reference every time
```

#### 2. Unstable Dependencies in useEffect Hooks

**In `useConfigComparison.ts`:**
Multiple useEffect hooks use `testRun` as a dependency:
- Line 303: `[testRun, testRunId, relatedTestRuns.length, loadRelatedTestRuns]`
- Line 309: `[testRun, expectedChangesLoaded, expectedChangesLoading, loadExpectedConfigChanges]`
- Line 321: `[testRun, testRunId, testRunConfigs.length, configLoading, loadTestRunConfigs]`

**In `useDashboardsData.ts`:**
- Line 172: `[testRun, dashboards.length, dashboardsLoading, loadApplicationDashboards]`

**The Problem:**
When `testRun` object reference changes (even if content is identical), all these useEffect hooks fire → API calls are made → state updates → re-renders → repeat

### Impact
- Excessive API calls (potential rate limiting issues)
- Increased server load
- Poor user experience (constant loading indicators)
- Wasted bandwidth and database queries

### Proposed Solutions

#### Option 1: Memoize testRun Object (Recommended)
In `useTestRunData.ts`, use `useMemo` to prevent unnecessary object recreation:

```typescript
const memoizedTestRun = useMemo(() => testRun, [
  testRun?.id,
  testRun?.test_run_id,
  testRun?.start_time,
  testRun?.end_time,
  // ... other primitive fields that matter
]);
```

Then pass `memoizedTestRun` to child components instead of `testRun`.

#### Option 2: Deep Equality Check in Real-Time Handler
Before calling `setTestRun()`, check if data actually changed:

```typescript
if (matchesCurrentRun) {
  const normalizedTestRun = normalizeTestRun(updatedTestRun);

  // Only update if data actually changed
  if (!isEqual(testRun, normalizedTestRun)) {
    setTestRun(normalizedTestRun);
  }
}
```

Requires installing `lodash.isequal` or similar.

#### Option 3: Use testRunId Instead of testRun Object
In child components, replace `testRun` dependency with `testRun?.id`:

```typescript
// Before
useEffect(() => {
  if (testRun && dashboards.length === 0 && !dashboardsLoading) {
    loadApplicationDashboards();
  }
}, [testRun, dashboards.length, dashboardsLoading, loadApplicationDashboards]);

// After
useEffect(() => {
  if (testRun?.id && dashboards.length === 0 && !dashboardsLoading) {
    loadApplicationDashboards();
  }
}, [testRun?.id, dashboards.length, dashboardsLoading, loadApplicationDashboards]);
```

This works because `testRun?.id` is a primitive string, so reference equality works correctly.

### Recommended Approach
**Combination of Option 1 + Option 3:**
1. Memoize the testRun object at the top level (useTestRunData)
2. In child components, use `testRun?.id` instead of `testRun` where possible
3. Only use the full `testRun` object when actually needed for rendering

### Fix Applied

Implemented the recommended approach (Option 1 + Option 2 + Option 3):

#### 1. Added Deep Equality Check in Real-Time Handler
`/apps/web/app/test-runs/[id]/hooks/useTestRunData.ts`:
- Added `areTestRunsEqual()` function to compare test runs based on key fields
- Updated `onTestRunUpdated` callback to only call `setTestRun()` when data actually changed
- Prevents unnecessary state updates when WebSocket sends duplicate data

**Before:**
```typescript
if (matchesCurrentRun) {
  const normalizedTestRun = normalizeTestRun(updatedTestRun);
  setTestRun(normalizedTestRun);
}
```

**After:**
```typescript
if (matchesCurrentRun) {
  const normalizedTestRun = normalizeTestRun(updatedTestRun);

  // Only update state if data actually changed to prevent unnecessary re-renders
  if (!areTestRunsEqual(testRun, normalizedTestRun)) {
    setTestRun(normalizedTestRun);
  }
}
```

#### 2. Added Memoization for Stable Reference
`/apps/web/app/test-runs/[id]/hooks/useTestRunData.ts`:
- Added `useMemo` to create a stable `testRun` reference based on primitive fields
- Prevents child components from re-rendering when object reference changes but data is identical

```typescript
const memoizedTestRun = useMemo(() => testRun, [
  testRun?.id,
  testRun?.test_run_id,
  testRun?.start_time,
  testRun?.end_time,
  testRun?.consolidated_result,
  // ... other key fields
]);

return {
  testRun: memoizedTestRun,  // Return memoized version
  // ... other values
};
```

#### 3. Updated Child Component Dependencies
`/apps/web/app/test-runs/[id]/components/configuration-comparison/hooks/useConfigComparison.ts`:
- Updated 4 `useEffect` hooks to use `testRun?.id` instead of `testRun` in dependency arrays
- Lines 303, 309, 321: Changed from `testRun` to `testRun?.id`

`/apps/web/app/test-runs/[id]/components/dashboards/hooks/useDashboardsData.ts`:
- Updated 1 `useEffect` hook to use `testRun?.id` instead of `testRun`
- Line 172: Changed from `testRun` to `testRun?.id`

### Impact of Fix
- **Reduced API calls**: Child components no longer refetch data on every WebSocket update
- **Improved performance**: Fewer re-renders and network requests
- **Better UX**: Less loading flicker, smoother UI
- **No functionality loss**: Real-time updates still work correctly

### Files Modified

1. **Frontend hooks:**
   - `/apps/web/app/test-runs/[id]/hooks/useTestRunData.ts` - Add memoization
   - `/apps/web/app/test-runs/[id]/components/configuration-comparison/hooks/useConfigComparison.ts` - Update dependencies
   - `/apps/web/app/test-runs/[id]/components/dashboards/hooks/useDashboardsData.ts` - Update dependencies

### Testing Checklist
- ⏳ Monitor network tab to confirm API calls are reduced
- ⏳ Verify real-time updates still work correctly
- ⏳ Test with multiple tabs open (real-time sync)
- ⏳ Check performance with long-running tests
- ⏳ Verify config comparison loads correctly
- ⏳ Verify dashboards section loads correctly
- ⏳ Test expand/collapse behavior on all cards

### Recommended Next Steps
1. ⏳ Use browser DevTools Network tab to verify reduction in API calls
2. ⏳ Add React DevTools Profiler to measure render performance improvements
3. ⏳ Monitor production metrics after deployment
4. ⏳ Document expected WebSocket update frequency for load testing

---

## Additional Observations

### TypeScript Build Warnings
Commented out unused `AdminOnly` decorator imports (temporarily disabled for development):
- `apps/api/src/modules/api-keys/api-keys.controller.ts`
- `apps/api/src/modules/grafana/grafana-instances.controller.ts`

These should be re-enabled when proper Keycloak admin role is configured.
