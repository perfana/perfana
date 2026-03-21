# Phase 4: Constants Update - Migration Notes

## Date: 2025-12-01

## Summary of Changes

The `apps/worker/src/constants/performance-metrics.ts` file has been successfully updated to support the time-series refactoring approach. This is Phase 4 of the Performance Metrics Refactoring Plan.

## Changes Made

### 1. Panel IDs Consolidated ✅

**Before**: 6 separate panel IDs for response time (AVG, P50, P95, P99, MIN, MAX)
**After**: 1 panel ID for all response time aggregations

```typescript
// OLD
RESPONSE_TIME_AVG: 1,
RESPONSE_TIME_P50: 2,
RESPONSE_TIME_P95: 3,
RESPONSE_TIME_P99: 4,
RESPONSE_TIME_MIN: 5,
RESPONSE_TIME_MAX: 6,

// NEW
RESPONSE_TIME: 1,  // Covers all aggregations
```

**Rationale**: Panel IDs now represent metric categories, not specific aggregations. Aggregation type is encoded in the metric_name suffix (e.g., `response_time.avg`, `response_time.p95`).

### 2. SUCCESS_RATE Renamed to ERROR_RATE ✅

```typescript
// OLD
SUCCESS_RATE: 9,

// NEW
ERROR_RATE: 9,  // Inverted metric: tracks error percentage instead of success percentage
```

**Rationale**: Aligns with RED methodology where we track errors, not success. The calculation changes from `(success/total) * 100` to `(failed/total) * 100`.

### 3. Transaction Panel IDs Consolidated ✅

```typescript
// OLD
TRANSACTION_RESPONSE_TIME_AVG: 11,
TRANSACTION_RESPONSE_TIME_P95: 12,
TRANSACTION_RESPONSE_TIME_P99: 13,
TRANSACTION_SUCCESS_RATE: 14,

// NEW
TRANSACTION_RESPONSE_TIME: 13,  // Covers all aggregations
TRANSACTION_ERROR_RATE: 16,     // Renamed and renumbered
```

### 4. New AGGREGATION_TYPES Constant ✅

```typescript
export const AGGREGATION_TYPES = {
  AVG: 'avg',
  P50: 'p50',
  P90: 'p90',
  P95: 'p95',
  P99: 'p99',
  APDEX: 'apdex',
} as const;

export type AggregationType = typeof AGGREGATION_TYPES[keyof typeof AGGREGATION_TYPES];
```

**Usage**: These types are appended to metric names:
- `requests.checkout.response_time.avg`
- `requests.checkout.response_time.p95`
- `transactions.login.response_time.p99`

### 5. Updated PERFORMANCE_METRIC_CLASSIFICATIONS ✅

- Removed redundant entries for individual aggregations
- Consolidated to category-level classifications
- Changed `SUCCESS_RATE` to `ERROR_RATE` with `RED_errors` classification
- Changed virtual user metrics from `RED_rate` to `load` classification (informational, not for comparisons)

### 6. Updated METRIC_NAME_TEMPLATES ✅

```typescript
// OLD
RESPONSE_TIME_AVG: 'response_time.avg',
RESPONSE_TIME_P50: 'response_time.p50',
// ...

// NEW
RESPONSE_TIME: 'response_time',  // Base name, aggregation added dynamically
```

**Rationale**: Templates now provide base metric names that are combined with aggregation types at runtime.

### 7. Added Helper Functions ✅

Three new utility functions for working with the refactored constants:

1. **`buildMetricName(prefix, baseMetricName, aggregationType?)`**
   - Constructs full metric names from components
   - Example: `buildMetricName("requests.checkout", "response_time", "avg")` → `"requests.checkout.response_time.avg"`

2. **`parseMetricName(metricName)`**
   - Parses a metric name into its components
   - Example: `parseMetricName("requests.checkout.response_time.avg")` → `{ prefix: "requests.checkout", baseName: "response_time", aggregation: "avg" }`

3. **`getAggregationsForMetric(baseMetricName)`**
   - Returns which aggregations should be generated for a metric
   - Example: `getAggregationsForMetric("response_time")` → `["avg", "p90", "p95", "p99"]`

## Backward Compatibility

**⚠️ BREAKING CHANGES**: This is a greenfield refactoring with NO backward compatibility.

The following code will break and needs to be updated in subsequent phases:

### Affected Files

1. **`apps/worker/src/pipelines/PerformanceTestMetricsPipeline.ts`** ❌ (17 compilation errors)
   - Lines 411-419: Request metrics processing
   - Lines 501-505: Transaction metrics processing
   - Needs to use new consolidated panel IDs
   - Needs to update metric name generation logic

### Required Changes in Pipeline

The pipeline code currently uses old constants like:
```typescript
PERFORMANCE_METRIC_PANEL_IDS.RESPONSE_TIME_AVG
PERFORMANCE_METRIC_PANEL_IDS.RESPONSE_TIME_P50
PERFORMANCE_METRIC_PANEL_IDS.SUCCESS_RATE
METRIC_NAME_TEMPLATES.TRANSACTION_RESPONSE_TIME_AVG
```

These need to be updated to:
```typescript
// Use consolidated panel ID
PERFORMANCE_METRIC_PANEL_IDS.RESPONSE_TIME

// Use helper function to build metric names
buildMetricName(metricPrefix, METRIC_NAME_TEMPLATES.RESPONSE_TIME, AGGREGATION_TYPES.AVG)
buildMetricName(metricPrefix, METRIC_NAME_TEMPLATES.RESPONSE_TIME, AGGREGATION_TYPES.P95)
buildMetricName(metricPrefix, METRIC_NAME_TEMPLATES.ERROR_RATE) // No aggregation suffix
```

## Data Model Impact

### ds_metrics Table
- Panel IDs will change for some metrics (e.g., transactions)
- Metric names remain compatible (still use dot notation with aggregation suffixes)
- Time-series implementation (Phase 5+) will add multiple records per metric

### ds_compare_config Table
- Classifications updated to match new panel IDs
- Only baseline aggregations (typically `avg`) will have classifications for ADAPT comparisons
- Non-baseline aggregations (p90, p95, p99) stored but not used in automated comparisons

## Next Steps

### Phase 5: Refactor Response Time Metrics (Pending)
- Update `PerformanceTestMetricsPipeline.ts` to use new constants
- Implement time-series bucketing for response time metrics
- Generate multiple ds_metrics records per metric (one per time bucket)
- Use helper functions to build metric names dynamically

### Phase 6-9: Refactor Other Metrics (Pending)
- Latency & Connect Time (Phase 6)
- Success Rate → Error Rate conversion (Phase 7)
- Throughput (Phase 8)
- Apdex Score (Phase 9)

## Testing Requirements

### Unit Tests Needed
- Test helper functions (`buildMetricName`, `parseMetricName`, `getAggregationsForMetric`)
- Verify aggregation types match expected values
- Test metric name parsing edge cases

### Integration Tests Needed
- Verify pipeline generates correct panel IDs
- Verify metric names follow new convention
- Verify ds_compare_config records use correct classifications

## Type Safety ✅

All TypeScript types have been properly updated:
- New `AggregationType` type exported
- All constants properly typed with `as const`
- Helper functions have proper type signatures

## Compilation Status ❌

Current status: **17 TypeScript compilation errors**

All errors are in `PerformanceTestMetricsPipeline.ts` and are expected. These will be resolved in Phase 5 when the pipeline is refactored to use the new constants.

## Documentation Updates

- Added extensive comments to all constants explaining the refactoring
- Documented helper functions with JSDoc and examples
- Added notes about when aggregation suffixes are used vs. not used
- Explained the relationship between panel IDs and metric names

## Related Files

- **Modified**: `apps/worker/src/constants/performance-metrics.ts`
- **Needs Update**: `apps/worker/src/pipelines/PerformanceTestMetricsPipeline.ts`
- **Reference**: `apps/worker/PERFORMANCE_METRICS_REFACTORING_PLAN.md`
