# Test Files Requiring Updates After Refactoring

## Overview
After the large files refactoring, several test files need to be updated to reflect the new controller and service structure.

## Test Files With TypeScript Errors

### 1. `/apps/api/src/modules/test-runs/test-runs.controller.spec.ts`

**Issue**: Tests methods that have been moved to separate controllers during refactoring.

**Methods moved to other controllers**:
- `getTestRunConfigs` → Likely in ConfigController
- `getRelatedTestRuns` → Needs to be identified
- `getExpectedConfigChanges` → ConfigController
- `createExpectedConfigChange` → ConfigController
- `deleteExpectedConfigChange` → ConfigController
- `getLatestConfigKeys` → ConfigController
- `markAsChangepoint` → TestRunsAnalysisController
- `removeChangepoint` → TestRunsAnalysisController
- `createOrUpdateDsCompareConfig` → TestRunsComparisonController
- `getDsCompareConfig` → TestRunsComparisonController
- `updateDsCompareConfig` → TestRunsComparisonController
- `deleteDsCompareConfig` → TestRunsComparisonController
- `getAnomalyDetectionResults` → TestRunsAnalysisController
- `deleteAnomalyData` → TestRunsAnalysisController
- `getDsAdaptResult` → TestRunsAnalysisController
- `getTestRunsAfterChangepoint` → TestRunsAnalysisController

**Methods remaining in TestRunsController** (these tests should pass):
- `findAll()` - Get all test runs (paginated)
- `findByTestRunIdAndParams()` - Get single test run
- `updateAnnotations()` - Update annotations
- `updateTags()` - Update tags
- `delete()` - Delete test run

**Action Required**:
1. Create separate test files for each new controller:
   - `config.controller.spec.ts`
   - `test-runs-analysis.controller.spec.ts`
   - `test-runs-comparison.controller.spec.ts`
   - etc.
2. Move the relevant tests from `test-runs.controller.spec.ts` to the new test files
3. Update imports and mock setup for each new test file

### 2. `/apps/api/src/modules/reports/__tests__/report-generation.controller.spec.ts`

**Issue**: Mock return types don't match expected types after refactoring.

**TypeScript Errors**:
```
Line 642: reportGenerationService.updateStatus.mockResolvedValue(undefined);
Line 661: reportGenerationService.updateStatus.mockResolvedValue(undefined);
Line 700: reportGenerationService.updateStatus.mockResolvedValue(undefined);
Line 849: reportGenerationService.updateStatus.mockResolvedValue(undefined);
```

**Root Cause**: The `updateStatus` method signature changed during refactoring and now expects a `GeneratedReport` return value, not `undefined`.

**Action Required**:
Update all `mockResolvedValue(undefined)` calls to return a proper mock report object:
```typescript
reportGenerationService.updateStatus.mockResolvedValue(mockReport);
```

## Temporary Workaround

To run tests while these issues are being fixed:

```bash
# Run only specific test files that don't have errors
npm test -- --testPathPattern="report-utils.service.spec"

# Skip TypeScript compilation errors (not recommended for CI)
npm test -- --no-coverage
```

## Priority

**High Priority** (blocking test suite):
1. Fix report-generation.controller.spec.ts (simple mock value changes)
2. Create new controller test files for split test-runs controllers

**Medium Priority** (existing functionality works):
1. Migrate remaining tests from old test-runs.controller.spec.ts
2. Ensure test coverage remains >80%

## Related Refactorings

These test updates are related to the following refactorings:
- **Task #3**: Refactor test-runs.controller.ts (1,357 lines) into domain controllers
- Report generation service refactoring (3,129 → 630 lines)

## Verification Checklist

Once tests are updated:
- [ ] All controller test files compile without TypeScript errors
- [ ] All tests pass
- [ ] Test coverage remains above 80%
- [ ] No duplicate tests across controller test files
- [ ] Mock setup is correct for each new controller
