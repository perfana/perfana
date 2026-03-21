# SonarQube Setup Guide for Perfana Next Gen

This guide explains how to set up and run SonarQube analysis for the Perfana Next Gen monorepo.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Configuration Overview](#configuration-overview)
- [Running SonarQube Locally](#running-sonarqube-locally)
- [CI/CD Integration](#cicd-integration)
- [Understanding the Configuration](#understanding-the-configuration)
- [Quality Gates](#quality-gates)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

1. **SonarQube Server** (one of the following):
   - Docker (recommended for local development)
   - Local installation
   - Cloud instance (SonarCloud)

2. **SonarScanner CLI**
   ```bash
   npm install -g sonarqube-scanner
   # or
   brew install sonar-scanner  # macOS
   ```

3. **Node.js 18+** (already required for the project)

## Configuration Overview

The `sonar-project.properties` file is optimized for this monorepo structure:

```
perfana-next-gen/
├── apps/
│   ├── api/              # NestJS API service
│   ├── web/              # Next.js frontend
│   ├── grafana-sync/     # Grafana sync service
│   └── worker/           # BullMQ worker service
└── packages/
    ├── shared/           # Shared entities and utilities
    └── config/           # Configuration package
```

### Key Features

- Separate source and test file tracking
- Comprehensive exclusions for generated code (entities, DTOs, migrations)
- Multiple coverage report paths for each workspace
- Optimized duplication detection for TypeScript
- Security hotspot detection enabled
- Quality gates aligned with Jest thresholds (80% coverage)

## Running SonarQube Locally

### Step 1: Start SonarQube Server

#### Option A: Using Docker (Recommended)

```bash
# Start SonarQube container
docker run -d --name sonarqube \
  -p 9000:9000 \
  -v sonarqube_data:/opt/sonarqube/data \
  -v sonarqube_logs:/opt/sonarqube/logs \
  -v sonarqube_extensions:/opt/sonarqube/extensions \
  sonarqube:latest

# Wait for SonarQube to start (about 1-2 minutes)
# Check logs: docker logs -f sonarqube

# Access SonarQube at http://localhost:9000
# Default credentials: admin/admin (you'll be prompted to change)
```

#### Option B: Using Docker Compose

Create `docker-compose.sonar.yml`:

```yaml
version: '3.8'
services:
  sonarqube:
    image: sonarqube:latest
    ports:
      - "9000:9000"
    environment:
      - SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true
    volumes:
      - sonarqube_data:/opt/sonarqube/data
      - sonarqube_logs:/opt/sonarqube/logs
      - sonarqube_extensions:/opt/sonarqube/extensions

volumes:
  sonarqube_data:
  sonarqube_logs:
  sonarqube_extensions:
```

```bash
docker-compose -f docker-compose.sonar.yml up -d
```

### Step 2: Generate Test Coverage Reports

```bash
# Generate coverage for all workspaces
npm test -- --coverage

# Or run coverage for individual apps
cd apps/api && npm test -- --coverage
cd apps/web && npm test -- --coverage
cd apps/grafana-sync && npm test -- --coverage
cd apps/worker && npm test -- --coverage
```

Expected coverage locations:
- `apps/api/coverage/lcov.info`
- `apps/web/coverage/lcov.info`
- `apps/grafana-sync/coverage/lcov.info`
- `apps/worker/coverage/lcov.info`

### Step 3: Create Authentication Token

1. Log in to SonarQube at http://localhost:9000
2. Go to **My Account** > **Security**
3. Generate a new token (e.g., "perfana-local-scan")
4. Copy the token (you won't see it again)

### Step 4: Run SonarScanner

```bash
# Set the authentication token
export SONAR_TOKEN="your-token-here"

# Run the scanner
sonar-scanner \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.token=$SONAR_TOKEN

# Or use the full command
sonar-scanner \
  -Dsonar.projectKey=perfana-next-gen \
  -Dsonar.sources=. \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.token=$SONAR_TOKEN
```

### Step 5: View Results

1. Open http://localhost:9000
2. Navigate to your project "perfana-next-gen"
3. Explore:
   - **Issues**: Code quality issues, bugs, vulnerabilities
   - **Code Smells**: Maintainability issues
   - **Security Hotspots**: Security review locations
   - **Coverage**: Test coverage metrics
   - **Duplications**: Duplicate code blocks

## CI/CD Integration

### GitHub Actions Example

Create `.github/workflows/sonarqube.yml`:

```yaml
name: SonarQube Analysis

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  sonarqube:
    name: SonarQube Scan
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0  # Shallow clones should be disabled for better analysis

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests with coverage
        run: npm test -- --coverage

      - name: SonarQube Scan
        uses: sonarsource/sonarqube-scan-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}

      - name: SonarQube Quality Gate check
        uses: sonarsource/sonarqube-quality-gate-action@master
        timeout-minutes: 5
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

### GitLab CI Example

Add to `.gitlab-ci.yml`:

```yaml
sonarqube:
  stage: test
  image: node:18
  before_script:
    - npm ci
  script:
    - npm test -- --coverage
    - npm install -g sonarqube-scanner
    - sonar-scanner
      -Dsonar.projectKey=perfana-next-gen
      -Dsonar.sources=.
      -Dsonar.host.url=$SONAR_HOST_URL
      -Dsonar.token=$SONAR_TOKEN
  only:
    - main
    - develop
    - merge_requests
```

### Environment Variables for CI/CD

Add these secrets to your CI/CD platform:

- `SONAR_TOKEN`: Authentication token from SonarQube
- `SONAR_HOST_URL`: SonarQube server URL (e.g., https://sonarcloud.io or http://your-server:9000)

## Understanding the Configuration

### Source Directories

All TypeScript source code is analyzed:
```properties
sonar.sources=\
  apps/api/src,
  apps/web/app,
  apps/web/components,
  # ... etc
```

### Test Directories

Test files are tracked separately:
```properties
sonar.test.inclusions=\
  **/*.spec.ts,
  **/*.test.ts,
  # ... etc
```

### Exclusions

The following are excluded from analysis:

1. **Build artifacts**: `dist/`, `build/`, `.next/`, `.turbo/`
2. **Dependencies**: `node_modules/`
3. **Generated code**:
   - TypeORM migrations (`**/migrations/**`)
   - Entity definitions (`**/*.entity.ts`)
   - DTO definitions (`**/*.dto.ts`)
   - Type definitions (`**/*.d.ts`)
4. **Configuration files**: `*.config.js`, `*.config.ts`
5. **Test setup files**: `setup.ts`, `jest.setup.js`

### Why Exclude Entities and DTOs?

TypeORM entities and NestJS DTOs are:
- Declarative by nature (mostly decorators and properties)
- Not business logic (data structures)
- Often have low complexity scores despite being correct
- Similar by design (which triggers duplication warnings)

### Coverage Configuration

Multiple coverage report paths support the monorepo structure:
```properties
sonar.javascript.lcov.reportPaths=\
  apps/api/coverage/lcov.info,
  apps/web/coverage/lcov.info,
  # ... etc
```

## Quality Gates

### Default Thresholds

The configuration sets these quality gates:

1. **Code Coverage**:
   - Overall: 70% minimum
   - New code: 80% minimum
   - Matches Jest configuration in `apps/grafana-sync`

2. **Maintainability**: Rating C or better
3. **Reliability**: Rating A (no bugs)
4. **Security**: Rating A (no vulnerabilities)

### Custom Rule Exceptions

Three exceptions are configured:

1. **TODO comments in test files** - Acceptable for test planning
2. **console.log in Next.js server components** - Legitimate for server-side logging
3. **High complexity in migration files** - One-time scripts, not business logic

## Troubleshooting

### Issue: "No coverage information found"

**Solution**: Ensure coverage reports are generated before scanning:
```bash
npm test -- --coverage
ls -la apps/*/coverage/lcov.info  # Verify files exist
```

### Issue: "Failed to parse TypeScript file"

**Solution**: Check `sonar.typescript.tsconfigPath`:
```properties
sonar.typescript.tsconfigPath=tsconfig.base.json
```

Ensure `tsconfig.base.json` exists and is valid.

### Issue: "Too many files to analyze"

**Solution**: Add more exclusions or use file size limits:
```properties
sonar.exclusions=**/node_modules/**,...
```

### Issue: "Authentication error"

**Solution**: Verify your token is correct:
```bash
# Test connection
curl -u $SONAR_TOKEN: http://localhost:9000/api/authentication/validate
```

### Issue: "Duplication false positives in entities"

**Solution**: Already configured - entities are excluded from duplication:
```properties
sonar.cpd.exclusions=**/*.entity.ts,**/*.dto.ts,...
```

### Issue: "Scanner running out of memory"

**Solution**: Increase Node.js memory:
```bash
export NODE_OPTIONS="--max-old-space-size=4096"
sonar-scanner
```

## Advanced Configuration

### Analyzing Specific Workspaces Only

Create workspace-specific properties files:

**sonar-api.properties**:
```properties
sonar.projectKey=perfana-api
sonar.sources=apps/api/src
sonar.tests=apps/api/test
```

Run with:
```bash
sonar-scanner -Dproject.settings=sonar-api.properties
```

### Custom Quality Profiles

1. In SonarQube UI: **Quality Profiles** > **Create**
2. Select "TypeScript" language
3. Customize rules (activate/deactivate)
4. Set as default or assign to project

### Branch Analysis

For feature branch analysis:
```bash
sonar-scanner \
  -Dsonar.branch.name=feature/my-feature \
  -Dsonar.branch.target=main
```

### Pull Request Analysis

For PR analysis (requires Developer Edition or higher):
```bash
sonar-scanner \
  -Dsonar.pullrequest.key=123 \
  -Dsonar.pullrequest.branch=feature/my-feature \
  -Dsonar.pullrequest.base=main
```

## Best Practices

1. **Run coverage before scanning**: Always generate fresh coverage reports
2. **Scan regularly**: Integrate into CI/CD for every PR
3. **Review new issues first**: Focus on issues introduced in new code
4. **Track technical debt**: Monitor debt ratio trends over time
5. **Use quality gates**: Block merges if gates fail
6. **Customize rules**: Adjust rules to match your team's standards
7. **Educate the team**: Share SonarQube reports in code reviews

## Resources

- [SonarQube Documentation](https://docs.sonarqube.org/)
- [SonarScanner for Node.js](https://docs.sonarqube.org/latest/analysis/scan/sonarscanner/)
- [TypeScript Analysis](https://docs.sonarqube.org/latest/analysis/languages/typescript/)
- [SonarCloud](https://sonarcloud.io/) - Free for open-source projects

## Support

For issues with this configuration:
1. Check the troubleshooting section above
2. Review SonarQube logs: `docker logs sonarqube`
3. Check scanner output for specific errors
4. Consult SonarQube documentation

---

**Configuration Version**: 1.0.0
**Last Updated**: 2025-01-06
**Maintained By**: Perfana Development Team
