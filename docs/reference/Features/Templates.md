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
- **Adding a section is a click** on the section list. Dragging reorders sections once they are on the canvas — it never added them, despite the grip icons the list used to carry
- The section list is one line per type, so all eleven fit without scrolling; each description is on hover. Collapsing the list hands its full width to the canvas and replaces it with a searchable add-section menu
- An empty report offers the **"Executive summary"** and **"Full analysis"** starter layouts rather than a blank canvas; both are freely editable afterwards
- A report composed in the builder holds at most **20 sections** (`MAX_REPORT_SECTIONS` in [[Shared Package]]). The builder enforces the cap and the ad-hoc generate DTO enforces the same number at the API boundary, so the UI cannot offer what the API rejects. At the cap every row says why it is disabled. Templates saved through `POST /api/report-templates` are still capped at 50 sections by their own DTO — a separate, older limit
- Configurable metric selections
- Preview functionality for report sections
- Collapsed section cards summarize their own configuration (header level and text, text-block content, response-time scenario, baseline-run dashboard/panel count) so multiple sections of the same type can be told apart without expanding them

#### Comparison sections: pinned baseline, previous run, or previous SLO-passing run

A comparison section's `baselineTestRunId` takes either a specific run, or one of **two** reserved
values — `previous` (`PREVIOUS_RUN_BASELINE`) and `previous-successful`
(`PREVIOUS_SUCCESSFUL_RUN_BASELINE`), both in [[Shared Package]]. Both sides must agree on the
exact string, so each is declared once.

- **A pinned run** made sense the day the template was written and ages from then on: every nightly report keeps comparing against the same run.
- **`previous`** resolves per report to the most recent **completed** run that started strictly before the reported one, in the same system, environment and workload (ordered by `start_time`) — so a template compares each report against its own predecessor. Offered as "Previous run" at the top of the baseline picker, and documented in Swagger for templates created through the API.
- **`previous-successful`** is the same lookup narrowed to runs whose SLOs passed (`consolidated_result.meetsRequirement` is true). The plain previous run is whatever ran last, failures included, and comparing a still-broken run against one that had already breached its objectives makes the report look flat. Offered as "Previous SLO-passing run".
- Both reserved values sit under a **"Resolved per report"** group at the top of the picker, above the "Specific runs" group. Selecting one is a valid baseline even when the run has no earlier run to pin, so neither the section preview nor the Generate dialog is blocked by an empty candidate list.
- When `previous` resolves to nothing, the run is the first in its scope, and the section says so rather than comparing the run against itself.
- When `previous-successful` resolves to nothing, the section says **which** of three things happened rather than showing one blank empty state: the run is the first for its system, environment and workload; earlier runs exist but none had its SLOs evaluated; or earlier runs were evaluated and none passed. The middle case is kept distinct on purpose — a run that was never evaluated has no `meetsRequirement` key at all, and reporting that as "none passed" would assert a failure that never happened, in a document served unauthenticated over a share link.
- Comparison table values are printed **bare**, with the unit shown once as a chip in the heading above the table instead of repeated on every number. A `percentunit` metric is scaled on the way out, so `0.42` reads as `42%`. When the rows under one heading do not all share a unit — rows pair on dashboard/panel/metric name, which excludes the unit — no unit is claimed at all rather than one row's implied over the rest. The compare card's panel header follows the same rule, so a panel is not described one way in the report and another in the card it was previewed from.

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
