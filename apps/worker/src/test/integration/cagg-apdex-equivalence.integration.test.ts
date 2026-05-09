/**
 * CAGG-vs-rollup Apdex Equivalence Integration Test
 *
 * Proves that Apdex computed from the new `transactions_passed_5s` CAGG
 * (success-filtered `pct_agg_passed`) matches Apdex computed from the raw
 * `transactions` hypertable within ±0.02 absolute on a synthetic dataset.
 *
 * Catches:
 *  - sketch-family bugs (uddsketch drift across rollup boundaries),
 *  - bucket-boundary off-by-ones in the CAGG join,
 *  - any future drift in the CAGG schema added by migration
 *    1779100000000-AddPctAggPassedCaggs.
 *
 * Setup: 10k synthetic transactions (95% success / 5% failure) inside a
 * unique test_run, with a roughly gamma-shaped response_time distribution.
 * Refreshes the CAGGs over the test window before computing both sides.
 *
 * Skip conditions:
 *  - SKIP_CAGG_EQUIVALENCE_TEST=true (explicit opt-out)
 *  - migration 1779100000000 not applied (no transactions_passed_5s view)
 *
 * Note on DB access pattern:
 * Uses a `pg.Pool` directly with the standard DB_* env-var configuration —
 * matching the established convention in
 * `statistics-pipeline.integration.test.ts`. The Live Apdex CAGG plan's
 * Task-7 example referenced a `createWorkerDataSource` factory that does
 * not exist in this repo; the actual pattern is raw `pg.Pool` for
 * integration tests.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { getTestPoolConfig } from '../helpers/database.js';

const APDEX_THRESHOLD_MS = 500;
const APDEX_TOLERANCE = 0.02;
const TRANSACTION_COUNT = 10_000;
const FAILURE_RATE = 0.05;

describe('CAGG Apdex equivalence (raw vs transactions_passed_5s)', () => {
  let pool: Pool;
  let skipReason: string | null = null;

  // Unique identifiers per test run (avoid collisions across CI runs)
  const runId = Date.now();
  const testRunId = `cagg-equiv-tr-${runId}`;
  const sutName = `cagg-equiv-sut-${runId}`;
  const testEnvironment = `cagg-equiv-env-${runId}`;
  const scenarioName = 'apdex-equiv-scenario';
  const transactionName = 'apdex-equiv-txn';

  // Window: start 30 minutes ago, end 1 minute ago, ramp_up 0
  const endTime = new Date(Date.now() - 60 * 1000);
  const startTime = new Date(endTime.getTime() - 30 * 60 * 1000);

  let sutId: string | null = null;

  beforeAll(async () => {
    if (process.env.SKIP_CAGG_EQUIVALENCE_TEST === 'true') {
      skipReason = 'SKIP_CAGG_EQUIVALENCE_TEST=true';
      console.log(`[cagg-apdex-equivalence] Skipping: ${skipReason}`);
      return;
    }

    pool = new Pool(getTestPoolConfig(5));

    // Verify connectivity before doing anything else
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message : 'Unknown error';
      skipReason = `Cannot connect to test DB: ${msg}`;
      console.log(`[cagg-apdex-equivalence] Skipping: ${skipReason}`);
      return;
    }

    // Verify migration 1779100000000 is applied
    const exists = await pool.query(`
      SELECT 1 FROM timescaledb_information.continuous_aggregates
      WHERE view_name = 'transactions_passed_5s' LIMIT 1
    `);
    if (exists.rows.length === 0) {
      skipReason = 'transactions_passed_5s CAGG not present (migration 1779100000000 not applied?)';
      console.log(`[cagg-apdex-equivalence] Skipping: ${skipReason}`);
      return;
    }

    // --- Insert SUT ----------------------------------------------------------
    const sutResult = await pool.query(
      `
      INSERT INTO systems_under_test (id, name, description, organization_id)
      VALUES (uuid_generate_v4(), $1, $2, gen_random_uuid())
      RETURNING id
      `,
      [sutName, `Synthetic SUT for CAGG Apdex equivalence test ${runId}`],
    );
    sutId = sutResult.rows[0].id;

    // --- Insert test_run -----------------------------------------------------
    await pool.query(
      `
      INSERT INTO test_runs (
        system_under_test_id, test_environment, workload, test_run_id,
        start_time, end_time, ramp_up,
        organization_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, 0, gen_random_uuid())
      `,
      [
        sutId,
        testEnvironment,
        'load-test',
        testRunId,
        startTime,
        endTime,
      ],
    );

    // --- Generate synthetic transactions ------------------------------------
    const windowMs = endTime.getTime() - startTime.getTime();
    const rows: Array<{
      time: Date;
      success: boolean;
      response_time: number;
    }> = [];

    for (let i = 0; i < TRANSACTION_COUNT; i++) {
      const isFailure = Math.random() < FAILURE_RATE;
      const t = new Date(startTime.getTime() + Math.floor(Math.random() * windowMs));

      let rt: number;
      if (isFailure) {
        // Failed: 2000–5000ms
        rt = 2000 + Math.floor(Math.random() * 3000);
      } else {
        // Successful: gamma-ish (sum of two exponentials), mean ~400ms,
        // floored at 50ms to keep below the apdex threshold for the bulk.
        const e1 = -200 * Math.log(1 - Math.random());
        const e2 = -200 * Math.log(1 - Math.random());
        rt = Math.max(50, Math.round(e1 + e2));
      }

      rows.push({ time: t, success: !isFailure, response_time: rt });
    }

    // Bulk insert in chunks of 1000 using parameterised VALUES
    const CHUNK = 1000;
    for (let off = 0; off < rows.length; off += CHUNK) {
      const slice = rows.slice(off, off + CHUNK);
      const valueClauses = slice
        .map(
          (_, idx) =>
            `($${idx * 8 + 1}, $${idx * 8 + 2}, $${idx * 8 + 3}, $${idx * 8 + 4}, $${idx * 8 + 5}, $${idx * 8 + 6}, $${idx * 8 + 7}, $${idx * 8 + 8})`,
        )
        .join(', ');
      const params = slice.flatMap((r) => [
        r.time,
        testRunId,
        sutName,
        testEnvironment,
        scenarioName,
        transactionName,
        r.success,
        r.response_time,
      ]);

      await pool.query(
        `
        INSERT INTO transactions (
          time, test_run_id, system_under_test, test_environment,
          scenario_name, transaction_name, success, response_time
        )
        VALUES ${valueClauses}
        `,
        params,
      );
    }

    // --- Refresh CAGGs over the test window ---------------------------------
    // transactions_5s must be refreshed before the rollup-tier views, but
    // for this test we only join transactions_5s ↔ transactions_passed_5s,
    // so refreshing those two is sufficient.
    await pool.query(
      `CALL refresh_continuous_aggregate('transactions_5s', $1::timestamptz, $2::timestamptz)`,
      [startTime, endTime],
    );
    await pool.query(
      `CALL refresh_continuous_aggregate('transactions_passed_5s', $1::timestamptz, $2::timestamptz)`,
      [startTime, endTime],
    );
  }, 120_000);

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query('DELETE FROM transactions WHERE test_run_id = $1', [testRunId]);
      await pool.query('DELETE FROM test_runs WHERE test_run_id = $1', [testRunId]);
      if (sutId) {
        await pool.query('DELETE FROM systems_under_test WHERE id = $1', [sutId]);
      }
    } catch (err) {
      // Best-effort cleanup; surface but don't fail the suite
      const msg = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message : 'Unknown error';
      console.warn(`[cagg-apdex-equivalence] Cleanup warning: ${msg}`);
    } finally {
      await pool.end();
    }
  });

  test('CAGG-derived Apdex(@500ms) matches raw-derived Apdex within 0.02', async () => {
    if (skipReason) {
      console.log(`[cagg-apdex-equivalence] Skipping test: ${skipReason}`);
      return;
    }

    // --- Raw-side Apdex (success-filtered uddsketch over raw rows) ----------
    const rawResult = await pool.query(
      `
      SELECT
        approx_percentile_rank($1::double precision,
          percentile_agg(response_time::double precision) FILTER (WHERE success))
        + (approx_percentile_rank(($1 * 4)::double precision,
            percentile_agg(response_time::double precision) FILTER (WHERE success))
           - approx_percentile_rank($1::double precision,
            percentile_agg(response_time::double precision) FILTER (WHERE success))) / 2
          AS apdex
      FROM transactions
      WHERE test_run_id = $2
        AND transaction_name = $3
      `,
      [APDEX_THRESHOLD_MS, testRunId, transactionName],
    );

    // --- CAGG-side Apdex (rollup of pct_agg_passed) -------------------------
    const caggResult = await pool.query(
      `
      SELECT
        approx_percentile_rank($1::double precision, rollup(p.pct_agg_passed))
        + (approx_percentile_rank(($1 * 4)::double precision, rollup(p.pct_agg_passed))
           - approx_percentile_rank($1::double precision, rollup(p.pct_agg_passed))) / 2
          AS apdex
      FROM transactions_5s c
      JOIN transactions_passed_5s p
        ON c.bucket = p.bucket
       AND c.system_under_test = p.system_under_test
       AND c.test_environment = p.test_environment
       AND c.scenario_name IS NOT DISTINCT FROM p.scenario_name
       AND c.transaction_name = p.transaction_name
      WHERE c.system_under_test = $2
        AND c.test_environment = $3
        AND c.bucket >= $4::timestamptz
        AND c.bucket < $5::timestamptz + interval '5 seconds'
        AND c.transaction_name = $6
      `,
      [APDEX_THRESHOLD_MS, sutName, testEnvironment, startTime, endTime, transactionName],
    );

    const rawApdex = rawResult.rows[0]?.apdex;
    const caggApdex = caggResult.rows[0]?.apdex;

    expect(rawApdex).not.toBeNull();
    expect(caggApdex).not.toBeNull();
    expect(rawApdex).toBeDefined();
    expect(caggApdex).toBeDefined();

    const rawNum = Number(rawApdex);
    const caggNum = Number(caggApdex);

    expect(Number.isFinite(rawNum)).toBe(true);
    expect(Number.isFinite(caggNum)).toBe(true);

    const delta = Math.abs(rawNum - caggNum);
    console.log(
      `[cagg-apdex-equivalence] raw=${rawNum.toFixed(4)} cagg=${caggNum.toFixed(4)} delta=${delta.toFixed(4)}`,
    );

    expect(delta).toBeLessThan(APDEX_TOLERANCE);
  }, 60_000);
});
