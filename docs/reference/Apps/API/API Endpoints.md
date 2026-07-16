---
aliases:
  - Endpoints
  - API Reference
tags:
  - app/api
  - reference
---

# API Endpoints

> [!tip] Swagger
> Interactive API docs available at `http://localhost:3001/api/docs` (non-production or with `SWAGGER_ENABLED=true`).

## Auth

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth/health` | Health check (public) |
| `GET` | `/api/auth/jwks` | Keycloak JWKS proxy (public) |
| `GET` | `/api/auth/profile` | Current user profile |
| `GET` | `/api/auth/me` | Alias for profile |

## Organizations

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/organizations` | List user's organizations |
| `GET` | `/api/organizations/:id` | Get single organization |
| `POST` | `/api/organizations` | Create organization |
| `PUT` | `/api/organizations/:id` | Update organization |
| `DELETE` | `/api/organizations/:id` | Delete organization |

## Teams

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/teams` | List teams (`?organizationId=` filter) |
| `GET` | `/api/teams/:id` | Get single team |
| `POST` | `/api/teams` | Create team |
| `PUT` | `/api/teams/:id` | Update team |
| `DELETE` | `/api/teams/:id` | Delete team |
| `GET` | `/api/teams/:id/members` | List team members |
| `POST` | `/api/teams/:id/members` | Add team member |
| `DELETE` | `/api/teams/:id/members/:memberId` | Remove team member |

## Test Runs

### Core CRUD

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/test-runs` | List test runs (paginated) |
| `GET` | `/api/test-runs/:id` | Get test run by ID |
| `PUT` | `/api/test-runs/:id/annotations` | Update annotations |
| `PUT` | `/api/test-runs/:id/tags` | Update tags |
| `DELETE` | `/api/test-runs/:id` | Delete test run |

### Initialization

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/test-runs/init` | Initialize test run |
| `POST` | `/api/test-runs/test` | Create/initialize test run |

### Analysis

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/test-runs/baseline-candidates` | Baseline test runs for comparison |
| `GET` | `/api/test-runs/test-runs-after-changepoint` | Test runs after most recent changepoint |
| `GET` | `/api/test-runs/anomalies` | Anomalies for a test run |
| `POST` | `/api/test-runs/:id/mark-changepoint` | Mark changepoint manually |
| `POST` | `/api/test-runs/:id/delete-anomaly` | Remove anomaly |
| `GET` | `/api/test-runs/adapt-results` | ADAPT analysis results |
| `POST` | `/api/test-runs/:id/adapt-config` | Update ADAPT configuration |

### Metrics

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/test-runs/:id/stats` | Transaction statistics |
| `GET` | `/api/test-runs/:id/samples` | Transaction samples |
| `GET` | `/api/test-runs/:id/timeseries` | Time series metrics |
| `GET` | `/api/test-runs/:id/virtual-users` | Virtual user statistics |
| `GET` | `/api/test-runs/:id/throughput` | Throughput metrics |

### Apdex

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/test-runs/:id/apdex-thresholds` | Get Apdex thresholds |
| `POST` | `/api/test-runs/:id/apdex-thresholds` | Create Apdex thresholds |
| `DELETE` | `/api/test-runs/:id/apdex-thresholds/:name` | Delete threshold |

### Comparison

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/test-runs/comparison` | Compare test runs |
| `GET` | `/api/test-runs/check-results` | Config change check results |
| `GET` | `/api/test-runs/expected-config-changes` | Expected config changes |
| `POST` | `/api/test-runs/expected-config-changes` | Create expected change |

### Dashboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/test-runs/:id/dashboard` | Dashboard statistics |
| `GET` | `/api/test-runs/:id/summary` | Test run summary |

### Errors

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/test-runs/:id/errors` | Error analysis |
| `GET` | `/api/test-runs/:id/error-statistics` | Grouped error statistics |

## API Keys

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/api-keys` | List API keys |
| `GET` | `/api/api-keys/:id` | Get single API key |
| `POST` | `/api/api-keys` | Create API key |
| `DELETE` | `/api/api-keys/:id` | Delete API key |
| `POST` | `/api/api-keys/validate` | Validate API key (5 req/min) |

## Benchmarks (SLOs)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/benchmarks` | List benchmarks |
| `GET` | `/api/benchmarks/:id` | Get single benchmark |
| `GET` | `/api/benchmarks/system/:id/config-options` | Available envs/workloads |
| `POST` | `/api/benchmarks` | Create benchmark |
| `PUT` | `/api/benchmarks/:id` | Update benchmark |
| `DELETE` | `/api/benchmarks/:id` | Delete benchmark |

## Grafana

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/grafana-instances` | List Grafana instances |
| `POST` | `/api/grafana-instances` | Create instance |
| `POST` | `/api/grafana-instances/test-connection` | Test connection |
| `PATCH` | `/api/grafana-instances/:id` | Update instance |
| `DELETE` | `/api/grafana-instances/:id` | Delete instance |

## Related

- [[API Overview]]
- [[API Authentication]] — Auth requirements per endpoint
