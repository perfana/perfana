# Implementation Plan: Fill Test-Runs Service Stubs

## Goal

Implement all 38 NotImplementedException stubs in the test-runs module by porting
the actual business logic from perfana-next-gen. Every method gets an integration
test against a real Postgres via Testcontainers.

## Architecture Decision: 7 Sub-Services

Split test-runs services to match the source architecture. Each under 300 LOC.

```
test-runs.service.ts (Facade — delegates to sub-services)
├── test-runs-crud-query.service.ts     (4 methods: findAll, findById, getRelated, getRequestNames)
├── test-runs-dashboard-query.service.ts (3 methods: statistics, failures, systemsSummary)
├── test-runs-performance-query.service.ts (5 methods: transactions, samples, virtualUsers, throughput, errors)
├── test-runs-timeseries-query.service.ts  (2 methods: transactionTimeSeries, samplerTimeSeries)
├── test-runs-config.service.ts         (7 methods: config CRUD, expected changes, sparse exclusions)
├── test-runs-mutation.service.ts       (5 methods: init, update, delete, annotations, tags)
├── test-runs-anomaly.service.ts        (5 methods: anomaly results, ADAPT results, check results)
├── test-runs-changepoint.service.ts    (4 methods: mark, remove, getAfter, getMoreRecent)
├── test-runs-apdex.service.ts          (5 methods: get/set workload, get/set/delete transaction)
└── test-runs-metrics.service.ts        (3 methods: dsCompareConfig CRUD, classifyMetric)
```

## Implementation Order (bottom-up)

### Batch 1: Config Service (7 methods, all simple)
Source: `perfana-next-gen/apps/api/src/modules/test-runs/services/test-runs-config.service.ts`
- addTestRunConfig, addTestRunConfigs, addTestRunConfigJson
- getLatestConfigKeys, getTestRunConfigs
- getExpectedConfigChanges, createExpectedConfigChange, deleteExpectedConfigChange
- getSparseMetricExclusions, createSparseMetricExclusion, deleteSparseMetricExclusion

### Batch 2: Apdex Service (5 methods, medium)
Source: `perfana-next-gen/apps/api/src/modules/test-runs/services/test-runs-apdex.service.ts`
- getTestApdexThreshold, setTestApdexThreshold
- getTransactionApdexThresholds, setTransactionApdexThreshold, deleteTransactionApdexThreshold

### Batch 3: CRUD Query Service (4 methods, simple/medium)
Source: `perfana-next-gen/apps/api/src/modules/test-runs/services/test-runs-crud-query.service.ts`
- findAllPaginated, findByTestRunId, getRelatedTestRuns, getBaselineCandidates
- getRequestNames, getSystemsSummary

### Batch 4: Dashboard Query Service (3 methods, medium/complex)
Source: `perfana-next-gen/apps/api/src/modules/test-runs/services/test-runs-dashboard-query.service.ts`
- getDashboardStatistics, getRecentFailures, getDashboardSystemsSummary

### Batch 5: Performance Query + TimeSeries (7 methods, complex)
Source: `perfana-next-gen/apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`
       `perfana-next-gen/apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`
- getTransactionStats, getTransactionSamples, getVirtualUserStats, getThroughputStats, getTransactionErrors
- getTransactionTimeSeries, getSamplerTimeSeries

### Batch 6: Mutation + Anomaly + Changepoints + Metrics (17 methods)
Source: `perfana-next-gen/apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts`
       `perfana-next-gen/apps/api/src/modules/test-runs/services/test-runs-anomaly.service.ts`
       `perfana-next-gen/apps/api/src/modules/test-runs/services/test-runs-changepoint.service.ts`
       `perfana-next-gen/apps/api/src/modules/test-runs/services/test-runs-metrics.service.ts`
- initTest, updateRunningTest, deleteTestRun, updateAnnotations, updateTags
- getAnomalyDetectionResults, deleteAnomalyData, getDsAdaptResult, updateAdaptConfig, getTestRunCheckResults
- markAsChangepoint, removeChangepoint, getTestRunsAfterMostRecentChangepoint, getTestRunsMoreRecentThan
- createOrUpdateDsCompareConfig, getDsCompareConfig, updateDsCompareConfig, deleteDsCompareConfig, classifyMetric

## Verification: Integration Tests

Each sub-service gets a `.test.ts` file with:
- Testcontainers PostgreSQL (real DB, not mocks)
- Test data seeding (create org, team, system, test run, metrics)
- Actual method calls with result assertions
- Edge cases: empty results, invalid IDs, unauthorized access

## Additional Required Work

Beyond filling stubs, the app also needs:
1. **Keycloak realm import** — pre-configured realm with test users for docker-compose
2. **Seed script** — `pnpm seed` to populate sample data for local development
3. **Database migration verification** — run migration against real DB and fix issues
4. **Frontend API wiring** — verify each page's API calls work against real endpoints
5. **ESLint configuration** — fix CI lint failures for worker + API
