# Template Selector Debug - "No templates available" Issue

## Issue

When opening the report generator from a test run page, the template selector shows:
> "No templates available for this system/environment/workload combination."

But templates do exist for that system/environment/workload in the database.

## Debugging Steps Added

### 1. Added Console Logging

Added debug logging in two places to help identify the issue:

#### GenerateReportDialog Component
**File**: `apps/web/components/reports/report-generation/GenerateReportDialog.tsx` (line ~195)

Added logging to see:
- What scope values are being passed when fetching templates
- What templates are returned from the API
- Any errors during the fetch

```typescript
console.log('[GenerateReportDialog] Fetching templates with scope:', {
  systemId: scope.systemId,
  testEnvironment: scope.testEnvironment,
  workload: scope.workload,
});

const summaries = await getTemplateSummaries(...);

console.log('[GenerateReportDialog] Fetched templates:', summaries);
```

#### API Function
**File**: `apps/web/lib/api/reports.ts` (line ~757)

Added logging to see:
- Exact API URL being called
- Query parameters being sent
- API response data

```typescript
console.log('[getTemplateSummaries] Calling API with:', {
  systemId,
  testEnvironment,
  workload,
  url,
});

const data = await response.json();
console.log('[getTemplateSummaries] API response:', data);
```

## How to Debug

### Step 1: Open Browser DevTools
1. Open browser DevTools (F12 or Cmd+Option+I)
2. Go to the **Console** tab
3. Clear the console

### Step 2: Reproduce the Issue
1. Navigate to a test run page (e.g., `/test-runs/[id]`)
2. Click **"Generate Report"** button
3. Watch the console output

### Step 3: Analyze the Logs

You should see console logs like:

```
[GenerateReportDialog] Fetching templates with scope: {
  systemId: "abc123",
  testEnvironment: "test",
  workload: "load-test"
}

[getTemplateSummaries] Calling API with: {
  systemId: "abc123",
  testEnvironment: "test",
  workload: "load-test",
  url: "report-templates/summaries?system_id=abc123&test_environment=test&workload=load-test"
}

[getTemplateSummaries] API response: []
```

### Step 4: Compare with Template Database Values

#### Check Template Values in System Config
1. Go to **Systems → [System Name] → Config → Reporting Templates**
2. Note the templates shown in the table
3. Check the URL - it should show the current environment and workload

#### Check Test Run Values
1. Go to the test run page where you're trying to generate a report
2. Check the test run details:
   - **System Under Test**: Should match the system in the config page
   - **Test Environment**: Should match what's in the template selector
   - **Workload**: Should match what's in the template selector

## Root Cause Identified

### Backend Uses Exact Equality Matching

**File**: `apps/api/src/modules/reports/services/report-template.service.ts` (line ~288)

The backend query uses exact equality on all three scope fields:

```typescript
async findByScope(systemId, testEnvironment, workload) {
  return await this.templateRepo.find({
    where: {
      system_id: systemId,           // EXACT match
      test_environment: testEnvironment,  // EXACT match (case-sensitive)
      workload: workload,                 // EXACT match (case-sensitive)
    },
    order: { is_default: 'DESC', name: 'ASC' },
  });
}
```

**This means**:
- ❌ Case sensitivity matters: "test" ≠ "Test" ≠ "TEST"
- ❌ Whitespace matters: "load-test" ≠ "load-test " ≠ " load-test"
- ❌ No fuzzy matching: "production" ≠ "prod"
- ✅ Must match EXACTLY: All three fields must be identical

## Possible Root Causes

### 1. **Case Sensitivity Mismatch** (Most Likely)
**Symptom**: Templates exist but API returns empty array

**Examples**:
- Template: `test_environment: "test"`, Test Run: `test_environment: "Test"`
- Template: `workload: "load-test"`, Test Run: `workload: "Load-Test"`
- Template: `workload: "loadTest"`, Test Run: `workload: "load-test"`

**Solution**: Ensure consistent casing across all test runs and templates

### 2. **Whitespace or Special Characters**
**Symptom**: Values look the same but don't match

**Examples**:
- Template: `workload: "load-test"`, Test Run: `workload: "load-test "` (trailing space)
- Template: `test_environment: "test"`, Test Run: `test_environment: " test"` (leading space)
- Template: `workload: "load–test"` (en-dash), Test Run: `workload: "load-test"` (hyphen)

**Solution**: Trim whitespace and normalize special characters

### 3. **Different System ID**
**Symptom**: Templates exist but for a different system

**Examples**:
- Template created for System A (UUID: `abc-123`)
- Test run belongs to System B (UUID: `def-456`)
- User expects templates to be shared across systems

**Solution**: Check system_id matches between template and test run

### 4. **Empty or Undefined Scope Values**
**Symptom**: API call with empty strings or undefined

**Causes**:
- Test run missing `test_environment` or `workload` field
- System under test relation not loaded properly
- Scope values are `null` or `undefined` instead of empty string

**Solution**: Check if scope values in console logs show empty strings or undefined

## How to Debug in Database

### Check What Templates Exist

```sql
-- List all templates with their scope values
SELECT
  id,
  name,
  system_id,
  test_environment,
  workload,
  is_default,
  created_at
FROM report_templates
ORDER BY created_at DESC;

-- Check templates for a specific system
SELECT
  id,
  name,
  test_environment,
  workload,
  LENGTH(test_environment) as env_length,
  LENGTH(workload) as workload_length
FROM report_templates
WHERE system_id = 'your-system-id'
ORDER BY name;
```

### Check Test Run Values

```sql
-- Get test run scope values
SELECT
  tr.id,
  tr.test_run_id,
  tr.test_environment,
  tr.workload,
  sys.id as system_id,
  sys.name as system_name,
  LENGTH(tr.test_environment) as env_length,
  LENGTH(tr.workload) as workload_length
FROM test_runs tr
LEFT JOIN systems sys ON tr.system_under_test_id = sys.id
WHERE tr.id = 'your-test-run-uuid'
   OR tr.test_run_id = 'your-test-run-id';
```

### Find Mismatches

```sql
-- Find templates that almost match (different case or whitespace)
SELECT
  t.id,
  t.name,
  t.test_environment as template_env,
  tr.test_environment as testrun_env,
  t.workload as template_workload,
  tr.workload as testrun_workload,
  CASE
    WHEN LOWER(TRIM(t.test_environment)) = LOWER(TRIM(tr.test_environment))
    THEN 'Match (case/whitespace issue)'
    ELSE 'Different value'
  END as env_status,
  CASE
    WHEN LOWER(TRIM(t.workload)) = LOWER(TRIM(tr.workload))
    THEN 'Match (case/whitespace issue)'
    ELSE 'Different value'
  END as workload_status
FROM report_templates t
CROSS JOIN test_runs tr
WHERE t.system_id = tr.system_under_test_id
  AND tr.id = 'your-test-run-uuid';
```

## How to Fix

### Fix 1: Normalize Case and Whitespace (Recommended)

**Update templates to match test run values**:
```sql
-- First, check what needs updating
SELECT id, name, test_environment, workload
FROM report_templates
WHERE system_id = 'your-system-id';

-- Then update to normalized values (lowercase, trimmed)
UPDATE report_templates
SET
  test_environment = LOWER(TRIM(test_environment)),
  workload = LOWER(TRIM(workload))
WHERE system_id = 'your-system-id';
```

**Update test runs to match template values**:
```sql
-- First, check what needs updating
SELECT id, test_run_id, test_environment, workload
FROM test_runs
WHERE system_under_test_id = 'your-system-id';

-- Then update to match template format
UPDATE test_runs
SET
  test_environment = 'test',  -- Match template exactly
  workload = 'load-test'      -- Match template exactly
WHERE system_under_test_id = 'your-system-id';
```

### Fix 2: Update Backend for Case-Insensitive Matching

**File**: `apps/api/src/modules/reports/services/report-template.service.ts`

```typescript
async findByScope(
  systemId: string,
  testEnvironment: string,
  workload: string,
): Promise<ReportTemplate[]> {
  try {
    // Use case-insensitive matching with trimming
    return await this.templateRepo
      .createQueryBuilder('template')
      .where('template.system_id = :systemId', { systemId })
      .andWhere('LOWER(TRIM(template.test_environment)) = LOWER(TRIM(:testEnvironment))', {
        testEnvironment
      })
      .andWhere('LOWER(TRIM(template.workload)) = LOWER(TRIM(:workload))', {
        workload
      })
      .orderBy('template.is_default', 'DESC')
      .addOrderBy('template.name', 'ASC')
      .getMany();
  } catch (error) {
    this.logger.error(`Failed to find templates by scope: ${(error as Error).message}`);
    throw new DatabaseException('Failed to find templates by scope', error);
  }
}
```

### Fix 3: Add Frontend Validation and Normalization

**File**: `apps/web/components/reports/report-generation/GenerateReportDialog.tsx`

```typescript
// Normalize scope values before API call
const normalizedScope = {
  systemId: scope.systemId.trim(),
  testEnvironment: scope.testEnvironment.trim().toLowerCase(),
  workload: scope.workload.trim().toLowerCase(),
};

const summaries = await getTemplateSummaries(
  normalizedScope.systemId,
  normalizedScope.testEnvironment,
  normalizedScope.workload
);
```

### If Scope Values Are Empty

**Fix**: Ensure test run has all required fields set

**Frontend**: Add validation in report generator dialog
```typescript
if (!scope.systemId || !scope.testEnvironment || !scope.workload) {
  setError('Test run is missing required fields for template matching');
  return;
}
```

### If Backend Filters Too Strictly

**Fix**: Update backend query to be more lenient or add fallback logic

## Testing After Fix

1. Create a test template in **Systems → Config → Reporting Templates**
2. Note the exact environment and workload values used
3. Create or update a test run with matching values
4. Open report generator from test run page
5. Verify templates appear in selector
6. Check console logs to confirm scope values match

## Next Steps

1. **Check the console logs** to see what scope values are being used
2. **Compare with database** to see what templates actually exist
3. **Identify the mismatch** between expected and actual values
4. **Apply the appropriate fix** from the options above
5. **Remove console.log statements** after debugging is complete

## Cleanup

After identifying and fixing the issue, remove the debug logging:

```bash
# Search for debug logs to remove
grep -r "console.log\('\[GenerateReportDialog\]" apps/web/
grep -r "console.log\('\[getTemplateSummaries\]" apps/web/
```

Remove the `console.log` and `console.error` statements from:
- `apps/web/components/reports/report-generation/GenerateReportDialog.tsx`
- `apps/web/lib/api/reports.ts`
