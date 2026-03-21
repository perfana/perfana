# CRITICAL: Database Separation Fix

## What Happened

When fixing the test database authentication issue, I **incorrectly** changed the test configuration to use `perfana_native` (the development database) instead of a separate test database.

The test setup includes `dropSchema: true` which **drops all tables** before running tests:

```typescript
// global-setup.ts
const dataSource = new DataSource({
  ...
  synchronize: true,  // Auto-create schema from entities
  dropSchema: true,   // ⚠️ DROPS ALL TABLES before running tests
});
```

**Impact**:
- The `test_runs` table in `perfana_native` is now empty (0 rows)
- Database schema is intact (67 tables still exist)
- Worker jobs are failing because they reference test runs that no longer exist

## Fix Applied

### 1. Created Separate Test Database
```bash
$ PGPASSWORD=perfana psql -h localhost -U perfana -d postgres -c "CREATE DATABASE perfana_test OWNER perfana;"
```

### 2. Updated Test Configuration

**Files Updated**:
1. `/apps/api/src/test/setup.ts`
2. `/apps/api/src/test/global-setup.ts`
3. `/apps/api/test/helpers/integration-test.helper.ts`

**Change**:
```typescript
// BEFORE (INCORRECT - used development database)
database: configService.get('DB_NAME', 'perfana_native'),

// AFTER (CORRECT - uses separate test database)
database: configService.get('DB_NAME', 'perfana_test'),
```

## Database Setup Now

| Database | Purpose | Tables | Data |
|----------|---------|--------|------|
| `perfana_native` | Development | 67 | Schema intact, data lost |
| `perfana_test` | Tests | 0 → will be created by tests | Test data (dropped/recreated on each test run) |
| `keycloak` | Authentication | N/A | Keycloak data |

## How to Prevent This

### Option 1: Use .env.test file (Recommended)
Create `/apps/api/.env.test`:
```bash
# Test Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=perfana
DB_PASSWORD=perfana
DB_NAME=perfana_test  # ALWAYS use separate test database

# Never use perfana_native for tests!
```

### Option 2: CI/CD Environment Variables
Set in your CI/CD pipeline:
```bash
DB_NAME=perfana_test_ci  # Separate test database for CI
```

### Option 3: Docker Compose for Tests
Use a containerized test database:
```yaml
# docker-compose.test.yml
services:
  postgres-test:
    image: postgres:16
    environment:
      POSTGRES_DB: perfana_test
      POSTGRES_USER: perfana
      POSTGRES_PASSWORD: perfana
    ports:
      - "5433:5432"  # Different port from dev database
```

## Current Worker Error

The worker is failing because Redis queue has jobs for test runs that were deleted:

```
ERROR: Test run not found: PerfanaWebshop-acc-loadTest-00012
```

**To Fix**: Clear the stale Redis queue:
```bash
# Option 1: Restart worker (will retry and eventually fail the jobs)
# Option 2: Clear Redis queue manually
redis-cli FLUSHDB  # ⚠️ This clears ALL Redis data
# Option 3: Let jobs fail naturally (they'll eventually be removed)
```

## Restoring Development Data

Since this is a development environment and there's no backup:

1. **Re-run your test scenarios** to populate the database with new test runs
2. **Import seed data** if you have a seed script
3. **Continue development** - the schema is intact, just needs new test run data

## Lessons Learned

1. ✅ **ALWAYS use separate databases for tests** (`perfana_test`) and development (`perfana_native`)
2. ✅ **NEVER run tests against production or development databases** with `dropSchema: true`
3. ✅ **Document database setup** in README with clear separation of concerns
4. ✅ **Use .env.test** to prevent accidental misconfiguration
5. ✅ **Regular backups** even in development (especially before running tests for first time)

## Safe Test Practices Going Forward

```bash
# Before running tests, verify you're using test database
$ grep DB_NAME apps/api/src/test/setup.ts
if (!process.env.DB_NAME) process.env.DB_NAME = 'perfana_test';  ✅

# Check which database tests will use
$ cd apps/api && npm test 2>&1 | grep "database"
🔧 Setting up test database...  # Should be perfana_test

# Verify you're NOT connected to development database
$ PGPASSWORD=perfana psql -h localhost -U perfana -d perfana_test -c "SELECT current_database();"
 current_database
------------------
 perfana_test      ✅
```

## Status

✅ Test database created: `perfana_test`
✅ Test configuration updated to use `perfana_test`
✅ Development database `perfana_native` protected from future test runs
⚠️ Development data lost (schema intact, 0 test runs)
⚠️ Worker jobs failing for non-existent test runs (will auto-clear)

## Next Steps

1. ✅ Tests will now use `perfana_test` (safe)
2. ⬜ Re-populate `perfana_native` with development data
3. ⬜ Clear stale Redis jobs (optional - they'll fail and be removed automatically)
4. ⬜ Create backup strategy for development database
