---
aliases:
  - Schema
  - Database Schema
tags:
  - database
---

# Schema Overview

Perfana uses PostgreSQL with TimescaleDB extension for time-series data. All entities use `organization_id` for multi-tenant isolation.

## Entity Relationship Overview

```
Organization (1) ──▶ (N) Team
                 ──▶ (N) SystemUnderTest
                 ──▶ (N) GrafanaInstance
                 ──▶ (N) DynatraceConfig
                 ──▶ (N) ApiKey

SystemUnderTest (1) ──▶ (N) TestRun (by system/env/workload)
                    ──▶ (N) ApplicationDashboard
                    ──▶ (N) Benchmark

TestRun (1) ──▶ (N) TestRunConfiguration
           ──▶ (N) DsMetrics
           ──▶ (N) DsMetricStatistics
           ──▶ (N) DsAdaptResults
           ──▶ (N) CheckResults
           ──▶ (N) CompareResults

ApplicationDashboard (1) ──▶ (N) DsMetrics (panel linkage)
```

## Core Entities

### Organization & Access

| Entity | Description |
|---|---|
| `Organization` | Multi-tenant isolation boundary |
| `Team` | Group within organization |
| `TeamMember` | User ↔ Team membership |
| `OrganizationMember` | User ↔ Organization membership |
| `ApiKey` | Programmatic access tokens |
| `AuditLog` | CRUD operation audit trail |

> [!info] `audit_logs` is partitioned
> `audit_logs` is RANGE-partitioned by month on `timestamp`. The consolidated schema ships the
> months that existed when its dump was taken plus **`audit_logs_default`**, a DEFAULT partition
> that accepts any date — nothing at runtime can add partitions, because the app roles hold
> `USAGE` but not `CREATE` on schema `public`, so without the default a write past the last
> shipped month would be rejected and the audit trail would go silently empty.
>
> Every partition has RLS enabled with no policies of its own. The policies live on the parent, so
> parent-routed reads and writes work normally while `SELECT * FROM audit_logs_2026_07` is
> deny-all — without this, a partition is directly readable by any role holding its grants.
>
> A partition does **not** inherit the parent's RLS. One created by hand comes out with
> `relrowsecurity = false` while the schema-wide `GRANT ON ALL TABLES` already applies to it, so it
> needs `ENABLE` + `FORCE ROW LEVEL SECURITY` immediately — and attaching it makes Postgres
> full-scan `audit_logs_default` under ACCESS EXCLUSIVE to prove no row belongs to the incoming
> range, which blocks audit writes for the duration.
>
> Retention is `AuditRetentionManager` in the worker: a nightly `DELETE` of rows past
> `AUDIT_RETENTION_MONTHS` (default 24), in batches of 10k. Not `DROP TABLE` — that needs table
> ownership the worker's `perfana_system` role does not have.

### Test Domain

| Entity | Description |
|---|---|
| `SystemUnderTest` | Application/service being tested |
| `TestRun` | Individual performance test execution |
| `TestRunConfiguration` | Key-value config attached to test run |
| `Benchmark` | SLO/performance threshold definition |
| `Profile` | Named collection of dashboards + benchmarks |
| `ProfileGrafanaDashboard` | Dashboard linked to profile |
| `ProfileBenchmark` | Benchmark linked to profile |
| `ProfileSeriesGroupingRule` | Series grouping rule on a profile dashboard (`profile_series_grouping_rules`, migration 1826); grafana-sync provisions it into `series_grouping_rules` |
| `TestRunComment` | Comment or reply on a test-run card, optionally anchored to one row or section of it (`test_run_comments`, migration 1827); cascades with the run. A root on the Graphs card can be a numbered marker (`marker_seq`, `marker_time`), and a root on Graphs, Trends or Compare records the card's view in `chart_context` (validated per card by `validateChartContext`). `notified_at` and `notify_after` (migration 1828) are the comment-notification sweep's claim and retry backoff, served by the partial index `idx_test_run_comments_unnotified`. `tag` (migration 1829) is one optional tag per root comment from a fixed vocabulary (`ck_test_run_comments_tag`, roots only by `ck_test_run_comments_tag_root`). `author_kind` (`user` or `agent`, migration 1831) is set by the API from the principal, `agent` for an API key with the `comments:write` role, and `client_ref` is an agent's idempotency key, unique per `(test_run_id, author_id)` |
| `TestRunCommentRead` | Per-user, per-card "last seen" mark behind the unread badges (`test_run_comment_reads`, migration 1827); a missing row means unread |
| `TestRunStory` | An analysis story, shown in the UI as an **investigation** (`test_run_stories`, migration 1830); cascades with the run. Title, optional conclusion (`summary`), `status` `draft` or `published`, and `author_kind`. A user's draft is visible to its author only; an agent's draft (`author_kind = 'agent'`) to everyone who can see the run (1833). `notified_at` / `notify_after` (1832) are the publish announcement's claim and retry backoff, `published_by_id` / `published_by_name` (1833) who last published it, `activity_at` (1834) what makes it unread |
| `TestRunStoryStep` | An ordered step of a story pointing at a root comment (`test_run_story_steps`, migration 1830), PK `(story_id, comment_id)`, dense 1-based `position`, optional `note`. The FK to `test_run_comments` is `NO ACTION DEFERRABLE INITIALLY DEFERRED`, so a run delete is not refused while a comment that is a step is soft-deleted rather than removed |
| `TestRunStoryRead` | Per-user "last seen" mark for one story (`test_run_story_reads`, migration 1834); a missing row means never opened. Not carried by the SUT export |

### Data Science

| Entity | Table | Description |
|---|---|---|
| `DsMetrics` | `ds_metrics` | Time-series metrics (**TimescaleDB hypertable**) |
| `DsMetricStatistics` | `ds_metric_statistics` | Aggregated stats (p50, p95, p99, min, max) |
| `DsAdaptResults` | `ds_adapt_results` | ADAPT algorithm analysis results |
| `DsAdaptConclusion` | `ds_adapt_conclusions` | ADAPT conclusion summaries |
| `DsAdaptTrackedResults` | — | Tracked ADAPT results over time |
| `DsControlGroups` | `ds_control_groups` | Baseline test run groupings |
| `DsControlGroupStatistics` | — | Control group aggregate stats |
| `DsChangePoints` | `ds_change_points` | Performance regime shifts |
| `DsMetricClassification` | — | Metric importance classification |
| `DsCompareConfig` | — | Comparison configuration |
| `DsTrackedDifferences` | — | Identified regressions |
| `DsMetricCollectionStatus` | — | Incremental collection tracking |

### Evaluation Results

| Entity | Table | Description |
|---|---|---|
| `CheckResults` | `check_results` | SLO threshold compliance (absolute checks) |
| `CompareResults` | `compare_results` | Baseline comparison (regression detection) |

### Integrations

| Entity | Description |
|---|---|
| `GrafanaInstance` | Grafana server connection |
| `ApplicationDashboard` | Dashboard config per application |
| `DynatraceConfig` | Dynatrace connection config |
| `DynatraceQuery` | Dynatrace metric queries |
| `DynatraceEntityMapping` | Entity ID mappings |
| `TracingInstance` | Tracing backend (Tempo) connection |
| `PyroscopeInstance` | Pyroscope profiling connection |

### Reporting & Links

| Entity | Description |
|---|---|
| `ReportTemplate` | Report template definitions |
| `GeneratedReport` | Generated PDF reports |
| `DeepLink` | Deep links to external tools |
| `GenericDeepLink` | Template-based deep links |
| `UrlPattern` | URL pattern definitions |

### UI Presets

| Entity | Description |
|---|---|
| `CompareFilterPreset` | Saved comparison filter configs |
| `TrendsFilterPreset` | Saved trend analysis presets |
| `Event` | System events |
| `NotificationChannel` | Alert channels; `notify_on_comment` (migration 1828, default off) also posts test-run comment digests |

## Key Indexes

- Composite index on `(system_under_test_id, test_environment, workload)` for test run lookups
- `(system_under_test_id, test_environment, workload, start_time)` on `test_runs` — serves the "run immediately before this one" lookup a report's previous-run baseline needs. The `..., created_at` variant cannot: `created_at` is ingest order, not run order. The index does not cover the query's `completed = true` predicate, so Postgres still filters after the index scan; make it partial if that ever shows up in a plan
- Time-based indexes on `ds_metrics` for time-series queries
- `application_dashboard_id` on `ds_metric_statistics` (`idx_ds_metric_statistics_app_dashboard`, migration 1814) — the only index leading with that column. It serves the `?hasData=true` filter behind every metric picker, which probes one dashboard id at a time and stops at the first row; `uniq_ds_metric_statistics` leads with `test_run_id`, so before this the filter read the whole 1.2 M-row table on every picker open. It also covers `FK_30d5e9b699656dce6b211718780`, which had no leading index, so an `application_dashboards` delete had to scan the table to verify the constraint
- `organization_id` on all tenant-scoped tables

## Key Constraints

- `ds_adapt_results`: Unique on `(test_run_id, control_group_id, application_dashboard_id, panel_id, metric_name)`. The table is written by an upsert, so `AdaptPipeline` deletes separately — on metric identity, ignoring `control_group_id`. See [[ADAPT Algorithm]].
- Row-Level Security policies on all multi-tenant tables

## Related

- [[TimescaleDB]] — Time-series storage details
- [[Migrations]] — Migration workflow
- [[Multi-tenancy]] — Organization scoping
