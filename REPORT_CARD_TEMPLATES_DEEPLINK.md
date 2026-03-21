# Report Card - Manage Templates Deep Link

## Overview

Added a settings (cogs) icon to the Report Card header that deep links to the System Config page's Reporting Templates tab with environment and workload pre-selected from the current test run.

## User Experience

### From Test Run Page

1. User views a test run at `/test-runs/[id]`
2. Report Card shows in the dashboard grid
3. Click **Settings icon** (⚙️) in the Report Card header (left side)
4. **Navigates to:** `/systems/[systemId]/config?tab=7&environment=[env]&workload=[workload]`
5. **Result:**
   - Reporting Templates tab is active
   - Environment selector pre-selected to test run's environment
   - Workload selector pre-selected to test run's workload
   - Templates filtered to show only relevant templates for that scope

### Benefits

✅ **Quick Access** - One-click navigation from test run to template management
✅ **Context Preserved** - Environment and workload automatically set
✅ **Filtered View** - See only templates relevant to the current test run
✅ **Create Templates** - Easy to create new templates with proper scope
✅ **Edit Templates** - Directly manage templates used by this test run

## Changes Made

### 1. ReportCard Component

**File**: `apps/web/app/test-runs/[id]/components/reporting/ReportCard.tsx`

#### Added Imports
```typescript
import { useRouter } from 'next/navigation';
import { Settings as SettingsIcon } from '@mui/icons-material';
```

#### Added Router Hook
```typescript
const router = useRouter();
```

#### Added Handler
```typescript
const handleManageTemplates = useCallback(() => {
  if (!testRun.system_under_test_id) {
    handleSnackbar('System under test not available', 'error');
    return;
  }

  const params = new URLSearchParams();
  params.set('tab', '7'); // Reporting Templates tab
  if (testRun.test_environment) {
    params.set('environment', testRun.test_environment);
  }
  if (testRun.workload) {
    params.set('workload', testRun.workload);
  }

  router.push(`/systems/${testRun.system_under_test_id}/config?${params.toString()}`);
}, [testRun.system_under_test_id, testRun.test_environment, testRun.workload, router, handleSnackbar]);
```

#### Added Settings Button to Header
```tsx
<Box display="flex" justifyContent="center" alignItems="center" mb={2} position="relative">
  {/* Settings Button - Left Side */}
  <Tooltip title="Manage Reporting Templates">
    <IconButton
      onClick={(e) => {
        e.stopPropagation();
        handleManageTemplates();
      }}
      size="small"
      sx={{
        position: 'absolute',
        left: 0,
        width: 32,
        height: 32,
        color: 'text.secondary',
        '&:hover': {
          backgroundColor: `${getAccentColor()}15`,
          color: getAccentColor(),
        },
        transition: 'all 0.2s ease',
      }}
    >
      <SettingsIcon fontSize="small" />
    </IconButton>
  </Tooltip>

  {/* "Reports" Title - Center */}
  <Typography variant="subtitle1" component="h2" ...>
    Reports
  </Typography>

  {/* Expand/Collapse Button - Right Side */}
  <IconButton onClick={...}>
    {expanded ? <ExpandLess /> : <ExpandMore />}
  </IconButton>
</Box>
```

### 2. System Config Hook

**File**: `apps/web/app/systems/[id]/config/hooks/useSystemData.ts`

#### Updated Tab Validation
Changed tab index validation from `0-6` to `0-7` to include Reporting Templates tab:

```typescript
// Before
if (!isNaN(tabIndex) && tabIndex >= 0 && tabIndex <= 6) {

// After
if (!isNaN(tabIndex) && tabIndex >= 0 && tabIndex <= 7) {
```

#### Added Tab Name Mapping
```typescript
const TAB_MAPPING: { [key: string]: number } = {
  'Grafana dashboards': 0,
  'Service Level Objectives': 1,
  'Deep Links': 2,
  'Dynatrace': 3,
  'Distributed Tracing': 4,
  'Pyroscope': 5,
  'Notifications': 6,
  'Reporting Templates': 7  // ← Added
};
```

## URL Structure

### Query Parameters

| Parameter | Description | Example | Required |
|-----------|-------------|---------|----------|
| `tab` | Tab index (0-7) or tab name | `7` or `Reporting Templates` | Yes |
| `environment` | Test environment name | `acc`, `prod`, `test` | No |
| `workload` | Workload name | `loadTest`, `stress`, `soak` | No |

### Example URLs

#### With All Parameters
```
/systems/abc-123/config?tab=7&environment=acc&workload=loadTest
```

#### With Tab Only
```
/systems/abc-123/config?tab=7
```

#### With Tab Name
```
/systems/abc-123/config?tab=Reporting%20Templates&environment=prod
```

## UI Layout

### Report Card Header

```
┌─────────────────────────────────────────────────┐
│  ⚙️              REPORTS               ⌃/⌄      │
│  │               (title)                │       │
│  Settings                            Expand     │
└─────────────────────────────────────────────────┘
```

- **Left**: Settings icon (⚙️) - Manage Templates
- **Center**: "REPORTS" title
- **Right**: Expand/Collapse icon (⌃/⌄)

### Hover States

- Settings icon: Changes color to accent color with light background
- Smooth transitions on all interactions
- Tooltip shows "Manage Reporting Templates"

## User Flows

### Flow 1: Create Template from Test Run

1. User runs a test with environment "acc" and workload "loadTest"
2. Views test run details page
3. Clicks ⚙️ icon in Report Card
4. Navigates to System Config → Reporting Templates
5. Environment "acc" and workload "loadTest" already selected
6. Clicks "Create Template"
7. Template is automatically scoped to acc/loadTest
8. User configures sections and saves
9. Returns to test run page
10. Template now available in report generator

### Flow 2: Edit Existing Template

1. User generates report using a template
2. Wants to modify the template
3. Clicks ⚙️ icon in Report Card
4. Sees all templates for this environment/workload
5. Clicks edit icon on desired template
6. Makes changes to template sections
7. Saves and returns to test run
8. Next report generation uses updated template

### Flow 3: View Available Templates

1. User wants to see what templates exist for current scope
2. Clicks ⚙️ icon in Report Card
3. Views filtered list of templates
4. Can see template names, section counts, and default badge
5. Understands what reporting options are available
6. Returns to test run page

## Error Handling

### Missing System Under Test
```typescript
if (!testRun.system_under_test_id) {
  handleSnackbar('System under test not available', 'error');
  return;
}
```

**When it happens**: System relation not loaded on test run
**User sees**: Error snackbar message
**Resolution**: Ensure test run has valid system_under_test_id field

### Missing Environment or Workload

**Scenario**: Test run has no environment or workload set
**Behavior**: Still navigates to templates tab, but selectors may be empty
**Resolution**: User can manually select environment/workload in config page

## Testing

### Manual Testing Steps

1. **Basic Navigation**
   - Open test run page
   - Click ⚙️ icon
   - Verify navigation to correct system config page
   - Verify Reporting Templates tab is active (tab 7)

2. **Query Parameter Validation**
   - Check URL contains `tab=7`
   - Check `environment` parameter matches test run
   - Check `workload` parameter matches test run

3. **Environment/Workload Preset**
   - Verify environment selector shows correct value
   - Verify workload selector shows correct value
   - Verify templates list is filtered to that scope

4. **Edge Cases**
   - Test with missing system_under_test_id
   - Test with missing environment or workload
   - Test on collapsed and expanded card states

### Test Data

Create test runs with various combinations:

```typescript
// Test Run 1: Complete data
{
  system_under_test_id: 'sys-123',
  test_environment: 'acc',
  workload: 'loadTest'
}

// Test Run 2: Missing workload
{
  system_under_test_id: 'sys-123',
  test_environment: 'prod',
  workload: null
}

// Test Run 3: Missing environment
{
  system_under_test_id: 'sys-123',
  test_environment: null,
  workload: 'stress'
}
```

## Accessibility

- **Keyboard Navigation**: Settings button is keyboard accessible
- **Screen Readers**: Button has aria-label via Tooltip title
- **Focus States**: Clear focus indicators on hover/focus
- **Color Contrast**: Icon color meets WCAG AA standards

## Future Enhancements

1. **Template Count Badge**: Show number of available templates in tooltip
2. **Recent Templates**: Show recently used templates in dropdown
3. **Create Template Shortcut**: Add "Create from Current" option
4. **Template Preview**: Preview template structure before navigation
5. **Deep Link to Specific Template**: Support `?templateId=xxx` parameter

## Related Documentation

- [Template Selector Feature](TEMPLATE_SELECTOR_FEATURE.md) - Template selection in report generator
- [Template Update Method Fix](TEMPLATE_UPDATE_METHOD_FIX.md) - HTTP method fix
- [Template Section Builder](TEMPLATE_SECTION_BUILDER_UPDATE.md) - Template configuration UI
- [System Config Page](apps/web/app/systems/[id]/config/README.md) - System configuration overview
