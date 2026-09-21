---
tags:
  - database
  - operations
---

# Migrations

Database migrations are managed through TypeORM and consolidated migration scripts.

## Migration System

Perfana uses TypeORM migrations located in `packages/shared/src/database/migrations/`:

- **1 consolidated migration** (`1700000000000-ConsolidatedSchema.ts`) — consolidates legacy migration records and syncs schema state with codebase entities
- **Standalone migrations** layered on top of it, applied in timestamp order:

| Migration | Purpose |
|---|---|
| `1783409734007-AddProxyServer` | Proxy server configuration |
| `1788000000000-AddHypertableCompression` | TimescaleDB compression on `ds_metrics` |
| `1789000000000-AddComparePresetDisplayConfig` | Display config on compare presets |
| `1790000000000-BackfillTextBlockMarkdownOff` | Pins report text blocks authored before markdown rendering to `markdown: false`. Not reversible — `down()` is intentionally a no-op, since it cannot tell a backfilled `false` from one an author chose. |
| `1791000000000-AddTestRunStartTimeIndex` | Indexes `test_runs (system_under_test_id, test_environment, workload, start_time)` for the previous-run baseline lookup. Built `CONCURRENTLY` so it does not hold a write lock on a hot table, which is why it issues an explicit `COMMIT` first — a concurrent build cannot run inside a transaction. Greenfield deploys get the index from the consolidated schema instead. |
| `1804000000000-ChunkIntervalAndChunkCompressionWrappers` | Two things (v0.2.95.17). `chunk_time_interval` 7 days → 1 day on `ds_metrics` and `requests_raw` — only chunks created from now on; the open chunk keeps its 7-day range until it closes. And `SECURITY DEFINER` wrappers `perfana_decompress_chunk` / `perfana_compress_chunk`, owned by the migration role (the hypertable owner), `EXECUTE` granted to `perfana_system` only and refused for anything that is not a chunk of the five compressed Perfana hypertables — the worker could never call `decompress_chunk` directly (`must be owner of hypertable`). Needs the hypertable owner or a superuser to run and fails loudly otherwise. Raise `max_locks_per_transaction` to 256+ (restart) before the 1-day chunks accumulate; the migration warns when it is lower. `compress_after` is left at 7 days here; migration 1805 shortens it. |
| `1805000000000-ShortenDsMetricsCompressAfter` | `compress_after` 7 days → 2 days on `ds_metrics` only (v0.2.95.18). With 1-day chunks that leaves 2–3 days of row store (~32–48 GB at 16 GB/day) instead of the 227 GB that sat uncompressed in two 7-day chunks; reads are unaffected because `test_run_id` is the segmentby column. Refuses to run unless `perfana_decompress_chunk` exists and `perfana_system` can EXECUTE it — every rewrite of a run older than the window depends on migration 1804's wrappers — but it cannot prove they *work* on the deploy, so change the analysis window on a >7-day-old run first and confirm `Decompressing ds_metrics chunk` in the worker log. The first policy run compresses the previous 7-day chunk (~113 GB) in one `compress_chunk` call, so `initial_start` is the next 02:00 UTC with a 24 h `schedule_interval`; override with `DS_METRICS_COMPRESS_INITIAL_START` (ISO-8601 with a zone, in the future) at migration time — see [[Environment Variables]]. Skips cleanly where TimescaleDB or compression is absent. `requests_raw`/`transactions`/`requests_error` stay at 7 days to match their continuous aggregates' `start_offset`. `down()` restores the 7-day policy; already-compressed chunks stay compressed. |
| `1806000000000-BackfillScenarioPanelMinSampleCount` | Adds `thresholds.minSampleCount: 1` to the panel-level `ds_compare_config` rows of the perf-test scenario panels — Error Count (301), Avg Active Threads (302), Max Active Threads (303) — which hold one point per run and would otherwise turn `incomparable` for good under the `ADAPT_MIN_SAMPLE_COUNT` floor (v0.2.95.28). Needed because the pipeline writes those configs with `ON CONFLICT DO NOTHING`, so rows from before this version never gain the key on their own. One `UPDATE`, with `trigger_mark_stale_on_config_update` held off for the statement so existing ADAPT results are not flagged stale. Leaves alone any row that already carries a numeric `minSampleCount`, a `thresholds` that is not a JSON object, and metric-level overrides (`metric_name IS NOT NULL`) — those shadow the panel row wholesale and must carry their own key. Recognises a perf-test dashboard by its metrics source or, where a SUT import left `metrics_source_id` NULL, by the `performance-test-metrics-` uid prefix. Runs on API boot; a worker rolled out ahead of it labels those panels `incomparable` on the runs analysed in between, which need a re-evaluate. `down()` is a no-op — the key is what the pipeline writes on new rows anyway. |
| `1807000000000-AddDsPanelsTestRunIndex` | `CREATE INDEX IF NOT EXISTS idx_ds_panels_test_run_dashboard ON ds_panels (test_run_id, application_dashboard_id)`. The table had no index on `test_run_id`, so every incremental Grafana tick, `getDsPanelsByTestRun` and the `DELETE` in `PanelsPipeline` scanned it whole. Plain, not `CONCURRENTLY` — a concurrent build cannot run inside the migration transaction. The table has no retention (one row per panel per analysed run, ~225/run; 9 k rows on dev), so on a long-lived deploy the build is seconds to low tens of seconds and blocks `ds_panels` writers (PanelsPipeline, DynatracePipeline) for that long; reads continue. `down()` drops it. |
| `1808000000000-AddBenchmarkApdexMinSamples` | `ALTER TABLE benchmarks ADD COLUMN IF NOT EXISTS apdex_min_samples integer DEFAULT 50 CHECK (apdex_min_samples IS NULL OR apdex_min_samples >= 1)` (v0.2.95.34). The fewest executions a transaction needs before its Apdex score can fail the SLO; below it the check writes `meets_requirement: null` with `below_min_samples: true` and the run verdict is unaffected. Deliberately **nullable** rather than `NOT NULL DEFAULT 50`: `benchmarks` is a `core` SUT-transfer resource and the import's `json_populate_recordset` yields NULL, not the DEFAULT, for a key an older bundle lacks, so NOT NULL would reject every pre-1808 bundle with 23502. Every reader falls back to 50 (`COALESCE` in `BenchmarkMatcher`, `?? 50` in `BenchmarkMapper` and the API). Existing `check_results` keep their stored verdict until the run is re-evaluated. `down()` drops the column. |
| `1809000000000-AddDsMetricStatisticsTrend` | `ALTER TABLE ds_metric_statistics ADD COLUMN IF NOT EXISTS trend_pct_per_hour double precision, ADD COLUMN IF NOT EXISTS trend_corr double precision` (v0.2.96.4). Backs the Trend SLO (`evaluate_type = 'trend'`): `StatisticsPipeline` writes the OLS slope of each series as % of its mean per hour plus the Pearson r that says whether the slope is a trend or noise. Nothing backfills the columns — rows written before the migration stay NULL until the run's statistics are recalculated, and a trend SLO on such a run reports no targets. Same lock discipline as 1795: `lock_timeout` 3 s with a plpgsql retry loop (10 attempts, 3 s apart), because a running aggregation holds `ds_metric_statistics` for up to 540 s and an unbounded ALTER would queue every later read behind it; after 10 refusals it raises naming `pg_stat_activity` as the place to look. A worker rolled out before the migration lands fails `statistics-calculation` and `checks-evaluation` with 42703 (the worker has no boot-time column probe). `down()` drops both columns. |

## Commands

| Command | Description |
|---|---|
| `npm run migration:generate` | Generate migration from entity changes |
| `npm run migration:run` | Apply pending migrations |
| `npm run migration:revert` | Revert last migration |
| `npm run migration:show` | Show migration status |
| `npm run db:push` | Apply Supabase migrations |
| `npm run db:reset` | Reset database (destructive) |

## Migration Files

Additional standalone migration scripts in `database/`:

| File | Purpose |
|---|---|
| `MIGRATION_CONSOLIDATION.md` | Consolidation strategy documentation |
| `PRODUCTION_DEPLOYMENT_SUMMARY.md` | Production deployment notes |
| `DEPLOYMENT_CHECKLIST.md` | Pre-deployment checklist |

## Key Migration Topics

### Ownership Columns
Added `organization_id` and `created_by` columns to all tenant-scoped tables. See [[Multi-tenancy]] for details.

### Supabase to PostgreSQL Migration
The project migrated from Supabase-managed PostgreSQL to self-hosted PostgreSQL with TypeORM. Key changes:
- Removed Supabase SDK dependency for data access
- Replaced Supabase Auth with Keycloak
- Maintained TimescaleDB extension
- Added TypeORM entity definitions for all tables

> [!warning] Destructive Commands
> `npm run db:reset` drops and recreates the entire database. Never run in production.

## Related

- [[Schema Overview]] — Current schema
- [[Getting Started]] — Initial database setup
