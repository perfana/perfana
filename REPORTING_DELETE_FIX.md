# Fix: Delete Template/Report JSON Parsing Error

## Issue

**Error**: `Failed to execute 'json' on 'Response': Unexpected end of JSON input`

**Location**: `lib/api/reports.ts:844` (deleteTemplate function)

**Root Cause**: The DELETE endpoints for both templates and reports return HTTP 204 No Content with an empty body, but the client code was trying to parse the response as JSON.

## Backend Behavior

Both delete endpoints use `@HttpCode(HttpStatus.NO_CONTENT)`:

```typescript
// Report Template Delete
@Delete(':templateId')
@HttpCode(HttpStatus.NO_CONTENT)
async delete(@Param('templateId') templateId: string): Promise<void>

// Report Delete
@Delete(':reportId')
@HttpCode(HttpStatus.NO_CONTENT)
async delete(@Param('reportId') reportId: string): Promise<void>
```

HTTP 204 responses have no body by design, so attempting to parse JSON will fail.

## Solution

Updated both client functions to not parse JSON and return `void`:

### Before:
```typescript
export async function deleteTemplate(templateId: string): Promise<{ message: string }> {
  const response = await authenticatedFetch(`report-templates/${templateId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete template: ${response.statusText}`);
  }

  return response.json(); // ❌ Fails - no body to parse
}
```

### After:
```typescript
export async function deleteTemplate(templateId: string): Promise<void> {
  const response = await authenticatedFetch(`report-templates/${templateId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete template: ${response.statusText}`);
  }

  // DELETE returns 204 No Content with no body
  return; // ✅ Fixed
}
```

## Files Modified

1. **`apps/web/lib/api/reports.ts`**
   - Fixed `deleteTemplate()` function (line 835)
   - Fixed `deleteReport()` function (line 519)
   - Changed return type from `Promise<{ message: string }>` to `Promise<void>`
   - Removed `response.json()` calls

2. **`apps/web/__tests__/components/reporting/ReportCard.test.tsx`**
   - Updated test mocks to return `undefined` instead of `{ message: 'Deleted' }`
   - Fixed line 503 and 533

## Verification

All calling code was checked and confirmed to not depend on return values:

- ✅ `useReportingTemplateManagement.ts` - awaits without using return value
- ✅ `useReports.ts` - signature already expects `Promise<void>`
- ✅ `useTemplates.ts` - signature already expects `Promise<void>`
- ✅ `ReportCard.tsx` - awaits without using return value
- ✅ Tests updated to match new behavior

TypeScript compilation passes without errors.

## Testing

To verify the fix:

1. Navigate to Systems → [System] → Config → Reporting Templates
2. Create a template
3. Delete the template
4. Verify no console errors
5. Verify template is removed from the list

Similarly for reports:

1. Navigate to Test Runs → [Test Run]
2. Generate a report
3. Delete the report from the Reports card
4. Verify no console errors
5. Verify report is removed from the list
