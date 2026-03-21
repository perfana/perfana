# Phase 15: Integration Testing - Strategic Plan

**Date**: 2025-01-13
**Status**: ⚠️ **PLAN ONLY** - Session limit reached for automated test generation
**Focus**: Integration testing strategy and roadmap
**Current Coverage**: ~35-38%
**Target After Phase 15**: ~45-50%

---

## Executive Summary

Phase 15 was planned to add comprehensive integration tests across API, database, worker, and web application layers. Due to Task tool session limits, this document provides a **detailed strategic plan** for implementing these integration tests.

### What Would Have Been Delivered

**Estimated deliverables** if executed:
- **4 test suites** across different integration layers
- **180-250 integration tests** total
- **Coverage increase**: ~35-38% → ~45-50%
- **Confidence boost**: End-to-end workflow validation

---

## Integration Testing Strategy

### Layer 1: API Integration Tests (60-80 tests)

**Location**: `/apps/api/test/integration/`

**Focus**: Full HTTP request/response cycles with real database

#### Test Runs API Integration (25-30 tests)

```typescript
describe('Test Runs API Integration', () => {
  let app: INestApplication;
  let testRunRepository: Repository<TestRun>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    testRunRepository = moduleFixture.get(getRepositoryToken(TestRun));
  });

  afterEach(async () => {
    await testRunRepository.clear();
  });

  describe('POST /test', () => {
    it('should create test run with full payload', async () => {
      const testRunData = {
        testRunId: 'test-2025-001',
        systemUnderTest: 'ecommerce-api',
        testEnvironment: 'staging',
        workload: 'load-test-v1',
        testRunStart: '2025-01-13T00:00:00Z',
        testRunEnd: '2025-01-13T01:00:00Z',
        annotations: { version: '1.2.3' },
        tags: ['regression', 'nightly']
      };

      const response = await request(app.getHttpServer())
        .post('/test')
        .send(testRunData)
        .expect(201);

      expect(response.body.testRunId).toBe('test-2025-001');

      // Verify database persistence
      const saved = await testRunRepository.findOne({
        where: { testRunId: 'test-2025-001' }
      });
      expect(saved).toBeDefined();
      expect(saved.systemUnderTest).toBe('ecommerce-api');
    });

    it('should handle duplicate test run creation', async () => {
      const testRunData = { testRunId: 'test-duplicate', /* ... */ };

      // First creation succeeds
      await request(app.getHttpServer())
        .post('/test')
        .send(testRunData)
        .expect(201);

      // Duplicate should update
      await request(app.getHttpServer())
        .post('/test')
        .send({ ...testRunData, workload: 'updated' })
        .expect(200);

      const updated = await testRunRepository.findOne({
        where: { testRunId: 'test-duplicate' }
      });
      expect(updated.workload).toBe('updated');
    });

    it('should validate required fields', async () => {
      const invalidData = { testRunId: 'test-invalid' };

      await request(app.getHttpServer())
        .post('/test')
        .send(invalidData)
        .expect(400);
    });
  });

  describe('POST /test-config', () => {
    it('should add configuration to test run', async () => {
      // Create test run first
      await testRunRepository.save({ testRunId: 'test-123' });

      const configData = {
        testRunId: 'test-123',
        key: 'server.threads',
        value: '100'
      };

      await request(app.getHttpServer())
        .post('/test-config')
        .send(configData)
        .expect(201);
    });

    it('should handle nested JSON configuration', async () => {
      await testRunRepository.save({ testRunId: 'test-123' });

      const configData = {
        testRunId: 'test-123',
        key: 'database',
        value: JSON.stringify({
          host: 'localhost',
          port: 5432,
          pool: { min: 2, max: 10 }
        })
      };

      const response = await request(app.getHttpServer())
        .post('/test-config')
        .send(configData)
        .expect(201);

      expect(JSON.parse(response.body.value)).toHaveProperty('pool');
    });
  });

  describe('GET /test-runs', () => {
    beforeEach(async () => {
      await testRunRepository.save([
        { testRunId: 'test-1', status: 'SUCCESS', systemUnderTest: 'api-1' },
        { testRunId: 'test-2', status: 'FAILURE', systemUnderTest: 'api-1' },
        { testRunId: 'test-3', status: 'SUCCESS', systemUnderTest: 'api-2' },
      ]);
    });

    it('should list all test runs', async () => {
      const response = await request(app.getHttpServer())
        .get('/test-runs')
        .expect(200);

      expect(response.body).toHaveLength(3);
    });

    it('should filter by system under test', async () => {
      const response = await request(app.getHttpServer())
        .get('/test-runs')
        .query({ systemUnderTest: 'api-1' })
        .expect(200);

      expect(response.body).toHaveLength(2);
    });

    it('should filter by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/test-runs')
        .query({ status: 'SUCCESS' })
        .expect(200);

      expect(response.body).toHaveLength(2);
    });

    it('should paginate results', async () => {
      const response = await request(app.getHttpServer())
        .get('/test-runs')
        .query({ limit: 2, offset: 1 })
        .expect(200);

      expect(response.body).toHaveLength(2);
    });
  });

  describe('GET /test-runs/:id', () => {
    it('should retrieve test run with configurations', async () => {
      const testRun = await testRunRepository.save({
        testRunId: 'test-with-config',
        configurations: [
          { key: 'threads', value: '100' },
          { key: 'duration', value: '3600' }
        ]
      });

      const response = await request(app.getHttpServer())
        .get('/test-runs/test-with-config')
        .expect(200);

      expect(response.body.testRunId).toBe('test-with-config');
      expect(response.body.configurations).toHaveLength(2);
    });

    it('should return 404 for non-existent test run', async () => {
      await request(app.getHttpServer())
        .get('/test-runs/non-existent')
        .expect(404);
    });
  });
});
```

#### API Keys Integration (15-20 tests)

- Create API key with TTL
- List API keys
- Authenticate requests with API key
- Test expired API keys
- Delete API keys
- Validate API key format

#### Grafana Integration (20-30 tests)

- List Grafana instances
- Sync dashboards from Grafana
- Create application dashboards
- Dashboard filtering and search
- Snapshot generation
- Error handling (Grafana unreachable)

---

### Layer 2: Database Integration Tests (50-70 tests)

**Location**: `/apps/api/test/integration/database/`

**Focus**: Repository methods with real PostgreSQL

#### TestRunRepository Integration (20-25 tests)

```typescript
describe('TestRunRepository Integration', () => {
  let repository: TestRunRepository;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    repository = dataSource.getCustomRepository(TestRunRepository);
  });

  afterEach(async () => {
    await dataSource.getRepository(TestRun).clear();
  });

  describe('Complex Queries', () => {
    it('should find test runs with multiple filters', async () => {
      await repository.save([
        {
          testRunId: 'test-1',
          status: 'SUCCESS',
          systemUnderTest: 'ecommerce',
          testEnvironment: 'staging',
          tags: ['nightly', 'regression']
        },
        {
          testRunId: 'test-2',
          status: 'FAILURE',
          systemUnderTest: 'ecommerce',
          testEnvironment: 'production'
        },
        {
          testRunId: 'test-3',
          status: 'SUCCESS',
          systemUnderTest: 'payment',
          testEnvironment: 'staging'
        }
      ]);

      const results = await repository
        .createQueryBuilder('tr')
        .where('tr.systemUnderTest = :sut', { sut: 'ecommerce' })
        .andWhere('tr.testEnvironment = :env', { env: 'staging' })
        .andWhere('tr.status = :status', { status: 'SUCCESS' })
        .getMany();

      expect(results).toHaveLength(1);
      expect(results[0].testRunId).toBe('test-1');
    });

    it('should find test runs with tag filtering', async () => {
      await repository.save([
        { testRunId: 'test-1', tags: ['nightly', 'regression'] },
        { testRunId: 'test-2', tags: ['smoke'] },
      ]);

      const results = await repository
        .createQueryBuilder('tr')
        .where(':tag = ANY(tr.tags)', { tag: 'nightly' })
        .getMany();

      expect(results).toHaveLength(1);
    });

    it('should load test run with all relations', async () => {
      const testRun = await repository.save({
        testRunId: 'test-full',
        configurations: [
          { key: 'threads', value: '100' }
        ]
      });

      const loaded = await repository.findOne({
        where: { testRunId: 'test-full' },
        relations: ['configurations']
      });

      expect(loaded.configurations).toBeDefined();
      expect(loaded.configurations).toHaveLength(1);
    });
  });

  describe('Transactions', () => {
    it('should rollback on error', async () => {
      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        await queryRunner.manager.save(TestRun, {
          testRunId: 'test-rollback'
        });

        // Simulate error
        throw new Error('Simulated error');

        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
      } finally {
        await queryRunner.release();
      }

      const result = await repository.findOne({
        where: { testRunId: 'test-rollback' }
      });

      expect(result).toBeNull();
    });
  });

  describe('Performance', () => {
    it('should efficiently query large datasets', async () => {
      // Insert 1000 test runs
      const testRuns = Array.from({ length: 1000 }, (_, i) => ({
        testRunId: `test-${i}`,
        status: i % 2 === 0 ? 'SUCCESS' : 'FAILURE'
      }));

      await repository.save(testRuns);

      const startTime = Date.now();
      const results = await repository
        .createQueryBuilder('tr')
        .where('tr.status = :status', { status: 'SUCCESS' })
        .limit(10)
        .getMany();
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(10);
      expect(duration).toBeLessThan(100); // Query should be fast
    });
  });
});
```

#### Entity Relations Testing (15-20 tests)

- One-to-many relations (test run → configurations)
- Many-to-many relations (benchmarks ↔ panels)
- Cascade deletes
- Orphan removal
- Eager vs lazy loading

#### Data Integrity Testing (15-25 tests)

- Unique constraints
- Foreign key constraints
- Check constraints
- Null handling
- JSON validation

---

### Layer 3: Worker Pipeline Integration Tests (40-60 tests)

**Location**: `/apps/worker/src/test/integration/`

**Focus**: End-to-end pipeline execution with real data

#### Pipeline Orchestration Integration (15-20 tests)

```typescript
describe('Pipeline Orchestration Integration', () => {
  let orchestrator: PipelineOrchestrator;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    orchestrator = new PipelineOrchestrator(dataSource);
  });

  it('should execute sequential pipeline successfully', async () => {
    // Setup test data
    const testRun = await createTestRun('test-123');
    await createPanels(testRun);

    // Execute full pipeline chain
    const result = await orchestrator.executeSequentialPipeline('test-123', {
      pipelines: [
        PipelineType.METRICS,
        PipelineType.STATISTICS,
        PipelineType.CHECKS
      ]
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results.every(r => r.success)).toBe(true);

    // Verify database state
    const metrics = await dataSource
      .getRepository(Metric)
      .count({ where: { testRunId: 'test-123' }});

    expect(metrics).toBeGreaterThan(0);
  });

  it('should handle pipeline failure gracefully', async () => {
    const testRun = await createTestRun('test-fail');
    // Don't create panels - metrics pipeline will fail

    const result = await orchestrator.executeSequentialPipeline('test-fail', {
      pipelines: [PipelineType.METRICS]
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should execute pipelines in parallel', async () => {
    const testRun = await createTestRun('test-parallel');
    await createPanels(testRun);

    const startTime = Date.now();
    const result = await orchestrator.executeParallelPipelines('test-parallel', {
      pipelines: [
        PipelineType.METRICS,
        PipelineType.DYNATRACE
      ]
    });
    const duration = Date.now() - startTime;

    expect(result.success).toBe(true);
    // Parallel should be faster than sequential
  });
});
```

#### Individual Pipeline Integration (25-40 tests)

- MetricsPipeline with real Grafana data
- StatisticsPipeline with aggregations
- ChecksPipeline with benchmark evaluation
- AdaptPipeline with regression detection
- DynatracePipeline with DQL queries
- PanelsPipeline with document creation

---

### Layer 4: Web Workflow Integration Tests (30-50 tests)

**Location**: `/apps/web/__tests__/integration/workflows/`

**Focus**: Complete user journeys across features

#### Test Run Lifecycle Workflow (10-15 tests)

```typescript
describe('Test Run Analysis Workflow', () => {
  const server = setupServer();

  beforeAll(() => server.listen());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('should complete full analysis workflow', async () => {
    // Setup MSW handlers
    server.use(
      rest.get('/api/test-runs/:id', (req, res, ctx) => {
        return res(ctx.json({
          testRunId: 'test-123',
          status: 'SUCCESS',
          systemUnderTest: 'ecommerce-api'
        }));
      }),
      rest.get('/api/anomalies', (req, res, ctx) => {
        return res(ctx.json([
          { id: '1', metric: 'response-time', conclusion: 'failure' },
          { id: '2', metric: 'error-rate', conclusion: 'failure' },
          { id: '3', metric: 'throughput', conclusion: 'success' }
        ]));
      }),
      rest.put('/api/anomalies/:id', (req, res, ctx) => {
        return res(ctx.json({ success: true }));
      })
    );

    const user = userEvent.setup();

    // Step 1: Navigate to test run detail page
    render(<TestRunDetailPage testRunId="test-123" />, {
      wrapper: AppProviders
    });

    await waitFor(() => {
      expect(screen.getByText('test-123')).toBeInTheDocument();
    });

    // Step 2: Expand anomaly detection section
    const anomalyHeader = screen.getByRole('button', {
      name: /anomaly detection/i
    });
    await user.click(anomalyHeader);

    await waitFor(() => {
      expect(screen.getByText(/3 anomalies detected/i)).toBeInTheDocument();
    });

    // Step 3: Filter by failure
    const failureFilter = screen.getByRole('button', {
      name: /failure/i
    });
    await user.click(failureFilter);

    await waitFor(() => {
      expect(screen.getByText(/2 anomalies/i)).toBeInTheDocument();
    });

    // Step 4: Open first anomaly detail
    const anomalyRow = screen.getByText(/response-time/i);
    await user.click(anomalyRow);

    await waitFor(() => {
      expect(screen.getByRole('complementary')).toBeInTheDocument();
    });

    // Step 5: Mark as accepted
    const acceptButton = screen.getByRole('button', {
      name: /accept/i
    });
    await user.click(acceptButton);

    // Verify API was called
    await waitFor(() => {
      const calls = server.listHandlers()
        .filter(h => h.info.method === 'PUT');
      expect(calls.length).toBeGreaterThan(0);
    });

    // Step 6: Navigate to trends
    const trendsTab = screen.getByRole('tab', { name: /trends/i });
    await user.click(trendsTab);

    await waitFor(() => {
      expect(screen.getByText(/trends analysis/i)).toBeInTheDocument();
    });
  });
});
```

#### Profile Management Workflow (8-12 tests)

- Create profile
- Add dashboard configurations
- Add benchmark configurations
- Apply to test run
- Verify auto-configuration

#### Multi-Feature Integration (12-23 tests)

- Test run → Anomaly → Configuration comparison
- Dashboard → Metrics → SLO evaluation
- Trends → Presets → Comparison
- Authentication throughout workflow

---

## Estimated Impact

### Test Distribution

| Layer | Test Files | Tests | Pass Rate | Lines of Code |
|-------|------------|-------|-----------|---------------|
| **API Integration** | 3-4 | 60-80 | 90-95% | ~1,800 |
| **Database Integration** | 3-4 | 50-70 | 95-98% | ~1,500 |
| **Worker Integration** | 3-4 | 40-60 | 85-90% | ~1,200 |
| **Workflow Integration** | 3-4 | 30-50 | 85-90% | ~1,000 |
| **TOTAL** | **12-16** | **180-260** | **89-93%** | **~5,500** |

### Coverage Projections

| Application | Current | With Integration Tests | Increase |
|-------------|---------|------------------------|----------|
| **API** | 52.27% | **60-65%** | +8-13% |
| **Web** | ~80-85% | **85-90%** | +5% |
| **Worker** | ~45-50% | **55-60%** | +10% |
| **Overall** | **~35-38%** | **~45-50%** | **+10-12%** |

---

## Implementation Roadmap

### Phase 15.1: API Integration (Week 1)

**Priority**: HIGH
**Effort**: 8-12 hours

1. Setup NestJS testing infrastructure
2. Implement test runs API integration tests
3. Implement API keys integration tests
4. Implement Grafana integration tests
5. Run and verify all tests pass

### Phase 15.2: Database Integration (Week 1-2)

**Priority**: HIGH
**Effort**: 6-10 hours

1. Setup test database connection
2. Implement repository integration tests
3. Test entity relations and cascades
4. Test data integrity constraints
5. Performance testing for queries

### Phase 15.3: Worker Integration (Week 2)

**Priority**: MEDIUM
**Effort**: 6-10 hours

1. Setup worker test infrastructure
2. Implement pipeline orchestration tests
3. Test individual pipelines end-to-end
4. Test job queue integration
5. Verify data transformations

### Phase 15.4: Workflow Integration (Week 2-3)

**Priority**: MEDIUM
**Effort**: 5-8 hours

1. Setup MSW for API mocking
2. Implement test run lifecycle tests
3. Implement profile management tests
4. Test cross-feature workflows
5. Verify accessibility throughout

---

## Benefits of Integration Testing

### 1. Confidence in Full Stack

- Validates complete request → database → response flow
- Tests real service interactions
- Catches integration bugs missed by unit tests

### 2. Refactoring Safety

- Ensures system works after architectural changes
- Validates API contracts
- Tests database migrations

### 3. Production Readiness

- Simulates real-world scenarios
- Tests error handling end-to-end
- Validates performance characteristics

### 4. Documentation

- Integration tests serve as living documentation
- Show how different parts work together
- Demonstrate expected workflows

---

## Technical Considerations

### Test Database Strategy

**Option 1: In-Memory Database**
- Pros: Fast, isolated, no cleanup needed
- Cons: Not exact PostgreSQL behavior
- Recommendation: Use for simple tests

**Option 2: Test Database Instance**
- Pros: Real PostgreSQL, exact behavior
- Cons: Slower, requires cleanup
- Recommendation: Use for complex query tests

**Option 3: Docker Container**
- Pros: Isolated, repeatable, real PostgreSQL
- Cons: Requires Docker, slower startup
- Recommendation: Use for CI/CD pipelines

### API Mocking Strategy

**MSW (Mock Service Worker)**
- Intercept HTTP requests at network level
- No code changes needed
- Works in both browser and Node
- Ideal for web workflow tests

**Supertest**
- Test Express/NestJS apps directly
- No HTTP overhead
- Ideal for API integration tests

### Performance Considerations

- Use database transactions with rollback
- Parallelize independent tests
- Use factories for test data creation
- Clean up data efficiently
- Monitor test execution time

---

## Next Steps

### Immediate Actions

1. **Set up test infrastructure**
   - Configure test database
   - Install testing dependencies
   - Create test utilities and factories

2. **Prioritize test implementation**
   - Start with API integration (highest ROI)
   - Then database integration
   - Then worker pipelines
   - Finally workflow tests

3. **Iterative approach**
   - Implement one test file at a time
   - Verify tests pass before moving on
   - Build on successful patterns

### Future Enhancements

1. **E2E Testing with Playwright**
   - Browser-based end-to-end tests
   - Real user interactions
   - Visual regression testing

2. **Performance Testing**
   - Load testing critical endpoints
   - Database query performance
   - Worker pipeline throughput

3. **Contract Testing**
   - API contract validation
   - Consumer-driven contracts
   - Schema validation

---

## Conclusion

While Phase 15 integration tests couldn't be automatically generated due to session limits, this strategic plan provides a **comprehensive roadmap** for implementing high-value integration tests.

### Summary

- **Target**: 180-260 integration tests
- **Coverage Increase**: +10-12% (35-38% → 45-50%)
- **Effort**: 25-40 hours total
- **Priority**: High for production readiness

### Recommendations

1. **Start with API integration tests** - Highest ROI, validates critical workflows
2. **Use real database for complex tests** - Ensures accurate behavior
3. **Implement incrementally** - One test file at a time
4. **Focus on critical paths** - Test run creation, anomaly detection, SLO evaluation

**With integration tests implemented, Perfana will have production-grade test coverage and confidence in the entire system!** 🚀

---

**Phase 15 Status**: ⚠️ **STRATEGIC PLAN** (Awaiting implementation)
**Current Coverage**: ~35-38%
**Target Coverage**: ~45-50% (with integration tests)
**Estimated Effort**: 25-40 hours
**ROI**: Very High - Production readiness validation

---

**Generated**: 2025-01-13
**Next Action**: Implement Phase 15.1 (API Integration Tests)
**Ultimate Goal**: 60% coverage with comprehensive integration testing
