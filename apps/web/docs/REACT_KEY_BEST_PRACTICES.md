# React Key Best Practices

## Background

This document explains a critical bug that was introduced and how to prevent similar issues in the future.

## The Bug (Fixed on 2025-12-04)

### What Happened

When multi-source support (Grafana + Dynatrace) was added to the Trends card in commit `5a4b421` (Oct 30, 2025), the code mapped Dynatrace dashboards using `dashboard_label` as the unique `id` field:

```typescript
// ❌ WRONG - Causes duplicate keys
dynatraceDashboards.map(d => ({
  id: d.dashboardLabel,  // Not unique!
  dashboard_label: d.dashboardLabel,
  dashboard_name: d.dashboardLabel,
  dashboard_uid: ''
}))
```

### The Problem

Dynatrace allows multiple dashboards to have the same label. For example, different systems might all have a dashboard labeled "HTTP connection pool afterburner-be". When these were rendered in Material-UI's Autocomplete component, React generated this error:

```
Encountered two children with the same key, `HTTP connection pool afterburner-be`.
Keys should be unique so that components maintain their identity across updates.
```

### The Fix

Changed the mapping to generate unique index-based ids:

```typescript
// ✅ CORRECT - Generates unique keys
dynatraceDashboards.map((d, index) => ({
  id: `dynatrace-${index}`,  // Unique for each item
  dashboard_label: d.dashboardLabel,
  dashboard_name: d.dashboardLabel,
  dashboard_uid: ''
}))
```

### Location

**File**: `apps/web/app/test-runs/[id]/components/trends/TrendsCard.tsx`
**Line**: ~1488

## Best Practices to Prevent This

### 1. Never Use Non-Unique Values as React Keys

❌ **Bad Examples:**
- User-provided labels or names
- Display text
- Non-unique database fields
- Timestamps (can have duplicates)

✅ **Good Examples:**
- Database UUIDs/IDs
- Index-based keys for static lists (`item-${index}`)
- Composite keys with guaranteed uniqueness (`${type}-${id}`)

### 2. When Mapping External Data

**Always ask**: "Could this field have duplicates?"

If the answer is "yes" or "maybe", don't use it as a key.

```typescript
// ❌ WRONG - Labels can duplicate
items.map(item => ({ id: item.label, ...item }))

// ✅ CORRECT - Use index or database ID
items.map((item, index) => ({ id: `item-${index}`, ...item }))
items.map(item => ({ id: item.databaseId, ...item }))
```

### 3. Material-UI Autocomplete Specific

Material-UI Autocomplete uses the `getOptionKey` prop (defaults to `option.id`) for React keys. Ensure this field is unique:

```typescript
<Autocomplete
  options={items}
  getOptionKey={(option) => option.uniqueId} // Must be unique!
  // OR rely on default with unique option.id
/>
```

### 4. Testing for Duplicate Keys

We've added comprehensive tests in `__tests__/app/test-runs/trends/TrendsCard.test.tsx` under the section "Unique Keys / React Key Constraints".

**When adding new list rendering code:**

1. Write a test that verifies key uniqueness
2. Mock data with intentional duplicates
3. Assert all keys are unique using a Set comparison

Example test pattern:
```typescript
it('should generate unique keys even with duplicate labels', () => {
  const items = [
    { label: 'Same Label' },
    { label: 'Same Label' }, // Duplicate!
  ];

  const mapped = items.map((item, index) => ({
    id: `item-${index}`,
    label: item.label,
  }));

  const keys = mapped.map(item => item.id);
  const uniqueKeys = new Set(keys);

  expect(uniqueKeys.size).toBe(keys.length); // All unique
});
```

## Red Flags to Watch For

🚩 **Warning Signs:**
- Mapping arrays with non-database fields as keys
- Using user input as keys
- Using labels, names, or titles as keys
- Console warnings about duplicate keys in development

## Related Files

### TrendsCard
- **Implementation**: `app/test-runs/[id]/components/trends/TrendsCard.tsx` (lines ~1488-1538)
- **Tests**: `__tests__/app/test-runs/trends/TrendsCard.test.tsx`
- **Git History**: `git log --oneline -- "app/test-runs/[id]/components/trends/TrendsCard.tsx"`

### CompareCard (Fixed: Dec 4, 2025)
- **Implementation**: `app/test-runs/[id]/components/compare/CompareCard.tsx` (lines 1542-1594 dashboard, 1597-1644 metrics)
- **Tests**: `__tests__/app/test-runs/compare/CompareCard.test.tsx`
- **Changes Applied**: Same fix pattern - index-based unique IDs for Dynatrace dashboards, `isOptionEqualToValue`, and `key={option.id}` in renderOption

## Additional Fix Required

When the duplicate key issue was first addressed, the fix only changed the `id` generation. However, Material-UI's Autocomplete still used the default key generation based on `getOptionLabel`. Two additional changes were needed:

1. **Added `isOptionEqualToValue` prop**: Tells Material-UI to compare options by `id` instead of object reference
2. **Changed `renderOption` key**: Explicitly use `option.id` instead of the auto-generated key

```typescript
<Autocomplete
  options={...}
  getOptionLabel={(option) => option.dashboard_label || ''}
  isOptionEqualToValue={(option, value) => option.id === value.id} // Compare by id
  renderOption={(props, option) => {
    const { key, ...otherProps } = props;
    return (
      <Box component="li" key={option.id} {...otherProps}> {/* Use option.id */}
        <Typography>{option.dashboard_label}</Typography>
      </Box>
    );
  }}
/>
```

## Conclusion

**Always prioritize unique identifiers over convenience when generating React keys.** Even if a field "usually" has unique values, it only takes one duplicate to cause React rendering issues and confusion.

When in doubt, use index-based keys for static lists or database IDs for dynamic data.

### Material-UI Autocomplete Specific
- Always specify `isOptionEqualToValue` when options might have duplicate labels
- Explicitly use the unique `id` in `renderOption` key prop
- Don't rely on auto-generated keys from `getOptionLabel`
