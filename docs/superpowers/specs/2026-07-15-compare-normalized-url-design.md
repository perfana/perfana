# Compare by aggregated normalized URL

**Date:** 2026-07-15
**Status:** Approved design, ready for implementation plan
**Branch:** `feature/compare-normalized-url`

## Goal

On the Compare card (test-run detail page), let users compare performance between
two test runs grouped by **aggregated normalized URL**, alongside the existing
comparison by **transaction** and **request (sampler)**.

Normalized URLs already exist in the data model: `requests_raw.url_hash` is set at
ingest via `jtl-import.service.ts normalizeUrl()`, and `url_patterns`
(`url_hash → normalized_url`) is populated at the same time. This feature surfaces
that dimension in the Compare card. Nothing else changes.

## Approach (locked)

**Re-aggregate the existing `test_run_sampler_stats` rollup by `url_hash` at query
time.** No new table, no worker/pipeline change, no migration, no backfill.

`test_run_sampler_stats` already stores, per sampler per run: `url_hash`,
`total_count`/`passed_count`/`failed_count`, `avg_response_time`/`min`/`max`,
`avg_latency`, `avg_connect_time`, and `pct_agg` (a `tdigest` sketch). Percentiles
are read at query time with `approx_percentile(p, pct_agg)`, and t-digests **merge
correctly** via the `rollup()` aggregate (already used in
`test-runs-performance-query.service.ts:469,767`). So the URL dimension is just a
regrouping of rows the runs already have.

### Rejected alternatives

- **Live query over `requests_raw` grouped by `url_hash`** — slow: `percentile_cont`
  over millions of raw samples per run, per card expand. Rejected.
- **New `test_run_url_stats` rollup table + pipeline change + backfill** — was the
  initial plan, justified by "percentiles can't be averaged." That premise is false
  for t-digests (`rollup(pct_agg)` merges them accurately), so the table, the
  `TransactionStatsRollupPipeline` change, the migration, and the backfill script are
  all unnecessary. Rejected.

### Timing / freshness (no separate rollup, so inherited from samplers)

`test_run_sampler_stats` is populated once, post-completion, by the
`transaction-stats-rollup` stage of the `analyze-test` pipeline. It is **not** written
incrementally during a running test. Therefore URL comparison data becomes available
at the same moment sampler comparison data does — after analysis — and can never be
staler than the samplers it is derived from. During an in-flight run the sampler
rollup is empty, so URL comparison is empty too; this matches the existing
request-panel comparison (Compare works on completed runs). Live in-flight URL numbers
(a `GROUP BY url_hash` variant over the `requests_raw_passed` CAGG) are **out of
scope** — YAGNI unless requested.

## Backend

### New service query — `test-runs-performance-query.service.ts`

A per-URL variant of the existing sampler fast-path read (~`:556–635`). Sketch:

```sql
SELECT
  s.url_hash,
  up.normalized_url,
  SUM(s.total_count)                                   AS total_count,
  SUM(s.passed_count)                                  AS passed_count,
  SUM(s.failed_count)                                  AS failed_count,
  SUM(s.avg_response_time * s.total_count)
    / NULLIF(SUM(s.total_count), 0)                    AS avg_response_time,
  MIN(s.min_response_time)                             AS min_response_time,
  MAX(s.max_response_time)                             AS max_response_time,
  SUM(s.avg_latency * s.total_count)
    / NULLIF(SUM(s.total_count), 0)                    AS avg_latency,
  SUM(s.avg_connect_time * s.total_count)
    / NULLIF(SUM(s.total_count), 0)                    AS avg_connect_time,
  rollup(s.pct_agg)                                    AS pct_agg
FROM test_run_sampler_stats s
LEFT JOIN url_patterns up
  ON up.url_hash = s.url_hash
 AND up.system_under_test = :sut
 AND up.test_environment  = :env
WHERE s.test_run_id = ANY(:testRunIds)
  AND s.ramp_up_excluded = :rampUpExcluded
GROUP BY s.url_hash, up.normalized_url
```

Then p90/p95/p99 via `approx_percentile(p, pct_agg)`, throughput from `total_count`
over the run window, error % from `failed_count / total_count` — identical
post-processing to the sampler path. Rows where `normalized_url IS NULL` (no pattern
row) fall back to displaying the `url_hash` (or are grouped under an "unmatched"
label — implementation detail for the plan).

Weighted averages (count-weighted) are used for the mean-style columns; percentiles
and Apdex come from the merged `pct_agg` sketch, so they are exact, not weighted
approximations.

### New endpoints

Two thin endpoints mirroring the sampler pair, on the perf-metrics metrics controller,
returning the **same response shapes the Compare card already parses** (so the
frontend parsing/comparison/preset code is unchanged):

- `GET …/url-distinct-names?system&environment&workload&testRunId`
  → `string[]` of `normalized_url` for the run (one per `url_hash`).
- `GET …/url-metric-statistics?system&environment&workload&testRunIds=csv`
  → `MetricStatistic[]` (`compare.types.ts:48–66`), one row per normalized URL per
  run, each carrying the full stat set (avg/p90/p95/p99, throughput, error %,
  latency, connect time). Panel selection is a display concern handled client-side
  (see below), so this endpoint is panel-agnostic and returns all stats.

Auth/RBAC follows the existing sampler/ds-metric endpoints exactly (same guard,
same org/workload scoping).

## Frontend

Mirror the existing **"All aggregated"** precedent (`apps/web/lib/aggregated-perf-series.ts`),
which already defines perf-metrics panels client-side and special-cases their fetches —
the closest structural analog.

1. **Define URL panels** (new small lib, e.g. `apps/web/lib/url-perf-panels.ts`):
   panel IDs **210–218** mirroring request panels 201–209:

   | ID  | Name             | stat field   |
   |-----|------------------|--------------|
   | 210 | URL RT Avg       | avg          |
   | 211 | URL RT P90       | p90          |
   | 212 | URL RT P95       | p95          |
   | 213 | URL RT P99       | p99          |
   | 214 | URL Error Rate   | error %      |
   | 215 | URL Throughput   | throughput   |
   | 216 | URL Apdex        | apdex        |
   | 217 | URL Latency      | latency      |
   | 218 | URL Connect Time | connect time |

2. **Inject URL panels into the panel dropdown** for `performance-metrics`
   dashboards only (`CompareSelectionPanel.tsx` panel Autocomplete). They must
   **not** appear for Grafana or Dynatrace dashboards.

3. **Route fetches** in `useCompareData.ts`: when the selected panel is a URL panel
   (210–218), call `url-distinct-names` / `url-metric-statistics` instead of the
   `ds-metrics/distinct-names` / `ds-metric-statistics` endpoints. The panel's stat
   field selects which column `CompareDiffTable` displays — reusing the existing
   display logic. Series multi-select, added-series, presets, and "All aggregated"
   all work unchanged (series names are now normalized URLs).

## Documented caveat

`test_run_sampler_stats` keeps only the **last-seen `url_hash` per sampler**. If a
single `sampler_name` hits genuinely different normalized URLs within one run, all its
samples attribute to that last URL's group. This is a pre-existing property of the
sampler rollup, degrades gracefully, and does not affect the primary use case
(samplers labeled by raw URL → each maps to one stable `url_hash`, which is exactly
what we merge). Noted here so it is not re-discovered as a bug.

## Scope / YAGNI

- No worker changes, no `ds_metrics` rows, no migration, no backfill.
- No in-flight (CAGG) URL path.
- No new RBAC surface — reuse the sampler endpoints' guard.
- URL panels only for `performance-metrics` dashboards.

## Testing

- **API:** `test-runs-performance-query.service` spec for the per-URL query —
  assert t-digest merge across two samplers sharing a `url_hash` yields the correct
  merged p90/p95/p99 and count-weighted avg; assert `ramp_up_excluded` filtering;
  assert `normalized_url IS NULL` fallback.
- **Web:** `useCompareData` test — selecting a URL panel routes to the URL endpoints;
  selecting a request panel still routes to the ds-metrics endpoints.
- Manual: compare two completed JTL runs on a URL panel; confirm series list shows
  normalized URLs and diffs match the sum of the underlying samplers.
