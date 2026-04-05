# API Integration Tests

## Overview

This directory contains comprehensive integration tests for the Perfana API backend. These tests validate full request/response cycles with real database operations, ensuring API endpoints work correctly end-to-end.

## Test Suite Statistics

- **Total Integration Test Files**: 3
- **Total Integration Tests**: 120
- **Test Coverage**:
  - Test Runs API: 41 tests
  - API Keys API: 35 tests
  - Grafana API: 44 tests

## Test Files

### 1. test-runs.integration.spec.ts (41 tests)

Tests for the Test Runs API module covering:

#### Test Run Creation (POST /api/test)
- Create test run with full payload
- Update existing test run
- Validate required fields
- API key authentication
- Abort scenario handling
- Variables and deep links support

#### Configuration Management
- Add single configuration (POST /api/config/key)
- Add multiple configurations (POST /api/config/keys)
- Add configuration from JSON (POST /api/config/json)
- Include/exclude pattern filtering
- Nested JSON values
- Malicious regex detection

#### Test Run Queries
- List test runs with pagination (GET /api/test-runs)
- Get single test run by UUID or test_run_id (GET /api/test-runs/:id)
- Get test run configurations (GET /api/test-runs/:id/configs)
- Custom sorting and filtering

#### Test Run Mutations
- Update annotations (PUT /api/test-runs/:id/annotations)
- Update tags (PUT /api/test-runs/:id/tags)
- Delete test run (DELETE /api/test-runs/:id)

#### Authentication
- Keycloak JWT authentication
- API key authentication
- Unauthorized request handling

### 2. api-keys.integration.spec.ts (35 tests)

Tests for the API Keys management module covering:

#### API Key CRUD Operations
- Create API key with description (POST /api/api-keys)
- Create API key with TTL
- Create API key with admin roles
- Create API key with multiple roles
- List all API keys (GET /api/api-keys)
- Get single API key (GET /api/api-keys/:id)
- Delete API key (DELETE /api/api-keys/:id)

#### API Key Validation
- Validate valid API key token (POST /api/api-keys/validate)
- Invalidate expired API key
- Handle invalid tokens
- Rate limiting for validation requests

#### Cache Management
- Get cache statistics (GET /api/api-keys/cache/stats)
- Clear caches (POST /api/api-keys/cache/clear)
- Warm caches (POST /api/api-keys/cache/warm)

#### Lifecycle and Edge Cases
- Complete API key lifecycle flow
- Concurrent operations
- Special characters in descriptions
- Empty roles arrays
- Future expiry dates

### 3. grafana.integration.spec.ts (44 tests)

Tests for the Grafana integration module covering:

#### Grafana Instance Management
- Create Grafana instance (POST /api/grafana-instances)
- Create instance with authentication token
- Create snapshot instance
- List Grafana instances (GET /api/grafana-instances)
- Filter by snapshot flag and label
- Get single instance (GET /api/grafana-instances/:id)
- Update instance (PATCH /api/grafana-instances/:id)
- Delete instance (DELETE /api/grafana-instances/:id)
- Test connection (POST /api/grafana-instances/:id/test-connection)

#### Grafana Dashboard Management
- Create dashboard (POST /api/grafana/dashboards)
- Create dashboard with folder information
- List dashboards (GET /api/grafana/dashboards)
- Filter by instance, tags, name, UID
- Get single dashboard (GET /api/grafana/dashboards/:id)
- Update dashboard (PATCH /api/grafana/dashboards/:id)
- Delete dashboard (DELETE /api/grafana/dashboards/:id)

#### Dashboard Variables
- Get variable values (POST /api/grafana/dashboards/variable-values)
- Handle existing variables parameter

#### Application Dashboards
- List application dashboards (GET /api/grafana/application-dashboards)
- Filter by system ID, environment, label, tags

#### Workflow Integration
- Complete Grafana setup workflow (instance → connection → dashboards → updates)

## Test Infrastructure

### Integration Test Helper (`helpers/integration-test.helper.ts`)

Provides utilities for integration testing:

- **createTestApp()**: Creates NestJS application with database connection
- **closeTestApp()**: Cleans up test application
- **withTransaction()**: Wraps tests in database transactions
- **mockKeycloakToken()**: Generates mock JWT tokens
- **mockApiKeyToken()**: Generates mock API key tokens
- **getAuthHeaders()**: Returns Keycloak JWT auth headers
- **getApiKeyHeaders()**: Returns API key auth headers
- **cleanupTestData()**: Removes test data from database
- **generateTestRunId()**: Creates unique test run identifiers
- **generateUUID()**: Generates UUID v4

## Running Integration Tests

### Prerequisites

1. PostgreSQL database running and accessible
2. Redis server running (for caching and rate limiting)
3. Environment variables configured (see `.env.test`)

### Run All Integration Tests

```bash
cd apps/api
npm run test:e2e
```

### Run Specific Test File

```bash
# Test runs integration tests
npx jest test/integration/test-runs.integration.spec.ts

# API keys integration tests
npx jest test/integration/api-keys.integration.spec.ts

# Grafana integration tests
npx jest test/integration/grafana.integration.spec.ts
```

### Run with Coverage

```bash
npm run test:cov
```

### Run in Watch Mode

```bash
npm run test:watch
```

## Environment Configuration

Integration tests use the following environment variables:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=perfana_user
DB_PASSWORD=perfana_test_password
DB_NAME=perfana_test

# Redis Configuration
REDIS_URL=redis://localhost:6380
REDIS_PASSWORD=redis_dev_password

# JWT Configuration (for mocking)
JWT_SECRET=test-jwt-secret-key
JWT_REFRESH_SECRET=test-refresh-secret-key
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Feature Flags
USE_NATIVE_DB=true
USE_NATIVE_AUTH=true
USE_NATIVE_REALTIME=true
```

## Test Patterns and Best Practices

### 1. Database Transaction Management

Tests use real database transactions that rollback after execution:

```typescript
await withTransaction(dataSource, async (queryRunner) => {
  // Test operations here
  // Automatically rolled back after
});
```

### 2. Test Data Cleanup

After all tests, cleanup is performed:

```typescript
afterAll(async () => {
  await cleanupTestData(context.dataSource, [
    'test_run_configurations',
    'test_runs',
    'systems_under_test',
  ]);
  await closeTestApp(context);
});
```

### 3. Authentication Testing

Both authentication methods are tested:

```typescript
// Keycloak JWT
await request.get('/api/test-runs')
  .set(getAuthHeaders(['admin']))
  .expect(HttpStatus.OK);

// API Key
await request.get('/api/test-runs')
  .set(getApiKeyHeaders('description', 'uuid'))
  .expect(HttpStatus.OK);
```

### 4. Comprehensive Error Scenarios

Tests cover both success and failure paths:

```typescript
// Success case
await request.post('/api/api-keys')
  .send(validDto)
  .expect(HttpStatus.CREATED);

// Validation error
await request.post('/api/api-keys')
  .send(invalidDto)
  .expect(HttpStatus.BAD_REQUEST);

// Not found error
await request.get(`/api/api-keys/${fakeId}`)
  .expect(HttpStatus.NOT_FOUND);
```

## Key Features Tested

### Request Validation
- Required fields validation
- Data type validation
- Format validation (URLs, UUIDs, ISO dates)
- Regex pattern security (ReDoS prevention)

### Database Operations
- Create, read, update, delete operations
- Transactions and rollbacks
- Foreign key constraints
- Cascade deletes

### Authentication & Authorization
- Keycloak JWT validation
- API key validation and expiration
- Role-based access control
- Unauthorized request handling

### Performance Features
- Pagination support
- Filtering and sorting
- Caching strategies
- Rate limiting

### Edge Cases
- Empty arrays and objects
- Special characters
- Concurrent operations
- Boundary values
- Malformed input

## Troubleshooting

### Database Connection Issues

If tests fail with database connection errors:

1. Ensure PostgreSQL is running
2. Check database credentials in `.env.test`
3. Verify database exists: `createdb perfana_test`
4. Run migrations: `npm run migration:run`

### Redis Connection Issues

If cache-related tests fail:

1. Ensure Redis is running
2. Check Redis URL in `.env.test`
3. Test Redis connection: `redis-cli ping`

### Test Timeout Issues

If tests timeout:

1. Increase Jest timeout in `setup.ts`
2. Check for slow database queries
3. Ensure test database is properly indexed

## Contributing

When adding new integration tests:

1. Follow existing test structure and patterns
2. Use descriptive test names with `should` prefix
3. Test both success and error scenarios
4. Clean up test data in `afterAll` hooks
5. Use test helpers for common operations
6. Document complex test scenarios
7. Ensure tests are idempotent

## Test Metrics

- **Code Coverage Target**: 80%+
- **Expected Pass Rate**: 90%+
- **Test Execution Time**: ~30-60 seconds
- **Test Isolation**: Each test is independent and can run in any order

## Next Steps

Future integration test additions:

1. Benchmarks API integration tests
2. Reports API integration tests
3. Organizations and Teams API tests
4. Real-time WebSocket integration tests
5. Data Science API tests
6. Dynatrace integration tests

## References

- [NestJS Testing Documentation](https://docs.nestjs.com/fundamentals/testing)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [SuperTest Documentation](https://github.com/ladjs/supertest)
- [TypeORM Testing Guide](https://typeorm.io/testing)
