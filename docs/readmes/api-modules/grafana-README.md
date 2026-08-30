# Grafana Module

Manages Grafana integration concerns: instances, dashboard references, and the
application dashboards that link them to systems under test.

> The `MetricsSource` adapter lives in its own module
> (`apps/api/src/modules/metrics-sources/`), not here.

## Entities

| Entity | Table | Purpose |
|--------|-------|---------|
| `GrafanaInstance` | `grafana_instances` | Connection config for a Grafana server (encrypted API key / password) |
| `GrafanaDashboard` | `grafana_dashboards` | Local mirror of Grafana dashboard metadata — **mixed table**, see below |
| `ApplicationDashboard` | `application_dashboards` | Links a dashboard to a system-under-test + environment |

### `grafana_dashboards` is a mixed table

Not every row is a real Grafana dashboard. Non-Grafana metrics sources need
somewhere to hang their panels, so `ensureArtificialDashboardExists()` in
`apps/api/src/modules/dynatrace/dynatrace.repository.ts` writes *artificial*
placeholder rows with a synthetic `grafana_id` in the 800000+ range for
Dynatrace. Artificial rows have `grafana_json` NULL, have no counterpart in
Grafana, and must never be pushed to one.

**Never use `grafana_id` to tell artificial rows apart.** The comment at that
insert reads as a range convention (800000+ Dynatrace, 900000+ performance-test
metrics), and it holds in neither direction. Nothing emits the 900000+ range —
the perf-test path creates no synthetic row at all
(`apps/worker/src/pipelines/helpers/dashboard-manager.ts`). And real Grafana ids
are snowflake-style and enormous, so they land far above both ranges: on the dev
database 40 of 46 rows sit above 900000 and every one is a real dashboard. A
`grafana_id >= 800000` test would classify the whole table as artificial. Use
`grafana_json` and the `metrics_sources` join instead.

Three things to know before writing code against this table:

- **`findAll`'s artificial-row filter is deliberately loose. Do not tighten
  it.** The `NOT EXISTS` on `metrics_sources.source_type != 'grafana'` is
  wrapped in `if (!query.uid)`, so `GET /grafana/dashboards?uid=…` returns
  artificial rows on purpose: the SLO dialog and `useAddSLOForm`'s by-uid
  lookup both depend on them (an SLO on a Dynatrace host metric is the point).
  The picker-side filter belongs in the client — `isArtificialDashboard` in
  `apps/web/lib/metrics-source-utils.ts`, applied in `useDashboardManagement`.
  `useDashboardManagement.artificialDashboards.test.ts` guards this.
- The `source_type` predicate also misses artificial application dashboards
  that arrived through a SUT import — those have `metrics_source_id` NULL, so
  they join to no source type. Where a filter genuinely has to hold (the
  grafana-sync restore sweep), `grafana_json` is the reliable signal.
- A dashboard `uid` is unique only *within* a Grafana instance, so a lookup by
  uid must also scope by `grafana_instance_id` — `remove()` included.

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

### `ApplicationDashboardsController` — `/grafana/application-dashboards`

Links dashboards to systems under test. This is the endpoint that removes the
references a `DELETE /grafana/dashboards/:id` 409 is complaining about.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/grafana/application-dashboards` | List application dashboards |
| GET | `/grafana/application-dashboards/:id` | Get a single application dashboard |
| POST | `/grafana/application-dashboards` | Create |
| PUT | `/grafana/application-dashboards/:id` | Update |
| DELETE | `/grafana/application-dashboards/:id` | Delete (may run in the background) |
| GET | `/grafana/application-dashboards/:id/delete-info` | Preview what a delete would remove |
| POST | `/grafana/application-dashboards/batch-delete-info` | Preview for many |
| POST | `/grafana/application-dashboards/batch-delete` | Queue a batch delete |
| POST | `/grafana/application-dashboards/copy` | Copy to another scope |

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

**`remove()` refuses when the dashboard is still referenced.** It counts the
`application_dashboards` pointing at the dashboard — by `grafana_dashboard_id`
*or* by `dashboard_uid`, since a row can be linked by uid with a NULL foreign
key and is just as much "in use" — and throws `ConflictException` (409) naming
the count. It deliberately does **not** cascade: Grafana dashboards are shared
between systems, and a SUT delete leaves them behind on purpose, so cascading
would strip configuration from systems the caller was not looking at. The fix
is to delete the referencing rows via `/grafana/application-dashboards` first.

Three caveats:

- The pre-check count runs inside the RLS transaction, so a referencing row the
  caller cannot see counts as zero and the `DELETE` reaches the foreign key
  (`application_dashboards.grafana_dashboard_id` is `ON DELETE NO ACTION`). The
  catch block translates Postgres `23503` into the same 409 rather than letting
  it surface as an opaque 500.
- The `dashboardUid` match is scoped to the dashboard's Grafana instance, since a
  uid is only unique within one. v0.2.89.0 shipped it unscoped, so a same-uid
  application dashboard on a different instance counted and refused a delete that
  nothing referenced — a false 409, fixed in v0.2.89.1.
- Rows already queued for background deletion (`deletion_status` of `queued` or
  `deleting`) still count and still block.

`GrafanaDashboardsController` rethrows any `HttpException` untouched so these
deliberate status codes survive its own error handler. The 409 is declared with
`@ApiResponse`, so it appears in `/api/docs`.

## Authorization

All services inline the same authorization pattern as the rest of the project
(matching `SystemsUnderTestService`):

- **Global admins** (`perfana-admin`, `admin` roles) bypass all checks.
- **Non-admins** see only records belonging to their accessible organizations.
  There is no null-org allowance: `organization_id` has been NOT NULL on every
  owned resource since RBAC Phase 4, so an `IS NULL` escape could only ever match
  a dangling join — a row another tenant must not see.
- **Mutations** on `GrafanaInstance` require org-admin in at least one
  organization. `GrafanaDashboard` and `ApplicationDashboard` currently allow
  any authenticated user to mutate (legacy data pattern).

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
