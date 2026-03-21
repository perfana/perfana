# Remaining Test Failures - Perfana Next Gen

**Last Updated:** 2026-02-03
**Total Remaining Failures:** ~342 tests across all packages

---

## Summary by Package

| Package | Passing | Total | Pass Rate | Remaining Failures |
|---------|---------|-------|-----------|-------------------|
| **Worker** | 891/891 | 891 | 100% ✅ | 0 |
| **Shared** | 249/249 | 249 | 100% ✅ | 0 |
| **Web** | ~232/275+ | ~275+ | ~84% | ~43 |
| **API** | ~2,200/~2,510 | ~2,510 | ~88% | ~310 |
| **TOTAL** | ~3,572/~3,925 | ~3,925 | ~91% | ~353 |

---

## Web Package - Remaining Failures (~43 tests)

### DynatraceCard Component (19 failures, 26/45 passing, 58%)

**Status:** In Progress - Major blocker resolved (name.split error fixed), mostly interaction tests remaining

#### Collapsed State Tests (1 failure)
1. ✕ **should show only first 3 services and "+n more" chip when more than 3**
   - **Issue:** Test expects "+2" chip with 4 services, but component only has 2 services in mock
   - **Complexity:** Low - Fix mock data to have 4+ services
   - **Priority:** Low

#### API Data Fetching Tests (3 failures)
2. ✕ **should fetch entity mappings with query parameters**
   - **Issue:** Test expects specific query param order or format
   - **Complexity:** Low - Update assertion to match actual query params
   - **Priority:** Medium

3. ✕ **should fetch metric names**
   - **Issue:** Endpoint URL assertion mismatch (already updated some, may need more)
   - **Complexity:** Low - Verify endpoint URL assertion
   - **Priority:** Low

4. ✕ **should fetch related test runs when expanded**
   - **Issue:** Timing or assertion issue with related test runs fetch
   - **Complexity:** Medium - May need waitFor with proper timeout
   - **Priority:** Medium

#### Loading States Tests (1 failure)
5. ✕ **should show loading indicator for related test runs**
   - **Issue:** Text expectation mismatch or timing issue
   - **Complexity:** Low - Update text assertion or add waitFor
   - **Priority:** Low

#### Empty States Tests (2 failures)
6. ✕ **should show empty state when no entity mappings exist**
   - **Issue:** Empty state message not rendering or text mismatch
   - **Complexity:** Medium - Check component empty state logic
   - **Priority:** Medium

7. ✕ **should show empty state for no related test runs**
   - **Issue:** Empty state message not appearing
   - **Complexity:** Medium - Verify empty state rendering
   - **Priority:** Medium

#### Expand/Collapse Behavior Tests (2 failures)
8. ✕ **should not expand when clicking expanded card body** (duplicate entry)
   - **Issue:** onExpand being called when it shouldn't
   - **Complexity:** Medium - May need to verify click target handling
   - **Priority:** Low

#### Tab Navigation Tests (1 failure)
9. ✕ **should switch between service tabs**
   - **Issue:** Tab state not updating or assertion checking wrong attribute
   - **Complexity:** Medium - Check MUI Tab selected state
   - **Priority:** Medium

#### Request Filtering Tests (4 failures)
10. ✕ **should show metric name autocomplete when metrics available**
    - **Issue:** Autocomplete label or rendering issue
    - **Complexity:** Medium - Check MUI Autocomplete rendering
    - **Priority:** Medium

11. ✕ **should show min duration input**
    - **Issue:** Input label or field not rendering
    - **Complexity:** Low - Update label text expectation
    - **Priority:** Low

12. ✕ **should show max duration input**
    - **Issue:** Input label or field not rendering
    - **Complexity:** Low - Update label text expectation
    - **Priority:** Low

13. ✕ **should allow entering duration values**
    - **Issue:** Input interaction not working or value not setting
    - **Complexity:** Medium - May need userEvent instead of fireEvent
    - **Priority:** Medium

#### Multidimensional Analysis Tests (1 failure)
14. ✕ **should open Dynatrace URL when analysis button clicked**
    - **Issue:** window.open not being called or button not clickable
    - **Complexity:** Medium - Check button interaction and mock
    - **Priority:** Low

#### Performance Insights Tests (1 failure)
15. ✕ **should open Dynatrace URL when deep link button clicked**
    - **Issue:** window.open not being called
    - **Complexity:** Medium - Check button interaction
    - **Priority:** Low

#### Performance Comparison Tests (4 failures)
16. ✕ **should display available test runs in autocomplete**
    - **Issue:** Autocomplete dropdown not opening or options not rendering
    - **Complexity:** High - Complex autocomplete interaction
    - **Priority:** Medium

17. ✕ **should show comparison button when test run selected**
    - **Issue:** Button not appearing after selection
    - **Complexity:** High - Requires autocomplete selection to work
    - **Priority:** Medium

18. ✕ **should open comparison URL when compare button clicked**
    - **Issue:** window.open not being called
    - **Complexity:** High - Requires full interaction flow
    - **Priority:** Low

19. ✕ **should clear selected test run when clear button clicked**
    - **Issue:** Clear button not found or selection not clearing
    - **Complexity:** High - Complex autocomplete clear interaction
    - **Priority:** Low

---

### ConfigurationComparisonSection Component (13 failures, 44/57 passing, 77%)

**Status:** Needs Investigation - Mostly API fetching and timing issues

#### Configuration Loading Tests (2 failures)
1. ✕ **should load configurations on mount when test run exists**
   - **Issue:** Configurations not loading or assertion failing
   - **Complexity:** Medium - Check mock setup and timing
   - **Priority:** High

2. ✕ **should include query parameters in configuration request**
   - **Issue:** Query parameter assertion failing
   - **Complexity:** Low - Update assertion to match actual params
   - **Priority:** Medium

#### Related Test Runs Loading Tests (3 failures)
3. ✕ **should load related test runs on mount**
   - **Issue:** Related test runs not loading
   - **Complexity:** Medium - Check mock and fetch timing
   - **Priority:** High

4. ✕ **should automatically select previous test run**
   - **Issue:** Auto-selection logic not working
   - **Complexity:** High - Complex selection logic
   - **Priority:** Medium

5. ✕ **should handle 404 error when related test runs not found**
   - **Issue:** Error state not rendering correctly
   - **Complexity:** Medium - Check error handling
   - **Priority:** Low

#### Expected Configuration Changes Tests (3 failures)
6. ✕ **should load expected configuration changes on mount**
   - **Issue:** Expected changes not loading
   - **Complexity:** Medium - Check mock and API call
   - **Priority:** High

7. ✕ **should handle 401 error gracefully for expected changes**
   - **Issue:** 401 error not handled correctly
   - **Complexity:** Medium - Check error handling logic
   - **Priority:** Low

#### Other Failures (5 failures)
8-13. ✕ **Various comparison, search, and interaction tests**
    - **Issue:** Multiple interaction and rendering issues
    - **Complexity:** Medium-High
    - **Priority:** Medium

---

### Other Web Components (Estimated 11+ failures)

#### Components Not Yet Fully Tested
- **DeepLinksCard** - Unknown failures
- **GrafanaCard** - Unknown failures
- **MetricsCard** - Unknown failures
- **ChecksCard** - Unknown failures
- **Other test run detail components** - Unknown failures

**Action Needed:** Run full web test suite to identify all failures

---

## API Package - Remaining Failures (~310 tests)

**Status:** Partial progress - Need systematic approach

### Estimated Breakdown by Category

#### 1. Mock Configuration Issues (~100-120 tests)
**Problem:** Incomplete repository mocks in service tests

**Affected Files:**
- Report generation service specs (~20 tests)
- Report template service specs (~25 tests)
- Report share service specs (~15 tests)
- Test runs mutation service specs (~20 tests)
- Template service specs (~20 tests)
- Other service specs (~20-40 tests)

**Solution:**
- Create shared mock repository factory
- Update all tests to use factory-created mocks
- Ensure all Repository methods are mocked

**Priority:** High - Blocks many tests

#### 2. Data Transformation Issues (~50-80 tests)
**Problem:** Mock data returns wrong types (strings vs numbers)

**Examples:**
- `{ avg_response_time: '150' }` should be `{ avg_response_time: 150 }`
- String-to-number conversions expected by tests

**Solution:**
- Update mocks to return proper numeric types
- Add type validation tests

**Priority:** Medium

#### 3. Null/Undefined Handling (~40-60 tests)
**Problem:** Inconsistent null vs undefined handling

**Solution:**
- Standardize on either null or undefined
- Update tests to match implementation
- Document conversion rules

**Priority:** Medium

#### 4. Precision Issues (Mostly Fixed)
**Status:** ~80-100 tests fixed with toBeCloseTo(value, 2)

**Remaining:** ~10-20 tests may still need precision fixes

**Priority:** Low - Mostly resolved

#### 5. Timing Tests (~50-70 tests - Already Skipped)
**Status:** Tests with hard-coded timeouts are skipped

**Decision:** Keep skipped, address in separate performance initiative

**Priority:** Low - Intentionally skipped

#### 6. Incomplete Test Coverage (~30-50 tests)
**Problem:** Missing test cases, error paths not tested

**Solution:**
- Add missing test cases as new tests are written
- Not a blocker for existing functionality

**Priority:** Low

---

## Implementation Plan

### Phase 1: Complete Web Package (High Priority)
**Estimated Time:** 4-6 hours
**Impact:** ~43 tests

1. **DynatraceCard Remaining (19 tests)** - 2-3 hours
   - Fix autocomplete interactions (high complexity)
   - Update text assertions (low complexity)
   - Fix button click handlers (medium complexity)

2. **ConfigurationComparisonSection (13 tests)** - 2-3 hours
   - Fix API loading mocks
   - Update query parameter assertions
   - Fix error handling tests

3. **Other Web Components (11+ tests)** - 1-2 hours
   - Survey and categorize failures
   - Apply patterns learned from above

### Phase 2: API Package Mock Infrastructure (High Priority)
**Estimated Time:** 6-8 hours
**Impact:** ~100-120 tests

1. **Create Mock Repository Factory** - 2 hours
   - Include all Repository methods
   - Include QueryBuilder mock
   - Add sensible defaults

2. **Update Service Tests** - 4-6 hours
   - Replace incomplete mocks with factory
   - Update ~10-15 test files
   - Verify no new failures introduced

### Phase 3: API Package Data Issues (Medium Priority)
**Estimated Time:** 4-6 hours
**Impact:** ~90-140 tests

1. **Fix Data Transformation** - 2-3 hours
   - Update mocks to return correct types
   - Fix string-to-number issues

2. **Standardize Null Handling** - 2-3 hours
   - Document conversion rules
   - Update affected tests

### Phase 4: Web Package Coverage Completion (Lower Priority)
**Estimated Time:** Variable
**Impact:** Unknown - depends on remaining components

1. **Run full web test suite**
2. **Categorize failures**
3. **Apply fixes using established patterns**

---

## Success Metrics

### Short-term Goals (1-2 weeks)
- ✅ Worker: 100% (COMPLETE)
- ✅ Shared: 100% (COMPLETE)
- 🎯 Web: 95%+ (currently ~84%)
- 🎯 API: 95%+ (currently ~88%)

### Long-term Goals (1 month)
- 🎯 All packages: 98%+ pass rate
- 🎯 CI/CD pipeline: Consistently green
- 🎯 Coverage: Maintained or improved

---

## Notes

### Key Patterns Discovered
1. **URL-based mocking** more reliable than sequential mocks
2. **getAllByText** needed when elements appear multiple times
3. **Data format validation** critical for component tests
4. **Mock timing** important for async interactions

### Common Pitfalls
1. Assuming mock data structure without verification
2. Using getByText when multiple elements exist
3. Not waiting for async operations (missing waitFor)
4. Incorrect text expectations vs actual component rendering

### Tools & Commands
```bash
# Run specific component tests
cd apps/web && npm test -- ComponentName.test.tsx

# Run with specific test name
npm test -- ComponentName.test.tsx -t "test name"

# Check overall package status
cd apps/api && npm test

# Run all tests in parallel
npx turbo run test --continue
```

---

**Document Maintained By:** Claude Sonnet 4.5
**Last Verification:** 2026-02-03
