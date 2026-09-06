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
| `GET` | `/api/test-runs/:id/analysis-time-range/scope` | Read-only preview of an `applyToAll` change: how many runs of this run's system/environment/workload would take the offsets, and which are skipped and why (`?analysisStartOffset=&analysisEndOffset=`) |
| `PUT` | `/api/test-runs/:id/analysis-time-range` | Set the ramp-up/ramp-down offsets. `applyToAll: true` writes them across the whole workload and re-evaluates it — capped at 100 runs, refused (400) past that. See [[ADAPT Algorithm]] for why the window has to match across a control group |

### Metrics

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/test-runs/:id/stats` | Transaction statistics |
| `GET` | `/api/test-runs/:id/samples` | Transaction samples |
| `GET` | `/api/test-runs/:id/timeseries` | Time series metrics |
| `GET` | `/api/test-runs/:id/virtual-users` | Virtual user statistics |
| `GET` | `/api/test-runs/:id/throughput` | Throughput metrics |
| `GET` | `/api/test-runs/:id/aggregated-metric-timeseries` | Time series aggregated across runs (`?metric=&testRunIds=csv`) |
| `GET` | `/api/test-runs/:id/aggregated-metric-statistic` | One statistic aggregated across runs (`?metric=&stat=&testRunIds=csv`) |
| `GET` | `/api/test-runs/:id/url-metric-statistics` | Per-URL statistics across runs, for the Compare card (`?metric=&testRunIds=csv`) |
| `GET` | `/api/test-runs/:id/url-distinct-names` | Distinct normalized URLs seen in the run |
| `GET` | `/api/test-runs/:id/sampler-url-map` | Sampler name to normalized URL mapping |

The endpoints taking `testRunIds` read it as a comma-separated list through one shared parser,
`apps/api/src/modules/test-runs/controllers/parse-test-run-ids.ts`. Its `MAX_AGGREGATED_TEST_RUNS`
is **500 distinct** runs per request, de-duplicated before the count is taken; omitted entirely
means "just the run in the path". Oversized requests are rejected with 400 rather than truncated —
a silently shortened list returns an aggregate that looks complete but omits runs.

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

## Analysis jobs (`/api/data`)

Job control for the worker pipelines. Only the endpoints referenced elsewhere in these docs are
listed; the full `/api/data` surface (batch refresh, batch re-evaluate, job status and progress,
active-job locks) is in Swagger.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/data/analyzeTest/:testRunId` | Run the full analysis pipeline for a test run |
| `POST` | `/api/data/recalculate-statistics/:testRunId` | Recompute `ds_metric_statistics` from stored `ds_metrics` — no datasource fetch. The escape hatch when [[ADAPT Algorithm]] cannot build a baseline; apply it to the **baseline** run |
| `GET` | `/api/data/jobs/:jobId/status` | Job status |
| `GET` | `/api/data/jobs/:jobId/progress` | Job progress |

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

## Reports

Generation is queued on a worker; poll the download endpoint. Full pipeline recipe:
[[Reports in CI-CD]].

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/reports` | List generated reports |
| `GET` | `/api/reports/test-run/:testRunId` | Reports for a test run (accepts the human id or the UUID) |
| `GET` | `/api/reports/test-run/:testRunId/summary` | Report counts for a test run |
| `POST` | `/api/reports/generate` | Generate from a template (`template_id`, `template_name`, or the scope default) |
| `POST` | `/api/reports/generate/ad-hoc` | Generate from inline sections (max 20, `name` required) |
| `POST` | `/api/reports/preview-section` | Render one section for the builder preview |
| `GET` | `/api/reports/:reportId` | Report metadata and status |
| `DELETE` | `/api/reports/:reportId` | Delete report |
| `POST` | `/api/reports/:reportId/pdf` | Queue PDF rendering |
| `GET` | `/api/reports/:reportId/html/download` | Download HTML (202 while generating) |
| `GET` | `/api/reports/:reportId/pdf/download` | Download PDF (auto-queues on first request) |
| `POST` | `/api/reports/:reportId/retry` | Retry a failed generation |
| `GET` | `/api/reports/:reportId/share` | Read share settings |
| `PUT` | `/api/reports/:reportId/share` | Update share settings |
| `GET` | `/api/reports/share/:shareId` | Public shared report |
| `GET` | `/api/reports/share/:shareId/pdf` | Public shared PDF |

### Report templates

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/report-templates` | List templates |
| `GET` | `/api/report-templates/summaries` | Template summaries |
| `GET` | `/api/report-templates/default` | Default template for a scope |
| `POST` | `/api/report-templates` | Create template |
| `POST` | `/api/report-templates/copy` | Copy a template into another scope |
| `GET` | `/api/report-templates/:templateId` | Get template |
| `PUT` | `/api/report-templates/:templateId` | Update template |
| `DELETE` | `/api/report-templates/:templateId` | Delete template |
| `POST` | `/api/report-templates/:templateId/duplicate` | Duplicate template |
| `PUT` | `/api/report-templates/:templateId/set-default` | Make default for its scope (clears the flag on the others) |
| `POST` | `/api/report-templates/:templateId/sections` | Append a section |
| `DELETE` | `/api/report-templates/:templateId/sections/:sectionIndex` | Remove a section |
| `PUT` | `/api/report-templates/:templateId/sections/reorder` | Reorder sections |

## Related

- [[API Overview]]
- [[API Authentication]] — Auth requirements per endpoint
