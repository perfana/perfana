# Docker Build Guide - Perfana Report Service

## Overview

The Perfana Report service provides two Dockerfiles for different use cases:

1. **Root Dockerfile** (`/Dockerfile` with `target=perfana-report`) - Multi-stage monorepo build for CI/CD
2. **Standalone Dockerfile** (`apps/perfana-report/Dockerfile`) - Simplified build for local development

## Quick Start

### Local Development Build

Build and run locally using the standalone Dockerfile:

```bash
# From the perfana-report directory
cd apps/perfana-report

# Build the image
docker build -t perfana-report:local .

# Run the container
docker run -d \
  --name perfana-report \
  -p 3003:3003 \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=5432 \
  -e DB_NAME=perfana \
  -e DB_USERNAME=perfana \
  -e DB_PASSWORD=perfana \
  -e REDIS_HOST=host.docker.internal \
  -e REDIS_PORT=6379 \
  perfana-report:local

# Check logs
docker logs -f perfana-report

# Check health
curl http://localhost:3003/health/live
curl http://localhost:3003/health/ready
```

### Production Build (Monorepo)

Build using the root multi-stage Dockerfile:

```bash
# From the monorepo root
docker build -t perfana/perfana-report:perfana-4.0.0 --target perfana-report .

# Tag with SHA
SHA=$(git rev-parse --short HEAD)
docker tag perfana/perfana-report:perfana-4.0.0 perfana/perfana-report:sha-$SHA

# Push to registry
docker push perfana/perfana-report:perfana-4.0.0
docker push perfana/perfana-report:sha-$SHA
```

## Docker Image Details

### Base Image

- **Base**: `node:20-alpine` (Alpine Linux 3.20)
- **Size**: ~400-500MB (with Chromium)
- **Non-root user**: `perfana` (UID 1001)

### Installed Packages

The image includes Chromium and its dependencies:

- `chromium` - Browser for Puppeteer
- `nss` - Network Security Services
- `freetype` - Font rendering
- `harfbuzz` - Text shaping
- `ttf-freefont` - Free TrueType fonts
- `ca-certificates` - SSL certificates
- `dumb-init` - Process signal handler

### Environment Variables

#### Required

```bash
DB_HOST=postgresql.perfana.svc.cluster.local
DB_PORT=5432
DB_NAME=perfana
DB_USERNAME=perfana
DB_PASSWORD=<secret>
REDIS_HOST=redis-master.perfana.svc.cluster.local
REDIS_PORT=6379
```

#### Optional (with defaults)

```bash
NODE_ENV=production
PORT=3003
BROWSER_POOL_SIZE=3
PDF_TIMEOUT_MS=90000
QUEUE_CONCURRENCY=2
LOG_LEVEL=info
```

#### Puppeteer Configuration

```bash
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

## CI/CD Integration

### GitHub Actions

The service is automatically built on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`
- Version tags (`v*`)
- Manual workflow dispatch

**Workflow file**: `.github/workflows/docker-build.yml`

**Job**: `build-perfana-report`

**Images produced**:
- `perfana/perfana-report:latest` (main branch only)
- `perfana/perfana-report:sha-<commit-sha>`
- `perfana/perfana-report:v<version>` (on version tags)
- `perfana/perfana-report:main` or `develop` (branch builds)

### Build Arguments

The CI/CD build accepts these build arguments:

```dockerfile
ARG APP_VERSION=0.1.0
ARG BUILD_DATE
ARG VCS_REF
ARG BUILD_NUMBER
ARG NODE_VERSION=20
ARG ALPINE_VERSION=3.20
```

## Multi-Stage Build Architecture

The root Dockerfile uses a sophisticated multi-stage build:

```
security-base (node:20-alpine)
├── deps (production dependencies)
├── build-deps (all dependencies)
│   └── source (source code)
│       └── builder (compiled code)
│           └── runtime-prep (optimized runtime)
│               └── perfana-report (final image)
```

### Stages

1. **security-base**: Base Alpine image with security tools
2. **deps**: Production dependencies only
3. **build-deps**: All dependencies for build
4. **source**: Source code preparation
5. **builder**: TypeScript compilation
6. **runtime-prep**: Optimized runtime preparation
7. **perfana-report**: Final production image with Chromium

## Health Checks

The Docker image includes a built-in health check:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3003/health/live', ...)"
```

**Parameters**:
- **Interval**: 30 seconds between checks
- **Timeout**: 10 seconds per check
- **Start period**: 60 seconds grace period on startup
- **Retries**: 3 consecutive failures before unhealthy

**Endpoints**:
- `/health/live` - Liveness check (process running)
- `/health/ready` - Readiness check (dependencies ready)

## Running with Docker Compose

Example `docker-compose.yml`:

```yaml
version: '3.8'

services:
  perfana-report:
    image: perfana/perfana-report:latest
    container_name: perfana-report
    ports:
      - "3003:3003"
    environment:
      NODE_ENV: production
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: perfana
      DB_USERNAME: perfana
      DB_PASSWORD: perfana
      REDIS_HOST: redis
      REDIS_PORT: 6379
      BROWSER_POOL_SIZE: 2
      QUEUE_CONCURRENCY: 1
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3003/health/live', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    read_only: false  # Chromium needs write access to temp directories
    tmpfs:
      - /tmp
    shm_size: '512m'  # Increased shared memory for Chromium

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: perfana
      POSTGRES_USER: perfana
      POSTGRES_PASSWORD: perfana
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U perfana"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

**Start services**:

```bash
docker-compose up -d
docker-compose logs -f perfana-report
```

## Troubleshooting

### Browser Launch Failures

**Problem**: "Failed to launch browser" errors

**Solution**:
1. Ensure sufficient memory (at least 512MB per browser)
2. Increase shared memory: `--shm-size=512m`
3. Check Chromium executable exists: `docker exec <container> ls -la /usr/bin/chromium-browser`

### Permission Errors

**Problem**: "Permission denied" errors

**Solution**:
1. Verify running as non-root user: `docker exec <container> id`
2. Check file ownership: `docker exec <container> ls -la /app`
3. Ensure tmpfs mounted for temp files

### Out of Memory

**Problem**: Container crashes with OOM errors

**Solution**:
1. Increase container memory limit: `--memory=2g`
2. Reduce browser pool size: `-e BROWSER_POOL_SIZE=1`
3. Reduce concurrency: `-e QUEUE_CONCURRENCY=1`

### Slow PDF Generation

**Problem**: PDF generation takes too long

**Solution**:
1. Increase CPU allocation: `--cpus=2`
2. Check network latency to database/Redis
3. Increase timeout: `-e PDF_TIMEOUT_MS=120000`

## Security Considerations

### Non-Root User

The image runs as a non-root user (`perfana:1001`) for security:

```dockerfile
USER perfana:perfana
```

### Read-Only Filesystem

For enhanced security, consider running with read-only root filesystem:

```bash
docker run --read-only --tmpfs /tmp perfana/perfana-report:latest
```

Note: Chromium requires write access to temp directories, so tmpfs is necessary.

### Security Scanning

The image is scanned for vulnerabilities in CI/CD:

```bash
# Scan with Trivy
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image perfana/perfana-report:latest

# Scan with Snyk
snyk container test perfana/perfana-report:latest
```

### Network Security

Restrict network access in production:

```bash
# Only allow specific outbound connections
docker run --network=perfana-network \
  --cap-drop=ALL \
  perfana/perfana-report:latest
```

## Build Cache Optimization

### GitHub Actions Cache

The CI/CD workflow uses GitHub Actions cache:

```yaml
cache-from: type=gha
cache-to: type=gha,mode=max
```

### Local Build Cache

Enable BuildKit for better caching:

```bash
export DOCKER_BUILDKIT=1
docker build -t perfana-report:latest .
```

### Multi-Platform Builds

Build for multiple architectures:

```bash
docker buildx create --use
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t perfana/perfana-report:latest \
  --target perfana-report \
  --push \
  .
```

## Image Size Optimization

Current image size: ~400-500MB (primarily due to Chromium)

**Size breakdown**:
- Base Alpine: ~40MB
- Node.js 20: ~120MB
- Chromium + dependencies: ~200MB
- Application code: ~40MB

**Optimization tips**:
1. Use `.dockerignore` to exclude unnecessary files
2. Multi-stage builds (already implemented)
3. Clean npm cache after install
4. Remove build dependencies after compilation

## Version Tagging Strategy

Images are tagged with multiple tags for flexibility:

1. **SHA tags**: `sha-abc1234` - Immutable, specific builds
2. **Semantic versions**: `v1.2.3`, `v1.2`, `v1` - Versioned releases
3. **Branch tags**: `main`, `develop` - Latest from branch
4. **Latest**: `latest` - Latest main branch build

**Example**:

```bash
perfana/perfana-report:latest
perfana/perfana-report:main
perfana/perfana-report:sha-abc1234
perfana/perfana-report:v4.0.0
perfana/perfana-report:v4.0
perfana/perfana-report:v4
```

## References

- [Dockerfile Reference](https://docs.docker.com/engine/reference/builder/)
- [Puppeteer Docker Guide](https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#running-puppeteer-in-docker)
- [Alpine Package Search](https://pkgs.alpinelinux.org/packages)
- [Docker Security Best Practices](https://docs.docker.com/develop/security-best-practices/)
