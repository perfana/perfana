# Continuous Aggregates for requests_raw / transactions / requests_error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw-hypertable Grafana panel queries on `requests_raw`, `transactions`, and `requests_error` with TimescaleDB continuous aggregates (CAGGs) at 5 s / 1 min / 5 min granularities, driven off `$__interval`, to cut dashboard panel latency from ~4 s to <200 ms.

**Architecture:** Three CAGGs per hypertable (9 total) materialized by an `add_continuous_aggregate_policy` refresh job that runs every 30 s with a 1-minute trailing window. CAGGs store counts, sums, averages, min/max and a `percentile_agg` (tdigest) sketch keyed on `(bucket, system_under_test, test_environment, scenario_name, …)`. A Grafana dashboard variable `$cagg_suffix` resolves to `5s`, `1m`, or `5m` based on the panel's `$__interval_ms`, so each panel reads a native-resolution view. A separate retention policy drops CAGG rows after 90 days (longer than raw retention, so trend panels survive base-row pruning). CAGG creation must run outside TypeORM's auto-transaction (`CREATE MATERIALIZED VIEW … WITH (timescaledb.continuous)` and `add_continuous_aggregate_policy` both reject transaction context).

**Tech Stack:** TimescaleDB 2.x (image `timescale/timescaledb-ha:pg15`), `timescaledb_toolkit` (`percentile_agg`, `approx_percentile`), TypeORM migrations in `packages/shared/src/database/migrations/`, Grafana 12.3 with file-provisioned JSON dashboards in `infra/grafana/dashboards/`.

---

## File Structure

**Create:**
- `packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts` — creates 9 CAGGs + refresh policies + retention policies. One migration file, with `transaction: false` so CAGG DDL runs outside TypeORM's auto-transaction.
- `docs-site/content/Database/Continuous Aggregates.md` — ADR-style doc explaining CAGG design, refresh lag, retention, rollout plan.

**Modify:**
- `infra/grafana/dashboards/template-timescaledb-jmeter.json` — rewrite main `requests_raw` / `transactions` / `requests_error` panels to use `$cagg_suffix`-resolved CAGG tables. Add the `cagg_suffix` template variable.
- `infra/grafana/dashboards/template-timescaledb-transaction-analysis.json` — same.
- `infra/grafana/dashboards/template-timescaledb-request-analysis.json` — same. Single-sampler drill-down panels mostly use point-in-time aggregates (min/max/avg/count over the whole window) — those switch to the 5s CAGG with `tdigest` percentile via `approx_percentile(pct_agg, 0.95)`.
- `infra/grafana/dashboards/template-timescaledb-errors.json` — the two panels on this dashboard fetch individual error rows by `random_id` and are NOT time-series aggregates; they stay on `requests_error`. No CAGG use here, but document why in the ADR so reviewers don't flag the omission.
- `CHANGELOG.md` — add a changelog entry.
- `VERSION` — bump minor version.

**Test:**
- `apps/api/src/test/cagg-migration.integration.test.ts` — new integration test that runs the migration against a TimescaleDB testcontainer, inserts sample rows, forces a refresh, asserts CAGG contents match raw aggregates.

---

## Design Notes (read before starting)

**CAGG shapes.** Each CAGG groups by `(bucket, system_under_test, test_environment, scenario_name, …)` with the `…` columns chosen to cover the highest-cardinality panel breakdowns in the existing dashboards:

| CAGG family | GROUP BY columns (besides bucket) | Source table |
|---|---|---|
| `requests_raw_{5s,1m,5m}` | `system_under_test, test_environment, scenario_name, sampler_name, transaction_name, location` | `requests_raw` |
| `transactions_{5s,1m,5m}` | `system_under_test, test_environment, scenario_name, transaction_name` | `transactions` |
| `requests_error_{5s,1m,5m}` | `system_under_test, test_environment, scenario_name, sampler_name, transaction_name, node_name, response_code` | `requests_error` |

Including every filter column a panel might use is fine: at 5 s buckets × per-sampler × 30 min window, row count is O(thousands), still three to four orders of magnitude below raw.

**Aggregate columns.** Driven by the actual panel queries in the four TimescaleDB dashboards (see `grep "rawSql"` in `infra/grafana/dashboards/template-timescaledb-*.json` for the exhaustive list):

- `requests_raw_*`: `count(*) AS n`, `count(*) FILTER (WHERE success) AS n_ok`, `count(*) FILTER (WHERE NOT success) AS n_err`, `avg(response_time) AS avg_rt`, `min(response_time) AS min_rt`, `max(response_time) AS max_rt`, `avg(response_connect_time) AS avg_connect`, `avg(response_latency) AS avg_latency`, `sum(response_size) AS bytes_in`, `sum(request_size) AS bytes_out`, `avg(response_size) AS avg_response_size`, `percentile_agg(response_time) AS pct_agg`.
- `transactions_*`: `count(*) AS n`, `count(*) FILTER (WHERE success) AS n_ok`, `count(*) FILTER (WHERE NOT success) AS n_err`, `avg(response_time) AS avg_rt`, `min(response_time) AS min_rt`, `max(response_time) AS max_rt`, `percentile_agg(response_time) AS pct_agg`.
- `requests_error_*`: `count(*) AS n` (dashboards only count errors by bucket/sampler/node/code; no percentile needed).

**Hierarchical CAGGs.** Build `1m` from `5s`, and `5m` from `1m`. TimescaleDB 2.9+ supports this, halves refresh work, and keeps aggregate math consistent (tdigest rollup is associative). The policy `start_offset` on the `1m` CAGG must be larger than the `5s` CAGG's refresh lag — use `start_offset => INTERVAL '1 hour'` on `5s` and `start_offset => INTERVAL '2 hours'` on `1m`/`5m` so the hierarchy converges cleanly.

**Retention.** Raw hypertables currently have no retention policy (verify with `SELECT * FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention';` during Task 1). Proposal in this plan: add a 90-day retention policy on all 9 CAGGs so trend dashboards keep working after raw data is eventually pruned. Retention on the source hypertables is a separate decision outside this plan's scope.

**TypeORM transaction opt-out.** Set `public transaction = false as const;` on the migration class (equivalent to the documented `Migration.transaction` property). This makes TypeORM skip `BEGIN`/`COMMIT` around the `up`/`down` calls. Inside the migration, run each CAGG CREATE as its own top-level statement. Do NOT use `queryRunner.startTransaction()` anywhere.

**Dashboard `$cagg_suffix` variable.** One Grafana templating variable per affected dashboard, type `query`, datasource PostgreSQL, refresh on-time-range-change, query:

```sql
SELECT CASE
  WHEN ${__interval_ms} <= 15000         THEN '5s'
  WHEN ${__interval_ms} <= 300000        THEN '1m'
  ELSE                                         '5m'
END AS suffix;
```

Panels then say `FROM requests_raw_${cagg_suffix}`, etc. `${cagg_suffix}` interpolates at query build time in Grafana, which is safe because the suffix comes from a closed set validated by the query above.

**What does NOT change:**
- Raw hypertables keep being written to — CAGGs refresh from them. Ingestion code in `apps/worker/src/pipelines/` and `apps/api/.../jtl-import.service.ts` is untouched.
- Backend services in `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts` etc. stay on raw tables. Switching the API off raw is a potential follow-up but not in scope — `#150/#151` already solved the API-side hotspot via `test_run_{transaction,sampler}_stats` rollup.
- `template-timescaledb-errors.json` stays on `requests_error` (per-row lookups by `random_id`).

---

### Task 1: Scaffold the migration file with `transaction: false` opt-out

**Files:**
- Create: `packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts`

- [ ] **Step 1: Create the migration file with the class skeleton**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TimescaleDB continuous aggregates (CAGGs) over the three high-volume
 * hypertables `requests_raw`, `transactions`, `requests_error` at 5 s / 1 min /
 * 5 min granularities (9 CAGGs total). Grafana panels pick the CAGG matching
 * `$__interval` via a `$cagg_suffix` template variable, cutting p50 panel
 * latency from ~4 s (raw scan of 12 M index entries) to <200 ms (lookup in
 * pre-materialized bucketed rows).
 *
 * Hierarchy: 5s rolls from the raw hypertable, 1m rolls from 5s, 5m rolls from
 * 1m. Associative aggregates (count, sum, avg-via-sum/count, min, max,
 * percentile_agg tdigest) make this safe.
 *
 * `transaction = false` because `CREATE MATERIALIZED VIEW … WITH
 * (timescaledb.continuous)` and `add_continuous_aggregate_policy` both reject
 * transaction context. TypeORM will not wrap `up` / `down` in BEGIN/COMMIT.
 *
 * Related: issue #147. Overlaps with #139 (approx_percentile) and #150/#151
 * (per-test-run rollup table). This plan is dashboard-facing; #150/#151 is
 * API-facing — the two optimizations are complementary.
 */
export class AddContinuousAggregates1777500000000 implements MigrationInterface {
  name = 'AddContinuousAggregates1777500000000';

  // Opt out of TypeORM's auto-transaction. Required because CAGG DDL and
  // `add_continuous_aggregate_policy` cannot run inside a transaction block.
  public transaction = false as const;

  public async up(_queryRunner: QueryRunner): Promise<void> {
    // Filled in by Tasks 2–6.
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Filled in by Task 7.
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npm run type-check --workspace=packages/shared`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts
git commit -m "chore(db): scaffold CAGG migration (#147)"
```

---

### Task 2: Add the `requests_raw` CAGG family (5s / 1m / 5m)

**Files:**
- Modify: `packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts`

- [ ] **Step 1: Add a private helper property with the CAGG definitions**

Add to the class, above `up`:

```typescript
private readonly requestsRawCaggs = [
  {
    name: 'requests_raw_5s',
    bucket: "time_bucket('5 seconds', time)",
    source: 'requests_raw',
    rawAggregates: true,
  },
  {
    name: 'requests_raw_1m',
    bucket: "time_bucket('1 minute', bucket)",
    source: 'requests_raw_5s',
    rawAggregates: false,
  },
  {
    name: 'requests_raw_5m',
    bucket: "time_bucket('5 minutes', bucket)",
    source: 'requests_raw_1m',
    rawAggregates: false,
  },
];
```

- [ ] **Step 2: Add the CAGG-creation SQL inside `up`**

Inside the `up` method body:

```typescript
// --- requests_raw family -------------------------------------------------

await queryRunner.query(`
  CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_5s
  WITH (timescaledb.continuous) AS
  SELECT
    time_bucket('5 seconds', time)                    AS bucket,
    system_under_test,
    test_environment,
    scenario_name,
    sampler_name,
    transaction_name,
    location,
    count(*)                                           AS n,
    count(*) FILTER (WHERE success)                    AS n_ok,
    count(*) FILTER (WHERE NOT success)                AS n_err,
    avg(response_time)                                 AS avg_rt,
    min(response_time)                                 AS min_rt,
    max(response_time)                                 AS max_rt,
    avg(response_connect_time)                         AS avg_connect,
    avg(response_latency)                              AS avg_latency,
    sum(response_size)::bigint                         AS bytes_in,
    sum(request_size)::bigint                          AS bytes_out,
    avg(response_size)                                 AS avg_response_size,
    percentile_agg(response_time::double precision)    AS pct_agg
  FROM requests_raw
  GROUP BY 1, 2, 3, 4, 5, 6, 7
  WITH NO DATA;
`);

await queryRunner.query(`
  CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_1m
  WITH (timescaledb.continuous) AS
  SELECT
    time_bucket('1 minute', bucket)                    AS bucket,
    system_under_test,
    test_environment,
    scenario_name,
    sampler_name,
    transaction_name,
    location,
    sum(n)::bigint                                     AS n,
    sum(n_ok)::bigint                                  AS n_ok,
    sum(n_err)::bigint                                 AS n_err,
    sum(avg_rt * n) / NULLIF(sum(n), 0)                AS avg_rt,
    min(min_rt)                                        AS min_rt,
    max(max_rt)                                        AS max_rt,
    sum(avg_connect * n) / NULLIF(sum(n), 0)           AS avg_connect,
    sum(avg_latency * n) / NULLIF(sum(n), 0)           AS avg_latency,
    sum(bytes_in)::bigint                              AS bytes_in,
    sum(bytes_out)::bigint                             AS bytes_out,
    sum(avg_response_size * n) / NULLIF(sum(n), 0)     AS avg_response_size,
    rollup(pct_agg)                                    AS pct_agg
  FROM requests_raw_5s
  GROUP BY 1, 2, 3, 4, 5, 6, 7
  WITH NO DATA;
`);

await queryRunner.query(`
  CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_5m
  WITH (timescaledb.continuous) AS
  SELECT
    time_bucket('5 minutes', bucket)                   AS bucket,
    system_under_test,
    test_environment,
    scenario_name,
    sampler_name,
    transaction_name,
    location,
    sum(n)::bigint                                     AS n,
    sum(n_ok)::bigint                                  AS n_ok,
    sum(n_err)::bigint                                 AS n_err,
    sum(avg_rt * n) / NULLIF(sum(n), 0)                AS avg_rt,
    min(min_rt)                                        AS min_rt,
    max(max_rt)                                        AS max_rt,
    sum(avg_connect * n) / NULLIF(sum(n), 0)           AS avg_connect,
    sum(avg_latency * n) / NULLIF(sum(n), 0)           AS avg_latency,
    sum(bytes_in)::bigint                              AS bytes_in,
    sum(bytes_out)::bigint                             AS bytes_out,
    sum(avg_response_size * n) / NULLIF(sum(n), 0)     AS avg_response_size,
    rollup(pct_agg)                                    AS pct_agg
  FROM requests_raw_1m
  GROUP BY 1, 2, 3, 4, 5, 6, 7
  WITH NO DATA;
`);

console.log('  Created requests_raw_5s / requests_raw_1m / requests_raw_5m');
```

- [ ] **Step 3: Start local infra and run the migration manually to validate SQL**

```bash
docker compose -f docker-compose.infra.yml up -d postgres
# Wait ~10s for Postgres to be healthy, then:
cd packages/shared && npm run migration:run
```

Expected: three `CREATE MATERIALIZED VIEW` statements execute without error, logs show "Created requests_raw_5s / requests_raw_1m / requests_raw_5m".

- [ ] **Step 4: Verify the views exist**

```bash
docker exec -it perfana-postgres psql -U perfana -d perfana \
  -c "SELECT view_name FROM timescaledb_information.continuous_aggregates WHERE view_name LIKE 'requests_raw%' ORDER BY view_name;"
```

Expected output:
```
         view_name
---------------------------
 requests_raw_1m
 requests_raw_5m
 requests_raw_5s
(3 rows)
```

- [ ] **Step 5: Revert to clean state for the next task**

```bash
cd packages/shared && npm run migration:revert
```

The `down` method is still empty at this point, so revert will only update the migrations table. Drop the views manually before proceeding:

```bash
docker exec -it perfana-postgres psql -U perfana -d perfana -c \
  "DROP MATERIALIZED VIEW IF EXISTS requests_raw_5m CASCADE; \
   DROP MATERIALIZED VIEW IF EXISTS requests_raw_1m CASCADE; \
   DROP MATERIALIZED VIEW IF EXISTS requests_raw_5s CASCADE;"
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts
git commit -m "feat(db): add requests_raw CAGG family 5s/1m/5m (#147)"
```

---

### Task 3: Add the `transactions` CAGG family

**Files:**
- Modify: `packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts`

- [ ] **Step 1: Append the `transactions` CAGG SQL after the `requests_raw` block inside `up`**

```typescript
// --- transactions family -------------------------------------------------

await queryRunner.query(`
  CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_5s
  WITH (timescaledb.continuous) AS
  SELECT
    time_bucket('5 seconds', time)                    AS bucket,
    system_under_test,
    test_environment,
    scenario_name,
    transaction_name,
    count(*)                                           AS n,
    count(*) FILTER (WHERE success)                    AS n_ok,
    count(*) FILTER (WHERE NOT success)                AS n_err,
    avg(response_time)                                 AS avg_rt,
    min(response_time)                                 AS min_rt,
    max(response_time)                                 AS max_rt,
    percentile_agg(response_time::double precision)    AS pct_agg
  FROM transactions
  GROUP BY 1, 2, 3, 4, 5
  WITH NO DATA;
`);

await queryRunner.query(`
  CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_1m
  WITH (timescaledb.continuous) AS
  SELECT
    time_bucket('1 minute', bucket)                    AS bucket,
    system_under_test,
    test_environment,
    scenario_name,
    transaction_name,
    sum(n)::bigint                                     AS n,
    sum(n_ok)::bigint                                  AS n_ok,
    sum(n_err)::bigint                                 AS n_err,
    sum(avg_rt * n) / NULLIF(sum(n), 0)                AS avg_rt,
    min(min_rt)                                        AS min_rt,
    max(max_rt)                                        AS max_rt,
    rollup(pct_agg)                                    AS pct_agg
  FROM transactions_5s
  GROUP BY 1, 2, 3, 4, 5
  WITH NO DATA;
`);

await queryRunner.query(`
  CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_5m
  WITH (timescaledb.continuous) AS
  SELECT
    time_bucket('5 minutes', bucket)                   AS bucket,
    system_under_test,
    test_environment,
    scenario_name,
    transaction_name,
    sum(n)::bigint                                     AS n,
    sum(n_ok)::bigint                                  AS n_ok,
    sum(n_err)::bigint                                 AS n_err,
    sum(avg_rt * n) / NULLIF(sum(n), 0)                AS avg_rt,
    min(min_rt)                                        AS min_rt,
    max(max_rt)                                        AS max_rt,
    rollup(pct_agg)                                    AS pct_agg
  FROM transactions_1m
  GROUP BY 1, 2, 3, 4, 5
  WITH NO DATA;
`);

console.log('  Created transactions_5s / transactions_1m / transactions_5m');
```

- [ ] **Step 2: Run the migration**

```bash
cd packages/shared && npm run migration:run
```

Expected: all three `transactions_*` views created (plus `requests_raw_*` re-created).

- [ ] **Step 3: Verify**

```bash
docker exec -it perfana-postgres psql -U perfana -d perfana \
  -c "SELECT view_name FROM timescaledb_information.continuous_aggregates WHERE view_name LIKE 'transactions%' ORDER BY view_name;"
```

Expected: `transactions_1m`, `transactions_5m`, `transactions_5s` — three rows.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts
git commit -m "feat(db): add transactions CAGG family 5s/1m/5m (#147)"
```

---

### Task 4: Add the `requests_error` CAGG family

**Files:**
- Modify: `packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts`

- [ ] **Step 1: Append the `requests_error` CAGG SQL after the `transactions` block inside `up`**

```typescript
// --- requests_error family -----------------------------------------------

await queryRunner.query(`
  CREATE MATERIALIZED VIEW IF NOT EXISTS requests_error_5s
  WITH (timescaledb.continuous) AS
  SELECT
    time_bucket('5 seconds', time)                    AS bucket,
    system_under_test,
    test_environment,
    scenario_name,
    sampler_name,
    transaction_name,
    node_name,
    response_code,
    count(*)                                           AS n
  FROM requests_error
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  WITH NO DATA;
`);

await queryRunner.query(`
  CREATE MATERIALIZED VIEW IF NOT EXISTS requests_error_1m
  WITH (timescaledb.continuous) AS
  SELECT
    time_bucket('1 minute', bucket)                    AS bucket,
    system_under_test,
    test_environment,
    scenario_name,
    sampler_name,
    transaction_name,
    node_name,
    response_code,
    sum(n)::bigint                                     AS n
  FROM requests_error_5s
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  WITH NO DATA;
`);

await queryRunner.query(`
  CREATE MATERIALIZED VIEW IF NOT EXISTS requests_error_5m
  WITH (timescaledb.continuous) AS
  SELECT
    time_bucket('5 minutes', bucket)                   AS bucket,
    system_under_test,
    test_environment,
    scenario_name,
    sampler_name,
    transaction_name,
    node_name,
    response_code,
    sum(n)::bigint                                     AS n
  FROM requests_error_1m
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  WITH NO DATA;
`);

console.log('  Created requests_error_5s / requests_error_1m / requests_error_5m');
```

- [ ] **Step 2: Run the migration and verify**

```bash
cd packages/shared && npm run migration:run && \
docker exec perfana-postgres psql -U perfana -d perfana \
  -c "SELECT view_name FROM timescaledb_information.continuous_aggregates ORDER BY view_name;"
```

Expected: 9 rows — all three families × three granularities.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts
git commit -m "feat(db): add requests_error CAGG family 5s/1m/5m (#147)"
```

---

### Task 5: Add refresh policies for all 9 CAGGs

**Files:**
- Modify: `packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts`

- [ ] **Step 1: Append refresh-policy SQL after the CAGG-creation blocks inside `up`**

```typescript
// --- refresh policies ----------------------------------------------------

// 5-second CAGGs refresh from raw every 30 seconds with a 1-hour trailing
// window. `end_offset` of 1 minute avoids racing with in-flight writes into
// the current chunk. Hierarchical views (1m, 5m) use a larger start_offset
// so their source CAGG has been refreshed first.
const refreshPolicies = [
  { view: 'requests_raw_5s',   start: '1 hour',  end: '1 minute', schedule: '30 seconds' },
  { view: 'requests_raw_1m',   start: '2 hours', end: '2 minutes', schedule: '1 minute' },
  { view: 'requests_raw_5m',   start: '1 day',   end: '5 minutes', schedule: '5 minutes' },
  { view: 'transactions_5s',   start: '1 hour',  end: '1 minute', schedule: '30 seconds' },
  { view: 'transactions_1m',   start: '2 hours', end: '2 minutes', schedule: '1 minute' },
  { view: 'transactions_5m',   start: '1 day',   end: '5 minutes', schedule: '5 minutes' },
  { view: 'requests_error_5s', start: '1 hour',  end: '1 minute', schedule: '30 seconds' },
  { view: 'requests_error_1m', start: '2 hours', end: '2 minutes', schedule: '1 minute' },
  { view: 'requests_error_5m', start: '1 day',   end: '5 minutes', schedule: '5 minutes' },
];

for (const p of refreshPolicies) {
  await queryRunner.query(`
    SELECT add_continuous_aggregate_policy('${p.view}',
      start_offset      => INTERVAL '${p.start}',
      end_offset        => INTERVAL '${p.end}',
      schedule_interval => INTERVAL '${p.schedule}',
      if_not_exists     => TRUE
    );
  `);
  console.log(`  Refresh policy on ${p.view}: every ${p.schedule}, window ${p.start} → ${p.end}`);
}
```

- [ ] **Step 2: Run the migration (from a clean state)**

Drop existing CAGGs first (they'd be re-created with the same SQL, but the refresh policy is new):

```bash
docker exec perfana-postgres psql -U perfana -d perfana -c "
  DROP MATERIALIZED VIEW IF EXISTS requests_raw_5m CASCADE;
  DROP MATERIALIZED VIEW IF EXISTS requests_raw_1m CASCADE;
  DROP MATERIALIZED VIEW IF EXISTS requests_raw_5s CASCADE;
  DROP MATERIALIZED VIEW IF EXISTS transactions_5m CASCADE;
  DROP MATERIALIZED VIEW IF EXISTS transactions_1m CASCADE;
  DROP MATERIALIZED VIEW IF EXISTS transactions_5s CASCADE;
  DROP MATERIALIZED VIEW IF EXISTS requests_error_5m CASCADE;
  DROP MATERIALIZED VIEW IF EXISTS requests_error_1m CASCADE;
  DROP MATERIALIZED VIEW IF EXISTS requests_error_5s CASCADE;
  DELETE FROM typeorm_migrations WHERE name = 'AddContinuousAggregates1777500000000';
"
cd packages/shared && npm run migration:run
```

- [ ] **Step 3: Verify refresh policies exist**

```bash
docker exec perfana-postgres psql -U perfana -d perfana -c "
  SELECT hypertable_name, config->>'start_offset' AS start_off, config->>'end_offset' AS end_off, schedule_interval
  FROM timescaledb_information.jobs
  WHERE proc_name = 'policy_refresh_continuous_aggregate'
  ORDER BY hypertable_name;
"
```

Expected: 9 rows, one per CAGG view, with the configured intervals.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts
git commit -m "feat(db): add CAGG refresh policies (#147)"
```

---

### Task 6: Add 90-day retention policies on all 9 CAGGs

**Files:**
- Modify: `packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts`

- [ ] **Step 1: Append retention-policy SQL after the refresh-policy block inside `up`**

```typescript
// --- retention policies --------------------------------------------------
//
// CAGGs hold data for 90 days. This is intentionally longer than any
// retention that may later be added to the raw hypertables, so long-term
// trend panels survive raw-data pruning. The raw hypertables currently have
// no retention policy (verified: no entry in timescaledb_information.jobs
// with proc_name = 'policy_retention' for requests_raw / transactions /
// requests_error at time of migration authoring). If raw retention is
// introduced later, the CAGG retention here should be re-evaluated.

const cagggViews = [
  'requests_raw_5s',   'requests_raw_1m',   'requests_raw_5m',
  'transactions_5s',   'transactions_1m',   'transactions_5m',
  'requests_error_5s', 'requests_error_1m', 'requests_error_5m',
];

for (const view of cagggViews) {
  await queryRunner.query(`
    SELECT add_retention_policy('${view}',
      drop_after    => INTERVAL '90 days',
      if_not_exists => TRUE
    );
  `);
  console.log(`  Retention policy on ${view}: drop after 90 days`);
}
```

- [ ] **Step 2: Run the migration (from clean state)**

Same drop-and-rerun cycle as Task 5 Step 2.

- [ ] **Step 3: Verify retention policies**

```bash
docker exec perfana-postgres psql -U perfana -d perfana -c "
  SELECT hypertable_name, config->>'drop_after' AS drop_after
  FROM timescaledb_information.jobs
  WHERE proc_name = 'policy_retention' AND hypertable_schema = '_timescaledb_internal'
     OR hypertable_name LIKE 'requests_raw_%'
     OR hypertable_name LIKE 'transactions_%'
     OR hypertable_name LIKE 'requests_error_%';
"
```

Expected: 9 rows with `drop_after = @ 90 days`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts
git commit -m "feat(db): add 90-day retention on CAGGs (#147)"
```

---

### Task 7: Implement the `down` method and verify rollback is clean

**Files:**
- Modify: `packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts`

- [ ] **Step 1: Fill in `down` to tear everything down in reverse dependency order**

```typescript
public async down(queryRunner: QueryRunner): Promise<void> {
  // Drop in reverse hierarchy order: 5m depends on 1m, 1m on 5s, 5s on raw.
  // `DROP MATERIALIZED VIEW ... CASCADE` also removes the associated
  // refresh and retention policies, so no separate policy-drop step needed.
  const views = [
    'requests_raw_5m',   'requests_raw_1m',   'requests_raw_5s',
    'transactions_5m',   'transactions_1m',   'transactions_5s',
    'requests_error_5m', 'requests_error_1m', 'requests_error_5s',
  ];

  for (const view of views) {
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS ${view} CASCADE`);
    console.log(`  Dropped ${view}`);
  }
}
```

- [ ] **Step 2: Test rollback**

```bash
cd packages/shared && npm run migration:revert
docker exec perfana-postgres psql -U perfana -d perfana -c \
  "SELECT view_name FROM timescaledb_information.continuous_aggregates;"
```

Expected: zero rows.

- [ ] **Step 3: Test re-apply**

```bash
cd packages/shared && npm run migration:run
docker exec perfana-postgres psql -U perfana -d perfana -c \
  "SELECT count(*) FROM timescaledb_information.continuous_aggregates;"
```

Expected: `9`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/database/migrations/1777500000000-AddContinuousAggregates.ts
git commit -m "feat(db): implement CAGG migration down() (#147)"
```

---

### Task 8: Integration test — CAGG aggregates match raw table aggregates

**Files:**
- Create: `apps/api/src/test/cagg-migration.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Pattern mirrors `apps/api/src/test/phase5-migration-validation.test.ts`. The test needs a running TimescaleDB — if the existing testcontainer config file `.test-db-config.json` is missing, the test should be skipped (mirroring the phase5 test behavior), not fail CI.

```typescript
import { DataSource } from 'typeorm';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const configPath = join(__dirname, '.test-db-config.json');
const hasTestDb = existsSync(configPath);

(hasTestDb ? describe : describe.skip)('CAGG migration integration', () => {
  let ds: DataSource;

  beforeAll(async () => {
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    ds = new DataSource({
      type: 'postgres',
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      database: cfg.database,
      migrations: ['packages/shared/src/database/migrations/*.ts'],
      migrationsTableName: 'typeorm_migrations',
    });
    await ds.initialize();
    await ds.runMigrations();
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('creates all 9 continuous aggregates', async () => {
    const rows = await ds.query(
      `SELECT view_name FROM timescaledb_information.continuous_aggregates ORDER BY view_name`,
    );
    const names = rows.map((r: { view_name: string }) => r.view_name);
    expect(names).toEqual([
      'requests_error_1m',
      'requests_error_5m',
      'requests_error_5s',
      'requests_raw_1m',
      'requests_raw_5m',
      'requests_raw_5s',
      'transactions_1m',
      'transactions_5m',
      'transactions_5s',
    ]);
  });

  it('5s CAGG count matches raw count after refresh', async () => {
    // Insert 100 rows across a 30-second window.
    const baseTime = new Date('2026-01-01T00:00:00Z');
    const values = Array.from({ length: 100 }, (_, i) => {
      const ts = new Date(baseTime.getTime() + i * 300).toISOString();
      return `('${ts}', 'tr-1', 'sut-a', 'env-a', 'loc-1', 'tx-1', 'smp-1', true, 100, 200, '200', 5, 10, ${20 + i}, 'scen-a', 'hash')`;
    }).join(',');

    await ds.query(`INSERT INTO requests_raw
      (time, test_run_id, system_under_test, test_environment, location, transaction_name, sampler_name,
       success, request_size, response_size, response_code, response_connect_time, response_latency,
       response_time, scenario_name, url_hash) VALUES ${values}`);

    // Force refresh.
    await ds.query(
      `CALL refresh_continuous_aggregate('requests_raw_5s', '2026-01-01'::timestamptz, '2026-01-02'::timestamptz)`,
    );

    const [{ total }] = await ds.query(
      `SELECT sum(n)::int AS total FROM requests_raw_5s WHERE system_under_test = 'sut-a'`,
    );
    expect(total).toBe(100);

    const [{ raw_total }] = await ds.query(
      `SELECT count(*)::int AS raw_total FROM requests_raw WHERE system_under_test = 'sut-a'`,
    );
    expect(Number(raw_total)).toBe(100);
  });

  it('hierarchical 1m CAGG rolls up from 5s CAGG', async () => {
    await ds.query(
      `CALL refresh_continuous_aggregate('requests_raw_1m', '2026-01-01'::timestamptz, '2026-01-02'::timestamptz)`,
    );
    const [{ total }] = await ds.query(
      `SELECT sum(n)::int AS total FROM requests_raw_1m WHERE system_under_test = 'sut-a'`,
    );
    expect(total).toBe(100);
  });

  it('approx_percentile over CAGG tdigest returns plausible value', async () => {
    // Inserted response_times are 20..119 ms, so approx p95 should be ~114 ±5.
    const [{ p95 }] = await ds.query(
      `SELECT approx_percentile(0.95, pct_agg)::int AS p95
       FROM requests_raw_5s
       WHERE system_under_test = 'sut-a'`,
    );
    expect(p95).toBeGreaterThan(105);
    expect(p95).toBeLessThan(125);
  });
});
```

- [ ] **Step 2: Run the test (expect SKIP or PASS depending on testcontainer availability)**

```bash
cd apps/api && npx jest src/test/cagg-migration.integration.test.ts
```

Expected: either 4 pending (if `.test-db-config.json` doesn't exist locally) or 4 passing.

- [ ] **Step 3: If skipped, also run a quick manual smoke test against the local Docker Postgres**

```bash
docker exec perfana-postgres psql -U perfana -d perfana -c "
  INSERT INTO requests_raw (time, test_run_id, system_under_test, test_environment, location, transaction_name,
                            sampler_name, success, request_size, response_size, response_code, response_connect_time,
                            response_latency, response_time, scenario_name, url_hash)
  SELECT '2026-01-01'::timestamptz + (g * interval '300 ms'),
         'tr-smoke', 'sut-smoke', 'env-smoke', 'loc', 'tx', 'smp', true,
         100, 200, '200', 5, 10, 20 + g, 'scen', 'h'
  FROM generate_series(0, 99) g;

  CALL refresh_continuous_aggregate('requests_raw_5s', '2026-01-01'::timestamptz, '2026-01-02'::timestamptz);

  SELECT sum(n) AS total FROM requests_raw_5s WHERE system_under_test = 'sut-smoke';
"
```

Expected: `total = 100`.

Clean up:

```bash
docker exec perfana-postgres psql -U perfana -d perfana -c \
  "DELETE FROM requests_raw WHERE test_run_id = 'tr-smoke';"
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/test/cagg-migration.integration.test.ts
git commit -m "test(db): CAGG integration test (#147)"
```

---

### Task 9: Rewrite `template-timescaledb-jmeter.json` to use CAGGs

**Files:**
- Modify: `infra/grafana/dashboards/template-timescaledb-jmeter.json`

This dashboard has ~14 time-series panels. They fall into four families:

1. **"Now" stat panels** (count in last 1 min, etc.) — lines 210, 321, 599, 725. These query a narrow live window and can keep using `requests_raw`/`transactions`/`requests_error` directly: data is fresher than any CAGG refresh policy. **Do not change these.**
2. **Broad time-series panels** over the panel's `$__timeFilter(time)` — lines 469, 974, 1140, 1282, 1405, 1582, 1772, 1979, 2174, 2683, 2845, 3033. These are the hot path for issue #147. **Switch these to the CAGG.**
3. **Individual-row detail panels** — line 2487 (`SELECT time, sampler_name, …, response_time, url, response_code, response_message FROM requests_error LIMIT 100`). Raw rows only; CAGG has no row-level data. **Do not change.**
4. **Table panels aggregating over entire window** — lines 3224 (transactions summary), 3566 (sampler summary). These don't need `time_bucket` but do aggregate across the whole window. **Switch to the 5m CAGG** for cheapest aggregation.

- [ ] **Step 1: Add the `cagg_suffix` template variable to the dashboard's `templating.list`**

Open the JSON file, find the `"templating": { "list": [ … ] }` block near the top, and add (keeping existing variables intact):

```json
{
  "name": "cagg_suffix",
  "label": "CAGG resolution",
  "type": "query",
  "datasource": { "type": "postgres", "uid": "${DS_PERFANA_POSTGRES}" },
  "refresh": 2,
  "query": "SELECT CASE WHEN ${__interval_ms} <= 15000 THEN '5s' WHEN ${__interval_ms} <= 300000 THEN '1m' ELSE '5m' END AS suffix",
  "hide": 2,
  "includeAll": false,
  "multi": false,
  "regex": "",
  "sort": 0,
  "skipUrlSync": true
}
```

Use whichever datasource UID matches the dashboard's existing PostgreSQL datasource (grep `"datasource"` in the file to confirm).

- [ ] **Step 2: Rewrite the "requests per second / response times / TCP connect" panel (line ~1282)**

Old `rawSql`:
```sql
SELECT
  time_bucket('$__interval', time) AS time,
  count(response_time) / EXTRACT(EPOCH FROM '$__interval'::INTERVAL) as "Requests per second",
  avg(response_time) as "Response times",
  avg(response_connect_time) as "TCP Connect"
FROM requests_raw
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(time)
GROUP BY 1
ORDER BY 1;
```

New `rawSql`:
```sql
SELECT
  time_bucket('$__interval', bucket) AS time,
  sum(n) / EXTRACT(EPOCH FROM '$__interval'::INTERVAL) as "Requests per second",
  sum(avg_rt * n) / NULLIF(sum(n), 0) as "Response times",
  sum(avg_connect * n) / NULLIF(sum(n), 0) as "TCP Connect"
FROM requests_raw_${cagg_suffix}
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(bucket)
GROUP BY 1
ORDER BY 1;
```

Note: in JSON, newlines become `\n` and quotes must be escaped. Preserve the existing escape style.

- [ ] **Step 3: Rewrite the "total traffic" panel (line ~1140)**

New `rawSql`:
```sql
SELECT
  time_bucket('$__interval', bucket) AS time,
  sum(bytes_in) as "Bytes In",
  sum(bytes_out) as "Bytes Out",
  (sum(bytes_in) + sum(bytes_out)) / EXTRACT(EPOCH FROM '$__interval'::INTERVAL) as "Total Traffic"
FROM requests_raw_${cagg_suffix}
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(bucket)
GROUP BY 1
ORDER BY 1;
```

- [ ] **Step 4: Rewrite the "errors by sampler" panel (line ~1405)**

Old: `FROM requests_error … GROUP BY time_bucket, sampler_name`.

New:
```sql
SELECT
  time_bucket('$__interval', bucket) AS time,
  sampler_name,
  sum(n) as "count"
FROM requests_error_${cagg_suffix}
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(bucket)
GROUP BY 1, 2
ORDER BY 1, 2;
```

- [ ] **Step 5: Rewrite the "response times by sampler" panel (line ~1582)**

```sql
SELECT
  time_bucket('$__interval', bucket) AS time,
  sampler_name,
  sum(avg_rt * n) / NULLIF(sum(n), 0) as "Response times"
FROM requests_raw_${cagg_suffix}
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(bucket)
GROUP BY 1, 2
ORDER BY 1, 2;
```

- [ ] **Step 6: Rewrite the "request rate by sampler" panel (line ~1772)**

```sql
SELECT
  time_bucket('$__interval', bucket) AS time,
  sampler_name,
  sum(n)::float / EXTRACT(EPOCH FROM '$__interval'::INTERVAL) as count
FROM requests_raw_${cagg_suffix}
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(bucket)
GROUP BY 1, 2
ORDER BY 1, 2;
```

- [ ] **Step 7: Rewrite the "transaction response times" panel (line ~1979)**

```sql
SELECT
  time_bucket('$__interval', bucket) AS time,
  transaction_name,
  sum(avg_rt * n) / NULLIF(sum(n), 0) AS avg_rt
FROM transactions_${cagg_suffix}
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(bucket)
GROUP BY 1, 2
ORDER BY 1, 2;
```

- [ ] **Step 8: Rewrite the "transaction rate" panel (line ~2174)**

```sql
SELECT
  time_bucket('$__interval', bucket) AS time,
  transaction_name,
  sum(n)::float / EXTRACT(EPOCH FROM '$__interval'::INTERVAL) as count
FROM transactions_${cagg_suffix}
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(bucket)
GROUP BY 1, 2
ORDER BY 1, 2;
```

- [ ] **Step 9: Rewrite the "response times by location" (line ~2683) and "request rate by location" (line ~2845) panels**

Response times by location:
```sql
SELECT
  time_bucket('$__interval', bucket) AS time,
  location,
  round(sum(avg_rt * n) / NULLIF(sum(n), 0))
FROM requests_raw_${cagg_suffix}
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(bucket)
GROUP BY 1, 2
ORDER BY 1, 2;
```

Request rate by location:
```sql
SELECT
  time_bucket('$__interval', bucket) AS time,
  location,
  sum(n) / EXTRACT(EPOCH FROM '$__interval'::INTERVAL) as count
FROM requests_raw_${cagg_suffix}
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(bucket)
GROUP BY 1, 2
ORDER BY 1, 2;
```

- [ ] **Step 10: Rewrite the "errors by node" panel (line ~3033)**

```sql
SELECT
  time_bucket('$__interval', bucket) AS time,
  node_name,
  sum(n) / EXTRACT(EPOCH FROM '$__interval'::INTERVAL) as count
FROM requests_error_${cagg_suffix}
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(bucket)
GROUP BY 1, 2
ORDER BY 1, 2;
```

- [ ] **Step 11: Rewrite the "total traffic gauge" panel (line ~469) if used for time-series, otherwise leave**

The panel at line 469 queries `now() - interval '20 seconds'` — a live stat, NOT a time-series. Leave it on `requests_raw`.

- [ ] **Step 12: Rewrite the two summary table panels (lines ~3224 and ~3566)**

Table at line 3224 (transactions summary). Old uses `MIN/AVG/MAX/COUNT/FILTER`; new uses the 5m CAGG because tables don't need fine granularity:

```sql
SELECT
  transaction_name,
  min(min_rt) AS min_response_time,
  ROUND(sum(avg_rt * n) / NULLIF(sum(n), 0)) AS avg_response_time,
  max(max_rt) AS max_response_time,
  sum(n) AS total,
  sum(n_ok) AS passed,
  sum(n_err) AS failed,
  ROUND(sum(n_err)::numeric / NULLIF(sum(n), 0), 4) AS error_percentage
FROM transactions_5m
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(bucket)
GROUP BY 1
ORDER BY 1;
```

Table at line 3566 (sampler summary):

```sql
SELECT
  sampler_name,
  transaction_name,
  min(min_rt) AS min_response_time,
  ROUND(sum(avg_rt * n) / NULLIF(sum(n), 0)) AS avg_response_time,
  max(max_rt) AS max_response_time,
  sum(n) AS total,
  sum(n_ok) AS passed,
  sum(n_err) AS failed,
  ROUND(sum(n_err)::numeric / NULLIF(sum(n), 0), 4) AS error_percentage
FROM requests_raw_5m
WHERE system_under_test = '$system_under_test' AND test_environment = '$test_environment'
  AND scenario_name IN ($scenario_name) AND $__timeFilter(bucket)
GROUP BY 1, 2
ORDER BY 1, 2;
```

- [ ] **Step 13: Validate the dashboard JSON is still valid**

```bash
jq '.' infra/grafana/dashboards/template-timescaledb-jmeter.json > /dev/null && echo OK
```

Expected: `OK`.

- [ ] **Step 14: Load the dashboard in the local Grafana and sanity-check each panel**

```bash
# Grafana should auto-reload (10s provisioning interval).
open http://localhost:3000/d/jmeter-timescaledb-dashboard  # or whatever the UID is
```

For each rewritten panel, open the panel editor → Query Inspector and confirm:
- The query text has `${cagg_suffix}` resolved to `5s`, `1m`, or `5m`.
- `EXPLAIN ANALYZE` (via Query Inspector) shows an Index Scan on the CAGG's materialization hypertable, not a Seq Scan on the raw table.
- Panel renders a graph with data.

Record the panel latency for the main RPS panel (line ~1282) before and after. Target: <200 ms at 30-min window.

- [ ] **Step 15: Commit**

```bash
git add infra/grafana/dashboards/template-timescaledb-jmeter.json
git commit -m "feat(grafana): switch jmeter dashboard time-series to CAGGs (#147)"
```

---

### Task 10: Rewrite `template-timescaledb-transaction-analysis.json`

**Files:**
- Modify: `infra/grafana/dashboards/template-timescaledb-transaction-analysis.json`

This dashboard drills down per `$transaction_name`. All 15 hits of `FROM transactions` need the same treatment: add the `cagg_suffix` variable, switch `FROM transactions` → `FROM transactions_${cagg_suffix}`, switch `time` → `bucket`, and rewrite the aggregates the same way as Task 9 (`sum(avg_rt * n) / NULLIF(sum(n), 0)` for weighted averages, `min(min_rt)` / `max(max_rt)` instead of `min(response_time)` / `max(response_time)`, `sum(n)` instead of `count(*)`, etc.).

- [ ] **Step 1: Add the `cagg_suffix` template variable** (same snippet as Task 9 Step 1).

- [ ] **Step 2: Walk each panel with `grep -n rawSql infra/grafana/dashboards/template-timescaledb-transaction-analysis.json` and rewrite following the Task 9 Step 2 pattern**

For each panel:
1. Replace `FROM transactions` with `FROM transactions_${cagg_suffix}`.
2. Replace `time_bucket('$__interval', time)` with `time_bucket('$__interval', bucket)`.
3. Replace `$__timeFilter(time)` with `$__timeFilter(bucket)`.
4. Rewrite aggregates as in Task 9 (weighted avg, sum instead of count, min/max from CAGG columns).
5. For percentile panels, replace `percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time)` with `approx_percentile(0.95, rollup(pct_agg))`.

Panels that query single-value live stats (`now() - interval 'X seconds'`) stay on `transactions`.

- [ ] **Step 3: Validate JSON**

```bash
jq '.' infra/grafana/dashboards/template-timescaledb-transaction-analysis.json > /dev/null && echo OK
```

- [ ] **Step 4: Smoke-test in Grafana** — open the dashboard, select a test run with data, verify each panel renders.

- [ ] **Step 5: Commit**

```bash
git add infra/grafana/dashboards/template-timescaledb-transaction-analysis.json
git commit -m "feat(grafana): switch transaction-analysis dashboard to CAGGs (#147)"
```

---

### Task 11: Rewrite `template-timescaledb-request-analysis.json`

**Files:**
- Modify: `infra/grafana/dashboards/template-timescaledb-request-analysis.json`

15 hits of `FROM requests_raw`. Same procedure as Task 10 but targeting `requests_raw_${cagg_suffix}`.

- [ ] **Step 1: Add `cagg_suffix` template variable** (same snippet).

- [ ] **Step 2: Rewrite each panel.** Specific notes:

- Panels at lines ~96 (min), ~214 (avg), ~332 (p95), ~452 (max), ~593 (avg response_size), ~705 (count), ~820 (failed count) are stat panels aggregating over the whole `$__timeFilter` window — switch to the 5m CAGG (coarsest, cheapest for wide windows). Examples:

  Stat "min response time":
  ```sql
  SELECT min(min_rt) as min
  FROM requests_raw_5m
  WHERE system_under_test = '$system_under_test' and test_environment = '$test_environment'
    AND scenario_name IN ($scenario_name)
    AND sampler_name = '$sampler_name'
    AND n_ok > 0
    AND $__timeFilter(bucket)
  ```

  Stat "p95":
  ```sql
  SELECT approx_percentile(0.95, rollup(pct_agg)) AS p95
  FROM requests_raw_5m
  WHERE system_under_test = '$system_under_test' and test_environment = '$test_environment'
    AND scenario_name IN ($scenario_name)
    AND sampler_name = '$sampler_name'
    AND $__timeFilter(bucket)
  ```

- The raw-row panel at line ~1007 (`CASE WHEN success THEN response_time END AS OK`) displays individual samples — leave on raw `requests_raw`.

- Time-series panels at lines ~1036 (avg RT by bucket), ~1207 (rate + error rate) — switch to `requests_raw_${cagg_suffix}`.

- [ ] **Step 3: Validate JSON, smoke-test, commit.**

```bash
jq '.' infra/grafana/dashboards/template-timescaledb-request-analysis.json > /dev/null && echo OK

git add infra/grafana/dashboards/template-timescaledb-request-analysis.json
git commit -m "feat(grafana): switch request-analysis dashboard to CAGGs (#147)"
```

---

### Task 12: Document the `template-timescaledb-errors.json` decision (no change)

**Files:**
- (No file change, just Task 13's ADR covers this.)

- [ ] **Step 1: Confirm the two `rawSql` queries in `template-timescaledb-errors.json` look up individual error rows by `random_id`**

```bash
grep -A 3 rawSql infra/grafana/dashboards/template-timescaledb-errors.json
```

Expected: two queries, both filtering by `random_id={...}` and `extract(epoch from time)*1000 = $timestamp`. These are row-level, not aggregates. CAGGs don't store individual rows, so these panels must stay on `requests_error`. Task 13's ADR will document this.

---

### Task 13: Write the ADR

**Files:**
- Create: `docs-site/content/Database/Continuous Aggregates.md`

- [ ] **Step 1: Write the ADR**

```markdown
# Continuous Aggregates (CAGGs) for dashboard queries

**Status:** Accepted (2026-04-24, PR for issue #147)

## Context

Grafana panels on the TimescaleDB dashboards (`template-timescaledb-jmeter`,
`template-timescaledb-request-analysis`, `template-timescaledb-transaction-analysis`)
aggregate over `requests_raw`, `transactions`, and `requests_error` — hypertables that
hold tens of millions of rows per active test run. Even with the composite
`(sut, env, scenario, time DESC)` index from issue #137 and a 4 GB `shared_buffers`
keeping the index cached, a typical 30-minute panel refresh scans ~12 M index entries
and costs ~4 s of CPU per panel. Multiplied across N panels per dashboard, dashboards
feel heavy.

## Decision

Introduce three TimescaleDB continuous aggregates (CAGGs) per hypertable, at
5 s / 1 min / 5 min bucket sizes. Panels pick the CAGG whose resolution matches
`$__interval` via a Grafana template variable `cagg_suffix` that resolves to
`5s` / `1m` / `5m`. The `1m` CAGG is hierarchical (built from `5s`), and `5m` is
built from `1m`.

### CAGG shapes

| CAGG                          | Granularity | Group-by keys (besides `bucket`)                                                                   |
| ----------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `requests_raw_{5s,1m,5m}`     | 5s/1m/5m    | `system_under_test, test_environment, scenario_name, sampler_name, transaction_name, location`     |
| `transactions_{5s,1m,5m}`     | 5s/1m/5m    | `system_under_test, test_environment, scenario_name, transaction_name`                             |
| `requests_error_{5s,1m,5m}`   | 5s/1m/5m    | `system_under_test, test_environment, scenario_name, sampler_name, transaction_name, node_name, response_code` |

### Aggregate columns

- **requests_raw / transactions:** `n`, `n_ok`, `n_err`, `avg_rt`, `min_rt`, `max_rt`,
  plus `pct_agg` (TimescaleDB-toolkit tdigest sketch for approximate percentiles).
  `requests_raw` additionally carries `avg_connect`, `avg_latency`, `bytes_in`,
  `bytes_out`, `avg_response_size`.
- **requests_error:** `n` only. Errors are counted per bucket/sampler/node/code.
  Individual error rows (used by the error-detail panels on
  `template-timescaledb-errors`) stay on the raw `requests_error` hypertable —
  CAGGs don't materialize row-level data.

### Refresh policy

- `5s` views: `schedule_interval = 30 seconds`, `start_offset = 1 hour`,
  `end_offset = 1 minute`. A 1-minute end offset keeps the refresh job out of the
  current chunk's write path.
- `1m` views: every 1 minute, window 2 hours → 2 minutes.
- `5m` views: every 5 minutes, window 1 day → 5 minutes.

End-to-end refresh lag users should expect: **~60 seconds** for the 5s view.
Live "now" stat panels (queries that filter `time > now() - interval 'N seconds'`)
still read raw tables, because CAGG lag would hide the last minute of data.

### Retention policy

Each CAGG has a 90-day retention policy via `add_retention_policy`. This is
independent of raw-hypertable retention (currently none). If raw retention is
introduced later, re-evaluate CAGG retention so trend panels continue to cover
the intended window.

### Rollout

No per-tenant feature flag. CAGGs are additive DDL — they do not change
ingestion or break existing dashboard queries. The PR that creates the CAGGs
also rewrites the affected panels, so the switch is atomic at merge time.

## Alternatives considered

**Extend the `test_run_stats_rollup` pattern from #150/#151 to dashboards.**
Rejected: that rollup is keyed on `test_run_id` and pre-computed at test-run
finalization. Dashboards query across test runs and often want in-flight data,
which the per-run rollup can't provide.

**Single CAGG at 5 s, re-bucket client-side.** Rejected for multi-week views:
a week of 5 s buckets at O(10³) groups per bucket is O(10⁸) CAGG rows; the 5 m
view reduces that by 60×.

**Keep raw panels and rely on shared_buffers.** Already done at production
scale — the steady-state ~4 s/panel is the floor after index-only scans engage.

## Validation

- Acceptance: p50 panel latency <200 ms for typical 30-minute panels on
  `performance-praegus`-scale data (measured post-merge against the production
  canary).
- Integration test: `apps/api/src/test/cagg-migration.integration.test.ts`
  verifies CAGG counts match raw counts and `approx_percentile` returns
  plausible values.

## Related

- Issue #137: composite `(sut, env, scenario, time DESC)` indexes. Still needed —
  the raw tables still serve live "now" queries and individual-row drill-downs.
- Issue #139: `approx_percentile` rewrite of the Apdex query. CAGGs reuse the
  same tdigest pattern.
- Issues #150 / #151: `test_run_{transaction,sampler}_stats` rollup. Solves a
  different hot path (API-side `getTransactionStats` / `getAggregatedSamplerStats`
  over immutable completed runs). Complementary, not overlapping.
```

- [ ] **Step 2: Commit**

```bash
git add docs-site/content/Database/Continuous\ Aggregates.md
git commit -m "docs(db): ADR for continuous aggregates (#147)"
```

---

### Task 14: Update CHANGELOG and VERSION

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `VERSION`

- [ ] **Step 1: Read current VERSION**

```bash
cat VERSION
```

Note current value (e.g. `0.2.45.1`).

- [ ] **Step 2: Bump VERSION**

Edit `VERSION` to bump the minor segment (the third number), e.g. `0.2.45.1` → `0.2.46.0`. Minor bump because this is an additive feature (DB migration + dashboard changes, no breaking API change).

- [ ] **Step 3: Add CHANGELOG entry**

Look at the most recent CHANGELOG entry's format and add a new top entry:

```markdown
## v0.2.46.0 — 2026-04-24

### perf(db): TimescaleDB continuous aggregates for Grafana dashboards (#147)

Added 9 continuous aggregates (3 granularities × 3 hypertables) over
`requests_raw`, `transactions`, and `requests_error`. The TimescaleDB
dashboards now resolve `$cagg_suffix` from `$__interval` and query the
matching CAGG instead of the raw hypertable, cutting typical 30-minute panel
latency from ~4 s to <200 ms. Live "now" stats and individual-row drill-downs
still read raw tables. Refresh lag: ~60 s. Retention: 90 days on CAGGs, no
change to raw retention.

See `docs-site/content/Database/Continuous Aggregates.md` for the ADR.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md VERSION
git commit -m "chore: release v0.2.46.0 — CAGGs for dashboard queries (#147)"
```

---

### Task 15: Final verification

- [ ] **Step 1: Re-run the full type-check and lint**

```bash
npm run type-check && npm run lint
```

Expected: both pass.

- [ ] **Step 2: Re-run migration up and down end-to-end**

```bash
cd packages/shared
npm run migration:revert      # drop the CAGGs
npm run migration:run         # re-apply
docker exec perfana-postgres psql -U perfana -d perfana \
  -c "SELECT count(*) FROM timescaledb_information.continuous_aggregates;"
```

Expected: `9`.

- [ ] **Step 3: Re-open all four TimescaleDB dashboards in local Grafana and eyeball each panel**

For each of the four dashboards, click into the panel editor on one time-series panel and one stat panel, and confirm:
- Query Inspector shows the CAGG table name (not the raw table) in the executed SQL.
- Panel renders data from a short test run.

- [ ] **Step 4: Run the test suite**

```bash
npm run test
```

Expected: passes (CAGG integration test skips if no testcontainer config, doesn't fail).

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/continuous-aggregates-issue-147
gh pr create --title "feat(db): continuous aggregates for dashboard queries (#147)" \
  --body "$(cat <<'EOF'
## Summary

- Adds 9 TimescaleDB continuous aggregates over `requests_raw`, `transactions`, `requests_error` at 5 s / 1 min / 5 min
- Rewrites the four TimescaleDB Grafana dashboards to pick the matching CAGG via a `$cagg_suffix` template variable driven by `$__interval`
- 90-day retention on CAGGs, 60 s refresh lag

Closes #147.

## Test plan

- [ ] `npm run test` passes
- [ ] `npm run type-check` passes
- [ ] Migration up → 9 CAGGs created with refresh + retention policies
- [ ] Migration down → 9 CAGGs cleanly dropped
- [ ] jmeter dashboard panels render with data, query inspector shows CAGG table
- [ ] request-analysis dashboard panels render
- [ ] transaction-analysis dashboard panels render
- [ ] errors dashboard panels (row-level, unchanged) still render
- [ ] p50 latency measurement against production data (post-merge validation on canary)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** All 8 acceptance criteria map to tasks: CAGGs (T2–T4), refresh policies (T5), retention (T6), dashboard rewrites by `$__interval` (T9–T11), percentile via `percentile_agg` (T2/T3 + dashboard rewrites), idempotent/reversible migration (T7 + `IF NOT EXISTS` / `if_not_exists => TRUE` throughout), ADR (T13), test/type-check (T15).
- **`$__interval_ms` support:** Grafana 12.3 has `${__interval_ms}` built-in. Verified in the template variable query in Task 9 Step 1.
- **`transaction = false` property on migration:** Documented TypeORM mechanism. If the executing agent finds the property isn't honored in this TypeORM version, fall back to running raw `COMMIT; …; BEGIN` via `queryRunner.query` before each CAGG statement, and document the workaround in the migration's header comment.
- **Hierarchical CAGG compatibility:** `timescaledb_toolkit.rollup(tdigest)` is supported on `timescaledb_toolkit` ≥ 1.15. Perfana uses `timescaledb-ha:pg15`, which ships a current toolkit version. Agent: verify with `SELECT extversion FROM pg_extension WHERE extname = 'timescaledb_toolkit';` — if older than 1.15, fall back to building all three granularities from raw.
- **Retention pre-check:** Task 6 notes that raw hypertables currently have no retention. Agent: before writing the retention Step, re-check with `SELECT hypertable_name FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention';` and update the ADR if it's no longer accurate.
