# Test Coverage Quick Start Guide

**Jump Start:** Get from 0.9% to 30% coverage in 3 weeks

## Current Situation

```
Current Coverage: 0.9%
Target: 80%
First Milestone: 30% (3 weeks)
```

## Week 1: Authentication & Security (CRITICAL)

### Day 1-2: Setup & Infrastructure

```bash
# Install testing dependencies
cd apps/api
npm install --save-dev @nestjs/testing supertest nock

cd ../web
npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Create test utilities
mkdir -p apps/api/src/test/helpers
mkdir -p apps/web/test/utils
```

**Create Test Helper Files:**
- `apps/api/src/test/helpers/test-helpers.ts`
- `apps/web/test/utils/test-utils.tsx`

### Day 3-5: Authentication Guards (P0 - CRITICAL)

**Priority 1: KeycloakEnhancedAuthGuard**
```typescript
// apps/api/src/guards/keycloak-enhanced-auth.guard.spec.ts

describe('KeycloakEnhancedAuthGuard', () => {
  // Test scenarios:
  // ✅ Valid Keycloak JWT authentication
  // ✅ Valid API key authentication
  // ✅ Public route bypass
  // ✅ Missing auth header
  // ✅ Invalid token format
  // ✅ Expired token
  // ✅ Role validation
  // ✅ Admin role check
});
```

**Priority 2: Frontend Auth**
```typescript
// apps/web/lib/__tests__/keycloak-auth.test.ts
// apps/web/lib/__tests__/api.test.ts

describe('Keycloak Authentication', () => {
  // Test scenarios:
  // ✅ Token storage/retrieval
  // ✅ Auto token refresh
  // ✅ Login/logout flows
  // ✅ 401 retry logic
});
```

**Files to Create:**
1. `apps/api/src/guards/keycloak-enhanced-auth.guard.spec.ts` (200 lines)
2. `apps/api/src/guards/api-key.guard.spec.ts` (150 lines)
3. `apps/web/lib/__tests__/keycloak-auth.test.ts` (200 lines)
4. `apps/web/lib/__tests__/api.test.ts` (150 lines)

**Expected Output:** All authentication flows tested, 0 security gaps

---

## Week 2: Core Business Logic

### Day 1-3: Test Runs Module

**Priority Files:**
```
apps/api/src/modules/test-runs/
├── test-runs.controller.spec.ts (NEW - 200 lines)
├── test-runs-config.controller.spec.ts (NEW - 150 lines)
└── test-runs.service.spec.ts (ENHANCE existing)
```

**Test Scenarios:**
- CRUD operations for test runs
- Configuration management (add/update/delete)
- Expected config changes tracking
- JSON import/export with patterns
- Filtering and pagination
- Validation edge cases

### Day 4-5: Core API Controllers

**Files to Create:**
```
apps/api/src/modules/test-runs/test-runs.controller.spec.ts
apps/api/src/modules/test-runs/test-runs-config.controller.spec.ts
```

---

## Week 3: Critical Integrations

### Day 1-2: Dynatrace Module

**Files to Create:**
```
apps/api/src/modules/dynatrace/
├── dynatrace.service.spec.ts (300 lines)
├── dynatrace.controller.spec.ts (200 lines)
└── dynatrace.repository.spec.ts (150 lines)
```

**Mock Strategy:**
```typescript
// Use nock for HTTP mocking
nock('https://dynatrace.example.com')
  .post('/api/v2/metrics/query')
  .reply(200, { result: [] });
```

### Day 3-5: Grafana Module

**Files to Create:**
```
apps/api/src/modules/grafana/
├── grafana-client.service.spec.ts (200 lines)
├── grafana-dashboards.service.spec.ts (250 lines)
├── grafana-instances.service.spec.ts (150 lines)
└── application-dashboards.service.spec.ts (200 lines)
```

**Expected Output:** 30% coverage achieved, P0 items tested

---

## Testing Templates

### NestJS Service Template

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { YourService } from './your.service';
import { YourRepository } from './your.repository';

describe('YourService', () => {
  let service: YourService;
  let repository: jest.Mocked<YourRepository>;

  const mockRepository = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YourService,
        {
          provide: YourRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<YourService>(YourService);
    repository = module.get(YourRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all items', async () => {
      const mockItems = [{ id: '1', name: 'Test' }];
      repository.findAll.mockResolvedValue(mockItems);

      const result = await service.findAll();

      expect(result).toEqual(mockItems);
      expect(repository.findAll).toHaveBeenCalledTimes(1);
    });

    it('should handle errors', async () => {
      const error = new Error('Database error');
      repository.findAll.mockRejectedValue(error);

      await expect(service.findAll()).rejects.toThrow('Database error');
    });
  });
});
```

### NestJS Controller Template

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { YourController } from './your.controller';
import { YourService } from './your.service';

describe('YourController', () => {
  let controller: YourController;
  let service: jest.Mocked<YourService>;

  const mockService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [YourController],
      providers: [
        {
          provide: YourService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<YourController>(YourController);
    service = module.get(YourService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all items', async () => {
      const mockItems = [{ id: '1', name: 'Test' }];
      service.findAll.mockResolvedValue(mockItems);

      const result = await controller.findAll();

      expect(result).toEqual(mockItems);
      expect(service.findAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('create', () => {
    it('should create an item', async () => {
      const createDto = { name: 'Test' };
      const createdItem = { id: '1', ...createDto };
      service.create.mockResolvedValue(createdItem);

      const result = await controller.create(createDto);

      expect(result).toEqual(createdItem);
      expect(service.create).toHaveBeenCalledWith(createDto);
    });

    it('should handle validation errors', async () => {
      const createDto = { name: '' }; // Invalid
      service.create.mockRejectedValue(new Error('Validation failed'));

      await expect(controller.create(createDto)).rejects.toThrow('Validation failed');
    });
  });
});
```

### Guard Test Template

```typescript
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { YourGuard } from './your.guard';

describe('YourGuard', () => {
  let guard: YourGuard;
  let reflector: Reflector;
  let context: ExecutionContext;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new YourGuard(reflector);

    context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          headers: {},
        }),
      }),
    } as any;
  });

  it('should allow public routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    expect(await guard.canActivate(context)).toBe(true);
  });

  it('should reject missing authorization', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should validate valid token', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    context.switchToHttp().getRequest = jest.fn().mockReturnValue({
      headers: { authorization: 'Bearer valid-token' },
    });

    // Mock validation logic
    expect(await guard.canActivate(context)).toBe(true);
  });
});
```

### React Component Test Template

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YourComponent } from './YourComponent';

describe('YourComponent', () => {
  const defaultProps = {
    title: 'Test Title',
    onAction: jest.fn(),
  };

  it('should render correctly', () => {
    render(<YourComponent {...defaultProps} />);

    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('should handle user interactions', async () => {
    const user = userEvent.setup();
    const onAction = jest.fn();

    render(<YourComponent {...defaultProps} onAction={onAction} />);

    const button = screen.getByRole('button', { name: /action/i });
    await user.click(button);

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('should display loading state', () => {
    render(<YourComponent {...defaultProps} loading={true} />);

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('should display error state', () => {
    const error = 'Something went wrong';
    render(<YourComponent {...defaultProps} error={error} />);

    expect(screen.getByText(error)).toBeInTheDocument();
  });

  it('should be accessible', () => {
    const { container } = render(<YourComponent {...defaultProps} />);

    const button = container.querySelector('button');
    expect(button).toHaveAttribute('aria-label');
  });
});
```

### Frontend Utility Test Template

```typescript
import { yourUtilityFunction } from './your-utility';

describe('yourUtilityFunction', () => {
  it('should handle normal input', () => {
    const input = { value: 'test' };
    const result = yourUtilityFunction(input);

    expect(result).toEqual(expectedOutput);
  });

  it('should handle edge cases', () => {
    expect(yourUtilityFunction(null)).toBeNull();
    expect(yourUtilityFunction(undefined)).toBeUndefined();
    expect(yourUtilityFunction('')).toBe('');
  });

  it('should throw on invalid input', () => {
    expect(() => yourUtilityFunction('invalid')).toThrow('Invalid input');
  });
});
```

---

## Running Tests

### API Tests
```bash
cd apps/api

# Run all tests
npm run test

# Run with coverage
npm run test -- --coverage

# Run specific file
npm run test -- auth.guard.spec.ts

# Watch mode
npm run test -- --watch
```

### Web Tests
```bash
cd apps/web

# Run all tests
npm run test

# Run with coverage
npm run test -- --coverage

# Run specific file
npm run test -- api.test.ts

# Watch mode
npm run test -- --watch
```

### All Tests (Monorepo)
```bash
# From root directory
npm run test
```

---

## Coverage Checks

### View Coverage Report
```bash
# After running tests with --coverage
cd apps/api
open coverage/lcov-report/index.html

cd ../web
open coverage/lcov-report/index.html
```

### Enforce Coverage Thresholds
```bash
# This will fail if coverage is below threshold
npm run test -- --coverage --coverageThreshold='{"global":{"branches":60,"functions":60,"lines":60,"statements":60}}'
```

---

## Quick Wins (High Impact, Low Effort)

### Week 1 Quick Wins
1. **Validators** (5 already done, excellent!)
   - ✅ config-key.validator.spec.ts
   - ✅ iso-date.validator.spec.ts
   - ✅ json-depth.validator.spec.ts
   - ✅ safe-regex.validator.spec.ts
   - ✅ test-run-id.validator.spec.ts

2. **Filters & Interceptors** (1 already done)
   - ✅ global-exception.filter.spec.ts

3. **Simple Services** (Easy to test)
   - Health service (1 file, simple logic)
   - Queue service (basic queue operations)

### Week 2 Quick Wins
1. **DTOs** (If you include them in coverage)
   - Test validation decorators
   - Test transformation logic

2. **Utilities**
   - Config hash
   - Units conversion
   - Error helpers

---

## Common Pitfalls to Avoid

### ❌ Don't Do This
```typescript
// Testing implementation details
it('should call private method', () => {
  expect((service as any).privateMethod).toHaveBeenCalled();
});

// Not testing actual behavior
it('should exist', () => {
  expect(service).toBeDefined();
});

// Overly specific mocks
mockRepository.findOne.mockResolvedValue({
  id: 'exact-id',
  createdAt: new Date('2024-01-01'),
  // ... 50 more fields
});
```

### ✅ Do This Instead
```typescript
// Test public behavior
it('should create user successfully', async () => {
  const createDto = { email: 'test@example.com' };
  const result = await service.create(createDto);

  expect(result).toMatchObject({
    email: 'test@example.com',
    id: expect.any(String),
  });
});

// Test meaningful scenarios
it('should handle duplicate email', async () => {
  repository.findOne.mockResolvedValue({ id: '1', email: 'test@example.com' });

  await expect(service.create({ email: 'test@example.com' }))
    .rejects
    .toThrow('Email already exists');
});

// Use flexible mocks
mockRepository.findOne.mockResolvedValue({
  id: expect.any(String),
  email: expect.stringMatching(/@/),
});
```

---

## Progress Tracking

### Daily Checklist
- [ ] Run tests before starting work
- [ ] Write tests alongside code changes
- [ ] Run tests before committing
- [ ] Check coverage report
- [ ] Commit tests with feature code

### Weekly Goals
- [ ] Week 1: Authentication tested (8-10 test files)
- [ ] Week 2: Test runs module tested (5-7 test files)
- [ ] Week 3: Integrations tested (8-10 test files)
- [ ] Coverage: 10% → 20% → 30%

### Quality Checks
- [ ] All tests pass
- [ ] Coverage increased
- [ ] No skipped/pending tests
- [ ] No flaky tests
- [ ] Tests are readable and maintainable

---

## Getting Help

### Resources
- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)

### Questions to Ask
1. "What is this code supposed to do?" (Write test for expected behavior)
2. "What could go wrong?" (Write test for error cases)
3. "What are the edge cases?" (Write test for boundaries)
4. "How will this be used?" (Write test for real usage scenarios)

---

## Success Metrics

### After Week 1
- ✅ 10%+ coverage
- ✅ 8-10 new test files
- ✅ Authentication fully tested
- ✅ CI/CD running tests

### After Week 2
- ✅ 20%+ coverage
- ✅ 15-20 test files total
- ✅ Core business logic tested
- ✅ Coverage reports in PR reviews

### After Week 3
- ✅ 30%+ coverage
- ✅ 25-30 test files total
- ✅ Critical integrations tested
- ✅ Coverage gates enforced

---

**Remember:**
- Focus on behavior, not implementation
- Test what matters, not what's easy
- Quality over quantity
- Refactor as you go

**Next Step:** Create your first test file using the templates above!
