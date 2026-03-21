---
aliases:
  - API
  - Backend
tags:
  - app/api
---

# API Overview

The NestJS backend API is the central service of Perfana. It handles authentication, data access, real-time updates, and orchestrates background processing.

> [!info] Location
> `apps/api/` — Runs on port **3001** — Swagger docs at `/api/docs`

## Architecture

- **Framework**: NestJS with TypeScript
- **ORM**: TypeORM (PostgreSQL)
- **Auth**: Keycloak JWT + API Keys (dual authentication)
- **Real-time**: Socket.IO WebSocket gateway
- **Rate Limiting**: Redis-backed throttling
- **Audit**: Automatic CRUD logging

## Module Overview

The API contains **32 feature modules**. Key modules:

### Core Domain
| Module | Prefix | Purpose |
|---|---|---|
| `test-runs` | `/api/test-runs` | Performance test execution and analysis |
| `benchmarks` | `/api/benchmarks` | SLO/benchmark definition and evaluation |
| `systems-under-test` | `/api/systems-under-test` | Application/service configuration |
| `metrics` | `/api/metrics` | Metric collection and querying |

### Organization & Access
| Module | Prefix | Purpose |
|---|---|---|
| `auth` | `/api/auth` | Keycloak JWT authentication |
| `organizations` | `/api/organizations` | Multi-tenant org management |
| `teams` | `/api/teams` | Team management and membership |
| `api-keys` | `/api/api-keys` | API key generation and validation |
| `users` | `/api/users` | User profile and settings |
| `audit` | `/api/audit` | Audit logging |

### Integrations
| Module | Prefix | Purpose |
|---|---|---|
| `grafana` | `/api/grafana-*` | Grafana instances, dashboards, panels |
| `dynatrace` | `/api/dynatrace` | Dynatrace APM integration |
| `pyroscope` | `/api/pyroscope` | Continuous profiling |
| `tempo` | `/api/tempo` | Grafana Tempo trace storage |
| `trace-analysis` | `/api/trace-analysis` | Distributed trace analysis |

### Data Science & Analysis
| Module | Prefix | Purpose |
|---|---|---|
| `adapt` | `/api/adapt` | ADAPT regression detection config |
| `data-science` | `/api/data` | ML features, anomaly detection |
| `awr` | `/api/awr` | Oracle AWR report handling |

### UI Support
| Module | Prefix | Purpose |
|---|---|---|
| `reports` | `/api/reports` | Report generation |
| `realtime` | — | WebSocket event broadcasting |
| `deep-links` | `/api/deep-links` | URL shortening |
| `compare-presets` | `/api/compare-presets` | Saved comparison configs |
| `trends-presets` | `/api/trends-presets` | Saved trend analysis presets |
| `graph-presets` | `/api/graph-presets` | Saved graph presets |
| `notifications` | `/api/notifications` | Alert management |
| `events` | `/api/events` | Event publishing |
| `profiles` | `/api/profiles` | Performance profiles |

### Infrastructure
| Module | Prefix | Purpose |
|---|---|---|
| `health` | `/api/health` | Health check endpoints |
| `queue` | — | Redis/BullMQ client |
| `tracing-instances` | — | Tracing backend management |
| `tracing-services` | — | Service and span config |

## Request Lifecycle

```
Request ──▶ Global Prefix (/api)
  │
  ▼
DatabaseSessionMiddleware
  ├── Sets PostgreSQL session variables for RLS
  ├── Validates organization membership
  └── Sets X-Organization-Id context
  │
  ▼
KeycloakEnhancedAuthGuard (Authentication)
  ├── JWT token validation (Keycloak)
  └── API key validation (fallback)
  │
  ▼
RolesGuard (Authorization)
  └── @Roles(), @AdminOnly() decorator checks
  │
  ▼
EnhancedThrottlerGuard (Rate Limiting)
  └── Redis-backed per-user/IP throttling
  │
  ▼
Controller ──▶ Service ──▶ TypeORM ──▶ PostgreSQL
  │
  ▼
AuditInterceptor (fire-and-forget logging)
  │
  ▼
SnakeCaseInterceptor (response transformation)
  │
  ▼
Response
```

## Key Design Patterns

- **Facade Pattern**: `TestRunsService` delegates to 12+ sub-services
- **Command Handler**: Separate handlers for Create/Update/Delete mutations
- **Repository Pattern**: Custom TypeORM repositories for data access
- **Row-Level Security**: PostgreSQL session variables set per request
- **Fire-and-forget**: Audit logging doesn't block response

## Related

- [[API Authentication]] — Auth system details
- [[API Endpoints]] — Complete endpoint reference
- [[API Modules]] — Detailed module documentation
- [[Architecture Overview]]
