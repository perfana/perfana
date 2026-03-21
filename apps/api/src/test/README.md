# Perfana API Test Suite

This comprehensive test suite is designed to validate the migration from Supabase to native PostgreSQL and ensure regression-free operations.

## Test Structure

### 📁 Test Organization

```
src/test/
├── utils/                     # Test utilities and helpers
│   ├── test-data-factory.ts   # Test data generation
│   └── database-test-helper.ts # Database comparison utilities
├── integration/               # Integration tests
│   └── database-operations.test.ts
├── regression/                # Regression tests
│   ├── authentication.test.ts
│   └── realtime.test.ts
├── e2e/                      # End-to-end tests
│   └── migration-comparison.test.ts
├── migration-validation.test.ts # Core migration validation
├── setup.ts                  # Global test setup
├── env.setup.ts             # Environment configuration
└── README.md                 # This file
```

### 🧪 Test Categories

#### 1. **Migration Validation Tests** (`migration-validation.test.ts`)
Core tests that validate the migration from Supabase to native PostgreSQL:
- Database service comparison
- Authentication system validation
- Real-time system validation
- Feature flags and database factory pattern
- Data integrity and performance

#### 2. **Integration Tests** (`integration/`)
Tests that verify individual components work correctly with the native PostgreSQL system:
- **Database Operations**: CRUD operations, relationships, data integrity
- Performance benchmarks
- Error handling and edge cases
- Concurrent operations

#### 3. **Regression Tests** (`regression/`)
Tests that ensure new functionality doesn't break existing features:
- **Authentication**: User registration, login, token management, password operations
- **Real-time**: WebSocket connections, room management, event broadcasting
- Performance regression detection
- Security validation

#### 4. **End-to-End Tests** (`e2e/`)
Full workflow tests that simulate real user scenarios:
- **Migration Comparison**: Complete API workflows, load testing, data consistency
- API authentication flows
- Configuration management workflows
- Security and error handling

## 🔧 Test Utilities

### TestDataFactory
Generates realistic and deterministic test data:
- **Random Data**: Using Faker.js for realistic test scenarios
- **Deterministic Data**: Consistent data for regression tests
- **Bulk Operations**: Create multiple related entities
- **Validation Helpers**: Ensure data integrity

### DatabaseTestHelper
Provides utilities for comparing database operations:
- **Operation Comparison**: Compare native vs Supabase results
- **Performance Measurement**: Benchmark operation times
- **Bulk Data Creation**: Set up complex test scenarios
- **Integrity Validation**: Verify referential integrity
- **Report Generation**: Comprehensive comparison reports

## 🚀 Running Tests

### Prerequisites
1. **PostgreSQL Database**: Running on localhost:5432 (or configured via env vars)
2. **Redis**: Running on localhost:6380 (or configured via env vars)
3. **Environment Variables**: Set up test environment (see setup.ts)

### Test Commands

```bash
# Run all tests
npm test

# Run specific test categories
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
npm run test:regression    # Regression tests
npm run test:e2e          # End-to-end tests
npm run test:migration    # Migration validation

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- src/test/migration-validation.test.ts
```

### Docker Support
Run tests with Docker services:

```bash
# Start test environment
docker-compose -f docker-compose.dev.yml up -d

# Run tests
npm test

# Cleanup
docker-compose -f docker-compose.dev.yml down
```

## 📊 Test Reports

### Migration Comparison Report
The E2E tests generate a comprehensive comparison report:

```
=== MIGRATION COMPARISON REPORT ===
Total Tests: 45
Passed: 43
Failed: 2
Success Rate: 95.56%
Average Duration: 125.67ms

Critical Failures:
- createUser: Results differ between native and supabase implementations
- tokenValidation: Performance threshold exceeded
```

### Coverage Reports
Test coverage reports are generated in `coverage/apps/api/`:
- **HTML Report**: `coverage/apps/api/lcov-report/index.html`
- **LCOV Data**: `coverage/apps/api/lcov.info`
- **JSON Report**: `coverage/apps/api/coverage-final.json`

## 🔒 Test Environment

### Environment Variables
Tests use a hierarchical environment configuration:
1. `.env.test` (highest priority)
2. `.env.local`
3. `.env` (lowest priority)

Key variables:
```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=perfana_user
DB_PASSWORD=perfana_password
DB_NAME=perfana_test

# Redis
REDIS_URL=redis://localhost:6380
REDIS_PASSWORD=redis_dev_password

# JWT
JWT_SECRET=test-jwt-secret-key
JWT_REFRESH_SECRET=test-refresh-secret-key

# Feature Flags
USE_NATIVE_DB=true
USE_NATIVE_AUTH=true
USE_NATIVE_REALTIME=true
LOG_MIGRATION_DIFFS=true
```

### Test Data Isolation
- Each test suite gets a fresh database schema
- Tests use deterministic data for consistency
- Cleanup is automatic between test runs
- No shared state between test files

## 📋 Test Checklist

### Before Migration
- [ ] All tests pass with Supabase configuration
- [ ] Performance benchmarks established
- [ ] Test coverage above 80%
- [ ] No critical security issues

### During Migration
- [ ] Feature flags enable gradual rollout
- [ ] Comparison tests show data parity
- [ ] Performance within acceptable thresholds
- [ ] No authentication or authorization issues

### After Migration
- [ ] All regression tests pass
- [ ] Performance meets or exceeds benchmarks
- [ ] Security validation passes
- [ ] End-to-end workflows function correctly

## 🐛 Debugging Tests

### Common Issues

1. **Database Connection Errors**
   ```bash
   # Check PostgreSQL is running
   docker-compose ps postgres

   # Check connection
   psql -h localhost -p 5432 -U perfana_user -d perfana_test
   ```

2. **Redis Connection Errors**
   ```bash
   # Check Redis is running
   docker-compose ps redis

   # Test connection
   redis-cli -h localhost -p 6380 ping
   ```

3. **Test Timeouts**
   - Increase timeout in jest.config.js
   - Check for unresolved promises
   - Verify database operations complete

### Debug Mode
Run tests with debug output:
```bash
# Enable debug logging
DEBUG=* npm test

# Verbose Jest output
npm test -- --verbose

# Run single test with debug
npm test -- --testNamePattern="should create user" --verbose
```

## 📈 Performance Monitoring

### Benchmark Thresholds
- **User Operations**: < 200ms average
- **Test Run Operations**: < 500ms average
- **Authentication**: < 100ms average
- **API Responses**: < 500ms average, < 1s max

### Performance Tests
The test suite includes performance regression detection:
- Operation timing comparisons
- Concurrent operation handling
- Memory usage monitoring
- Database query performance

## 🔄 Continuous Integration

### GitHub Actions Integration
```yaml
name: Migration Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: timescale/timescaledb:latest-pg15
        env:
          POSTGRES_PASSWORD: perfana_password
          POSTGRES_USER: perfana_user
          POSTGRES_DB: perfana_test
      redis:
        image: redis:7-alpine
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run test:migration
```

## 📝 Adding New Tests

### Test Naming Convention
- `*.test.ts` for integration/e2e/regression tests
- `*.spec.ts` for unit tests
- Descriptive test names that explain the scenario

### Test Structure Template
```typescript
describe('Feature Name', () => {
  let testContext: any;

  beforeAll(async () => {
    testContext = await DatabaseTestHelper.setupTestEnvironment();
  });

  afterAll(async () => {
    await DatabaseTestHelper.teardownTestEnvironment();
  });

  describe('Specific Functionality', () => {
    test('should do something specific', async () => {
      // Arrange
      const testData = TestDataFactory.createSomething();

      // Act
      const result = await DatabaseTestHelper.compareOperation(
        'operationName',
        () => testContext.service.doSomething(testData)
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.nativeResult).toBeDefined();
    });
  });
});
```

This comprehensive test suite ensures a smooth, validated migration from Supabase to native PostgreSQL while maintaining all existing functionality and performance standards.