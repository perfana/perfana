---
tags:
  - database
  - timescaledb
  - performance
---

# Continuous Aggregates (CAGGs)

Perfana materializes bucketed rollups over the three high-volume request hypertables so Grafana panels read pre-aggregated rows instead of re-scanning millions of raw rows on every refresh.

## Status

Accepted (2026-04-24, issue [#147](https://github.com/perfana/perfana/issues/147)).

## Context

Grafana panels on `template-timescaledb-jmeter`, `template-timescaledb-request-analysis`, and `template-timescaledb-transaction-analysis` aggregate over `requests_raw`, `transactions`, and `requests_error` — hypertables that hold tens of millions of rows per active test run. Even after the composite `(sut, env, scenario, time DESC)` index from issue [#137](https://github.com/perfana/perfana/issues/137) and a 4 GB `shared_buffers` that keeps the index hot, a typical 30-minute panel refresh scans ~12 M index entries and costs ~4 s of CPU. Multiplied across N panels per dashboard, the experience is sluggish.

## Decision

Introduce three TimescaleDB continuous aggregates (CAGGs) per hypertable, at 5 s, 1 min, and 5 min bucket sizes. Panels pick the CAGG that matches `$__interval` via a Grafana template variable `cagg_suffix`. The `1m` CAGG is hierarchical (materialized from `5s`); the `5m` CAGG is materialized from `1m`.

### CAGG shapes

| CAGG                             | Source          | Group-by (besides `bucket`)                                                                                            |
| -------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `requests_raw_{5s,1m,5m}`        | `requests_raw`  | `system_under_test, test_environment, scenario_name, sampler_name, transaction_name, location`                          |
| `transactions_{5s,1m,5m}`        | `transactions`  | `system_under_test, test_environment, scenario_name, transaction_name`                                                  |
| `requests_error_{5s,1m,5m}`      | `requests_error`| `system_under_test, test_environment, scenario_name, sampler_name, transaction_name, node_name, response_code`          |

### Aggregate columns

- **`requests_raw_*` / `transactions_*`:** `n` (count::bigint), `n_ok` / `n_err` (counts filtered by `success`), `avg_rt`, `min_rt`, `max_rt`, and `pct_agg` — a `timescaledb_toolkit` `percentile_agg` (tdigest) for approximate percentiles. `requests_raw` additionally carries `avg_connect`, `avg_latency`, `bytes_in` (from `response_size`), `bytes_out` (from `request_size`), and `avg_response_size`.
- **`requests_error_*`:** just `n`. Error counts roll up by bucket × (sampler, transaction, node, response_code). Individual error rows (used by the detail panels on `template-timescaledb-errors`) stay on the raw `requests_error` hypertable — CAGGs don't materialize row-level data.

### Hierarchical rollup

The `1m` and `5m` CAGGs derive from the coarser-bucket CAGG below them, not from the raw table. Associative aggregates (`sum`, `min`, `max`, weighted `avg`, `rollup(pct_agg)`) make this mathematically safe. Weighted averages use `sum(x * n) / NULLIF(sum(n), 0)` to preserve the mean through the hierarchy.

Hierarchical CAGGs require TimescaleDB toolkit ≥ 1.15 for the `rollup(tdigest)` function. Perfana's `timescale/timescaledb-ha:pg15` image ships ≥ 1.22.

### Refresh cadence

| Granularity | `start_offset` | `end_offset` | `schedule_interval` |
| ----------- | -------------- | ------------ | ------------------- |
| `_5s`       | 1 hour         | 1 minute     | 30 seconds          |
| `_1m`       | 2 hours        | 2 minutes    | 1 minute            |
| `_5m`       | 1 day          | 5 minutes    | 5 minutes           |

The 1-minute `end_offset` keeps refresh jobs out of the current chunk's write path. The `_1m` policy has a larger `start_offset` than `_5s` so its source view has been refreshed first; same for `_5m` relative to `_1m`.

End-to-end refresh lag a user should expect on the 5s view: **~60 seconds**. Live "now" stat panels (queries that filter `time > now() - interval 'N seconds'`) intentionally stay on the raw hypertables — CAGG lag would hide the last minute of data.

### Retention

Each CAGG has a 90-day retention policy. This is intentionally longer than any retention the raw hypertables may acquire later, so long-term trend panels continue to work after raw data is pruned. The raw hypertables have no retention at time of authoring; if retention is introduced on raw, the CAGG retention should be re-evaluated.

### Panel selection

A Grafana template variable `cagg_suffix` resolves to `5s`, `1m`, or `5m` based on `${__interval_ms}`:

```sql
SELECT CASE
  WHEN ${__interval_ms} <= 15000   THEN '5s'
  WHEN ${__interval_ms} <= 300000  THEN '1m'
  ELSE                                  '5m'
END AS suffix;
```

Panels then say `FROM requests_raw_${cagg_suffix}`, `FROM transactions_${cagg_suffix}`, etc. Grafana interpolates `${cagg_suffix}` at query-build time. The variable is `hidden` in the UI because it's derived from `$__interval_ms` and doesn't need user input.

### What stays on raw tables

Not every panel is a CAGG candidate:

1. **Live "now" stat panels** that filter `time > now() - interval '<60 seconds>'` — CAGG refresh lag is ~60 s, so these would show stale data.
2. **Row-level detail panels** (e.g. `SELECT time, sampler_name, response_message, …` on `requests_error` for a specific `random_id`, or scatter plots with `LIMIT 100000+` on `requests_raw`) — CAGGs don't store individual rows.
3. **Single-number `success IS TRUE`-filtered stats** (min/avg/max/p95 of successful response times) on the per-transaction and per-sampler analysis dashboards — the CAGG aggregates don't distinguish success from failure for these columns. These panels are scoped to one sampler or transaction and aggregate once per refresh, so the composite index from #137 keeps them responsive.
4. **`virtual_users`** panels — that hypertable is not a CAGG target.
5. **All of `template-timescaledb-errors.json`** — the two panels on this dashboard look up individual error rows by `random_id` (message body, headers), which is fundamentally a row-level query.

### Known semantic shifts

Time-series response-time panels on the per-transaction (`$transaction Response Times`) and per-sampler dashboards previously filtered by `success IS TRUE` on raw rows. The CAGG doesn't store success-filtered response-time aggregates, so these panels now compute weighted averages over successful + failed rows combined. In typical load tests with <1% error rate the distortion is negligible. In failure-mode tests it can be meaningful — but each affected panel has a companion scatter panel that renders OK vs Error response times separately, so the distortion is visually obvious when it matters.

If this trade-off becomes problematic, the mitigation is to add success-filtered aggregate columns (`avg_rt_ok`, `min_rt_ok`, `max_rt_ok`, `pct_agg_ok`, and `_err` equivalents) to the CAGG migration and switch the affected panel queries to them.

## Rollout

No per-tenant feature flag. CAGGs are additive DDL: creating them does not change ingestion or affect existing dashboard queries. The PR that introduces the CAGGs (`feat/continuous-aggregates-issue-147`) also rewrites the affected dashboard JSONs in `perfana-demo`, so the switch is atomic at merge time.

## Alternatives considered

**Extend the `test_run_stats_rollup` pattern from #150/#151 to dashboards.** Rejected. That rollup is keyed on `test_run_id` and is pre-computed at test-run finalization. Dashboards query across test runs and often want in-flight data, which the per-run rollup cannot provide.

**Single CAGG at 5 s, re-bucket client-side for all zoom levels.** Rejected for multi-week views. A week of 5 s buckets × O(10³) groups is O(10⁸) CAGG rows; the 5 m view cuts that by 60× at the cost of two extra materialized views.

**Keep raw panels and rely on `shared_buffers`.** Already done at production scale. The steady-state ~4 s/panel is the floor after index-only scans engage. More memory and indexes won't break past it without pre-materialization.

## Validation

- **Correctness.** Full up → down → up cycle: 0 → 9 → 0 → 9 CAGGs, plus 9 refresh and 9 retention policies each cycle. Validated under both TypeORM `migrationsTransactionMode: 'all'` (CLI) and `'each'` (production `run-migrations.ts`). CAGG DDL, `add_continuous_aggregate_policy`, and `add_retention_policy` all succeed inside a TimescaleDB 2.26.3 transaction — no `transaction = false` opt-out needed.
- **Latency.** Target: p50 panel latency <200 ms for typical 30-minute panels on `performance-praegus`-scale data. Measured post-merge against the production canary.
- **Aggregate sanity.** Sample rewritten queries run against the live dev DB return expected rows: `requests_raw_5s` weighted `avg_rt` matches raw `avg(response_time)` within tdigest quantization, `approx_percentile(0.95, rollup(pct_agg))` returns plausible p95 values.

## Related

- [#137](https://github.com/perfana/perfana/issues/137): composite `(sut, env, scenario, time DESC)` indexes. Still required — raw tables still serve live "now" queries, individual-row drill-downs, and the success-filtered stat panels listed above.
- [#139](https://github.com/perfana/perfana/issues/139): `approx_percentile` rewrite of the Apdex query. CAGGs reuse the same tdigest pattern.
- [#150](https://github.com/perfana/perfana/issues/150) / [#151](https://github.com/perfana/perfana/issues/151): `test_run_{transaction,sampler}_stats` rollup. Solves a different hot path (API-side `getTransactionStats` / `getAggregatedSamplerStats` over immutable completed runs). Complementary, not overlapping.
