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
| `markdown.ts` | Markdown subset renderer for report text blocks (`renderMarkdown`, `renderPlainText`, `TEXT_BLOCK_MARKDOWN_DEFAULT`) |

> [!note] Why `markdown.ts` lives in shared
> Two places must agree on the output structure: the API renders text blocks into
> the report HTML/PDF, and the web editor renders the live preview next to the
> input. A second implementation would drift. It escapes the source before
> emitting its first tag, so no author HTML survives and no sanitizer dependency
> is needed. Supported: headings, bold, italic, inline code, links, bullet and
> ordered lists, paragraphs. Not supported: tables, images, blockquotes, nested
> lists, nested emphasis, `_underscore_` emphasis (metric names are full of
> underscores). Typography is not shared — `styled: true` (the default) bakes the
> print-oriented inline styles the PDF needs; the web preview passes
> `styled: false` and styles the tags via the theme so it reads in dark mode.

## Database Configuration

`config/typeorm.config.ts` — PostgreSQL connection setup, entity registration, migration configuration, connection pooling, logging.

## Related

- [[Schema Overview]] — Entity relationships
- [[Config Package]] — Shared TypeScript config
