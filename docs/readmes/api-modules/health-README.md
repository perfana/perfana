# health

Public liveness and readiness endpoints backed by `@nestjs/terminus`. No authentication required.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Overall health: database ping + heap + RSS memory |
| GET | `/health/db` | Database connectivity only |
| GET | `/health/memory` | Heap and RSS memory usage only |

All three endpoints return `200 OK` with a `{ status: "ok", info, details }` body when healthy, or `503 Service Unavailable` with a `{ status: "error", error, details }` body when any indicator fails.

## Key files

| File | Purpose |
|------|---------|
| `health.module.ts` | Module registration; imports `TerminusModule` and `TypeOrmModule` |
| `health.controller.ts` | Controller with the three health-check handlers |

## Notes

- All endpoints are decorated with `@Public()`, which signals the global `JwtAuthGuard` to skip authentication — safe to call from load balancers and monitoring probes without a token.
- Thresholds are read from environment variables at startup: `HEALTH_HEAP_THRESHOLD_MB` (default 1 500 MB) and `HEALTH_RSS_THRESHOLD_MB` (default 3 000 MB).
- The `@HealthCheck()` decorator from Terminus handles the 503 response automatically when any indicator throws; no manual try/catch needed in the handlers.
- Use `GET /health/db` for database readiness probes (e.g., Kubernetes `readinessProbe`) and `GET /health` for a full liveness check.
