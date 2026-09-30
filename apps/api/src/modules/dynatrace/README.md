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

### A query carries a MetricsSource *and* an artificial dashboard

Creating a `DynatraceQuery` writes two things, and they are separate columns on the query row:

- `metrics_source_id` — `ensureMetricsSourceExists` upserts one `MetricsSource` with `source_type='dynatrace'` per `(system, environment, workload, config)`. This is what the rest of the platform uses to tell a Dynatrace source from a Grafana one.
- `application_dashboard_id` — `ensureArtificialDashboardExists` writes an *artificial* `grafana_dashboards` placeholder plus the `application_dashboards` row that points at it, so Dynatrace panels have somewhere to hang. These are not fake dashboards left over from an older design; the SLO dialog looks them up by uid and they are still required. See "`grafana_dashboards` is a mixed table" in the root `CLAUDE.md`.

### UUID reuse (`POST /dynatrace/query/smart`, `POST /dynatrace/query/bulk-import`)

`POST /dynatrace/query/smart` reuses one `application_dashboard_id` across queries in the SAME scope: `findDashboardByLabel` looks for an existing `dynatrace_queries` row with that label **under the same system, environment and workload** and reuses its id. `POST /dynatrace/query/bulk-import` does not consult it at all — it always derives.

**When nothing matches, the id must be derived, never random.** The fallback is `generateDynatraceDashboardUuid(system, environment, label, workload)`. Since v0.2.96.23 the artificial `application_dashboards` row leaves `grafana_instance_id` NULL — which is what lets a second workload have its own row — and `ON CONFLICT (id) DO NOTHING` is then that insert's only dedupe. A `randomUUID()` here never matches the conflict target, so every call that missed the lookup inserted another dashboard row for the same logical dashboard, silently. Both endpoints used `randomUUID()` and were changed in that version. Full reasoning: "An artificial Dynatrace dashboard is per-workload, but its unique constraint is not" in `apps/api/CLAUDE.md`.

Until v0.2.96.25 the reuse arm matched `where: { dashboardLabel }` alone — global across the
table, while the derive arm beside it was scoped to all four columns — so a query created in one
workload could be handed another scope's `application_dashboard_id`. It is scoped to all four now,
with `order: { createdAt: 'ASC' }`: `dynatrace_queries` has only a primary key, so one scope can
hold several rows, and while the lookup was unscoped they could hold *different* dashboard ids.

**Consequence on an existing install.** A legacy row whose sibling lives under a different
workload is no longer found, so the next create in that scope derives a fresh deterministic id and
`ensureArtificialDashboardExists` writes a second artificial dashboard. The old queries keep
pointing at the `randomUUID` row, the new ones at the derived row, and nothing reconciles them.
That is the intended direction — the two scopes were never meant to share — but it is a fork, not
a migration, and there is no backfill.

### HOST Entity Auto-Provisioning

When an entity mapping is created for a `HOST` entity type, the controller automatically calls `createHostMetricQueries`, which creates one DQL query per entry in `HOST_METRICS` (`dynatrace.service.ts`) and registers `ds_compare_config` rows for anomaly detection. As of v0.2.96.22 that is eight: CPU Usage, Memory Usage, Disk Read/Write Latency, Disk Read/Write Operations, Disk Queue Length and Network Traffic. `HOST_METRICS` is the single definition shared with the host-detail card — see "The host metric list has ONE definition" in `apps/api/CLAUDE.md`. Hosts mapped before v0.2.96.22 keep their old query set; nothing migrates them.

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
| `POST` | `/dynatrace/query/smart` | Create query, reusing one artificial dashboard id per label |
| `POST` | `/dynatrace/query/bulk-import` | Bulk import queries (shares one dashboard id when asked) |
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
