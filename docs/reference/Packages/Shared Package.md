---
aliases:
  - "@perfana/shared"
  - Shared
tags:
  - package
---

# Shared Package

The `@perfana/shared` package is the central repository for domain models, types, configurations, and utilities shared across all Perfana services.

> [!info] Location
> `packages/shared/`

## Exports

```typescript
@perfana/shared/entities     // All TypeORM entities
@perfana/shared/types         // TypeScript types
@perfana/shared/config        // Configuration exports
@perfana/shared/repositories  // Custom repository classes
@perfana/shared/database      // Database utilities
@perfana/shared/realtime      // Real-time/Pub-Sub exports
@perfana/shared/constants     // Constants
@perfana/shared/services/grafana  // Grafana service
@perfana/shared/utils         // Utility functions
@perfana/shared/security      // Security helpers
```

## Entities

### Organization & Access
`Organization`, `Team`, `TeamMember`, `OrganizationMember`

### Core Domain
`SystemUnderTest`, `TestRun`, `TestRunConfiguration`, `Benchmark`

### Dashboard & Profile
`ApplicationDashboard`, `Profile`, `ProfileGrafanaDashboard`, `ProfileBenchmark`

### Data Science
- `DsMetrics` — Time-series metrics (TimescaleDB hypertable)
- `DsMetricStatistics` — Aggregated statistics
- `DsAdaptResults`, `DsAdaptConclusion`, `DsAdaptTrackedResults` — ADAPT analysis
- `DsControlGroups`, `DsControlGroupStatistics` — Baseline groups
- `DsChangePoints`, `DsMetricClassification` — Change detection
- `DsCompareConfig`, `DsTrackedDifferences` — Comparisons
- `DsMetricCollectionStatus` — Incremental collection tracking

### Integration
`DynatraceConfig`, `DynatraceQuery`, `DynatraceEntityMapping`, `GrafanaInstance`, `TracingInstance`, `PyroscopeInstance`

### Evaluation
`Benchmark`, `CompareFilterPreset`, `TrendsFilterPreset`

### Reporting & Links
`ReportTemplate`, `GeneratedReport`, `DeepLink`, `GenericDeepLink`, `UrlPattern`

### Infrastructure
`ApiKey`, `AuditLog`, `NotificationChannel`, `Event`

## Types

### Job Progress (`types/job-progress.types.ts`)
- `JobType`: `'analyze' | 'refresh' | 'reevaluate'`
- `JobStatus`: `'waiting' | 'active' | 'completed' | 'failed' | 'stuck' | 'blocked'`
- `JobProgress` — Stage-level and overall progress
- Pipeline stages (9 total, indices 1-9)
- Redis channel/key constants

### Test Run (`types/test-run.types.ts`)
- `ActiveJobInfo`, `TestRunStatus`, `ConsolidatedResult`

### Other Types
- `reports.types.ts` — Report generation types
- `grafana.ts` — Grafana integration types
- `database.types.ts` — Database-specific type mappings
- `keycloak.types.ts` — SSO/identity provider types

## Services

### Grafana Client (`services/grafana/`)
- REST API wrapper with batching support
- Dashboard queries, panel retrieval
- Metric/annotation operations
- Variable expansion

### Realtime Publisher (`realtime/realtime-publisher.service.ts`)
- Redis Pub/Sub wrapper
- Job progress updates
- Real-time event streaming

## Utilities

| Module | Purpose |
|---|---|
| `encryption.ts` | Credential encryption/decryption |
| `url-column.transformer.ts` | TypeORM URL column encryption |
| `encrypted-column.transformer.ts` | Generic field encryption |
| `safe-regex.ts` | Safe regex pattern evaluation |
| `url-validator.ts` | Deep-link URL validation |

## Database Configuration

`config/typeorm.config.ts` — PostgreSQL connection setup, entity registration, migration configuration, connection pooling, logging.

## Related

- [[Schema Overview]] — Entity relationships
- [[Config Package]] — Shared TypeScript config
