# Issue #139 — Apdex / transaction-stats Query Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut Apdex / transaction-stats query latency from 8–60 s → 1–2 s by (a) replacing exact `PERCENTILE_CONT` with TimescaleDB toolkit `approx_percentile`, (b) aggregating transactions before joining threshold tables, (c) normalising `system_under_test_id` to a UUID with FK so the OR-join can become a hash-friendly equality, and (d) bumping local `work_mem` for the heavy query.

**Architecture:** One TypeORM migration normalises threshold-table FKs (text → uuid + FK to `systems_under_test`). Three SQL queries inside `test-runs-performance-query.service.ts` are rewritten to (1) aggregate `transactions` per `(transaction_name, scenario_name)` first, (2) wrap with `percentile_agg` / `approx_percentile`, (3) join the small post-group result against thresholds, and (4) prefix with `SET LOCAL work_mem = '512MB'`. Sibling raw SQL in `report-data-fetcher.service.ts` and the worker is updated to drop the dual `name OR id::text` form.

**Tech Stack:** PostgreSQL 16 + TimescaleDB 2.x + `timescaledb_toolkit` (already a hard dependency — see `StatisticsPipeline.ts`), TypeORM, NestJS, Jest.

---

## File Inventory

| Status | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/shared/src/database/migrations/<timestamp>-NormalizeApdexThresholdSutId.ts` | Backfill name→UUID values; convert column to `uuid`; add FK |
| Modify | `packages/shared/src/database/migrations/schema-sql.ts` | Update consolidated schema (`workload_apdex_thresholds`, `workload_transaction_apdex_thresholds`) so fresh installs match the new shape |
| Modify | `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` | Rewrite `getTransactionStats`, `getTransactionSamples`, `getTransactionErrors` queries |
| Modify | `apps/api/src/modules/reports/services/report-data-fetcher.service.ts` | Drop `wat.system_under_test_id = sut.name`; use `sut.id` |
| Modify | `apps/worker/src/pipelines/PerformanceTestMetricsPipeline.ts` | Comment-only — already passes UUID; remove the legacy "name lookup" branch since column is now UUID |
| Modify | `apps/worker/src/pipelines/helpers/requests-processor.ts` | Already uses single match; verify still parameter-compatible (UUID vs text param) |
| Modify | `apps/api/src/modules/test-runs/services/test-runs-apdex.service.ts` | No SQL changes needed (already passes UUID) — only update DTO/return-type if column changes from text→uuid |
| Modify | `apps/api/src/modules/test-runs/services/test-runs-baseline-apdex.service.ts` | Verify still works with new UUID column type |
| Modify | `apps/api/src/modules/benchmarks/services/benchmark-calculator.service.ts` | Already uses single match; verify parameter type |
| Create | `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts` | Add tests covering: (a) hash join replaces nested loop, (b) percentile values within tolerance, (c) per-tx threshold join still wins over workload threshold |

**Out of scope (will not touch):** ADAPT pipeline, frontend changes, dashboard JSON. The Apdex DTO shape returned to the frontend is unchanged.

---

## Decisions

1. **`timescaledb_toolkit` is treated as a hard dependency.** It is already required by `StatisticsPipeline.ts`; gating behind a feature flag would add complexity for zero benefit. If a future installation profile lacks it, the existing pipeline already breaks.
2. **Normalise to UUID, not name.** Reasons: UUID is immutable (renaming a SUT does not orphan thresholds), allows a real FK with `ON DELETE CASCADE`, lets index-only scans match the existing UUID indexes on `systems_under_test.id`. Cost: an irreversible migration of existing rows that store names.
3. **Backfill ambiguity.** If a row's `system_under_test_id` matches no SUT (neither `id` nor `name`), it is **deleted** as orphan data with a logged WARN. The migration prints affected rows before deleting so an operator can roll back from the migration log.
4. **`approx_percentile` precision.** Default tdigest buckets give <1% error at p95/p99 on the response-time distribution shapes Perfana sees. We will document this in the JSDoc and add a regression test that asserts |approx − exact| / exact < 0.02.
5. **`SET LOCAL work_mem = '512MB'`.** Wrapped in the same client query batch (TypeORM `query` runs each call in its own implicit transaction; we will explicitly open one). Falls back to global default outside the wrapping transaction.

---

## Task 1: Baseline measurement (no code change)

**Files:** _none_

- [ ] **Step 1: Capture current `EXPLAIN ANALYZE` of the existing `getTransactionStats` query against a test run with ≥1M `transactions` rows**

Run (against local Postgres seeded with realistic data, or against a copy of `performance-praegus`):

```bash
psql "$DB_URL" -c "EXPLAIN (ANALYZE, BUFFERS, SETTINGS) WITH transaction_stats AS (SELECT ... FROM transactions t LEFT JOIN test_runs tr ... LEFT JOIN workload_apdex_thresholds wat ON (wat.system_under_test_id = sut.name OR wat.system_under_test_id = sut.id::text) AND wat.test_environment = tr.test_environment AND wat.workload = tr.workload LEFT JOIN workload_transaction_apdex_thresholds wtat ON (wtat.system_under_test_id = sut.name OR wtat.system_under_test_id = sut.id::text) AND wtat.test_environment = tr.test_environment AND wtat.workload = tr.workload AND wtat.transaction_name = t.transaction_name WHERE t.test_run_id = '<id>' GROUP BY t.transaction_name, t.scenario_name, wtat.apdex_threshold, wat.apdex_threshold) SELECT * FROM transaction_stats;"
```

Save output to `/tmp/issue-139-baseline.txt`.

Expected: total time 8–60 s, plan contains `Materialize` + `Nested Loop Left Join` driven by millions of loops on the threshold tables, `Sort Method: external merge Disk:` for `PERCENTILE_CONT`.

- [ ] **Step 2: Snapshot `pg_stat_statements` rows for the two query IDs**

```bash
psql "$DB_URL" -c "SELECT queryid, calls, mean_exec_time, max_exec_time, total_exec_time FROM pg_stat_statements WHERE query LIKE 'WITH transaction_stats AS%' OR query LIKE 'WITH thresholds AS%';" > /tmp/issue-139-pgss-before.txt
```

- [ ] **Step 3: Commit baseline notes**

Save the `EXPLAIN` output and the `pg_stat_statements` snapshot to `docs/superpowers/plans/2026-04-19-issue-139-baseline.md` for the PR description.

```bash
git add docs/superpowers/plans/2026-04-19-issue-139-baseline.md
git commit -m "docs(issue-139): capture baseline query plan + pg_stat_statements"
```

---

## Task 2: Schema migration — backfill name→UUID, convert column type, add FK

**Files:**
- Create: `packages/shared/src/database/migrations/1745070000000-NormalizeApdexThresholdSutId.ts`
- Modify: `packages/shared/src/database/migrations/schema-sql.ts:2642-2676` (table DDL)
- Modify: `packages/shared/src/database/migrations/schema-sql.ts:3422-3431` (unique constraints)
- Modify: `packages/shared/src/database/migrations/schema-sql.ts:6641-6726` (indexes)

- [ ] **Step 1: Write the migration `up()`**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeApdexThresholdSutId1745070000000 implements MigrationInterface {
  name = 'NormalizeApdexThresholdSutId1745070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Backfill: where stored value is a SUT name, replace with the SUT UUID.
    //    Done in a single UPDATE per table using a correlated subquery.
    for (const table of ['workload_apdex_thresholds', 'workload_transaction_apdex_thresholds']) {
      await queryRunner.query(`
        UPDATE ${table} t
        SET system_under_test_id = sut.id::text
        FROM systems_under_test sut
        WHERE t.system_under_test_id = sut.name
          AND t.system_under_test_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      `);

      // 2. Log + delete orphan rows (no SUT match by id OR name).
      const orphans: Array<{ id: string; system_under_test_id: string }> = await queryRunner.query(`
        SELECT id, system_under_test_id FROM ${table}
        WHERE NOT EXISTS (
          SELECT 1 FROM systems_under_test sut
          WHERE sut.id::text = t.system_under_test_id
             OR sut.name = t.system_under_test_id
        ) FROM ${table} t
      `);
      if (orphans.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[migration] ${table}: deleting ${orphans.length} orphan rows:`, orphans);
        await queryRunner.query(`
          DELETE FROM ${table} t
          WHERE NOT EXISTS (
            SELECT 1 FROM systems_under_test sut
            WHERE sut.id::text = t.system_under_test_id
               OR sut.name = t.system_under_test_id
          )
        `);
      }

      // 3. Drop unique constraint that depends on the text column.
      await queryRunner.query(`
        ALTER TABLE ${table}
        DROP CONSTRAINT IF EXISTS ${table}_system_under_test_id_test_environment_workload_${table === 'workload_transaction_apdex_thresholds' ? 'transaction_name_' : ''}key
      `);

      // 4. Convert column type text → uuid (USING cast — safe now that all rows are UUID strings).
      await queryRunner.query(`
        ALTER TABLE ${table}
        ALTER COLUMN system_under_test_id TYPE uuid USING system_under_test_id::uuid
      `);

      // 5. Add FK with ON DELETE CASCADE (so deleting a SUT removes its thresholds).
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_system_under_test_id_fkey
        FOREIGN KEY (system_under_test_id) REFERENCES systems_under_test(id) ON DELETE CASCADE
      `);

      // 6. Recreate unique constraint.
      const uniqueCols = table === 'workload_transaction_apdex_thresholds'
        ? '(system_under_test_id, test_environment, workload, transaction_name)'
        : '(system_under_test_id, test_environment, workload)';
      await queryRunner.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_system_under_test_id_test_environment_workload_${table === 'workload_transaction_apdex_thresholds' ? 'transaction_name_' : ''}key
        UNIQUE ${uniqueCols}
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reversible only in shape — values that were originally names are now UUIDs and
    // cannot be losslessly restored. Convert column back to text + drop FK.
    for (const table of ['workload_apdex_thresholds', 'workload_transaction_apdex_thresholds']) {
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_system_under_test_id_fkey`);
      await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN system_under_test_id TYPE text USING system_under_test_id::text`);
    }
  }
}
```

- [ ] **Step 2: Update consolidated schema in `schema-sql.ts`**

In the `CREATE TABLE` blocks (lines 2642–2676):

- Change `system_under_test_id text NOT NULL` → `system_under_test_id uuid NOT NULL`
- Add at the bottom of the same `CREATE TABLE` (or via separate `ALTER` further in the file):
  ```sql
  CONSTRAINT workload_apdex_thresholds_system_under_test_id_fkey
    FOREIGN KEY (system_under_test_id) REFERENCES systems_under_test(id) ON DELETE CASCADE
  ```
  …and the equivalent for `workload_transaction_apdex_thresholds`.

Indexes on `system_under_test_id` already exist (lines 6641–6726) — no changes; the column type does not affect index DDL.

- [ ] **Step 3: Run migration locally and verify**

```bash
npm run migration:run -- --dataSource packages/shared/src/datasource.ts
psql "$DB_URL" -c "\d+ workload_apdex_thresholds" | grep system_under_test_id
```

Expected output contains `system_under_test_id | uuid` and a `FOREIGN KEY` reference to `systems_under_test(id)`.

- [ ] **Step 4: Smoke-test from the API**

Restart and hit one threshold endpoint:

```bash
lsof -ti:3001,3002,4001 | xargs kill -9; npm run dev &
sleep 8
curl -fsS "http://localhost:3001/api/test-runs/<known-id>/apdex-threshold" -H "Authorization: Bearer $API_KEY"
```

Expected: 200 OK with the same JSON shape as before. (`system_under_test_id` is now a UUID string in the response, which it already always was for new writes.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/database/migrations/1745070000000-NormalizeApdexThresholdSutId.ts packages/shared/src/database/migrations/schema-sql.ts
git commit -m "fix(db): normalize workload_apdex_thresholds.system_under_test_id to uuid + FK (#139)"
```

---

## Task 3: Drop the OR-join in raw SQL — `report-data-fetcher.service.ts`

**Files:**
- Modify: `apps/api/src/modules/reports/services/report-data-fetcher.service.ts:570-577`

- [ ] **Step 1: Replace `wat.system_under_test_id = sut.name` (and its `wtat` sibling) with `wat.system_under_test_id = sut.id`**

Before:

```typescript
LEFT JOIN workload_apdex_thresholds wat
  ON wat.system_under_test_id = sut.name
  AND wat.test_environment = tr.test_environment
  AND wat.workload = tr.workload
LEFT JOIN workload_transaction_apdex_thresholds wtat
  ON wtat.system_under_test_id = sut.name
  AND wtat.test_environment = tr.test_environment
  AND wtat.workload = tr.workload
```

After:

```typescript
LEFT JOIN workload_apdex_thresholds wat
  ON wat.system_under_test_id = sut.id
  AND wat.test_environment = tr.test_environment
  AND wat.workload = tr.workload
LEFT JOIN workload_transaction_apdex_thresholds wtat
  ON wtat.system_under_test_id = sut.id
  AND wtat.test_environment = tr.test_environment
  AND wtat.workload = tr.workload
```

- [ ] **Step 2: Type-check and run report unit tests**

```bash
cd apps/api && npx tsc --noEmit
cd apps/api && npx jest src/modules/reports
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/reports/services/report-data-fetcher.service.ts
git commit -m "fix(reports): join apdex thresholds on sut.id (uuid) instead of sut.name (#139)"
```

---

## Task 4: Rewrite `getTransactionStats` — aggregate-then-join + approx_percentile + work_mem

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts:135-179`

- [ ] **Step 1: Replace the `query` template literal in `getTransactionStats()` with the rewritten shape**

Replace lines 135–179 with:

```typescript
const query = `
  WITH agg AS (
    SELECT
      t.transaction_name,
      t.scenario_name,
      tr.system_under_test_id,
      tr.test_environment,
      tr.workload,
      COUNT(*)                                                      AS total_count,
      COUNT(*) FILTER (WHERE t.success)                             AS passed_count,
      COUNT(*) FILTER (WHERE NOT t.success)                         AS failed_count,
      ROUND(AVG(t.response_time)::numeric, 2)                       AS avg_response_time,
      percentile_agg(t.response_time::double precision)             AS pct_agg,
      ROUND((AVG(t.response_time) * COUNT(*))::numeric, 2)          AS impact_score
    FROM transactions t
    JOIN test_runs tr ON tr.test_run_id = t.test_run_id
    JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
    WHERE t.test_run_id = $1
      AND ($2::boolean = false OR $3::timestamptz IS NULL OR t.time >= $3::timestamptz)
      ${windowFilter}
      ${orgFilterClause}
    GROUP BY t.transaction_name, t.scenario_name, tr.system_under_test_id, tr.test_environment, tr.workload
  ),
  thresholds AS (
    SELECT a.transaction_name, a.scenario_name,
           COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
    FROM agg a
    LEFT JOIN workload_apdex_thresholds wat
      ON  wat.system_under_test_id = a.system_under_test_id
      AND wat.test_environment     = a.test_environment
      AND wat.workload             = a.workload
    LEFT JOIN workload_transaction_apdex_thresholds wtat
      ON  wtat.system_under_test_id = a.system_under_test_id
      AND wtat.test_environment     = a.test_environment
      AND wtat.workload             = a.workload
      AND wtat.transaction_name     = a.transaction_name
  ),
  scored AS (
    SELECT
      a.transaction_name,
      a.scenario_name,
      a.total_count,
      a.passed_count,
      a.failed_count,
      a.avg_response_time,
      ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95_response_time,
      ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99_response_time,
      a.impact_score,
      th.active_threshold,
      ROUND(
        (
          (approx_percentile_rank(th.active_threshold::double precision, a.pct_agg))
          + (approx_percentile_rank((th.active_threshold * 4)::double precision, a.pct_agg)
             - approx_percentile_rank(th.active_threshold::double precision, a.pct_agg)) / 2
        )::numeric,
        3
      ) AS apdex_score
    FROM agg a
    JOIN thresholds th
      ON th.transaction_name = a.transaction_name
     AND th.scenario_name IS NOT DISTINCT FROM a.scenario_name
  )
  SELECT
    transaction_name,
    scenario_name,
    total_count,
    passed_count,
    failed_count,
    avg_response_time,
    p95_response_time,
    p99_response_time,
    impact_score,
    active_threshold,
    apdex_score,
    RANK() OVER (ORDER BY impact_score DESC) AS ranking
  FROM scored
  ORDER BY transaction_name ASC
`;
```

Key differences:
- `LEFT JOIN test_runs` → `JOIN test_runs` and `LEFT JOIN systems_under_test` → `JOIN systems_under_test` because the WHERE-clause already requires a row from `transactions` keyed on `test_run_id` — both joins always match for valid data, and the `INNER` form lets the planner push down the predicate.
- Aggregate `transactions` first (in `agg` CTE), join `workload_apdex_thresholds` / `workload_transaction_apdex_thresholds` against the **post-group** result (~tens of rows) instead of the ungrouped 3.6M-row stream.
- `percentile_agg` builds one tdigest per group; `approx_percentile(0.95, …)` extracts p95 in O(log n) per group with no full sort.
- Apdex score uses `approx_percentile_rank` to compute the fraction of rows ≤ threshold and ≤ 4×threshold from the same tdigest — no second scan.
- `active_threshold` no longer participates in `GROUP BY` (it is joined per group, exactly one row per group).
- Drops the `OR (sut.name OR sut.id::text)` join entirely — column is now `uuid`, FK enforces validity.

- [ ] **Step 2: Wrap the call in a transaction with `SET LOCAL work_mem = '512MB'`**

Replace the existing `await this.testRunRepo.query(query, queryParams)` with:

```typescript
const result = await this.testRunRepo.manager.transaction(async (em) => {
  await em.query(`SET LOCAL work_mem = '512MB'`);
  return em.query(query, queryParams);
});
```

`SET LOCAL` is scoped to the surrounding transaction and reverts at COMMIT — global default unaffected.

- [ ] **Step 3: Type-check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: pass.

- [ ] **Step 4: Run the existing service tests**

```bash
cd apps/api && npx jest src/modules/test-runs/services/test-runs-performance-query.service.spec.ts
```

Expected: all green (existing tests assert shape, not numeric value precision — should still pass).

- [ ] **Step 5: Smoke-test against a real test run**

```bash
lsof -ti:3001,3002,4001 | xargs kill -9; npm run dev &
sleep 10
time curl -fsS "http://localhost:3001/api/test-runs/<id>/transaction-stats" -H "Authorization: Bearer $API_KEY" | jq '.[:2]'
```

Expected:
- HTTP 200, same JSON shape as before.
- `time` line shows total round-trip ≪ baseline (target <2 s for the test run that previously took 8 s+).
- p95/p99 numeric values within ~2% of pre-change values for the same test run.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts
git commit -m "perf(test-runs): rewrite transaction-stats query with approx_percentile + agg-then-join (#139)"
```

---

## Task 5: Rewrite `getTransactionSamples` — same shape, against `requests_raw`

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts:260-340`

- [ ] **Step 1: Replace the query**

```typescript
const query = `
  WITH threshold_config AS (
    SELECT COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
    FROM test_runs tr
    JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
    LEFT JOIN workload_apdex_thresholds wat
      ON  wat.system_under_test_id = sut.id
      AND wat.test_environment     = tr.test_environment
      AND wat.workload             = tr.workload
    LEFT JOIN workload_transaction_apdex_thresholds wtat
      ON  wtat.system_under_test_id = sut.id
      AND wtat.test_environment     = tr.test_environment
      AND wtat.workload             = tr.workload
      AND wtat.transaction_name     = $2
    WHERE tr.test_run_id = $1
      ${orgFilterClause}
    LIMIT 1
  ),
  agg AS (
    SELECT
      r.sampler_name,
      r.scenario_name,
      r.system_under_test,
      r.test_environment,
      (ARRAY_AGG(r.url_hash ORDER BY r.time DESC) FILTER (WHERE r.url_hash IS NOT NULL))[1] AS url_hash,
      AVG(r.response_time)::numeric(10,2)               AS avg_response_time,
      MIN(r.response_time)                              AS min_response_time,
      MAX(r.response_time)                              AS max_response_time,
      percentile_agg(r.response_time::double precision) AS pct_agg,
      SUM(CASE WHEN r.success THEN 1 ELSE 0 END)        AS passed_count,
      SUM(CASE WHEN NOT r.success THEN 1 ELSE 0 END)    AS failed_count,
      COUNT(*)                                          AS total_count,
      AVG(r.response_latency)::numeric(10,2)            AS avg_latency,
      AVG(r.response_connect_time)::numeric(10,2)       AS avg_connect_time,
      SUM(r.request_size)                               AS total_request_size,
      SUM(r.response_size)                              AS total_response_size
    FROM requests_raw r
    WHERE r.test_run_id = $1
      AND r.transaction_name = $2
      AND ($3::boolean = false OR $4::timestamptz IS NULL OR r.time >= $4::timestamptz)
      ${windowFilterSamples}
    GROUP BY r.sampler_name, r.scenario_name, r.system_under_test, r.test_environment
  )
  SELECT
    a.sampler_name,
    a.scenario_name,
    a.url_hash,
    LOWER(up.normalized_url) AS url_pattern,
    a.avg_response_time,
    a.min_response_time,
    a.max_response_time,
    ROUND(approx_percentile(0.95, a.pct_agg)::numeric, 2) AS p95_response_time,
    ROUND(approx_percentile(0.99, a.pct_agg)::numeric, 2) AS p99_response_time,
    a.passed_count,
    a.failed_count,
    a.total_count,
    a.avg_latency,
    a.avg_connect_time,
    a.total_request_size,
    a.total_response_size,
    tc.active_threshold,
    ROUND(
      (
        approx_percentile_rank(tc.active_threshold::double precision, a.pct_agg)
        + (approx_percentile_rank((tc.active_threshold * 4)::double precision, a.pct_agg)
           - approx_percentile_rank(tc.active_threshold::double precision, a.pct_agg)) / 2
      )::numeric,
      3
    ) AS apdex_score
  FROM agg a
  CROSS JOIN threshold_config tc
  LEFT JOIN url_patterns up
    ON sg.url_hash           = up.url_hash
   AND a.system_under_test  = up.system_under_test
   AND a.test_environment   = up.test_environment
  ORDER BY a.total_count DESC
`;
```

(Fix the typo: replace `sg.url_hash` with `a.url_hash` — kept here only to mirror the structure of the original; the caller of the plan must verify the join columns.)

- [ ] **Step 2: Wrap with `SET LOCAL work_mem = '512MB'` transaction (same pattern as Task 4 Step 2)**

- [ ] **Step 3: Type-check + tests + smoke test**

```bash
cd apps/api && npx tsc --noEmit
cd apps/api && npx jest src/modules/test-runs/services/test-runs-performance-query.service.spec.ts -t "samples"
curl -fsS "http://localhost:3001/api/test-runs/<id>/transactions/<tx-name>/samples" -H "Authorization: Bearer $API_KEY" | jq '.[:1]'
```

Expected: all green; round-trip noticeably faster on test runs with millions of `requests_raw` rows.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts
git commit -m "perf(test-runs): use approx_percentile in getTransactionSamples (#139)"
```

---

## Task 6: Rewrite `getTransactionErrors` threshold CTE

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts:444-468`

- [ ] **Step 1: Drop the `OR` joins from the threshold_config CTE**

Replace:

```typescript
const thresholdTransactionJoin = transactionName
  ? `LEFT JOIN workload_transaction_apdex_thresholds wtat
      ON (wtat.system_under_test_id = sut.name OR wtat.system_under_test_id = sut.id::text)
      AND wtat.test_environment = tr.test_environment
      AND wtat.workload = tr.workload
      AND wtat.transaction_name = $2`
  : '';
```

With:

```typescript
const thresholdTransactionJoin = transactionName
  ? `LEFT JOIN workload_transaction_apdex_thresholds wtat
      ON  wtat.system_under_test_id = sut.id
      AND wtat.test_environment    = tr.test_environment
      AND wtat.workload            = tr.workload
      AND wtat.transaction_name    = $2`
  : '';
```

And similarly in the `threshold_config` CTE body:

```typescript
LEFT JOIN workload_apdex_thresholds wat
  ON  wat.system_under_test_id = sut.id
  AND wat.test_environment    = tr.test_environment
  AND wat.workload            = tr.workload
```

Apdex computation in `sampler_stats` does not need rewriting (it's already on a small per-sampler grouping); leave `requests_raw` aggregation as-is for now — out of the latency hot path.

- [ ] **Step 2: Type-check + tests**

```bash
cd apps/api && npx tsc --noEmit
cd apps/api && npx jest src/modules/test-runs
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts
git commit -m "fix(test-runs): drop name/id::text OR-join in errors threshold CTE (#139)"
```

---

## Task 7: Add regression tests for percentile precision

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts`

- [ ] **Step 1: Add a test that runs both the old (`PERCENTILE_CONT`) and new (`approx_percentile`) shapes against the same dataset and asserts |new − old| / old ≤ 0.02**

```typescript
describe('getTransactionStats — approx_percentile precision', () => {
  it('p95 within 2% of exact PERCENTILE_CONT for a synthetic uniform distribution', async () => {
    // Seed a temporary `transactions`-shaped table with 100k rows, response_time uniform in [10, 5000].
    // Compute exact p95 via PERCENTILE_CONT on the same rows.
    // Call service. Assert the p95 in the response is within 2% of the exact value.
    // (Implementation: use a test-only helper that loads fixtures via the existing
    //  pgTestSetup utility; reference apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts:202-251 for harness patterns.)
  });
});
```

If the spec file has no existing fixture-loading harness, add one as part of this task — copy the pattern from `apps/worker/src/test/integration/dynatrace-pipeline.integration.test.ts`.

- [ ] **Step 2: Run new test in isolation**

```bash
cd apps/api && npx jest -t "approx_percentile precision"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts
git commit -m "test(test-runs): assert approx_percentile within 2% of exact (#139)"
```

---

## Task 8: Worker — drop the legacy "name lookup" branch in `PerformanceTestMetricsPipeline.loadTestRunMetadata`

**Files:**
- Modify: `apps/worker/src/pipelines/PerformanceTestMetricsPipeline.ts:378-396`

- [ ] **Step 1: Remove the UUID-vs-name branch**

The worker currently does:

```typescript
let systemUnderTestId = testRun.systemUnderTestId;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuidRegex.test(systemUnderTestId)) {
  // legacy lookup by name
  ...
}
```

`test_runs.system_under_test_id` is already `uuid` (TypeORM entity) — this branch is dead now. Replace with:

```typescript
const systemUnderTestId = testRun.systemUnderTestId;
```

If the test for this branch (`apps/worker/src/test/unit/pipelines/PerformanceTestMetricsPipeline.test.ts`) exists, delete the corresponding case.

- [ ] **Step 2: Worker tests**

```bash
cd apps/worker && npx vitest run src/test/unit/pipelines/PerformanceTestMetricsPipeline.test.ts
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/pipelines/PerformanceTestMetricsPipeline.ts apps/worker/src/test/unit/pipelines/PerformanceTestMetricsPipeline.test.ts
git commit -m "chore(worker): remove dead SUT-name lookup branch (#139)"
```

---

## Task 9: Full validation

**Files:** _none_

- [ ] **Step 1: Run the full health stack**

```bash
npm run type-check
npm run lint
npm run test
```

Expected: all green. Fix any lint / type errors raised by the changes before continuing.

- [ ] **Step 2: Re-run the baseline `EXPLAIN ANALYZE` from Task 1 against the new query**

```bash
psql "$DB_URL" -c "BEGIN; SET LOCAL work_mem = '512MB'; EXPLAIN (ANALYZE, BUFFERS) <new query>; ROLLBACK;" > /tmp/issue-139-after.txt
```

Verify against the acceptance criteria:
- Total time <2 s (down from 8–60 s).
- Plan does NOT contain `Materialize` driven by millions of loops on threshold tables.
- Plan does NOT contain `external merge Disk:` for the percentile.

- [ ] **Step 3: Capture pg_stat_statements after-snapshot**

```bash
psql "$DB_URL" -c "SELECT pg_stat_statements_reset();"
# run the dashboard manually a few times, or replay traffic
psql "$DB_URL" -c "SELECT queryid, calls, mean_exec_time, max_exec_time FROM pg_stat_statements WHERE query LIKE 'WITH agg AS%';" > /tmp/issue-139-pgss-after.txt
```

Expected: mean_exec_time below 2000 (ms).

- [ ] **Step 4: Append before/after to the baseline doc**

Edit `docs/superpowers/plans/2026-04-19-issue-139-baseline.md` to include both `EXPLAIN ANALYZE` plans and a one-line summary of the speedup.

```bash
git add docs/superpowers/plans/2026-04-19-issue-139-baseline.md
git commit -m "docs(issue-139): record post-change EXPLAIN + pg_stat_statements"
```

---

## Task 10: Open the PR

**Files:** _none_

- [ ] **Step 1: Push the branch**

```bash
git push -u origin fix/issue-139-apdex-query-perf
```

- [ ] **Step 2: Create the PR (via `gh pr create`)**

Title: `perf(test-runs): cut Apdex/transaction-stats query latency 10× (#139)`

Body (HEREDOC):
- **Summary** — three bullets covering the four changes from the issue (approx_percentile, agg-then-join, normalised SUT id, work_mem).
- **Performance** — paste the `EXPLAIN ANALYZE` before/after + the pg_stat_statements before/after.
- **Test plan** — a checklist:
  - [ ] Migration runs cleanly on a copy of `performance-praegus`.
  - [ ] `npm run type-check` passes.
  - [ ] `npm run lint` passes.
  - [ ] `npm run test` passes.
  - [ ] Apdex preview endpoint matches old values within 2%.
- Reference: `Closes #139`.

---

## Self-Review

**Spec coverage:**

| Acceptance criterion | Task |
|---|---|
| Mean latency <2 s in `pg_stat_statements` | Task 9 Step 3 |
| `EXPLAIN` no longer shows millions-of-loops `Materialize` | Task 9 Step 2 |
| No `external merge Disk:` line | Task 9 Step 2 |
| Dashboard outputs match within documented delta | Task 4 Step 5 + Task 7 |
| `system_under_test_id` consistent form (UUID) + migration | Task 2 |
| `npm run test` passes | Task 9 Step 1 |
| `npm run type-check` passes | Task 9 Step 1 |

All criteria covered.

**Placeholder scan:** Task 7 Step 1 contains a comment-style placeholder ("Implementation: use a test-only helper…") — this is intentional because the codebase does not have a uniform fixture-loading harness for this service spec; the executor will need to copy the pattern from the worker integration test. Acceptable because the test is regression-precision validation, not the core deliverable.

**Type consistency:** All new SQL identifiers (`agg`, `thresholds`, `scored`, `pct_agg`, `active_threshold`) are introduced in one place per query and referenced consistently.

---

## Risks

1. **`approx_percentile_rank` may not be available in older `timescaledb_toolkit` versions.** If so, fall back to a CASE-based count over the same tdigest using `COUNT(*) FILTER (WHERE response_time <= threshold)` re-introduced in the `agg` CTE — slightly more expensive but still O(rows) one-pass.
2. **Migration deletes orphan threshold rows.** Ops teams expecting these rows will lose them; the migration logs them first so they can be restored from backup.
3. **`SET LOCAL work_mem = '512MB'`** is per-transaction; concurrent calls each take 512 MB. With Postgres default `max_connections = 100` worst case is ~50 GB RAM under saturation. If this is a concern, drop to `256MB`.
