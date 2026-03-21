# N+1 Query Analysis and Optimizations

This document analyzes potential N+1 query issues in the Perfana API and provides optimization solutions.

## Identified N+1 Issues

### 1. findAll() - SystemUnderTest Relation (OPTIMIZED ✅)

**Location**: `test-runs-query.service.ts:104-111`

**Status**: Already optimized with `leftJoinAndSelect`

```typescript
const testRunEntities = await this.testRunRepo
  .createQueryBuilder('tr')
  .leftJoinAndSelect('tr.systemUnderTest', 'sut')  // ✅ Already optimized
  .orderBy('tr.createdAt', 'DESC')
  .getMany();
```

**Analysis**: This query correctly uses `leftJoinAndSelect` to eagerly load the `systemUnderTest` relation in a single query, avoiding N+1 issues.

### 2. findByTestRunId() - Changepoint Check (POTENTIAL N+1 ⚠️)

**Location**: `test-runs-query.service.ts:171-202`

**Issue**: For each individual test run fetch, a separate query checks if it's a changepoint.

**Current Code**:
```typescript
const testRunEntity = await this.testRunRepo.findOne({
  where: { testRunId },
  relations: ['systemUnderTest']  // ✅ Optimized
});

// ⚠️ Separate query for changepoint check
testRun.is_changepoint = await this.isTestRunChangepoint(
  testRun.system_under_test_id,
  testRun.test_environment,
  testRun.workload,
  testRunId
);
```

**Impact**: Low - This is a single-record fetch, the extra query is acceptable for individual lookups.

**Recommendation**: Keep as-is. The additional query is intentional and doesn't cause performance issues for single-record queries.

### 3. getSystemsSummary() - Test Runs Relation (POTENTIAL N+1 ⚠️)

**Location**: `test-runs-query.service.ts:379-429`

**Issue**: Uses `relations: ['testRuns']` which causes TypeORM to load ALL test runs for ALL systems in memory.

**Current Code**:
```typescript
const systems = await this.systemRepo.find({
  relations: ['testRuns'],  // ⚠️ Loads ALL test runs in memory
  order: { name: 'ASC' }
});
```

**Impact**: HIGH - For systems with thousands of test runs, this loads massive amounts of data unnecessarily.

**Optimization Solution**:
```typescript
async getSystemsSummary(): Promise<Array<{...}>> {
  try {
    // Get all systems
    const systems = await this.systemRepo.find({
      order: { name: 'ASC' }
    });

    // Use a single query to get distinct environment/workload combinations
    const envWorkloadData = await this.testRunRepo
      .createQueryBuilder('tr')
      .select([
        'tr.systemUnderTestId',
        'tr.testEnvironment',
        'tr.workload'
      ])
      .distinct(true)
      .getMany();

    // Group by system
    const envWorkloadMap = new Map<string, Map<string, Set<string>>>();

    envWorkloadData.forEach(item => {
      if (!envWorkloadMap.has(item.systemUnderTestId)) {
        envWorkloadMap.set(item.systemUnderTestId, new Map());
      }

      const envMap = envWorkloadMap.get(item.systemUnderTestId)!;
      if (!envMap.has(item.testEnvironment)) {
        envMap.set(item.testEnvironment, new Set());
      }

      envMap.get(item.testEnvironment)!.add(item.workload);
    });

    // Build response
    return systems.map(system => {
      const envMap = envWorkloadMap.get(system.id) || new Map();
      const environments = Array.from(envMap.entries()).map(([environment, workloadsSet]) => ({
        environment,
        workloads: Array.from(workloadsSet).sort()
      }));

      return {
        id: system.id,
        name: system.name,
        environments,
        created_at: system.created_at.toISOString()
      };
    });
  } catch (error) {
    this.logger.error('Failed to get systems summary:', error);
    throw error;
  }
}
```

**Queries Before**: 1 (systems) + N (all test runs for all systems loaded via relation)
**Queries After**: 2 (systems + one query for distinct env/workload combinations)

### 4. findOne() - Same as findByTestRunId() (ACCEPTABLE ✅)

**Location**: `test-runs-query.service.ts:204-235`

**Analysis**: Same pattern as `findByTestRunId()`. Single record fetch with one additional changepoint query is acceptable.

## Query Count Analysis

### Before Optimizations

| Endpoint | Queries | Issue |
|----------|---------|-------|
| `GET /test-runs` | 4 | ✅ Acceptable (main query + changepoints + control groups) |
| `GET /test-runs/:id` | 2 | ✅ Acceptable (single record + changepoint check) |
| `GET /config/systems` | 1 + N*M | ⚠️ Loads ALL test runs for ALL systems |

Where:
- N = number of systems
- M = average test runs per system

### After Optimizations

| Endpoint | Queries | Improvement |
|----------|---------|-------------|
| `GET /test-runs` | 4 | No change (already optimal) |
| `GET /test-runs/:id` | 2 | No change (acceptable for single record) |
| `GET /config/systems` | 2 | ✅ MAJOR: Fixed O(N*M) to O(2) |

## Recommendations

### High Priority (Implemented)

1. ✅ **Optimize getSystemsSummary()** - Use distinct query instead of loading all test runs
   - Impact: CRITICAL for systems with many test runs
   - Implementation: Replace `relations: ['testRuns']` with distinct query

### Medium Priority (Consider for Future)

2. **Add Query Logging in Development**
   - Add TypeORM query logging to track query counts
   - Update `database.config.ts`:
   ```typescript
   logging: configService.get<string>('NODE_ENV') === 'development'
     ? ['query', 'error', 'warn']
     : ['error'],
   ```

3. **Monitor Query Performance**
   - Add query timing logs for slow queries (>100ms)
   - Use PostgreSQL EXPLAIN ANALYZE for complex queries

### Low Priority

4. **Consider Caching for Frequently Accessed Data**
   - Cache systems summary (rarely changes)
   - Cache changepoint/control group lookups
   - Use Redis with TTL of 5-10 minutes

## Query Performance Best Practices

### DO ✅

1. Use `leftJoinAndSelect()` for eager loading related entities
2. Use `select()` to fetch only required columns
3. Use `distinct()` when you only need unique combinations
4. Add `.limit()` to queries that can return many results
5. Use QueryBuilder for complex queries instead of `find()` with relations

### DON'T ❌

1. Use `relations: ['entity']` when loading collections of parent entities
2. Load entire entity graphs when you only need a few fields
3. Make sequential queries in loops
4. Use `getMany()` without pagination on large tables
5. Rely on TypeORM lazy loading (causes N+1 by default)

## Monitoring Recommendations

1. **Add Query Logging Middleware**
   ```typescript
   if (NODE_ENV === 'development') {
     app.use((req, res, next) => {
       const start = Date.now();
       res.on('finish', () => {
         const duration = Date.now() - start;
         if (duration > 100) {
           logger.warn(`Slow request: ${req.method} ${req.path} - ${duration}ms`);
         }
       });
       next();
     });
   }
   ```

2. **Track Database Query Counts**
   - Use TypeORM logging to count queries per request
   - Alert when query count > threshold (e.g., 10 queries per request)

3. **Use Database Connection Pooling**
   - Already configured in TypeORM
   - Monitor pool usage and adjust `extra.max` if needed

## Conclusion

The test-runs module is generally well-optimized with proper use of eager loading. The main N+1 issue identified is in `getSystemsSummary()` which loads all test runs for all systems unnecessarily. This has been optimized to use a single distinct query instead.

**Overall Status**:
- Critical N+1 issues: 0 (after optimization)
- Minor acceptable extra queries: 2 (single-record lookups with changepoint checks)
- Query patterns: Generally following best practices
