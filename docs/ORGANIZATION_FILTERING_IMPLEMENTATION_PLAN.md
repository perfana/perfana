# Organization Filtering Implementation Plan

## Executive Summary

**Critical Security Issue**: Users can currently access test runs and related data from organizations they are not members of. This document outlines a comprehensive plan to implement organization-based filtering across all services.

**Status**: Phase 1 (CRUD queries) completed. 18+ services still need implementation.

**Timeline**: 3-5 days for full implementation

---

## Problem Statement

### Current Situation

User `test@perfana.io` (UUID: `3b273a60-b0df-400f-a787-b6a3d13a6dd3`) was removed from the **Perfana** organization but can still:
- ✅ See test runs from Perfana organization (via dashboard, list views)
- ✅ Access configuration data from Perfana systems
- ✅ View performance metrics from Perfana test runs
- ✅ Generate reports including Perfana data

### Root Cause

The `test_runs` table does **not** have `organization_id` column. Authorization must be implemented via JOIN with `systems_under_test` table, which DOES have `organization_id`.

**Database Schema Status**:
```sql
-- ✅ systems_under_test table
organization_id UUID (nullable)
created_by VARCHAR(255) (nullable)
updated_by VARCHAR(255) (nullable)

-- ❌ test_runs table (MISSING ownership columns)
-- organization_id NOT EXISTS
-- created_by NOT EXISTS
-- updated_by NOT EXISTS
```

### Security Impact

- **CRITICAL**: Cross-organization data leakage
- **HIGH**: Unauthorized access to sensitive performance data
- **HIGH**: Users can generate reports with data from other organizations
- **MEDIUM**: Dashboard statistics include data from all organizations

---

## Implementation Status

### ✅ Phase 1: CRUD Query Service (COMPLETED)

**File**: `apps/api/src/modules/test-runs/services/test-runs-crud-query.service.ts`

**Methods Fixed**:
1. ✅ `findAllPaginated()` - Filters via `sut.organization_id IN (:...orgIds)`
2. ✅ `findAll()` - Filters via `sut.organization_id IN (:...orgIds)`
3. ✅ `findByTestRunId()` - Permission check on individual test run
4. ✅ `findOne()` - Permission check on individual test run
5. ✅ `getTestRunByTestRunId()` - Permission check on individual test run

**Pattern Used**:
```typescript
// List queries - filter at query builder level
const isAdmin = this.authzService.isGlobalAdmin(roles);

if (!isAdmin) {
  const orgIds = await this.authzService.getAccessibleOrganizations(userId);

  if (orgIds.length === 0) {
    return { items: [], total: 0, page, pageSize, totalPages: 0 };
  }

  queryBuilder
    .leftJoinAndSelect('tr.systemUnderTest', 'sut')
    .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
}

// Individual entity checks
if (!isAdmin && testRunEntity.systemUnderTest) {
  const systemOrgId = testRunEntity.systemUnderTest.organization_id;

  // Systems without organization_id only accessible to global admins
  if (!systemOrgId) {
    throw new ResourceNotFoundException('TestRun', testRunId);
  }

  const isMember = await this.authzService.isOrganizationMember(userId, systemOrgId);
  if (!isMember) {
    throw new ResourceNotFoundException('TestRun', testRunId);
  }
}
```

---

## Phase 2: High Priority Services (USER-FACING)

### 2.1 Dashboard Query Service ⚠️ CRITICAL

**File**: `apps/api/src/modules/test-runs/services/test-runs-dashboard-query.service.ts`

**Methods to Fix**:

#### `getDashboardStatistics()`
**Line**: 50-124
**Impact**: Dashboard shows statistics from ALL organizations

**6 Queries Need Filtering**:
```typescript
// 1. Total tests count (line 64)
const baseQuery = this.testRunRepo.createQueryBuilder('tr')
  .leftJoin('tr.systemUnderTest', 'sut'); // ADD JOIN
// ADD: .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });

// 2. Passed tests query (line 69)
const passedQuery = this.testRunRepo.createQueryBuilder('tr')
  .leftJoin('tr.systemUnderTest', 'sut'); // ADD JOIN
// ADD: .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });

// 3. Failed tests query (line 75)
const failedQuery = this.testRunRepo.createQueryBuilder('tr')
  .leftJoin('tr.systemUnderTest', 'sut'); // ADD JOIN
// ADD: .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });

// 4. Active tests query (line 81)
const activeQuery = this.testRunRepo.createQueryBuilder('tr')
  .leftJoin('tr.systemUnderTest', 'sut'); // ADD JOIN
// ADD: .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });

// 5. SLO compliance query (line 87)
const sloQuery = this.testRunRepo.createQueryBuilder('tr')
  .leftJoin('tr.systemUnderTest', 'sut'); // ADD JOIN
// ADD: .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });

// 6. Most tested system query (line 94)
const systemCountQuery = this.testRunRepo.createQueryBuilder('tr')
  .leftJoin('tr.systemUnderTest', 'sut') // ALREADY HAS JOIN
// ADD: .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
```

**Estimated Effort**: 30 minutes

#### `getRecentFailures()`
**Line**: 136-210
**Impact**: Shows failed tests from ALL organizations

**Changes Needed**:
```typescript
const failuresQuery = this.testRunRepo.createQueryBuilder('tr')
  .leftJoinAndSelect('tr.systemUnderTest', 'sut') // ALREADY HAS JOIN
  // ADD FILTERING BEFORE .where() at line 161
  if (!isAdmin) {
    const orgIds = await this.authzService.getAccessibleOrganizations(userId);
    if (orgIds.length > 0) {
      .andWhere('sut.organization_id IN (:...orgIds)', { orgIds })
    } else {
      return []; // No access
    }
  }
```

**Estimated Effort**: 15 minutes

#### `getDashboardSystemsSummary()`
**Line**: 211-280
**Impact**: Shows summary for ALL systems

**Changes Needed**:
```typescript
// Line 215 - Main query
const query = this.testRunRepo.createQueryBuilder('tr')
  .leftJoin('tr.systemUnderTest', 'sut')
  // ADD FILTERING
  if (!isAdmin) {
    const orgIds = await this.authzService.getAccessibleOrganizations(userId);
    query.andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
  }
```

**Estimated Effort**: 20 minutes

**Total Time for Dashboard Service**: ~1 hour

---

### 2.2 Test Runs Config Service

**File**: `apps/api/src/modules/test-runs/services/test-runs-config.service.ts`

**Methods to Audit**:
- All configuration query methods
- Configuration creation/update (check ownership assignment)

**Approach**:
1. Read entire file to identify all query methods
2. Add organization filtering to each query
3. Ensure configuration creation assigns correct organization_id

**Estimated Effort**: 1-2 hours

---

### 2.3 Report Generation Service

**File**: `apps/api/src/modules/reports/services/report-generation.service.ts`

**Impact**: Users can generate reports containing data from ALL organizations

**Methods to Fix**:
- Report data fetching queries
- Test run data aggregation for reports

**Approach**:
1. Identify all test run queries in report generation
2. Add organization filtering via systems_under_test JOIN
3. Verify report templates respect organization boundaries

**Estimated Effort**: 2-3 hours

**Total Time for Phase 2**: ~5-6 hours

---

## Phase 3: Medium Priority Services (DATA ACCESS)

### 3.1 Performance Query Service

**File**: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`

**Methods**:
- Transaction stats queries
- Sampler stats queries
- Error stats queries
- All queries that fetch test run data

**Estimated Effort**: 2 hours

---

### 3.2 Time Series Query Service

**File**: `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`

**Methods**:
- Time series data queries
- Transaction time series queries
- Virtual user stats
- Throughput stats

**Estimated Effort**: 2 hours

---

### 3.3 Metrics Service

**File**: `apps/api/src/modules/test-runs/services/test-runs-metrics.service.ts`

**Methods**:
- Metrics aggregation queries

**Estimated Effort**: 1 hour

---

### 3.4 Global Metrics Service

**File**: `apps/api/src/modules/metrics/metrics.service.ts`

**Methods**:
- Overall metrics queries across test runs

**Estimated Effort**: 1 hour

---

### 3.5 ADAPT Service

**File**: `apps/api/src/modules/adapt/adapt.service.ts`

**Methods**:
- ADAPT analysis queries
- Baseline comparison queries

**Estimated Effort**: 1 hour

---

### 3.6 Compare Presets Service

**File**: `apps/api/src/modules/compare-presets/compare-presets.service.ts`

**Methods**:
- Test run comparison queries

**Estimated Effort**: 1 hour

**Total Time for Phase 3**: ~8 hours

---

## Phase 4: Low Priority Services (BACKGROUND/OPTIONAL)

### 4.1 Stale Detection Service

**File**: `apps/api/src/modules/test-runs/services/test-runs-stale-detection.service.ts`

**Note**: Background job - may need to process all test runs
**Decision Required**: Does stale detection need org filtering?

**Estimated Effort**: 30 minutes

---

### 4.2 Changepoint Service

**File**: `apps/api/src/modules/test-runs/services/test-runs-changepoint.service.ts`

**Note**: May already be org-scoped via input parameters
**Action**: Audit to verify

**Estimated Effort**: 30 minutes

---

### 4.3 Deep Links Service

**File**: `apps/api/src/modules/deep-links/deep-links.service.ts`

**Methods**:
- Deep link resolution

**Estimated Effort**: 30 minutes

**Total Time for Phase 4**: ~1.5 hours

---

## Implementation Approach

### Step-by-Step Process

For each service file:

1. **Read & Analyze**
   - Identify all methods that query test runs
   - Identify query builders that need filtering
   - Check if JOIN with systems_under_test already exists

2. **Add Organization Filtering**
   - Apply standard pattern (see below)
   - Test locally with different user contexts
   - Verify global admins still see all data

3. **Test & Verify**
   - Unit test with mock authorization service
   - Integration test with real database
   - Manual testing with test users

4. **Document**
   - Add code comments explaining filtering logic
   - Update service-level documentation

### Standard Implementation Pattern

```typescript
/**
 * Standard organization filtering pattern for test run queries
 */

// At the start of query method
const isAdmin = this.authzService.isGlobalAdmin(roles);

// For list queries (returns array)
if (!isAdmin) {
  const orgIds = await this.authzService.getAccessibleOrganizations(userId);

  if (orgIds.length === 0) {
    // Return empty result - user has no org memberships
    return []; // or { items: [], total: 0 } for paginated
  }

  // Add filtering to query builder
  queryBuilder
    .leftJoin('tr.systemUnderTest', 'sut') // Add if not exists
    .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
}

// For single entity queries (returns one item)
if (!isAdmin && testRunEntity.systemUnderTest) {
  const systemOrgId = testRunEntity.systemUnderTest.organization_id;

  // Legacy data (NULL org) only visible to admins
  if (!systemOrgId) {
    throw new ResourceNotFoundException('TestRun', testRunId);
  }

  // Check membership
  const isMember = await this.authzService.isOrganizationMember(
    userId,
    systemOrgId
  );

  if (!isMember) {
    throw new ResourceNotFoundException('TestRun', testRunId);
  }
}

// For count/aggregate queries
if (!isAdmin) {
  const orgIds = await this.authzService.getAccessibleOrganizations(userId);

  if (orgIds.length === 0) {
    return 0; // or appropriate empty aggregate
  }

  queryBuilder
    .leftJoin('tr.systemUnderTest', 'sut')
    .andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
}
```

---

## Testing Strategy

### Unit Tests

For each service method:

```typescript
describe('ServiceName with Organization Filtering', () => {
  let service: ServiceName;
  let authzService: jest.Mocked<AuthorizationService>;
  let testRunRepo: jest.Mocked<Repository<TestRun>>;

  beforeEach(() => {
    authzService = {
      isGlobalAdmin: jest.fn(),
      getAccessibleOrganizations: jest.fn(),
      isOrganizationMember: jest.fn(),
    } as any;

    // ... setup mocks
  });

  describe('findAll', () => {
    it('should filter by organization for non-admin users', async () => {
      authzService.isGlobalAdmin.mockReturnValue(false);
      authzService.getAccessibleOrganizations.mockResolvedValue([
        'org-id-1',
        'org-id-2',
      ]);

      await service.findAll('user-id', ['org-member']);

      // Verify query builder was called with org filter
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'sut.organization_id IN (:...orgIds)',
        { orgIds: ['org-id-1', 'org-id-2'] }
      );
    });

    it('should return all data for global admin', async () => {
      authzService.isGlobalAdmin.mockReturnValue(true);

      await service.findAll('admin-user-id', ['perfana-admin']);

      // Verify NO org filter was applied
      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should return empty array for user with no orgs', async () => {
      authzService.isGlobalAdmin.mockReturnValue(false);
      authzService.getAccessibleOrganizations.mockResolvedValue([]);

      const result = await service.findAll('user-id', ['org-member']);

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should throw 404 for test run in inaccessible org', async () => {
      authzService.isGlobalAdmin.mockReturnValue(false);
      authzService.isOrganizationMember.mockResolvedValue(false);

      await expect(
        service.findOne('test-run-id', 'user-id', ['org-member'])
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should allow access to test run in user org', async () => {
      authzService.isGlobalAdmin.mockReturnValue(false);
      authzService.isOrganizationMember.mockResolvedValue(true);

      const result = await service.findOne('test-run-id', 'user-id', ['org-member']);

      expect(result).toBeDefined();
    });
  });
});
```

### Integration Tests

```typescript
describe('Organization Filtering Integration Tests', () => {
  let app: INestApplication;
  let testRunsService: TestRunsQueryService;

  // Setup test data
  let orgA: Organization;
  let orgB: Organization;
  let userAMember: string; // Member of org A only
  let userBMember: string; // Member of org B only
  let adminUser: string;   // Global admin
  let systemA: SystemUnderTest; // Belongs to org A
  let systemB: SystemUnderTest; // Belongs to org B
  let testRunA: TestRun; // System A test run
  let testRunB: TestRun; // System B test run

  beforeAll(async () => {
    // Create test data in database
    // ...
  });

  it('user A should only see org A test runs', async () => {
    const result = await testRunsService.findAll(
      userAMember,
      ['org-member']
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(testRunA.id);
  });

  it('user B should only see org B test runs', async () => {
    const result = await testRunsService.findAll(
      userBMember,
      ['org-member']
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(testRunB.id);
  });

  it('admin should see all test runs', async () => {
    const result = await testRunsService.findAll(
      adminUser,
      ['perfana-admin']
    );

    expect(result).toHaveLength(2);
  });

  it('user A cannot access org B test run by ID', async () => {
    await expect(
      testRunsService.findOne(testRunB.id, userAMember, ['org-member'])
    ).rejects.toThrow(ResourceNotFoundException);
  });
});
```

### Manual Testing Checklist

- [ ] User removed from organization cannot see that org's test runs in list
- [ ] User removed from organization cannot access that org's test runs by ID
- [ ] User removed from organization cannot see that org's dashboard stats
- [ ] User removed from organization cannot generate reports with that org's data
- [ ] User with multiple org memberships sees combined data
- [ ] Global admin sees all data from all organizations
- [ ] User with no organization memberships sees empty results (not error)
- [ ] Systems without organization_id only visible to global admins

---

## Performance Considerations

### Caching Strategy

The `AuthorizationService.getAccessibleOrganizations()` method uses Redis caching:
- Cache key: `user:{userId}:orgs`
- TTL: 5 minutes (300 seconds)
- Invalidation: On membership change

**Impact**: First query after membership change may be slow, subsequent queries use cache.

### Query Optimization

**Before** (no filtering):
```sql
SELECT * FROM test_runs ORDER BY created_at DESC LIMIT 50;
```

**After** (with filtering):
```sql
SELECT tr.*
FROM test_runs tr
LEFT JOIN systems_under_test sut ON tr.system_under_test_id = sut.id
WHERE sut.organization_id IN ('org-id-1', 'org-id-2')
ORDER BY tr.created_at DESC
LIMIT 50;
```

**Indexes Needed**:
```sql
-- Already exists from Phase 2
CREATE INDEX idx_systems_under_test_organization_id
  ON systems_under_test(organization_id);

-- Composite index for performance
CREATE INDEX idx_test_runs_system_created
  ON test_runs(system_under_test_id, created_at DESC);
```

### Load Testing Targets

- Page load time: <200ms (p95)
- Dashboard stats query: <500ms (p95)
- Report generation: <5s for typical report
- No more than 10% performance degradation from baseline

---

## Rollout Plan

### Phase 1: Development & Testing (Day 1-2)
- ✅ Implement CRUD query service (DONE)
- Implement Dashboard service (HIGH PRIORITY)
- Implement Config service (HIGH PRIORITY)
- Implement Reports service (HIGH PRIORITY)
- Write unit tests for Phase 2 services
- Manual testing with test users

### Phase 2: Extended Coverage (Day 2-3)
- Implement Performance query service
- Implement Time series service
- Implement Metrics services
- Implement ADAPT service
- Implement Compare presets service
- Write integration tests

### Phase 3: Background Services (Day 3-4)
- Audit and implement low priority services
- Comprehensive testing across all services
- Performance testing and optimization

### Phase 4: Verification & Deployment (Day 4-5)
- Full regression testing
- Security audit of all changes
- Documentation updates
- Deploy to staging environment
- User acceptance testing
- Deploy to production

---

## Risk Assessment & Mitigation

### High Risk: Breaking Existing Functionality

**Risk**: Adding filters breaks legitimate access patterns

**Mitigation**:
- Comprehensive test coverage (unit + integration)
- Global admin bypass ensures system administrators retain full access
- Gradual rollout (service by service)
- Feature flag to disable filtering if needed

### Medium Risk: Performance Degradation

**Risk**: JOIN queries may be slower than direct queries

**Mitigation**:
- Use existing indexes on `systems_under_test.organization_id`
- Cache organization membership lookups (5 min TTL)
- Monitor query performance in staging
- Optimize slow queries before production

### Medium Risk: Missing Edge Cases

**Risk**: Some query paths may not be covered

**Mitigation**:
- Comprehensive code audit (all services)
- Search for all `testRunRepo.find*` and `testRunRepo.createQueryBuilder` calls
- Code review by multiple developers
- Staged rollout with monitoring

### Low Risk: Authorization Service Failure

**Risk**: If authorization service fails, all queries fail

**Mitigation**:
- Authorization service has error handling
- Cache provides resilience for common lookups
- Global admin bypass provides emergency access
- Monitor authorization service health

---

## Success Criteria

### Functional Requirements

- ✅ Users only see test runs from their organizations
- ✅ Users cannot access test runs from other organizations by ID
- ✅ Dashboard statistics reflect only user's organizations
- ✅ Reports only include data from user's organizations
- ✅ Global admins can access all data (no restrictions)
- ✅ Systems without organization_id only visible to admins
- ✅ Users with multiple org memberships see combined data

### Non-Functional Requirements

- ✅ Query performance within 10% of baseline
- ✅ <200ms response time for list queries (p95)
- ✅ <500ms response time for dashboard stats (p95)
- ✅ >95% cache hit rate for organization lookups
- ✅ Zero unauthorized data access incidents
- ✅ All changes covered by automated tests

### Security Requirements

- ✅ Zero cross-organization data leakage
- ✅ All query paths protected (no bypass routes)
- ✅ Authorization failures logged for audit
- ✅ Permission checks at service layer (defense in depth)
- ✅ Safe handling of NULL organization_id (legacy data)

---

## Monitoring & Observability

### Metrics to Track

```typescript
// Authorization metrics
authorization.check.count{result=success|failure}
authorization.check.duration_ms
authorization.cache.hit_rate

// Query performance metrics
test_runs.query.duration_ms{service=dashboard|crud|performance}
test_runs.query.count{service=dashboard|crud|performance}
test_runs.query.filtered{filtered=true|false}

// Security metrics
authorization.denied.count{service=*, method=*}
unauthorized_access.attempt{user_id=*, resource=*}
```

### Logging

```typescript
// Log authorization decisions
this.logger.debug(
  `Authorization check: userId=${userId}, ` +
  `isAdmin=${isAdmin}, ` +
  `accessibleOrgs=${orgIds.length}, ` +
  `method=${methodName}`
);

// Log denied access attempts
this.logger.warn(
  `Access denied: userId=${userId} attempted to access ` +
  `test run ${testRunId} in organization ${orgId}`
);
```

### Alerts

- **Critical**: >10 unauthorized access attempts in 5 minutes
- **Warning**: Authorization service cache hit rate <80%
- **Warning**: Query performance degradation >20% from baseline
- **Info**: User removed from organization (audit trail)

---

## Appendix A: File Checklist

### Services Requiring Changes

- [ ] `apps/api/src/modules/test-runs/services/test-runs-dashboard-query.service.ts` (HIGH)
- [ ] `apps/api/src/modules/test-runs/services/test-runs-config.service.ts` (HIGH)
- [ ] `apps/api/src/modules/reports/services/report-generation.service.ts` (HIGH)
- [ ] `apps/api/src/modules/reports/services/report-data-fetcher.service.ts` (HIGH)
- [ ] `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` (MEDIUM)
- [ ] `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts` (MEDIUM)
- [ ] `apps/api/src/modules/test-runs/services/test-runs-metrics.service.ts` (MEDIUM)
- [ ] `apps/api/src/modules/metrics/metrics.service.ts` (MEDIUM)
- [ ] `apps/api/src/modules/adapt/adapt.service.ts` (MEDIUM)
- [ ] `apps/api/src/modules/compare-presets/compare-presets.service.ts` (MEDIUM)
- [ ] `apps/api/src/modules/test-runs/services/test-runs-stale-detection.service.ts` (LOW)
- [ ] `apps/api/src/modules/test-runs/services/test-runs-changepoint.service.ts` (LOW)
- [ ] `apps/api/src/modules/deep-links/deep-links.service.ts` (LOW)
- [ ] `apps/api/src/modules/test-runs/services/test-runs-apdex.service.ts` (LOW)
- [ ] `apps/api/src/modules/test-runs/services/test-runs-baseline-apdex.service.ts` (LOW)
- [ ] `apps/api/src/modules/test-runs/services/test-runs-anomaly.service.ts` (LOW)
- [ ] `apps/api/src/modules/realtime/realtime.service.ts` (LOW)

### Total Services: 17 (1 completed, 16 remaining)

---

## Appendix B: Quick Reference Commands

### Search for Test Run Queries

```bash
# Find all services that query test runs
find apps/api/src/modules -name "*.service.ts" -not -name "*.spec.ts" \
  | xargs grep -l "testRunRepo\|TestRun.*Repository"

# Find specific query patterns
grep -r "testRunRepo.find\|testRunRepo.createQueryBuilder" \
  apps/api/src/modules/test-runs/services/ \
  --include="*.ts" --exclude="*.spec.ts"

# Find methods that accept userId parameter
grep -r "async.*userId.*roles.*:" \
  apps/api/src/modules/test-runs/services/ \
  --include="*.ts" --exclude="*.spec.ts"
```

### Run Tests

```bash
# Unit tests for specific service
npm test -- test-runs-crud-query.service.spec.ts

# Integration tests
npm test -- test-runs.integration.spec.ts

# All test-runs tests
npm test -- test-runs
```

### Check Database Indexes

```sql
-- Check if organization index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'systems_under_test'
  AND indexname LIKE '%organization%';

-- Check query performance
EXPLAIN ANALYZE
SELECT tr.*
FROM test_runs tr
LEFT JOIN systems_under_test sut ON tr.system_under_test_id = sut.id
WHERE sut.organization_id IN ('org-id-1')
LIMIT 50;
```

---

## Appendix C: Code Review Checklist

For each service file changed:

- [ ] All query methods accept `userId` and `roles` parameters
- [ ] Global admin bypass implemented correctly
- [ ] Organization filtering applied via JOIN with `systems_under_test`
- [ ] NULL organization_id handled correctly (admin-only access)
- [ ] Empty organization list returns empty result (not error)
- [ ] Individual entity checks use `isOrganizationMember()`
- [ ] Authorization context logged at DEBUG level
- [ ] Access denied events logged at WARN level
- [ ] Unit tests cover all authorization paths
- [ ] Integration tests verify cross-org isolation
- [ ] No performance regressions (measured)
- [ ] Code comments explain authorization logic
- [ ] Service documentation updated

---

## Document Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-09 | Claude | Initial comprehensive plan |

---

## Next Steps

1. **Review this plan** with team
2. **Prioritize phases** based on business needs
3. **Start with Phase 2** (Dashboard service) for immediate security fix
4. **Create tracking issue** for each service
5. **Assign owners** for each phase
6. **Schedule daily standups** during implementation
7. **Set up monitoring** before deployment

**Estimated Total Effort**: 3-5 days (1 developer, full-time)

**Recommended Approach**: Fix HIGH PRIORITY services (Phase 2) immediately, then systematic rollout of remaining services.
