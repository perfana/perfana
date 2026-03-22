# Phase 3.7: MetricsSource Deprecation & Cleanup — Detailed Plan

## Problem Statement

Perfana forces all metrics sources through artificial `GrafanaDashboard` + `ApplicationDashboard` records. Dynatrace and performance-test metrics create fake dashboards with magic UID prefixes (`dynatrace-`, `performance-test-metrics-`). The frontend filters these out; config lookup is keyed by `application_dashboard_id`.

Phase 3.1–3.6 added `MetricsSource` as the proper abstraction with `source_type` discriminator, dual-write on all tables, and `metrics_source_id` in all API responses. **Both columns coexist and work.**

Phase 3.7 completes the strangler fig: stop creating artificial dashboards for new data, replace prefix-based filtering with `source_type`, and deprecate old endpoints.

## Hard Constraints

1. **`application_dashboard_id` stays on `ds_metrics` forever** — PK + TimescaleDB compression segmentby
2. **Both columns populated on every INSERT** — ON CONFLICT key unchanged
3. **Fan-out problem**: 7 MetricsSources are shared by 2 ApplicationDashboards each (same Grafana template, different labels like "JVM afterburner-be" vs "JVM afterburner-fe"). COALESCE JOINs between tables keyed by `application_dashboard_id` cause cross-product.
4. **`ds_compare_config` is keyed by `application_dashboard_id`** at the dashboard level — 112 config entries, all at `(application_dashboard_id, panel_id)` granularity.

## Fan-Out Root Cause

```
MetricsSource (template level)          ApplicationDashboard (instance level)
┌─────────────────────────┐     ┌─────────────────────────────────────┐
│ JVM                     │────>│ JVM afterburner-be (label)          │
│ uid: spring-boot-jvm    │     │ dashboard_uid: spring-boot-jvm      │
│ source_type: grafana    │────>│ JVM afterburner-fe (label)          │
└─────────────────────────┘     └─────────────────────────────────────┘
```

MetricsSource deduplicates by `(sut, env, source_type, external_ref, display_name)`.
ApplicationDashboard deduplicates by `(sut, env, grafana_instance, dashboard_uid, dashboard_label)`.

The `dashboard_label` is the distinguishing dimension that MetricsSource doesn't capture. This is intentional — MetricsSource represents "which dashboard template", while ApplicationDashboard represents "which instance of that template".

**Resolution: Option A (decided in eng review)**
Add `display_label` to MetricsSource unique constraint — creates 1:1 mapping with ApplicationDashboard. Eliminates fan-out permanently.

---

## Sub-Phase Sequencing

### 3.7.1 — Fix MetricsSource Granularity (prerequisite for everything else)

**Decision needed:** Should MetricsSource be 1:1 with ApplicationDashboard or 1:N?

If 1:1 (Option A — recommended):
- Add `display_label` to the unique constraint
- Re-backfill: one MetricsSource per ApplicationDashboard (not per template)
- Eliminates fan-out problem entirely
- All JOINs can safely use `metrics_source_id`

If 1:N (Option C — current state):
- MetricsSource stays at template level
- JOINs stay on `application_dashboard_id`
- `metrics_source_id` is only used for `source_type` discrimination in the frontend
- Less work, but the strangler fig is never completed

### 3.7.2 — Migrate ds_compare_config to metrics_source_id

**Depends on:** 3.7.1 (1:1 resolution)

- Add `metrics_source_id` column to `ds_compare_config`
- Migration: populate from ApplicationDashboard forward link
- Update config cache loader (`compare-config-cache.ts`) to load by `metrics_source_id`
- Update `temp_config_cache` table structure to include `metrics_source_id`
- Update config JOINs in ADAPT SQL to use `metrics_source_id`

**Rollback:** Revert to `application_dashboard_id` JOINs (current state).

### 3.7.3 — ADAPT SQL JOINs switch to metrics_source_id

**Depends on:** 3.7.2 (config migrated)

- `sql-builder.ts`: control group JOIN uses `metrics_source_id`
- `tracked-results-sql-builder.ts`: same
- `control-group-processor.ts`: same
- Re-run golden-file tests to verify identical output

**Risk:** This is where the Phase 3.6 COALESCE bug happened. With 1:1 granularity, the fan-out is eliminated, so it should work. Golden-file tests are the safety net.

### 3.7.4 — Frontend: Replace prefix filtering with source_type

**Depends on:** Nothing (can run in parallel with 3.7.2-3.7.3)

Files with `// TODO Phase 3.7` comments:
1. `apps/web/app/test-runs/[id]/components/graphs/hooks/useGraphsData.ts`
2. `apps/web/app/test-runs/[id]/components/graphs/utils/graph-config.ts`
3. `apps/web/app/test-runs/[id]/components/trends/hooks/useTrendsData.ts`
4. `apps/web/app/test-runs/[id]/components/compare/hooks/useCompareData.ts`
5. `apps/web/app/test-runs/[id]/components/dashboards/hooks/useDashboardsData.ts`
6. `apps/web/app/systems/[id]/config/components/add-slo/hooks/useAddSLOForm.ts`

**Change:** Replace `dashboardUid.startsWith('dynatrace-')` and `dashboardUid.startsWith('performance-test-metrics-')` with checks on `source_type` from the MetricsSource (available via the API's `metrics_source` enrichment or the `MetricsSource` type added in Phase 3.5).

**Prerequisite:** The API must return `source_type` in ApplicationDashboard responses. Currently it doesn't — need to add `source_type` from the linked MetricsSource.

### 3.7.5 — Stop creating synthetic GrafanaDashboard records (revised in eng review)

Make `grafana_instance_id` and `grafana_dashboard_id` nullable on `application_dashboards`.
Non-Grafana sources create ApplicationDashboard directly with NULL Grafana columns.
No more synthetic `grafana_dashboards` rows with fake 800000/900000 IDs.

**Migration:**
- ALTER TABLE application_dashboards ALTER COLUMN grafana_instance_id DROP NOT NULL
- ALTER TABLE application_dashboards ALTER COLUMN grafana_dashboard_id DROP NOT NULL
- Add partial unique index for non-Grafana dedup

**Code changes:**
- `dashboard-manager.ts`: create ApplicationDashboard directly (no GrafanaDashboard)
- `dynatrace-dashboard-manager.ts`: same
- `PanelsPipeline.ts`: skip grafana_dashboard lookup when grafana_dashboard_id is NULL
- API service: already handles NULL via LEFT JOIN

**Existing data:** Untouched. Old synthetic GrafanaDashboard rows remain valid.
**New data:** Clean — no fake Grafana records from day one.

### 3.7.6 — API deprecation (optional, low priority)

- Add `@Deprecated` Swagger decorator to `/application-dashboards` endpoints
- Add `X-Deprecated` response header
- Log usage for tracking

---

## Dependency Graph

```
3.7.1 (Fix granularity)
 └──> 3.7.2 (Config migration)
       └──> 3.7.3 (ADAPT JOINs)
             └──> 3.7.5 (Stop creating artificial dashboards)

3.7.4 (Frontend prefix → source_type)  ← runs in parallel with 3.7.2/3.7.3
       └──> 3.7.5 (depends on frontend being ready)

3.7.6 (API deprecation) ← independent, low priority
```

## Risk Assessment

| Sub-phase | Risk | Mitigation |
|-----------|------|------------|
| 3.7.1 | Re-backfill changes MetricsSource count (12 → ~19) | Migration is additive, old IDs preserved |
| 3.7.2 | Config lookup breaks if migration is partial | Transaction + verify counts |
| 3.7.3 | ADAPT produces different results | Golden-file tests (53 SQL + 894 real data) |
| 3.7.4 | Frontend breaks for edge-case dashboards | Fallback: if no source_type, use prefix detection |
| 3.7.5 | Old code paths still reference ApplicationDashboard | Keep creating them (Option C) |

## Estimated Effort

| Sub-phase | Human team | CC+gstack |
|-----------|-----------|-----------|
| 3.7.1 (granularity fix) | 1 day | 20 min |
| 3.7.2 (config migration) | 2 days | 30 min |
| 3.7.3 (ADAPT JOINs) | 1 day | 15 min |
| 3.7.4 (frontend cleanup) | 1 day | 15 min |
| 3.7.5 (stop artificial dashboards) | 2 days | 30 min |
| 3.7.6 (API deprecation) | 0.5 day | 10 min |
| **Total** | **~1.5 weeks** | **~2 hours** |
