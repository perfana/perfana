---
tags:
  - feature
---

# Templates

Perfana uses templates for standardizing performance checks, reports, and dashboard configurations across organizations.

## Template Types

### Report Templates
- Define HTML/CSS layout for PDF performance reports
- Stored as `ReportTemplate` entities
- Used by [[Perfana Report Overview]] for PDF generation
- Can include dynamic sections with metric data

### Performance Profiles
Profiles bundle together dashboard configurations and benchmarks:

```
Profile
├── ProfileGrafanaDashboard (which dashboards to monitor)
└── ProfileBenchmark (which SLOs to check)
```

**Usage**: When a test run initializes, it inherits the profile's dashboards and benchmarks for automatic monitoring.

### Dashboard Templates

Grafana dashboard templates that can be propagated across multiple systems:

- Template dashboards defined once
- `UpdateDashboardsService` propagates changes
- Batch processing (20 dashboards per batch)
- Managed by [[Grafana Sync Overview]]

## Template Management UI

Accessible at `/settings/profiles`:

- **Profile list** — View all performance profiles
- **Profile editor** (`/settings/profiles/[id]`):
  - Dashboard configuration tab
  - SLO/benchmark configuration tab
  - Deep links configuration tab

### Template Section Builder
- Drag-and-drop section ordering
- Configurable metric selections
- Preview functionality for report sections

### Template Selector
- Filtered by `system_under_test_id`
- Organization-scoped templates
- Quick template application to test runs

## Batch Operations

- **Batch delete** — Remove multiple templates
- **Template propagation** — Push template changes to all linked dashboards
- **Re-evaluation** — Re-run checks when benchmarks change

## Related

- [[Perfana Report Overview]] — PDF report generation
- [[Grafana Sync Overview]] — Dashboard template sync
- [[Schema Overview]] — Template entities
