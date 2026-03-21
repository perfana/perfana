# @perfana/db — Database Entities & Migrations

## Entity Domain Index

| Domain | Path | Count | Key entities | Purpose |
|--------|------|-------|-------------|---------|
| core/ | `entities/core/` | 6 | Organization, Team, ApiKey, AuditLog | Multi-tenancy, RBAC, audit |
| testing/ | `entities/testing/` | 7 | SystemUnderTest, TestRun, Benchmark, Profile | Test execution, SLO config |
| metrics/ | `entities/metrics/` | 6 | DsMetrics, DsMetricStatistics, DsPanels | Time-series storage (TimescaleDB) |
| analysis/ | `entities/analysis/` | 7 | DsAdaptResults, DsCompareConfig, DsControlGroups | ADAPT regression detection |
| integrations/ | `entities/integrations/` | 14 | MetricsSource, GrafanaInstance, DynatraceConfig | External systems + metrics source abstraction |
| alerting/ | `entities/alerting/` | 4 | AlertTagFilter, NotificationChannel, Event | Alerts, events, notifications |
| reporting/ | `entities/reporting/` | 7 | ReportTemplate, GeneratedReport, GraphPreset | Reports, presets, filters |

Each domain has an `index.ts` barrel export. Top-level: `entities/index.ts` re-exports all domains.

## MetricsSource (Key Abstraction)

`MetricsSource` replaces the original "ApplicationDashboard" pattern. It's the universal adapter for all metric data sources:

| source_type | source_config_id → | external_ref | Example |
|-------------|-------------------|-------------|---------|
| `grafana` | GrafanaInstance | dashboard UID | "CPU Dashboard" |
| `dynatrace` | DynatraceConfig | entity ID | "Host: web-01" |
| `performance_test` | null | scenario name | "Scenario: checkout" |
| `prometheus` | (future) | query | — |

All downstream entities reference `metrics_source_id` (not `application_dashboard_id`).

## Base Class: OwnedEntity

`core/owned-entity.ts` provides `organization_id`, `team_id`, `created_by`, `created_at`, `updated_at`. Extend for org-scoped entities.

## Adding an Entity

1. Create `entities/{domain}/{name}.entity.ts` with TypeORM decorators
2. Export from `entities/{domain}/index.ts`
3. Run `pnpm migration:generate` to create migration

## Utilities

| File | Purpose |
|------|---------|
| `utils/encryption.ts` | AES-256-GCM encryption for credential storage |
| `utils/encrypted-column.transformer.ts` | TypeORM column transformer for transparent encryption |
| `utils/url-column.transformer.ts` | URL normalization transformer |
