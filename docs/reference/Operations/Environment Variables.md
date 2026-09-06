---
aliases:
  - Configuration
  - Env Vars
tags:
  - operations
  - reference
---

# Environment Variables

All configuration is managed through environment variables, loaded from `.env.local` or `.env`.

## Database

| Variable | Example | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:54322/postgres` | PostgreSQL connection string |
| `DATABASE_HOST` | `localhost` | DB host (alternative to URL) |
| `DATABASE_PORT` | `5432` | DB port |
| `DATABASE_USER` | `postgres` | DB user |
| `DATABASE_PASSWORD` | `postgres` | DB password |
| `DATABASE_NAME` | `perfana` | DB name |

## Redis

| Variable | Example | Description |
|---|---|---|
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis password (optional) |

## Keycloak

| Variable | Example | Description |
|---|---|---|
| `KEYCLOAK_URL` | `http://localhost:8080` | Keycloak server URL |
| `KEYCLOAK_REALM` | `perfana` | Keycloak realm |
| `KEYCLOAK_CLIENT_ID` | `perfana-web` | Keycloak client ID |
| `KEYCLOAK_ADMIN_URL` | — | Admin API URL |
| `KEYCLOAK_ADMIN_USER` | `admin` | Admin username |
| `KEYCLOAK_ADMIN_PASSWORD` | — | Admin password |
| `USE_KEYCLOAK_AUTH` | `true` | Enable Keycloak auth |

## API Server

| Variable | Example | Description |
|---|---|---|
| `PORT` | `3001` | API server port |
| `NODE_ENV` | `development` | Environment mode |
| `SWAGGER_ENABLED` | `true` | Enable Swagger docs |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed CORS origins |
| `HYPERTABLE_SPACE_PARTITIONS` | `4` | Hash partition count applied to `system_under_test` on `requests_raw`, `requests_error`, `transactions` on fresh installs. Read once at migration time; range 2–64, defaults to 4. (`1` is rejected — it's functionally identical to no space dimension but leaves permanent dimension metadata on the hypertable.) See [[Hypertable Space Rebuild]]. |

## Frontend

| Variable | Example | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API base URL |
| `NEXT_PUBLIC_KEYCLOAK_URL` | `http://localhost:8080` | Keycloak URL |
| `NEXT_PUBLIC_KEYCLOAK_REALM` | `perfana` | Keycloak realm |
| `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID` | `perfana-web` | Keycloak client |

## Grafana Sync

| Variable | Default | Description |
|---|---|---|
| `GRAFANA_SYNC_INTERVAL` | `30000` | Sync interval (ms) |
| `GRAFANA_PROPAGATE_TEMPLATES` | `false` | Enable template propagation |
| `GRAFANA_DB_USE_DIRECT_ACCESS` | `false` | Direct DB access |
| `GRAFANA_DB_TYPE` | — | `mysql` or `postgres` |

## Worker

| Variable | Default | Description |
|---|---|---|
| `AUDIT_RETENTION_MONTHS` | `24` | How long `audit_logs` rows are kept. `AuditRetentionManager` deletes older rows in 10k batches on boot and daily at 03:00 UTC, and logs the row count it removed. A value that is not a positive integer is rejected with a warning and falls back to 24 — `0` would mean `timestamp < now()`, which erases the whole audit trail. |
| `ANALYTICS_STATEMENT_TIMEOUT_MS` | `120000` | Cap on analytics reads, so a runaway query cannot hold a connection indefinitely. Meant to be lowerable. Since v0.2.93.3 it does **not** apply to the two heavy aggregations below — lowering it will not shorten them. |
| `AGGREGATION_STATEMENT_TIMEOUT_MS` | `540000` | Budget for the heavy aggregation transactions (`StatisticsPipeline`, `ControlGroupStatisticsPipeline`), applied by `BasePipelineTypeORM.setAggregationBudget()` as the first statement of the transaction so the whole unit of work gets it. Keep it strictly **below** the analytics pool's client-side `query_timeout` of `600000`: at equal deadlines node-postgres destroys the connection instead of letting Postgres cancel the statement, and the clean rollback and diagnosable error are both lost. |
| `AGGREGATION_WORK_MEM` | `128MB` | `work_mem` for those same two transactions. It keeps roughly 20k `percentile_agg` sketches in a HashAggregate; spilling turns the aggregation into a GroupAggregate that sorts every input row to disk. Postgres charges `work_mem` per hash/sort node **and** per parallel worker, then again per concurrent job, so the deploy-wide peak is roughly this value x (1 + `max_parallel_workers_per_gather`) x (`WORKER_ANALYZE_CONCURRENCY` + `WORKER_BATCH_CONCURRENCY`). Size it against available RAM, not against one query. |
| `REEVALUATE_CHUNK_SIZE` | `5` | How many test runs share one `statistics-calculation`, `control-group-statistics` or `adapt-analysis` job inside the re-evaluate orchestrator, and one `StatisticsPipeline` invocation inside `ControlGroupStatisticsPipeline.backfillMissingSketches`. All of those do their work in a single transaction over every id they are handed, against a ceiling that scales with the batch — ADAPT's 120s `ANALYTICS_STATEMENT_TIMEOUT_MS` (it never calls `setAggregationBudget`), and the `max_tuples_decompressed_per_dml_transaction` budget shared by the per-run `ramp_up` updates. Chunking happens **inside** the one orchestrator job, because the scope lock is keyed on `sut:env:workload` and a second job for the same workload is refused rather than queued. Lowering it is not free: each chunk is a separate job with its own 600s wait, all under the same held lock. Read in `apps/worker/src/lib/utils/chunking.ts`, not `environment.ts`. |
| `WORKER_ANALYZE_CONCURRENCY` | `2` | Concurrent jobs on the analyze queue. Multiplies the `AGGREGATION_WORK_MEM` peak above. |
| `WORKER_BATCH_CONCURRENCY` | `2` | Concurrent jobs on the batch queue. Multiplies the `AGGREGATION_WORK_MEM` peak above. |

## External Integrations

| Variable | Description |
|---|---|
| `GRAFANA_URL` | Default Grafana instance URL |
| `GRAFANA_API_KEY` | Default Grafana API key |
| `DYNATRACE_URL` | Default Dynatrace URL |
| `DYNATRACE_API_TOKEN` | Default Dynatrace token |

## Encryption

| Variable | Description |
|---|---|
| `ENCRYPTION_KEY` | Key for encrypting stored credentials |

> [!warning] Secrets
> Never commit `.env.local` or files containing API keys, passwords, or tokens. Use `.env.example` as a template.

## Runtime Configuration (Docker)

For containerized deployments, environment variables can be injected at runtime using placeholder substitution. See [[Docker]] for details.

## Related

- [[Getting Started]] — Setup guide
- [[Docker]] — Container configuration
