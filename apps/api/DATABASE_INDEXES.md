# Database Index Strategy

This document describes the database indexing strategy for the Perfana API to optimize query performance.

## Index Overview

Indexes are added to frequently queried columns to improve read performance. Each index has a specific purpose based on actual query patterns identified in the codebase.

## Test Runs Table Indexes

The `test_runs` table is the most heavily queried table in the system and requires comprehensive indexing.

### Single-Column Indexes

| Index Name | Column | Purpose | Query Pattern |
|------------|--------|---------|---------------|
| `idx_test_runs_system_under_test_id` | `system_under_test_id` | Foreign key lookups | `WHERE system_under_test_id = ?` |
| `idx_test_runs_test_environment` | `test_environment` | Environment filtering | `WHERE test_environment = ?` |
| `idx_test_runs_workload` | `workload` | Workload filtering | `WHERE workload = ?` |
| `idx_test_runs_completed` | `completed` | Status filtering | `WHERE completed = true/false` |
| `idx_test_runs_created_at` | `created_at DESC` | Sorting by date | `ORDER BY created_at DESC` |

**Note**: `test_run_id` already has a UNIQUE index from the unique constraint, so no additional index is needed.

### Composite Indexes

Composite indexes are crucial for optimizing multi-condition queries:

| Index Name | Columns | Purpose |
|------------|---------|---------|
| `idx_test_runs_system_env_workload` | `(system_under_test_id, test_environment, workload)` | Find all test runs for a specific system/environment/workload combination |
| `idx_test_runs_system_env_workload_created` | `(system_under_test_id, test_environment, workload, created_at DESC)` | Same as above but with date sorting for pagination |

### Query Examples Using These Indexes

```sql
-- Uses: idx_test_runs_system_env_workload
SELECT * FROM test_runs
WHERE system_under_test_id = 'uuid'
  AND test_environment = 'production'
  AND workload = 'load-test';

-- Uses: idx_test_runs_system_env_workload_created
SELECT * FROM test_runs
WHERE system_under_test_id = 'uuid'
  AND test_environment = 'production'
  AND workload = 'load-test'
ORDER BY created_at DESC
LIMIT 50;

-- Uses: idx_test_runs_created_at
SELECT * FROM test_runs
ORDER BY created_at DESC
LIMIT 100;

-- Uses: idx_test_runs_completed + idx_test_runs_created_at
SELECT * FROM test_runs
WHERE completed = true
ORDER BY created_at DESC;
```

## API Keys Table Indexes

| Index Name | Column | Purpose | Query Pattern |
|------------|--------|---------|---------------|
| `idx_api_keys_valid_until` | `valid_until` | Find expired keys | `WHERE valid_until < NOW()` |

**Note**: `api_key` already has a UNIQUE index from the unique constraint for authentication lookups.

### Query Examples

```sql
-- Uses: UNIQUE index on api_key
SELECT * FROM api_keys WHERE api_key = 'key_value';

-- Uses: idx_api_keys_valid_until
SELECT * FROM api_keys WHERE valid_until > NOW();
```

## Systems Under Test Table Indexes

| Index Name | Column | Purpose | Query Pattern |
|------------|--------|---------|---------------|
| `idx_systems_under_test_name` | `name` | Find by system name | `WHERE name = ?` |
| `idx_systems_under_test_team_id` | `team_id` | Filter by team | `WHERE team_id = ?` |

### Query Examples

```sql
-- Uses: idx_systems_under_test_name
SELECT id FROM systems_under_test WHERE name = 'my-service';

-- Uses: idx_systems_under_test_team_id
SELECT * FROM systems_under_test WHERE team_id = 'uuid';
```

## Index Maintenance

### PostgreSQL Auto-Vacuuming

PostgreSQL automatically maintains indexes through the autovacuum process. For production systems:

```sql
-- Check index usage statistics
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Check index sizes
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Unused Index Detection

Monitor for unused indexes that consume space but don't improve performance:

```sql
-- Find indexes with zero or very low usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan < 10
ORDER BY idx_scan;
```

## Performance Impact

### Before Indexes (Estimated)

- `GET /test-runs` with filters: Full table scan (100-1000+ rows)
- Related test runs query: Full table scan on 10,000+ rows
- System lookup by name: Sequential scan
- API key validation: Sequential scan (if not using unique constraint)

### After Indexes (Estimated)

- `GET /test-runs` with filters: Index scan (10-100 rows examined)
- Related test runs query: Composite index scan (50-100 rows)
- System lookup by name: Index scan (1-10 rows)
- API key validation: Unique index scan (1 row)

**Performance Improvement**: 10-100x faster for filtered queries on large datasets.

## Index Design Principles

### DO ✅

1. **Index Foreign Keys**: Always index columns used in JOINs (`system_under_test_id`)
2. **Index Filter Columns**: Index columns frequently used in WHERE clauses
3. **Index Sort Columns**: Index columns used in ORDER BY, especially with DESC
4. **Use Composite Indexes**: For queries with multiple WHERE conditions
5. **Put Most Selective Column First**: In composite indexes, order matters
6. **Index Unique Constraints**: Let PostgreSQL create these automatically

### DON'T ❌

1. **Over-Index**: Every index has a write cost (slower INSERT/UPDATE/DELETE)
2. **Index Low-Cardinality Columns Alone**: Boolean columns (except when combined)
3. **Duplicate Indexes**: Check existing indexes before adding new ones
4. **Index Everything**: Only index columns actually used in queries
5. **Forget to Monitor**: Track index usage and remove unused indexes

## Composite Index Column Order

The order of columns in composite indexes is critical:

### Good Examples ✅

```sql
-- Most selective first (system_id is more selective than environment)
CREATE INDEX ON test_runs (system_under_test_id, test_environment, workload);

-- Supports these queries:
-- WHERE system_under_test_id = ?
-- WHERE system_under_test_id = ? AND test_environment = ?
-- WHERE system_under_test_id = ? AND test_environment = ? AND workload = ?
```

### Bad Examples ❌

```sql
-- Less selective column first
CREATE INDEX ON test_runs (test_environment, system_under_test_id, workload);

-- Only useful for:
-- WHERE test_environment = ?
-- WHERE test_environment = ? AND system_under_test_id = ?
-- Less useful for our common query patterns
```

## Migration Strategy

### Running the Migration

The migration file `1729176000000-AddDatabaseIndexes.ts` contains all index definitions.

**Development**:
```bash
npm run typeorm migration:run
```

**Production**:
```bash
# Run during low-traffic period
npm run typeorm migration:run

# Monitor index creation progress
SELECT
  query,
  state,
  wait_event_type,
  wait_event
FROM pg_stat_activity
WHERE query LIKE '%CREATE INDEX%';
```

### Rollback

If indexes cause issues:
```bash
npm run typeorm migration:revert
```

## Monitoring and Tuning

### Check Query Performance

```sql
-- Enable query timing
EXPLAIN ANALYZE
SELECT * FROM test_runs
WHERE system_under_test_id = 'uuid'
  AND test_environment = 'production'
  AND workload = 'load-test'
ORDER BY created_at DESC
LIMIT 50;
```

Look for:
- ✅ "Index Scan" or "Index Only Scan" in the plan
- ❌ "Seq Scan" (sequential scan) indicates missing or unused index
- Execution time < 10ms for most queries

### Index Hit Rate

Monitor the index hit rate in PostgreSQL:

```sql
SELECT
  sum(idx_blks_read) as idx_read,
  sum(idx_blks_hit) as idx_hit,
  sum(idx_blks_hit) / sum(idx_blks_hit + idx_blks_read) AS ratio
FROM pg_statio_user_indexes;
```

Target: > 0.99 (99% hit rate)

## Future Considerations

### Potential Additional Indexes

As the application grows, consider adding:

1. **Partial Indexes** for frequently filtered subsets:
   ```sql
   CREATE INDEX idx_active_test_runs
   ON test_runs (created_at DESC)
   WHERE completed = false;
   ```

2. **GIN Indexes** for array columns (tags, annotations):
   ```sql
   CREATE INDEX idx_test_runs_tags
   ON test_runs USING GIN (tags);
   ```

3. **Full-Text Search** indexes if needed:
   ```sql
   CREATE INDEX idx_test_runs_search
   ON test_runs USING GIN (to_tsvector('english', description));
   ```

### Index Bloat

Monitor index bloat and reindex if necessary:

```sql
-- Check index bloat
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public';

-- Reindex if bloated (low-traffic period only)
REINDEX INDEX CONCURRENTLY idx_test_runs_created_at;
```

## Conclusion

The index strategy focuses on:
1. Optimizing the most frequent query patterns
2. Using composite indexes for multi-column filters
3. Balancing read performance vs. write overhead
4. Monitoring and adjusting based on actual usage

**Total Indexes Added**: 10
- Test Runs: 7 (5 single + 2 composite)
- API Keys: 1
- Systems Under Test: 2

**Expected Performance Gain**: 10-100x for filtered and sorted queries on large datasets.
