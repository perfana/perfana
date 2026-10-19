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

## OpenShift / arbitrary UID

Every runtime image runs under OpenShift's default **restricted-v2** SCC, which
ignores the image `USER` and starts the container as a random UID from the
namespace range (e.g. `1000680000`) with GID 0 supplementary, no passwd entry,
all capabilities dropped and no privilege escalation. No `runAsUser` override,
no custom SCC and no service-account exception are needed.

Reproduce locally:

```bash
docker run --rm --user 1000680000:0 --cap-drop ALL --security-opt no-new-privileges \
  -p 3000:3000 -e NEXT_PUBLIC_API_URL=https://api.example.com/api \
  -e NEXT_PUBLIC_CSP_FRAME_SRC=https://grafana.example.com perfana/perfana-web:<tag>
```

**What makes this work, and what breaks it.** Reads are never the problem —
everything under `/app` is world-readable, so an arbitrary UID loads the app
fine. Writes are. `apps/web/scripts/start-server.js` writes twice at startup,
`__env.js` into `apps/web/public/` and the patched CSP into
`apps/web/.next/routes-manifest.json`, and under restricted-v2 those are the
only two writes any image makes outside `/tmp`. Both are **warnings, not
errors**: the server starts, the page works (the client reads `/api/config`),
and the CSP silently stays at its looser build-time value. Nothing fails
loudly, which is why `scripts/check-openshift-uid.sh` exists and runs in CI on
every web build.

The Dockerfile handles it the way OpenShift's own guidance does:
`chmod -R g=u` on those two trees in the builder stage (stage 5), and
`--chown=<user>:0` on each runtime stage's `COPY --from=runtime-prep`. Group 0
plus the owner's bits means the arbitrary UID can write them through its GID 0
membership. `USER nonroot` stays, so plain Docker and Kubernetes still run as
65532 and nothing changes for them. The final stages are distroless and have no
shell, which is why the mode is set in the builder stage and carried by `COPY`
rather than set with a `RUN chmod` at the end.

`perfana-report` pins `HOME=/tmp` and the XDG dirs beside it, because with no
passwd entry nothing resolves a home directory for the arbitrary UID. Chromium
falls back on its own — measured, it renders a PDF with `HOME=/` too — so this
is belt and braces rather than load-bearing; it keeps the profile and cache off
a path that may be read-only. `/tmp` is 1777 in the image, so this needs no
`emptyDir`; mount one only if the pod sets `readOnlyRootFilesystem`. Chromium is launched with `--disable-dev-shm-usage`,
so `/dev/shm` needs no mount either.

The other images — api, worker, grafana-sync and the migration runner — write
nothing to the filesystem at all, so they need no change beyond the group
ownership. None of them listens on a port below 1024 or needs a capability.

## Related

- [[Getting Started]] — Development setup
- [[CI-CD]] — Automated builds
- [[Environment Variables]] — Configuration
