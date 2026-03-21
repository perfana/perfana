# Perfana Next-Gen: Test Coverage Analysis & Implementation Plan

**Generated:** 2025-11-11
**Current Coverage:** 0.9% (Far below 60% minimum threshold)
**Target Coverage:** 80% (Per coding standards)
**Total LOC:** 81,795 lines

## Executive Summary

### Current State Assessment

**Critical Findings:**
- Test coverage is critically low at 0.9%, far below the 60% minimum threshold defined in coding standards
- Only 43 test files exist across 453 source files (9.5% file coverage)
- High-risk, business-critical modules have ZERO test coverage
- Authentication and authorization logic is minimally tested
- Frontend has essentially no tests (0.8% coverage)
- Worker service has moderate coverage but lacks comprehensive integration tests

**Quality Metrics (SonarQube):**
- 28 bugs identified
- 2,047 code smells
- 81,795 lines of code
- Technical debt ratio needs improvement

### Coverage Breakdown by Application

| Application | Test Files | Source Files | Coverage Estimate |
|------------|-----------|--------------|-------------------|
| **API** | 21 | 131 | 16.0% |
| **Web** | 1 | 127 | 0.8% |
| **Worker** | 10 | 67 | 14.9% |
| **Grafana Sync** | 9 | 8 | 112.5%* |

*Grafana Sync has good test coverage

## Detailed Module Analysis

### API Service (apps/api)

#### Modules with ZERO Test Coverage (HIGH RISK)

| Module | Source Files | Complexity | Business Impact | Priority |
|--------|-------------|------------|-----------------|----------|
| **dynatrace** | 11 | High | Critical | P0 |
| **data-science** | 7 | Very High | Critical | P0 |
| **grafana** | 10 | High | High | P0 |
| **deep-links** | 8 | Medium | Medium | P1 |
| **benchmarks** | 3 | Medium | High | P1 |
| **profiles** | 4 | Medium | High | P1 |
| **organizations** | 2 | Low | Medium | P2 |
| **teams** | 2 | Low | Medium | P2 |
| **systems-under-test** | 2 | Low | Medium | P2 |
| **compare-presets** | 5 | Medium | Low | P2 |
| **trends-presets** | 4 | Medium | Low | P2 |
| **benchmark-results** | 1 | Low | Medium | P2 |
| **reports** | 2 | Medium | Medium | P2 |
| **realtime** | 2 | Medium | Low | P3 |
| **queue** | 1 | Low | Low | P3 |
| **health** | 1 | Low | Low | P3 |
| **adapt** | 4 | High | Medium | P1 |

#### Modules with Minimal Coverage (Needs Improvement)

| Module | Specs | Source Files | Coverage Gap | Priority |
|--------|-------|--------------|--------------|----------|
| **test-runs** | 5 | 23 | High - Only 22% covered | P0 |
| **auth** | 1 | 1 | Critical - Incomplete auth tests | P0 |
| **api-keys** | 3 | 1 | Good coverage | P2 |
| **metrics** | 2 | 0 | Good coverage | P2 |

#### Critical Infrastructure (Partially Tested)

| Component | Current Status | Missing Coverage |
|-----------|---------------|------------------|
| **KeycloakEnhancedAuthGuard** | No tests | Authentication flow, role checks, token validation |
| **API Key Guard** | No tests | API key validation, TTL checks |
| **Enhanced Throttler** | Tested | Good coverage |
| **Global Exception Filter** | Tested | Good coverage |
| **Validators** | Tested | Good coverage (5/6 files) |
| **Database Service** | No tests | Query execution, transaction handling |

### Web Application (apps/web)

#### Critical Untested Files

| File | LOC | Complexity | Priority |
|------|-----|------------|----------|
| **lib/socket.ts** | 461 | Very High | P0 |
| **lib/dynatrace.ts** | 356 | High | P0 |
| **lib/api.ts** | 193 | High | P0 |
| **lib/keycloak-auth.ts** | 184 | High | P0 |
| **lib/profiles.ts** | 206 | Medium | P1 |
| **lib/compare-presets.ts** | 193 | Medium | P1 |
| **lib/profile-benchmarks.ts** | 161 | Medium | P1 |
| **lib/grafana-instances.ts** | 136 | Medium | P1 |
| **lib/units.ts** | 132 | Low | P2 |
| **lib/errors.ts** | 99 | Medium | P1 |

#### Component Testing Gaps

**Zero React component tests exist:**
- 0 component unit tests
- 0 integration tests
- 0 accessibility tests
- 0 user interaction tests

**High-priority components needing tests:**
- Anomaly detection components (15+ components)
- Profile management UI
- Test run detail cards
- Grafana dashboard integrations
- Real-time monitoring components

### Worker Service (apps/worker)

**Current State:** 14.9% coverage (10 tests, 67 source files)

#### Tested Components
- Grafana client (basic tests)
- Metrics pipeline (unit tests with mocks)
- Pipeline adapters (partial coverage)
- Queue orchestrator (basic tests)

#### Missing Coverage
- Pipeline error handling
- Queue failure recovery
- Job retry logic
- Real-world integration scenarios
- Configuration validation
- Resource management

### Grafana Sync Service (apps/grafana-sync)

**Current State:** Excellent coverage (9 tests, 8 source files)

#### Well-Tested
- Auto-configuration service
- Dashboard sync service
- Grafana API client
- Variable discovery
- Sanity checker

**Recommendation:** Maintain current coverage and add integration tests

## Risk Assessment

### Severity Levels

**CRITICAL (P0) - Immediate Action Required:**
1. **Authentication & Authorization** - Guards and services have minimal/no tests
2. **Data Science Module** - Complex anomaly detection logic untested
3. **Dynatrace Integration** - External API calls, error handling untested
4. **Grafana Integration** - Dashboard management, API communication untested
5. **Frontend API Client** - Authentication, error handling, token refresh untested
6. **Real-time Socket Communication** - 461 LOC, complex state management, zero tests

**HIGH (P1) - Plan Within Sprint:**
1. Test Runs Service - Core business logic, only 22% covered
2. Deep Links Module - URL generation and validation
3. Benchmarks & Profiles - Performance baseline management
4. Frontend utility libraries - Units, errors, configuration
5. Worker pipeline error handling

**MEDIUM (P2) - Plan Within Quarter:**
1. Organizations & Teams management
2. Compare presets and trends
3. Systems under test
4. React component library

**LOW (P3) - Ongoing Improvement:**
1. Health checks
2. Queue infrastructure (if well-abstracted)
3. Static utilities

## Phased Implementation Plan

### Phase 1: Critical Security & Core Business Logic (Target: 30% Coverage)

**Duration:** 2-3 weeks
**Effort:** 80-120 hours

#### Week 1: Authentication & Authorization (P0)

**Files to Test:**
```
apps/api/src/guards/
├── keycloak-enhanced-auth.guard.ts (CRITICAL)
├── api-key.guard.ts (CRITICAL)
└── Tests needed: ~200 lines of test code
```

**Test Scenarios:**
- Valid Keycloak JWT authentication
- Valid API key authentication
- Fallback behavior between auth methods
- Token expiration handling
- Role-based access control
- Public route handling
- Malformed token handling
- Missing authorization header
- Admin role validation

**Files to Test:**
```
apps/api/src/modules/auth/
├── keycloak-jwt.service.ts
└── auth.controller.ts (enhance existing)
```

**Test Scenarios:**
- Token validation with Keycloak
- Token refresh logic
- User info retrieval
- Logout functionality
- Error scenarios

**Frontend Authentication:**
```
apps/web/lib/
├── keycloak-auth.ts (184 LOC - CRITICAL)
├── api.ts (193 LOC - CRITICAL)
└── Tests needed: ~300 lines
```

**Test Scenarios:**
- Token storage and retrieval
- Auto token refresh
- Login/logout flows
- Authenticated fetch with retry
- Error handling for 401s
- Keycloak initialization

**Estimated Effort:** 40 hours

#### Week 2: Core Business Logic - Test Runs (P0)

**Files to Test:**
```
apps/api/src/modules/test-runs/
├── test-runs.controller.ts (NO TESTS)
├── test-runs-config.controller.ts (NO TESTS)
├── Enhance: test-runs.service.ts (existing tests)
└── Tests needed: ~400 lines
```

**Test Scenarios:**
- CRUD operations for test runs
- Configuration management
- Expected config changes
- JSON import/export with patterns
- Test run filtering and pagination
- Duplicate detection
- Validation edge cases

**Estimated Effort:** 30 hours

#### Week 3: Critical Integrations (P0)

**Dynatrace Module:**
```
apps/api/src/modules/dynatrace/
├── dynatrace.service.ts (11 files total)
├── dynatrace.controller.ts
├── dynatrace.repository.ts
└── Tests needed: ~500 lines
```

**Test Scenarios:**
- Configuration CRUD
- Connection testing
- Query execution (mocked)
- Entity mapping
- URL normalization
- API error handling
- Timeout handling

**Grafana Module:**
```
apps/api/src/modules/grafana/
├── grafana-client.service.ts
├── grafana-dashboards.service.ts
├── grafana-instances.service.ts
└── Tests needed: ~400 lines
```

**Test Scenarios:**
- Dashboard sync
- Instance management
- Application dashboard configuration
- Snapshot generation
- Dashboard filtering
- API communication (mocked)

**Estimated Effort:** 40 hours

**Phase 1 Deliverables:**
- 1,500+ lines of test code
- 30% overall coverage achieved
- All P0 security and core business logic tested
- CI/CD pipeline enforcing minimum coverage

---

### Phase 2: Data Science & Complex Features (Target: 60% Coverage)

**Duration:** 3-4 weeks
**Effort:** 120-160 hours

#### Week 4-5: Data Science Module (P0)

**Files to Test:**
```
apps/api/src/modules/data-science/
├── services/bullmq-client.service.ts
├── controllers/data-science.controller.ts
├── All DTOs and validation
└── Tests needed: ~400 lines
```

**Test Scenarios:**
- Job queue integration
- Batch processing
- Test analysis workflows
- Re-evaluation logic
- Job status tracking
- Error handling
- Queue failure scenarios

**Worker Service Integration:**
```
apps/worker/src/
├── pipelines/*.ts (multiple files)
├── workflows/*.ts
└── Tests needed: ~600 lines
```

**Test Scenarios:**
- Metrics pipeline processing
- Grafana data fetching
- Statistical analysis
- Control group comparison
- Pipeline error recovery
- Real-world integration scenarios

**Estimated Effort:** 60 hours

#### Week 6: Remaining API Modules (P1)

**Deep Links, Benchmarks, Profiles:**
```
apps/api/src/modules/
├── deep-links/ (8 files)
├── benchmarks/ (3 files)
├── profiles/ (4 files)
├── adapt/ (4 files)
└── Tests needed: ~600 lines
```

**Test Scenarios:**
- Deep link generation and validation
- Benchmark CRUD operations
- Profile management
- Auto-configuration matching
- Workload associations

**Estimated Effort:** 40 hours

#### Week 7: Frontend Core Utilities (P0-P1)

**Critical Libraries:**
```
apps/web/lib/
├── socket.ts (461 LOC - real-time updates)
├── dynatrace.ts (356 LOC)
├── profiles.ts (206 LOC)
├── errors.ts (99 LOC)
└── Tests needed: ~800 lines
```

**Test Scenarios:**
- Socket connection lifecycle
- Real-time event handling
- Reconnection logic
- Dynatrace query building
- Profile API calls
- Error handling and formatting

**Estimated Effort:** 50 hours

**Phase 2 Deliverables:**
- 2,400+ lines of test code
- 60% overall coverage achieved
- All P0 and most P1 items tested
- Integration tests for critical workflows

---

### Phase 3: Comprehensive Coverage (Target: 80% Coverage)

**Duration:** 4-5 weeks
**Effort:** 160-200 hours

#### Week 8-9: React Component Testing (P1-P2)

**Component Test Infrastructure:**
- Set up React Testing Library
- Configure testing-library/jest-dom
- Create component test utilities
- Mock API client patterns

**Priority Components:**
```
apps/web/app/test-runs/[id]/components/
├── anomaly-detection/ (15+ components)
├── dynatrace/
├── deep-links/
└── Tests needed: ~1,000 lines
```

**Test Scenarios:**
- Component rendering
- User interactions
- API integration
- Loading states
- Error states
- Accessibility (a11y)

**Profile Management:**
```
apps/web/app/settings/profiles/
├── ProfileDashboardsTable.tsx
├── ProfileBenchmarksTable.tsx
├── Form dialogs
└── Tests needed: ~400 lines
```

**Estimated Effort:** 70 hours

#### Week 10: API Supporting Modules (P2)

**Remaining Modules:**
```
apps/api/src/modules/
├── organizations/
├── teams/
├── systems-under-test/
├── compare-presets/
├── trends-presets/
├── benchmark-results/
├── reports/
└── Tests needed: ~600 lines
```

**Test Scenarios:**
- CRUD operations
- Relationships between entities
- Validation rules
- Query filtering
- Business logic

**Estimated Effort:** 40 hours

#### Week 11-12: Frontend Supporting Libraries & Components (P2)

**Remaining Libraries:**
```
apps/web/lib/
├── compare-presets.ts
├── profile-benchmarks.ts
├── grafana-instances.ts
├── units.ts
├── api-keys.ts
└── Tests needed: ~600 lines
```

**Additional Components:**
- Layout components
- UI components
- Reusable elements
- Hooks testing

**Estimated Effort:** 50 hours

**Phase 3 Deliverables:**
- 2,600+ lines of test code
- 80%+ overall coverage achieved
- Comprehensive component coverage
- Full integration test suite

---

## Testing Strategy & Best Practices

### Unit Testing Patterns

#### NestJS Services

```typescript
describe('UserService', () => {
  let service: UserService;
  let repository: MockType<Repository<User>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useFactory: repositoryMockFactory,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    repository = module.get(getRepositoryToken(User));
  });

  it('should find a user by id', async () => {
    const user = { id: '1', email: 'test@example.com' };
    repository.findOne.mockResolvedValue(user);

    expect(await service.findOne('1')).toEqual(user);
    expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
  });

  it('should handle not found', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
  });
});
```

#### NestJS Controllers

```typescript
describe('UserController', () => {
  let controller: UserController;
  let service: MockType<UserService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useFactory: serviceMockFactory,
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    service = module.get(UserService);
  });

  it('should return all users', async () => {
    const users = [{ id: '1', email: 'test@example.com' }];
    service.findAll.mockResolvedValue(users);

    expect(await controller.findAll()).toEqual(users);
  });
});
```

#### Guards Testing

```typescript
describe('KeycloakEnhancedAuthGuard', () => {
  let guard: KeycloakEnhancedAuthGuard;
  let reflector: Reflector;
  let apiKeysService: MockType<ApiKeysService>;
  let context: ExecutionContext;

  beforeEach(() => {
    reflector = new Reflector();
    apiKeysService = { validateApiKey: jest.fn() };
    guard = new KeycloakEnhancedAuthGuard(reflector, configService, apiKeysService);

    context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          headers: { authorization: 'Bearer valid-token' },
        }),
      }),
    } as any;
  });

  it('should allow public routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    expect(await guard.canActivate(context)).toBe(true);
  });

  it('should validate API key', async () => {
    apiKeysService.validateApiKey.mockResolvedValue({
      id: '1',
      description: 'Test Key',
      roles: ['user'],
    });

    expect(await guard.canActivate(context)).toBe(true);
  });

  it('should reject invalid token', async () => {
    apiKeysService.validateApiKey.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
```

### React Component Testing

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('TestRunCard', () => {
  const mockTestRun = {
    id: '1',
    test_run_id: 'load-test-001',
    system_under_test: 'api',
    completed: false,
  };

  it('should render test run information', () => {
    render(<TestRunCard testRun={mockTestRun} />);

    expect(screen.getByText('load-test-001')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
  });

  it('should handle expand/collapse', async () => {
    const user = userEvent.setup();
    render(<TestRunCard testRun={mockTestRun} />);

    const expandButton = screen.getByRole('button', { name: /expand/i });
    await user.click(expandButton);

    expect(screen.getByTestId('expanded-content')).toBeVisible();
  });

  it('should be accessible', () => {
    const { container } = render(<TestRunCard testRun={mockTestRun} />);

    expect(container.querySelector('button')).toHaveAttribute('aria-label');
    expect(container.querySelector('[role="region"]')).toBeInTheDocument();
  });
});
```

### Frontend Utility Testing

```typescript
describe('authenticatedFetch', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    localStorage.clear();
  });

  it('should include auth headers', async () => {
    localStorage.setItem('perfana_access_token', 'test-token');
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    await authenticatedFetch('/test-runs');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-token',
        }),
      }),
    );
  });

  it('should retry on 401 after token refresh', async () => {
    localStorage.setItem('perfana_access_token', 'old-token');
    localStorage.setItem('perfana_refresh_token', 'refresh-token');

    // First call fails with 401
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ status: 401 })
      // Refresh succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          session: {
            access_token: 'new-token',
            refresh_token: 'new-refresh-token',
          },
        }),
      })
      // Retry succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

    await authenticatedFetch('/test-runs');

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem('perfana_access_token')).toBe('new-token');
  });
});
```

### Integration Testing

```typescript
describe('Test Run Creation Flow (Integration)', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(mockDatabase)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Get auth token
    authToken = await getTestAuthToken();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create and retrieve a test run', async () => {
    // Create test run
    const createResponse = await request(app.getHttpServer())
      .post('/test')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        systemUnderTest: 'test-api',
        workload: 'load-test',
        testEnvironment: 'staging',
        testRunId: 'integration-test-001',
      })
      .expect(201);

    const testRunId = createResponse.body.id;

    // Retrieve test run
    const getResponse = await request(app.getHttpServer())
      .get(`/test-runs/${testRunId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(getResponse.body).toMatchObject({
      test_run_id: 'integration-test-001',
      system_under_test_id: expect.any(String),
      workload: 'load-test',
    });
  });
});
```

## Mock Strategy for External Dependencies

### Grafana API Mocking

```typescript
const mockGrafanaClient = {
  getDashboards: jest.fn(),
  createDashboard: jest.fn(),
  updateDashboard: jest.fn(),
  testConnection: jest.fn(),
};

// Use nock for HTTP mocking
nock('https://grafana.example.com')
  .get('/api/dashboards')
  .reply(200, { dashboards: [] });
```

### Dynatrace API Mocking

```typescript
const mockDynatraceClient = {
  executeQuery: jest.fn(),
  getEntities: jest.fn(),
  testConnection: jest.fn(),
};

nock('https://dynatrace.example.com')
  .post('/api/v2/metrics/query')
  .reply(200, { result: [] });
```

### Database Mocking

```typescript
// Use repository mock factory
export const repositoryMockFactory: () => MockType<Repository<any>> = jest.fn(() => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
    getOne: jest.fn(),
  })),
}));
```

## Test Infrastructure Improvements

### Required Setup

1. **Testing Libraries Installation**
```bash
# API Testing
npm install --save-dev @nestjs/testing supertest

# Web Testing
npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event

# HTTP Mocking
npm install --save-dev nock msw

# Coverage Tools
npm install --save-dev @jest/coverage-provider-v8
```

2. **Jest Configuration Updates**

**apps/api/jest.config.js:**
```javascript
module.exports = {
  // ... existing config
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
    '!src/**/dto/*.ts', // Consider if DTOs should be excluded
    '!src/**/interfaces/*.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
  testTimeout: 10000,
};
```

**apps/web/jest.config.js:**
```javascript
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'lib/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'hooks/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
```

3. **Test Utilities**

**apps/api/src/test/test-helpers.ts:**
```typescript
export function createMockExecutionContext(request: Partial<AuthenticatedRequest> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {},
        user: null,
        ...request,
      }),
    }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as any;
}

export async function getTestAuthToken(): Promise<string> {
  // Generate test JWT or API key
  return 'test-auth-token';
}

export const repositoryMockFactory = () => ({
  // ... as shown above
});
```

**apps/web/test/test-utils.tsx:**
```typescript
import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';

// Custom render with providers
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <ThemeProvider>
        {children}
      </ThemeProvider>
    ),
    ...options,
  });
}

// Mock fetch
export function mockFetch(response: any, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    json: async () => response,
  });
}
```

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: Test Coverage

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Run tests with coverage
        run: npm run test -- --coverage

      - name: Check coverage thresholds
        run: |
          # Fail if coverage below threshold
          npm run test -- --coverage --coverageThreshold='{"global":{"branches":60,"functions":60,"lines":60,"statements":60}}'

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

      - name: SonarQube Scan
        uses: sonarsource/sonarqube-scan-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}
```

### Pre-commit Hooks

**.husky/pre-commit:**
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run tests for changed files
npm run test -- --bail --findRelatedTests $(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' | tr '\n' ' ')

# Fail commit if tests fail
if [ $? -ne 0 ]; then
  echo "Tests failed. Commit aborted."
  exit 1
fi
```

## Success Metrics & Milestones

### Phase 1 Success Criteria (Week 3)
- [ ] 30% overall code coverage achieved
- [ ] All authentication flows tested
- [ ] Test runs CRUD fully covered
- [ ] Dynatrace and Grafana integration tested
- [ ] Zero critical security gaps in test coverage
- [ ] CI/CD enforcing minimum coverage

### Phase 2 Success Criteria (Week 7)
- [ ] 60% overall code coverage achieved
- [ ] Data science module fully tested
- [ ] Worker service integration tests complete
- [ ] All P0 and P1 modules tested
- [ ] Frontend core utilities tested
- [ ] Coverage reports integrated with SonarQube

### Phase 3 Success Criteria (Week 12)
- [ ] 80% overall code coverage achieved
- [ ] React component library tested
- [ ] All API modules tested
- [ ] Accessibility tests passing
- [ ] Integration test suite complete
- [ ] Documentation updated

### Ongoing Metrics to Track

**Weekly:**
- Coverage percentage trend
- Number of tests added
- Test execution time
- Flaky test count

**Monthly:**
- Coverage by module
- Bug escape rate (bugs found in production that should have been caught by tests)
- Test maintenance effort
- Code smell reduction

**Quarterly:**
- Overall quality gate status
- Technical debt reduction
- Test pyramid balance (unit vs integration vs e2e)

## Prioritized Action Items

### Immediate Actions (This Week)

1. **Set up test infrastructure** (4 hours)
   - Install testing libraries
   - Configure Jest for coverage thresholds
   - Create test utility files
   - Set up CI/CD coverage checks

2. **Create test templates** (4 hours)
   - NestJS service test template
   - NestJS controller test template
   - Guard test template
   - React component test template
   - Integration test template

3. **Start P0 authentication tests** (16 hours)
   - KeycloakEnhancedAuthGuard
   - API Key Guard
   - Auth service
   - Frontend keycloak-auth.ts

### Short-term (Weeks 1-3) - Phase 1

1. Complete all authentication and authorization tests
2. Enhance test-runs module coverage to 80%+
3. Test Dynatrace integration
4. Test Grafana integration
5. Achieve 30% overall coverage
6. Configure coverage gates in CI/CD

### Medium-term (Weeks 4-7) - Phase 2

1. Complete data science module testing
2. Add worker service integration tests
3. Test remaining P1 API modules
4. Test frontend core utilities (socket, api, errors)
5. Achieve 60% overall coverage

### Long-term (Weeks 8-12) - Phase 3

1. Implement React component tests
2. Test all remaining API modules
3. Add accessibility tests
4. Complete integration test suite
5. Achieve 80% overall coverage
6. Document testing best practices

## Recommendations for Code Refactoring

### Testability Improvements

1. **Extract complex business logic from controllers to services**
   - Controllers should be thin, delegating to services
   - Easier to test services in isolation

2. **Use dependency injection consistently**
   - Avoid hardcoded dependencies
   - Makes mocking easier in tests

3. **Separate concerns in large functions**
   - Break down 100+ line functions
   - Each function should have single responsibility
   - Easier to test individual pieces

4. **Add interfaces for external dependencies**
   - Create interfaces for Grafana client, Dynatrace client
   - Enables easy mocking without implementation details

5. **Move business logic out of React components**
   - Extract to custom hooks or utility functions
   - Easier to test pure functions

6. **Improve error handling consistency**
   - Use custom exception classes
   - Standardize error responses
   - Makes error scenario testing clearer

### Example Refactoring

**Before:**
```typescript
// Hard to test - multiple responsibilities, no DI
async createDashboard(dto: CreateDashboardDto) {
  const url = `${process.env.GRAFANA_URL}/api/dashboards`;
  const response = await axios.post(url, dto, {
    headers: { 'Authorization': `Bearer ${process.env.GRAFANA_TOKEN}` }
  });

  if (response.status !== 200) {
    throw new Error('Failed to create dashboard');
  }

  // Save to database
  await this.db.query('INSERT INTO dashboards ...');

  return response.data;
}
```

**After:**
```typescript
// Easy to test - injected dependencies, single responsibility
constructor(
  private readonly grafanaClient: GrafanaClientService,
  private readonly dashboardRepository: DashboardRepository,
) {}

async createDashboard(dto: CreateDashboardDto): Promise<Dashboard> {
  // Delegate to client service
  const grafanaDashboard = await this.grafanaClient.createDashboard(dto);

  // Save to database through repository
  const dashboard = await this.dashboardRepository.save({
    uid: grafanaDashboard.uid,
    title: dto.title,
    // ...
  });

  return dashboard;
}

// Now you can easily mock grafanaClient and dashboardRepository in tests
```

## Estimated Resource Requirements

### Team Composition

**Ideal Team:**
- 1-2 Senior Engineers (lead test implementation)
- 1-2 Mid-level Engineers (write tests)
- 1 QA Engineer (test strategy, review)

**Minimum Team:**
- 1 Senior Engineer + 1 Mid-level Engineer

### Time Investment

| Phase | Duration | Effort (Hours) | Team Size | Calendar Time |
|-------|----------|---------------|-----------|---------------|
| Phase 1 | 3 weeks | 110 hours | 2 engineers | 3 weeks |
| Phase 2 | 4 weeks | 150 hours | 2 engineers | 4 weeks |
| Phase 3 | 5 weeks | 200 hours | 2 engineers | 5 weeks |
| **Total** | **12 weeks** | **460 hours** | **2 engineers** | **12 weeks** |

### Budget Estimate

Assuming average engineering cost of $100/hour:
- Phase 1: $11,000
- Phase 2: $15,000
- Phase 3: $20,000
- **Total: $46,000**

### Ongoing Maintenance

- **Weekly:** 4-8 hours maintaining/updating tests
- **Per new feature:** 30-50% additional dev time for tests
- **Quarterly:** 8-16 hours reviewing and refactoring tests

## Conclusion

The current 0.9% test coverage represents a significant quality and risk management gap for the Perfana platform. This comprehensive plan provides a structured, phased approach to achieving 80% test coverage over 12 weeks.

**Key Success Factors:**
1. **Prioritization** - Focus on high-risk, high-value code first
2. **Standards** - Establish and enforce testing patterns
3. **Automation** - Integrate coverage checks into CI/CD
4. **Team Buy-in** - Make testing part of the development culture
5. **Continuous Improvement** - Regular review and refinement of tests

**Immediate Next Steps:**
1. Review and approve this plan with stakeholders
2. Allocate engineering resources
3. Set up test infrastructure (Week 1, Day 1)
4. Begin Phase 1 authentication tests (Week 1, Day 2)
5. Establish weekly progress reviews

By following this plan, Perfana will achieve:
- Production-ready code quality
- Reduced bug escape rate
- Faster, safer deployments
- Improved developer confidence
- Better code maintainability
- Compliance with industry best practices

---

**Document Version:** 1.0
**Last Updated:** 2025-11-11
**Owner:** Engineering Team
**Reviewers:** Tech Lead, QA Lead, Product Manager
