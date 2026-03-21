# Fix: Template Selector Empty System ID

## Issue

When opening the report generator from a test run page, the template selector showed "No templates available" even though templates existed for that system/environment/workload.

**Console logs revealed:**
```
[GenerateReportDialog] Fetching templates with scope: {
  systemId: '',              ← Empty string!
  testEnvironment: 'acc',
  workload: 'loadTest'
}
[getTemplateSummaries] API response: []
```

## Root Cause

**File**: `apps/web/app/test-runs/[id]/page.tsx` (line 379)

The scope was using an incorrect fallback for systemId:

```typescript
scope={{
  systemId: testRun.system_under_test?.id || '',  // ❌ Falls back to empty string
  testEnvironment: testRun.test_environment || '',
  workload: testRun.workload || '',
}}
```

### Why This Failed

The `TestRun` type has two fields for the system:

1. **`system_under_test_id: string`** - Direct field, always present
2. **`system_under_test?: SystemUnderTest`** - Optional relation object (may not be loaded)

**Type definition** (`apps/web/types/test-runs.ts:88-124`):
```typescript
export interface TestRun {
  id: string;
  test_run_id: string;
  system_under_test_id: string;       // ← Direct field (always present)
  test_environment: string;
  workload: string;
  // ... other fields
  system_under_test?: SystemUnderTest; // ← Optional relation (may not load)
}
```

When the `system_under_test` relation is not loaded (which happens in some contexts):
- `testRun.system_under_test?.id` returns `undefined`
- Falls back to `''` (empty string)
- Backend searches for templates with `system_id = ''`
- No templates match, returns empty array

## Solution

Use the direct `system_under_test_id` field as fallback instead of empty string:

```typescript
scope={{
  systemId: testRun.system_under_test?.id || testRun.system_under_test_id,  // ✅ Falls back to direct field
  testEnvironment: testRun.test_environment || '',
  workload: testRun.workload || '',
}}
```

### Why This Works

- If the relation is loaded: Uses `testRun.system_under_test.id`
- If the relation is not loaded: Falls back to `testRun.system_under_test_id`
- System ID is always present (never empty string)
- Backend can find matching templates

## Testing

### Before Fix
```bash
# Console output
[GenerateReportDialog] Fetching templates with scope: {
  systemId: '',              # ❌ Empty
  testEnvironment: 'acc',
  workload: 'loadTest'
}
[getTemplateSummaries] API response: []

# Result: "No templates available"
```

### After Fix
```bash
# Console output
[GenerateReportDialog] Fetching templates with scope: {
  systemId: 'abc-123-def-456',  # ✅ Correct system ID
  testEnvironment: 'acc',
  workload: 'loadTest'
}
[getTemplateSummaries] API response: [
  { id: '...', name: 'Template 1', ... },
  { id: '...', name: 'Template 2', ... }
]

# Result: Templates appear in selector
```

## Verification Steps

1. Navigate to a test run page: `/test-runs/[id]`
2. Click **"Generate Report"** button
3. Check browser console for debug logs:
   - `systemId` should show a UUID, not empty string
   - API response should return templates (if any exist)
4. Verify template selector shows available templates
5. Can select and load a template

## Related Files

- **Fixed**: `apps/web/app/test-runs/[id]/page.tsx:379`
- **Type Definition**: `apps/web/types/test-runs.ts:88-124`
- **Debug Logs**: `apps/web/components/reports/report-generation/GenerateReportDialog.tsx:195-207`
- **API Function**: `apps/web/lib/api/reports.ts:757-778`

## Prevention

When working with test run data, always prefer direct fields over optional relations:

```typescript
// ❌ Avoid - relation may not be loaded
const systemId = testRun.system_under_test?.id || '';

// ✅ Prefer - direct field always present
const systemId = testRun.system_under_test?.id || testRun.system_under_test_id;

// ✅ Even better - direct field first
const systemId = testRun.system_under_test_id;
```

### Why Relations May Not Load

Relations are optional because:
- Performance optimization (avoid loading unnecessary data)
- Different API endpoints may include/exclude relations
- Real-time updates may not include full relation objects
- Pagination and filtering may exclude related data

Always check the type definition and use direct foreign key fields as fallbacks.

## Cleanup

After confirming templates load correctly, remove the debug console.log statements from:
- `apps/web/components/reports/report-generation/GenerateReportDialog.tsx`
- `apps/web/lib/api/reports.ts`

```bash
# Find and remove debug logs
grep -n "console.log.*\[GenerateReportDialog\]" apps/web/components/reports/report-generation/GenerateReportDialog.tsx
grep -n "console.log.*\[getTemplateSummaries\]" apps/web/lib/api/reports.ts
```
