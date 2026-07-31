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
- Collapsed section cards summarize their own configuration (header level and text, text-block content, response-time scenario, baseline-run dashboard/panel count) so multiple sections of the same type can be told apart without expanding them

#### Text block sections

- Content is written in a **markdown subset** rendered by `markdown.ts` in [[Shared Package]]: headings, bold, italic, inline code, links, bullet and ordered lists. Tables, images, blockquotes and nested lists are not supported. Use `*` for emphasis — `_underscore_` is left literal, because metric names are full of underscores.
- Link targets are allowlisted to `http(s)://`, `mailto:`, `#anchor` and `/relative`. Anything else stays literal text rather than becoming a link.
- A **formatting toolbar** (bold, italic, heading, bullets, numbers, link) sits above a live preview, so an author who does not know markdown can click a button and see the rendered result. Bold, italic and link wrap the current selection; heading and the list buttons prefix every selected line. Sample text is inserted when there is nothing to format, so a click always does something visible, and clicking the same button again strips the markers instead of stacking them. Preview links are inert.
- The **Enable Markdown** switch turns rendering off for a single section, which is the escape hatch for text where a leading `-` or `#` was meant literally. Turning it off hides the toolbar and shows the text verbatim in the preview.
- **Alignment** accepts `left`, `center`, `right` and `justify`; anything else falls back to `left`.
- Text blocks authored before markdown rendering shipped (v0.2.61.102) were pinned to `markdown: false` by a migration, so they keep rendering as plain text. One deliberate difference: the plain-text branch preserves line breaks, which used to collapse. Blocks created from that release on default to markdown on.

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
