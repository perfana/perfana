# Fix: Template Update HTTP Method Mismatch

## Issue

**Error**: `Cannot PATCH /api/report-templates/{templateId}`

**Cause**: The frontend was using `PATCH` method while the backend expects `PUT` method.

## Root Cause

HTTP method mismatch between frontend client and backend controller:

- **Backend** (`report-template.controller.ts`): Uses `@Put(':templateId')`
- **Frontend** (`reports.ts`): Was using `method: 'PATCH'`

## Solution

Changed the `updateTemplate()` function in the frontend to use `PUT` instead of `PATCH`.

### File Modified

**`apps/web/lib/api/reports.ts`** (line 817)

### Before
```typescript
export async function updateTemplate(
  templateId: string,
  request: UpdateTemplateRequest
): Promise<TemplateDetail> {
  const response = await authenticatedFetch(`report-templates/${templateId}`, {
    method: 'PATCH',  // ❌ Wrong - backend expects PUT
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
```

### After
```typescript
export async function updateTemplate(
  templateId: string,
  request: UpdateTemplateRequest
): Promise<TemplateDetail> {
  const response = await authenticatedFetch(`report-templates/${templateId}`, {
    method: 'PUT',  // ✅ Fixed - matches backend
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
```

## Verification

All other report template endpoints are correctly using `PUT`:
- ✅ `updateShareSettings()` - Uses PUT
- ✅ `setDefaultTemplate()` - Uses PUT
- ✅ `reorderTemplateSections()` - Uses PUT

Backend consistently uses `@Put` decorator for all update operations:
- ✅ `@Put(':templateId')` - Update template
- ✅ `@Put(':templateId/set-default')` - Set default
- ✅ `@Put(':templateId/sections/reorder')` - Reorder sections
- ✅ `@Put(':reportId/share')` - Update share settings

TypeScript compilation: ✅ Passes

## Testing

To verify the fix:

1. Navigate to **Systems → [System] → Config → Reporting Templates**
2. Click edit icon on an existing template
3. Make changes to name, description, or sections
4. Click **"Update"**
5. Verify template updates successfully without error
6. Check console - no "Cannot PATCH" error

## Note on HTTP Methods

### PUT vs PATCH

- **PUT**: Replace entire resource (backend expects this)
- **PATCH**: Partial update (not used in this API)

The backend uses `PUT` for all update operations, even partial updates, so all frontend calls must use `PUT` to match.
