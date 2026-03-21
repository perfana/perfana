# Testing Framework Documentation

This document describes the comprehensive testing framework for the Perfana DS Worker application.

## Overview

The testing framework provides multiple layers of testing:

- **Unit Tests**: Fast, isolated tests for individual components
- **Integration Tests**: Tests that verify component interactions with real infrastructure
- **Database Testing**: Tests with both in-memory and real PostgreSQL databases
- **API Mocking**: Mock implementations for external services (Grafana, etc.)

## Test Structure

```
src/test/
├── fixtures/          # Test data and realistic fixtures
├── helpers/           # Database setup, utilities
├── integration/       # Integration tests with real infrastructure
├── mocks/            # Mock implementations for external services
├── unit/             # Unit tests for individual components
├── setup.ts          # Unit test setup
└── setup.integration.ts  # Integration test setup
```

## Running Tests

### Unit Tests (Fast, No External Dependencies)
```bash
npm run test:unit          # Run all unit tests
npm run test:watch         # Watch mode for development
npm run test:coverage      # Run with coverage report
npm run test:ui           # Visual test runner
```

### Integration Tests (Requires PostgreSQL)
```bash
npm run test:integration   # Run integration tests with TestContainers
```

### All Tests
```bash
npm run test:all          # Run both unit and integration tests
npm run ci                # Full CI pipeline (lint, type-check, test, build)
```

## Test Categories

### Unit Tests

#### Pipeline Tests (`src/test/unit/pipelines/`)
- **PanelsPipeline.test.ts**: Tests the panels processing pipeline
  - Input validation
  - Database operations
  - Error handling
  - Performance logging
  - Dynatrace integration

- **panels-helpers.test.ts**: Tests helper functions
  - Application dashboard retrieval
  - Grafana dashboard retrieval
  - Benchmark retrieval
  - Panel document creation

#### Library Tests (`src/test/unit/lib/`)
- **grafana-client.test.ts**: Tests Grafana API integration
  - Request batching
  - Response processing
  - Error handling
  - Rate limiting
  - Concurrent requests

### Integration Tests

#### Workflow Tests (`src/test/integration/workflows/`)
- **analyze-test.integration.test.ts**: End-to-end workflow testing
  - Complete pipeline orchestration
  - Real database operations
  - Job queue integration
  - Error recovery
  - Pipeline dependencies

## Database Testing

### In-Memory Database (Unit Tests)
Uses `pg-mem` to provide fast, isolated database testing:

```typescript
import { createInMemoryDatabase } from '../../helpers/database.js';

const db = createInMemoryDatabase();
// Use db for fast unit tests
```

### Real PostgreSQL (Integration Tests)
Uses TestContainers to spin up real PostgreSQL instances:

```typescript
import { setupTestDatabase } from '../../helpers/database.js';

const container = await setupTestDatabase();
// Real PostgreSQL with full schema
```

## Mock Services

### Grafana API Mocking
```typescript
import { mockGrafanaAPI } from '../../mocks/grafana.js';

const { mockAxios, responses } = mockGrafanaAPI();
// Mock Grafana responses for testing
```

### pg-boss Queue Mocking
```typescript
import { MockJobQueueScenario } from '../../mocks/pgboss.js';

const jobQueue = new MockJobQueueScenario();
jobQueue.registerHandler('job-name', handler);
await jobQueue.sendJob('job-name', data);
```

## Test Fixtures

### Realistic Test Data
```typescript
import { testRunFixtures, panelDocumentFixtures } from '../../fixtures/test-data.js';

const testRun = testRunFixtures.basic();
const panelDoc = panelDocumentFixtures.responseTimePanel();
```

### Complete Test Scenarios
```typescript
import { createCompleteTestScenario } from '../../fixtures/test-data.js';

const scenario = createCompleteTestScenario();
// Includes test run, dashboards, benchmarks, panels, and metrics
```

## Writing Tests

### Unit Test Template
```typescript
import { describe, test, expect, beforeEach } from 'vitest';

describe('ComponentName', () => {
  let component: ComponentType;

  beforeEach(() => {
    component = new ComponentType();
  });

  describe('Feature Group', () => {
    test('should do something specific', () => {
      // Arrange
      const input = createTestInput();

      // Act
      const result = component.doSomething(input);

      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });
});
```

### Integration Test Template
```typescript
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

describe('Integration: WorkflowName', () => {
  let db: Pool;
  let app: Application;

  beforeEach(async () => {
    db = new Pool({ connectionString: process.env.DATABASE_URL });
    app = new Application();
    await clearTestData(db);
  });

  afterEach(async () => {
    await app.cleanup();
    await db.end();
  });

  test('should complete workflow successfully', async () => {
    // Setup test scenario
    const scenario = await createTestScenario(db);

    // Execute workflow
    const result = await app.executeWorkflow(scenario);

    // Verify results
    expect(result.success).toBe(true);
    await verifyDatabaseState(db, scenario);
  });
});
```

## Best Practices

### Test Isolation
- Each test should be independent and not rely on other tests
- Use `beforeEach` to set up fresh state
- Clear test data between tests
- Use mocks to isolate external dependencies

### Realistic Test Data
- Use fixtures that represent real production data
- Include edge cases and error conditions
- Test with various data sizes and complexities

### Error Testing
- Test both success and failure paths
- Verify error messages and codes
- Test recovery mechanisms and retries

### Performance Testing
- Verify performance logging works correctly
- Test with realistic data volumes
- Monitor memory usage in long-running tests

### Database Testing
- Use transactions to isolate database changes
- Test both successful operations and rollbacks
- Verify data integrity and constraints

## Environment Setup

### Required Environment Variables
```bash
# Database (same as API and grafana-sync services)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=test
DB_PASSWORD=test
DB_NAME=perfana_test

# For CI/CD
NODE_ENV=test
LOG_LEVEL=warn
```

Note: Grafana configuration comes from the `grafana_instances` table in the database, not environment variables.

### Docker Compose for Local Testing
```yaml
# docker-compose.test.yml
version: '3.8'
services:
  postgres-test:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: perfana_test
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    ports:
      - "5433:5432"
```

## CI/CD Integration

The testing framework is designed to work seamlessly in CI/CD pipelines:

```bash
# Complete CI pipeline
npm run ci

# Just tests (for faster feedback)
npm run test:unit
```

### Coverage Requirements
- Aim for >90% code coverage on core pipeline components
- >80% coverage on utility functions
- Focus on testing critical paths and error conditions

### Performance Benchmarks
- Unit tests should complete in <5 minutes
- Integration tests should complete in <15 minutes
- Memory usage should remain stable during test runs

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Ensure PostgreSQL is running for integration tests
   - Check DATABASE_URL environment variable
   - Verify database permissions

2. **Mock Service Issues**
   - Clear vi.mock() calls between tests
   - Ensure mocks are properly restored
   - Check axios mock configuration

3. **Memory Leaks in Tests**
   - Properly close database connections
   - Clear timers and intervals
   - Use `afterEach` cleanup functions

4. **Flaky Integration Tests**
   - Add appropriate timeouts
   - Use proper async/await patterns
   - Ensure proper test isolation

For more specific issues, check the individual test files for inline comments and examples.