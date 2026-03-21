---
aliases:
  - Grafana Sync
tags:
  - app/grafana-sync
---

# Grafana Sync Overview

The Grafana Sync service keeps Perfana's dashboard definitions synchronized with Grafana instances. It runs as an independent microservice with scheduled sync jobs.

> [!info] Location
> `apps/grafana-sync/` — Runs on port **3002**

## Architecture

- **Framework**: NestJS
- **Scheduling**: `@nestjs/schedule` (cron and interval decorators)
- **Grafana Access**: REST API client + optional direct database access
- **Database**: TypeORM (same PostgreSQL as API)

## Sync Operations

| Operation | Service | Description |
|---|---|---|
| **Store** | `StoreDashboardService` | New dashboards from Grafana → Perfana DB |
| **Update** | `UpdateDashboardsService` | Changed dashboards synced to DB |
| **Restore** | `RestoreDashboardService` | Missing dashboards restored from DB → Grafana |

## Scheduled Jobs

| Job | Schedule | Description |
|---|---|---|
| `handleGrafanaSync()` | Every 30s (configurable) | Main sync cycle |
| `handleTemplateUpdates()` | Every 2 min | Template dashboard propagation |

## Auto-Configuration (Optional)

When enabled, the sync service can automatically discover and configure dashboards:

1. **DashboardFinder** — Finds candidate dashboards in Grafana
2. **VariableDiscovery** — Identifies dashboard variables (service, pod, namespace)
3. **VariableMatcher** — Maps variables to test run dimensions
4. **ApplicationDashboardCreator** — Creates dashboard entries in Perfana
5. **DashboardConfigurator** — Sets up panel links and configurations

> [!tip] Variable Discovery
> Supports InfluxDB and Prometheus query patterns. Uses confidence scoring to determine the best variable matches.

## Configuration

Key environment variables:

| Variable | Default | Description |
|---|---|---|
| `GRAFANA_SYNC_INTERVAL` | 30000 | Sync interval in ms |
| `GRAFANA_PROPAGATE_TEMPLATES` | false | Enable template propagation |
| `GRAFANA_DB_USE_DIRECT_ACCESS` | false | Direct DB access to Grafana |
| `GRAFANA_DB_TYPE` | — | `mysql` or `postgres` |

## Sanity Checkers

Health validation modules:
- **Test Run Sanity** — Validates test runs after 10-minute delay (interval: 5 min)
- **General Sanity** — Overall health validation (interval: 1 hour)

## Grafana Access Methods

### REST API (Default)
- Uses `GrafanaApiService` (axios-based)
- Standard Grafana API endpoints
- API key authentication

### Direct Database (Optional)
- `GrafanaDbService` connects directly to Grafana's backend DB
- Supports MySQL and PostgreSQL
- Useful for bulk operations and consistency checks
- Bypasses API rate limits

## Related

- [[Integrations]] — Grafana integration configuration
- [[Data Flow]] — Sync in the data pipeline
- [[Architecture Overview]]
