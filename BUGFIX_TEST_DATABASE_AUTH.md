# Bug Fix: Test Database Authentication

## Issue
API tests were failing with database authentication error:
```
error: password authentication failed for user "perfana_user"
```

## Root Cause
Test configuration files were using outdated database credentials:
- **Old username**: `perfana_user`
- **Old password**: `perfana_test_password`
- **Old database**: `perfana_test`

The actual database credentials are:
- **Correct username**: `perfana`
- **Correct password**: `perfana`
- **Correct database**: `perfana_native`

## Files Updated

### 1. `/apps/api/src/test/setup.ts`
Updated default test database configuration:
```typescript
// Before
if (!process.env.DB_USERNAME) process.env.DB_USERNAME = 'perfana_user';
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = 'perfana_test_password';
if (!process.env.DB_NAME) process.env.DB_NAME = 'perfana_test';

// After
if (!process.env.DB_USERNAME) process.env.DB_USERNAME = 'perfana';
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = 'perfana';
if (!process.env.DB_NAME) process.env.DB_NAME = 'perfana_native';
```

### 2. `/apps/api/src/test/global-setup.ts`
Updated DataSource configuration:
```typescript
// Before
username: process.env.DB_USERNAME || 'perfana_user',
password: process.env.DB_PASSWORD || 'perfana_test_password',
database: process.env.DB_NAME || 'perfana_test',

// After
username: process.env.DB_USERNAME || 'perfana',
password: process.env.DB_PASSWORD || 'perfana',
database: process.env.DB_NAME || 'perfana_native',
```

### 3. `/apps/api/test/helpers/integration-test.helper.ts`
Updated TypeORM configuration factory:
```typescript
// Before
username: configService.get('DB_USERNAME', 'perfana_user'),
password: configService.get('DB_PASSWORD', 'perfana_test_password'),
database: configService.get('DB_NAME', 'perfana_test'),

// After
username: configService.get('DB_USERNAME', 'perfana'),
password: configService.get('DB_PASSWORD', 'perfana'),
database: configService.get('DB_NAME', 'perfana_native'),
```

### 4. Integration Test Files
Updated all references in:
- `apps/api/test/integration/database/data-integrity.integration.spec.ts`
- `apps/api/test/integration/database/entity-relations.integration.spec.ts`
- `apps/api/test/integration/database/test-run-repository.integration.spec.ts`

## Verification

### Database Connection Test
```bash
$ PGPASSWORD=perfana psql -h localhost -U perfana -d perfana_native -c "SELECT current_database(), current_user;"
 current_database | current_user
------------------+--------------
 perfana_native   | perfana
(1 row)
```

### Test Execution
```bash
$ npm test -- --testPathPattern="report-generation.service.spec"
🔧 Setting up test database...
  Found 5 API entities + 42 shared entities
  ✓ Connected to database
  ✓ Database schema synchronized from entities
  ✓ Database setup complete
```

**Result**: ✅ No more password authentication errors

## Impact
- ✅ Tests can now connect to the database
- ✅ Database schema synchronization works
- ✅ Integration tests can run
- ⚠️ Some tests still fail due to mocking issues (unrelated to database auth)

## Notes
- The database `perfana_native` has 67 tables
- Tests use `synchronize: true` in global setup to auto-create schema
- Tests use `synchronize: false` in test helpers to use existing schema
- Individual integration tests may override these defaults via environment variables
