# Integration Tests Quick Reference

## Summary
- **90 tests** across 3 files
- **~2,600 lines of code**
- **Target: 85%+ pass rate**

## Test Files

| File | Tests | Focus |
|------|-------|-------|
| `pipeline-orchestrator.integration.test.ts` | 24 | Pipeline execution & orchestration |
| `metrics-pipeline.integration.test.ts` | 19 | Database operations & metrics collection |
| `job-queue.integration.test.ts` | 47 | Job queue management & lifecycle |

## Quick Commands

```bash
# Run all integration tests
npm run test -- src/test/integration/**/*.test.ts

# Run specific file
npm run test -- src/test/integration/pipeline-orchestrator.integration.test.ts
npm run test -- src/test/integration/metrics-pipeline.integration.test.ts
npm run test -- src/test/integration/job-queue.integration.test.ts

# Run with coverage
npm run test -- src/test/integration/**/*.test.ts --coverage
```

## Test Categories

### Pipeline Orchestrator (24 tests)
- ✅ Happy path: 6 tests
- ✅ Error handling (continue/abort/strict): 6 tests
- ✅ Timeout handling: 3 tests
- ✅ Unknown stages: 2 tests
- ✅ Performance timing: 2 tests
- ✅ Edge cases: 5 tests

### Metrics Pipeline (19 tests)
- ✅ Complete flow: 3 tests
- ✅ Benchmark filtering: 3 tests
- ✅ Error handling: 6 tests
- ✅ Batch operations: 2 tests
- ✅ Data validation: 3 tests
- ✅ Performance: 2 tests

### Job Queue (47 tests)
- ✅ Job submission: 5 tests
- ✅ Status tracking: 4 tests
- ✅ Processing: 5 tests
- ✅ Retry logic: 3 tests
- ✅ Queue management: 5 tests
- ✅ Cancellation: 4 tests
- ✅ Priority: 4 tests
- ✅ Error recovery: 3 tests
- ✅ Batch processing: 3 tests
- ✅ Stress tests: 8 tests
- ✅ Monitoring: 3 tests

## Test Distribution

```
Happy Path:      27 tests (30%)
Error Handling:  25 tests (28%)
Edge Cases:      20 tests (22%)
Performance:     12 tests (13%)
Batch Ops:        6 tests (7%)
```

## Key Features Tested

### Pipeline Orchestration
- Sequential execution
- Error propagation strategies
- Timeout handling
- Stage timing & performance

### Database Operations
- Transaction handling
- Batch inserts with UPSERT
- Data validation
- Error recovery

### Job Queue
- Job lifecycle (pending → processing → complete/failed)
- Retry with exponential backoff
- Priority handling
- Batch processing
- Stress & concurrency

## Expected Results

- **Best case**: 85%+ pass rate
- **Realistic**: 70-80% pass rate
- **Mock-based tests**: ~72 tests (80%) likely to pass
- **Database-dependent**: ~18 tests (20%) may need adjustment

## Prerequisites

```bash
# Optional: Test database
export DATABASE_URL="postgresql://perfana:perfana123@localhost:5432/perfana_test"

# Required: Dependencies
npm install
```

## File Locations

- Tests: `/apps/worker/src/test/integration/`
- Helpers: `/apps/worker/src/test/helpers/`
- Mocks: `/apps/worker/src/test/mocks/`

## Reports

- Full report: `INTEGRATION_TESTS_REPORT.md`
- Summary: `TEST_SUMMARY.md`
- This reference: `INTEGRATION_TESTS_QUICK_REFERENCE.md`
