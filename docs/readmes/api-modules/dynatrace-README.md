# Dynatrace Module

Manages Dynatrace configurations, DQL queries, entity mappings, and live data fetching from the Dynatrace v2 API.

## Architecture

```
DynatraceModule
├── DynatraceController   — HTTP layer (REST endpoints)
├── DynatraceService      — Business logic, external Dynatrace API calls
└── DynatraceRepository   — Database access (TypeORM)
```

## Entities (from `@perfana/db`)

| Entity | Table | Purpose |
|--------|-------|---------|
| `DynatraceConfig` | `dynatrace_configs` | Dynatrace instance credentials and metadata |
| `DynatraceQuery` | `dynatrace_queries` | DQL queries per system/environment/workload |
| `DynatraceEntityMapping` | `dynatrace_entity_mappings` | Maps Dynatrace entities (e.g. HOSTs) to systems |
| `MetricsSource` | `metrics_sources` | Universal adapter replacing the old ApplicationDashboard pattern |

## Key Design Decisions

### MetricsSource Replaces ApplicationDashboard

When a `DynatraceQuery` is created, the service automatically creates (or reuses) a `MetricsSource` row with `source_type='dynatrace'`. The MetricsSource ID becomes the `applicationDashboardId` on the query. This replaces the old pattern of creating fake Grafana dashboards for Dynatrace metrics.

### Smart UUID Reuse (`POST /dynatrace/query/smart`)

The smart endpoint checks whether a `MetricsSource` already exists for the given `dashboardLabel` + `systemUnderTestId` + `testEnvironment`. If one exists its UUID is reused, ensuring all queries under the same dashboard label share a single MetricsSource.

### HOST Entity Auto-Provisioning

When an entity mapping is created for a `HOST` entity type, the controller automatically calls `createHostMetricQueries`, which creates four standard DQL queries (CPU, Memory, Disk, Network) and registers `ds_compare_config` rows for anomaly detection.

## REST Endpoints

### Configurations
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dynatrace` | List configs (filtered by org) |
| `POST` | `/dynatrace` | Create config (tests connection first) |
| `PATCH` | `/dynatrace/:id` | Update config attributes |
| `DELETE` | `/dynatrace/:id` | Delete config |
| `POST` | `/dynatrace/test-connection` | Test Dynatrace API connectivity |

### DQL Queries
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dynatrace/queries` | List queries (optional sys/env/workload filter) |
| `GET` | `/dynatrace/queries/dashboards` | Distinct dashboard labels (for SLO config) |
| `GET` | `/dynatrace/queries/metrics` | Panel titles for a specific dashboard (for SLO config) |
| `GET` | `/dynatrace/queries/:id` | Get a single query |
| `POST` | `/dynatrace/queries` | Create query |
| `POST` | `/dynatrace/query/smart` | Create query with MetricsSource UUID reuse |
| `POST` | `/dynatrace/query/bulk-import` | Bulk import queries |
| `PATCH` | `/dynatrace/queries/:id` | Update query |
| `DELETE` | `/dynatrace/queries/:id` | Delete query |

### Entities
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dynatrace/entities` | Fetch entities from Dynatrace v2 API |
| `GET` | `/dynatrace/entities/mappings` | List entity mappings |
| `POST` | `/dynatrace/entities/mappings` | Create entity mapping (auto-creates HOST queries) |
| `DELETE` | `/dynatrace/entities/mappings/:id` | Delete entity mapping |

### Host data
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dynatrace/hosts/:hostId/properties` | Fetch host entity properties |
| `GET` | `/dynatrace/:id/request-attributes` | Fetch Dynatrace request attributes |

## Authentication

All endpoints require a Bearer token. Use the `Authorization: Bearer <jwt>` header.

## External API Calls

- Uses native `fetch` (Node 18+)
- `DEFAULT_TIMEOUT_MS` = 10 s for standard API calls
- `ENTITIES_TIMEOUT_MS` = 15 s for entities API calls
- API tokens are stored encrypted in the database via `encryptedColumnTransformer`
