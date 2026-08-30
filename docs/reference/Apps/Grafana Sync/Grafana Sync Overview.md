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

`grafana_dashboards` is a **mixed table**. It holds real Grafana dashboards next to *artificial* placeholder rows created for non-Grafana metrics sources, so Perfana's own metrics have somewhere to hang: `ensureArtificialDashboardExists()` in `apps/api/src/modules/dynatrace/dynatrace.repository.ts` writes them with a synthetic `grafana_id` in the 800000+ range for Dynatrace. Artificial rows have `grafana_json` NULL — there is no dashboard behind them and pushing one to Grafana would create an empty shell.

> [!note] The 900000+ range is documented, not written
> A code comment reserves 900000+ for performance-test metrics, but nothing currently emits it. The perf-test path creates no synthetic `grafana_dashboards` row at all — see `apps/worker/src/pipelines/helpers/dashboard-manager.ts` ("grafana columns are NULL for perf-test sources"). Treat rows in that range as legacy data, not as something the code produces.

The restore sweep compares what Perfana holds against what Grafana holds, so every artificial row looks "missing" on every cycle. `RestoreDashboardService.getDashboardsToRestore()` filters them out. A dashboard is restored only when it is referenced by an application dashboard on **this instance** (or carries the Perfana template tag) **and**:

- **it has a restorable definition** — `parseRestorableJson()` returns non-null, meaning the stored value has a `dashboard` property. This is the check that actually catches placeholders, since theirs is NULL.
- **it is not conclusively non-Grafana** — the sweep excludes a dashboard only when it has references and *every* one of them resolves through `metrics_sources` to a `source_type` other than `grafana`. A mixed set still restores, and so does a reference whose `metrics_source_id` is NULL (no source type to judge by). This is fail-safe on purpose: a real Grafana dashboard is shared across systems, and one mislinked reference must not block restoring it for everyone else.

Three traps worth knowing before you touch this code:

- **A dashboard uid is unique only within a Grafana instance.** The same uid routinely exists on several, so the sweep's application-dashboard lookup scopes by `grafana_instance_id`. Without that scope one instance's application dashboards vouch for another instance's copy and the sweep pushes a dashboard into the wrong Grafana. The rule holds on both sides of the codebase: the API's delete pre-check (`GrafanaDashboardsService.remove`) scopes its uid match the same way, after v0.2.89.0 shipped it unscoped and a uid present on two instances counted the wrong instance's references as a false 409 (fixed in v0.2.89.1).
- **`source_type != 'grafana'` does not catch everything.** It misses artificial application dashboards that arrived through a SUT import, because those have `metrics_source_id` NULL and so join to no source type. The `grafana_json` check is what catches those.
- **The logging is quieter than it looks.** The "no restorable grafanaJson" line is `debug` and only fires for candidates that got past the source-type filter, so a Dynatrace placeholder that *does* carry a `metrics_sources` link — the common case this release targets — logs nothing at all. The `warn` for unparseable JSON is near-unreachable in practice: `grafana_dashboards.grafana_json` is `jsonb`, so TypeORM hands back an object and the `JSON.parse` branch only runs for a legacy `string` value. A present-but-unusable value returns null silently.

Restore is also **failure-isolated per dashboard**: before this, one dashboard Grafana rejected with anything other than a 412 aborted the whole instance sweep and starved every dashboard behind it, on every cycle. Each restore is now wrapped individually, and `restoreDashboard()` returns `true` only when Grafana accepted the dashboard, so the "restored N" count reflects real work.

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
