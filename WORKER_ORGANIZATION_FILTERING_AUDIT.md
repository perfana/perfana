# Worker Pipelines Organization Filtering Audit

## 🚨 CRITICAL SECURITY ISSUE: Multi-Tenant Data Leakage

**Date**: 2026-02-10
**Severity**: **CRITICAL**
**Impact**: Cross-organization data access in worker pipelines

---

## Executive Summary

The worker service pipelines **DO NOT** filter queries by `organization_id`, creating a **critical multi-tenant data leakage vulnerability**. Worker pipelines processing test runs from one organization can access and process benchmarks, dashboards, and configurations from OTHER organizations.

### Critical Impact

1. **Benchmark Matching**: Test runs from Org A can match benchmarks from Org B
2. **Dashboard Access**: Pipelines can query dashboards from any organization
3. **Configuration Access**: Dynatrace and other configurations are not organization-scoped
4. **Data Aggregation**: Statistics and metrics may be aggregated across organizations

---

## Affected Components

### 1. WorkerDatabaseService (apps/worker/src/common/database.service.ts)

**Missing organization_id filtering in ALL query methods:**

#### Application Dashboard Operations
```typescript
// ❌ Lines 158-177: NO organization_id filter
async getApplicationDashboards(filters: {
  systemUnderTestId?: string;
  testEnvironment?: string;
}): Promise<ApplicationDashboard[]> {
  const queryBuilder = this.applicationDashboardRepo.createQueryBuilder('ad');

  if (filters.systemUnderTestId) {
    queryBuilder.andWhere('ad.systemUnderTestId = :systemUnderTestId', {
      systemUnderTestId: filters.systemUnderTestId,
    });
  }

  if (filters.testEnvironment) {
    queryBuilder.andWhere('ad.testEnvironment = :testEnvironment', {
      testEnvironment: filters.testEnvironment,
    });
  }

  return await queryBuilder.getMany();
}
```

**Fix Required:**
```typescript
async getApplicationDashboards(filters: {
  systemUnderTestId?: string;
  testEnvironment?: string;
  organizationId?: string;  // ADD THIS
}): Promise<ApplicationDashboard[]> {
  const queryBuilder = this.applicationDashboardRepo.createQueryBuilder('ad');

  if (filters.systemUnderTestId) {
    queryBuilder.andWhere('ad.systemUnderTestId = :systemUnderTestId', {
      systemUnderTestId: filters.systemUnderTestId,
    });
  }

  if (filters.testEnvironment) {
    queryBuilder.andWhere('ad.testEnvironment = :testEnvironment', {
      testEnvironment: filters.testEnvironment,
    });
  }

  // ✅ ADD ORGANIZATION FILTER
  if (filters.organizationId) {
    queryBuilder.andWhere(
      '(ad.organization_id = :organizationId OR ad.organization_id IS NULL)',
      { organizationId: filters.organizationId }
    );
  }

  return await queryBuilder.getMany();
}
```

#### Benchmark Operations
```typescript
// ❌ Lines 191-205: NO organization_id filter
async getBenchmarksByDashboard(
  systemUnderTestId: string,
  testEnvironment: string,
  workload: string,
  dashboardUid: string
): Promise<Benchmark[]> {
  return await this.benchmarkRepo.find({
    where: {
      system_under_test_id: systemUnderTestId,
      test_environment: testEnvironment,
      workload,
      dashboard_uid: dashboardUid,
    },
  });
}
```

**Fix Required:**
```typescript
async getBenchmarksByDashboard(
  systemUnderTestId: string,
  testEnvironment: string,
  workload: string,
  dashboardUid: string,
  organizationId?: string  // ADD THIS
): Promise<Benchmark[]> {
  const where: any = {
    system_under_test_id: systemUnderTestId,
    test_environment: testEnvironment,
    workload,
    dashboard_uid: dashboardUid,
  };

  // ✅ ADD ORGANIZATION FILTER
  if (organizationId) {
    // Use query builder for OR condition (organization_id = X OR organization_id IS NULL)
    const queryBuilder = this.benchmarkRepo.createQueryBuilder('b');
    queryBuilder.where(where);
    queryBuilder.andWhere(
      '(b.organization_id = :organizationId OR b.organization_id IS NULL)',
      { organizationId }
    );
    return await queryBuilder.getMany();
  }

  return await this.benchmarkRepo.find({ where });
}
```

#### Dynatrace Operations
```typescript
// ❌ Lines 601-614: NO organization_id filter
async getDynatraceConfigBySystemUnderTest(
  systemUnderTestId: string,
  testEnvironment: string
): Promise<DynatraceConfig | null> {
  const mapping = await this.dynatraceEntityMappingRepo.findOne({
    where: {
      systemUnderTestId,
      testEnvironment,
    },
    relations: ['dynatraceConfig'],
  });
  return mapping?.dynatraceConfig || null;
}

// ❌ Lines 616-621: NO organization_id filter
async getDynatraceQueriesByConfig(dynatraceConfigId: string): Promise<DynatraceQuery[]> {
  return await this.dynatraceQueryRepo.find({
    where: { dynatraceConfigId },
    order: { createdAt: 'ASC' },
  });
}
```

---

### 2. BenchmarkMatcher (apps/worker/src/pipelines/checks/BenchmarkMatcher.ts)

**CRITICAL: Direct SQL queries WITHOUT organization_id filter**

#### Test Run Interface - Missing organization_id
```typescript
// ❌ Lines 5-13: Interface doesn't include organization_id
export interface TestRun {
  test_run_id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  start_time?: Date;
  end_time?: Date;
  ramp_up?: number;
  // MISSING: organization_id?: string;
}
```

#### findMatchingBenchmarks - Leaks Cross-Organization Data
```typescript
// ❌ Lines 117-145: Query benchmarks WITHOUT organization_id filter
const benchmarksSql = `
  SELECT
    id,
    system_under_test_id,
    test_environment,
    workload,
    dashboard_uid,
    dashboard_label,
    application_dashboard_id,
    configuration,
    requirement_operator,
    requirement_value,
    ...
  FROM benchmarks
  WHERE system_under_test_id = $1
    AND test_environment = $2
    AND workload = $3
    AND valid = true
    AND enabled = true
    AND (
      (COALESCE(benchmark_type, 'metric') = 'metric' AND (requirement_operator IS NOT NULL OR requirement_value IS NOT NULL))
      OR
      (benchmark_type = 'apdex' AND min_apdex_score IS NOT NULL)
    )
`;
```

**Attack Scenario:**
1. User in Organization A creates test run with system="API", env="prod", workload="load-test"
2. User in Organization B has benchmarks for system="API", env="prod", workload="load-test"
3. Worker processing Org A's test run will MATCH and EVALUATE Org B's benchmarks
4. **Cross-organization data leakage occurs**

**Fix Required:**
```typescript
// ✅ Add organization_id to WHERE clause
const whereClauses = [
  'system_under_test_id = $1',
  'test_environment = $2',
  'workload = $3',
  'valid = true',
  'enabled = true',
  '(organization_id = $4 OR organization_id IS NULL)',  // ADD THIS
  `(
    (COALESCE(benchmark_type, 'metric') = 'metric' AND (requirement_operator IS NOT NULL OR requirement_value IS NOT NULL))
    OR
    (benchmark_type = 'apdex' AND min_apdex_score IS NOT NULL)
  )`
];

const queryParams: any[] = [
  testRun.system_under_test_id,
  testRun.test_environment,
  testRun.workload,
  testRun.organization_id  // ADD THIS
];
```

---

### 3. Additional Affected Pipelines

Based on grep search, the following pipeline files query benchmarks/dashboards WITHOUT organization_id:

1. **StatisticsPipeline.ts** (lines 148-149)
   - Queries `application_dashboards` without organization filter
   - Queries `dynatrace_queries` without organization filter

2. **ControlGroupStatisticsPipeline.ts** (lines 185-186, 205-206, 226-227)
   - Multiple queries to `application_dashboards` without filter
   - Multiple queries to `dynatrace_queries` without filter

3. **PerformanceTestMetricsPipeline.ts** (line 414)
   - Queries `benchmarks` table without organization filter

4. **DataAggregator.ts** (lines 101-102)
   - Queries `application_dashboards` without filter
   - Queries `dynatrace_queries` without filter

5. **panels/helpers.ts** (lines 98, 172)
   - Queries `application_dashboards` without filter
   - Queries `benchmarks` without filter

6. **dashboard-manager.ts** (line 85)
   - Direct SELECT from `application_dashboards` without filter

7. **dynatrace-dashboard-manager.ts** (line 105)
   - Direct SELECT from `application_dashboards` without filter

8. **incremental/dynatrace-collector.ts** (line 160)
   - Queries `dynatrace_queries` without filter

9. **adapt/adapt-validator.ts** (lines 222-223)
   - Queries `application_dashboards` without filter

10. **adapt/control-group-processor.ts** (lines 160-161)
    - Queries `application_dashboards` without filter

---

## Root Cause Analysis

### 1. TestRun Interface Incomplete
The `TestRun` interface used throughout worker pipelines doesn't include `organization_id`, even though the database table has this column.

### 2. Database Service Methods Don't Accept organization_id
WorkerDatabaseService methods don't have `organization_id` parameter, making it impossible to filter even if pipelines wanted to.

### 3. Raw SQL Queries Bypass ORM
Many pipelines use raw SQL queries (`manager.query()`) that bypass TypeORM, directly querying tables without organization filtering.

### 4. No Authorization Layer
Unlike the API service which has AuthorizationService, worker pipelines have no authorization checks or organization-based filtering layer.

---

## Security Impact Assessment

### Severity: **CRITICAL** (10/10)

**Confidentiality Impact**: HIGH
- Benchmarks from one organization can be accessed by another
- Dashboard configurations can leak across tenants
- Performance thresholds and SLOs are not isolated

**Integrity Impact**: HIGH
- Check results could be generated using wrong organization's benchmarks
- Statistics could be calculated using cross-organization data
- Control groups might mix data from multiple tenants

**Availability Impact**: MEDIUM
- No direct availability impact, but incorrect evaluations could trigger false alerts

### Likelihood: **HIGH**

This will occur whenever:
1. Two organizations use the same system_under_test_id name
2. Two organizations use the same test_environment name
3. Two organizations use the same workload name

Common naming like "API", "Web", "prod", "staging", "load-test" makes collisions very likely.

---

## Recommended Fixes

### Phase 1: Immediate (HIGH PRIORITY)

1. **Update TestRun Interface** - Add organization_id to all TestRun interfaces in worker pipelines
   ```typescript
   export interface TestRun {
     test_run_id: string;
     system_under_test_id: string;
     test_environment: string;
     workload: string;
     organization_id?: string;  // ADD THIS
     start_time?: Date;
     end_time?: Date;
     ramp_up?: number;
   }
   ```

2. **Update WorkerDatabaseService** - Add organization_id parameter to ALL query methods:
   - `getApplicationDashboards()` - Add organizationId param
   - `getBenchmarksByDashboard()` - Add organizationId param
   - `getBenchmarksByPanel()` - Add organizationId param
   - `getDynatraceConfigBySystemUnderTest()` - Add organizationId param
   - `getDynatraceQueriesByConfig()` - Add organizationId param

3. **Update BenchmarkMatcher** - Add organization_id to WHERE clauses:
   - `findMatchingBenchmarks()` - Filter by organization_id
   - `findBenchmarkById()` - Filter by organization_id

### Phase 2: Comprehensive Fix (MEDIUM PRIORITY)

4. **Audit All Pipelines** - Search for direct SQL queries and add organization filtering:
   - ChecksPipeline
   - StatisticsPipeline
   - ControlGroupsPipeline
   - ControlGroupStatisticsPipeline
   - AdaptPipeline
   - PanelsPipeline
   - MetricsPipeline
   - PerformanceTestMetricsPipeline
   - DynatracePipeline

5. **Update Helper Modules**:
   - dashboard-manager.ts
   - dynatrace-dashboard-manager.ts
   - adapt-validator.ts
   - control-group-processor.ts
   - panels/helpers.ts
   - incremental/dynatrace-collector.ts

### Phase 3: Infrastructure Improvements (LOW PRIORITY)

6. **Create Worker Authorization Service** - Similar to API's AuthorizationService
7. **Add Unit Tests** - Test organization isolation in all pipelines
8. **Add Integration Tests** - Verify cross-organization data doesn't leak
9. **Add Monitoring** - Alert on cross-organization queries

---

## Testing Strategy

### Unit Tests Required
- Test that benchmarks from Org A don't match test runs from Org B
- Test that dashboards are filtered by organization
- Test backward compatibility (NULL organization_id should be accessible)

### Integration Tests Required
- Create test data in two organizations with overlapping names
- Run worker pipelines and verify isolation
- Verify RLS policies work correctly

### Manual Testing
1. Create two organizations with identical system/environment/workload names
2. Create benchmarks in both organizations
3. Run test in Org A
4. Verify ONLY Org A benchmarks are matched

---

## Files Requiring Updates

### Critical Priority
- `apps/worker/src/common/database.service.ts` - Add organization_id filtering to all methods
- `apps/worker/src/pipelines/checks/BenchmarkMatcher.ts` - Add organization_id to queries
- `apps/worker/src/pipelines/checks/DataAggregator.ts` - Add organization_id filtering

### High Priority
- `apps/worker/src/pipelines/ChecksPipeline.ts` - Pass organization_id through
- `apps/worker/src/pipelines/StatisticsPipeline.ts` - Add organization_id filtering
- `apps/worker/src/pipelines/ControlGroupsPipeline.ts` - Add organization_id filtering
- `apps/worker/src/pipelines/ControlGroupStatisticsPipeline.ts` - Add organization_id filtering
- `apps/worker/src/pipelines/AdaptPipeline.ts` - Add organization_id filtering
- `apps/worker/src/pipelines/PanelsPipeline.ts` - Add organization_id filtering
- `apps/worker/src/pipelines/PerformanceTestMetricsPipeline.ts` - Add organization_id filtering

### Medium Priority
- `apps/worker/src/pipelines/helpers/dashboard-manager.ts` - Add organization_id parameter
- `apps/worker/src/pipelines/helpers/dynatrace-dashboard-manager.ts` - Add organization_id parameter
- `apps/worker/src/pipelines/helpers/adapt/adapt-validator.ts` - Add organization_id filtering
- `apps/worker/src/pipelines/helpers/adapt/control-group-processor.ts` - Add organization_id filtering
- `apps/worker/src/pipelines/panels/helpers.ts` - Add organization_id filtering
- `apps/worker/src/pipelines/helpers/incremental/dynatrace-collector.ts` - Add organization_id filtering

---

## Estimated Effort

- **Phase 1 (Immediate Fixes)**: 8-16 hours
- **Phase 2 (Comprehensive Audit)**: 16-24 hours
- **Phase 3 (Infrastructure)**: 8-16 hours
- **Testing**: 8-16 hours
- **Total**: 40-72 hours (5-9 days)

---

## Current Status

- ❌ **Worker pipelines DO NOT filter by organization_id**
- ❌ **Critical multi-tenant data leakage vulnerability exists**
- ❌ **Benchmarks, dashboards, and configs can leak across organizations**
- ✅ **Database tables HAVE organization_id columns (migration completed)**
- ✅ **RLS policies are in place (but pipelines bypass them with direct queries)**

---

## Next Steps

1. **Immediate**: Add organization_id to TestRun interface in all worker pipelines
2. **Day 1**: Update WorkerDatabaseService to accept and use organization_id
3. **Day 2-3**: Update BenchmarkMatcher and DataAggregator
4. **Day 4-5**: Update all remaining pipelines
5. **Day 6-7**: Testing and validation
6. **Day 8**: Documentation and deployment

---

## Related Documentation

- See `OWNERSHIP_COLUMNS_MIGRATION_COMPLETE.md` for database schema changes
- See `apps/api/CODING_RULES.md` for authorization patterns (need to apply to workers)
- See `ORGANIZATION_FILTERING_FIX.md` for similar API fixes

---

**URGENT ACTION REQUIRED**: This vulnerability allows cross-organization data access in production!
