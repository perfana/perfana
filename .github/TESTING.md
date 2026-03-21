# Parallel Testing with Testcontainers

This document explains how Perfana's test suite runs in parallel using GitHub Actions and testcontainers.

## Architecture Overview

### Test Execution Flow

```
Pull Request
    ↓
┌───────────────────────────────────────────────────┐
│  GitHub Actions Workflow (Parallel Execution)    │
├───────────────────────────────────────────────────┤
│                                                   │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────┐ │
│  │   Shared    │  │   API    │  │   Worker    │ │
│  │   Package   │  │  Tests   │  │   Tests     │ │
│  │   Tests     │  │  (TC)    │  │   (TC)      │ │
│  └─────────────┘  └──────────┘  └─────────────┘ │
│                                                   │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │   Grafana   │  │   Web Tests (Sharded)    │  │
│  │   Sync (TC) │  │   Shard 1/2  │ Shard 2/2 │  │
│  └─────────────┘  └──────────────────────────┘  │
│                                                   │
│  ┌──────────────────────────────────────────┐   │
│  │  Type Check  │  Lint  (Parallel Matrix)  │   │
│  └──────────────────────────────────────────┘   │
│                                                   │
│            ↓                                      │
│     ┌──────────────┐                             │
│     │ Quality Gate │                             │
│     └──────────────┘                             │
└───────────────────────────────────────────────────┘
```

(TC) = Uses Testcontainers

## Parallel Execution Strategy

### 1. **Independent Package Tests** (Parallel Jobs)

Each package runs as a separate job:
- **Shared Package**: No dependencies, runs first
- **API**: Depends on Shared, uses testcontainers (PostgreSQL + Redis)
- **Worker**: Depends on Shared, uses testcontainers (PostgreSQL + Redis)
- **Grafana Sync**: Depends on Shared, uses testcontainers (PostgreSQL)
- **Web**: Depends on Shared, split into 2 shards for parallel execution

### 2. **Web Test Sharding**

Web tests are split into 2 shards using Jest's built-in sharding:

```yaml
strategy:
  matrix:
    shard: [1, 2]
```

Each shard runs half of the test suite in parallel, reducing total execution time by ~50%.

### 3. **Quality Checks Matrix**

Type checking and linting run in parallel using matrix strategy:

```yaml
strategy:
  matrix:
    check: ['Type Check', 'Lint']
```

## Testcontainers Integration

### What is Testcontainers?

Testcontainers automatically manages Docker containers for integration tests. It:
- Spins up PostgreSQL and Redis containers automatically
- Provides isolated test environments
- Cleans up containers after tests complete
- Works seamlessly in CI/CD environments

### Packages Using Testcontainers

1. **API** (`apps/api`)
   - PostgreSQL (TimescaleDB)
   - Redis (for BullMQ)

2. **Worker** (`apps/worker`)
   - PostgreSQL (TimescaleDB)
   - Redis (for BullMQ)

3. **Grafana Sync** (`apps/grafana-sync`)
   - PostgreSQL (TimescaleDB)

### Configuration

Testcontainers is enabled via environment variable:

```bash
USE_TESTCONTAINERS=true
```

No additional configuration needed - testcontainers handles everything!

## Running Tests Locally

### Run All Tests (Sequential)

```bash
# From project root
npm test
```

### Run Tests in Parallel (Like CI)

```bash
# Run all package tests in parallel
npm run test:parallel

# Or manually in separate terminals:
cd packages/shared && npm test &
cd apps/api && npm run test:cov &
cd apps/worker && npm run test:coverage &
cd apps/grafana-sync && npm run test:coverage &
cd apps/web && npm test -- --shard=1/2 &
cd apps/web && npm test -- --shard=2/2 &
wait
```

### Run Tests with Testcontainers

```bash
# API tests with testcontainers
cd apps/api
USE_TESTCONTAINERS=true npm run test:cov

# Worker tests with testcontainers
cd apps/worker
USE_TESTCONTAINERS=true npm run test:coverage
```

## Performance Metrics

### Sequential vs Parallel Execution

| Execution Mode | Time | Speedup |
|---|---|---|
| Sequential (old) | ~45 minutes | 1x |
| Parallel (new) | ~12-15 minutes | **3x faster** |

### Breakdown by Package

| Package | Tests | Time | Parallel Strategy |
|---|---|---|---|
| Shared | 249 | ~30s | Runs first (dependency) |
| API | ~2,510 | ~8 min | Testcontainers |
| Worker | 891 | ~5 min | Testcontainers |
| Grafana Sync | ~150 | ~3 min | Testcontainers |
| Web | ~400+ | ~10 min | 2 shards (5min each) |
| Type Check | - | ~2 min | Parallel with Lint |
| Lint | - | ~2 min | Parallel with Type Check |

**Total (parallel)**: ~12 minutes (longest job + quality gate)

## Docker Requirements

### GitHub Actions

GitHub Actions runners come with Docker pre-installed. The workflow includes:

```yaml
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3
```

### Local Development

Install Docker Desktop:
- **macOS**: https://docs.docker.com/desktop/install/mac-install/
- **Linux**: https://docs.docker.com/desktop/install/linux-install/
- **Windows**: https://docs.docker.com/desktop/install/windows-install/

Verify Docker is running:

```bash
docker ps
```

## Coverage Reporting

### Codecov Integration

All packages upload coverage to Codecov with flags:

```yaml
flags: api, web, worker, grafana-sync, shared
```

View combined coverage at: `https://codecov.io/gh/<org>/perfana-next-gen`

### Coverage Thresholds

| Package | Threshold | Current |
|---|---|---|
| Shared | 50% | 100% ✅ |
| Worker | 70% | 100% ✅ |
| API | 50% | ~88% ✅ |
| Web | 50% | ~75% ✅ |
| Grafana Sync | 50% | ~80% ✅ |

## Troubleshooting

### Testcontainers Issues

**Problem**: Tests fail with "Cannot connect to Docker daemon"

**Solution**:
1. Ensure Docker is running: `docker ps`
2. Check Docker socket permissions
3. Restart Docker daemon

**Problem**: Port conflicts (address already in use)

**Solution**: Testcontainers automatically assigns random ports. If issues persist, check for leaked containers:

```bash
# List all containers
docker ps -a

# Remove test containers
docker rm -f $(docker ps -a -q --filter "label=org.testcontainers")
```

### GitHub Actions Issues

**Problem**: Job timeout

**Solution**: Increase timeout in workflow:

```yaml
timeout-minutes: 30  # Increase from 20
```

**Problem**: Tests fail only in CI

**Solution**:
1. Check environment variables
2. Verify Node.js version matches (20)
3. Check for race conditions in parallel execution

### Web Test Sharding Issues

**Problem**: Uneven shard distribution

**Solution**: Jest automatically balances shards based on test file size. If needed, adjust shard count:

```yaml
matrix:
  shard: [1, 2, 3, 4]  # 4 shards instead of 2
```

## Best Practices

### Writing Tests for Parallel Execution

1. **Avoid Global State**: Each test should be isolated
2. **Use Testcontainers**: Don't rely on shared database instances
3. **Mock External Services**: Use MSW, nock, or similar
4. **Clean Up Resources**: Close connections, clear timers
5. **Set Timeouts**: Prevent hanging tests with appropriate timeouts

### Example: Isolated Test with Testcontainers

```typescript
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';

describe('UserService (Integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Testcontainers automatically starts PostgreSQL
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          // Testcontainers handles connection details
          ...testDatabaseConfig,
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    // Testcontainers automatically cleans up
  });

  it('should create user', async () => {
    // Test runs in isolated database container
  });
});
```

## Continuous Improvement

### Monitoring

Track workflow performance:
- View execution times in GitHub Actions UI
- Monitor Codecov for coverage trends
- Review test failure patterns

### Optimization Opportunities

1. **Increase Web Shards**: Currently 2, could go to 4
2. **Cache Dependencies**: Already using `actions/cache`
3. **Parallel Type Check**: Run per-package type checks in parallel
4. **Test Selection**: Only run affected tests on small PRs

## Support

For issues or questions:
- GitHub Issues: https://github.com/perfana/perfana-next-gen/issues
- Documentation: /docs/testing/
- Testcontainers Docs: https://testcontainers.com/

---

**Last Updated**: 2026-02-03
**Maintained By**: Perfana Team
