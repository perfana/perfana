---
tags:
  - operations
  - docker
---

# Docker

Perfana uses Docker for containerized deployments. Multiple Dockerfiles exist for different use cases.

## Dockerfiles

| File | Purpose |
|---|---|
| `Dockerfile` | Standard multi-stage build |
| `Dockerfile.optimized` | Optimized for production |
| `Dockerfile.slim` | Minimal image size |
| `Dockerfile.simple` | Simple single-stage build |
| `Dockerfile.security` | Security-hardened build |
| `Dockerfile.migrations` | Database migration runner |

## Security Hardening

The `Dockerfile.security` includes:
- Non-root user execution
- Read-only filesystem where possible
- Minimal base image (distroless or Alpine)
- No unnecessary packages
- Health check endpoints

> [!tip] Security Scan
> Run `./docker-security-scan.sh` to scan images for vulnerabilities.

## Runtime Configuration

Containers use runtime environment configuration:

1. Build with placeholder values: `__RUNTIME_NEXT_PUBLIC_API_URL__`
2. Container startup script generates `__env.js` from actual env vars
3. Frontend loads config from `window.__ENV__`

This allows a single Docker image to be used across environments (dev, staging, production) by changing environment variables at runtime.

## Perfana Report Docker

Special considerations for the report service:
- Requires Chromium/Chrome dependencies for Puppeteer
- Browser sandbox requires specific kernel capabilities
- Documented in `apps/perfana-report/DOCKER.md`

## Build Commands

```bash
# Standard build
docker build -t perfana-api -f Dockerfile .

# M1/ARM build
./build-m1.sh

# Security-hardened build
docker build -t perfana-api -f Dockerfile.security .
```

## Deployment Options

### Docker Compose

A `docker-compose.yml` is provided for local development and single-node deployments. It includes PostgreSQL (TimescaleDB), Redis, and optionally Grafana and Prometheus.

```bash
docker compose up -d
```

### Kubernetes

For production deployments, Helm charts are available:

- **Repository**: https://github.com/perfana/helm-charts

The charts include manifests for all Perfana services, with configurable replicas, resource limits, health probes, and ingress.

## Related

- [[Getting Started]] — Development setup
- [[CI-CD]] — Automated builds
- [[Environment Variables]] — Configuration
