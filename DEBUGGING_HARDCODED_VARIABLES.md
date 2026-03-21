# Debugging Hardcoded Variables Display Issue

## Problem Statement
After updating, hardcoded variables (`setHardcodedValueForVariables`) are either not saving to the database or not displaying in the ProfileDashboardsTable component.

## Investigation Summary

### Files Analyzed

1. **Backend Service** (`/Users/daniel/workspace/perfana-next-gen/apps/api/src/modules/profiles/profiles.service.ts`)
   - Lines 130-208: `findDashboardsByProfileId` method
   - Lines 197-198: Returns `setHardcodedValueForVariables` directly from database
   - Lines 356-368: Special handling for empty arrays (converts to `null`)
   - Lines 387-396: Uses `update()` method to force TypeORM to detect JSONB changes

2. **Entity Definition** (`/Users/daniel/workspace/perfana-next-gen/packages/shared/src/entities/auto-config-grafana-dashboard.entity.ts`)
   - Line 38-39: JSONB column `set_hardcoded_value_for_variables` with type `DashboardVariable[]`
   - Column is nullable

3. **Frontend Table** (`/Users/daniel/workspace/perfana-next-gen/apps/web/app/settings/profiles/[id]/components/ProfileDashboardsTable.tsx`)
   - Lines 151-210: `renderHardcodedVariables` function
   - Correctly handles both `undefined` and empty arrays
   - Displays chips for each variable with name and values

4. **Form Dialog** (`/Users/daniel/workspace/perfana-next-gen/apps/web/app/settings/profiles/[id]/components/DashboardFormDialog.tsx`)
   - Lines 122-153: Initializes form state from existing dashboard data in edit mode
   - Lines 224-226: Filters out empty hardcoded variables before submission
   - Line 237: **Always sends empty array `[]` when no valid variables exist**
   - Line 245: Sends `validHardcodedVariables` or empty array

5. **TypeScript Interfaces** (`/Users/daniel/workspace/perfana-next-gen/apps/web/lib/profiles.ts`)
   - Line 38: `setHardcodedValueForVariables?: DashboardVariable[]`
   - Correctly defined as optional array

## Data Flow

```
User Edit → DashboardFormDialog (State) → handleSubmit (Filter) →
API Request (JSON) → Backend Service (Validation) →
Database (TypeORM update) → Response (JSON) →
ProfileDetailsPage (State) → ProfileDashboardsTable (Render)
```

## Hypothesis

The issue appears to be in the form submission logic. On line 237 of DashboardFormDialog.tsx:

```typescript
setHardcodedValueForVariables: validHardcodedVariables.length > 0 ? validHardcodedVariables : [],
```

This always sends an empty array `[]` when there are no valid hardcoded variables. The backend then converts this to `null` (lines 356-368 of profiles.service.ts):

```typescript
const newValue =
  Array.isArray(updateDto.setHardcodedValueForVariables) && updateDto.setHardcodedValueForVariables.length === 0
    ? null
    : updateDto.setHardcodedValueForVariables;
```

### Potential Issues:

1. **Empty array always sent**: Even when user doesn't modify hardcoded variables, empty array is sent, potentially clearing existing values
2. **Edit mode behavior**: In edit mode, if the form loads existing hardcoded variables but they become invalid during editing (e.g., user removes all values), they get cleared
3. **Backend response**: Backend might be returning `null` instead of empty array after update

## Debug Logging Added

Added console.log statements to track data flow:

1. **DashboardFormDialog.tsx** (lines 228-234, 250):
   - Logs before filtering: raw `hardcodedVariables` state
   - Logs after filtering: `validHardcodedVariables`
   - Logs final data being sent to API

2. **ProfileDetailsPage** (line 139):
   - Logs dashboard data received from API after fetch

3. **ProfileDashboardsTable.tsx** (line 152):
   - Logs variables prop received for each dashboard

## Testing Instructions

1. **Start the application**:
   ```bash
   cd /Users/daniel/workspace/perfana-next-gen
   npm run dev
   ```

2. **Open browser console** (Chrome DevTools, F12)

3. **Navigate to a profile with dashboards**:
   - Go to Settings → Profiles
   - Click on a profile to view details
   - Switch to Dashboards tab

4. **Test Scenario 1: View existing dashboards**
   - Check console for: `[ProfileDetailsPage] Loaded dashboards:`
   - Check console for: `[ProfileDashboardsTable] Rendering hardcoded variables:` (for each dashboard)
   - **Verify**: Are hardcoded variables showing in the response? Are they `null`, `[]`, or populated?

5. **Test Scenario 2: Edit dashboard with hardcoded variables**
   - Click "Edit" on a dashboard that should have hardcoded variables
   - Check if variables are loaded in the form
   - Click "Save Changes" without modifying
   - Check console for:
     - `[DashboardFormDialog] Submitting data:` (before filtering)
     - `[DashboardFormDialog] Final data being sent:` (after filtering)
     - `[ProfileDetailsPage] Loaded dashboards:` (after reload)
   - **Verify**: Are the variables being sent correctly? Are they preserved after save?

6. **Test Scenario 3: Add new hardcoded variables**
   - Click "Edit" on a dashboard
   - Click "Add Variable"
   - Set name: `testVar` and values: `value1`, `value2`
   - Click "Save Changes"
   - Check console logs
   - **Verify**: Do variables appear in the table after save?

7. **Test Scenario 4: Clear hardcoded variables**
   - Click "Edit" on a dashboard with hardcoded variables
   - Remove all variables (click X on each)
   - Click "Save Changes"
   - Check console logs
   - **Verify**: Does the table show "-" after clearing?

## Expected Console Output

### When viewing dashboards:
```
[ProfileDetailsPage] Loaded dashboards: [
  {
    "id": "...",
    "dashboardName": "...",
    "setHardcodedValueForVariables": [ /* should show array or null */ ],
    ...
  }
]
[ProfileDashboardsTable] Rendering hardcoded variables: [ /* or null */ ]
```

### When editing and saving:
```
[DashboardFormDialog] Submitting data: {
  mode: "edit",
  hardcodedVariables: [ /* raw state */ ],
  validHardcodedVariables: [ /* filtered */ ],
  ...
}
[DashboardFormDialog] Final data being sent: {
  "setHardcodedValueForVariables": [ /* empty or populated */ ],
  ...
}
```

## Next Steps

Based on the console logs, we will:

1. **If variables are in database but not displayed**:
   - Check if response has `null` instead of array
   - Check if table component is receiving correct props

2. **If variables are not being saved**:
   - Check if form is sending correct data structure
   - Check if backend is properly handling the update
   - Check database directly with SQL query

3. **If variables are being cleared unintentionally**:
   - Modify form logic to only send field when user explicitly changes it
   - Use `undefined` for unchanged fields instead of empty array

## Potential Fix

If the issue is that empty arrays are clearing existing data, the fix would be:

```typescript
// In DashboardFormDialog.tsx, line 237-245
const data: CreateProfileDashboardData | UpdateProfileDashboardData = {
  grafanaLabel,
  dashboardUid,
  createSeparateDashboardForVariable: createSeparateDashboardForVariable || undefined,
  // Only include fields that have changed or have valid values
  ...(validHardcodedVariables.length > 0 && { setHardcodedValueForVariables: validHardcodedVariables }),
  ...(Object.keys(matchRegexForVariables).length > 0 && { matchRegexForVariables }),
  readOnly,
};
```

This would ensure that if there are no valid hardcoded variables, the field is not sent at all (undefined), preventing unintentional clearing of existing values.

## Files Modified (with Debug Logging)

1. `/Users/daniel/workspace/perfana-next-gen/apps/web/app/settings/profiles/[id]/components/DashboardFormDialog.tsx`
2. `/Users/daniel/workspace/perfana-next-gen/apps/web/app/settings/profiles/[id]/page.tsx`
3. `/Users/daniel/workspace/perfana-next-gen/apps/web/app/settings/profiles/[id]/components/ProfileDashboardsTable.tsx`

**Note**: Remove these console.log statements after debugging is complete.
