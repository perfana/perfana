---
aliases:
  - CI/CD
  - GitHub Actions
tags:
  - operations
  - ci-cd
---

# CI/CD

Perfana uses GitHub Actions for continuous integration and deployment.

## Pipeline Overview

```
Push/PR
  │
  ├── Lint ──────────▶ ESLint across all apps
  ├── Type Check ────▶ TypeScript compilation
  ├── Test ──────────▶ Jest tests (all apps)
  │   └── Coverage ──▶ Coverage reports
  ├── Build ─────────▶ Production builds
  └── SonarQube ─────▶ Code quality analysis
```

## Test Infrastructure

### Testcontainers
Integration tests use Testcontainers for:
- PostgreSQL with TimescaleDB
- Redis
- Isolated test databases per test suite

### Coverage Targets

Coverage tracked per app:
- `apps/api` — Unit + integration tests
- `apps/web` — Component + hook tests
- `apps/worker` — Pipeline unit tests
- `apps/grafana-sync` — Sync service tests

### Fix Scripts

| Script | Purpose |
|---|---|
| `fix-coverage-paths.sh` | Fix coverage report paths for SonarQube |
| `run-sonar-scan.sh` | Run SonarQube analysis |

## SonarQube Integration

Code quality analysis configured in `sonar-project.properties`:
- Quality gates for new code
- Coverage thresholds
- Code smell detection
- Security vulnerability scanning

## Quality Gates

Before merge:
- All tests passing
- Lint clean
- Type check clean
- Build successful
- Coverage thresholds met

## Related

- [[Getting Started]] — Development commands
- [[Docker]] — Container builds
