# Expand Grafana repeating panels into per-value panels

**Date:** 2026-07-15
**Status:** Approved

## Problem

Grafana dashboards can mark a panel with `repeat: "<var>"` (e.g. `repeat: "host"`),
so Grafana renders one panel per value of that template variable. Perfana does not
expand these. Today `createPanelDocuments` emits **one** ds_panels row per panel
definition, substitutes the repeat variable to `values[0]` only, and stores the
title verbatim — so a run shows a single `CPU usage for ${host}` panel that only
queries the first host, and the remaining hosts are never collected.

## Goal

For a panel with `repeat: "<var>"`, emit one ds_panels row per value of that
variable (capped), with the variable substituted into the query and the title, and
with each host's metrics kept distinct in `ds_metrics`.

## Key constraints discovered

- Expansion point is a single function: `createPanelDocuments` in
  `apps/worker/src/pipelines/panels/helpers.ts`. The worker reads the **raw** Grafana
  dashboard JSON, so `panel.repeat` is available (grafana-sync's trimmed copy is not used here).
- `ds_metrics` uniqueness key is
  `(test_run_id, application_dashboard_id, panel_id, metric_name, time)`
  (`uniq_ds_metrics_upsert`). **`panel_title` is NOT in the key.**
- `metric_name` is produced by the Grafana **series legend** (`displayNameFromDS` /
  field name) in `packages/shared/src/services/grafana/formatter.ts`, not from the title.
- Deep links to Grafana use the real `panel_id`.
- `ds_panels` has no unique constraint (PK = serial `id`, delete-then-insert per run),
  so multiple rows may share a `panel_id`.
- Both collection paths (incremental `grafana-collector` and `MetricsPipeline`) go through
  `queryPanelData` → `transformGrafanaResponseToMetrics`, and the stored `panel` JSONB
  round-trips to the formatter as `queryResult.panel.panel`.

## Design

In `createPanelDocuments`, wrap the per-panel body in an expansion loop:

1. `repeatVar = panel.repeat`. If unset → behave exactly as today (single doc).
2. `values = appDashboard.variables.find(v => v.name === repeatVar)?.values`.
   If empty → single doc as today.
3. Cap expansion at **20** values; if more, process the first 20 and `log.warn` the overflow.
4. For each `value`:
   - Override `queryVariables[repeatVar] = value` (instead of `values[0]`), then build requests
     → per-value query.
   - Resolve the title by substituting `$var` / `${var}` → `value`.
   - Decide the metric disambiguator:
     - If the repeat var token appears **in the panel's targets** (legend/query) → the returned
       `metric_name` already differs per value → keep real `panel_id`, no prefix.
     - Otherwise (var only in title, or nowhere) → keep real `panel_id` and set a
       `__perfanaMetricPrefix = value` hint on the stored `panel` JSONB.
   - Emit a ds_panels doc with the resolved `panel_title`, the real `panel_id`, and the
     (possibly prefix-hinted) `panel` JSONB.

In `formatter.ts` (`transformPanelData` → `convertToLongFormat`): if the panel JSONB carries
`__perfanaMetricPrefix`, prepend it to every `metric_name` (`"<value> - <metric_name>"`). This
keeps `(panel_id, metric_name)` unique per value without minting synthetic panel_ids, so deep
links stay valid.

`panel_id` is always the real Grafana id. No synthetic ids, no migration, no ds_panels schema change.

## Scope

- `apps/worker/src/pipelines/panels/helpers.ts` — expansion loop + prefix decision.
- `packages/shared/src/services/grafana/formatter.ts` — apply prefix to metric_name.
- Unit test for the expansion/prefix decision.

## Non-goals

- Benchmarks match on `panel_title`; a benchmark written against the `${host}` template title
  won't match resolved per-host titles. Out of scope (host panels rarely have SLO benchmarks).
- No change to grafana-sync.
