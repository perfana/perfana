# SonarQube Quick Reference

Quick commands and common tasks for the Perfana Next Gen project.

## Quick Start

```bash
# 1. Start SonarQube (Docker)
docker run -d --name sonarqube -p 9000:9000 sonarqube:latest

# 2. Generate coverage reports
npm test -- --coverage

# 3. Run SonarQube scanner
export SONAR_TOKEN="your-token-here"
sonar-scanner -Dsonar.host.url=http://localhost:9000 -Dsonar.token=$SONAR_TOKEN

# 4. View results
open http://localhost:9000
```

## Common Commands

### Coverage Generation

```bash
# All workspaces
npm test -- --coverage

# Individual workspace
cd apps/api && npm test -- --coverage
cd apps/web && npm test -- --coverage
cd apps/grafana-sync && npm test -- --coverage
cd apps/worker && npm test -- --coverage
```

### Scanning

```bash
# Full scan
sonar-scanner

# Scan with custom host
sonar-scanner -Dsonar.host.url=https://your-sonarqube.com

# Scan specific workspace
sonar-scanner \
  -Dsonar.projectKey=perfana-api \
  -Dsonar.sources=apps/api/src
```

### Docker Management

```bash
# Start SonarQube
docker run -d --name sonarqube -p 9000:9000 sonarqube:latest

# Stop SonarQube
docker stop sonarqube

# Restart SonarQube
docker restart sonarqube

# View logs
docker logs -f sonarqube

# Remove container
docker rm -f sonarqube
```

## Configuration Files

| File | Purpose |
|------|---------|
| `sonar-project.properties` | Main SonarQube configuration |
| `SONARQUBE_SETUP.md` | Detailed setup guide |
| `SONARQUBE_ANALYSIS_SUMMARY.md` | Configuration analysis |
| `.sonarqube/` | Scanner cache (excluded from git) |

## Project Structure

```
perfana-next-gen/
├── apps/
│   ├── api/              # NestJS API (1.5 MB)
│   ├── web/              # Next.js frontend
│   ├── grafana-sync/     # Background service (328 KB)
│   └── worker/           # BullMQ worker (3.1 MB)
└── packages/
    ├── shared/           # Shared entities (1.3 MB)
    └── config/           # Configuration (4 KB)
```

## What Gets Analyzed

### Included
- All `.ts` and `.tsx` files in `src/` directories
- React components, hooks, utilities
- NestJS services, controllers, repositories
- Business logic and application code

### Excluded
- `node_modules/` - Dependencies
- `dist/`, `build/`, `.next/` - Build artifacts
- `**/*.entity.ts` - TypeORM entities
- `**/*.dto.ts` - Data Transfer Objects
- `**/*.spec.ts`, `**/*.test.ts` - Test files (tracked separately)
- `**/migrations/**` - Database migrations
- `**/*.config.js` - Configuration files

## Quality Gates

| Metric | Threshold | Notes |
|--------|-----------|-------|
| Overall Coverage | 70% | Realistic for existing code |
| New Code Coverage | 80% | Matches Jest config |
| Maintainability | C or better | Acceptable technical debt |
| Reliability | A | No bugs allowed |
| Security | A | No vulnerabilities |

## Coverage Report Locations

```
apps/api/coverage/lcov.info
apps/web/coverage/lcov.info
apps/grafana-sync/coverage/lcov.info
apps/worker/coverage/lcov.info
```

## Recommended NPM Scripts

Add to root `package.json`:

```json
{
  "scripts": {
    "sonar:coverage": "npm test -- --coverage",
    "sonar:scan": "sonar-scanner",
    "sonar:full": "npm run sonar:coverage && npm run sonar:scan",
    "sonar:docker": "docker run -d --name sonarqube -p 9000:9000 sonarqube:latest"
  }
}
```

## Troubleshooting

### No Coverage Found
```bash
# Verify coverage files exist
ls -la apps/*/coverage/lcov.info

# Regenerate coverage
npm test -- --coverage
```

### Authentication Error
```bash
# Test token
curl -u $SONAR_TOKEN: http://localhost:9000/api/authentication/validate

# Generate new token in SonarQube UI:
# My Account > Security > Generate Tokens
```

### Scanner Out of Memory
```bash
export NODE_OPTIONS="--max-old-space-size=4096"
sonar-scanner
```

### Slow Scans
```bash
# Check what's being scanned
sonar-scanner -X  # Debug mode

# Verify exclusions are working
grep -A 20 "sonar.exclusions" sonar-project.properties
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Run tests with coverage
  run: npm test -- --coverage

- name: SonarQube Scan
  uses: sonarsource/sonarqube-scan-action@master
  env:
    SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
    SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}
```

### GitLab CI

```yaml
sonarqube:
  script:
    - npm test -- --coverage
    - sonar-scanner
  only:
    - main
    - merge_requests
```

## Quality Metrics

### Current Baseline (Run Initial Scan First)

| Metric | Target | Actual |
|--------|--------|--------|
| Code Coverage | 70% | TBD |
| Duplications | <3% | TBD |
| Code Smells | <500 | TBD |
| Bugs | 0 | TBD |
| Vulnerabilities | 0 | TBD |
| Security Hotspots | Review all | TBD |

## Issue Priorities

### Critical (Fix Immediately)
- Security vulnerabilities (SQL injection, XSS)
- Authentication/authorization bypasses
- Data leaks

### High (Fix Before Merge)
- Bugs in business logic
- Unhandled promise rejections
- Resource leaks

### Medium (Plan to Fix)
- Code smells
- High complexity
- Duplications

### Low (Nice to Have)
- Documentation gaps
- Naming conventions
- TODOs

## Useful Queries in SonarQube UI

```
# New issues since last analysis
created:today

# Critical/blocker issues only
severities=CRITICAL,BLOCKER

# Issues in specific workspace
projects=perfana-api

# Security vulnerabilities
types=VULNERABILITY

# Recently introduced code smells
createdAt>2024-01-01 types=CODE_SMELL
```

## Best Practices

1. **Run coverage before scanning** - Always generate fresh reports
2. **Review new issues immediately** - Don't let technical debt accumulate
3. **Focus on new code quality** - 80% coverage for new code
4. **Fix security issues first** - Zero tolerance for vulnerabilities
5. **Track trends over time** - Monitor debt ratio and coverage

## Resources

- **Setup Guide**: `SONARQUBE_SETUP.md`
- **Analysis Summary**: `SONARQUBE_ANALYSIS_SUMMARY.md`
- **SonarQube UI**: http://localhost:9000
- **SonarQube Docs**: https://docs.sonarqube.org/

## Support

For issues:
1. Check `SONARQUBE_SETUP.md` troubleshooting section
2. Review scanner logs: `sonar-scanner -X`
3. Check Docker logs: `docker logs sonarqube`
4. Consult SonarQube documentation

---

**Last Updated**: 2025-01-06
**Quick Ref Version**: 1.0.0
