# 2026-09-17 — Top 10 requests tab: 314 serial calls x ~3 s of raw scan each

**Status: fixed in v0.2.95.40** (one `GET /test-runs/:id/samplers` read off the sampler rollup; both Top 10 tabs use it and fall back to the per-transaction loop only when the run has no rollup). Item 3 below — the row-expand's ~3 s chain walk — is deliberately left. Source: `perfana-api-top10-request-log.txt`, 17:25–18:01
local, run `WERKNL-acceptatie-loadtest_perfana-00009` (3 h, ~4.5 M requests, 314 transactions).

## What the tab does

`useTop10Data.ts` (and its twin `Top10ListsUrls.tsx`) fetch `/transactions`, then loop every
transaction **serially** and call `GET /test-runs/:id/transactions/:name/samples`. The log shows
82 of those between 17:57:22 and 18:01:21 before it was cut — still going. At the observed pace
the tab needs 314 x ~3.2 s ≈ **17 minutes** to render.

## Where the 3 s goes

Not the samplers. Every call logs `Retrieved N aggregated samplers (rollup)` immediately — the
rollup read is milliseconds. The 3 s is `attachParallelGroups()`
(`test-runs-performance-query.service.ts:1430`), added in v0.2.66.0 (#494) to label each
sampler with its controller chain:

```sql
SELECT sampler_name, scenario_name, parent_controllers, source_element_path, time
  FROM requests_raw
 WHERE test_run_id = $1 AND transaction_name = $2
 ORDER BY time
 LIMIT 5000
```

The comment above it says "the first slice of rows, walked along the `(test_run_id, time)`
index". That is what happens, and it is the problem: there is no index leading with
`(test_run_id, transaction_name)` (`idx_requests_raw_grouping` puts `scenario_name` between
them), so the walk goes through the run's rows in time order and **filters** on
`transaction_name`. A transaction that is 1/314th of the traffic needs ~1.5 M rows walked to
collect 5,000 matches. Cold that was 29.5 s (the first call); warm, 2.8–4.3 s every time.
`LIMIT 5000` bounds the rows *returned*, not the rows *walked*.

Per request in the log: 82 calls, 262.8 s total, 3.2 s mean, all `pool=10/10idle` — nothing
else was running; this is the query itself.

## The Top 10 tab never reads the chain

`top10-utils.ts` and `Top10ListsUrls.tsx` do not touch `first_seen`, `chain` or
`chain_source`. The only consumer is the transaction row-expand in `TransactionsTable`
(`controller-sections.ts`), which asks for one transaction at a time — where 3 s is
tolerable. The Top 10 tab pays 314 x 3 s for data it drops on the floor.

## Fix, in order

1. **`?parallelGroups=false` on the samples route, sent by both Top 10 hooks.** Skips
   `attachParallelGroups`; the call becomes a rollup read. 314 calls x ~30 ms ≈ 10 s,
   serial. Three files, no schema change.
2. **One call instead of 314.** `test_run_sampler_stats` already holds every sampler of the
   run keyed by `(transaction_name, sampler_name, scenario_name, ramp_up_excluded)`; a
   `GET /test-runs/:id/samplers?excludeRampUp=` returning them all is one indexed read. Do
   this after 1 only if 10 s is still too slow — it removes the serial round trips, not the
   query cost.
3. **The row-expand path stays slow at ~3 s per transaction until the scan has an index it
   can use.** `(test_run_id, transaction_name, time)` on `requests_raw` would make the walk
   ~5,000 rows. On a 100+ GB hypertable that is hours of build and a permanent write cost
   for one feature; measure the expand path's actual usage before adding it. The
   alternative is to stop deriving the chain from `requests_raw` at all and write it into
   the sampler rollup when the rollup is built (the #494 comment already names this as the
   schema change it avoided).

## Also in this log, not the Top 10 tab

Opening the Performance Analysis card itself on this run, twice (17:25 and 17:52):

| request | 17:25 | 17:52 | query |
|---|---|---|---|
| `summary-timeseries` | 3.5 s | 10.0 s | bucketed aggregate over `transactions` |
| `virtual-users` | 7.3 s | 9.2 s | two aggregates over `virtual_users` |
| `throughput` | 8.6 s | **27.4 s** | `requests_raw_5s` / `transactions_5s` CAGG reads |
| `anomaly-detection/summary` | 4.9 s | 9.9 s | `GROUP BY conclusion->>'label'` over 23,308 `ds_adapt_results` rows |

The `throughput` figure is the CAGG shape from CLAUDE.md ("Postgres worker budget"): a
real-time aggregate whose watermark is behind the run re-aggregates raw. This run finished at
06:07 UTC and a `missing-data` re-evaluate (job 313) was enqueued at 17:25:35, so the raw
tables were being rewritten between the two openings. Check
`_timescaledb_catalog.continuous_aggs_watermark` for `requests_raw_5s` against the run's
window before treating it as a query problem. The `ds_adapt_results` group-by at 9.9 s for
23k rows is out of proportion and had `control-group-statistics` running beside it; re-time it
idle.
