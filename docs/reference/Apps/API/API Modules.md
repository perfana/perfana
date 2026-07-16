---
aliases:
  - Modules
tags:
  - app/api
  - reference
---

# API Modules

Detailed documentation of the 32 NestJS modules in the API.

## Test Runs Module (Most Complex)

The largest module, split into multiple controllers and services for separation of concerns.

### Controllers (7)

| Controller | Responsibility |
|---|---|
| `TestRunsController` | Core CRUD operations |
| `TestRunsAnalysisController` | Anomalies, changepoints, ADAPT, classifications |
| `TestRunsMetricsTransactionController` | Transaction stats, timeseries, throughput |
| `TestRunsMetricsApdexController` | Apdex thresholds and baseline config |
| `TestRunsComparisonController` | Test run comparison and config changes |
| `TestRunsDashboardController` | Dashboard statistics and summaries |
| `TestRunsErrorsController` | Error analysis and grouped statistics |
| `InitController` | Test run initialization |
| `ConfigController` | Test configuration CRUD |

### Services (15+)

| Service | Responsibility |
|---|---|
| `TestRunsService` | Main facade — delegates to sub-services |
| `TestRunsQueryService` | Read operations |
| `TestRunsMutationService` | Write operations |
| `TestRunsCrudQueryService` | Basic CRUD queries |
| `TestRunsDashboardQueryService` | Dashboard statistics |
| `TestRunsPerformanceQueryService` | Performance metrics |
| `TestRunsTimeSeriesQueryService` | Time-series data |
| `TestRunsMetricsService` | Metric calculations |
| `TestRunsApdexService` | Apdex scoring |
| `TestRunsAnomalyService` | Anomaly detection |
| `TestRunsChangepointService` | Changepoint analysis |
| `TestRunsErrorAnalysisService` | Error analysis |
| `TestRunsConfigService` | Configuration management |
| `CreateTestRunHandler` | Test run creation logic |
| `UpdateTestRunHandler` | Test run update logic |
| `DeleteTestRunHandler` | Test run deletion logic |

### WebSocket Gateway

`TestRunsGateway` — Socket.IO gateway for real-time test run updates:
- `testRunCreated` event
- `testRunUpdated` event
- `testRunDeleted` event
- `WebSocketAuthGuard` for connection authentication

## Benchmarks Module

SLO/benchmark definition and evaluation.

### Services
| Service | Responsibility |
|---|---|
| `BenchmarksService` | Main service |
| `BenchmarkQueryService` | Read operations |
| `BenchmarkMutationService` | Write operations |
| `BenchmarkCalculatorService` | Evaluation logic |

## Auth Module

Keycloak integration and user management.

### Services
| Service | Responsibility |
|---|---|
| `KeycloakJwtService` | JWT token handling and validation |
| `KeycloakAdminService` | Keycloak Admin API integration |

## Grafana Module

Full Grafana integration suite.

### Services
| Service | Responsibility |
|---|---|
| `GrafanaInstancesService` | Instance CRUD and connection testing |
| `GrafanaClientService` | Grafana REST API client |
| `GrafanaDashboardsService` | Dashboard CRUD |
| `ApplicationDashboardsService` | App-specific dashboard config |

## Trace Analysis Module

Distributed trace analysis with span aggregation.

### Services
| Service | Responsibility |
|---|---|
| `TraceAnalysisService` | Main trace analysis facade |
| `TraceAnalyzerService` | Analysis logic |
| `TraceQueryService` | Trace data queries |
| `HierarchyBuilderService` | Span hierarchy construction |
| `SpanAggregationService` | Span metric aggregation |

## Data Science Module

ML features and job management.

### Services
| Service | Responsibility |
|---|---|
| `BullMQClientService` | Job enqueue interface |
| `JobProgressService` | Real-time job progress tracking |

## Common Module

Shared services used across modules.

### Key Providers
| Provider | Responsibility |
|---|---|
| `AuthorizationService` | Centralized permission checking with Redis caching |

## Related

- [[API Overview]]
- [[API Endpoints]]
- [[API Authentication]]
