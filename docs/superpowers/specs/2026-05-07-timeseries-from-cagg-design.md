# Test-run timeseries graphs from CAGGs

**Issue:** [#283](https://github.com/perfana/perfana/issues/283)
**Date:** 2026-05-07
**Status:** Approved (brainstorming)

## Problem

Opening a transaction or request graph in the test-run UI runs `getTransactionTimeSeries` / `getSamplerTimeSeries` in `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`. Both compute exact percentiles (`PERCENTILE_CONT 0.5/0.9/0.95/0.99`) by scanning the `requests_raw` / `transactions` hypertables directly on every render. On a populated TimescaleDB this is a multi-minute query (45–230 s in the lab repro on issue #283).

The data the chart needs is already pre-computed and continuously maintained: TimescaleDB CAGGs `requests_raw_5s` and `transactions_5s` (refreshed every 30 s, end='1 minute'). They carry `pct_agg` (timescaledb-toolkit `percentile_agg` / uddsketch sketch), so percentiles can be extracted via `approx_percentile(p, rollup(pct_agg))` from a few hundred pre-aggregated rows instead of millions of raw rows. This is the same pattern shipped in #278 for `transaction-stats-rollup`.

This is a query-routing fix — no schema change, no frontend change.

## Decisions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | In-flight test runs | CAGG only — accept up to ~1 min staleness | Completed runs are the common case; UNION-ALL fallback adds branching for marginal benefit |
| 2 | Scenario scoping (CAGGs lack `test_run_id`) | One-shot lookup `SELECT DISTINCT scenario_name FROM transactions WHERE test_run_id=$1 AND transaction_name=$2`, then filter CAGG by scenario | Zero schema change, near-free segment-by index hit, safely scopes when concurrent scenarios share a SUT/env |
| 3 | CAGG tier | Always read `_5s` and `rollup()` at query time | Post-aggregation data is already tiny (~720 rows/hour × N transactions); tier picking is premature optimization |
| 4 | Exact-percentile escape hatch | Drop raw path entirely | Chart endpoints are display-only; ~1 % uddsketch error is invisible at chart resolution; SLO-grade exactness lives in worker pipelines that already use `approx_percentile` |

## Architecture

**Scope.** Replace the body of three query methods in `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`:

- `getTransactionTimeSeries` (lines 108–276) — both the transaction subquery (`transactions`) and the sampler subquery (`requests_raw`).
- `getSamplerTimeSeries` (lines 289–376) — single `requests_raw` query.

**Read paths.** Transaction-level reads from `transactions_5s`; sampler-level reads from `requests_raw_5s`. Exact percentiles via `PERCENTILE_CONT` are replaced by `approx_percentile(p, rollup(pct_agg))` — the same pattern already used in `StatisticsPipeline.ts`, `ControlGroupStatisticsPipeline.ts`, and the rollup table (#278).

**Per-call shape.** Each public method runs three small queries:
1. Resolve `(system_under_test_name, test_environment, start_time, end_time)` from `test_runs ⨝ systems_under_test` (existing pattern; one indexed row).
2. Resolve `scenario_name` set via `SELECT DISTINCT scenario_name FROM transactions WHERE test_run_id=$1 AND transaction_name=$2` (segment-by index hit).
3. The actual time-series query against the CAGG, joined to a `generate_series` for zero-filled gaps (existing pattern preserved).

In practice (1) lives in the existing `validateOrganizationAccess`, (2) is folded into the time-series query as a CTE, and (3) is the new SQL.

**Bucket alignment & aggregation.** `aggregationSeconds` must be `>= 5` and a multiple of `5` (the CAGG floor). The query groups by `time_bucket('${aggSec} seconds', c.bucket)` over the CAGG's existing 5 s `bucket` column — for `aggSec=5` it's a pass-through, for larger values `rollup(pct_agg)` combines the 5 s sketches. Reject with `BadRequestException` outside that domain. Frontend modals (`RequestTimeSeriesModal.tsx`, `useTransactionGraphData.ts`) already default to `5` and present multiples of 5 — no UI change.

**Ramp-up.** When `excludeRampUp=true`, push `start_time` forward by `ramp_up` seconds (existing helper `getRampUpCutoffTime` is preserved). Filter `c.bucket >= time_bucket('5 seconds', cutoff)` so the boundary 5 s window aligns with the chart's natural granularity. Up to 5 s of imprecision is invisible at chart resolution.

**Public API.** Method signatures unchanged. Response shape (`TransactionTimeSeriesData` / `TimeSeriesDataPoint[]`) unchanged. `median`/`p90`/`p95`/`p99` are now ~1 % approximate vs exact.

**Out of scope.** No CAGG schema changes. No new migrations. No frontend changes. No exact-mode flag.

## Query shape

### Transaction-level (`transactions_5s`)

```sql
WITH run AS (
  SELECT sut.name AS sut,
         tr.test_environment AS env,
         tr.start_time,
         tr.end_time
  FROM test_runs tr
  JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
  WHERE tr.test_run_id = $1
),
scenarios AS (
  SELECT DISTINCT scenario_name
  FROM transactions
  WHERE test_run_id = $1 AND transaction_name = $2
),
bounds AS (
  SELECT CASE WHEN $3::boolean
              THEN GREATEST(start_time, $4::timestamptz)
              ELSE start_time END AS start_time,
         end_time
  FROM run
),
time_series AS (
  SELECT generate_series(
    time_bucket('${aggSec} seconds'::interval, start_time),
    time_bucket('${aggSec} seconds'::interval, end_time),
    interval '${aggSec} seconds'
  ) AS time_bucket
  FROM bounds
),
agg AS (
  SELECT
    time_bucket('${aggSec} seconds'::interval, c.bucket) AS time_bucket,
    (sum(c.avg_rt * c.n) / NULLIF(sum(c.n), 0))::numeric(10,2) AS avg_response_time,
    approx_percentile(0.50, rollup(c.pct_agg))::numeric(10,2) AS median_response_time,
    min(c.min_rt) AS min_response_time,
    max(c.max_rt) AS max_response_time,
    approx_percentile(0.90, rollup(c.pct_agg))::numeric(10,2) AS p90_response_time,
    approx_percentile(0.95, rollup(c.pct_agg))::numeric(10,2) AS p95_response_time,
    approx_percentile(0.99, rollup(c.pct_agg))::numeric(10,2) AS p99_response_time,
    sum(c.n)::bigint    AS total_count,
    sum(c.n_ok)::bigint AS passed_count,
    sum(c.n_err)::bigint AS failed_count
  FROM transactions_5s c
  JOIN run r
    ON c.system_under_test = r.sut
   AND c.test_environment  = r.env
  WHERE c.transaction_name = $2
    AND c.scenario_name IN (SELECT scenario_name FROM scenarios)
    AND c.bucket >= (SELECT start_time FROM bounds)
    AND c.bucket <  (SELECT end_time   FROM bounds) + interval '5 seconds'
    AND ($3::boolean = false OR $4::timestamptz IS NULL
         OR c.bucket >= time_bucket('5 seconds', $4::timestamptz))
  GROUP BY 1
)
SELECT ts.time_bucket,
       a.avg_response_time, a.median_response_time,
       a.min_response_time, a.max_response_time,
       a.p90_response_time, a.p95_response_time, a.p99_response_time,
       COALESCE(a.total_count, 0)  AS total_count,
       COALESCE(a.passed_count, 0) AS passed_count,
       COALESCE(a.failed_count, 0) AS failed_count
FROM time_series ts
LEFT JOIN agg a ON a.time_bucket = ts.time_bucket
ORDER BY ts.time_bucket;
```

### Sampler-level (`requests_raw_5s`)

Identical shape against `requests_raw_5s`, with `sampler_name` added to GROUP BY and SELECT.

### Single sampler (`getSamplerTimeSeries`)

Sampler-level plus `AND c.sampler_name = $3` (no GROUP BY on `sampler_name`, matches current behavior).

### Notes

- `avg_response_time` uses the n-weighted-mean formula — same as the `requests_raw_1m` / `transactions_1m` view definitions. For `aggSec=5` it collapses to `avg_rt`.
- `min_rt` / `max_rt` are stored per-5 s in the CAGG; `min(min_rt)` / `max(max_rt)` over the rollup window is exact.
- Success / error counts come from `n_ok` / `n_err` columns — no `FILTER` clause needed.
- The three CTEs (`run`, `scenarios`, `bounds`) execute in one round trip; the `IN (SELECT ... FROM scenarios)` is a subquery in the same statement.

## File-level structure

Single file touched (logic): `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`

After the rewrite:

- `private buildTimeSeriesQuery(opts: { kind: 'transaction' | 'sampler' | 'sampler-single', aggSec: number })` — returns the parameterized SQL string. Single source of truth for the CAGG query shape; transaction vs sampler differ only in source view, group key, and an extra `sampler_name = $3` predicate.
- `private validateAggregationSeconds(aggSec: number)` — `BadRequestException` if not `>= 5` or not a multiple of `5`.
- `getTransactionTimeSeries` — calls the builder twice (transaction + sampler) with the same param array, parses results.
- `getSamplerTimeSeries` — calls the builder once (sampler-single), parses.

Existing helpers (`validateOrganizationAccess`, `getRampUpCutoffTime`, `parseTimeSeriesRow`) are preserved unchanged. `parseTimeSeriesRow` continues to produce the same `TimeSeriesDataPoint` shape — `min_response_time` / `max_response_time` are now `bigint` from the CAGG vs `integer` from raw, but they round-trip through `parseInt` identically.

No other files need to change:
- No frontend changes (response shape preserved).
- No DTO/type changes.
- No new migrations (CAGGs already exist).
- No new dependencies.

## Validation & error handling

- `aggregationSeconds` must be `>= 5` and a multiple of `5`. Throw `BadRequestException` otherwise. Today the service silently accepts anything; a 1 s request would 500 against the CAGG floor. Validation runs once at the entry of each public method.
- `aggregationSeconds` is interpolated into the query string — the existing code does the same. Defense: cast to `Number()` and re-check it's a finite integer before interpolation (preserves existing behavior).
- Existing `try/catch` → `DatabaseException('Failed to retrieve …', err)` is preserved.
- Edge case: the `scenarios` CTE returns zero rows for a transaction with no raw data. The current raw query also returns an empty result set; the new query produces a fully zero-filled time series via `LEFT JOIN`. Behavior preserved.

## Tests

New file: `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.spec.ts` (does not exist today). Coverage:

1. **Query routing** — `getTransactionTimeSeries` runs three statements: org-access check, ramp-up bounds lookup, time-series query. Assert the time-series query string contains `FROM transactions_5s c` and `approx_percentile(0.95, rollup(c.pct_agg))`. Assert the sampler-side query contains `FROM requests_raw_5s c`.
2. **No raw scan in the time-series query** — assert the time-series query string does NOT contain `FROM transactions ` or `FROM requests_raw ` (apart from the scenario-derivation CTE, which intentionally hits raw).
3. **Aggregation seconds validation** — `BadRequestException` for `aggregationSeconds=1`, `=3`, `=7`, `=0`, `=-5`. Accept `5`, `10`, `30`, `60`, `300`.
4. **Ramp-up bucket alignment** — when `excludeRampUp=true` and `cutoffTime` is mid-bucket, query string contains `time_bucket('5 seconds', $4::timestamptz)`.
5. **Scenario filter** — query string contains `c.scenario_name IN (SELECT scenario_name FROM scenarios)`.
6. **Avg formula** — query string contains `sum(c.avg_rt * c.n) / NULLIF(sum(c.n), 0)`.

Tests are string-based (Jest mocks of `repo.query`) — same pattern as `apps/worker/src/test/unit/pipelines/StatisticsPipeline.test.ts`. No DB needed.

No integration test in this PR. Query validity is covered by `npm run preflight` plus CI startup migrations against the lab DB. If we want a TimescaleDB-container integration test, it can be a follow-up.

## Manual verification (post-merge)

- Lab `lab/db-stress-18k-rps`, populated DB with 220 M-row `requests_raw`.
- Open a request graph and a transaction graph.
- Confirm wall time drops from 30+ s to sub-second per render.
- Spot-check that p50/p90/p95/p99 values match the prior raw values within ~1 % on a known transaction.

## Commit / PR plan

- Branch: `fix/timeseries-from-cagg-283` (already created).
- One commit: `fix(api): route test-run timeseries reads to CAGGs (#283)`.
- Open a PR against `main` after `npm run preflight` passes.
- Run `npx gitnexus analyze` after the PR is created.

## References

- Issue: #283
- Related: #277 (covering indexes for dropdowns), #278 (rollup `tdigest(size,value)` percentile path — same `approx_percentile(rollup(pct_agg))` shape), #282 (panels-processing soft-skip)
- Existing pattern: `apps/worker/src/pipelines/StatisticsPipeline.ts`, `apps/worker/src/pipelines/ControlGroupStatisticsPipeline.ts`
- CAGG migration: `packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts`
