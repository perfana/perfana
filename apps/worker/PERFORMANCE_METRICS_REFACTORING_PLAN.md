# Performance Test Metrics Pipeline Refactoring Plan

**Date**: 2025-12-01
**Status**: In Progress
**Type**: Greenfield Change (No backward compatibility)

## Overview

Transform the Performance Test Metrics Pipeline from storing single aggregated values per test run to storing complete time-series data with dynamic bucket sizing. This enables more granular analysis and better performance regression detection.

---

## Table Structure (Verified)

### ds_metrics Table
```typescript
{
  test_run_id: string;                    // Test run UUID
  application_dashboard_id: string;       // Dashboard UUID
  dashboard_uid: string;                  // Dashboard UID
  panel_id: number;                       // Panel identifier
  time: Date;                             // SINGLE timestamp per record
  metric_name: string;                    // FULL name: "requests.checkout.response_time.avg"
  panel_title: string | null;
  dashboard_label: string | null;
  benchmark_ids: string[] | null;
  errors: Record<string, any> | null;
  timestep: number | null;
  ramp_up: boolean;
  value: number;                          // SINGLE numeric value
  unit: string | null;
}
```

**Unique constraint**: `(test_run_id, application_dashboard_id, panel_id, metric_name, time)`

**To store time-series**: Create MULTIPLE records with different `time` values

### ds_compare_config Table
```typescript
{
  id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  application_dashboard_id: string;
  panel_id: number;
  metric_name: string;                    // EXACT match with ds_metrics.metric_name
  config_data: {
    metricClassification: {
      classification: string;             // "RED_duration", "RED_rate", "RED_errors"
      higherIsBetter: boolean | null;
    };
    thresholds: {
      aggregation: string;                // "avg", "p90", "p95", "p99", "apdex"
      percentageThreshold: number;
      iqrThreshold: number;
      absoluteThreshold: number | null;
    };
    defaultValueIfControlGroupMissing: number;
  };
}
```

**Unique constraint**: `(system_under_test_id, test_environment, workload, application_dashboard_id, panel_id, metric_name)`

**One config per unique metric_name** (which includes aggregation suffix)

---

## Current vs New Approach

### Current (1 test run = 1 record per metric):
```typescript
// ds_metrics:
{ metric_name: "requests.checkout.response_time.avg", time: test_end_time, value: 125.4 }

// ds_compare_config:
{ metric_name: "requests.checkout.response_time.avg", config_data: { aggregation: "avg" } }
```

### New (1 test run = N records per metric, N = time buckets):
```typescript
// ds_metrics (60 records for 60s test with 1s buckets):
{ metric_name: "requests.checkout.response_time.avg", time: "10:00:00Z", value: 125.4 }
{ metric_name: "requests.checkout.response_time.avg", time: "10:00:01Z", value: 128.1 }
{ metric_name: "requests.checkout.response_time.avg", time: "10:00:02Z", value: 122.7 }
... (60 total)

// ds_compare_config (ONE per aggregation):
{ metric_name: "requests.checkout.response_time.avg", config_data: { aggregation: "avg" } }
```

---

## Implementation Phases

### Phase 1: Dynamic Bucket Sizing Algorithm ✅

**File**: `apps/worker/src/utils/time-bucketing.ts` (new file)

**Algorithm**:
```typescript
function calculateBucketSize(
  testDurationSeconds: number,
  targetDataPoints: number = 1000
): number {
  const idealBucketSize = Math.ceil(testDurationSeconds / targetDataPoints);

  // Round to sensible bucket sizes
  if (idealBucketSize <= 1) return 1;        // 1s buckets
  if (idealBucketSize <= 5) return 5;        // 5s buckets
  if (idealBucketSize <= 10) return 10;      // 10s buckets
  if (idealBucketSize <= 30) return 30;      // 30s buckets
  if (idealBucketSize <= 60) return 60;      // 1min buckets
  return Math.ceil(idealBucketSize / 60) * 60; // Round to nearest minute
}
```

**Examples**:
- 60s test → 1s buckets (60 data points)
- 300s test → 1s buckets (300 data points)
- 1800s test → 5s buckets (360 data points)
- 3600s test → 5s buckets (720 data points)
- 7200s test → 10s buckets (720 data points)

**Configuration**: Make `targetDataPoints` configurable via environment variable

---

### Phase 2: Time-Bucketing Utilities ✅

**File**: `apps/worker/src/utils/time-bucketing.ts`

**Functions**:
1. `bucketTimeSeriesData()` - Groups raw data into time buckets
2. `calculateBucketSize()` - Dynamic bucket size based on duration
3. `aggregateValuesInBucket()` - Calculate statistics per bucket

**Implementation**:
```typescript
interface TimeBucket {
  timestamp: Date;
  values: number[];
  count: number;
}

function bucketTimeSeriesData(
  data: Array<{ timestamp: Date; value: number }>,
  bucketSizeSeconds: number,
  startTime: Date,
  endTime: Date
): TimeBucket[]
```

---

### Phase 3: Add Apdex Aggregation to Statistics Pipeline ✅

**File**: `apps/worker/src/utils/statistics.ts`

**Add new function**:
```typescript
export function calculateApdex(
  values: number[],
  satisfiedThreshold: number,
  toleratingThreshold: number
): number | null {
  if (values.length === 0) return null;

  let satisfied = 0;
  let tolerating = 0;

  for (const value of values) {
    if (value <= satisfiedThreshold) satisfied++;
    else if (value <= toleratingThreshold) tolerating++;
  }

  return (satisfied + tolerating / 2) / values.length;
}
```

---

### Phase 4: Update Constants and Panel IDs

**File**: `apps/worker/src/constants/performance-metrics.ts`

**Changes**:
```typescript
// BEFORE:
export const PERFORMANCE_METRIC_PANEL_IDS = {
  RESPONSE_TIME_AVG: 1,
  RESPONSE_TIME_P50: 2,
  RESPONSE_TIME_P95: 3,
  RESPONSE_TIME_P99: 4,
  RESPONSE_TIME_MIN: 5,
  RESPONSE_TIME_MAX: 6,
  SUCCESS_RATE: 9,
  // ...
};

// AFTER:
export const PERFORMANCE_METRIC_PANEL_IDS = {
  RESPONSE_TIME: 1,                    // Consolidated
  RESPONSE_LATENCY: 7,
  RESPONSE_CONNECT_TIME: 8,
  ERROR_RATE: 9,                       // Renamed from SUCCESS_RATE
  THROUGHPUT: 10,
  APDEX_SCORE_REQUESTS: 11,
  ERROR_COUNT: 12,
  AVG_ACTIVE_THREADS: 14,
  MAX_ACTIVE_THREADS: 15,
};

export const AGGREGATION_TYPES = {
  AVG: 'avg',
  P50: 'p50',
  P90: 'p90',
  P95: 'p95',
  P99: 'p99',
  APDEX: 'apdex',  // New
} as const;
```

---

### Phase 5: Refactor Response Time Metrics

**Current**: 6 separate ds_metrics records (avg, p50, p95, p99, min, max)

**New**: N × 4 ds_metrics records (N buckets × 4 aggregations: avg, p90, p95, p99)

**Metric naming**:
- `requests.checkout.response_time.avg`
- `requests.checkout.response_time.p90`
- `requests.checkout.response_time.p95`
- `requests.checkout.response_time.p99`

**ds_compare_config** (4 entries):
```typescript
{ metric_name: "requests.checkout.response_time.avg", panel_id: 1, config_data: { aggregation: "avg", classification: "RED_duration" } }
{ metric_name: "requests.checkout.response_time.p90", panel_id: 1, config_data: { aggregation: "p90", classification: null } }
{ metric_name: "requests.checkout.response_time.p95", panel_id: 1, config_data: { aggregation: "p95", classification: null } }
{ metric_name: "requests.checkout.response_time.p99", panel_id: 1, config_data: { aggregation: "p99", classification: null } }
```

**Implementation**:
1. Bucket raw response_time data by time
2. For each bucket, calculate avg, p90, p95, p99
3. Create ds_metrics record for each bucket × aggregation combination
4. Create 4 ds_compare_config entries (one per aggregation)

---

### Phase 6: Refactor Latency & Connect Time

**Current**: 1 record per metric (avg only)

**New**: N records per metric (N = number of buckets, avg only)

**Metric naming**:
- `requests.checkout.response_latency` (no suffix, just raw values averaged per bucket)
- `requests.checkout.response_connect_time` (no suffix)

**ds_compare_config**: NONE (not used for comparisons)

**Implementation**:
1. Bucket raw latency/connect_time data by time
2. For each bucket, calculate average
3. Create ds_metrics record for each bucket
4. NO ds_compare_config entries

---

### Phase 7: Convert Success Rate → Error Rate

**Current**: `success_rate` (0-100%, single value)

**New**: `error_rate` (0-100%, N values)

**Metric naming**: `requests.checkout.error_rate`

**Calculation per bucket**:
```typescript
error_rate = (failed_count / total_count) * 100
```

**ds_compare_config**:
```typescript
{
  metric_name: "requests.checkout.error_rate",
  panel_id: 9,
  config_data: {
    aggregation: "avg",
    metricClassification: {
      classification: "RED_errors",
      higherIsBetter: false
    }
  }
}
```

---

### Phase 8: Refactor Throughput

**Current**: Single throughput value (req/s)

**New**: N throughput values (one per bucket)

**Metric naming**: `requests.checkout.throughput`

**Calculation per bucket**:
```typescript
throughput = count_in_bucket / bucket_size_seconds
```

**ds_compare_config**:
```typescript
{
  metric_name: "requests.checkout.throughput",
  panel_id: 10,
  config_data: {
    aggregation: "avg",
    metricClassification: {
      classification: "RED_rate",
      higherIsBetter: true
    }
  }
}
```

---

### Phase 9: Refactor Apdex Score

**Current**: Single apdex score (0.0-1.0)

**New**: N apdex scores (one per bucket)

**Metric naming**: `requests.checkout.apdex_score`

**Calculation per bucket**:
```typescript
apdex = (satisfied_count + tolerating_count / 2) / total_count
```

**ds_compare_config**:
```typescript
{
  metric_name: "requests.checkout.apdex_score",
  panel_id: 11,
  config_data: {
    aggregation: "apdex",
    metricClassification: {
      classification: "RED_duration",
      higherIsBetter: true
    }
  }
}
```

---

## Data Volume Estimates

| Test Duration | Bucket Size | Buckets | Request Types | Metrics/Type | Records/Metric | Total Records |
|--------------|-------------|---------|---------------|--------------|----------------|---------------|
| 60s          | 1s          | 60      | 20            | 4            | 60             | ~4,800        |
| 300s         | 1s          | 300     | 20            | 4            | 300            | ~24,000       |
| 1800s        | 5s          | 360     | 20            | 4            | 360            | ~28,800       |
| 3600s        | 5s          | 720     | 20            | 4            | 720            | ~57,600       |
| 7200s        | 10s         | 720     | 20            | 4            | 720            | ~57,600       |

**Plus additional metrics**: Error rate, throughput, latency, connect time, apdex

**Total estimate**: 30,000-150,000 records per test run (vs current ~50-200)

---

## Pipeline Implementation Changes

**File**: `apps/worker/src/pipelines/PerformanceTestMetricsPipeline.ts`

**Main execute() flow**:
```typescript
async execute(testRunId: string) {
  // 1. Load test run metadata
  const testRun = await this.getTestRun(testRunId);
  const testDuration = (testRun.end_time - testRun.start_time) / 1000;

  // 2. Calculate dynamic bucket size
  const bucketSize = calculateBucketSize(testDuration);

  // 3. Process requests_raw with bucketing
  const requestsData = await this.loadRequestsRaw(testRunId);
  const groupedRequests = this.groupByTransactionSampler(requestsData);

  for (const [key, requests] of groupedRequests) {
    // Bucket data by time
    const bucketedData = bucketTimeSeriesData(requests, bucketSize, testRun.start_time, testRun.end_time);

    // For each bucket, create ds_metrics records for each aggregation
    for (const bucket of bucketedData) {
      const values = bucket.values;

      // Response Time aggregations
      const avg = calculateAverage(values);
      const p90 = calculatePercentile(values, 90);
      const p95 = calculatePercentile(values, 95);
      const p99 = calculatePercentile(values, 99);

      dsMetrics.push(
        { metric_name: `${key}.response_time.avg`, time: bucket.timestamp, value: avg, panel_id: 1 },
        { metric_name: `${key}.response_time.p90`, time: bucket.timestamp, value: p90, panel_id: 1 },
        { metric_name: `${key}.response_time.p95`, time: bucket.timestamp, value: p95, panel_id: 1 },
        { metric_name: `${key}.response_time.p99`, time: bucket.timestamp, value: p99, panel_id: 1 }
      );

      // Error rate
      const errorRate = (bucket.failedCount / bucket.totalCount) * 100;
      dsMetrics.push({ metric_name: `${key}.error_rate`, time: bucket.timestamp, value: errorRate, panel_id: 9 });

      // Throughput
      const throughput = bucket.count / bucketSize;
      dsMetrics.push({ metric_name: `${key}.throughput`, time: bucket.timestamp, value: throughput, panel_id: 10 });

      // Apdex
      const apdex = calculateApdex(values, satisfiedThreshold, toleratingThreshold);
      dsMetrics.push({ metric_name: `${key}.apdex_score`, time: bucket.timestamp, value: apdex, panel_id: 11 });
    }

    // Create ds_compare_config entries (ONCE per metric, not per bucket)
    compareConfigs.push(
      { metric_name: `${key}.response_time.avg`, panel_id: 1, config_data: { aggregation: 'avg', classification: 'RED_duration' } },
      { metric_name: `${key}.response_time.p90`, panel_id: 1, config_data: { aggregation: 'p90' } },
      { metric_name: `${key}.response_time.p95`, panel_id: 1, config_data: { aggregation: 'p95' } },
      { metric_name: `${key}.response_time.p99`, panel_id: 1, config_data: { aggregation: 'p99' } },
      { metric_name: `${key}.error_rate`, panel_id: 9, config_data: { aggregation: 'avg', classification: 'RED_errors' } },
      { metric_name: `${key}.throughput`, panel_id: 10, config_data: { aggregation: 'avg', classification: 'RED_rate' } },
      { metric_name: `${key}.apdex_score`, panel_id: 11, config_data: { aggregation: 'apdex', classification: 'RED_duration' } }
    );
  }

  // 4. Batch save
  await this.batchSaveDsMetrics(dsMetrics);
  await this.batchSaveDsCompareConfigs(compareConfigs);
}
```

---

## Testing Strategy

1. **Unit Tests**:
   - Test `calculateBucketSize()` with various durations
   - Test `bucketTimeSeriesData()` with edge cases
   - Test `calculateApdex()` with various thresholds
   - Test aggregation calculations per bucket

2. **Integration Tests**:
   - Test complete pipeline with sample 60s test run
   - Verify ds_metrics record count matches expected
   - Verify ds_compare_config entries created correctly
   - Verify unique constraints are respected

3. **Test Data**:
   - Use existing performance test data from `requests_raw` table
   - Create synthetic test runs with known patterns

---

## Implementation Order

1. ✅ Phase 1: Dynamic bucket sizing algorithm
2. ✅ Phase 2: Time-bucketing utilities
3. ✅ Phase 3: Add apdex to statistics
4. ✅ Phase 4: Update constants
5. Phase 5-9: Refactor each metric type
6. Phase 10: Testing

---

## Notes

- **Greenfield approach**: No backward compatibility needed
- **Database schema**: No changes required, existing structure supports this
- **ADAPT pipeline**: Will need to handle time-series queries and aggregate according to `config_data.aggregation`
- **Performance**: Batch inserts handle large record counts efficiently
- **Storage**: ~30MB per typical test run (acceptable)
