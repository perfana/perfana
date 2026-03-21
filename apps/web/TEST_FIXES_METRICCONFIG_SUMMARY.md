# MetricConfigForm Test Fixes Summary

## Overview
Fixed all 10 failing tests in MetricConfigForm.test.tsx by applying consistent patterns for MUI form control testing.

## Test Results
- **Before**: 44 passed, 10 failed
- **After**: 54 passed, 0 failed
- **Total Tests**: 54

## Issues Fixed

### 1. Multiple Checkbox Matching Issues
**Problem**: Tests using `getByRole('checkbox')` were finding multiple checkboxes (Ignore Metric switch + Higher is Better switch) causing ambiguous matches.

**Solution**: Navigate from the specific label text to find the correct checkbox:
```typescript
const ignoreLabel = screen.getByText('Ignore Metric');
const ignoreSwitch = ignoreLabel.closest('.MuiFormControlLabel-root')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
```

**Tests Fixed**:
- "should initialize ignore to false by default"
- "should initialize higherIsBetter to false by default"
- "should preserve all form state when switching between scopes"
- "should save all modified fields correctly"

### 2. MUI Select getByLabelText Failures
**Problem**: Tests using `getByLabelText('Classification Category')` failed because MUI Select uses a combobox role with a hidden input, not a standard select element.

**Solution**: Navigate from label to form control and find the hidden input:
```typescript
const labels = screen.getAllByText('Classification Category');
const formControl = labels[0].closest('.MuiFormControl-root');
const selectInput = formControl?.querySelector('input[value="RED_duration"]');
```

**Tests Fixed**:
- "should use default values when no config is provided"
- "should initialize classification from config"
- "should reinitialize form when configData changes"

### 3. Multiple Text Match Issues in Dropdown Menus
**Problem**: When dropdown menus opened, text appeared both in the select field AND in the dropdown options, causing `getByText()` to find multiple elements.

**Solution**: Wait for listbox to appear, then query within the listbox specifically:
```typescript
await waitFor(() => {
  const listbox = document.querySelector('[role="listbox"]');
  expect(listbox).toBeInTheDocument();
});

const listbox = document.querySelector('[role="listbox"]');
const option = Array.from(listbox?.querySelectorAll('[role="option"]') || [])
  .find(el => el.textContent === 'Business Metric');
```

**Tests Fixed**:
- "should show all classification options"
- "should update classification when option is selected"
- "should show all aggregation options"
- "should update aggregation when option is selected"

## Patterns Established

### Pattern 1: Finding Switches by Label
```typescript
const label = screen.getByText('Switch Label');
const switchInput = label.closest('.MuiFormControlLabel-root')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
```

### Pattern 2: Finding MUI Select Hidden Input
```typescript
const labels = screen.getAllByText('Select Label');
const formControl = labels[0].closest('.MuiFormControl-root');
const hiddenInput = formControl?.querySelector('input[value]') as HTMLInputElement;
```

### Pattern 3: Interacting with MUI Select Dropdown
```typescript
// Open dropdown
const selectCombobox = formControl?.querySelector('[role="combobox"]');
fireEvent.mouseDown(selectCombobox);

// Wait for listbox
await waitFor(() => {
  const listbox = document.querySelector('[role="listbox"]');
  expect(listbox).toBeInTheDocument();
});

// Select option from listbox
const listbox = document.querySelector('[role="listbox"]');
const option = Array.from(listbox?.querySelectorAll('[role="option"]') || [])
  .find(el => el.textContent === 'Option Text');
fireEvent.click(option);
```

### Pattern 4: Checking Listbox Content
```typescript
const listbox = document.querySelector('[role="listbox"]');
expect(listbox?.textContent).toContain('Expected Text');
```

## Grid Deprecation Warnings

**Note**: MUI Grid deprecation warnings for `item`, `xs`, and `md` props still appear in console output. These are **component issues**, not test issues. The tests now pass despite these warnings.

To fix these warnings, the component would need to be updated to use Grid v2:
```typescript
// Old (deprecated)
<Grid container spacing={2}>
  <Grid item xs={12} md={8}>...</Grid>
</Grid>

// New (Grid v2)
<Grid container spacing={2}>
  <Grid xs={12} md={8}>...</Grid>
</Grid>
```

## Key Takeaways

1. **DOM Navigation**: Use label text to navigate to form controls rather than relying on `getByLabelText()` for MUI components
2. **Specificity**: Always navigate to the specific element when multiple similar elements exist
3. **Async Operations**: Use `waitFor()` when opening dropdowns and selecting options
4. **Listbox Scoping**: Query within the listbox to avoid duplicate text matches
5. **Hidden Inputs**: MUI Select uses hidden inputs with the actual value, not visible select elements

## Files Modified
- `/Users/daniel/workspace/perfana-next-gen/apps/web/__tests__/app/test-runs/configuration-comparison/MetricConfigForm.test.tsx`

## Related Documentation
- Phase 16 Test Fixes Summary: Similar patterns for MUI form controls
- CODING_RULES.md: Testing standards and best practices
