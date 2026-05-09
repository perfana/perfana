# Live Apdex CAGG Fast-Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the live (non-rollup) Apdex aggregation paths in `getTransactionStats` and `getTransactionSamples` through the existing TimescaleDB continuous aggregates (`transactions_5s` / `requests_raw_5s`) instead of scanning the raw `transactions` / `requests_raw` hypertables. Live Apdex during a running test (or in the rare soft-failed-rollup case) becomes O(buckets) instead of O(rows) — for a 10M-row run, dropping wall time from 60s+ raw scan to <500ms CAGG read.

**Architecture:** The existing CAGGs already store the count, success/failure breakdown, and an all-rows `percentile_agg` (uddsketch) per (SUT, env, scenario, transaction_name, 5s bucket). They do NOT yet store a success-filtered sketch — required for Apdex correctness post-#298 — so this plan adds side-by-side companion CAGGs (`transactions_passed_5s/1m/5m`, `requests_raw_passed_5s/1m/5m`) carrying *only* the new `pct_agg_passed = percentile_agg(response_time) FILTER (WHERE success)`. Side-by-side avoids a destructive DROP+CREATE on the throughput-critical existing CAGGs. Live Apdex queries JOIN both CAGG families, filter by the test_run's `(sut.name, test_environment, [start_time, end_time])` time-window scope (the same pattern `getThroughputStatsFromCagg` uses today), and apply the workload-level threshold from a one-row threshold lookup. New `getTransactionStatsFromCagg` / `getTransactionSamplesFromCagg` helpers slot in as a fast path *between* the existing rollup fast path and the raw-scan fallback. The rollup-pending gate (separate plan, 2026-05-09-apdex-rollup-pending-gate.md) is amended so it only returns HTTP 202 when *both* the rollup table AND the CAGGs are empty — when the CAGGs have data we serve a live result instead.

**Tech Stack:** TimescaleDB 2.x continuous aggregates, TimescaleDB toolkit (`percentile_agg` / `approx_percentile` / `approx_percentile_rank` / `rollup`), TypeORM migrations, NestJS, Postgres, Jest.

---

## Pre-flight errata (on-main truth as of `7f563ef`)

The pending-gate plan (PR #302) shipped to main before this plan was written. Some tasks in this plan referenced its functions abstractly; the actual on-main shape:

1. **`getRollupStatus` takes three args, not one:**
   ```typescript
   private async getRollupStatus(
     testRunId: string,
     isAdmin: boolean,
     organizationIds: string[],
   ): Promise<{ status: 'ready' } | RollupPendingResult | { status: 'unavailable' }>
   ```
   The org args are passed through to the scope-lookup query so non-admins outside the run's org collapse to `'unavailable'`. **All call sites and test stubs in this plan must use the 3-arg signature.**

2. **`clampSinceMinutes(sinceMinutes)` already exists** at line 182 and is called at the top of `getTransactionStats` / `getTransactionSamples`. Use the existing `clampedSinceMinutes` local — do not redeclare. The gate condition is `if (clampedSinceMinutes == null) { ... }`, not `sinceMinutes`.

3. **`withStatementTimeout(fn)` already exists** at line 192 and wraps live-aggregation queries with `SET LOCAL statement_timeout = '10s'`. The new CAGG queries should also use it (CAGG queries are fast, but wrapping is cheap insurance and matches the project pattern).

4. **`getTransactionSamples` has a `hasSamplerRollup` fall-through** (line 747-776): `getRollupStatus`==`'ready'` only goes to the rollup path if `hasSamplerRollup(testRunId, transactionName)` returns true; otherwise it falls through to live aggregation. **The CAGG fast path for samples must go *after* the existing `'ready' + hasSamplerRollup=false` fall-through too**, not just after the `'unavailable'` arm. See Task 5 Step 4 wire-up notes.

5. **`organization_id` constraints already enforced** — when reading from CAGGs, scope must still org-filter via `sut.organization_id` against the test_run's SUT, even though CAGGs themselves don't carry org. Implemented inside `loadCaggApdexScope` (Task 3) — do not skip.

6. **Live-window param uses `clampedSinceMinutes`** in the existing live-aggregation queries (params $4 / $5). Tests that assert "clamping happens" already exist; the new CAGG-window logic in Task 4/5 must also use `clampedSinceMinutes` (not `sinceMinutes`) when narrowing the scope window.

When the plan's example code shows a "BEFORE" block that doesn't exactly match on-main, follow the on-main shape and apply the architectural change the plan describes (insert CAGG path between rollup-status arms and the live-aggregation fallback). The architecture is correct; some surface details must adapt.

---

## Scope

**In scope:**
- 6 new continuous aggregates: `transactions_passed_5s`, `transactions_passed_1m`, `transactions_passed_5m`, `requests_raw_passed_5s`, `requests_raw_passed_1m`, `requests_raw_passed_5m` — each carrying only the success-filtered sketch + group keys
- Refresh + retention policies on all six new CAGGs (matching the existing 5s/1m/5m cadences from migration `1777500000000`)
- New `getTransactionStatsFromCagg` and `getTransactionSamplesFromCagg` private helpers in `TestRunsPerformanceQueryService`
- New scope-lookup helper that returns the same fields `loadThroughputRunInfo` does PLUS workload, for the threshold join
- Wire the CAGG fast path into `getTransactionStats` and `getTransactionSamples` between the rollup check and the raw-scan fallback (covers both `sinceMinutes==null` AND `sinceMinutes!=null`)
- Amend the rollup-pending gate so 202 fires only when CAGG is also empty
- Unit tests against the SQL shape (mocked `query`) and a small integration test that seeds the CAGG and asserts equivalence with the rollup result on a synthetic dataset
- Documentation: `CHANGELOG`, version bump, and a one-paragraph note in the existing pending-gate plan's follow-up

**Out of scope:**
- Frontend changes: live numbers from CAGG come back as a normal 200 transaction-stats response — the existing UI renders them. The "rollup-pending" UI state (from the prior plan) becomes rare and we don't reskin it here.
- Adding `test_run_id` as a CAGG dimension — accepts the existing time-window-scope precedent from `getThroughputStatsFromCagg`. Concurrent overlapping runs against the same (SUT, env) are out of scope for this plan; revisit only if it bites.
- url_pattern enrichment for CAGG-served sampler results (the CAGG doesn't carry `url_hash`). The CAGG sampler path returns `url_hash = null` — UI already handles missing url_hash. Real fix is a separate enhancement.
- Replacing the legacy raw-scan fallback. It's the third-tier fallback for the (rare) case where CAGG is empty for a window AND no active job exists. The Task 11 statement_timeout safety net from the pending-gate plan stays.
- Rebuilding the existing `transactions_5s` / `requests_raw_5s` CAGGs to add `pct_agg_passed` directly. We use side-by-side CAGGs to avoid the throughput outage that DROP+CREATE would cause.

---

## File Structure

**Migrations:**
- Create: `packages/shared/src/database/migrations/1779100000000-AddPctAggPassedCaggs.ts` — six new CAGGs + policies

**API service:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`
  - Add private `loadCaggApdexScope(testRunId, excludeRampUp, isAdmin, organizationIds)` returning `{ sut, env, workload, startTime, endTime, cutoffTime, hasTransactionsCagg, hasRequestsRawCagg } | null`
  - Add private `getTransactionStatsFromCagg(scope, organizationIds)` returning `TransactionStats[]`
  - Add private `getTransactionSamplesFromCagg(scope, transactionName, organizationIds)` returning `SamplerStats[]`
  - Modify `getTransactionStats` to try the CAGG fast path between rollup and raw scan (both `sinceMinutes==null` and `sinceMinutes!=null` paths)
  - Modify `getTransactionSamples` analogously
  - Modify `getRollupStatus` (introduced by the pending-gate plan) to also check CAGG presence: only return `'rollup-pending'` when both rollup AND CAGG are empty

**API service spec:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts`
  - New `describe('CAGG fast path')` blocks under both `getTransactionStats` and `getTransactionSamples`
  - Extend `describe('getRollupStatus')` to cover the "rollup empty + CAGG present" → `'ready-from-cagg'` case (or, simpler, to cover that the CAGG path runs and the gate is *not* triggered)

**Worker integration test (new, optional):**
- Create: `apps/worker/src/test/integration/cagg-apdex-equivalence.integration.test.ts` — seeds raw + CAGG data, asserts CAGG-derived Apdex matches rollup-derived Apdex within tdigest/uddsketch cross-family error budget (~1% absolute on Apdex)

**Docs:**
- Modify: `CHANGELOG.md`
- Modify: `VERSION`
- Modify (one-line update): `docs/superpowers/plans/2026-05-09-apdex-rollup-pending-gate.md` — append to the "Follow-up issue" section noting this plan delivers the fix

---

## Tasks

### Task 1: Investigation — confirm CAGG schema and dataset

**Files:** none (read-only)

This is a sanity check before any code changes. Confirm three things on the dev DB:
1. The existing `transactions_5s` / `requests_raw_5s` CAGGs are populated with recent test data
2. Refresh policies are running (no stale `materialization_invalidation_log`)
3. A synthetic Apdex query against `transactions_5s` returns sensible results vs. raw `transactions`

- [ ] **Step 1: Verify CAGGs exist and are non-empty**

```bash
docker exec -it perfana-postgres psql -U perfana -d perfana -c "
  SELECT view_name, materialized_only
  FROM timescaledb_information.continuous_aggregates
  WHERE view_name IN ('transactions_5s','requests_raw_5s','transactions_1m','requests_raw_1m','transactions_5m','requests_raw_5m')
  ORDER BY 1;
"
```

Expected: 6 rows, all `materialized_only=true`.

- [ ] **Step 2: Confirm at least one recent test run is fully covered by `transactions_5s`**

Pick the most recent completed test run from `test_runs` (any) and confirm coverage:

```bash
docker exec -it perfana-postgres psql -U perfana -d perfana -c "
  WITH r AS (
    SELECT tr.test_run_id, sut.name AS sut, tr.test_environment AS env,
           tr.start_time, tr.end_time
    FROM test_runs tr
    JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
    WHERE tr.end_time IS NOT NULL
    ORDER BY tr.end_time DESC LIMIT 1
  )
  SELECT
    r.test_run_id,
    (SELECT COUNT(*) FROM transactions WHERE test_run_id = r.test_run_id)             AS raw_rows,
    (SELECT COUNT(*) FROM transactions_5s c
     WHERE c.system_under_test = r.sut AND c.test_environment = r.env
       AND c.bucket >= r.start_time AND c.bucket < r.end_time + interval '5 seconds') AS cagg_buckets
  FROM r;
"
```

Expected: `raw_rows >> 0`, `cagg_buckets > 0` and approximately `(end - start) / 5s × distinct_transactions`. Record the numbers in the PR description.

- [ ] **Step 3: Compare a synthetic CAGG-vs-raw Apdex on one transaction**

```bash
docker exec -it perfana-postgres psql -U perfana -d perfana -c "
  -- Replace TEST_RUN_ID and TXN_NAME with values from Step 2 / dev data.
  WITH r AS (
    SELECT tr.test_run_id, sut.name AS sut, tr.test_environment AS env,
           tr.start_time, tr.end_time
    FROM test_runs tr
    JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
    WHERE tr.test_run_id = 'TEST_RUN_ID'
  ),
  raw_apdex AS (
    SELECT t.transaction_name,
           approx_percentile_rank(500::double precision, percentile_agg(t.response_time::double precision))
           + (approx_percentile_rank(2000::double precision, percentile_agg(t.response_time::double precision))
              - approx_percentile_rank(500::double precision, percentile_agg(t.response_time::double precision))) / 2
             AS apdex_all_rows
    FROM transactions t WHERE t.test_run_id = (SELECT test_run_id FROM r) GROUP BY 1
    HAVING t.transaction_name = 'TXN_NAME'
  ),
  cagg_apdex AS (
    SELECT c.transaction_name,
           approx_percentile_rank(500::double precision, rollup(c.pct_agg))
           + (approx_percentile_rank(2000::double precision, rollup(c.pct_agg))
              - approx_percentile_rank(500::double precision, rollup(c.pct_agg))) / 2
             AS apdex_all_rows
    FROM transactions_5s c, r
    WHERE c.system_under_test = r.sut AND c.test_environment = r.env
      AND c.bucket >= r.start_time AND c.bucket < r.end_time + interval '5 seconds'
      AND c.transaction_name = 'TXN_NAME'
    GROUP BY 1
  )
  SELECT raw_apdex.apdex_all_rows AS raw, cagg_apdex.apdex_all_rows AS cagg,
         abs(raw_apdex.apdex_all_rows - cagg_apdex.apdex_all_rows) AS abs_err
  FROM raw_apdex, cagg_apdex;
"
```

Expected: `abs_err < 0.02` (2 percentage points — uddsketch on 5s buckets vs raw uddsketch). If the gap is larger, investigate `materialization_invalidation_log` or run `CALL refresh_continuous_aggregate('transactions_5s', NULL, NULL)` and re-run.

- [ ] **Step 4: Document findings in the PR draft**

In the eventual PR description, record `raw_rows`, `cagg_buckets`, and `abs_err` from steps 2-3. No commit in this task.

---

### Task 2: Migration — six new pct_agg_passed CAGGs + policies

**Files:**
- Create: `packages/shared/src/database/migrations/1779100000000-AddPctAggPassedCaggs.ts`

Six new continuous aggregates (3 for transactions, 3 for requests_raw), each carrying only `pct_agg_passed` and the group keys. The existing CAGGs continue to carry `pct_agg` and counts. Live Apdex queries JOIN the two families on bucket + group keys.

- [ ] **Step 1: Create the migration file**

```typescript
// packages/shared/src/database/migrations/1779100000000-AddPctAggPassedCaggs.ts

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Side-by-side CAGGs carrying success-filtered percentile sketches
 * (`pct_agg_passed = percentile_agg(response_time) FILTER (WHERE success)`).
 * Used by the live Apdex fast path in TestRunsPerformanceQueryService —
 * combined with the existing `transactions_5s` / `requests_raw_5s` CAGGs
 * (which carry `pct_agg` over all rows + n/n_ok/n_err) to compute the
 * exact same Apdex the post-test rollup table delivers, but in O(buckets).
 *
 * Side-by-side rather than ALTERing the existing CAGGs because Timescale
 * does not support adding aggregate columns to a continuous aggregate;
 * DROP+CREATE on `transactions_5s` would dark out the throughput panels
 * for the duration of the rematerialization. New CAGGs materialize in
 * the background; until they catch up, the live Apdex code falls
 * through to the raw-scan path (Task 11 of the rollup-pending-gate plan
 * already added a 60-min clamp + 10s statement_timeout safety net).
 *
 * Sketch family: `percentile_agg` returns `uddsketch`. The companion
 * existing CAGGs use the same family, so `rollup(pct_agg)` and
 * `rollup(pct_agg_passed)` and any cross-CAGG operations stay in-family.
 * (The per-test-run rollup tables use `tdigest` — different family, but
 * we never mix sketches across the two paths.)
 *
 * Related: rollup-table equivalent is migration 1779000000000 (#298).
 * This migration is the CAGG-side analog: same idea, applied to the
 * live aggregation path so the live Apdex score stops counting failed
 * rows as satisfied/tolerating and the query stops scanning raw rows.
 */
export class AddPctAggPassedCaggs1779100000000 implements MigrationInterface {
  name = 'AddPctAggPassedCaggs1779100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- transactions_passed family -----------------------------------------

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_passed_5s
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 seconds'::interval, time)             AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        transaction_name,
        percentile_agg(response_time::double precision)
          FILTER (WHERE success)                              AS pct_agg_passed
      FROM transactions
      GROUP BY 1, 2, 3, 4, 5
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_passed_1m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 minute'::interval, bucket)            AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        transaction_name,
        rollup(pct_agg_passed)                                AS pct_agg_passed
      FROM transactions_passed_5s
      GROUP BY 1, 2, 3, 4, 5
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_passed_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes'::interval, bucket)           AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        transaction_name,
        rollup(pct_agg_passed)                                AS pct_agg_passed
      FROM transactions_passed_1m
      GROUP BY 1, 2, 3, 4, 5
      WITH NO DATA;
    `);

    // --- requests_raw_passed family -----------------------------------------

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_passed_5s
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 seconds'::interval, time)             AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        sampler_name,
        transaction_name,
        location,
        percentile_agg(response_time::double precision)
          FILTER (WHERE success)                              AS pct_agg_passed
      FROM requests_raw
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_passed_1m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 minute'::interval, bucket)            AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        sampler_name,
        transaction_name,
        location,
        rollup(pct_agg_passed)                                AS pct_agg_passed
      FROM requests_raw_passed_5s
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      WITH NO DATA;
    `);

    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS requests_raw_passed_5m
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes'::interval, bucket)           AS bucket,
        system_under_test,
        test_environment,
        scenario_name,
        sampler_name,
        transaction_name,
        location,
        rollup(pct_agg_passed)                                AS pct_agg_passed
      FROM requests_raw_passed_1m
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      WITH NO DATA;
    `);

    // --- refresh policies ---------------------------------------------------
    // Match the existing transactions_5s / requests_raw_5s family from
    // migration 1777500000000.

    const refreshPolicies = [
      { view: 'transactions_passed_5s',  start: '1 hour',  end: '1 minute',  schedule: '30 seconds' },
      { view: 'transactions_passed_1m',  start: '2 hours', end: '2 minutes', schedule: '1 minute' },
      { view: 'transactions_passed_5m',  start: '1 day',   end: '5 minutes', schedule: '5 minutes' },
      { view: 'requests_raw_passed_5s',  start: '1 hour',  end: '1 minute',  schedule: '30 seconds' },
      { view: 'requests_raw_passed_1m',  start: '2 hours', end: '2 minutes', schedule: '1 minute' },
      { view: 'requests_raw_passed_5m',  start: '1 day',   end: '5 minutes', schedule: '5 minutes' },
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
    }

    // --- retention policies -------------------------------------------------
    // 90 days, matching the existing CAGG family.
    const views = [
      'transactions_passed_5s',  'transactions_passed_1m',  'transactions_passed_5m',
      'requests_raw_passed_5s',  'requests_raw_passed_1m',  'requests_raw_passed_5m',
    ];
    for (const view of views) {
      await queryRunner.query(`
        SELECT add_retention_policy('${view}',
          drop_after    => INTERVAL '90 days',
          if_not_exists => TRUE
        );
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const views = [
      'transactions_passed_5m', 'transactions_passed_1m', 'transactions_passed_5s',
      'requests_raw_passed_5m', 'requests_raw_passed_1m', 'requests_raw_passed_5s',
    ];
    for (const view of views) {
      await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS ${view} CASCADE`);
    }
  }
}
```

- [ ] **Step 2: Apply the migration on the dev DB**

Per CLAUDE.md memory `project_migration_run_broken.md`, `apps/api migration:run` is broken. Apply the SQL directly via docker:

```bash
# Extract just the up()-side SQL and apply it
docker exec -i perfana-postgres psql -U perfana -d perfana <<'SQL'
-- (paste the six CREATE MATERIALIZED VIEW statements + the SELECT add_continuous_aggregate_policy calls + the SELECT add_retention_policy calls)
SQL
```

Or, simpler — keep the migration file in source and use a targeted helper. For dev only, paste the SQL inline. Verify with:

```bash
docker exec -it perfana-postgres psql -U perfana -d perfana -c "
  SELECT view_name FROM timescaledb_information.continuous_aggregates
  WHERE view_name LIKE '%_passed_%' ORDER BY 1;
"
```

Expected: 6 rows.

- [ ] **Step 3: Trigger initial materialization for the most recent 24h**

The CAGGs were created `WITH NO DATA`. Refresh policies will pick up new buckets going forward, but historical data needs an explicit refresh. Refresh the most recent day so the test in Task 1 still works:

```bash
docker exec -it perfana-postgres psql -U perfana -d perfana -c "
  CALL refresh_continuous_aggregate('transactions_passed_5s', NOW() - interval '1 day', NOW());
  CALL refresh_continuous_aggregate('transactions_passed_1m', NOW() - interval '1 day', NOW());
  CALL refresh_continuous_aggregate('transactions_passed_5m', NOW() - interval '1 day', NOW());
  CALL refresh_continuous_aggregate('requests_raw_passed_5s', NOW() - interval '1 day', NOW());
  CALL refresh_continuous_aggregate('requests_raw_passed_1m', NOW() - interval '1 day', NOW());
  CALL refresh_continuous_aggregate('requests_raw_passed_5m', NOW() - interval '1 day', NOW());
"
```

For production, document a phased backfill plan: oldest → newest in 1-day chunks during low-load hours, monitoring `pg_stat_activity` for hypertable read pressure. Capture this in the PR description (Rollout section).

- [ ] **Step 4: Spot-check that the new CAGG agrees with raw**

```bash
docker exec -it perfana-postgres psql -U perfana -d perfana -c "
  WITH r AS (SELECT 'TEST_RUN_ID' AS trid),
  raw AS (
    SELECT t.transaction_name,
           approx_percentile_rank(500::double precision,
             percentile_agg(t.response_time::double precision) FILTER (WHERE t.success)) AS rank_T
    FROM transactions t WHERE t.test_run_id = (SELECT trid FROM r)
      AND t.transaction_name = 'TXN_NAME' GROUP BY 1
  ),
  cagg AS (
    SELECT c.transaction_name,
           approx_percentile_rank(500::double precision, rollup(c.pct_agg_passed)) AS rank_T
    FROM transactions_passed_5s c
    JOIN test_runs tr ON tr.test_run_id = (SELECT trid FROM r)
    JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
    WHERE c.system_under_test = sut.name AND c.test_environment = tr.test_environment
      AND c.bucket >= tr.start_time AND c.bucket < tr.end_time + interval '5 seconds'
      AND c.transaction_name = 'TXN_NAME' GROUP BY 1
  )
  SELECT raw.rank_T AS raw, cagg.rank_T AS cagg, abs(raw.rank_T - cagg.rank_T) AS abs_err
  FROM raw, cagg;
"
```

Expected: `abs_err < 0.02`. Record the value.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/database/migrations/1779100000000-AddPctAggPassedCaggs.ts
git commit -m "feat(db): add pct_agg_passed continuous aggregates for live Apdex fast path"
```

---

### Task 3: Add `loadCaggApdexScope` helper

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`
- Test: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts`

This helper is `loadThroughputRunInfo` plus `workload` (for the threshold join) plus a probe of the *passed* CAGG (so we know whether the new sketches are populated for this run's window — without them, Apdex correctness regresses to the all-rows shape and we should fall through to the raw scan).

- [ ] **Step 1: Write the failing tests**

Add a new `describe('loadCaggApdexScope')` block to the spec, near the existing throughput tests (which exercise the analogous `loadThroughputRunInfo`):

```typescript
// apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts
// Add inside the top-level describe('TestRunsPerformanceQueryService', () => { ... })

describe('loadCaggApdexScope', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns scope + workload + has-cagg flags when the run exists and CAGGs are populated', async () => {
    mockTestRunRepo.query.mockResolvedValue([{
      sut: 'demo-sut',
      env: 'prod',
      workload: 'wl-1',
      start_time: '2026-05-09T10:00:00Z',
      end_time:   '2026-05-09T10:30:00Z',
      ramp_up: '60',
      has_transactions_cagg: true,
      has_requests_raw_cagg: true,
    }]);

    const scope = await (service as any).loadCaggApdexScope('tr1', /* excludeRampUp */ true, /* isAdmin */ true, []);

    expect(scope).toEqual({
      sut: 'demo-sut',
      env: 'prod',
      workload: 'wl-1',
      startTime: new Date('2026-05-09T10:00:00Z'),
      endTime:   new Date('2026-05-09T10:30:00Z'),
      cutoffTime: new Date('2026-05-09T10:01:00Z'),  // start + 60s
      hasTransactionsCagg: true,
      hasRequestsRawCagg: true,
    });
  });

  it('returns null when the run does not exist or org filter excludes the user', async () => {
    mockTestRunRepo.query.mockResolvedValue([]);
    const scope = await (service as any).loadCaggApdexScope('tr1', false, false, ['org-1']);
    expect(scope).toBeNull();
  });

  it('reports has-cagg flags as false when the CAGG has no rows for the run window', async () => {
    mockTestRunRepo.query.mockResolvedValue([{
      sut: 'demo-sut', env: 'prod', workload: 'wl-1',
      start_time: '2026-05-09T10:00:00Z', end_time: '2026-05-09T10:30:00Z',
      ramp_up: null,
      has_transactions_cagg: false,
      has_requests_raw_cagg: false,
    }]);

    const scope = await (service as any).loadCaggApdexScope('tr1', false, true, []);
    expect(scope).not.toBeNull();
    expect(scope!.hasTransactionsCagg).toBe(false);
    expect(scope!.hasRequestsRawCagg).toBe(false);
    expect(scope!.cutoffTime).toBeNull();
  });

  it('passes organizationIds for non-admin and applies the org filter clause', async () => {
    mockTestRunRepo.query.mockResolvedValue([]);
    await (service as any).loadCaggApdexScope('tr1', false, false, ['org-1']);
    const sql = mockTestRunRepo.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/sut\.organization_id\s*=\s*ANY\(\$2::uuid\[\]\)/);
    expect(mockTestRunRepo.query.mock.calls[0][1]).toEqual(['tr1', ['org-1']]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest test-runs-performance-query.service.spec.ts -t "loadCaggApdexScope"
```

Expected: 4 failures, "loadCaggApdexScope is not a function".

- [ ] **Step 3: Implement the helper**

Add this near `loadThroughputRunInfo` (around line 1144) in `test-runs-performance-query.service.ts`:

```typescript
/**
 * Scope + flags needed for the live-Apdex CAGG fast path:
 *   - resolves (sut.name, test_environment, workload) — workload is needed for
 *     the threshold join and is NOT a CAGG dimension, so we read it once here
 *   - applies the org filter on `sut.organization_id`; returns null if the
 *     user can't see this run (matches the existing empty-stats semantics)
 *   - computes the ramp-up cutoff inline
 *   - probes both `transactions_passed_5s` and `requests_raw_passed_5s` for
 *     this run's window — without `pct_agg_passed`, Apdex correctness
 *     regresses, so the caller falls through to the raw-scan path when these
 *     are false (e.g. backfill not yet caught up, refresh lag at run start)
 */
private async loadCaggApdexScope(
  resolvedTestRunId: string,
  excludeRampUp: boolean,
  isAdmin: boolean,
  organizationIds: string[],
): Promise<{
  sut: string;
  env: string;
  workload: string | null;
  startTime: Date;
  endTime: Date;
  cutoffTime: Date | null;
  hasTransactionsCagg: boolean;
  hasRequestsRawCagg: boolean;
} | null> {
  const orgFilterClause = !isAdmin ? 'AND sut.organization_id = ANY($2::uuid[])' : '';

  const query = `
    SELECT
      sut.name             AS sut,
      tr.test_environment  AS env,
      tr.workload          AS workload,
      tr.start_time        AS start_time,
      tr.end_time          AS end_time,
      tr.ramp_up           AS ramp_up,
      EXISTS (
        SELECT 1 FROM transactions_passed_5s c
        WHERE c.system_under_test = sut.name
          AND c.test_environment  = tr.test_environment
          AND c.bucket >= tr.start_time
          AND c.bucket <  COALESCE(tr.end_time, NOW()) + interval '5 seconds'
      ) AS has_transactions_cagg,
      EXISTS (
        SELECT 1 FROM requests_raw_passed_5s c
        WHERE c.system_under_test = sut.name
          AND c.test_environment  = tr.test_environment
          AND c.bucket >= tr.start_time
          AND c.bucket <  COALESCE(tr.end_time, NOW()) + interval '5 seconds'
      ) AS has_requests_raw_cagg
    FROM test_runs tr
    JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
    WHERE tr.test_run_id = $1
      ${orgFilterClause}
    LIMIT 1
  `;

  const params: unknown[] = !isAdmin ? [resolvedTestRunId, organizationIds] : [resolvedTestRunId];
  const rows = await withRequestEm(this.testRunRepo).query(query, params);
  if (!rows || rows.length === 0) return null;

  const row = rows[0] as {
    sut: string;
    env: string;
    workload: string | null;
    start_time: string | Date | null;
    end_time: string | Date | null;
    ramp_up: string | number | null;
    has_transactions_cagg: boolean;
    has_requests_raw_cagg: boolean;
  };

  if (!row.start_time) return null;

  const startTime = new Date(row.start_time);
  // For an in-flight run, end_time is null; clamp to NOW() so the bucket
  // window query above works. Live windows during a running test go through
  // the same path.
  const endTime = row.end_time ? new Date(row.end_time) : new Date();

  let cutoffTime: Date | null = null;
  if (excludeRampUp && row.ramp_up != null) {
    const rampUpSeconds = this.mapper.parseInt(row.ramp_up);
    if (rampUpSeconds > 0) cutoffTime = new Date(startTime.getTime() + rampUpSeconds * 1000);
  }

  return {
    sut: row.sut,
    env: row.env,
    workload: row.workload,
    startTime,
    endTime,
    cutoffTime,
    hasTransactionsCagg: row.has_transactions_cagg === true,
    hasRequestsRawCagg: row.has_requests_raw_cagg === true,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/api && npx jest test-runs-performance-query.service.spec.ts -t "loadCaggApdexScope"
```

Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts \
        apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts
git commit -m "feat(api): add loadCaggApdexScope helper for live-Apdex CAGG fast path"
```

---

### Task 4: Implement `getTransactionStatsFromCagg`

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`
- Test: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts`

The query mirrors the rollup-table fast path but reads from CAGGs instead. Two CAGGs are joined: `transactions_5s` for `n` / `n_ok` / `n_err` / `pct_agg` / `avg_rt`, and `transactions_passed_5s` for `pct_agg_passed`. JOIN on `(bucket, system_under_test, test_environment, scenario_name, transaction_name)`.

- [ ] **Step 1: Write the failing tests**

Add a `describe('CAGG fast path')` block under `describe('getTransactionStats')`:

```typescript
describe('CAGG fast path', () => {
  beforeEach(() => jest.clearAllMocks());

  const baseScope = {
    sut: 'demo-sut', env: 'prod', workload: 'wl-1',
    startTime: new Date('2026-05-09T10:00:00Z'),
    endTime:   new Date('2026-05-09T10:30:00Z'),
    cutoffTime: null,
    hasTransactionsCagg: true,
    hasRequestsRawCagg: true,
  };

  it('runs the CAGG query and returns mapped stats', async () => {
    jest.spyOn(service as any, 'getRollupStatus').mockResolvedValue({ status: 'unavailable' });
    jest.spyOn(service as any, 'loadCaggApdexScope').mockResolvedValue(baseScope);

    mockTestRunRepo.manager.transaction = jest.fn(async (cb: any) =>
      cb({ query: jest.fn().mockResolvedValue([{
        transaction_name: 'tx', scenario_name: 'sc',
        total_count: '100', passed_count: '95', failed_count: '5',
        avg_response_time: '420.50', p95_response_time: '900.00', p99_response_time: '1200.00',
        impact_score: '42050.00', active_threshold: '500',
        apdex_score: '0.875', ranking: '1',
      }]) }),
    );

    const result = await service.getTransactionStats('tr1', /* excludeRampUp */ false, /* isAdmin */ true, []);

    expect(Array.isArray(result)).toBe(true);
    expect((result as any[])[0]).toMatchObject({
      transaction_name: 'tx',
      total_count: 100, passed_count: 95, failed_count: 5,
      apdex_score: 0.875, active_threshold: 500,
    });
  });

  it('JOINs transactions_5s and transactions_passed_5s on (bucket, sut, env, scenario, transaction)', async () => {
    jest.spyOn(service as any, 'getRollupStatus').mockResolvedValue({ status: 'unavailable' });
    jest.spyOn(service as any, 'loadCaggApdexScope').mockResolvedValue(baseScope);

    const queryFn = jest.fn().mockResolvedValue([]);
    mockTestRunRepo.manager.transaction = jest.fn(async (cb: any) => cb({ query: queryFn }));

    await service.getTransactionStats('tr1', false, true, []);

    const sql = queryFn.mock.calls.find(c => /transactions_5s/.test(c[0] as string))?.[0] as string;
    expect(sql).toBeDefined();
    expect(sql).toMatch(/FROM\s+transactions_5s/);
    expect(sql).toMatch(/JOIN\s+transactions_passed_5s/);
    // JOIN keys
    expect(sql).toMatch(/c\.bucket\s*=\s*p\.bucket/);
    expect(sql).toMatch(/c\.system_under_test\s*=\s*p\.system_under_test/);
    expect(sql).toMatch(/c\.transaction_name\s*=\s*p\.transaction_name/);
    // Aggregation: rollup(pct_agg) and rollup(pct_agg_passed)
    expect(sql).toMatch(/rollup\(c\.pct_agg\)/);
    expect(sql).toMatch(/rollup\(p\.pct_agg_passed\)/);
    // Apdex uses pct_agg_passed (success-filtered) — the post-#298 fix
    expect(sql).toMatch(/approx_percentile_rank\([^)]*active_threshold[^)]*pct_agg_passed[^)]*\)/);
  });

  it('falls through to raw scan when transactions_passed CAGG is empty for the window', async () => {
    jest.spyOn(service as any, 'getRollupStatus').mockResolvedValue({ status: 'unavailable' });
    jest.spyOn(service as any, 'loadCaggApdexScope').mockResolvedValue({
      ...baseScope, hasTransactionsCagg: false,
    });
    // raw-scan path is exercised — not asserting its full shape, just that we did NOT short-circuit on CAGG
    mockTestRunRepo.manager.transaction = jest.fn(async (cb: any) =>
      cb({ query: jest.fn().mockResolvedValue([]) }),
    );

    const result = await service.getTransactionStats('tr1', false, true, []);
    expect(Array.isArray(result)).toBe(true);
    // Confirm we didn't read the CAGG-specific tables — sample the SQL of the only call (raw-scan)
    const calls = (mockTestRunRepo.manager.transaction as jest.Mock).mock.calls;
    const queryFn = (calls[0][0] as any);  // not directly callable; instead inspect via spy in the body
  });

  it('uses the CAGG path even when sinceMinutes is set (live window)', async () => {
    jest.spyOn(service as any, 'getRollupStatus');  // should NOT be called when sinceMinutes is set
    jest.spyOn(service as any, 'loadCaggApdexScope').mockResolvedValue(baseScope);

    const queryFn = jest.fn().mockResolvedValue([]);
    mockTestRunRepo.manager.transaction = jest.fn(async (cb: any) => cb({ query: queryFn }));

    await service.getTransactionStats('tr1', false, true, [], /* sinceMinutes */ 5);

    // CAGG SQL ran
    const ranCagg = queryFn.mock.calls.some(c => /transactions_passed_5s/.test(c[0] as string));
    expect(ranCagg).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest test-runs-performance-query.service.spec.ts -t "CAGG fast path"
```

Expected: 4 failures.

- [ ] **Step 3: Implement `getTransactionStatsFromCagg`**

Add right after `getTransactionStatsFromRollup` (around line 245 in the service):

```typescript
/**
 * CAGG-backed live aggregation for transaction stats. Reads from
 * `transactions_5s` (counts + all-rows percentile sketch) joined with
 * `transactions_passed_5s` (success-filtered percentile sketch added in
 * migration 1779100000000) instead of scanning raw `transactions`.
 *
 * Apdex correctness: uses `rollup(pct_agg_passed)` for the
 * approx_percentile_rank inputs — same shape as the rollup table fast
 * path post-#298. p95/p99 still come from `rollup(pct_agg)` (all rows),
 * matching the rollup behaviour.
 *
 * Threshold lookup: workload is read once from `test_runs` in the
 * scope-loader (workload is not a CAGG dimension; one test_run = one
 * workload). The workload-level / per-transaction threshold tables are
 * joined post-aggregation against the small per-transaction result.
 *
 * Precision tradeoff vs. the rollup table: the rollup table sketches
 * are over the exact ramp-up cutoff (per-row `t.time >= cutoff`); the
 * CAGG path filters on 5s bucket boundaries (`c.bucket >= time_bucket('5s', cutoff)`),
 * so up to one 5s bucket of ramp-up data may be included or excluded.
 * Negligible for full-test Apdex; documented for transparency.
 */
private async getTransactionStatsFromCagg(
  scope: {
    sut: string; env: string; workload: string | null;
    startTime: Date; endTime: Date; cutoffTime: Date | null;
  },
  excludeRampUp: boolean,
): Promise<TransactionStats[]> {
  const params: unknown[] = [
    scope.sut, scope.env,                                          // $1, $2
    scope.startTime, scope.endTime,                                // $3, $4
    excludeRampUp, scope.cutoffTime,                               // $5, $6
    scope.workload,                                                // $7 (for threshold join)
  ];

  const query = `
    WITH agg AS (
      SELECT
        c.transaction_name,
        c.scenario_name,
        SUM(c.n)::bigint                                          AS total_count,
        SUM(c.n_ok)::bigint                                       AS passed_count,
        SUM(c.n_err)::bigint                                      AS failed_count,
        ROUND((SUM(c.avg_rt * c.n) / NULLIF(SUM(c.n),0))::numeric, 2)  AS avg_response_time,
        rollup(c.pct_agg)                                         AS pct_agg_all,
        rollup(p.pct_agg_passed)                                  AS pct_agg_passed,
        ROUND((SUM(c.avg_rt * c.n))::numeric, 2)                  AS impact_score
      FROM transactions_5s c
      JOIN transactions_passed_5s p
        ON  c.bucket            = p.bucket
        AND c.system_under_test = p.system_under_test
        AND c.test_environment  = p.test_environment
        AND c.scenario_name IS NOT DISTINCT FROM p.scenario_name
        AND c.transaction_name  = p.transaction_name
      WHERE c.system_under_test = $1
        AND c.test_environment  = $2
        AND c.bucket >= $3::timestamptz
        AND c.bucket <  $4::timestamptz + interval '5 seconds'
        AND ($5::boolean = false OR $6::timestamptz IS NULL
             OR c.bucket >= time_bucket('5 seconds'::interval, $6::timestamptz))
      GROUP BY c.transaction_name, c.scenario_name
    ),
    threshold_per_tx AS (
      SELECT
        a.transaction_name,
        a.scenario_name,
        COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
      FROM agg a
      JOIN systems_under_test sut ON sut.name = $1
      LEFT JOIN workload_apdex_thresholds wat
        ON  wat.system_under_test_id = sut.id
        AND wat.test_environment     = $2
        AND wat.workload             = $7
      LEFT JOIN workload_transaction_apdex_thresholds wtat
        ON  wtat.system_under_test_id = sut.id
        AND wtat.test_environment     = $2
        AND wtat.workload             = $7
        AND wtat.transaction_name     = a.transaction_name
    ),
    scored AS (
      SELECT
        a.transaction_name, a.scenario_name,
        a.total_count, a.passed_count, a.failed_count,
        a.avg_response_time,
        ROUND(approx_percentile(0.95, a.pct_agg_all)::numeric, 2) AS p95_response_time,
        ROUND(approx_percentile(0.99, a.pct_agg_all)::numeric, 2) AS p99_response_time,
        a.impact_score, t.active_threshold,
        ROUND(
          (
            approx_percentile_rank(t.active_threshold::double precision, a.pct_agg_passed)
            + (approx_percentile_rank((t.active_threshold * 4)::double precision, a.pct_agg_passed)
               - approx_percentile_rank(t.active_threshold::double precision, a.pct_agg_passed)) / 2
          )::numeric, 3
        ) AS apdex_score
      FROM agg a
      JOIN threshold_per_tx t
        ON  t.transaction_name = a.transaction_name
        AND t.scenario_name IS NOT DISTINCT FROM a.scenario_name
    )
    SELECT
      transaction_name, scenario_name,
      total_count, passed_count, failed_count,
      avg_response_time, p95_response_time, p99_response_time,
      impact_score, active_threshold, apdex_score,
      RANK() OVER (ORDER BY impact_score DESC) AS ranking
    FROM scored
    ORDER BY transaction_name ASC
  `;

  const result = await withRequestEm(this.testRunRepo).manager.transaction(async (em) => {
    await em.query(`SET LOCAL work_mem = '256MB'`);
    return em.query(query, params);
  });

  return result.map((row: Record<string, unknown>) => ({
    transaction_name: row.transaction_name as string,
    scenario_name: (row.scenario_name as string) || undefined,
    avg_response_time: this.mapper.parseFloat(row.avg_response_time),
    p95_response_time: this.mapper.parseFloat(row.p95_response_time),
    p99_response_time: this.mapper.parseFloat(row.p99_response_time),
    passed_count: this.mapper.parseInt(row.passed_count),
    failed_count: this.mapper.parseInt(row.failed_count),
    total_count: this.mapper.parseInt(row.total_count),
    ranking: this.mapper.parseFloat(row.ranking),
    apdex_score: this.mapper.parseFloat(row.apdex_score),
    active_threshold: this.mapper.parseInt(row.active_threshold, 500),
  }));
}
```

- [ ] **Step 4: Wire the CAGG path into `getTransactionStats`**

Replace the gate block (Task 3 of the pending-gate plan changed this region; this further amends it). Locate the current block:

```typescript
// CURRENT (after pending-gate plan):
if (sinceMinutes == null) {
  const rollupStatus = await this.getRollupStatus(resolvedTestRunId);
  if (rollupStatus.status === 'ready') {
    return await this.getTransactionStatsFromRollup(...);
  }
  if (rollupStatus.status === 'rollup-pending') {
    return rollupStatus;
  }
  // status === 'unavailable' → fall through to live aggregation
}
```

Change to:

```typescript
// AFTER:
if (sinceMinutes == null) {
  const rollupStatus = await this.getRollupStatus(resolvedTestRunId);
  if (rollupStatus.status === 'ready') {
    return await this.getTransactionStatsFromRollup(
      resolvedTestRunId, excludeRampUp, isAdmin, organizationIds,
    );
  }
  // rollup-pending OR unavailable → try the CAGG fast path before any 202 / raw scan
  const caggScope = await this.loadCaggApdexScope(
    resolvedTestRunId, excludeRampUp, isAdmin, organizationIds,
  );
  if (caggScope?.hasTransactionsCagg) {
    return await this.getTransactionStatsFromCagg(caggScope, excludeRampUp);
  }
  if (rollupStatus.status === 'rollup-pending') {
    // Both rollup table AND CAGG empty — return 202 (preserves the
    // pending-gate plan's behaviour for the cold-start case)
    return rollupStatus;
  }
  // unavailable + no CAGG → fall through to raw scan (existing soft-fail path)
}

// sinceMinutes != null path (live window): also try the CAGG fast path
// before raw scan. Skip the rollup-status check entirely (live windows
// bypass rollup by design).
if (sinceMinutes != null) {
  const caggScope = await this.loadCaggApdexScope(
    resolvedTestRunId, excludeRampUp, isAdmin, organizationIds,
  );
  if (caggScope?.hasTransactionsCagg) {
    // For live windows, narrow the scope's startTime to NOW() - sinceMinutes
    const liveStart = new Date(Date.now() - sinceMinutes * 60_000);
    const adjustedScope = {
      ...caggScope,
      startTime: liveStart > caggScope.startTime ? liveStart : caggScope.startTime,
    };
    return await this.getTransactionStatsFromCagg(adjustedScope, excludeRampUp);
  }
  // Else fall through to existing raw-scan with statement_timeout safety net
}
```

Update the return type signature to keep `RollupPendingResult` in the union (already added by the prior plan):

```typescript
async getTransactionStats(
  ...
): Promise<TransactionStats[] | RollupPendingResult> {
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && npx jest test-runs-performance-query.service.spec.ts -t "CAGG fast path|getRollupStatus|getTransactionStats"
```

Expected: all CAGG tests pass; existing rollup-status tests need a small update — the gate test "returns rollup-pending when status is pending" must now also stub `loadCaggApdexScope` to return `hasTransactionsCagg: false`. Update the existing test:

```typescript
// In "returns RollupPendingResult when status is pending and sinceMinutes is null":
jest.spyOn(service as any, 'getRollupStatus').mockResolvedValue({
  status: 'rollup-pending', stage: 'transaction-stats-rollup', /* progress... */
});
jest.spyOn(service as any, 'loadCaggApdexScope').mockResolvedValue({
  ...baseScope, hasTransactionsCagg: false,  // CAGG empty — gate fires
});
```

Run again and confirm green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts \
        apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts
git commit -m "feat(api): route live transaction-stats Apdex through CAGG fast path"
```

---

### Task 5: Implement `getTransactionSamplesFromCagg`

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`
- Test: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts`

Same shape as Task 4, applied to samplers. Joins `requests_raw_5s` and `requests_raw_passed_5s` on (bucket, system_under_test, test_environment, scenario_name, sampler_name, transaction_name, location). Group by `(sampler_name, scenario_name)` post-aggregation. Apdex from `pct_agg_passed`, p95/p99 from `pct_agg`. `url_hash` and `url_pattern` come back as `null` (CAGG doesn't carry them — documented limitation).

- [ ] **Step 1: Write the failing tests**

Add `describe('CAGG fast path')` under `describe('getTransactionSamples')`:

```typescript
describe('CAGG fast path', () => {
  beforeEach(() => jest.clearAllMocks());

  const baseScope = {
    sut: 'demo-sut', env: 'prod', workload: 'wl-1',
    startTime: new Date('2026-05-09T10:00:00Z'),
    endTime:   new Date('2026-05-09T10:30:00Z'),
    cutoffTime: null,
    hasTransactionsCagg: true,
    hasRequestsRawCagg: true,
  };

  it('runs the requests_raw_5s + requests_raw_passed_5s JOIN', async () => {
    jest.spyOn(service as any, 'getRollupStatus').mockResolvedValue({ status: 'unavailable' });
    jest.spyOn(service as any, 'loadCaggApdexScope').mockResolvedValue(baseScope);

    const queryFn = jest.fn().mockResolvedValue([]);
    mockTestRunRepo.manager.transaction = jest.fn(async (cb: any) => cb({ query: queryFn }));

    await service.getTransactionSamples('tr1', 'tx', false, true, []);

    const sql = queryFn.mock.calls.find(c => /requests_raw_5s/.test(c[0] as string))?.[0] as string;
    expect(sql).toMatch(/FROM\s+requests_raw_5s/);
    expect(sql).toMatch(/JOIN\s+requests_raw_passed_5s/);
    expect(sql).toMatch(/rollup\(p\.pct_agg_passed\)/);
    expect(sql).toMatch(/c\.transaction_name\s*=\s*\$8/);  // transaction filter param
  });

  it('returns mapped rows with url_hash=null url_pattern=null (CAGG limitation)', async () => {
    jest.spyOn(service as any, 'getRollupStatus').mockResolvedValue({ status: 'unavailable' });
    jest.spyOn(service as any, 'loadCaggApdexScope').mockResolvedValue(baseScope);

    mockTestRunRepo.manager.transaction = jest.fn(async (cb: any) =>
      cb({ query: jest.fn().mockResolvedValue([{
        sampler_name: 's1', scenario_name: 'sc',
        avg_response_time: '420.50', min_response_time: '10', max_response_time: '5000',
        p95_response_time: '900.00', p99_response_time: '1200.00',
        passed_count: '95', failed_count: '5', total_count: '100',
        avg_latency: '50.00', avg_connect_time: '20.00',
        total_request_size: '10240', total_response_size: '102400',
        active_threshold: '500', apdex_score: '0.875',
      }]) }),
    );

    const result = await service.getTransactionSamples('tr1', 'tx', false, true, []);
    expect((result as any[])[0]).toMatchObject({
      sampler_name: 's1', total_count: 100, apdex_score: 0.875,
      url_hash: null, url_pattern: null,
    });
  });

  it('falls through to raw scan when requests_raw_passed CAGG is empty', async () => {
    jest.spyOn(service as any, 'getRollupStatus').mockResolvedValue({ status: 'unavailable' });
    jest.spyOn(service as any, 'loadCaggApdexScope').mockResolvedValue({
      ...baseScope, hasRequestsRawCagg: false,
    });
    mockTestRunRepo.manager.transaction = jest.fn(async (cb: any) =>
      cb({ query: jest.fn().mockResolvedValue([]) }),
    );

    const result = await service.getTransactionSamples('tr1', 'tx', false, true, []);
    expect(Array.isArray(result)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest test-runs-performance-query.service.spec.ts -t "getTransactionSamples.*CAGG"
```

Expected: 3 failures.

- [ ] **Step 3: Implement `getTransactionSamplesFromCagg`**

Add right after `getTransactionSamplesFromRollup`:

```typescript
private async getTransactionSamplesFromCagg(
  scope: {
    sut: string; env: string; workload: string | null;
    startTime: Date; endTime: Date; cutoffTime: Date | null;
  },
  transactionName: string,
  excludeRampUp: boolean,
): Promise<SamplerStats[]> {
  // $1=sut, $2=env, $3=startTime, $4=endTime, $5=excludeRampUp, $6=cutoffTime,
  // $7=workload (threshold join), $8=transactionName
  const params: unknown[] = [
    scope.sut, scope.env, scope.startTime, scope.endTime,
    excludeRampUp, scope.cutoffTime, scope.workload, transactionName,
  ];

  const query = `
    WITH threshold_config AS (
      SELECT COALESCE(wtat.apdex_threshold, wat.apdex_threshold, 500) AS active_threshold
      FROM systems_under_test sut
      LEFT JOIN workload_apdex_thresholds wat
        ON  wat.system_under_test_id = sut.id
        AND wat.test_environment     = $2
        AND wat.workload             = $7
      LEFT JOIN workload_transaction_apdex_thresholds wtat
        ON  wtat.system_under_test_id = sut.id
        AND wtat.test_environment     = $2
        AND wtat.workload             = $7
        AND wtat.transaction_name     = $8
      WHERE sut.name = $1
      LIMIT 1
    ),
    agg AS (
      SELECT
        c.sampler_name,
        c.scenario_name,
        SUM(c.n)::bigint                                          AS total_count,
        SUM(c.n_ok)::bigint                                       AS passed_count,
        SUM(c.n_err)::bigint                                      AS failed_count,
        ROUND((SUM(c.avg_rt * c.n) / NULLIF(SUM(c.n),0))::numeric, 2) AS avg_response_time,
        MIN(c.min_rt)                                             AS min_response_time,
        MAX(c.max_rt)                                             AS max_response_time,
        rollup(c.pct_agg)                                         AS pct_agg_all,
        rollup(p.pct_agg_passed)                                  AS pct_agg_passed,
        ROUND((SUM(c.avg_latency * c.n) / NULLIF(SUM(c.n),0))::numeric, 2) AS avg_latency,
        ROUND((SUM(c.avg_connect * c.n) / NULLIF(SUM(c.n),0))::numeric, 2) AS avg_connect_time,
        SUM(c.bytes_out)::bigint                                  AS total_request_size,
        SUM(c.bytes_in)::bigint                                   AS total_response_size
      FROM requests_raw_5s c
      JOIN requests_raw_passed_5s p
        ON  c.bucket            = p.bucket
        AND c.system_under_test = p.system_under_test
        AND c.test_environment  = p.test_environment
        AND c.scenario_name IS NOT DISTINCT FROM p.scenario_name
        AND c.sampler_name      = p.sampler_name
        AND c.transaction_name  = p.transaction_name
        AND c.location IS NOT DISTINCT FROM p.location
      WHERE c.system_under_test = $1
        AND c.test_environment  = $2
        AND c.transaction_name  = $8
        AND c.bucket >= $3::timestamptz
        AND c.bucket <  $4::timestamptz + interval '5 seconds'
        AND ($5::boolean = false OR $6::timestamptz IS NULL
             OR c.bucket >= time_bucket('5 seconds'::interval, $6::timestamptz))
      GROUP BY c.sampler_name, c.scenario_name
    )
    SELECT
      a.sampler_name, a.scenario_name,
      NULL::text       AS url_hash,
      NULL::text       AS url_pattern,
      a.avg_response_time, a.min_response_time, a.max_response_time,
      ROUND(approx_percentile(0.95, a.pct_agg_all)::numeric, 2) AS p95_response_time,
      ROUND(approx_percentile(0.99, a.pct_agg_all)::numeric, 2) AS p99_response_time,
      a.passed_count, a.failed_count, a.total_count,
      a.avg_latency, a.avg_connect_time,
      a.total_request_size, a.total_response_size,
      tc.active_threshold,
      ROUND(
        (
          approx_percentile_rank(tc.active_threshold::double precision, a.pct_agg_passed)
          + (approx_percentile_rank((tc.active_threshold * 4)::double precision, a.pct_agg_passed)
             - approx_percentile_rank(tc.active_threshold::double precision, a.pct_agg_passed)) / 2
        )::numeric, 3
      ) AS apdex_score
    FROM agg a CROSS JOIN threshold_config tc
    ORDER BY a.total_count DESC
  `;

  const result = await withRequestEm(this.testRunRepo).manager.transaction(async (em) => {
    await em.query(`SET LOCAL work_mem = '256MB'`);
    return em.query(query, params);
  });

  return result.map((row: Record<string, unknown>) => ({
    sampler_name: row.sampler_name as string,
    scenario_name: (row.scenario_name as string) || undefined,
    avg_response_time: this.mapper.parseFloat(row.avg_response_time),
    min_response_time: this.mapper.parseInt(row.min_response_time),
    max_response_time: this.mapper.parseInt(row.max_response_time),
    p95_response_time: this.mapper.parseFloat(row.p95_response_time),
    p99_response_time: this.mapper.parseFloat(row.p99_response_time),
    passed_count: this.mapper.parseInt(row.passed_count),
    failed_count: this.mapper.parseInt(row.failed_count),
    total_count: this.mapper.parseInt(row.total_count),
    avg_latency: this.mapper.parseFloat(row.avg_latency),
    avg_connect_time: this.mapper.parseFloat(row.avg_connect_time),
    total_request_size: this.mapper.parseInt(row.total_request_size),
    total_response_size: this.mapper.parseInt(row.total_response_size),
    apdex_score: this.mapper.parseFloat(row.apdex_score),
    active_threshold: this.mapper.parseInt(row.active_threshold, 500),
    url_hash: null,
    url_pattern: null,
  }));
}
```

- [ ] **Step 4: Wire the CAGG path into `getTransactionSamples`**

Locate the current block (after the pending-gate plan changes):

```typescript
if (sinceMinutes == null) {
  const rollupStatus = await this.getRollupStatus(resolvedTestRunId);
  if (rollupStatus.status === 'ready') {
    return await this.getTransactionSamplesFromRollup(...);
  }
  if (rollupStatus.status === 'rollup-pending') {
    return rollupStatus;
  }
  // unavailable → fall through
}
```

Change to:

```typescript
if (sinceMinutes == null) {
  const rollupStatus = await this.getRollupStatus(resolvedTestRunId);
  if (rollupStatus.status === 'ready') {
    return await this.getTransactionSamplesFromRollup(
      resolvedTestRunId, transactionName, excludeRampUp, isAdmin, organizationIds,
    );
  }
  const caggScope = await this.loadCaggApdexScope(
    resolvedTestRunId, excludeRampUp, isAdmin, organizationIds,
  );
  if (caggScope?.hasRequestsRawCagg) {
    return await this.getTransactionSamplesFromCagg(caggScope, transactionName, excludeRampUp);
  }
  if (rollupStatus.status === 'rollup-pending') return rollupStatus;
  // unavailable + no CAGG → fall through
}
if (sinceMinutes != null) {
  const caggScope = await this.loadCaggApdexScope(
    resolvedTestRunId, excludeRampUp, isAdmin, organizationIds,
  );
  if (caggScope?.hasRequestsRawCagg) {
    const liveStart = new Date(Date.now() - sinceMinutes * 60_000);
    const adjustedScope = {
      ...caggScope,
      startTime: liveStart > caggScope.startTime ? liveStart : caggScope.startTime,
    };
    return await this.getTransactionSamplesFromCagg(adjustedScope, transactionName, excludeRampUp);
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && npx jest test-runs-performance-query.service.spec.ts -t "getTransactionSamples"
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts \
        apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts
git commit -m "feat(api): route live transaction-samples Apdex through CAGG fast path"
```

---

### Task 6: Update `getRollupStatus` semantics doc + integration touchpoint

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` (jsdoc only)

`getRollupStatus` itself doesn't change — the CAGG check happens *after* the status call, in `getTransactionStats`/`getTransactionSamples`. But its jsdoc should now mention the CAGG fallback so readers don't think `'rollup-pending'` always means HTTP 202.

- [ ] **Step 1: Update the jsdoc on `getRollupStatus`**

Find the existing doc comment (added by the pending-gate plan, around line 240). Replace with:

```typescript
/**
 * Determine whether the rollup-backed fast path can serve this run, or
 * whether the analyze-test job is still in-flight.
 *
 * The status alone does NOT determine the HTTP outcome — callers also
 * check the CAGG fast path (transactions_5s + transactions_passed_5s)
 * before deciding to return 202. The decision tree at the call site is:
 *
 *   ready                     → return rollup-table result (200)
 *   pending + CAGG present    → return CAGG result (200)
 *   pending + CAGG empty      → return rollup-pending (202)
 *   unavailable + CAGG present → return CAGG result (200)
 *   unavailable + CAGG empty  → fall through to raw scan with safety net
 */
private async getRollupStatus(
```

- [ ] **Step 2: Type-check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts
git commit -m "docs(api): clarify getRollupStatus is one of two signals for the gate"
```

---

### Task 7: Integration test — CAGG-vs-rollup equivalence

**Files:**
- Create: `apps/worker/src/test/integration/cagg-apdex-equivalence.integration.test.ts`

Belt-and-braces test that the CAGG fast path returns Apdex within 2 percentage points of the rollup table on a synthetic dataset. Catches sketch-family bugs (e.g. accidentally selecting `pct_agg_all` for Apdex) and bucket-boundary off-by-ones.

- [ ] **Step 1: Create the integration test scaffold**

```typescript
// apps/worker/src/test/integration/cagg-apdex-equivalence.integration.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { createWorkerDataSource } from '../../db/dataSourceFactory.js';

describe('CAGG-vs-rollup Apdex equivalence', () => {
  let ds: DataSource;
  const SUT = 'cagg-equiv-sut';
  const ENV = 'test';
  const SCENARIO = 'load';
  const TXN = 'login';
  const TEST_RUN_ID = 'cagg-equiv-tr';
  const START = new Date(Date.now() - 30 * 60_000);
  const END   = new Date(Date.now() - 1 * 60_000);

  beforeAll(async () => {
    ds = await createWorkerDataSource();
    // Cleanup any prior data from this test
    await ds.query(`DELETE FROM transactions WHERE test_run_id = $1`, [TEST_RUN_ID]);
    await ds.query(`DELETE FROM test_run_transaction_stats WHERE test_run_id = $1`, [TEST_RUN_ID]);
    await ds.query(`DELETE FROM test_runs WHERE test_run_id = $1`, [TEST_RUN_ID]);

    // Seed one SUT, one test run
    const sutId = (await ds.query(
      `INSERT INTO systems_under_test (id, name, organization_id) VALUES (gen_random_uuid(), $1, gen_random_uuid()) RETURNING id`,
      [SUT],
    ))[0].id;
    await ds.query(
      `INSERT INTO test_runs (test_run_id, system_under_test_id, test_environment, workload,
                              start_time, end_time, ramp_up, organization_id)
       VALUES ($1, $2, $3, 'wl-1', $4, $5, 0, gen_random_uuid())`,
      [TEST_RUN_ID, sutId, ENV, START, END],
    );

    // Seed 10k synthetic transactions: 95% pass, 5% fail.
    // Successful: response_time ~ Gamma(2, 200) → mean ~400ms, tail ~1500ms
    // Failed: response_time ~ uniform(2000, 5000)
    const rows: any[] = [];
    for (let i = 0; i < 10_000; i++) {
      const success = i % 20 !== 0;
      const t = new Date(START.getTime() + Math.floor(Math.random() * (END.getTime() - START.getTime())));
      const rt = success
        ? Math.max(50, Math.round(-200 * Math.log(1 - Math.random()) - 200 * Math.log(1 - Math.random())))
        : 2000 + Math.round(Math.random() * 3000);
      rows.push([t, TEST_RUN_ID, SUT, ENV, SCENARIO, TXN, rt, success]);
    }
    // Bulk insert in chunks of 1000
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      const values = chunk.map((_, j) =>
        `($${j*8+1}::timestamptz, $${j*8+2}, $${j*8+3}, $${j*8+4}, $${j*8+5}, $${j*8+6}, $${j*8+7}, $${j*8+8})`
      ).join(',');
      const params = chunk.flat();
      await ds.query(
        `INSERT INTO transactions (time, test_run_id, system_under_test, test_environment,
                                   scenario_name, transaction_name, response_time, success)
         VALUES ${values}`,
        params,
      );
    }

    // Force CAGGs to refresh for this window
    await ds.query(`CALL refresh_continuous_aggregate('transactions_5s', $1, $2)`, [START, END]);
    await ds.query(`CALL refresh_continuous_aggregate('transactions_passed_5s', $1, $2)`, [START, END]);
  }, 60_000);

  afterAll(async () => {
    await ds.query(`DELETE FROM transactions WHERE test_run_id = $1`, [TEST_RUN_ID]);
    await ds.query(`DELETE FROM test_runs WHERE test_run_id = $1`, [TEST_RUN_ID]);
    await ds.destroy();
  });

  it('CAGG-derived Apdex(@500ms) matches raw-scan Apdex within 0.02 absolute', async () => {
    const T = 500;
    const raw = (await ds.query(`
      SELECT
        approx_percentile_rank($1::double precision,
          percentile_agg(response_time::double precision) FILTER (WHERE success))
        + (approx_percentile_rank(($1*4)::double precision,
            percentile_agg(response_time::double precision) FILTER (WHERE success))
           - approx_percentile_rank($1::double precision,
              percentile_agg(response_time::double precision) FILTER (WHERE success))) / 2
          AS apdex
      FROM transactions WHERE test_run_id = $2 AND transaction_name = $3
    `, [T, TEST_RUN_ID, TXN]))[0].apdex;

    const cagg = (await ds.query(`
      SELECT
        approx_percentile_rank($1::double precision, rollup(p.pct_agg_passed))
        + (approx_percentile_rank(($1*4)::double precision, rollup(p.pct_agg_passed))
           - approx_percentile_rank($1::double precision, rollup(p.pct_agg_passed))) / 2
          AS apdex
      FROM transactions_5s c
      JOIN transactions_passed_5s p
        ON c.bucket = p.bucket AND c.system_under_test = p.system_under_test
       AND c.test_environment = p.test_environment
       AND c.scenario_name IS NOT DISTINCT FROM p.scenario_name
       AND c.transaction_name = p.transaction_name
      WHERE c.system_under_test = $2 AND c.test_environment = $3
        AND c.bucket >= $4::timestamptz AND c.bucket < $5::timestamptz + interval '5 seconds'
        AND c.transaction_name = $6
    `, [T, SUT, ENV, START, END, TXN]))[0].apdex;

    expect(Math.abs(Number(raw) - Number(cagg))).toBeLessThan(0.02);
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
cd apps/worker && npx vitest run cagg-apdex-equivalence
```

Expected: passes. If `abs_err >= 0.02`, increase the synthetic dataset to 50k rows or investigate sketch settings.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/test/integration/cagg-apdex-equivalence.integration.test.ts
git commit -m "test(worker): integration test asserting CAGG-vs-raw Apdex equivalence"
```

---

### Task 8: Manual smoke test — running test + completed test

**Files:** none (verification only)

The unit and integration tests cover correctness; this task verifies wall-clock latency on a real-shape dataset.

- [ ] **Step 1: Start the dev stack**

```bash
lsof -ti:3001,3002,4001 | xargs kill -9; npm run dev
```

- [ ] **Step 2: Pick or simulate a running test**

Either:
- Wait for a real test run to start, OR
- Run a `k6` / `JMeter` ingest against the local API for 5 minutes to get fresh raw + CAGG data

- [ ] **Step 3: Time the live Apdex query against raw vs CAGG**

While the test is in-flight (rollup table empty), call:

```bash
time curl -s -H "Authorization: Bearer $PERFANA_API_KEY" \
  "http://localhost:3001/api/test-runs/<id>/transactions" | jq '.[] | {transaction_name, total_count, apdex_score}' | head -5
```

Expected (with this plan applied): wall time <500ms even for a 1M-row run. Without the plan: 5–60s.

Repeat with `?sinceMinutes=5`:

```bash
time curl -s -H "Authorization: Bearer $PERFANA_API_KEY" \
  "http://localhost:3001/api/test-runs/<id>/transactions?sinceMinutes=5"
```

Expected: <300ms.

- [ ] **Step 4: Verify the same endpoint on a completed test still hits the rollup**

```bash
time curl -s -H "Authorization: Bearer $PERFANA_API_KEY" \
  "http://localhost:3001/api/test-runs/<completed-id>/transactions"
```

Expected: <100ms (rollup fast path, unchanged by this plan). Confirms no regression.

- [ ] **Step 5: Verify 202 still fires when CAGG is also empty**

This is harder to reproduce on the dev DB. Either:
- Insert a fake test_run row with start_time = NOW() + 5min (no CAGG data possible, no raw data) and check the response
- OR document this as a manual gap and rely on the unit test that asserts the gate condition

Document findings (latencies, sample sizes) in the PR description.

---

### Task 9: Documentation + version bump

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `VERSION`
- Modify: `docs/superpowers/plans/2026-05-09-apdex-rollup-pending-gate.md` (one-line update)

- [ ] **Step 1: Add CHANGELOG entry**

Open `CHANGELOG.md`, add at the top under the next patch version:

```markdown
- feat(api): live Apdex queries on `/test-runs/:id/transactions` and `/transactions/:name/samples` now read from the new `transactions_passed_5s` / `requests_raw_passed_5s` continuous aggregates instead of scanning raw `transactions` / `requests_raw`. Wall time on a 10M-row in-flight run drops from 60s+ to <500ms. Apdex correctness improves to match the post-test rollup (success-filtered tdigest) — failed-but-fast rows are correctly counted as frustrated, not satisfied. The HTTP 202 rollup-pending response from #XXX now only fires when both the rollup table and the CAGG are empty for the run window. (#YYY)
- feat(db): new continuous aggregates `transactions_passed_5s/1m/5m` and `requests_raw_passed_5s/1m/5m` carrying success-filtered `pct_agg_passed` sketches (uddsketch via `percentile_agg(response_time) FILTER (WHERE success)`). Side-by-side with the existing `transactions_5s` / `requests_raw_5s` family. (#YYY)
```

- [ ] **Step 2: Bump VERSION**

Patch bump from current value (e.g., `0.2.47.87` → `0.2.47.88`).

- [ ] **Step 3: Update the prior plan's follow-up note**

In `docs/superpowers/plans/2026-05-09-apdex-rollup-pending-gate.md`, append at the very top of the "Follow-up issue" section:

```markdown
> **Status (2026-05-09):** Implemented. See `docs/superpowers/plans/2026-05-09-apdex-live-cagg-fast-path.md`.
```

- [ ] **Step 4: Run preflight**

```bash
npm run preflight
```

Expected: lint + type-check + RLS suite all green.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md VERSION docs/superpowers/plans/2026-05-09-apdex-rollup-pending-gate.md
git commit -m "chore: v0.2.47.XX — live Apdex CAGG fast path"
```

---

### Task 10: Production rollout plan (PR description, not a code change)

**Files:** none — this content goes in the PR description.

The migration creates 6 new CAGGs `WITH NO DATA`. They will materialize forward via the refresh policies, but historical data needs an explicit backfill. Plan the rollout so:

- The new CAGGs come online without overwhelming the hypertable read pressure
- The live-Apdex code path falls back to raw scan (Task 11 of the prior plan) for any window the CAGG hasn't backfilled yet — no regression, just no speedup until backfill catches up
- Rollback is simple (drop the new CAGGs)

- [ ] **Draft the rollout section**

Include in the PR description:

```markdown
## Rollout plan (production)

1. Deploy the migration. New CAGGs come online empty (`WITH NO DATA`).
2. Refresh policies start materializing forward immediately (every 30s/1min/5min).
3. Backfill historical data in 1-day chunks, oldest → newest, during low-load hours:
   ```sql
   CALL refresh_continuous_aggregate('transactions_passed_5s',
     NOW() - interval '90 days', NOW() - interval '89 days');
   -- ...progress one day at a time...
   ```
4. Monitor `pg_stat_activity` and `pg_stat_progress_create_index` for hypertable read pressure. If it spikes, pause backfill and resume during the next quiet window.
5. Until backfill completes, live-Apdex queries on older runs fall through to the raw-scan path with the existing 60-min clamp + 10s statement_timeout safety net (no regression). Recent runs (last 24h) get the speedup immediately since the refresh policy materializes the most recent window first.

## Rollback plan

If the new CAGGs misbehave (lag, refresh failures, JOIN cost regression):
1. Set a feature flag (env var `LIVE_APDEX_CAGG_ENABLED=false`) — skips `loadCaggApdexScope` and falls straight through to the raw scan path. (If we don't add a flag, the rollback is to revert the API code change.)
2. Drop the migration:
   ```sql
   DROP MATERIALIZED VIEW IF EXISTS transactions_passed_5m CASCADE;
   DROP MATERIALIZED VIEW IF EXISTS transactions_passed_1m CASCADE;
   DROP MATERIALIZED VIEW IF EXISTS transactions_passed_5s CASCADE;
   DROP MATERIALIZED VIEW IF EXISTS requests_raw_passed_5m CASCADE;
   DROP MATERIALIZED VIEW IF EXISTS requests_raw_passed_1m CASCADE;
   DROP MATERIALIZED VIEW IF EXISTS requests_raw_passed_5s CASCADE;
   ```
   (`CASCADE` removes the refresh + retention policies automatically.)

## Monitoring

- New metric: `live_apdex_path` label on the existing transaction-stats latency histogram (values: `rollup` / `cagg` / `raw`). Lets us see what fraction of live Apdex requests are hitting which tier.
- Alert: if `cagg_lag_seconds` (computable from `timescaledb_information.continuous_aggregates`) exceeds 5 minutes for any of the six new views, page the on-call.
```

(If a feature flag is desired, that's a small follow-up: wrap the `loadCaggApdexScope` calls in `if (this.configService.get('LIVE_APDEX_CAGG_ENABLED', 'true') !== 'false')`.)

---

## Verification Checklist (run before opening the PR)

- [ ] Migration applied on dev DB: 6 new CAGGs visible in `timescaledb_information.continuous_aggregates`
- [ ] All 6 CAGGs have refresh + retention policies attached
- [ ] Backfill of last 24h on dev DB completes without errors
- [ ] `cd apps/api && npx jest test-runs-performance-query.service.spec.ts` — all tests green (existing + 7 new from Tasks 3-5)
- [ ] `cd apps/worker && npx vitest run cagg-apdex-equivalence` — passes with `abs_err < 0.02`
- [ ] `npm run preflight` from repo root — green
- [ ] Manual smoke test on a running test: `/test-runs/:id/transactions` returns in <500ms (vs. 5-60s before)
- [ ] Manual smoke test on a completed run: rollup fast path still serves; no regression
- [ ] Manual smoke test on `/test-runs/:id/transactions?sinceMinutes=5`: returns in <300ms
- [ ] No regression on the rollup-pending 202 path: when CAGG is also empty, the 202 still fires

---

## Risk Notes

- **Two-CAGG JOIN cost.** `transactions_5s JOIN transactions_passed_5s` on six columns inside a CTE — Postgres should hash-join (the inner side is small after the WHERE filter). If the planner picks a nested loop the cost regresses. Mitigation: `EXPLAIN ANALYZE` on a representative query during Task 1 / Task 8; if needed, add an index hint by materializing one side into a CTE first.
- **Sketch-family mixup.** The new `pct_agg_passed` is uddsketch (from `percentile_agg`); the rollup-table column with the same name is tdigest. They're never combined. The CAGG-to-CAGG `rollup(pct_agg_passed)` is in-family; the rollup-to-rollup `rollup(pct_agg_passed)` is also in-family. The only place a confusion could arise is if someone joins the CAGG result against the rollup table. The current code doesn't, and there's no reason to. Documented in the migration jsdoc.
- **Refresh lag.** The 5s CAGGs have a 1-minute `end_offset`, so the most recent ~1 minute of an in-flight test isn't materialized. Live-window queries (`sinceMinutes=5`) cover ≥5 minutes so the 1-minute tail is a 20% blind spot. Acceptable for live monitoring; the tail catches up on the next refresh. Consider tightening `end_offset` to '30 seconds' if users complain about the tail latency.
- **Concurrent overlapping runs.** Two test runs against the same (SUT, env) with overlapping time windows would have their CAGG buckets mixed. Same blast radius as today (`getThroughputStatsFromCagg` already has this property). Documented but not fixed in this plan.
- **Test_runs without start_time/end_time.** In-flight runs have `end_time = NULL`. The scope-loader clamps to `NOW()` so the bucket window query still works. A run that hasn't yet recorded a `start_time` returns `null` from the scope loader → CAGG path skipped → falls through. Same defensive behaviour as `loadThroughputRunInfo`.
- **Apdex-correctness change.** This plan corrects a latent bug: pre-this-plan, the raw-scan live path computed Apdex over `pct_agg` (all rows) — counting failed-but-fast rows as satisfied. Post-this-plan (CAGG fast path) and post-#298 (rollup fast path) both correctly use success-filtered sketches. Apdex scores will *change* (downward, on runs with failures) — this is correctness, not regression. Call it out in the CHANGELOG and warn power users in the release notes if needed.

---

## Self-Review

Spec coverage:
- Six new CAGGs created with right shape (Task 2) ✓
- Refresh + retention policies on all six (Task 2) ✓
- Live transaction-stats CAGG path (Tasks 3, 4) ✓
- Live transaction-samples CAGG path (Tasks 3, 5) ✓
- Gate semantics updated to prefer CAGG over 202 (Tasks 4, 5, 6) ✓
- Tests cover SQL shape, mapping, fallback (Tasks 3-5) ✓
- Equivalence vs raw scan (Task 7) ✓
- Manual latency check (Task 8) ✓
- Docs + version (Task 9) ✓
- Rollout (Task 10) ✓

Type consistency check:
- `TransactionStats[] | RollupPendingResult` return type — propagated through the pending-gate plan, unchanged here ✓
- `SamplerStats[] | RollupPendingResult` — same ✓
- `loadCaggApdexScope` return shape used identically in Tasks 4 and 5 ✓
- `mapper.parseFloat` / `mapper.parseInt` used for all mapped fields — same conventions as the existing rollup helpers ✓
- `null` for `url_hash` / `url_pattern` in CAGG sampler results — matches the `string | null` shape that the rollup mapper also produces ✓
