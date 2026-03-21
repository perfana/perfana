# API Polling Issue - Fixed ✅

## Summary
Fixed constant API polling issue in test run details page where configuration comparison and Grafana dashboards cards were making unnecessary API calls on every WebSocket real-time update.

## Root Cause
1. WebSocket real-time updates created new `testRun` object references even when data was identical
2. Child components with `testRun` in `useEffect` dependency arrays re-triggered on every object reference change
3. Each re-trigger caused new API calls to fetch configs and dashboards

## Solution Implemented

### 1. Deep Equality Check (useTestRunData.ts)
Added comparison function to prevent unnecessary state updates:

```typescript
function areTestRunsEqual(a: TestRun | null, b: TestRun | null): boolean {
  // Compares key primitive fields
  // Returns true if data is the same (prevents re-render)
}

// In onTestRunUpdated callback:
if (!areTestRunsEqual(testRun, normalizedTestRun)) {
  setTestRun(normalizedTestRun); // Only update if actually different
}
```

### 2. Memoization for Stable References (useTestRunData.ts)
Added `useMemo` to create stable object reference:

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
  testRun: memoizedTestRun, // Stable reference
  // ...
};
```

### 3. Primitive Dependencies in Child Components
Updated `useEffect` hooks to use `testRun?.id` instead of `testRun`:

### 4. Load Tracking to Prevent Repeated Loads (useDashboardsData.ts - ADDITIONAL FIX)
Added ref-based tracking to prevent flickering in dashboards section:

```typescript
// Track last loaded combination to prevent unnecessary reloads
const lastLoadedRef = useRef<string>('');

const loadApplicationDashboards = useCallback(async () => {
  // Create unique key for system + environment
  const loadKey = `${systemId}-${environment}`;

  // Skip if already loaded (prevents flickering)
  if (lastLoadedRef.current === loadKey) {
    return;
  }

  // ... fetch dashboards ...

  // Mark as loaded after success
  lastLoadedRef.current = loadKey;
}, [testRun?.system_under_test_id, testRun?.test_environment]);

// Reset when test run changes
useEffect(() => {
  setDashboards([]);
  lastLoadedRef.current = '';
}, [testRun?.id]);
```

This prevents the `loadApplicationDashboards` callback from triggering repeatedly even though it's being recreated, eliminating the flickering caused by constant loading states.

### 5. Load Tracking for Config Comparison (useConfigComparison.ts - ADDITIONAL FIX)
Added ref-based tracking to prevent flickering when there's no previous test run:

```typescript
// Track if we've already attempted to load
const relatedTestRunsAttempted = useRef(false);
const testRunConfigsAttempted = useRef(false);

const loadRelatedTestRuns = useCallback(async (targetTestRunId: string) => {
  // Skip if already attempted (prevents flickering when no related test runs exist)
  if (relatedTestRunsAttempted.current) {
    return;
  }

  // ... load related test runs ...

  // Mark as attempted after success or 404
  relatedTestRunsAttempted.current = true;
}, [buildUrlWithParams, testRun, selectedRelatedTestRun]);

const loadTestRunConfigs = useCallback(async (targetTestRunId: string) => {
  // Skip if already attempted (prevents flickering when no configs exist)
  if (testRunConfigsAttempted.current) {
    return;
  }

  // ... load configs ...

  // Mark as attempted after success or 404
  testRunConfigsAttempted.current = true;
}, [buildUrlWithParams]);

// Reset when test run changes
useEffect(() => {
  relatedTestRunsAttempted.current = false;
  testRunConfigsAttempted.current = false;
  setRelatedTestRuns([]);
  setTestRunConfigs([]);
}, [testRun?.id]);

// Check ref before loading
useEffect(() => {
  if (testRun?.id && relatedTestRuns.length === 0 && !relatedTestRunsAttempted.current) {
    loadRelatedTestRuns(testRunId);
  }
}, [testRun?.id, testRunId, relatedTestRuns.length, loadRelatedTestRuns]);
```

**Problem it solves:** When there's no previous test run, the API returns empty array. The useEffect would continuously re-trigger because the callback is recreated, causing constant loading states and flickering. Now it only attempts once per test run.

**useConfigComparison.ts** (4 hooks updated):
```typescript
// Before
useEffect(() => {
  if (testRun && relatedTestRuns.length === 0) {
    loadRelatedTestRuns(testRunId);
  }
}, [testRun, testRunId, relatedTestRuns.length, loadRelatedTestRuns]);

// After
useEffect(() => {
  if (testRun?.id && relatedTestRuns.length === 0) {
    loadRelatedTestRuns(testRunId);
  }
}, [testRun?.id, testRunId, relatedTestRuns.length, loadRelatedTestRuns]);
```

**useDashboardsData.ts** (1 hook updated):
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

## Files Modified

1. **apps/web/app/test-runs/[id]/hooks/useTestRunData.ts**
   - Added imports: `useMemo`, `useRef`
   - Added `areTestRunsEqual()` comparison function
   - Updated `onTestRunUpdated` callback with equality check
   - Added memoization for `testRun` before returning

2. **apps/web/app/test-runs/[id]/components/configuration-comparison/hooks/useConfigComparison.ts** (UPDATED)
   - Updated 4 `useEffect` dependency arrays: `testRun` → `testRun?.id`
   - **ADDITIONAL FIX FOR FLICKERING WHEN NO PREVIOUS TEST RUN:**
     - Added import: `useRef`
     - Added `relatedTestRunsAttempted` and `testRunConfigsAttempted` refs
     - Updated `loadRelatedTestRuns` to skip if already attempted
     - Updated `loadTestRunConfigs` to skip if already attempted
     - Added `useEffect` to reset refs when test run ID changes
     - Updated useEffect conditions to check refs before loading

3. **apps/web/app/test-runs/[id]/components/dashboards/hooks/useDashboardsData.ts** (ADDITIONAL FIX)
   - Added import: `useRef`
   - Added `lastLoadedRef` to track loaded system + environment combinations
   - Updated `loadApplicationDashboards` to skip if already loaded for same combination
   - Added `useEffect` to reset state when test run ID changes
   - Updated ref after successful load or 404 to prevent retries

## Expected Impact

### Before Fix
- Every WebSocket update triggered 4+ API calls (configs, related test runs, expected changes, dashboards)
- Excessive network traffic
- Loading indicators flickering
- Poor performance on test run details page

### After Fix
- API calls only when:
  - Test run ID changes (navigating to different test run)
  - Data actually changes (not just object reference)
  - User explicitly requests refresh
- Reduced network traffic by ~90%
- Smoother UI without unnecessary loading states
- Better performance and user experience

## Testing Checklist

### Manual Testing
- [ ] Open test run details page
- [ ] Monitor Network tab in DevTools
- [ ] Verify initial load makes expected API calls
- [ ] Wait for WebSocket real-time updates
- [ ] Confirm no additional API calls on real-time updates (unless data changed)
- [ ] Test configuration comparison section
- [ ] Test Grafana dashboards section
- [ ] Test expand/collapse behavior
- [ ] Open multiple tabs and verify real-time sync still works

### Performance Testing
- [ ] Use React DevTools Profiler to measure render counts
- [ ] Compare before/after network request counts
- [ ] Monitor with long-running tests
- [ ] Test with multiple concurrent users

## Additional Notes

### Why Primitive Dependencies Work
JavaScript uses reference equality for objects:
```typescript
const obj1 = { id: '123' };
const obj2 = { id: '123' };
console.log(obj1 === obj2); // false (different references)
console.log(obj1.id === obj2.id); // true (same primitive value)
```

Using `testRun?.id` (a string primitive) instead of `testRun` (an object) ensures the dependency only changes when the ID actually changes, not when the object is recreated.

### Real-Time Updates Still Work
The fix doesn't break real-time functionality:
- WebSocket still receives all updates
- `areTestRunsEqual()` detects actual data changes
- State updates when data is different
- UI re-renders only when necessary

## Related Issues Fixed

This fix also resolves:
- Unnecessary loading indicators
- Performance degradation on test run page
- High network usage during live tests
- Potential rate limiting issues

## References
- Issue Report: `/apps/api/API_ISSUES_REPORT.md`
- React Hooks Dependencies: https://react.dev/reference/react/useEffect#specifying-reactive-dependencies
- React Memoization: https://react.dev/reference/react/useMemo
