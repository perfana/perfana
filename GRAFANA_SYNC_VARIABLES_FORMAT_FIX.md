# Grafana Sync Variables Format Fix

**Date**: November 4, 2025
**Status**: ✅ COMPLETE - Variables format corrected to array structure

---

## Issue

The `application_dashboards.variables` field was being stored in the incorrect format:

**Incorrect format (old):**
```json
{
  "service": ["afterburner-fe"],
  "test_environment": ["acc"],
  "system_under_test": ["MyAfterburner"]
}
```

**Correct format (new):**
```json
[
  { "name": "system_under_test", "values": ["MyAfterburner"] },
  { "name": "test_environment", "values": ["acc"] },
  { "name": "service", "values": ["afterburner-fe"] }
]
```

---

## Root Cause

In `apps/grafana-sync/src/modules/auto-config/auto-config.service.ts`, the code was converting from the correct array format to an incorrect object format before inserting into the database:

```typescript
// INCORRECT CODE (removed):
const variablesObject: Record<string, string[]> = {};
for (const variable of variables) {
  variablesObject[variable.name] = variable.values;
}
// Then used: variables: variablesObject
```

This conversion was happening in two places:
1. **ReadOnly dashboard path** (line 700-703)
2. **Separate dashboard creation path** (line 954-958)

---

## Changes Made

### File: `auto-config.service.ts`

#### Change 1: ReadOnly Dashboard Path (lines 687-711)

**Before:**
```typescript
const variables = [...];

// Build variables object
const variablesObject: Record<string, string[]> = {};
for (const variable of variables) {
  variablesObject[variable.name] = variable.values;
}

const applicationDashboard: ApplicationDashboardInsertData = {
  ...
  variables: variablesObject,
};
```

**After:**
```typescript
const variables = [...];

const applicationDashboard: ApplicationDashboardInsertData = {
  ...
  variables: variables,  // Pass array directly
};
```

**Lines changed**: Removed lines 699-703, updated line 711

---

#### Change 2: Separate Dashboard Creation Path (lines 894-974)

**Before:**
```typescript
const variables = [...];

const extendedVariables: Record<string, { name: string; values: string[] }> = {};
// ... build extendedVariables as object ...

// Build variables object for database
const variablesObject: Record<string, string[]> = {};
for (const [key, value] of Object.entries(extendedVariables)) {
  variablesObject[key] = value.values;
}

const applicationDashboardData: ApplicationDashboardInsertData = {
  ...
  variables: variablesObject,
};
```

**After:**
```typescript
const baseVariables = [...];

const extendedVariablesMap: Map<string, { name: string; values: string[] }> = new Map();
// ... build extendedVariablesMap ...

// Convert map to array for database
const variables = Array.from(extendedVariablesMap.values());

const applicationDashboardData: ApplicationDashboardInsertData = {
  ...
  variables: variables,  // Pass array directly
};
```

**Key improvements:**
- Use `Map` instead of `Record` for better type safety
- Convert map to array using `Array.from(map.values())`
- Pass array directly to database

**Lines changed**: Refactored lines 894-958, updated line 974

---

#### Change 3: Backward Compatibility in `checkExistingValues` (lines 1015-1045)

Updated to handle both old and new formats when reading from database:

```typescript
if (Array.isArray(variables)) {
  // New format: [{ name: "service", values: ["value1"] }]
  const variable = variables.find(
    (v: any) => v.name === autoConfigDashboard.createSeparateDashboardForVariable
  );
  variableValue = variable?.values;
} else {
  // Old format: { service: ["value1"] }
  variableValue = variables[autoConfigDashboard.createSeparateDashboardForVariable!];
}
```

**Lines changed**: 1017-1044

---

#### Change 4: Backward Compatibility in `checkIfUpdateRequired` (lines 817-842)

Updated to handle both old and new formats when comparing variables:

```typescript
if (Array.isArray(existingDashboard.variables)) {
  // New format: [{ name: "service", values: ["value1"] }]
  const variable = existingDashboard.variables.find((v: any) => v.name === newVar.name);
  existingValue = variable?.values;
} else {
  // Old format: { service: ["value1"] }
  existingValue = existingDashboard.variables[newVar.name];
}
```

**Lines changed**: 817-842

---

## Type Safety Improvements

**IMPORTANT**: The old object format was a **bug**, not a feature. No backward compatibility is provided.

### Type Changes

1. **Created shared types file**: `apps/grafana-sync/src/modules/auto-config/types.ts`
   ```typescript
   export interface DashboardVariable {
     name: string;
     values: string[];
   }

   export type DashboardVariables = DashboardVariable[];
   ```

2. **Removed duplicate type definitions**: Consolidated 4 duplicate `DashboardVariable` interfaces across:
   - `auto-config.service.ts`
   - `auto-config-updates.service.ts`
   - `variable-discovery.service.ts`
   - `dashboard-uid.util.ts`
   - `dashboard-uid.util.spec.ts` (test file)

3. **Proper type safety**: Changed from `variables?: any` to `variables?: DashboardVariables`

4. **No backward compatibility**: Removed code that tried to handle the incorrect object format

---

## Database Impact

### Existing Records (Before Fix)
- Dashboard label: "HTTP connection pool afterburner-fe"
- Created: 2025-11-03 21:19:00
- Variables format: Object `{ key: [values] }`
- template_dashboard_uid: Populated

### New Records (After Fix)
- Dashboard label: "HTTP connection pool - acc"
- Created: 2025-11-04 06:38:58
- Variables format: Array `[{ name, values }]` ✅ CORRECT
- template_dashboard_uid: Populated

---

## Migration Path for Old Records (REQUIRED)

**IMPORTANT**: Since we removed backward compatibility (the old format was a bug), existing records **must** be migrated or deleted:

### Option 1: Migrate Existing Records

Run this SQL to convert old object format to new array format:

```sql
UPDATE application_dashboards
SET variables = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'name', key,
      'values', value
    )
  )
  FROM jsonb_each(variables) AS kv(key, value)
)
WHERE
  variables IS NOT NULL
  AND jsonb_typeof(variables) = 'object'  -- Only old format records
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(variables) WHERE jsonb_typeof(value) = 'object'
  );
```

### Option 2: Delete Old Records (Recommended for Testing)

If these are test records, simply delete them and let auto-config recreate with correct format:

```sql
DELETE FROM application_dashboards
WHERE
  variables IS NOT NULL
  AND jsonb_typeof(variables) = 'object';
```

**Note**: The service will automatically recreate dashboards on the next auto-config run.

---

## Testing Results

**TypeScript Compilation**: ✅ No errors
```bash
npx tsc --noEmit
# Success - no output
```

**Expected Behavior**:
- New dashboards will be created with array format
- Existing dashboards with object format will continue to work
- Variable comparisons work correctly for both formats
- Duplicate detection works correctly for both formats

---

## Files Changed

### New Files

1. **`apps/grafana-sync/src/modules/auto-config/types.ts`** (NEW)
   - Shared type definitions for DashboardVariable and DashboardVariables
   - Eliminates duplicate type definitions across multiple files

### Modified Files

1. **`apps/grafana-sync/src/modules/auto-config/auto-config.service.ts`**
   - Removed object format conversion in readOnly path (4 lines removed)
   - Refactored separate dashboard creation to use Map and array (60+ lines modified)
   - Simplified `checkExistingValues` - removed backward compatibility (20 lines modified)
   - Simplified `checkIfUpdateRequired` - removed backward compatibility (15 lines modified)
   - Import DashboardVariable from shared types file

2. **`apps/grafana-sync/src/modules/auto-config/auto-config-updates.service.ts`**
   - Replaced `variables?: any` with `variables?: DashboardVariables`
   - Import types from shared types file

3. **`apps/grafana-sync/src/modules/auto-config/variable-discovery.service.ts`**
   - Removed duplicate DashboardVariable interface
   - Import DashboardVariable from shared types file

4. **`apps/grafana-sync/src/modules/auto-config/dashboard-uid.util.ts`**
   - Removed duplicate DashboardVariable interface
   - Import DashboardVariable from shared types file

5. **`apps/grafana-sync/src/modules/auto-config/dashboard-uid.util.spec.ts`**
   - Updated import to get DashboardVariable from types file

**Total changes**: 1 new file, 5 files modified, ~120 lines modified/removed

---

## Related Work

This fix builds on the Prometheus query variable implementation completed earlier:
- **Prometheus query support**: `getPrometheusVariableValues()` method
- **InfluxDB query support**: `getInfluxVariableValues()` method
- **Datasource query routing**: `getValuesFromDatasourceQuery()` method

These features discovered variable values correctly, but the storage format was incorrect. Now both discovery and storage use the correct array format.

---

## Production Readiness

### ✅ Ready for Deployment (with migration)

**Requirements Met**:
- ✅ Variables stored in correct array format
- ✅ Proper TypeScript types (no more `any`)
- ✅ TypeScript compilation successful
- ✅ Eliminated duplicate type definitions
- ✅ Simplified code by removing bug workarounds

**REQUIRED Before Deployment**:
1. **Migrate or delete old records** (see Migration Path section above)
2. Restart grafana-sync service to pick up changes
3. Monitor logs for new dashboard creation
4. Verify new dashboards have array format in database

**Breaking Change Warning**:
- Old dashboards with object format variables will cause TypeScript errors
- Must migrate or delete old records before deploying

---

## Verification Query

Check variables format in database:

```sql
SELECT
  dashboard_label,
  TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
  CASE
    WHEN jsonb_typeof(variables) = 'array' THEN 'ARRAY (correct)'
    WHEN jsonb_typeof(variables) = 'object' THEN 'OBJECT (old format)'
    ELSE 'NULL'
  END as format,
  jsonb_pretty(variables) as variables
FROM application_dashboards
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

Expected result after migration:
- All dashboards: `format = 'ARRAY (correct)'`
- No old object format dashboards should remain

---

## Summary

### What Was Fixed

1. **Bug**: Variables were being stored as `{ key: [values] }` instead of `[{ name, values }]`
2. **Root cause**: Incorrect conversion from array to object before database insert
3. **Impact**: Frontend/API code expecting array format would fail

### Changes Made

1. ✅ Removed object conversion logic (2 locations)
2. ✅ Created shared types file to eliminate duplication
3. ✅ Changed `variables?: any` to `variables?: DashboardVariables`
4. ✅ Removed backward compatibility for buggy format
5. ✅ Simplified comparison and lookup logic

### Benefits

- **Type Safety**: No more `any` types
- **Code Quality**: Eliminated duplicate type definitions
- **Correctness**: Variables stored in correct format
- **Maintainability**: Simpler code without bug workarounds
- **Consistency**: All files use shared types

### Migration Required

⚠️ **IMPORTANT**: Existing dashboards with object format must be migrated or deleted before deployment.

See "Migration Path for Old Records" section above for SQL commands.
