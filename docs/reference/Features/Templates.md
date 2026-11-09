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

A `ProfileBenchmark` normally points at one `ProfileGrafanaDashboard` and is provisioned onto the application dashboards created from that template. With `source: performance-metrics` (v0.2.96.6) it points at no profile dashboard: `dashboard_uid` holds a regex over the worker-written `Performance test metrics <scenario>` dashboard uids (default `^performance-test-metrics-(?!all-aggregated$|default$)`), and grafana-sync fans it out over every matching scenario dashboard of the system. In the profile SLO dialog this is the **Performance test metrics — every scenario** entry; the same shape works from YAML provisioning (`source: performance-metrics`, `dashboardUid` optional). Mechanics in [[Grafana Sync Overview]] → Auto-Configuration.

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
  - ADAPT templates tab (`?tab=adapt-templates`, v0.2.97.57): the profile's compare-config templates, applied only to runs whose tags match the profile. See [[Compare Config Templates]]

### Template Section Builder

One dialog, `GenerateReportDialog`: **Generate Report** on a test run's Reporting tab, and **Configure Template Sections** (`mode="template-builder"`) from a system's **Reporting Templates** tab.

- **A section is added by click or by drag.** A click appends it to the end; dragging a row from the section list onto the canvas drops it where a dashed slot shows, above or below the card nearest the dragged row, depending on which half of that card the row's centre is over. Releasing anywhere outside the canvas adds nothing. Dragging from the list is pointer-only, so Enter/Space on a row still adds it (to the end) and the card's keyboard reorder places it from there. The collapsed list's add menu stays click-only. Escape cancels a drag in progress without closing the dialog. Dragging has not been tried on a touch screen: tap a row to add it there. Each card carries a stable key, so a drop into the middle of the list leaves every other card's expanded state and form state with its own section
- **While a drag is in hand the dialog ignores the mouse**, during a keyboard drag too: only the canvas still takes the wheel, and nothing else highlights, opens a tooltip or can pull the list out from under the drag. A keyboard drag shows its keys ("Arrow keys to move, Space to drop, Esc to cancel") in place of "Drag to reorder sections", since nothing else on screen says why the mouse stopped answering. Drag announcements name a section by its title and position rather than an internal id
- The section list is one line per type (fourteen today, so it scrolls in a short dialog), each with a grip and its description on hover. Collapsing the list hands its full width to the canvas and replaces it with a searchable add-section menu
- An empty report offers the **"Executive summary"** and **"Full analysis"** starter layouts rather than a blank canvas; both are freely editable afterwards
- A report composed in the builder holds at most **20 sections** (`MAX_REPORT_SECTIONS` in [[Shared Package]]). The builder enforces the cap and the ad-hoc generate DTO enforces the same number at the API boundary, so the UI cannot offer what the API rejects. At the cap every row says why it is disabled. Templates saved through `POST /api/report-templates` are still capped at 50 sections by their own DTO — a separate, older limit
- Configurable metric selections
- Preview functionality for report sections
- Collapsed section cards summarize their own configuration (header level and text, text-block content, response-time scenario, baseline-run dashboard/panel count) so multiple sections of the same type can be told apart without expanding them
- **Deleting a template keeps the reports made from it.** Their `template_id` becomes NULL (migration 1821) and they stay readable, downloadable and shared. Only regenerating one needs the template, so `POST /reports/:id/retry` answers 400 for those

#### Header sections

**Header Text** is the title on the report's cover page and accepts the same `{perfana-…}` values as prose, while **Header Level** picks that title's heading tag, H1 by default, scaling it down from there. **Section Title** names the summary block under the cover, "Test Run Summary" when blank. A template posted straight to the API may carry the cover title as `config.title`; `config.text` wins when both are set, because the builder form can only see that one.

The summary's **Anomaly Detection** badge reads NO REGRESSIONS only for a run ADAPT actually compared. A run it did not (the first run, a changepoint, nothing comparable) reads NOT EVALUATED, matching the N/A in the Anomaly Detection section.

#### Sharing a report

A report is private when generated. Its row in the Reports card has a share menu: **Create share link** turns on a public link and copies it, and anyone holding that link can read the report without signing in, until someone chooses **Stop sharing**. Turning it back on restores the same link. Changing this needs `test-run:update` on the report's run, so an org viewer can read a report but not publish it. Pipelines are unaffected: `/html/download` and `/pdf/download` take an API key and never need a share link. Reports generated before this default existed keep whatever setting they have, which is on.

#### Percentiles in the Apdex section

The overall and per-scenario **P95** and **P99** are percentiles of the executions in that scope, and so are the ones on the Performance Analysis card. Both read the analysis window, excluding the ramp-up and the ramp-down, or the whole run when the section's option is off. They agree to within a couple of percent rather than exactly, because the report sorts the executions and the card merges t-digests, which are approximate. The section's throughput and virtual-user figures read the same window. When a run is too short for its offsets, the section reads the whole run, as the analysis pipeline does. Against an API older than the card, or while a run's rollup is still being built, the card falls back to the execution-weighted average of the transactions' percentiles and labels it as that. That figure reads lower whenever a slow minority of transactions forms the tail.

#### Comparison sections: pinned baseline, previous run, previous SLO-passing run, or control group

A comparison section's `baselineTestRunId` takes either a specific run, or one of **three** reserved
values — `previous` (`PREVIOUS_RUN_BASELINE`), `previous-successful`
(`PREVIOUS_SUCCESSFUL_RUN_BASELINE`) and `control-group` (`CONTROL_GROUP_BASELINE`), all in
[[Shared Package]]. Both sides must agree on the exact string, so each is declared once.

- **A pinned run** made sense the day the template was written and ages from then on: every nightly report keeps comparing against the same run.
- **`previous`** resolves per report to the most recent **completed** run that started strictly before the reported one, in the same system, environment and workload (ordered by `start_time`) — so a template compares each report against its own predecessor. Offered as "Previous run" at the top of the baseline picker, and documented in Swagger for templates created through the API.
- **`previous-successful`** is the same lookup narrowed to runs whose SLOs passed (`consolidated_result.meetsRequirement` is true). The plain previous run is whatever ran last, failures included, and comparing a still-broken run against one that had already breached its objectives makes the report look flat. Offered as "Previous SLO-passing run".
- **`control-group`** compares against the run's own **control group** — the earlier runs anomaly detection (ADAPT) judges it against — using their pooled statistics in `ds_control_group_statistics`, so the section shows the same "control" values as the Anomaly Detection card. Offered as "Control group". It is never resolved to a run id: the API reads the group the run's latest ADAPT conclusion names (falling back to the group keyed on the run's own id) and pairs series on `(application_dashboard_id, panel_id, metric_name, metrics_source_id)`, the identity anomaly detection compares on (v0.2.97.52), so a series whose metrics source changed since the group's runs gets no baseline here, as it is "incomparable" there. The dashboard ids agree because a control group shares the run's system and environment, which is also why a `dashboardMap` is ignored with it and its editor is hidden. Three things differ from a run baseline: a performance-metrics section with no selection compares **Transaction RT Avg** (panel 101) per transaction, the panel ADAPT reads, rather than raw `transactions` percentiles, which pooling over every member run would make expensive and which anomaly detection does not compare; the synthetic "All aggregated" series and the URL panels have no pooled control rows, so beside series that do pair they are listed with the current value only; and a row graph draws the group's pooled **mean**, in the control rows' own unit, as a flat dashed line (only when the section includes `avg`, and the graph says so when it does not), since a control group has no time series of its own. The section names the group's runs under its heading, because a group is rebuilt on every re-evaluate and a stored report has to say which runs its numbers came from. A run with no control group (a first run, or one whose analysis has not finished) gets an explicit empty state. So does a section in which no row pairs with the group (one selecting only the unpooled series above, or a group whose pooled statistics are missing or held under another metrics source), because baseline-less rows would otherwise all count as within range; when it is the run itself that has no statistics for the section's source, the empty state says that instead.
- All three reserved values sit under a **"Resolved per report"** group at the top of the picker, above the "Specific runs" group. Selecting one is a valid baseline even when the run has no earlier run to pin, so neither the section preview nor the Generate dialog is blocked by an empty candidate list.
- In a report, the shared **Baseline Test Run** picker above the builder shows a value only when every comparison section is on it. With one section pinned and one unset it shows none, because Generate is blocked and re-picking a value already on show fires no change; picking one applies to every section. A new comparison section starts on the shared baseline when exactly one is in use. None of this applies to a template, which has no such picker and may be saved unpinned.
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
- Filtered by system, test environment and workload, excluding ad-hoc templates (`findByScope`)
- Organization-scoped templates
- Quick template application to test runs
- The options (**Start from Scratch** and each template) are real buttons, so a keyboard user can get past this screen
- Reopening the dialog, or changing its system, environment or workload, starts here straight away: it does not wait for the list and does not mount the previous report's builder. A re-render of the test-run page does not restart it, because the fetch is keyed on the scope's strings rather than the object, so a websocket update or a toast leaves the report in progress alone. A template picked just before closing is dropped if it answers after the close
- A stored template opens in its `order` values, which is what the report renders by. The stored array can disagree with them, and the first edit renumbers `order` from the array, so the builder and `TemplateManagementDialog` both sort on load (`sortByOrder`)

## Batch Operations

- **Batch delete** — Remove multiple templates
- **Template propagation** — Push template changes to all linked dashboards
- **Re-evaluation** — Re-run checks when benchmarks change

## Related

- [[Perfana Report Overview]] — PDF report generation
- [[Grafana Sync Overview]] — Dashboard template sync
- [[Schema Overview]] — Template entities
