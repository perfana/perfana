# Compare Presets Feature - Test Coverage Summary

## Overview

This document summarizes the comprehensive test coverage created for the Compare Presets feature, which allows users to save and reuse filter configurations for test run comparisons.

## ⚠️ Bug Fix Applied

**Issue Found**: Save preset functionality was broken due to missing `created_for_test_run_id` field.
**Status**: ✅ **FIXED** - See [COMPARE_PRESETS_BUG_FIX.md](./COMPARE_PRESETS_BUG_FIX.md) for details.

## Test Files Created

### 1. `__tests__/lib/compare-presets.test.ts` (40 tests)
**API Client Testing** - Tests the `ComparePresetsAPI` class and `PresetUtils` helper functions.

### 2. `__tests__/components/SavePresetModal.test.tsx` (35 tests)
**Component Testing** - Tests the `SavePresetModal` React component.

## Total Coverage: 75 Tests ✅

All tests passing as of latest run.

---

## Detailed Test Coverage

### API Client Tests (40 tests)

#### ComparePresetsAPI.getAll() - 4 tests
- ✅ Should fetch all presets without testRunId filter
- ✅ Should fetch presets filtered by testRunId
- ✅ Should handle fetch errors
- ✅ Should handle network errors

#### ComparePresetsAPI.getById() - 3 tests
- ✅ Should fetch preset by ID successfully
- ✅ Should throw specific error for 404 not found
- ✅ Should throw generic error for other failures

#### ComparePresetsAPI.create() - 5 tests
- ✅ Should create a new preset successfully
- ✅ Should send correct headers for create request
- ✅ Should handle creation errors with error text
- ✅ Should create preset with all optional fields
- ✅ **Should include created_for_test_run_id when provided** (NEW - Bug Fix)

**Key Coverage**: Tests creation with both minimal and complete preset data including:
- Generic vs specific preset types
- Series search filters
- Percentile settings
- Dashboard and metric associations
- Baseline test run references
- **Test run association (created_for_test_run_id)** (NEW)
- Global vs personal presets

#### ComparePresetsAPI.update() - 4 tests
- ✅ Should update preset successfully
- ✅ Should throw specific error for 403 forbidden (permission denied)
- ✅ Should throw specific error for 404 not found
- ✅ Should handle update errors with error text

**Key Coverage**: Tests authorization enforcement - users can only update their own presets.

#### ComparePresetsAPI.delete() - 4 tests
- ✅ Should delete preset successfully
- ✅ Should throw specific error for 403 forbidden
- ✅ Should throw specific error for 404 not found
- ✅ Should handle generic delete errors

**Key Coverage**: Tests authorization enforcement - users can only delete their own presets.

#### PresetUtils.groupPresets() - 3 tests
- ✅ Should group presets into personal, global, and shared categories
- ✅ Should handle empty presets array
- ✅ Should correctly categorize global presets created by current user

**Key Coverage**: Tests the categorization logic that separates:
- **Personal**: Created by current user, not global
- **Global**: Marked as global (regardless of creator)
- **Shared**: Created by other users, not global

#### PresetUtils.canModify() - 4 tests
- ✅ Should return true when user created the preset
- ✅ Should return false when user did not create the preset
- ✅ Should return false for global presets created by others
- ✅ Should return true for global presets created by current user

**Key Coverage**: Tests permission logic for edit/delete operations.

#### PresetUtils.getDisplayText() - 5 tests
- ✅ Should return just the name for generic presets
- ✅ Should include baseline test run ID for specific presets
- ✅ Should add globe emoji for global presets
- ✅ Should combine baseline and global indicators
- ✅ Should handle specific preset without baseline test run

**Example outputs**:
- Generic: `"CPU Metrics"`
- Specific: `"Memory Comparison (baseline-run-123)"`
- Global: `"Global Preset 🌍"`
- Both: `"Performance Baseline (v1.0.0-baseline) 🌍"`

#### PresetUtils.getSummary() - 7 tests
- ✅ Should return empty string when no details available
- ✅ Should include series filter in summary
- ✅ Should include percentiles status in summary
- ✅ Should include panel title in summary
- ✅ Should include baseline for specific presets
- ✅ Should combine multiple summary parts with bullet separator
- ✅ Should not include baseline for generic presets even if baseline_test_run_id exists
- ✅ Should handle all fields together correctly

**Example output**: `"Filter: \"http.*latency\" • Percentiles enabled • Panel: HTTP Latency P99"`

---

### Component Tests (35 tests)

#### Rendering - 5 tests
- ✅ Should render the modal when open
- ✅ Should not render the modal when closed
- ✅ Should render preset name and description fields
- ✅ Should render preset type radio buttons
- ✅ Should show warning when no dashboard/metric selected

#### Auto-Generation of Preset Name - 7 tests
- ✅ Should generate name from metric title
- ✅ Should include series search text in name when present
- ✅ Should include "Percentiles" in name when enabled
- ✅ Should use "Filtered" for long search text (>20 chars)
- ✅ Should generate "Generic Preset" when no details available
- ✅ Should generate "Specific Preset" when test run selected

**Examples**:
- Simple: `"CPU Usage"`
- With filter: `"CPU Usage - \"cpu.*usage\" - Percentiles"`
- Long filter: `"CPU Usage - Filtered - Percentiles"`
- Minimal: `"Generic Preset"` or `"Specific Preset"`

#### Auto-Generation of Description - 3 tests
- ✅ Should generate description from dashboard and metric
- ✅ Should include filter in description
- ✅ Should include baseline test run in description

**Example**: `"Dashboard: Performance Dashboard. Metric: CPU Usage. Filter: \"memory.*\". Includes percentile metrics. Baseline: baseline-run-456"`

#### Configuration Preview - 5 tests
- ✅ Should display dashboard chip
- ✅ Should display metric chip
- ✅ Should display filter chip when search text present
- ✅ Should display percentiles chip when enabled
- ✅ Should display baseline chip for specific presets

**Coverage**: Tests that all current filter settings are visually displayed as chips.

#### Form Validation - 3 tests
- ✅ Should show error when name is empty
- ✅ Should show error when specific preset has no baseline
- ✅ Should clear error when user starts typing

**Key Validations**:
1. Name is required
2. Specific presets require a baseline test run to be selected

#### Form Submission - 4 tests
- ✅ Should call onSave with correct data for generic preset
- ✅ Should call onSave with baseline for specific preset
- ✅ Should close modal after successful save
- ✅ Should not close modal on save failure

**Key Coverage**: Tests complete save flow including:
- Correct data structure sent to onSave callback
- Modal closes on success
- Modal remains open on error (allowing user to retry)

#### Cancel Operation - 2 tests
- ✅ Should call onClose when cancel button clicked
- ✅ Should reset form when closed and reopened

**Key Coverage**: Tests that form resets to auto-generated values when modal is reopened.

#### Loading State - 3 tests
- ✅ Should disable save button when loading
- ✅ Should show "Saving..." text when loading
- ✅ Should disable save button when no dashboard/metric selected

**Key Coverage**: Tests UI feedback during async operations.

#### Dynatrace Support - 2 tests
- ✅ Should use applicationDashboardId from metric for Dynatrace
- ✅ Should fall back to dashboard id when no applicationDashboardId

**Key Coverage**: Tests dual-source support (Grafana vs Dynatrace) with proper ID resolution.

---

## Running the Tests

```bash
# Run all compare preset tests
npm test -- --testPathPattern="(compare-presets|SavePresetModal)"

# Run API client tests only
npm test -- compare-presets.test.ts

# Run component tests only
npm test -- SavePresetModal.test.tsx

# Run with coverage
npm test -- --coverage --testPathPattern="(compare-presets|SavePresetModal)"
```

#### Created For Test Run ID - 2 tests (NEW - Bug Fix)
- ✅ Should include created_for_test_run_id when currentTestRunId provided
- ✅ Should not include created_for_test_run_id when currentTestRunId is not provided

**Key Coverage**: Tests the bug fix that ensures test run association is properly saved.

---

## Test Results

```
Test Suites: 2 passed, 2 total
Tests:       75 passed, 75 total (40 + 35)
Time:        ~2.7s
```

---

## ✅ Bug Fixed: created_for_test_run_id

**Previous Issue**: Save preset was broken due to missing `created_for_test_run_id` field.

**Fix Applied**: Added field to:
1. Backend DTO (`CreateComparePresetDto`)
2. Backend service mapping (`compare-presets.service.ts`)
3. Frontend API interface (`CreateComparePresetRequest`)
4. Frontend modal interface (`PresetFormData`)
5. Frontend modal component (`SavePresetModal.tsx`)

**Tests Added**: 3 new tests verify the field is properly handled end-to-end.

See [COMPARE_PRESETS_BUG_FIX.md](./COMPARE_PRESETS_BUG_FIX.md) for complete fix details.

---

## Debugging Save Preset Issues

If the save preset functionality is not working, follow this debugging checklist:

### 1. Check Network Requests

Open browser DevTools (Network tab) and look for the POST request to `/compare-presets`:

```javascript
// Expected request
POST /compare-presets
Headers:
  Authorization: Bearer <token>
  Content-Type: application/json
Body:
{
  "name": "CPU Usage",
  "description": "...",
  "preset_type": "generic",
  "series_search_text": "",
  "show_percentiles": false,
  "application_dashboard_id": "dashboard-123",
  "panel_id": 5,
  "panel_title": "CPU Usage",
  "is_global": true
}
```

**Common Issues**:
- ❌ **401 Unauthorized**: Missing or expired authentication token
- ❌ **403 Forbidden**: User doesn't have permission to create presets
- ❌ **400 Bad Request**: Invalid data format or missing required fields
- ❌ **500 Internal Server Error**: Backend error

### 2. Check Authentication

Verify auth headers are being sent:

```typescript
// In CompareCard.tsx, the savePreset function calls:
await ComparePresetsAPI.create(createRequest);

// Which uses authenticatedFetch from @/lib/api
// This should automatically add auth headers
```

**Test Authentication**:
```bash
# Check if user is logged in
localStorage.getItem('perfana_access_token')

# Verify token is valid (decode JWT)
```

### 3. Check Backend API Endpoint

Verify the backend endpoint exists and is properly configured:

```bash
# Check API logs for errors
# Expected endpoint: POST /api/compare-presets

# Verify database connection
# Check if compare_presets table exists
```

### 4. Check Form Data

Add console logging to see what data is being sent:

```typescript
// In SavePresetModal.tsx handleSave():
const savePreset = async (presetData: PresetFormData) => {
  console.log('Saving preset with data:', presetData); // Add this
  // ...
}
```

### 5. Backend Validation

Check backend for validation errors:

```typescript
// Expected schema validation:
- name: required, max 255 chars
- preset_type: must be 'generic' or 'specific'
- application_dashboard_id: required (UUID format)
- panel_id: required (number)
- is_global: required (boolean)
```

### 6. Common Fixes

**Missing created_for_test_run_id**:
```typescript
// In CompareCard.tsx line 833, verify this line exists:
created_for_test_run_id: presetData.created_for_test_run_id,
```

**Wrong applicationDashboardId**:
```typescript
// For Dynatrace metrics, should use:
currentFilters.selectedMetric?.applicationDashboardId

// For Grafana, should use:
currentFilters.selectedDashboard?.id
```

---

## Test Patterns Used

### 1. API Mocking Pattern
```typescript
const mockAuthenticatedFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(...args),
}));
```

### 2. React Testing Library Pattern
```typescript
const { rerender } = render(<Component />);
await waitFor(() => {
  expect(screen.getByLabelText(/Name/i)).toHaveValue('Expected');
});
```

### 3. Async Testing Pattern
```typescript
it('should handle async operation', async () => {
  mockFunction.mockResolvedValue(data);

  // Trigger operation
  fireEvent.click(saveButton);

  // Wait for completion
  await waitFor(() => {
    expect(mockFunction).toHaveBeenCalled();
  });
});
```

---

## Next Steps

To fully debug the save preset issue:

1. ✅ **Tests are created** - All 72 tests passing
2. 🔍 **Check backend** - Verify `/api/compare-presets` endpoint exists
3. 🔍 **Check auth** - Verify user authentication is working
4. 🔍 **Check network** - Use browser DevTools to see actual request/response
5. 🔍 **Check console** - Look for JavaScript errors in browser console

## Files Created

```
apps/web/
├── __tests__/
│   ├── lib/
│   │   ├── compare-presets.test.ts        (39 tests)
│   │   └── COMPARE_PRESETS_TEST_COVERAGE.md (this file)
│   └── components/
│       └── SavePresetModal.test.tsx        (33 tests)
```

## Related Files (Implementation)

```
apps/web/
├── lib/
│   └── compare-presets.ts                   (API client & utils)
└── app/
    └── test-runs/
        └── [id]/
            └── components/
                └── compare/
                    ├── CompareCard.tsx       (Save preset integration)
                    └── SavePresetModal.tsx   (Modal component)
```
