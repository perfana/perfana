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
| `HYPERTABLE_SPACE_PARTITIONS` | `4` | Hash partition count applied to `system_under_test` on `requests_raw`, `requests_error`, `transactions` on fresh installs. Read once at migration time; range 1–64, defaults to 4. See [[Hypertable Space Rebuild]]. |

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
