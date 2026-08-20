# Grafana Module

Manages all Grafana integration concerns and the universal MetricsSource adapter.

## Entities

| Entity | Table | Purpose |
|--------|-------|---------|
| `GrafanaInstance` | `grafana_instances` | Connection config for a Grafana server (encrypted API key / password) |
| `GrafanaDashboard` | `grafana_dashboards` | Local mirror of Grafana dashboard metadata |
| `MetricsSource` | `metrics_sources` | Universal metrics adapter (replaces legacy ApplicationDashboard) |

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
| DELETE | `/grafana/dashboards/:id` | Delete a dashboard reference |

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
  There is no null-org allowance: `organization_id` has been NOT NULL on every
  owned resource since RBAC Phase 4, so an `IS NULL` escape could only ever match
  a dangling join — a row another tenant must not see.
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
