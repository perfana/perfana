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
| **Restore** | `RestoreDashboardService` | Dashboards missing from Grafana pushed back from DB → Grafana |

### What restore will and will not push back

`grafana_dashboards` is a **mixed table**. It holds real Grafana dashboards next to *artificial* placeholder rows created for non-Grafana metrics sources, so Perfana's own metrics have somewhere to hang: `ensureArtificialDashboardExists()` in `apps/api/src/modules/dynatrace/dynatrace.repository.ts` writes them with a synthetic `grafana_id` in the 800000+ range for Dynatrace (900000+ is reserved for performance-test metrics). Artificial rows have `grafana_json` NULL — there is no dashboard behind them and pushing one to Grafana would create an empty shell.

The restore sweep compares what Perfana holds against what Grafana holds, so every artificial row looks "missing" on every cycle. `RestoreDashboardService.getDashboardsToRestore()` filters them out. A dashboard is restored only when it is referenced by an application dashboard (or carries the Perfana template tag) **and**:

- **it has a restorable definition** — `grafana_json` parses and has a `dashboard` property. Missing JSON is the expected state for a placeholder and is logged at `debug`; JSON that is present but corrupt is logged once per sweep at `warn`, because that means a real dashboard has quietly stopped being restorable.
- **its application dashboards are all Grafana-sourced** — resolved through `metrics_sources.source_type`. The check is `every`, not `some`: a real Grafana dashboard is shared across systems and one mislinked reference must not block restoring it for everyone else.

Two traps worth knowing before you touch this code:

- **A dashboard uid is unique only within a Grafana instance.** The same uid routinely exists on several. Every lookup by uid must also scope by `grafana_instance_id`, or one instance's application dashboards vouch for another instance's copy and the sweep pushes a dashboard into the wrong Grafana.
- **`source_type != 'grafana'` does not catch everything.** That predicate (also used by `GrafanaDashboardsService.findAll` in the API) misses artificial application dashboards that arrived through a SUT import, because those have `metrics_source_id` NULL and so join to no source type. The `grafana_json` check is what actually catches them.

Restore is also failure-isolated per dashboard: one dashboard Grafana rejects is logged and skipped rather than aborting the sweep, and `restoreDashboard()` returns `true` only when Grafana accepted the dashboard, so the "restored N" count reflects real work.

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
