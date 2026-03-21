---
aliases:
  - Schema
  - Database Schema
tags:
  - database
---

# Schema Overview

Perfana uses PostgreSQL with TimescaleDB extension for time-series data. All entities use `organization_id` for multi-tenant isolation.

## Entity Relationship Overview

```
Organization (1) ──▶ (N) Team
                 ──▶ (N) SystemUnderTest
                 ──▶ (N) GrafanaInstance
                 ──▶ (N) DynatraceConfig
                 ──▶ (N) ApiKey

SystemUnderTest (1) ──▶ (N) TestRun (by system/env/workload)
                    ──▶ (N) ApplicationDashboard
                    ──▶ (N) Benchmark

TestRun (1) ──▶ (N) TestRunConfiguration
           ──▶ (N) DsMetrics
           ──▶ (N) DsMetricStatistics
           ──▶ (N) DsAdaptResults
           ──▶ (N) CheckResults
           ──▶ (N) CompareResults

ApplicationDashboard (1) ──▶ (N) DsMetrics (panel linkage)
```

## Core Entities

### Organization & Access

| Entity | Description |
|---|---|
| `Organization` | Multi-tenant isolation boundary |
| `Team` | Group within organization |
| `TeamMember` | User ↔ Team membership |
| `OrganizationMember` | User ↔ Organization membership |
| `ApiKey` | Programmatic access tokens |
| `AuditLog` | CRUD operation audit trail |

### Test Domain

| Entity | Description |
|---|---|
| `SystemUnderTest` | Application/service being tested |
| `TestRun` | Individual performance test execution |
| `TestRunConfiguration` | Key-value config attached to test run |
| `Benchmark` | SLO/performance threshold definition |
| `Profile` | Named collection of dashboards + benchmarks |
| `ProfileGrafanaDashboard` | Dashboard linked to profile |
| `ProfileBenchmark` | Benchmark linked to profile |

### Data Science

| Entity | Table | Description |
|---|---|---|
| `DsMetrics` | `ds_metrics` | Time-series metrics (**TimescaleDB hypertable**) |
| `DsMetricStatistics` | `ds_metric_statistics` | Aggregated stats (p50, p95, p99, min, max) |
| `DsAdaptResults` | `ds_adapt_results` | ADAPT algorithm analysis results |
| `DsAdaptConclusion` | `ds_adapt_conclusions` | ADAPT conclusion summaries |
| `DsAdaptTrackedResults` | — | Tracked ADAPT results over time |
| `DsControlGroups` | `ds_control_groups` | Baseline test run groupings |
| `DsControlGroupStatistics` | — | Control group aggregate stats |
| `DsChangePoints` | `ds_change_points` | Performance regime shifts |
| `DsMetricClassification` | — | Metric importance classification |
| `DsCompareConfig` | — | Comparison configuration |
| `DsTrackedDifferences` | — | Identified regressions |
| `DsMetricCollectionStatus` | — | Incremental collection tracking |

### Evaluation Results

| Entity | Table | Description |
|---|---|---|
| `CheckResults` | `check_results` | SLO threshold compliance (absolute checks) |
| `CompareResults` | `compare_results` | Baseline comparison (regression detection) |

### Integrations

| Entity | Description |
|---|---|
| `GrafanaInstance` | Grafana server connection |
| `ApplicationDashboard` | Dashboard config per application |
| `DynatraceConfig` | Dynatrace connection config |
| `DynatraceQuery` | Dynatrace metric queries |
| `DynatraceEntityMapping` | Entity ID mappings |
| `TracingInstance` | Tracing backend (Tempo) connection |
| `PyroscopeInstance` | Pyroscope profiling connection |

### Reporting & Links

| Entity | Description |
|---|---|
| `ReportTemplate` | Report template definitions |
| `GeneratedReport` | Generated PDF reports |
| `DeepLink` | Deep links to external tools |
| `GenericDeepLink` | Template-based deep links |
| `UrlPattern` | URL pattern definitions |

### UI Presets

| Entity | Description |
|---|---|
| `CompareFilterPreset` | Saved comparison filter configs |
| `TrendsFilterPreset` | Saved trend analysis presets |
| `Event` | System events |
| `NotificationChannel` | Alert channels |

## Key Indexes

- Composite index on `(system_under_test_id, test_environment, workload)` for test run lookups
- Time-based indexes on `ds_metrics` for time-series queries
- `organization_id` on all tenant-scoped tables

## Key Constraints

- `ds_adapt_results`: Unique on `(test_run_id, control_group_id, application_dashboard_id, panel_id, metric_name)`
- Row-Level Security policies on all multi-tenant tables

## Related

- [[TimescaleDB]] — Time-series storage details
- [[Migrations]] — Migration workflow
- [[Multi-tenancy]] — Organization scoping
