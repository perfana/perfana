# Grafana Module

Manages all Grafana integration concerns and the universal MetricsSource adapter.

## Entities

| Entity | Table | Purpose |
|--------|-------|---------|
| `GrafanaInstance` | `grafana_instances` | Connection config for a Grafana server (encrypted API key / password) |
| `GrafanaDashboard` | `grafana_dashboards` | Local mirror of Grafana dashboard metadata — **mixed table**, see below |
| `MetricsSource` | `metrics_sources` | Universal metrics adapter (replaces legacy ApplicationDashboard) |

### `grafana_dashboards` is a mixed table

Not every row is a real Grafana dashboard. Non-Grafana metrics sources need
somewhere to hang their panels, so `ensureArtificialDashboardExists()` in
`apps/api/src/modules/dynatrace/dynatrace.repository.ts` writes *artificial*
placeholder rows: synthetic `grafana_id` in the 800000+ range for Dynatrace,
900000+ reserved for performance-test metrics. Artificial rows have
`grafana_json` NULL, have no counterpart in Grafana, and must never be pushed
to one.

Two things to know before writing code against this table:

- `GrafanaDashboardsService.findAll` hides artificial rows with a `NOT EXISTS`
  on `metrics_sources.source_type != 'grafana'`. That predicate does **not**
  match artificial application dashboards that arrived through a SUT import —
  those have `metrics_source_id` NULL, so they join to no source type. If your
  filter has to be airtight, test `grafana_json` as well.
- A dashboard `uid` is unique only *within* a Grafana instance. Any lookup by
  uid must also scope by `grafana_instance_id`.

The same rules govern the restore sweep in `apps/grafana-sync` — see
`docs/reference/Apps/Grafana Sync/Grafana Sync Overview.md`.

## Controllers

### `GrafanaInstancesController` — `/grafana-instances`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/grafana-instances` | List instances (org-scoped) |
| GET | `/grafana-instances/:id` | Get a single instance |
| POST | `/grafana-instances` | Create (org-admin required) |
| PATCH | `/grafana-instances/:id` | Update (org-admin required) |
| DELETE | `/grafana-instances/:id` | Delete (org-admin required) |
| POST | `/grafana-instances/test-connection` | Test connection with ad-hoc params |
| POST | `/grafana-instances/:id/test-connection` | Test connection for a stored instance |

### `GrafanaDashboardsController` — `/grafana/dashboards`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/grafana/dashboards` | List dashboard references |
| GET | `/grafana/dashboards/:id` | Get a single dashboard reference |
| POST | `/grafana/dashboards` | Create a dashboard reference |
| PATCH | `/grafana/dashboards/:id` | Update a dashboard reference |
| DELETE | `/grafana/dashboards/:id` | Delete a dashboard reference — **409** if still in use |

### `MetricsSourcesController` — `/metrics-sources`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/metrics-sources` | List sources (filters: systemId, environment, sourceType) |
| GET | `/metrics-sources/:id` | Get a single source |
| POST | `/metrics-sources` | Create a source |
| PUT | `/metrics-sources/:id` | Full update of a source |
| DELETE | `/metrics-sources/:id` | Delete a source |
| POST | `/metrics-sources/copy` | Copy sources between scopes |

## Services

### `GrafanaClientService`

HTTP client for the live Grafana API. Uses native `fetch` (Node 18+).

- `getGrafanaInstance(id)` — load a `GrafanaInstanceRef` from the database
- `grafanaCall(instance, endpoint)` — authenticated GET
- `deleteDashboard(instance, uid)` — DELETE a dashboard by UID
- `createAnnotation(instance, params)` — POST an annotation
- `deleteAnnotation(instance, id)` — DELETE an annotation
- `getDatasource(instance, uid)` — GET datasource metadata
- `getInfluxVariableValues(...)` — resolve template variable values via InfluxDB proxy
- `getPrometheusVariableValues(...)` — resolve template variable values via Prometheus proxy

### `GrafanaInstancesService`

CRUD + org-scoped authorization for `GrafanaInstance` records. Credentials
are encrypted at rest by the `encryptedColumnTransformer` on the entity —
decryption is transparent at the TypeORM layer. API responses always mask
`api_key` and `password` with `[MASKED]`.

Connection tests call `/api/health` on the configured URL.

### `GrafanaDashboardsService`

CRUD for `GrafanaDashboard` records and template-variable resolution. Variable
resolution delegates datasource calls to `GrafanaClientService`.

**Delete refuses when the dashboard is still referenced.** `remove()` counts the
`application_dashboards` pointing at the dashboard — by `grafana_dashboard_id`
*or* by `dashboard_uid`, since a row can be linked by uid with a NULL foreign
key and is just as much "in use" — and throws `ConflictException` (409) naming
the count. It deliberately does **not** cascade: Grafana dashboards are shared
between systems, and a SUT delete leaves them behind on purpose, so cascading
would strip configuration from systems the caller was not looking at.

The pre-check count runs inside the RLS transaction, so a referencing row the
caller cannot see counts as zero and the `DELETE` reaches the foreign key
(`application_dashboards.grafana_dashboard_id` is `ON DELETE NO ACTION`). The
catch block translates Postgres `23503` into the same 409 rather than letting it
surface as an opaque 500. `GrafanaDashboardsController` rethrows any
`HttpException` untouched so these deliberate status codes survive its own
error handler.

### `MetricsSourcesService`

CRUD for `MetricsSource` records. Supports filtering by `sourceType`
(grafana, dynatrace, prometheus, influxdb, performance_test). Includes a
`copyToScope` operation for duplicating source configurations between
system-under-test + environment pairs.

## Authorization

All services inline the same authorization pattern as the rest of the project
(matching `SystemsUnderTestService`):

- **Global admins** (`perfana-admin`, `admin` roles) bypass all checks.
- **Non-admins** see only records belonging to their accessible organizations.
  (`organization_id` is `NOT NULL` on these tables since RBAC Phase 4 — the old
  "legacy records with `organization_id IS NULL` are visible to everyone" rule
  is gone.)
- **Mutations** on `GrafanaInstance` require org-admin in at least one
  organization. `GrafanaDashboard` and `MetricsSource` currently allow any
  authenticated user to mutate (legacy data pattern).

## Security

- Grafana API keys and passwords are stored encrypted using AES-256-GCM via
  `encryptedColumnTransformer` from `@perfana/db`.
- Outgoing Grafana URLs are validated to enforce `http`/`https` scheme before
  any `fetch` call (`grafana-client.service.ts`).
- `[MASKED]` placeholders prevent credentials from leaking through the API.

## Adding to AppModule

```typescript
import { GrafanaModule } from './modules/grafana/grafana.module';

@Module({
  imports: [
    // ...
    GrafanaModule,
  ],
})
export class AppModule {}
```
