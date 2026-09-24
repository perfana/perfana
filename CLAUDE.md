# CLAUDE.md

Performance analysis platform — ingests load test results, collects metrics from Grafana/Dynatrace/Prometheus, runs ADAPT regression detection, provides dashboards with SLO compliance.

## Quick Start

```bash
npm install
docker compose -f docker-compose.infra.yml up -d
# Wait for Postgres + Keycloak to be healthy, then:
npm run dev
```

- API: http://localhost:3001/api/docs (Swagger)
- Web: http://localhost:4000
- Keycloak: http://localhost:8080 (admin/admin, realm: perfana-prod)
- Login: perfana@example.com / perfana

## Project Index

> **Progressive disclosure:** Scan this index. Read only what's relevant to your task.
> Each app's hard-won gotchas live in its own `CLAUDE.md`, which loads automatically when you
> touch files in that directory — this file keeps only what is true everywhere, plus the
> symptom index in [Common Issues](#common-issues) that points into them.

| Area | Path | What's there | Docs |
|------|------|-------------|------|
| 📡 API | `apps/api/` | NestJS REST API, 36+ modules | [CLAUDE](apps/api/CLAUDE.md) · [CODING_RULES](apps/api/CODING_RULES.md) |
| 🌐 Frontend | `apps/web/` | Next.js, MUI + Radix + Tailwind | [CLAUDE](apps/web/CLAUDE.md) · [CODING_RULES](apps/web/CODING_RULES.md) |
| 🔧 Worker | `apps/worker/` | BullMQ pipelines, ADAPT algorithm | [CLAUDE](apps/worker/CLAUDE.md) · [README](apps/worker/README.md) |
| 🔄 Grafana Sync | `apps/grafana-sync/` | Dashboard sync background service | [CODING_RULES](apps/grafana-sync/CODING_RULES.md) |
| 🗄️ Shared | `packages/shared/` | TypeORM entities, types, utils | [README](packages/shared/README.md) |
| ⚙️ Config | `packages/config/` | TypeORM config factory | — |
| 🔌 MCP Server | `apps/mcp/` | MCP tool server for AI agents | [README](apps/mcp/README.md) |
| 📊 Report | `apps/perfana-report/` | Report generation service | [README](apps/perfana-report/README.md) |
| 📚 Deep Reference | `docs/reference/` | ADAPT, RBAC, schemas, features (narrative), how-to tutorials. For derivable "how does X work / what calls this" use GitNexus. | [Index](docs/reference/index.md) · [Tutorials](docs/reference/tutorials.md) |
| 🏗️ Infra | `docker-compose.infra.yml` | Full local stack | — |

→ System diagrams: [ARCHITECTURE.md](ARCHITECTURE.md)
→ Code patterns: [CONVENTIONS.md](CONVENTIONS.md)

---

## Technology Stack

- **Database**: PostgreSQL with TypeORM
- **Backend**: NestJS (TypeScript, decorators, dependency injection)
- **Frontend**: Next.js (React, App Router, Server Components)
- **Authentication**: Keycloak JWT + API Keys
- **Background Jobs**: BullMQ with Redis
- **Language**: TypeScript throughout

## Development Commands

- `npm run dev` — Start all services (api :3001, web :4000, grafana-sync :3002, worker)
- `npm run build` / `npm run test` / `npm run type-check` / `npm run lint`
- `npm run dev:api` / `npm run dev:web` / `npm run dev:grafana-sync` — Individual services
- `lsof -ti:3001,3002,4000 | xargs kill -9 && npm run dev` — Kill and restart

## Authentication System

**CRITICAL**: Perfana uses a **dual authentication system** to support both web users and programmatic access.

### Authentication Methods

1. **Keycloak JWT Authentication** (Web Users)
   - JWT tokens managed by Keycloak with automatic refresh
   - SSO/enterprise authentication support
   - Integration via keycloak-js adapter

2. **API Key Authentication** (Programmatic Access)
   - Bearer token format with base64 encoded description#uuid
   - Configurable TTL (time-to-live)
   - Managed via `/api-keys` endpoints

### Backend Implementation

- **KeycloakEnhancedAuthGuard**: Handles both authentication methods (tries API key first, falls back to Keycloak JWT)
- **Admin endpoints**: Require Keycloak JWT authentication with admin role
- **All API endpoints**: Protected by default, use `@Public()` decorator to bypass

### Frontend API Client Requirements

**MANDATORY**: all frontend API calls go through `authenticatedFetch()` (or `getAuthHeaders()`) from
`apps/web/lib/api.ts` — never `@/lib/keycloak-auth` or a token read out of session/localStorage.
Details and the fallback pattern: [apps/web/CLAUDE.md](apps/web/CLAUDE.md).

### API Endpoints

All endpoints are documented in Swagger: `http://localhost:3001/api/docs`

- All endpoints protected by default via `KeycloakEnhancedAuthGuard`
- Use `@Public()` for unauthenticated access (e.g., health checks)
- Admin endpoints require `perfana-admin` or `admin` role in Keycloak token

## Role-Based Access Control (RBAC)

Multi-tenant RBAC across organizations and teams, all five phases shipped (ownership columns on 26
owned-resource entities, service-layer enforcement, audit logging, row-level security). Every rule
that matters when writing a service — the role hierarchy, why `ctx.organizations` is a trap, the
API-key carve-out, what RLS does **not** backstop on create, ownership-column nullability — is in
[apps/api/CLAUDE.md](apps/api/CLAUDE.md). Narrative reference: `docs/reference/`.

## Environment Configuration

### Required Environment Variables

**Backend:**
- `DB_HOST` - PostgreSQL host
- `DB_PORT` - PostgreSQL port
- `DB_USERNAME` - PostgreSQL username
- `DB_PASSWORD` - PostgreSQL password
- `DB_NAME` - PostgreSQL database name
- `KEYCLOAK_URL` - Keycloak server URL
- `KEYCLOAK_REALM` - Keycloak realm name
- `KEYCLOAK_CLIENT_ID` - Keycloak client ID
- `KEYCLOAK_CLIENT_SECRET` - Keycloak client secret
- `LOG_VIEWER_ENABLED` - Enable admin log viewer (default: `false`). Requires a read-only Docker socket mount on the api service (`/var/run/docker.sock:/var/run/docker.sock:ro`). The distroless api runs non-root, so also grant it the socket's group (`group_add: ["0"]` in compose) or it gets EACCES and the container list is empty. Besides the SSE tail, the viewer can download a container's complete log (`GET /logs/containers/:id/download`, v0.2.95.21): the API reads the daemon as a stream and gzips it with no `Content-Length`, so the download has the same browser and proxy caveats as the SUT export (see [apps/api/CLAUDE.md](apps/api/CLAUDE.md)) — only Chrome and Edge stream it to disk, everything else buffers it in the tab, and a proxy that ignores `X-Accel-Buffering: no` holds it back. Both log routes are `@SkipRls()` because they never touch Postgres. Unlike the export it has no periodic gzip flush yet, so a daemon that is slow to deliver its first frame can trip a proxy read timeout before byte one (see TODOS.md, "Log viewer").
- `LOG_VIEWER_COMPOSE_PROJECT` - Docker Compose project name for container filtering (default: `perfana`). Must match your deploy's compose project (often the directory name) or the list is empty.
- `SUT_TRANSFER_ENABLED` - Enable admin-only SUT export/import feature (default: `false`). Exports production data — including grafana/dynatrace connection rows — to a downloadable file and imports bundles into this environment; keep off in production unless deliberately debugging. Admin (perfana-admin) only. The export streams with no `Content-Length` and can run to multiple GB on a large test run — see "The SUT export is large by default, and only Chrome and Edge can stream it to disk" in [apps/api/CLAUDE.md](apps/api/CLAUDE.md) before debugging a failed one.
- `SCHEMA_DRIFT_CHECK` - How the boot-time entity/schema comparison behaves: `warn` (default) logs any column the database is missing at ERROR and keeps serving, `strict` refuses to start, `off` skips it. A column that reaches only `ConsolidatedSchema.ts` exists on new installs and nowhere else, and the symptom is a read that fails and a list that looks empty rather than an error — see `apps/api/src/common/db/assert-entity-columns.ts`. The matching pre-ship gate is `npm run check:entity-migrations`, wired into `npm run preflight`.
- `SLOW_REQUEST_MS` - **API**: any request whose response takes longer than this is logged at WARN by `SlowRequestMiddleware` (`apps/api/src/common/middleware/`) as `METHOD url status ms pool=total/idle/waiting jobs=<active worker jobs>` (default `1000`; unset, `''`, `0` or non-numeric all mean the default — never "log everything"). The clock starts before the guards, so a pool wait inside the API-key lookup and a 401/403/429 are timed too; `status` is `aborted` when the client hung up first. Read the two suffixes before the number: `waiting > 0` is pool exhaustion, not a slow query; `jobs=` names the BullMQ jobs active at that instant (one shared 2 s snapshot per burst), so a slow-request burst that lines up with a `statistics-calculation` / `control-group-statistics` / `adapt-analysis` job is the heavy aggregation evicting the buffer cache, and no single query will look slow. SSE streams are skipped.
- `SLOW_QUERY_MS` - **API**: TypeORM `maxQueryExecutionTime`; statements slower than this log `slow query (Nms): <sql…200 chars>` (default `1000`, same fallback rule as above — TypeORM treats `0` as off, so `0` means the default). The worker pins both its pools to 5000 in code (`apps/worker/src/config/typeorm.config.ts`) because its aggregations and `ds_metrics` upsert batches routinely take seconds. `grafana-sync` builds its own TypeORM options and does not get this. The worker also logs one line per job exit — `Job done|soft-failed|failed: <name> (ID: n) <run> in Nms (queued Nms) in <queue>` — from the factory's `completed`/`failed` listeners; a `DelayedError` re-park emits neither, on purpose.
- `API_BODY_LIMIT` - Maximum JSON/urlencoded request body (default: `2mb`). Express defaults to 100 kB, which a report section's configuration can exceed on its own — selecting every series across two dashboards is a few thousand entries and the whole section is posted to render a preview. Raise it only if a legitimate payload is rejected with `request entity too large`.
- `AUDIT_RETENTION_MONTHS` - How long `audit_logs` rows are kept, in months (default: `24`). Read by the **worker**: `AuditRetentionManager` deletes older rows on boot and daily at 03:00 UTC and logs the count. Retention is a `DELETE`, not a partition `DROP` — the worker's `perfana_system` role owns no tables.
- `AGGREGATION_STATEMENT_TIMEOUT_MS` - Budget in milliseconds for the **worker's** heavy aggregation transactions — `StatisticsPipeline` and `ControlGroupStatisticsPipeline` (default: `540000`, v0.2.93.3), and since v0.2.95.32 the perf-test aggregates and statistics upsert in `helpers/perf-metrics-writer.ts`, each in its own transaction via `withAggregationBudget` (`apps/worker/src/pipelines/helpers/aggregation-budget.ts`). Deliberately **separate from `ANALYTICS_STATEMENT_TIMEOUT_MS`, not a replacement for it**: that one is a cap on runaway reads and has to stay lowerable, while these two are the job's own work and a 20 M-row run needs more than 120 s. `BasePipelineTypeORM.setAggregationBudget()` applies it with `set_config(..., true)` as the **first** statement inside `withAnalyticsTransaction`, so the whole transaction gets it — including `StatisticsPipeline`'s `ramp_up` refresh, which runs before the aggregation and is the statement most likely to blow the 120 s cap. Keep the value strictly **below** the analytics pool's client-side `query_timeout` (600000, `apps/worker/src/config/typeorm.config.ts`): at equal deadlines node-postgres destroys the connection instead of letting Postgres cancel the statement, and you lose both the clean rollback and the diagnosable `canceling statement due to statement timeout`. 540000 is that headroom.
- `REEVALUATE_CHUNK_SIZE` - How many test runs may share one `statistics-calculation`, `control-group-statistics` or `adapt-analysis` job inside the re-evaluate orchestrator (default: `5`, v0.2.95.0). All three pipelines do their work in a **single transaction over every id they are handed**, and each has a per-transaction ceiling that scales with the batch: `AdaptPipeline` never calls `setAggregationBudget` so it runs on the 120 s `ANALYTICS_STATEMENT_TIMEOUT_MS` cap (~13 s/run measured, so a 9-run batch already exceeds it — and v0.2.94.7 added the orphan-results DELETE to that same transaction); `StatisticsPipeline.refreshRampUpFlags` issues one UPDATE per run but they all share one transaction's `max_tuples_decompressed_per_dml_transaction` (100 000); `ControlGroupStatisticsPipeline` runs against the 540 s `AGGREGATION_STATEMENT_TIMEOUT_MS` inside a 30 min `JOB_WAIT_TIMEOUT_MS` running-time wait (v0.2.95.19; 600 s before the decompress inside it became real), and re-enters `StatisticsPipeline` through `backfillMissingSketches` so it inherits the decompression ceiling too. Chunking happens **inside** the orchestrator, not by issuing several batch jobs: the scope lock is keyed on `sut:env:workload`, so a second job for the same workload is refused rather than queued. Raising it trades headroom against fewer round trips. Lowering it is not free either: each chunk is a separate job with its own 30 min `JOB_WAIT_TIMEOUT_MS` running-time window, and the orchestrator holds the `sut:env:workload` scope lock across all of them — during which every other re-evaluate for that workload is refused, not queued. `checks-evaluation` and `control-groups-creation` are **not** chunked and still receive the whole list; see TODOS.md for the measurement that is owed against the 100-run bulk cap.
- `ADAPT_MIN_SAMPLE_COUNT` - Fewest data points a metric needs on the test run **and** on average per control run before ADAPT compares it (default: `2`, v0.2.95.28). The control side reads `ds_control_group_statistics.count`, which is `AVG(ms.count)` across the baseline runs, not the pooled sum: five one-sample baseline runs still read as 1. That is deliberate — per-run density is what an artefact series violates in every run. Below it the result is `incomparable` rather than a verdict on a handful of samples. A compare config overrides it per dashboard/panel/metric via `thresholds.minSampleCount` (untrusted: a non-number is ignored, a fraction floored, anything below 1 clamped to 1); the perf-test scenario panels (Error Count, Avg/Max Active Threads) write `1` because they hold one point per run by construction, and migration 1806 backfills that key onto configs that predate this version, since the pipeline's `ON CONFLICT DO NOTHING` never would. Two residues: a **metric-level** config on one of those panels shadows the panel row wholesale (the config hierarchy picks a whole object, not a per-key merge) and must carry its own `minSampleCount`; and a worker rolled out **before** the migration runs writes `incomparable` for those panels on the runs it analyses in between, which the migration does not re-evaluate. The floor is folded into `control_exists` in `with_dynamic_statistics` — after config resolution, which is why `with_control` only reports `control_row_exists` — so every threshold check and the label inherit it. The case it exists for: a JMeter sampler whose parent chain broke in the last seconds of a run lands as a separate bare-named metric with one sample, and 1-vs-1 was reported as a full `regression`.
- `AGGREGATION_WORK_MEM` - `work_mem` for those same two transactions (default: `128MB`, v0.2.93.3). It keeps ~20k `percentile_agg` sketches in a HashAggregate; spilling turns the aggregation into a GroupAggregate that sorts every input row to disk. Postgres charges `work_mem` per hash/sort node **and** per parallel worker, then again per concurrent job (`WORKER_ANALYZE_CONCURRENCY` + `WORKER_BATCH_CONCURRENCY`, 2 each), so the deploy-wide peak is roughly this value x (1 + `max_parallel_workers_per_gather`) x 4 — plus, since v0.2.95.32, one budgeted statement at a time per **live** run: the perf-test tick's two aggregates and its statistics upsert (`perf-metrics-writer.ts`) run under the same budget in their own transaction, outside `HeavyStageMutex`, because at the pool default `work_mem` (4MB) the statistics CTE spilled 143 MB on every tick. Raise it only against that budget.
- `PERF_TEST_STATS_MIN_GROWTH` - How much longer a live run must get before an incremental tick recomputes the whole-run perf-test statistics again, as a fraction of the run so far (default: `0.3`, v0.2.96.10). Read by the **worker**. `upsertPerfTestStatistics` (`apps/worker/src/pipelines/helpers/perf-metrics-writer.ts`) reads the **run**, not the tick, while the ticks stay 60 s apart, so the total cost across a run is quadratic in its length. Measured on production with `pg_stat_statements` (2026-09-22) it was the single largest consumer of I/O on the deployment by a factor of 8 — **7055 calls, 5509 GB read, 18.5 hours of database time** — which is what collapses the buffer cache for every other query while a long test runs, including the `summary-timeseries` and `virtual-users` reads that show up in the API's `SlowRequest` log. A geometric cadence makes the total ~4.3x one final pass instead of ~93x on a 3-hour run. `0` restores the recompute-every-tick behaviour. The cost of a higher value is staleness of the **live** display only: analyze runs `statistics-calculation`, whose `StatisticsPipeline` deletes and rewrites every one of these rows from `ds_metrics` with no source filter, so nothing a tick writes survives the analysis it belongs to. The watermark is `MAX(updated_at)` over the run's own statistics rows rather than worker-local state, because ticks for one run are not pinned to a worker process. See "The live perf-test statistics pass is throttled, not incremental" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
- `DS_METRICS_COMPRESS_INITIAL_START` - Read by the **migration runner** only, by migration 1805: ISO-8601 timestamp for the first run of the 2-day `ds_metrics` compression policy (default: the next 02:00 UTC). That first run compresses the previous 7-day chunk in one `compress_chunk` call — hours of I/O on a large deploy — so put it in a quiet window. An unparseable value falls back to the default rather than aborting the deploy.

**Frontend:**
- `NEXT_PUBLIC_API_URL` - Backend API base URL (defaults to localhost:3001/api)
- `NEXT_PUBLIC_KEYCLOAK_URL` - Keycloak server URL
- `NEXT_PUBLIC_KEYCLOAK_REALM` - Keycloak realm name
- `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID` - Keycloak client ID
- `NEXT_PUBLIC_USE_KEYCLOAK_AUTH` - Enable/disable Keycloak auth (default: `true`)
- `NEXT_PUBLIC_LOG_VIEWER_ENABLED` - Enable admin log viewer UI (default: `false`). Must match backend `LOG_VIEWER_ENABLED`.
- `NEXT_PUBLIC_SUT_TRANSFER_ENABLED` - Enable the SUT export dialog + import page UI (default: `false`). Must match backend `SUT_TRANSFER_ENABLED`.

**CSP note (not an env var, but a deploy footgun):** the report viewer and the public share page load report HTML into their iframe from a `blob:` URL rather than `srcDoc`, so `frame-src` must include `blob:` or the iframe never renders — see the comment in `apps/web/next.config.js`. This is baked into the CSP defaults and reapplied by the runtime patcher in `apps/web/scripts/start-server.js` (both keyed off `NEXT_PUBLIC_CSP_FRAME_SRC`), so a deploy that only sets env vars is fine. It breaks only if a reverse proxy or CDN in front of the web app sets or rewrites its own `Content-Security-Policy` header — that path bypasses both files, and the symptom is a report that silently fails to render with no error surfaced.

**Postgres worker budget (not an env var, but a deploy footgun):** TimescaleDB needs `max_worker_processes >= timescaledb.max_background_workers + max_parallel_workers + 1`. The `timescaledb-ha` image ships `max_worker_processes=8` against a default 16 background + parallel workers, so the job scheduler loses the race for a slot and logs `failed to start a background worker` instead of running the 15 continuous-aggregate refresh policies. `docker-compose.infra.yml` sets `max_worker_processes=32`; a deploy running its own Postgres has to set it too, and nothing asserts it at boot. The symptom is not an error — the CAGGs simply stop being materialised, and because they are **real-time** aggregates every query that reads one silently falls back to re-aggregating the raw hypertable. Pages get slow, nothing gets logged. Diagnose by comparing `_timescaledb_catalog.continuous_aggs_watermark` against the window you are querying, and by looking for a `Seq Scan on _hyper_*_chunk` in the `EXPLAIN` of what should be a CAGG read. Same symptom, second cause: a refresh policy's `start_offset` shorter than the test run it has to cover (see `1799000000000-WidenCaggRefreshWindows.ts`).

## Common Patterns

### Error Handling

Use the safe `instanceof Error` pattern:

```typescript
catch (err) {
  const msg = err && typeof err === 'object' && 'message' in err
    ? (err as Error).message : 'Unknown error';
}
```

### Idempotent Provisioning Endpoints

Some endpoints are designed for CI/CD pre-provisioning and return the existing resource with HTTP
409 instead of failing, so pipeline scripts can call them unconditionally. The service returns a
`conflict` flag and the controller converts it — worked example in
[apps/api/CLAUDE.md](apps/api/CLAUDE.md).

### Resource creation: use camelCase entity properties (avoid the silent-drop)

When creating a child resource via `repo.create({...})`, pass the **camelCase entity property name** (e.g. `organizationId`), NOT the snake_case DB column name (e.g. `organization_id`). Most owned-resource entities declare `@Column({ name: 'organization_id' }) organizationId!: string`. TypeORM silently drops unknown properties, so a snake_case key compiles, runs, and INSERTs without an org id — which slams into the Phase 4 NOT NULL constraint at runtime, not compile time.

Two correct patterns:

```typescript
// Pattern A — Inherit from parent (child resources):
const sut = await this.sutRepo.findOne({ where: { id: parentSystemId } });
const child = this.repo.create({
  ...rest,
  organizationId: sut.organizationId,  // camelCase, not organization_id
  teamId: sut.teamId,
});

// Pattern B — Default to user's first accessible org (top-level resources):
const orgId = dto.organizationId
  ?? (await this.authzService.getAccessibleOrganizations(userId))[0];
if (!orgId) throw new ForbiddenException('User has no accessible organization');
const entity = this.repo.create({ ...dto, organizationId: orgId });
```

v0.2.47.66 + v0.2.47.67 fixed 18 sites that hit this gotcha across `grafana-sync` and 17 API services. New services must follow these patterns from day one.

### `grafana_dashboards` is a mixed table (not every row is a Grafana dashboard)

Non-Grafana metrics sources need somewhere to hang their panels, so `ensureArtificialDashboardExists()` in `apps/api/src/modules/dynatrace/dynatrace.repository.ts` writes **artificial** placeholder rows into `grafana_dashboards`, with a synthetic `grafana_id` drawn from an 800000+ range for Dynatrace. Artificial rows have `grafana_json` NULL, have no counterpart in any Grafana, and must never be pushed to one.

**Never use `grafana_id` to tell them apart.** The comment at that insert reads as a range convention (800000+ Dynatrace, 900000+ performance-test metrics), but it does not hold in either direction: nothing emits the 900000+ range — the perf-test path creates no synthetic row at all — and real Grafana ids are snowflake-style and enormous, so they land far above both ranges. On the dev database 40 of 46 rows sit above 900000 and every one of them is a real dashboard. A `grafana_id >= 800000` test would classify the entire table as artificial. Use `grafana_json` and the `metrics_sources` join, as below.

Anything that reads this table has to decide whether it means "real dashboards" or "all rows". Four traps:

1. **The API's `findAll` filter is deliberately loose — do not "fix" it.** It hides artificial rows with a `NOT EXISTS` on `metrics_sources.source_type != 'grafana'`, but only when no `uid` is supplied (`grafana-dashboards.service.ts`, `if (!query.uid)`), so `GET /grafana/dashboards?uid=…` still returns them by design. Two callers need that: the SLO dialog (an SLO on a Dynatrace host metric is the point) and `useAddSLOForm`'s by-uid lookup. **Tightening `findAll` breaks both**, and `apps/web/app/systems/[id]/config/hooks/__tests__/useDashboardManagement.artificialDashboards.test.ts` exists to guard against exactly that. The picker-side filter belongs in the client: `isArtificialDashboard` in `apps/web/lib/metrics-source-utils.ts`, applied in `useDashboardManagement`.
2. **`source_type != 'grafana'` is not airtight anyway.** It misses artificial application dashboards that arrived via a **SUT import** — those have `metrics_source_id` NULL, so they join to no source type. Where a filter genuinely has to hold, `grafana_json` is what catches them. Two sites depend on that: the grafana-sync restore sweep, and `filterCollectableGrafanaDashboards` in `apps/worker/src/services/collectable-sources.ts`, which must not register a Grafana collection source for a placeholder (v0.2.95.12).
3. **A dashboard `uid` is unique only within a Grafana instance.** The same uid routinely exists on several, so every lookup by uid must also scope by `grafana_instance_id` — otherwise one instance's rows vouch for another's. Both sites do: the grafana-sync restore sweep, and the uid arm of `GrafanaDashboardsService.remove`'s delete pre-check. v0.2.89.0 shipped that second one unscoped and it refused deletes nothing referenced (a false 409); fixed in v0.2.89.1.
4. **Deleting one is not free.** `application_dashboards.grafana_dashboard_id` is `ON DELETE NO ACTION`, and app dashboards can also reference by `dashboard_uid` with a NULL foreign key. `DELETE /api/grafana/dashboards/:id` refuses with **409** rather than cascading, because Grafana dashboards are shared and a SUT delete deliberately leaves them behind. Remove the referencing rows first via `/api/grafana/application-dashboards`.

v0.2.89.0 fixed three symptoms of this: the grafana-sync restore sweep re-pushing artificial rows every 30s forever, one rejected dashboard aborting the whole sweep, and the API delete returning an opaque 500. See `docs/reference/Apps/Grafana Sync/Grafana Sync Overview.md` and `apps/api/src/modules/grafana/README.md`.

### Client URL vs server URL: Grafana and Dynatrace have opposite polarity

Both integrations can point the browser at a different address than the API calls, for deploys behind a reverse proxy or split DNS. **Which column is the required one is inverted between them, and that is deliberate — do not "align" them.**

| | Server-side URL (what api/worker call) | Browser-facing URL (deep links) |
|---|---|---|
| `grafana_instances` | `server_url` — **optional** override | `client_url` — **required** |
| `dynatrace_configs` | `host` — **required** | `client_url` — **optional** (v0.2.92.0) |

Grafana's required column is the client one because Perfana renders Grafana panels in the user's browser; Dynatrace's required column is the server one because every Dynatrace API call is made server-side. In both cases the optional column falls back to the required one when unset.

Three rules for the Dynatrace side:

1. **Read it through `deepLinkBaseUrl(config)`** (`apps/web/app/test-runs/[id]/components/dynatrace/utils/dynatrace-formatters.ts`), never `config.host`. It returns `clientUrl || host`, trailing slashes stripped. Every deep-link builder — service links, service flow, MDA, the run comparison, host details — goes through it. A new link that reads `host` directly reintroduces the bug.
2. **One unset representation.** The column is NULL when unset. Create collapses `''` to `undefined`; update treats `null` and `''` alike as "clear it", and only an **absent key** leaves the stored value alone. That is what lets a client GET a config and POST/PATCH it back without special-casing a cleared field.
3. **It is never fetched server-side, so it is not normalised like `host`.** `normalizeUrl` is an SSRF guard for URLs the API calls; `client_url` only ever reaches `window.open`. Its guard is a pinned scheme instead — `@IsUrl({ protocols: ['http','https'], require_protocol: true })` on both DTOs, mirrored by a `httpsOnly` refine in `apps/web/lib/validations.ts`. Drop `require_protocol` and validator.js stops consulting the protocol list entirely, so `javascript:alert(1)` passes. `require_tld` stays off on purpose for internal hostnames.

Related: `createPlatformUrl` rewrites **only** a single-label SaaS tenant URL (`https://<tenant>[.live].dynatrace.com`) to its `<tenant>.apps.dynatrace.com` twin. Anything else — a Managed host, a proxy address, a URL already naming the platform host — comes back untouched. Before v0.2.92.0 it string-replaced blindly and produced `<tenant>.apps.apps.dynatrace.com` or grafted `.apps.dynatrace.com` onto a Managed hostname.

## Common Issues

Symptom index. Each entry names the cause and points at the file that explains it — the per-app
`CLAUDE.md` files load automatically once you touch that directory.


1. **"Failed to fetch"** → Missing `...getAuthHeaders()` in fetch calls
2. **401 Unauthorized** → Expired token, Keycloak handles refresh
3. **403 Forbidden** → Wrong auth type for admin endpoints
4. **`null value in column "organization_id" violates not-null constraint`** → You passed `organization_id` (snake_case) to `repo.create()`. Use `organizationId` (camelCase). See "Resource creation" pattern above.
5. **409 deleting a Grafana dashboard** → Application dashboards still reference it. Remove those first; the API will not cascade. See "`grafana_dashboards` is a mixed table" above.
6. **ADAPT says it could not build a baseline / INSUFFICIENT_DATA on a healthy baseline** → the baseline's `ds_metric_statistics` rows are missing `pct_agg` and the control-group aggregation timed out. The pipeline now repairs this itself; if it could not, use the **Recalculate baseline statistics** button beside the message, then re-evaluate. See "ADAPT's baseline depends on the `pct_agg` sketch" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
7. **INSUFFICIENT_DATA on the run itself, with empty statistics and an Apdex that misses every transaction** → different cause from #6: the run is shorter than `analysisStartOffset + analysisEndOffset`, so the two exclusions overlap and the whole run reads as outside the analysis window. Fixed in v0.2.93.3 (the whole run is analysed when the offsets do not fit); on an older deploy, shorten the offsets for that workload. See item 8 of "ADAPT's baseline depends on the `pct_agg` sketch" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
8. **Transaction time-series graph draws a solid band across an idle window, or throughput reads far too low** → the sampler series is sent unpadded on purpose. Either the client-side re-grid in `buildSamplerTraces` was removed, or a caller is dividing counts by an assumed 5 instead of the response's `aggregation_seconds`. See "The transaction time-series route pads one series and deliberately not the other" in [apps/web/CLAUDE.md](apps/web/CLAUDE.md).
9. **A re-evaluate is slow, the buffer cache hit ratio has collapsed, and no single query looks slow enough to blame** → order `pg_stat_statements` by `shared_blks_read`, not by `total_exec_time`, and look for a diagnostic grouping raw `ds_metrics`. A query can read 103 GB to return 6,234 rows while ranking unremarkably by wall clock, and it evicts everything else's pages on the way. See item 7 of "ADAPT's baseline depends on the `pct_agg` sketch" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
10. **Expanding a transaction row in Performance Analysis is slow on a finished run, with nothing in the log** → the run's `test_run_sampler_stats` is empty while `test_run_transaction_stats` is populated, so every expand falls to the CAGG path. Fixed in v0.2.94.2 (the read path re-enqueues the rollup on first expand); on an older deploy, or if the job is stuck in BullMQ's failed set, run `apps/worker/scripts/backfill-test-run-stats-rollup.ts`. See "The transaction rollup is written in two halves, and one can be silently empty" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

11. **"Network error" exporting a SUT with a large test run** → almost never the network. Either the browser ran the tab out of memory buffering the bundle (Firefox/Safari, which have no save-to-disk picker), or a reverse proxy buffered the stream until a load balancer cut it, or the export failed server-side and the error could not be delivered. Fixed in v0.2.94.3; the API log line `SUT export failed for <id>` distinguishes the third case. See "The SUT export is large by default, and only Chrome and Edge can stream it to disk" in [apps/api/CLAUDE.md](apps/api/CLAUDE.md).

12. **A batch re-evaluate's ADAPT stage is slow or hits the 120 s statement timeout** → check whether Postgres is JIT-compiling the `ds_adapt_results` upsert. `EXPLAIN (ANALYZE, BUFFERS)` the statement and read the `JIT:` footer — 64 s of `Optimization`/`Emission` on a statement that runs in 13 s is the signature. Fixed in v0.2.94.5 (`AdaptPipeline` sets `jit = off` for its own transaction). Do not "fix" it by putting that in `withAnalyticsTransaction`: `StatisticsPipeline` is ~18 s *faster* with JIT on. See "ADAPT runs with JIT off, on purpose" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

13. **A `force` or `missing-data` re-evaluate is far slower than a plain one, with huge temp file usage** → `StatisticsPipeline`, not ADAPT. Look for `Sort Method: external merge Disk:` in the aggregation plan: the group-count estimate is wrong and the planner chose a sort over a hash. Check the statistics object is populated — `SELECT stxdinherit, stxdndistinct FROM pg_statistic_ext s JOIN pg_statistic_ext_data d ON d.stxoid = s.oid WHERE s.stxname = 'ds_metrics_groupkey'` — and that `job_analyze_ds_metrics` is scheduled and succeeding; without that daily ANALYZE the object is empty. Note a plain re-evaluate never runs this pipeline at all (gated on `refreshMode` and `testRunsWithNewData > 0`). See "`ds_metrics` carries one group-key statistics object" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

14. **A run stays at REGRESSION after its analysis time range was narrowed, blamed on a metric with no samples in the window** → orphaned `ds_adapt_results` rows the upsert stopped producing but never deleted. `buildConclusionSQL` counts them with no freshness predicate, and `is_stale` is not consulted by either the conclusion SQL or the read path. Fixed in v0.2.94.7 (`deleteOrphanedResults` runs as a substage of `adapt-analysis`); on an older deploy, re-analyse after deleting the rows whose `(application_dashboard_id, panel_id, metric_name)` has no `ds_metric_statistics` row for the run. If the metric *does* still have statistics, this is not your bug — see #6. See "`ds_adapt_results` is written by an upsert, so it also needs a delete" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

15. **A bulk analysis-window apply reports success but nothing changed for some runs** → three different causes, told apart in the API log. Either the runs were *skipped* and the dialog said so (`not-writable` / `running` / `too-short` — the handler logs the counts per reason), or the whole apply exceeded `MAX_BULK_ANALYSIS_TIME_RANGE_RUNS` (100) and was refused with a 400 naming the count, or the re-evaluate job was refused by the `sut:env:workload` scope lock and exhausted its 2 attempts. Only the third leaves `test_runs.ramp_up` written with `ds_metric_statistics` never recalculated; since v0.2.95.0 that job genuinely fails rather than being recorded completed, so look in BullMQ's failed set. Re-analysis is still fire-and-forget from the API — the open TODOS.md item. See "An analysis window belongs to a workload, not to a run" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

16. **A worker job shows as completed in BullMQ but its work plainly did not happen** → the processor reported failure by *returning* `{ status: 'failed' }` instead of throwing. `simple-workers.ts` does `return await processor(job)`, so that resolves and BullMQ marks it completed: no retry, no failed-set entry, nothing logged as an error. Grep `status: 'failed'` under `apps/worker/src/workers/`. Note `incremental-metrics.ts` does this deliberately, because a scheduler re-drives it; `analyze.ts`'s catch-all did until v0.2.95.13. Do not confuse either with `softFail`, where the return value *is* the contract and the caller reads it via `assertStageSucceeded()`. See "A worker that reports failure by RETURNING is silently succeeding" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

17. **A hover tooltip's text sits away from its background box, or a chart is laid out at the wrong width after a drawer or panel animation** → that chart is a raw `dynamic(() => import('@/components/plotly-cartesian'))` rather than `@/components/ResponsivePlot`, so it only relayouts when the *window* resizes. Most visible on Chrome under Windows, where a classic scrollbar takes ~15px off the container the moment it appears; macOS overlay scrollbars take nothing, so it does not reproduce on a Mac. Fixed for the anomaly-detection charts in v0.2.95.2. See "A Plotly chart must observe its own container, not the window" in [apps/web/CLAUDE.md](apps/web/CLAUDE.md).

18. **A metrics picker lists only the performance-test panels while a run is still going, or omits a metric the graph endpoint will happily draw** → it is sourced from `ds_metric_statistics` instead of `ds_metrics`. That table has two writers on different schedules, and during a live run only `PerformanceTestMetricsPipeline` has written to it; it also holds rows only for non-null, non-ramp-up metrics on org-scoped dashboards. Neither symptom produces an empty result, so no fallback catches it. See "`ds_metric_statistics` is not a faster `ds_metrics`" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

19. **A panel or metric dropdown is slow on a large run** → check the shape of the query before reaching for a new table or a hand-rolled loose index scan. A `GROUP BY` with `COUNT(DISTINCT)` / `ARRAY_AGG(DISTINCT)` over `ds_metrics` walks every data point (2035 ms on 12.8 M rows); making the inner set distinct first is index-only over `idx_ds_metrics_panel_lookup` (927 ms, v0.2.95.3). A plain single-column `SELECT DISTINCT` on that table is already fast — TimescaleDB SkipScans it in 3.9 ms — so EXPLAIN it before optimising it. See item 7 of "ADAPT's baseline depends on the `pct_agg` sketch" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

20. **"All aggregated" appears twice in a metric dropdown, an "All aggregated" series renders blank or disagrees with the panel it sits on, or a report's Custom Graphs section says "No metrics data found for the selected graph presets"** → the *synthetic* run-wide aggregate is being offered or intercepted on the real `Performance test metrics all aggregated` dashboard, where that exact name is an ordinary stored series on every panel. Three guards keep the two apart and each fails silently when weakened: `shouldOfferAllAggregated`'s third parameter (required on purpose — defaulting it to `[]` fails open), `isAllAggregatedDashboard` at the three web add-series sites, and `isSyntheticAllAggregated` in the report data fetcher. A blank report section is the report-side symptom; a series whose numbers disagree with the panel is the chart-side one. The empty *graph preset* section was a fourth case, fixed in v0.2.95.5: the report read graph presets from `ds_metrics` only, where the synthetic series has no rows by definition. See "The perf-test pipeline writes one extra dashboard, and its series name was already taken" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

21. **A run is marked invalid with "Data collection coverage is 0% (threshold: 80%)" on a system whose sources were deliberately switched off** → not a data-quality problem. `calculateCoverage` divides by the number of rows in `ds_metric_collection_status`, so a source registered for collection that can never return anything pins the average at 0, and the incremental ticks cannot rescue it — a tick with no data deliberately records a **zero-width** range so its window is retried. Two switches the registration path used to ignore: `dynatrace_queries.enabled = false` and the Grafana `no-anomaly-detection` tag, plus the artificial `grafana_dashboards` placeholders that are not Grafana dashboards at all. Fixed in v0.2.95.12; on an older deploy, delete the dead `ds_metric_collection_status` rows for the run and re-analyse. See "A source that is switched off must not be registered for collection" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

22. **Dynatrace data stops arriving, the token is fixed, and a re-analyse still collects nothing** → the config was marked `is_complete` while every query was failing, and `PipelineOrchestrator` skips all four collection stages once every status row is complete. Only a force-refetch reevaluate clears it. Fixed in v0.2.95.12 (a config is completed only when its batch ran and every query succeeded); on an older deploy, force-refetch or clear `is_complete` for the run. The tell is that `metricsDocuments.length === 0` is the same signal for "no data" and "all queries errored" — check the worker log for per-query errors rather than the collection status. See rule 4 of "A source that is switched off must not be registered for collection" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

23. **A force-refetch re-evaluate generates gigabytes of WAL and pins autovacuum for minutes** → something is deleting `ds_metrics` with a predicate on a column other than `test_run_id`, or calling `decompressChunksForRange` to make such a delete survivable. `test_run_id` is `compress_segmentby`, so the single-column `DELETE` is segment-targeted and free (181 ms / 41 MB against 162,743 ms / 11 GB). Fixed in v0.2.95.16; the tell on an older deploy is a long `decompress_chunk` transaction in `pg_stat_activity` (now attributable — the worker pools report `perfana-worker` / `perfana-worker-write` rather than `(unset)`) with unrelated tables climbing in dead tuples behind it. See the two v0.2.95.16 bullets in item 6 of "ADAPT's baseline depends on the `pct_agg` sketch" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

24. **Three of four analyses that finished together fail with `Stage statistics-calculation timed out after 600000ms`, the buffer cache hit ratio collapses, temp files spike, and nothing is waiting on a lock** → the heavy stages were contending on the database and the per-stage wall-clock race turned that into partial results while the abandoned aggregation kept running. Fixed in v0.2.95.17 (`HeavyStageMutex` serialises the stages in `HEAVY_STAGES`; they are bounded by `statement_timeout` instead of a race). The UI shows **Queued** while a job waits for the lock or for a worker slot. On an older deploy, set `WORKER_ANALYZE_CONCURRENCY=1`. See "The heavy analyze stages run one at a time" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
25. **Every completion of a large run produces a burst of tens of millions of `ds_metrics` deletes, ~200 MB/s of WAL and a checkpoint a minute, and during it the API stops answering `/api/test`** → the run was gap-filled and then sent down the full collection path anyway, because one source's ranges still failed. Fixed in v0.2.95.20 (a run that had incremental collection keeps it, complete or not). On an older deploy the worker log shows `⚠️ Collection incomplete for <id>` immediately followed by `🧹 Deleted existing ds_metrics for <id> in Nms`; the failing source's error text is in `ds_metric_collection_status.failed_ranges` — a range fails only when the collector threw (an upsert error under load, a config row deleted mid-run, the panel or query load failing), never because a single panel or query answered with an error. See "Gap-filling a completed run must never fall back to a full re-collection" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
26. **Every analyze logs `🗑️ Removing orphaned collection status for performance_test::`, and a JMeter-only run then takes the full delete-and-rebuild path while a run with a Grafana or Dynatrace source skips collection** → the orphan sweep's whitelist said `performance_test::null` and the row says `''`. Fixed in v0.2.95.22, which also stopped skipping the perf-test rebuild on the gap-filled path: the ticks' 1 s buckets and per-minute scenario points are not what the baselines hold, so a mixed-source run analysed between v0.2.95.20 and this fix has tick-shaped perf-test panels and needs a re-analyse. See item 3 of "Gap-filling a completed run must never fall back to a full re-collection" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
27. **A `metrics-collection` stage with no panel documents takes ~3 minutes and logs `Failed to clean up stale data in ds_metrics:` with nothing after the colon** → the whole-hypertable stale-dashboard DELETE. Fixed in v0.2.95.22. See "`cleanupStaleApplicationDashboards` must never be pointed at a hypertable" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
28. **The `checks-evaluation` stage of a re-evaluate takes ~45 s on a run with a workload-level Apdex SLO, and the per-transaction worker log lines read `Apdex for <name>` rather than `Apdex (rollup) for <name>`** (the `fast path miss` line is debug-level) → the run has no `test_run_transaction_stats` at all (its analyze never reached `transaction-stats-rollup`, and a re-evaluate has no rollup stage), so each transaction is a raw `transactions` scan. Fixed in v0.2.95.25 (a re-evaluate rolls the run up first when the table is empty); on an older deploy, run `apps/worker/scripts/backfill-test-run-stats-rollup.ts` or re-analyse the run. See "The transaction rollup is written in two halves" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
29. **`adapt-analysis` fails with `canceling statement due to statement timeout` in `ResultsProcessor.deleteOrphanedResults` on the first analysis of a large run, and every re-evaluate of that run fails the same way while other runs' `delete-orphaned-results` substage reads seconds and growing** → the orphan `DELETE`'s whole-run `EXISTS` guard was planned inside a per-row nested loop because the upsert's rows are invisible to the planner's statistics (metrics x metrics; ~25k metrics crosses the 120 s cap). Fixed in v0.2.95.26 (the guard is keyed on the unnested run list, uncorrelated to the row). On an older deploy the only workaround is a one-off raise of `ANALYTICS_STATEMENT_TIMEOUT_MS` for that worker; nothing in the data is wrong. The `⚠️ No metrics were available to aggregate` / `0 row(s) inserted` lines from `control-group-statistics` in the same log are unrelated and were a logging bug until the same version — TypeORM returns `[]` for an INSERT, so `.rowCount` was always undefined. See item 3 of "`ds_adapt_results` is written by an upsert, so it also needs a delete" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
30. **Some Dynatrace hosts have almost no points on a live run, the sanity check reports them as `1 points across a <N>s run`, and the collection status says the range was collected** → those hosts publish their minute buckets more than a minute late, and a tick that queried exactly `[last tick, now]` recorded the minute as collected because the other hosts answered. Fixed in v0.2.95.27 (every live tick re-queries the previous 2 minutes, `DYNATRACE_INGEST_LOOKBACK_MS`). On an older deploy, a force-refetch re-evaluate after the run completes recovers them from Dynatrace as long as the tenant still holds the window. The last one or two minutes of such a host can still be missing after the fix — that is the open TODOS.md item, not a regression. See item 5 of "Gap-filling a completed run must never fall back to a full re-collection" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
31. **A workload Apdex SLO fails on a transaction that ran a handful of times, or a report shows a red FAIL pill on an SLO row whose `meets_requirement` is NULL** → the first is the sample floor at work (v0.2.95.34): a transaction below `apdex_min_samples` (default 50, counted over every execution including failed ones) is reported as **Too few** and is neither a pass nor a fail; re-evaluate the run to apply it to results stored before the SLO gained the floor. The second is a reader keying on `!== true` instead of `=== false`; `slo-renderer` and `getSloSummary` did until this version. Note the run verdict is `bool_and(COALESCE(meets_requirement, true))`, so a NULL row counts as a pass there, and a run in which nothing reached the floor still announces "SLOs Passed" in Slack/Teams (open TODOS.md item). See "An Apdex SLO has a sample floor" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
32. **A Transaction / Request Error Rate SLO reports a higher percentage than Performance Analysis shows for the same transaction and window** → the check averaged the per-bucket error-rate series unweighted, so one failed execution in a quiet minute counted 100 %. Fixed in v0.2.96.1 (`DataAggregator.pooledErrorRates` reads `SUM(failed)/SUM(total)` from the transaction rollup); re-evaluate the run to replace a stored result. If the two still disagree after that, look for `Pooled error rate unavailable` in the worker log — the series fell back to the bucket mean because the rollup has no row for it (a partial sampler half, a stale rollup after a window change, or a bare-named sampler on panel 205). See "The perf-test error-rate SLO reads the transaction rollup" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).
33. **A Trend SLO reports `No targets found for processing` on a run that plainly has the series, or every perf-test series is missing from it while the run is live** → `ds_metric_statistics.trend_pct_per_hour` is NULL for those rows. Either the run was analysed before migration 1809 (nothing backfills the column; recalculate the run's statistics or re-evaluate with "recalculate statistics"), or the run is still going (`upsertPerfTestStatistics` NULLs both trend columns on every tick and only `statistics-calculation` writes them). If instead a series row reads **No clear trend**, that is the floor at work: `|r| < 0.5` or fewer than 10 points, reported with its slope and passed rather than failed (v0.2.96.7; before that it was reported as unevaluated). A `%/h` unit on an *average* SLO means a writer other than the three that enforce the unit rule touched `metric_unit`, or a pre-v0.2.96.4 switch away from trend. See "A Trend SLO judges the slope of a series" in [apps/worker/CLAUDE.md](apps/worker/CLAUDE.md).

34. **The API's `SlowRequest` log fills with multi-second `summary-timeseries`, `virtual-users` and `throughput` reads** → **read the `jobs=` and `waiting` suffixes first.** `jobs=none` with `0waiting` means no worker job and no pool contention, so the query is slow on its own merits and cache eviction is not the story — a large run's `requests_raw` simply is not resident (60 GB table against a 12 GB `effective_cache_size`). Only when the burst lines up with an active job is it worth asking what is evicting the cache; Order `pg_stat_statements` by `shared_blks_read`, not `total_exec_time` (issue #9 above): on 2026-09-22 the top entry was the **worker's** `upsertPerfTestStatistics`, which re-aggregates the whole run on every 60 s tick — 7055 calls, 5509 GB, 18.5 h of database time, 8x the next entry. Throttled in v0.2.96.10 via `PERF_TEST_STATS_MIN_GROWTH`. Two things that look like causes here and are not: the three `LEFT JOIN`s in the virtual-users query are removed by the planner (`test_runs.test_run_id` is unique), and the `($2 = false OR $3 IS NULL OR time >= $3)` time predicate does **not** defeat chunk exclusion, because node-postgres sends one-shot parameterized queries and the `OR` folds at plan time. What WAS real on that endpoint is the index choice: `virtual_users_time_idx` beat the composite on cost and cost 49x the buffers, dropped in v0.2.96.10 — see "`virtual_users` has no time-only index" in [apps/api/CLAUDE.md](apps/api/CLAUDE.md). `summary-timeseries` itself was a genuine second offender and now reads the 5 s CAGGs — see "The analysis-window overview reads the 5s CAGGs" in [apps/api/CLAUDE.md](apps/api/CLAUDE.md).

35. **A table's striped rows render as a heavy grey (or white) slab, or coloured text fades into the background in dark mode** → two different colour traps that usually travel together, both fixed across the SLO and anomaly tables in v0.2.96.14. The slab is `alpha()` applied to a token that is already translucent: MUI's `alpha()` **replaces** the alpha channel rather than multiplying it, so `alpha(theme.palette.action.hover, 0.3)` is a 30% band where a 1.2% tint was meant (the same call on `divider` gives a 60% hairline). The fading text is a `.dark` palette shade used mode-blind — those shades are tuned for a light surface and resolve to the same hex in both themes; use `sx={{ color: 'readable.primary' }}` or `readableShade(theme, key)` from `apps/web/lib/theme.ts`. A third symptom rides along once the slab is gone: striped, hovered and selected rows land within ~3% of each other unless hover is keyed on `primary.main` rather than on the stripe token. See "Two colour bugs that look like one, and the `readable` palette" in [apps/web/CLAUDE.md](apps/web/CLAUDE.md).

36. **A run's SLO list shows the same SLO twice and neither copy expands** → two `benchmarks` rows target the same panel, so their `check_results` are identical in the three fields the UI keyed on (`application_dashboard_id`, `panel_id`, `metric_name`), React dropped the duplicate sibling, and one row's expand toggled the other's. `uq_benchmarks_unique` did not stop the pair: its last column is `generic_check_id`, NULL for every UI-created SLO, and NULLs never collide in a btree unique. Fixed in v0.2.96.15 — the row key now carries `benchmark_id`, and `uq_benchmarks_active_metric_target` (migration 1812) refuses a second **enabled** SLO on the same panel, series and aggregation. Migration 1812 disables (never deletes) the newer of each existing pair and drops its check results. The Duplicate button now clones **disabled** so it stays outside the index until edited; the edit dialog gained the Enabled checkbox that makes such a clone recoverable. See "Two SLOs on one panel" in [apps/api/CLAUDE.md](apps/api/CLAUDE.md).

37. **Performance Analysis scrolls sideways, even at full width on a MacBook** → the Scenarios table's header labels were `white-space: nowrap`, which put its min-content width at 1703px against a 1302px content column on a 16" MacBook (1728px viewport, sidebar open) once a scenario is expanded. `<Table sx={{ minWidth: 800 }}>` looked like the culprit and was not — 800 is *below* the real minimum and only stopped the collapsed table (true minimum 606px) from shrinking. Fixed in v0.2.96.15: the labels wrap (−324px) and cell padding halves to 8px (−176px), giving 1203px with all eleven columns kept. See "The Scenarios table earns its width back from the header labels" in [apps/web/CLAUDE.md](apps/web/CLAUDE.md).

## Health Stack

- typecheck: turbo run type-check
- lint: turbo run lint
- test: turbo run test
- deadcode: npx knip
- shell: shellcheck $(git ls-files '*.sh') .githooks/pre-push — optional local tool (`brew install shellcheck`); not wired into preflight so a machine without it can still push.
- schema constraints: `npm run check:schema-constraints -- --target <url> --reference <url>` — reports every NOT NULL / CHECK / UNIQUE / PK / FK a deployment is missing relative to a freshly migrated database, with the `ALTER TABLE` for each and the violating-row count for a NOT NULL. Read-only. Build the reference with `DB_NAME=perfana_ref npm run migration:run` on an empty database. Not in preflight — it needs two live databases, one of which is the deployment's.
- **preflight (pre-push gate): npm run preflight** — runs lint + type-check across the monorepo, then the API RLS test suite (`apps/api/src/test/rls/` with `DB_ENABLE_RLS_ROLE=true`). Wired to `git push` via `.githooks/pre-push` (auto-installed by `npm install` via the `prepare` script). Local-only by design — turbo's cache makes warm runs sub-second, and the RLS suite is ~3s. The RLS step targets the local dev DB (`perfana` on `localhost:5432` by default; override with `DB_NAME`); it requires Phase 5b migrations to be applied (cluster roles `perfana_app`/`perfana_system` + per-DB RLS policies and helper functions). Bypass: `git push --no-verify` (use sparingly).

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **perfana** (35908 symbols, 62596 relationships, 216 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/perfana/context` | Codebase overview, check index freshness |
| `gitnexus://repo/perfana/clusters` | All functional areas |
| `gitnexus://repo/perfana/processes` | All execution flows |
| `gitnexus://repo/perfana/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
