# Docker Build Guide for M1/ARM64

This guide explains how to build Docker images for macOS M1 (ARM64) architecture using buildx.

## Quick Start

### Build for M1 (ARM64) - Load to Local Docker

```bash
# Build both web and API images for M1
./build-m1.sh

# Build only web image
./build-m1.sh --web-only

# Build only API image
./build-m1.sh --api-only

# Build development image
./build-m1.sh --dev
```

### Multi-Platform Builds (ARM64 + AMD64)

Multi-platform builds cannot be loaded to local Docker directly. You must either:

**Option 1: Build without loading (creates build cache)**
```bash
./build-m1.sh --platform linux/arm64,linux/amd64 --no-load
```

**Option 2: Build and push to registry**
```bash
./build-m1.sh --platform linux/arm64,linux/amd64 --push --registry myregistry.com/perfana
```

### Direct buildx Commands

If you prefer to use buildx directly:

```bash
# Build web image for M1
docker buildx build \
  --platform linux/arm64 \
  --target web \
  --load \
  -t perfana/perfana-web:latest \
  -f Dockerfile .

# Build API image for M1
docker buildx build \
  --platform linux/arm64 \
  --target api \
  --load \
  -t perfana/perfana-api:latest \
  -f Dockerfile .

# Multi-platform build (must push to registry)
docker buildx build \
  --platform linux/arm64,linux/amd64 \
  --target web \
  --push \
  -t myregistry.com/perfana/perfana-web:latest \
  -f Dockerfile .
```

## Available Build Targets

The Dockerfile includes multiple build targets:

- `web` - Next.js frontend application (production)
- `api` - NestJS backend application (production)
- `development` - Development environment with all dependencies
- `production` - Default production target (based on API)

## Build Options

### Platform Flags

- `--platform linux/arm64` - Build for M1/M2 Macs (ARM64)
- `--platform linux/amd64` - Build for Intel/AMD processors
- `--platform linux/arm64,linux/amd64` - Multi-platform build

### Script Options

```bash
./build-m1.sh [OPTIONS]

Options:
  --platform PLATFORM    Platform to build for (default: linux/arm64)
  --push                 Push images to registry instead of loading locally
  --no-load              Don't load images to local Docker
  --version VERSION      Application version (default: 0.1.0)
  --registry REGISTRY    Registry prefix (default: perfana)
  --web-only             Build only web image
  --api-only             Build only API image
  --dev                  Build development image
  --help                 Show help message
```

## Common Scenarios

### Scenario 1: Local Development on M1

Build and load images to local Docker for testing:

```bash
./build-m1.sh
docker run -p 3000:3000 perfana/perfana-web:latest
docker run -p 3001:3001 perfana/perfana-api:latest
```

### Scenario 2: CI/CD Multi-Platform Build

Build for both ARM64 and AMD64 and push to container registry:

```bash
./build-m1.sh \
  --platform linux/arm64,linux/amd64 \
  --push \
  --registry ghcr.io/myorg/perfana \
  --version 1.2.3
```

### Scenario 3: Build with Cache

Use registry cache to speed up builds:

```bash
CACHE_FROM="type=registry,ref=ghcr.io/myorg/perfana-cache" \
CACHE_TO="type=registry,ref=ghcr.io/myorg/perfana-cache,mode=max" \
./build-m1.sh --push --registry ghcr.io/myorg/perfana
```

### Scenario 4: Development Build

Build development image with all dev dependencies:

```bash
./build-m1.sh --dev
docker run -p 3000:3000 -p 3001:3001 -v $(pwd):/app perfana/perfana-development:latest
```

## Running Built Images

### Using Docker Run

```bash
# Run web application
docker run -d \
  -p 3000:3000 \
  -e NEXT_PUBLIC_API_URL=http://localhost:3001/api \
  --name perfana-web \
  perfana/perfana-web:latest

# Run API application
docker run -d \
  -p 3001:3001 \
  -e DB_HOST=postgres \
  -e DB_PORT=5432 \
  --name perfana-api \
  perfana/perfana-api:latest
```

### Using Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    platform: linux/arm64
    environment:
      POSTGRES_DB: perfana
      POSTGRES_USER: perfana
      POSTGRES_PASSWORD: perfana
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  api:
    image: perfana/perfana-api:latest
    platform: linux/arm64
    ports:
      - "3001:3001"
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USERNAME: perfana
      DB_PASSWORD: perfana
      DB_NAME: perfana
      NODE_ENV: production
    depends_on:
      - postgres

  web:
    image: perfana/perfana-web:latest
    platform: linux/arm64
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:3001/api
      NODE_ENV: production
    depends_on:
      - api

volumes:
  postgres_data:
```

Then run:

```bash
docker compose up -d
```

## Troubleshooting

### Issue: "multiple platforms feature is currently not supported"

This error occurs when trying to use `--load` with multi-platform builds.

**Solution:** Use `--push` to push to a registry or `--no-load` to just build without loading.

### Issue: "failed to solve with frontend dockerfile.v0"

This error may occur if buildx is not using the correct builder.

**Solution:** Ensure the multiplatform builder is active:

```bash
docker buildx use multiplatform
```

Or create a new one:

```bash
docker buildx create --name multiplatform --use
docker buildx inspect --bootstrap
```

### Issue: Build is slow on M1

**Solution:** Use local cache and ensure you're building for `linux/arm64` only:

```bash
./build-m1.sh --platform linux/arm64
```

### Issue: Images too large

The Dockerfile uses multi-stage builds and distroless images to minimize size. If images are still too large:

1. Check that production dependencies are minimal
2. Ensure dev dependencies aren't included
3. Consider using the `.dockerignore` file to exclude unnecessary files

## Best Practices

1. **Use ARM64 for local development** - Fastest builds on M1 Macs
2. **Multi-platform for production** - Ensures compatibility across different architectures
3. **Use build cache** - Significantly speeds up repeated builds
4. **Tag images properly** - Include version numbers and git commit hashes
5. **Security scan images** - Use tools like Trivy or Snyk to scan for vulnerabilities

## Build Performance Tips

1. **Layer caching**: The Dockerfile is optimized for layer caching. Dependencies are installed before copying source code.

2. **Parallel builds**: Build web and API images in parallel using separate terminal windows:

```bash
# Terminal 1
./build-m1.sh --web-only &

# Terminal 2
./build-m1.sh --api-only &
```

3. **Use BuildKit**: BuildKit is enabled by default in buildx and provides better caching and parallel builds.

4. **Registry cache**: For CI/CD, use registry cache to share layers between builds:

```bash
./build-m1.sh \
  --platform linux/arm64,linux/amd64 \
  --push \
  --registry ghcr.io/myorg/perfana
```

Set cache environment variables:
```bash
export CACHE_FROM="type=registry,ref=ghcr.io/myorg/perfana-cache"
export CACHE_TO="type=registry,ref=ghcr.io/myorg/perfana-cache,mode=max"
```

## Additional Resources

- [Docker Buildx Documentation](https://docs.docker.com/buildx/working-with-buildx/)
- [Multi-platform Images](https://docs.docker.com/build/building/multi-platform/)
- [BuildKit Cache](https://docs.docker.com/build/cache/)
