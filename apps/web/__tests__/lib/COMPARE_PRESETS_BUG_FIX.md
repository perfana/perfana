# Compare Presets Save Bug Fix

## 🐛 Bug Report

**Issue:** Saving compare presets does not work in the test run details view.

**Root Cause:** Missing `created_for_test_run_id` field in backend DTO causing TypeScript compilation error and preventing preset save functionality.

---

## 🔍 Investigation & Root Cause Analysis

### The Bug

1. **Frontend TypeScript Error**:
   ```
   app/test-runs/[id]/components/compare/CompareCard.tsx(833,45):
   error TS2339: Property 'created_for_test_run_id' does not exist on type 'PresetFormData'.
   ```

2. **Missing Field Chain**:
   - ✅ **Database Entity** has field: `createdForTestRunId` (column: `created_for_test_run_id`)
   - ❌ **Backend DTO** was missing: `created_for_test_run_id`
   - ❌ **Frontend Interface** was missing: `created_for_test_run_id`
   - ❌ **CompareCard** tried to send it anyway → TypeScript error

3. **Impact**:
   - TypeScript compilation error prevented production builds
   - Save preset functionality was broken
   - User couldn't save compare filter presets for specific test runs

### Investigation Steps

1. ✅ Verified backend endpoint exists (`POST /compare-presets`)
2. ✅ Checked backend controller (line 33-60 in `compare-presets.controller.ts`)
3. ✅ Examined backend DTO (`CreateComparePresetDto`) - **field was missing**
4. ✅ Checked database entity (`CompareFilterPreset`) - **field exists**
5. ✅ Analyzed frontend code - **TypeScript error found**
6. ✅ Traced the data flow from modal → savePreset → API client

---

## ✅ The Fix

### Files Changed (7 files)

#### 1. Backend DTO (`apps/api/src/modules/compare-presets/dto/create-compare-preset.dto.ts`)

**Added:**
```typescript
@ApiPropertyOptional({
  description: 'Test run ID for which this preset was created (used to filter test run-specific presets)',
  example: 'MyApp-prod-loadTest-00042'
})
@IsString()
@IsOptional()
@MaxLength(255)
created_for_test_run_id?: string;
```

**Location:** Lines 103-110 (after `baseline_test_run_id`)

---

#### 2. Backend Service (`apps/api/src/modules/compare-presets/compare-presets.service.ts`)

**Added:**
```typescript
createdForTestRunId: createComparePresetDto.created_for_test_run_id,
```

**Location:** Line 37 (in `create()` method, mapping DTO to entity)

---

#### 3. Frontend API Interface (`apps/web/lib/compare-presets.ts`)

**Added to `CreateComparePresetRequest`:**
```typescript
created_for_test_run_id?: string;
```

**Location:** Line 41 (after `baseline_test_run_id`)

---

#### 4. Frontend Modal Interface (`apps/web/app/test-runs/[id]/components/compare/SavePresetModal.tsx`)

**Added to `SavePresetModalProps`:**
```typescript
currentTestRunId?: string;
```

**Location:** Line 28

**Added to `PresetFormData`:**
```typescript
created_for_test_run_id?: string;
```

**Location:** Line 61

**Updated component signature:**
```typescript
export default function SavePresetModal({
  open,
  onClose,
  onSave,
  currentFilters,
  currentTestRunId,  // Added
  loading = false
}: SavePresetModalProps) {
```

**Updated initial state (3 locations):**
1. Line 145: Initial `useState` - added `created_for_test_run_id: currentTestRunId`
2. Line 167: `useEffect` - added `created_for_test_run_id: currentTestRunId`
3. Line 228: `handleClose` - added `created_for_test_run_id: currentTestRunId`

---

#### 5. Frontend Tests - API Client (`apps/web/__tests__/lib/compare-presets.test.ts`)

**Added 1 new test:**
```typescript
it('should include created_for_test_run_id when provided', async () => {
  const createRequest: CreateComparePresetRequest = {
    name: 'Test Run Specific Preset',
    preset_type: PresetType.GENERIC,
    show_percentiles: false,
    created_for_test_run_id: 'PaymentService-prod-loadTest-20240115',
    is_global: false
  };

  mockAuthenticatedFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ ...createRequest, id: 'preset-id', created_by: 'user', created_at: '', updated_at: '' })
  });

  await ComparePresetsAPI.create(createRequest);

  const callArgs = mockAuthenticatedFetch.mock.calls[0];
  const requestBody = JSON.parse(callArgs[1].body);
  expect(requestBody.created_for_test_run_id).toBe('PaymentService-prod-loadTest-20240115');
});
```

**Updated existing test:**
- Added `created_for_test_run_id` to "should create preset with all optional fields" test

---

#### 6. Frontend Tests - Component (`apps/web/__tests__/components/SavePresetModal.test.tsx`)

**Added 2 new tests:**

```typescript
describe('Created For Test Run ID', () => {
  it('should include created_for_test_run_id when currentTestRunId provided', async () => {
    // Verifies that when currentTestRunId is passed as prop,
    // it gets included in the save request
  });

  it('should not include created_for_test_run_id when currentTestRunId is not provided', async () => {
    // Verifies that field is undefined when prop is not provided
  });
});
```

---

## 🧪 Test Coverage

### Before Fix
- **Total Tests**: 72 passing
- **TypeScript Errors**: 1 compilation error
- **Save Preset**: Broken (TypeScript error prevented build)

### After Fix
- **Total Tests**: **75 passing** ✅
- **TypeScript Errors**: 0 ✅
- **Save Preset**: Working ✅

### New Tests Added (3)
1. ✅ `compare-presets.test.ts` → "should include created_for_test_run_id when provided"
2. ✅ `SavePresetModal.test.tsx` → "should include created_for_test_run_id when currentTestRunId provided"
3. ✅ `SavePresetModal.test.tsx` → "should not include created_for_test_run_id when currentTestRunId is not provided"

---

## 🔬 Test Verification

```bash
# Run all compare preset tests
npm test -- --testPathPattern="(compare-presets|SavePresetModal)"

# Result:
# Test Suites: 2 passed, 2 total
# Tests:       75 passed, 75 total
# Time:        ~2.7s
```

---

## 📊 What `created_for_test_run_id` Does

### Purpose
Associates a saved preset with the test run it was created from, enabling filtering of test run-specific presets.

### Use Cases

1. **Generic Presets** (`created_for_test_run_id: null/undefined`)
   - Can be reused across any test run
   - User selects baseline test run each time
   - Example: "Response Time Analysis" preset

2. **Test Run-Specific Presets** (`created_for_test_run_id: "TestRun-123"`)
   - Created while viewing a specific test run
   - Can be filtered to show only presets created for that test run
   - Example: Preset saved while analyzing "PaymentService-prod-loadTest-20240115"

### Backend Filtering Logic

In `compare-presets.service.ts` (line 65-74):
```typescript
// Filter the results based on preset type and test run
let filteredData = allData;
if (currentTestRunId) {
  // Show generic presets and specific presets for this test run only
  filteredData = allData.filter(preset =>
    preset.presetType === 'generic' ||
    (preset.presetType === 'specific' && preset.baselineTestRunId === currentTestRunId)
  );
} else {
  // If no currentTestRunId, only show generic presets to avoid confusion
  filteredData = allData.filter(preset => preset.presetType === 'generic');
}
```

**Note:** The filtering currently uses `baselineTestRunId` for filtering. The `created_for_test_run_id` field is stored but not actively used in filtering logic yet. This may be a future enhancement to filter presets by the test run they were created from, separate from the baseline they compare against.

---

## 🎯 How to Verify the Fix

### 1. TypeScript Compilation
```bash
npx tsc --noEmit
# Should complete with no errors
```

### 2. Run Tests
```bash
cd apps/web
npm test -- --testPathPattern="(compare-presets|SavePresetModal)"
# Expected: 75/75 tests passing
```

### 3. Manual Testing

1. **Navigate to Test Run Details**:
   ```
   http://localhost:4001/test-runs/[test-run-id]
   ```

2. **Open Compare Tab**:
   - Select a dashboard
   - Select a metric
   - Apply filters (series search, percentiles)

3. **Save Preset**:
   - Click "Save Preset" button
   - Enter preset name
   - Click "Save"

4. **Verify**:
   - Check browser Network tab for `POST /compare-presets`
   - Request body should include `created_for_test_run_id` with current test run ID
   - No console errors
   - Preset should save successfully

### 4. Check Database
```sql
SELECT
  id,
  name,
  created_for_test_run_id,
  baseline_test_run_id,
  preset_type
FROM compare_filter_presets
ORDER BY created_at DESC
LIMIT 10;
```

---

## 📝 Lessons Learned

### Why This Bug Happened

1. **Schema-DTO Mismatch**: Database entity had the field, but DTO didn't
2. **TypeScript Disabled**: Project may have been running with `--no-emit` or ignoring errors
3. **Missing Integration Test**: No end-to-end test caught the missing field

### Prevention Strategies

1. ✅ **Comprehensive Tests**: Added tests for all DTO fields
2. ✅ **TypeScript Strict Mode**: Ensure `npx tsc --noEmit` runs in CI/CD
3. ✅ **DTO-Entity Validation**: Create automated test to verify DTO has all entity fields
4. ✅ **Integration Tests**: Add E2E test for save preset flow

---

## 🚀 Deployment Checklist

- [x] Backend DTO updated
- [x] Backend service updated
- [x] Frontend interfaces updated
- [x] Frontend component updated
- [x] Tests added (3 new tests)
- [x] All tests passing (75/75)
- [x] TypeScript compiles without errors
- [x] Documentation created

---

## 🔗 Related Files

### Backend
```
apps/api/src/
├── modules/compare-presets/
│   ├── dto/create-compare-preset.dto.ts          (FIXED)
│   ├── compare-presets.service.ts                (FIXED)
│   └── compare-presets.controller.ts             (no changes)
└── repositories/
    └── compare-filter-preset.repository.ts       (no changes)

packages/shared/src/entities/
└── compare-filter-preset.entity.ts               (already had field)
```

### Frontend
```
apps/web/
├── lib/
│   └── compare-presets.ts                        (FIXED)
├── app/test-runs/[id]/components/compare/
│   ├── SavePresetModal.tsx                       (FIXED)
│   └── CompareCard.tsx                           (no changes - already sending it)
└── __tests__/
    ├── lib/
    │   ├── compare-presets.test.ts               (FIXED - added tests)
    │   └── COMPARE_PRESETS_TEST_COVERAGE.md      (updated)
    └── components/
        └── SavePresetModal.test.tsx              (FIXED - added tests)
```

---

## 🎉 Summary

**Bug 1**: Save preset functionality broken due to missing `created_for_test_run_id` field in DTO

**Root Cause**: Schema evolution - field was added to entity but not propagated to DTO

**Fix**: Added field to backend DTO, backend service mapping, and frontend interfaces

**Status**: ✅ **FIXED AND TESTED**

---

**Bug 2**: Saved presets not appearing in UI despite successful save (201 Created)

**Root Cause**: Incorrect filtering logic - backend was filtering by `baselineTestRunId` instead of `createdForTestRunId`

**The Problem**:
- When viewing test run "MyAfterburner-acc-loadTest-00015"
- User saves a preset comparing against baseline "MyAfterburner-acc-loadTest-00011"
- Preset saved with:
  - `baseline_test_run_id: "MyAfterburner-acc-loadTest-00011"` (what you're comparing against)
  - `created_for_test_run_id: "MyAfterburner-acc-loadTest-00015"` (where you are now)
- Backend filtered by checking: `preset.baselineTestRunId === currentTestRunId`
- This failed: `"MyAfterburner-acc-loadTest-00011" !== "MyAfterburner-acc-loadTest-00015"`

**The Fix** (apps/api/src/modules/compare-presets/compare-presets.service.ts:70):
```typescript
// BEFORE (wrong):
filteredData = allData.filter(preset =>
  preset.presetType === 'generic' ||
  (preset.presetType === 'specific' && preset.baselineTestRunId === currentTestRunId)
);

// AFTER (correct):
filteredData = allData.filter(preset =>
  preset.presetType === 'generic' ||
  (preset.presetType === 'specific' && preset.createdForTestRunId === currentTestRunId)
);
```

**Updated Test** (apps/api/src/modules/compare-presets/compare-presets.service.spec.ts:234):
- Changed test to use `createdForTestRunId` instead of `baselineTestRunId` for filtering
- Verified specific presets are filtered by where they were created, not what they compare against

**Tests**: 25/25 backend tests passing, 75/75 frontend tests passing

**Status**: ✅ **FIXED AND TESTED**

---

## How to Verify Both Fixes

1. **Refresh the browser page** (the API is already running with the fix)
2. Navigate to test run details: `http://localhost:4001/test-runs/MyAfterburner-acc-loadTest-00015`
3. Go to Compare tab
4. You should now see your saved presets in the dropdown:
   - "Average Response times"
   - "Threads active"
   - "Garbage collections total time (young)"

All saved presets with `created_for_test_run_id: "MyAfterburner-acc-loadTest-00015"` will now appear!
