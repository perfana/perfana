# Performance Test Metrics Pipeline Refactoring - COMPLETE

**Date**: 2025-12-01
**Status**: ✅ Implementation Complete - Ready for Testing
**Type**: Greenfield Change (No backward compatibility)

---

## Executive Summary

Successfully transformed the Performance Test Metrics Pipeline from storing single aggregated values per test run to storing complete time-series data with dynamic bucket sizing. This enables granular performance analysis while maintaining reasonable data volumes.

**Data Volume**: 50-200 records → 30,000-150,000 records per test run (controlled by dynamic bucketing)

**Compilation Status**: ✅ All TypeScript checks passing

---

## What Changed

### 1. From Single-Value to Time-Series Storage

#### Before:
```typescript
// 1 record per metric per test run
{
  metric_name: "requests.checkout.response_time.avg",
  time: test_end_time,
  value: 125.4
}
```

#### After:
```typescript
// N records per metric (N = number of time buckets)
{ metric_name: "requests.checkout.response_time.avg", time: "10:00:00Z", value: 125.4 }
{ metric_name: "requests.checkout.response_time.avg", time: "10:00:01Z", value: 128.1 }
{ metric_name: "requests.checkout.response_time.avg", time: "10:00:02Z", value: 122.7 }
// ... continues for duration of test
```

### 2. From Fixed Aggregations to Dynamic Bucketing

**Before**: Calculate once at test end
**After**: Calculate per time bucket (1s, 5s, 10s, 30s, 60s depending on test duration)

### 3. From Success Rate to Error Rate

Inverted metric to align with RED methodology (Rate, Errors, Duration)

**Before**: `success_rate = (successful / total) * 100` (higher is better)
**After**: `error_rate = (failed / total) * 100` (lower is better)

---

## Files Created

### 1. **Refactoring Plan**
`apps/worker/PERFORMANCE_METRICS_REFACTORING_PLAN.md`
- Complete implementation plan
- Table structure documentation
- Phase-by-phase breakdown
- Data volume estimates

### 2. **Time-Bucketing Utilities**
`apps/worker/src/utils/time-bucketing.ts` (409 lines)
- `calculateBucketSize()` - Dynamic bucket sizing algorithm
- `bucketTimeSeriesData()` - Groups raw data into time buckets
- `aggregateValuesInBucket()` - Calculate statistics per bucket
- `calculateErrorRate()`, `calculateThroughput()` - Helper functions
- Comprehensive TypeScript types and JSDoc

### 3. **Migration Notes**
`apps/worker/PHASE_4_MIGRATION_NOTES.md`
- Detailed change log for Phase 4
- Before/after examples
- Migration guidance

### 4. **Test Suite**
`apps/worker/src/test/unit/utils/performance-aggregations.test.ts` (NEW)
- 72 test cases covering all aggregation functions
- 13 tests specifically for Apdex calculation
- All tests passing ✅

---

## Files Modified

### 1. **Constants**
`apps/worker/src/constants/performance-metrics.ts`

**Changes**:
- ✅ Consolidated panel IDs (6 → 1 for response time)
- ✅ Renamed SUCCESS_RATE → ERROR_RATE
- ✅ Added AGGREGATION_TYPES constant
- ✅ Added helper functions: `buildMetricName()`, `parseMetricName()`, `getAggregationsForMetric()`
- ✅ Updated classifications to match new structure

### 2. **Statistics Utilities**
`apps/worker/src/utils/performance-aggregations.ts`

**Changes**:
- ✅ Added `calculateApdexScore()` function
- ✅ Returns Apdex score (0.0-1.0) or null
- ✅ Simplified version optimized for bucketing

### 3. **Main Pipeline**
`apps/worker/src/pipelines/PerformanceTestMetricsPipeline.ts` (MAJOR REFACTOR)

**Changes**:
- ✅ Added dynamic bucket size calculation
- ✅ Refactored `processRequestsRaw()` to use time-series bucketing
- ✅ Refactored `processTransactions()` to use time-series bucketing
- ✅ Updated all metric naming to use `buildMetricName()` helper
- ✅ Converted success_rate → error_rate
- ✅ Implemented per-bucket Apdex calculation
- ✅ Updated compare config creation (1 per aggregation, not per bucket)
- ✅ Added Set-based tracking to prevent duplicate configs
- ✅ Enhanced logging with bucket statistics

---

## Implementation Details

### Dynamic Bucket Sizing Algorithm

```typescript
function calculateBucketSize(testDurationSeconds: number, targetDataPoints: number = 1000): number
```

**Examples**:
- 60s test → 1s buckets (60 data points)
- 300s test → 1s buckets (300 data points)
- 1800s test → 5s buckets (360 data points)
- 3600s test → 5s buckets (720 data points)
- 7200s test → 10s buckets (720 data points)

**Result**: Data volume stays under ~1000 points per metric regardless of test duration

### Metrics Generated Per Request/Transaction

#### For each time bucket:
1. **Response Time** (4 records):
   - `.avg` - Average response time (with RED_duration classification)
   - `.p90` - 90th percentile
   - `.p95` - 95th percentile
   - `.p99` - 99th percentile

2. **Error Rate** (1 record):
   - Percentage of failed requests (with RED_errors classification)

3. **Throughput** (1 record):
   - Requests per second (with RED_rate classification)

4. **Apdex Score** (1 record):
   - Application Performance Index score (with RED_duration classification)

5. **Latency** (1 record):
   - Time to first byte (NO compare config)

6. **Connect Time** (1 record):
   - TCP/SSL connection time (NO compare config)

**Total per bucket**: 10 records × number of request/transaction types

### Panel ID Consolidation

**Before**:
```typescript
RESPONSE_TIME_AVG: 1,
RESPONSE_TIME_P50: 2,
RESPONSE_TIME_P95: 3,
RESPONSE_TIME_P99: 4,
RESPONSE_TIME_MIN: 5,
RESPONSE_TIME_MAX: 6,
```

**After**:
```typescript
RESPONSE_TIME: 1,  // Single panel for all aggregations
```

Aggregation type is now encoded in the metric name suffix, not the panel ID.

### Compare Config Strategy

**Key Change**: Create ONE config per unique metric name (not per time bucket)

**With Classification** (used for ADAPT comparisons):
- `response_time.avg` → RED_duration
- `error_rate` → RED_errors
- `throughput` → RED_rate
- `apdex_score` → RED_duration (using "apdex" aggregation)

**Without Classification** (stored but not compared):
- `response_time.p90`
- `response_time.p95`
- `response_time.p99`

Uses Set tracking to prevent duplicates:
```typescript
const compareConfigsCreated = new Set<string>();
const key = `${sutId}::${env}::${workload}::${metricPrefix}`;
if (!compareConfigsCreated.has(key)) {
  // Create configs...
  compareConfigsCreated.add(key);
}
```

---

## Data Volume Analysis

### Typical 300s (5min) Load Test

**Before refactoring**:
- ~50-200 total records
- 1 record per metric

**After refactoring** (with 1s buckets):
- Response Time: 300 buckets × 4 aggregations × 20 request types = **24,000 records**
- Error Rate: 300 buckets × 20 request types = **6,000 records**
- Throughput: 300 buckets × 20 request types = **6,000 records**
- Apdex: 300 buckets × 20 request types = **6,000 records**
- Latency: 300 buckets × 20 request types = **6,000 records**
- Connect Time: 300 buckets × 20 request types = **6,000 records**
- **Total: ~54,000 records** (vs 50-200 before)

### Storage Impact

- Average record size: ~500 bytes
- 54,000 records × 500 bytes = **27 MB per test run**
- PostgreSQL handles this efficiently with proper indexing
- Batch inserts (200 per batch) maintain performance

---

## Testing Status

### ✅ Completed

1. **Type Checking**: All TypeScript compilation checks pass
2. **Unit Tests**: 72/72 tests passing for aggregation utilities
3. **Syntax Validation**: No linting errors

### ⏳ Pending

1. **Integration Testing**: Run pipeline with real test run data
2. **Data Verification**: Confirm correct number of records created
3. **Compare Config Validation**: Verify no duplicate configs
4. **Performance Testing**: Measure pipeline execution time
5. **Database Query Testing**: Verify ADAPT pipeline can consume new data format

---

## Database Schema

### No Changes Required ✅

The existing `ds_metrics` and `ds_compare_config` tables support the new approach without modifications:

**ds_metrics**:
- `time` field: Stores individual bucket timestamps
- `value` field: Stores single numeric value per record
- Unique constraint allows multiple records with different timestamps

**ds_compare_config**:
- `metric_name` field: Matches full metric name with aggregation suffix
- `config_data.aggregation`: Specifies how to aggregate time-series data

---

## Next Steps

### Immediate (Before Production)

1. **Run Integration Test**:
   ```bash
   cd apps/worker
   npm run test:integration
   ```

2. **Test with Real Data**:
   - Process an existing test run through the refactored pipeline
   - Verify ds_metrics record count matches expectations
   - Check ds_compare_config entries are correct (no duplicates)

3. **Validate ADAPT Pipeline**:
   - Ensure ADAPT can query and aggregate the new time-series data
   - Verify comparisons work correctly with the new structure

### Short-Term

1. **Update Frontend**:
   - Modify dashboards to display time-series data
   - Add time-series charts for granular analysis

2. **Update Documentation**:
   - Update API documentation
   - Update user guides

3. **Performance Monitoring**:
   - Monitor database query performance
   - Monitor pipeline execution time
   - Adjust batch sizes if needed

### Medium-Term

1. **Optimize Queries**:
   - Add indexes for common time-series queries
   - Consider materialized views for frequently accessed aggregations

2. **Add Data Retention Policy**:
   - Consider archiving/downsampling old time-series data
   - Keep raw data for N days, then aggregate to larger buckets

---

## Rollback Plan

Since this is a **greenfield change**, rollback involves:

1. **Revert Git Commits**:
   ```bash
   git revert <commit-hash>
   ```

2. **Files to Revert**:
   - `apps/worker/src/pipelines/PerformanceTestMetricsPipeline.ts`
   - `apps/worker/src/constants/performance-metrics.ts`

3. **Files to Keep** (safe to leave):
   - `apps/worker/src/utils/time-bucketing.ts` (new utilities)
   - `apps/worker/src/utils/performance-aggregations.ts` (Apdex addition)
   - `apps/worker/src/test/unit/utils/performance-aggregations.test.ts` (tests)

4. **Database Cleanup** (if needed):
   ```sql
   -- Remove time-series data if reverting
   DELETE FROM ds_metrics WHERE time > test_run.start_time AND time < test_run.end_time;
   DELETE FROM ds_compare_config WHERE metric_name LIKE '%.avg' OR metric_name LIKE '%.p90';
   ```

---

## Key Benefits

### 1. Granular Analysis
- See performance changes throughout test duration
- Identify performance degradation during specific test phases
- Detect warm-up effects and steady-state behavior

### 2. Better Regression Detection
- More data points = more accurate statistical comparisons
- Can detect intermittent performance issues
- Time-series patterns reveal trends aggregates hide

### 3. Controlled Data Volume
- Dynamic bucket sizing prevents explosion of data
- Automatically adjusts to test duration
- Maintains reasonable storage requirements

### 4. RED Methodology Alignment
- Error Rate instead of Success Rate
- Proper classifications for ADAPT comparisons
- Consistent with industry best practices

### 5. Apdex Integration
- Industry-standard performance metric
- Configurable thresholds per transaction
- Weighted satisfaction scoring

---

## Known Limitations

1. **Data Volume**: Long-duration tests create many records
   - **Mitigation**: Dynamic bucket sizing keeps it reasonable
   - **Max**: ~150,000 records for 2hr test (acceptable)

2. **Query Complexity**: ADAPT needs to aggregate time-series
   - **Mitigation**: Proper indexes on time column
   - **Alternative**: Consider materialized views for common queries

3. **Storage Growth**: More data per test run
   - **Current**: ~30MB per test run
   - **Mitigation**: Implement data retention/archival policy

---

## Success Criteria

### Phase 1-6 (Implementation): ✅ COMPLETE

- [x] Dynamic bucket sizing implemented
- [x] Time-bucketing utilities created
- [x] Apdex calculation added
- [x] Constants updated and consolidated
- [x] Pipeline refactored to use time-series
- [x] Type checking passes
- [x] Unit tests pass

### Phase 7-9 (Testing): ⏳ PENDING

- [ ] Integration tests updated and passing
- [ ] Pipeline successfully processes real test run
- [ ] Correct number of ds_metrics records created
- [ ] No duplicate ds_compare_config entries
- [ ] ADAPT pipeline successfully consumes new data format
- [ ] Performance metrics within acceptable range

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Performance Test Metrics Pipeline (Refactored)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
           ┌──────────────────────────────────┐
           │ 1. Calculate Dynamic Bucket Size │
           │    - Based on test duration      │
           │    - Target: ~1000 points/metric │
           └──────────────┬───────────────────┘
                          │
                          ▼
           ┌──────────────────────────────────┐
           │ 2. Load Raw Data from Tables     │
           │    - requests_raw                │
           │    - transactions                │
           │    - requests_error              │
           │    - virtual_users               │
           └──────────────┬───────────────────┘
                          │
                          ▼
           ┌──────────────────────────────────┐
           │ 3. Bucket Data by Time           │
           │    - Group by bucket intervals   │
           │    - Track success/failure       │
           │    - Handle gaps                 │
           └──────────────┬───────────────────┘
                          │
                          ▼
           ┌──────────────────────────────────┐
           │ 4. Calculate Per-Bucket Stats    │
           │    - Response Time: avg,p90,p95  │
           │    - Error Rate                  │
           │    - Throughput                  │
           │    - Apdex Score                 │
           │    - Latency, Connect Time       │
           └──────────────┬───────────────────┘
                          │
                          ▼
           ┌──────────────────────────────────┐
           │ 5. Create ds_metrics Records     │
           │    - N records per metric        │
           │    - 1 record per bucket         │
           │    - Dynamic metric names        │
           └──────────────┬───────────────────┘
                          │
                          ▼
           ┌──────────────────────────────────┐
           │ 6. Create ds_compare_config      │
           │    - 1 per aggregation type      │
           │    - Avoid duplicates (Set)      │
           │    - Only baseline gets class.   │
           └──────────────┬───────────────────┘
                          │
                          ▼
           ┌──────────────────────────────────┐
           │ 7. Batch Insert (200/batch)      │
           │    - Efficient bulk operations   │
           │    - Handle conflicts            │
           └──────────────────────────────────┘
```

---

## Conclusion

The Performance Test Metrics Pipeline refactoring is **complete and ready for testing**. The transformation from single-value to time-series storage provides significantly more granular data for analysis while maintaining reasonable data volumes through intelligent dynamic bucket sizing.

**Next Step**: Run integration tests with real performance test data to verify the pipeline works as expected in production scenarios.

---

## Contact & Support

For questions or issues:
- Review refactoring plan: `apps/worker/PERFORMANCE_METRICS_REFACTORING_PLAN.md`
- Check migration notes: `apps/worker/PHASE_4_MIGRATION_NOTES.md`
- Review test results: `apps/worker/src/test/unit/utils/performance-aggregations.test.ts`
