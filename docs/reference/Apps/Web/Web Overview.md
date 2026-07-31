---
aliases:
  - Frontend
  - Web App
tags:
  - app/web
---

# Web Overview

The Next.js frontend provides the user interface for Perfana — a performance analysis dashboard with real-time updates, multi-organization support, and deep integrations.

> [!info] Location
> `apps/web/` — Runs on port **3000** (dev: 4001) — Next.js 15 with App Router

## Architecture

- **Framework**: Next.js 15.5.9 (App Router)
- **UI Library**: Material-UI (MUI) 7.3 + Tailwind CSS
- **State Management**: React Context + React Query + WebSocket
- **Forms**: React Hook Form + Zod validation
- **Charts**: Recharts + Plotly.js
- **Auth**: Keycloak.js (OpenID Connect)

## Layout Hierarchy

```
RootLayout
├── MUIThemeProvider
├── Providers (React Query)
├── AuthProvider (Keycloak)
├── OrganizationProvider
├── SidebarProvider
└── AuthLayout (sidebar + header)
    └── {page content}
```

## Routes

### Core Pages

| Route | Description |
|---|---|
| `/` | Dashboard — KPIs, recent failures, systems summary |
| `/signin` | Keycloak sign-in page |
| `/test-runs` | Test runs list with filters, batch ops, real-time status |
| `/test-runs/[id]` | Test run detail — 3-tab layout (see below) |

### Test Run Detail Tabs

**Results Tab**:
- Test run details and configuration
- Dashboard metrics and SLOs
- Anomaly detection results
- Performance analysis

**Root Cause Analysis Tab**:
- Dynatrace service/host analysis
- Distributed tracing
- Pyroscope profiling
- AWR reports
- Deep links to external tools

**Reporting Tab**:
- Report generation and download
- Trend analysis
- Test run comparison
- Graph visualizations

### Settings

| Route | Description |
|---|---|
| `/settings` | API keys, general settings |
| `/settings/organizations` | Organization management |
| `/settings/organizations/[id]` | Org details and members |
| `/settings/teams` | Team management |
| `/settings/teams/[id]` | Team details and members |
| `/settings/profiles` | Performance profiles (benchmarks, dashboards) |
| `/settings/profiles/[id]` | Profile editor |

### Other Pages

| Route | Description |
|---|---|
| `/systems` | Systems under test |
| `/systems/[id]/config` | System configuration |
| `/integrations` | Grafana, Dynatrace, Pyroscope, Tracing |
| `/reports/share/[shareId]` | Shared report viewer |

## Key Components

### Dashboard
- `StatisticsCards` — KPI cards (total tests, pass/fail, SLO compliance)
- `RecentFailuresTable` — Failed test runs table
- `SystemsSummaryGrid` — Systems overview cards
- `TimePeriodSelector` — Time range filter

### Test Runs
- `TestRunsTable` — Main data table (running/completed variants)
- `TestRunsFilters` — System/environment/workload filters
- `BatchActionsToolbar` — Bulk operations toolbar
- `TestRunStatusChip` — Status badge component

### Reports
- `MarkdownField` — Text block editor: formatting toolbar over a live preview (see [[Templates]])

### Layout
- `AuthLayout` — Main layout with sidebar + header
- `Sidebar` — Navigation with org selector
- `Header` — Top navigation bar

### Integration Dialogs
- `GrafanaFormDialog` — Grafana instance config
- `DynatraceFormDialog` — Dynatrace config
- `PyroscopeFormDialog` — Pyroscope config
- `TracingFormDialog` — Distributed tracing config

## State Management

See [[Web State Management]] for details on the hybrid Context + React Query approach.

## Related

- [[Web State Management]] — State management details
- [[Architecture Overview]]
- [[API Overview]] — Backend API
