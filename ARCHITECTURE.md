# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
│  Browser (Next.js)  │  CI/CD (API keys)  │  Load Test Tools     │
└────────┬────────────┴─────────┬──────────┴──────────┬───────────┘
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NestJS API (port 3001)                        │
│                                                                  │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌──────────────┐ │
│  │   Auth   │  │ Test Runs │  │ Integrations│  │   Reports    │ │
│  │  Guard   │  │  Module   │  │   Module    │  │   Module     │ │
│  └──────────┘  └─────┬─────┘  └──────┬─────┘  └──────────────┘ │
│                      │               │                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Service Layer (business logic)               │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │                                        │
│  ┌──────────────────────┴───────────────────────────────────┐   │
│  │           TypeORM Repositories (@perfana/db)              │   │
│  └──────────────────────┬───────────────────────────────────┘   │
└─────────────────────────┼───────────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
┌──────────────┐  ┌─────────────┐  ┌─────────────┐
│  PostgreSQL  │  │    Redis    │  │  Keycloak   │
│ (TimescaleDB)│  │  (BullMQ)   │  │   (Auth)    │
└──────┬───────┘  └──────┬──────┘  └─────────────┘
       │                 │
       │                 ▼
       │         ┌───────────────┐
       │         │  BullMQ Worker│
       │         │               │
       │         │ ┌───────────┐ │
       └─────────┤ │ Pipeline  │ │
                 │ │ Registry  │ │
                 │ ├───────────┤ │
                 │ │ Metrics   │ │
                 │ │ Statistics│ │
                 │ │ ADAPT     │ │
                 │ │ Checks    │ │
                 │ │ ...       │ │
                 │ └───────────┘ │
                 └───────────────┘

External Data Sources:
  ┌──────────┐ ┌───────────┐ ┌────────────┐ ┌──────────┐ ┌─────────┐
  │ Grafana  │ │ Dynatrace │ │ Prometheus │ │ Pyroscope│ │  Tempo  │
  └──────────┘ └───────────┘ └────────────┘ └──────────┘ └─────────┘
```

## Data Flow: Test Run Lifecycle

```
1. INIT                     2. COLLECT                3. ANALYZE
   Load test tool              Worker pipelines          Worker pipelines
   POST /test/init             fetch from Grafana,       run ADAPT algorithm,
   → creates TestRun           Dynatrace, etc.           compute statistics,
   → queues collection         → stores in ds_metrics    check benchmarks
   job in BullMQ               (TimescaleDB hypertable)  → stores results

4. VIEW
   Frontend fetches
   test run + results
   → renders charts
   → shows regressions
```

## Monorepo Structure

```
perfana/
├── apps/
│   ├── api/          NestJS REST API + WebSocket
│   ├── web/          Next.js frontend
│   └── worker/       BullMQ job processor
│
├── packages/
│   ├── db/           TypeORM entities + migrations + repos
│   ├── types/        Shared TS types, DTOs, Zod schemas
│   └── config/       Env validation, TypeORM config, constants
│
└── infra/            Docker Compose for local dev
```

## Entity Domains

Entities in `packages/db/src/entities/` are grouped by domain:

| Domain | Entities | Purpose |
|--------|----------|---------|
| core/ | Organization, Team, OrganizationMember, TeamMember, ApiKey, AuditLog | Multi-tenancy and access control |
| testing/ | SystemUnderTest, TestRun, TestRunConfiguration, TestRunView, Benchmark, Profile, ProfileBenchmark | Test execution and configuration |
| metrics/ | DsMetrics, DsMetricStatistics, DsMetricCollectionStatus, DsPanels, DsTrackedDifferences, SparseMetricExclusion | Time-series metric storage |
| analysis/ | DsAdaptResults, DsAdaptConclusion, DsAdaptTrackedResults, DsCompareConfig, DsControlGroups, DsControlGroupStatistics, DsChangePoints | ADAPT regression detection |
| integrations/ | GrafanaInstance, GrafanaDashboard, ApplicationDashboard, DynatraceConfig, PyroscopeInstance, TracingInstance, + 7 more | External system connectors |
| alerting/ | AlertTagFilter, NotificationChannel, Event, ExpectedConfigChange | Alerts and events |
| reporting/ | ReportTemplate, GeneratedReport, GraphPreset, CompareFilterPreset, TrendsFilterPreset | Reports and presets |

## Worker Pipeline Architecture

```
Job arrives via BullMQ
        │
        ▼
┌───────────────┐
│  Job Handler  │  Validates input, selects pipeline sequence
└───────┬───────┘
        │
        ▼
┌───────────────┐
│   Pipeline    │  Looks up pipelines by name, runs in order
│   Registry    │  Sequence: ['metrics', 'statistics', 'adapt', 'checks']
└───────┬───────┘
        │
        ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   Metrics     │────▶│  Statistics   │────▶│    ADAPT      │────▶ ...
│   Pipeline    │     │   Pipeline    │     │   Pipeline    │
└───────────────┘     └───────────────┘     └───────────────┘
     │                      │                      │
     ▼                      ▼                      ▼
  Result<T,E>           Result<T,E>           Result<T,E>
```

Each pipeline:
- Receives typed input, returns `Result<T, PipelineError>`
- Self-registers via `@Pipeline('name')` decorator
- Has a header comment explaining the algorithm
- Is independently testable

## Authentication Flow

```
Browser → Keycloak login → JWT token → httpOnly cookie
                                              │
API request with cookie ──────────────────────┘
        │
        ▼
┌──────────────────┐
│ KeycloakAuthGuard│  Validates JWT signature + expiry
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    RolesGuard    │  Checks @Roles() decorator (admin/user/guest)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  ThrottlerGuard  │  Rate limiting via Redis
└────────┬─────────┘
         │
         ▼
    Controller handler

Alternative: API key in Authorization header (for CI/CD)
```

## Multi-Tenancy Model

```
Organization (root tenant)
    │
    ├── Team A
    │   ├── SystemUnderTest 1
    │   │   ├── TestRun 1.1
    │   │   └── TestRun 1.2
    │   └── SystemUnderTest 2
    │
    └── Team B
        └── SystemUnderTest 3

Row-Level Security (RLS) at database level ensures tenant isolation.
All queries scoped by organization_id, optionally by team_id.
```
