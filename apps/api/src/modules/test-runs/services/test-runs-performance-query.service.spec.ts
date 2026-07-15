/**
 * Unit tests for TestRunsPerformanceQueryService
 *
 * Covers all public methods:
 * - getTransactionStats: transaction performance statistics with Apdex scoring
 * - getTransactionSamples: per-sampler statistics for a transaction
 * - getTransactionErrors: grouped error statistics
 * - getVirtualUserStats: VU concurrency statistics
 * - getThroughputStats: peak TPS/RPS statistics
 *
 * Key scenarios tested per method:
 * - Admin bypass (no org filter)
 * - Non-admin with org memberships
 * - Non-admin with NO org memberships → empty result
 * - UUID resolution vs. raw test_run_id
 * - excludeRampUp cutoff logic
 * - sinceMinutes window filter (where applicable)
 * - Data mapping / type parsing from raw SQL rows
 * - Error wrapping into DatabaseException
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRunsPerformanceQueryService, apdexScoreSql } from './test-runs-performance-query.service';
import { TestRunsMapperService } from './test-runs-mapper.service';
import { TestRun as TestRunEntity } from '../../../entities';
import { DatabaseException } from '../../../common/exceptions/business.exception';
import { JobProgressService } from '../../data-science/services/job-progress.service';
import { isRollupPending } from './test-runs-performance-query.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mock repository shape.
 *
 * The service uses two entry points into TypeORM:
 *  - `testRunRepo.query(...)` for top-level queries (UUID lookup, ramp-up lookup,
 *    VU stats, throughput stats, errors).
 *  - `testRunRepo.manager.transaction(cb)` for queries that need `SET LOCAL work_mem`
 *    (getTransactionStats, getTransactionSamples — the rewrites introduced for #139).
 *
 * Our mock routes the EntityManager passed to the transaction callback back through
 * the same `query` jest.fn so every existing `mockQuerySequence` / `mockWithUuidResolution`
 * helper keeps working untouched. The `SET LOCAL work_mem` prelude issues its own
 * `query` call — the helpers mirror that with an explicit `setLocalWorkMem` step so
 * callers don't have to remember it.
 */
type MockRepo = jest.Mocked<Pick<Repository<TestRunEntity>, 'query'>> & {
  manager: {
    transaction: jest.Mock;
  };
};

function createMockRepo(): MockRepo {
  const query = jest.fn();
  const transaction = jest.fn(async (cb: (em: { query: jest.Mock }) => Promise<unknown>) => {
    return cb({ query });
  });
  return {
    query,
    manager: { transaction },
  };
}

/** Raw DB row shapes used across tests */
const RAW_TRANSACTION_ROW = {
  transaction_name: 'checkout',
  scenario_name: 'load_test',
  total_count: '600',
  passed_count: '590',
  failed_count: '10',
  avg_response_time: '120.50',
  p95_response_time: '300.00',
  p99_response_time: '450.00',
  ranking: '72300.00',
  apdex_score: '0.950',
  active_threshold: '500',
};

const RAW_SAMPLER_ROW = {
  sampler_name: 'POST /checkout',
  scenario_name: 'load_test',
  avg_response_time: '115.25',
  min_response_time: '50',
  max_response_time: '900',
  p95_response_time: '295.00',
  p99_response_time: '440.00',
  passed_count: '580',
  failed_count: '10',
  total_count: '590',
  avg_latency: '10.00',
  avg_connect_time: '5.00',
  total_request_size: '102400',
  total_response_size: '204800',
  apdex_score: '0.940',
  active_threshold: '500',
  url_hash: 'abc123',
  url_pattern: '/checkout',
};

const RAW_ERROR_ROW = {
  error_type: 'HTTP 500',
  response_code: '500',
  response_message: 'Internal Server Error',
  sampler_name: 'POST /checkout',
  url: 'http://example.com/checkout',
  sample_url: 'http://example.com/checkout?session=1',
  url_hash: 'abc123',
  url_pattern: '/checkout',
  count: '10',
  first_occurrence: '2024-01-01T10:00:00Z',
  last_occurrence: '2024-01-01T11:00:00Z',
  sample_response_data: '{"error":"Internal Server Error"}',
  total_requests: '600',
  apdex_score: '0.85',
};

const RAW_VU_OVERALL = {
  peak_active_threads: '100',
  avg_active_threads: '75.50',
  peak_started_threads: '100',
  avg_started_threads: '80.00',
  peak_finished_threads: '99',
  avg_finished_threads: '74.00',
  total_data_points: '360',
};

const RAW_VU_SCENARIO = {
  scenario_name: 'checkout_flow',
  peak_active_threads: '50',
  avg_active_threads: '40.00',
  peak_started_threads: '50',
  avg_started_threads: '42.00',
  peak_finished_threads: '49',
  avg_finished_threads: '39.00',
  total_data_points: '180',
};

const RAW_TRANSACTIONS_TPS = { peak_transactions_per_second: '120' };
const RAW_REQUESTS_RPS = { peak_requests_per_second: '350' };
const RAW_SCENARIO_THROUGHPUT = {
  scenario_name: 'checkout_flow',
  peak_transactions_per_second: '60',
  peak_requests_per_second: '175',
};

// UUIDs used in tests
const UUID = 'e8f37dc1-9d9c-4e25-837d-14aa69ac4b17';
const TEST_RUN_ID = 'PerfanaWebshop-acc-loadTest-00012';
const ORG_IDS = ['org-uuid-1', 'org-uuid-2'];
// `isAdmin` boolean — the sub-service no longer reasons about role names; the
// facade resolves admin status before delegating. See Phase C27 in
// docs/superpowers/audits/2026-04-26-audit-decisions.md.
const IS_ADMIN = true;
const NOT_ADMIN = false;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TestRunsPerformanceQueryService', () => {
  let service: TestRunsPerformanceQueryService;
  let testRunRepo: MockRepo;
  let mapper: TestRunsMapperService;
  let mockJobProgressService: { getActiveJobForScope: jest.Mock };

  beforeEach(async () => {
    testRunRepo = createMockRepo();
    mockJobProgressService = {
      getActiveJobForScope: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsPerformanceQueryService,
        TestRunsMapperService,
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: testRunRepo,
        },
        {
          provide: JobProgressService,
          useValue: mockJobProgressService,
        },
      ],
    }).compile();

    service = module.get<TestRunsPerformanceQueryService>(TestRunsPerformanceQueryService);
    mapper = module.get<TestRunsMapperService>(TestRunsMapperService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Shared helper: UUID resolution
  // =========================================================================

  /**
   * The rewritten Apdex queries run inside a transaction and issue
   * `SET LOCAL` preludes (work_mem and statement_timeout) before the data
   * query. Those calls go through the same mocked `query` fn — so the mock
   * implementations below need to skip them when stepping through the
   * configured result sequence.
   */
  const isSetLocalWorkMem = (sql: unknown): boolean =>
    typeof sql === 'string' && /SET\s+LOCAL\s+(work_mem|statement_timeout)/i.test(sql);

  /**
   * The rollup fast-path (#150, #151) issues a `SELECT 1 FROM
   * test_run_transaction_stats … LIMIT 1` (and a sampler sibling) existence
   * check before deciding whether to read the rollup or fall back to live
   * aggregation. Existing tests that mock only the live-query result expect
   * the fall-through path — so treat the existence check as "no rollup" by
   * default. Tests that specifically exercise the rollup hit path opt in via
   * `mockWithRollupHit(...)`.
   */
  const isRollupExistenceCheck = (sql: unknown): boolean =>
    typeof sql === 'string' &&
    /SELECT\s+1\s+FROM\s+test_run_(transaction|sampler)_stats/i.test(sql);

  /**
   * The Apdex rollup-pending gate's `getRollupStatus()` helper issues a scope
   * lookup against `test_runs` (sut/env/workload) when the rollup existence
   * check returns empty. Live-aggregation fallback tests need this lookup to
   * appear as a no-op so it doesn't consume a configured result-sequence entry.
   * Returning `[]` makes `getRollupStatus()` resolve as `'unavailable'`, which
   * is exactly the soft-failure branch existing live-agg tests assume.
   */
  const isRollupScopeLookup = (sql: unknown): boolean =>
    typeof sql === 'string' &&
    /SELECT\s+tr\.system_under_test_id,\s*tr\.test_environment,\s*tr\.workload\s+FROM\s+test_runs\s+tr/i.test(
      sql,
    );

  /**
   * The CAGG fast path (live-Apdex CAGG plan, Task 4/5) issues a scope-loader
   * query against `test_runs` joined with `systems_under_test` that probes
   * `transactions_passed_5s` / `requests_raw_passed_5s` via EXISTS. Live-agg
   * fallback tests want this lookup to appear as "no CAGG data" so it doesn't
   * consume a configured result-sequence entry. Returning `[]` makes
   * `loadCaggApdexScope()` resolve to `null`, which preserves the
   * raw-scan behaviour the existing tests assert.
   */
  const isCaggScopeLookup = (sql: unknown): boolean =>
    typeof sql === 'string' &&
    /has_transactions_cagg/i.test(sql) &&
    /has_requests_raw_cagg/i.test(sql);

  /**
   * Configures testRunRepo.query so that the first call (UUID lookup) returns
   * the given test_run_id, and all subsequent calls return the provided rows.
   * `SET LOCAL work_mem` preludes are treated as no-op steps.
   */
  function mockWithUuidResolution(
    resolvedTestRunId: string,
    ...subsequentResults: unknown[][]
  ) {
    let uuidServed = false;
    let idx = 0;
    (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
      if (isSetLocalWorkMem(sql)) return [];
      if (isRollupExistenceCheck(sql)) return [];
      if (isRollupScopeLookup(sql)) return [];
      if (isCaggScopeLookup(sql)) return [];
      if (!uuidServed) {
        uuidServed = true;
        return [{ test_run_id: resolvedTestRunId }];
      }
      const r = subsequentResults[idx] ?? [];
      idx++;
      return r;
    });
  }

  /**
   * Configure for a plain test_run_id (no UUID lookup needed) with optional
   * ramp-up cutoff resolution as the first query, then data rows.
   * `SET LOCAL work_mem` preludes are treated as no-op steps.
   */
  function mockQuerySequence(...results: unknown[][]) {
    let idx = 0;
    (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
      if (isSetLocalWorkMem(sql)) return [];
      if (isRollupExistenceCheck(sql)) return [];
      if (isRollupScopeLookup(sql)) return [];
      if (isCaggScopeLookup(sql)) return [];
      const r = results[idx] ?? [];
      idx++;
      return r;
    });
  }

  /**
   * Rollup hit path: the existence check returns a non-empty result, so the
   * service uses the pre-computed rollup tables. Followed by a single query
   * returning the mapped rows.
   *
   * Param `rollupRows` feeds the `FROM test_run_(transaction|sampler)_stats`
   * SELECT that produces Apdex + p95/p99 on the stored tdigest.
   */
  function mockWithRollupHit(rollupRows: unknown[]) {
    (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
      if (isSetLocalWorkMem(sql)) return [];
      if (isRollupExistenceCheck(sql)) return [{ '?column?': 1 }];
      if (isRollupScopeLookup(sql)) return [];
      if (isCaggScopeLookup(sql)) return [];
      // Everything else: the rollup read (no UUID lookup for plain test_run_id).
      return rollupRows;
    });
  }

  // =========================================================================
  // getTransactionStats
  // =========================================================================

  describe('getTransactionStats', () => {
    describe('authorization', () => {
      it('returns empty array for non-admin with no org memberships', async () => {
        // Arrange – no repo calls expected
        // Act
        const result = await service.getTransactionStats(TEST_RUN_ID, false, NOT_ADMIN, []);

        // Assert
        expect(result).toEqual([]);
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('queries database for admin with empty org list', async () => {
        // Arrange – admin bypasses org check
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        // Act
        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        // Assert
        expect(result).toHaveLength(1);
        expect(testRunRepo.query).toHaveBeenCalled();
      });

      it('queries database for non-admin with org memberships', async () => {
        // Arrange
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        // Act
        const result = await service.getTransactionStats(TEST_RUN_ID, false, NOT_ADMIN, ORG_IDS);

        // Assert
        expect(result).toHaveLength(1);
        expect(testRunRepo.query).toHaveBeenCalled();
      });

    });

    describe('UUID resolution', () => {
      it('resolves UUID to test_run_id before querying', async () => {
        // Arrange – first query = UUID lookup, second query = stats
        mockWithUuidResolution(TEST_RUN_ID, [RAW_TRANSACTION_ROW]);

        // Act
        const result = await service.getTransactionStats(UUID, false, IS_ADMIN, []);

        // Assert
        expect(result).toHaveLength(1);
        // First call should be UUID lookup query
        const firstCall = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(firstCall[0]).toContain('SELECT test_run_id FROM test_runs WHERE id');
        expect(firstCall[1]).toEqual([UUID]);
      });

      it('skips UUID lookup for plain test_run_id', async () => {
        // Arrange
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        // Act
        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        // Assert – UUID lookup query is NOT issued (only 1 query: the stats query)
        const allCalls = (testRunRepo.query as jest.Mock).mock.calls;
        // No call should contain "WHERE id ="
        const hasUuidLookup = allCalls.some(([sql]: [string]) =>
          sql.includes('WHERE id = $1')
        );
        expect(hasUuidLookup).toBe(false);
      });

      it('throws DatabaseException when UUID not found', async () => {
        (testRunRepo.query as jest.Mock).mockResolvedValueOnce([]);

        await expect(
          service.getTransactionStats(UUID, false, IS_ADMIN, [])
        ).rejects.toThrow(DatabaseException);
      });
    });

    describe('ramp-up exclusion', () => {
      it('fetches cutoff time when excludeRampUp is true', async () => {
        // Arrange – plain test_run_id → no UUID lookup
        // First query: ramp-up cutoff; second: SET LOCAL work_mem; third: stats
        const startTime = new Date('2024-01-01T10:00:00Z');
        mockQuerySequence(
          [{ start_time: startTime.toISOString(), ramp_up: '300' }],
          [RAW_TRANSACTION_ROW],
        );

        // Act
        const result = await service.getTransactionStats(TEST_RUN_ID, true, IS_ADMIN, []);

        // Assert
        expect(result).toHaveLength(1);
        // 7 calls: rollup existence check + scope lookup (rollup-pending gate)
        // + CAGG scope lookup (live-Apdex CAGG plan) + ramp-up lookup
        // + SET LOCAL statement_timeout + SET LOCAL work_mem + stats query
        expect(testRunRepo.query).toHaveBeenCalledTimes(7);
        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        expect(calls.some(([sql]) => (sql as string).includes('SELECT start_time, ramp_up'))).toBe(true);
      });

      it('passes null cutoff when excludeRampUp is false', async () => {
        // Arrange – only 1 query (stats), no ramp-up lookup
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        // Act
        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        // Assert – stats query receives $3 = null (cutoffTime)
        const statsCalls = (testRunRepo.query as jest.Mock).mock.calls;
        // The stats query is identified by the approx_percentile call (new shape)
        const statsCall = statsCalls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        );
        expect(statsCall).toBeDefined();
        expect(statsCall![1][2]).toBeNull();
      });

      it('passes null cutoff when ramp_up data missing from DB', async () => {
        mockQuerySequence(
          [{ start_time: null, ramp_up: null }], // ramp-up query returns no usable data
          [RAW_TRANSACTION_ROW],
        );

        const result = await service.getTransactionStats(TEST_RUN_ID, true, IS_ADMIN, []);
        expect(result).toHaveLength(1);
      });
    });

    describe('sinceMinutes window filter', () => {
      it('includes window filter when sinceMinutes is provided (admin)', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, [], 60);

        const statsCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        expect(statsCall[0]).toContain("interval '1 minute'");
        // Admin params: [testRunId, excludeRampUp, cutoffTime, endCutoff, sinceMinutes]
        expect(statsCall[1]).toHaveLength(5);
        expect(statsCall[1][4]).toBe(60);
      });

      it('includes window filter and org filter for non-admin with sinceMinutes', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, NOT_ADMIN, ORG_IDS, 30);

        const statsCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        // Non-admin params: [testRunId, excludeRampUp, cutoffTime, endCutoff, sinceMinutes, orgIds]
        expect(statsCall[1]).toHaveLength(6);
        expect(statsCall[1][4]).toBe(30);
        expect(statsCall[1][5]).toEqual(ORG_IDS);
      });

      it('omits window filter when sinceMinutes is undefined (admin)', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, [], undefined);

        const statsCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        // Admin params without sinceMinutes: [testRunId, excludeRampUp, cutoffTime, endCutoff]
        expect(statsCall[1]).toHaveLength(4);
      });
    });

    describe('SQL structure (query shape regressions)', () => {
      it('uses approx_percentile + percentile_agg (no PERCENTILE_CONT)', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        const statsCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        expect(statsCall[0]).toContain('percentile_agg(t.response_time::double precision)');
        expect(statsCall[0]).toContain('approx_percentile(0.95, a.pct_agg)');
        expect(statsCall[0]).toContain('approx_percentile(0.99, a.pct_agg)');
        expect(statsCall[0]).toContain('approx_percentile_rank');
        expect(statsCall[0]).not.toContain('PERCENTILE_CONT');
      });

      it('joins apdex thresholds on sut.id (no name OR id::text OR-join)', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        const statsCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        expect(statsCall[0]).toContain('wat.system_under_test_id = a.system_under_test_id');
        expect(statsCall[0]).toContain('wtat.system_under_test_id = a.system_under_test_id');
        expect(statsCall[0]).not.toContain('sut.name OR');
        expect(statsCall[0]).not.toContain('sut.id::text');
      });

      it('wraps query in a transaction with SET LOCAL work_mem', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(testRunRepo.manager.transaction).toHaveBeenCalledTimes(1);
        const setLocalCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          /SET\s+LOCAL\s+work_mem/i.test(sql)
        );
        expect(setLocalCall).toBeDefined();
      });
    });

    describe('data mapping', () => {
      it('maps all fields from raw DB row correctly', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result).toHaveLength(1);
        const row = result[0];
        expect(row.transaction_name).toBe('checkout');
        expect(row.scenario_name).toBe('load_test');
        expect(row.total_count).toBe(600);
        expect(row.passed_count).toBe(590);
        expect(row.failed_count).toBe(10);
        expect(row.avg_response_time).toBe(120.5);
        expect(row.p95_response_time).toBe(300);
        expect(row.p99_response_time).toBe(450);
        expect(row.ranking).toBe(72300);
        expect(row.apdex_score).toBe(0.95);
        expect(row.active_threshold).toBe(500);
      });

      it('maps null scenario_name to undefined', async () => {
        mockQuerySequence([{ ...RAW_TRANSACTION_ROW, scenario_name: null }]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result[0].scenario_name).toBeUndefined();
      });

      it('maps empty string scenario_name to undefined', async () => {
        mockQuerySequence([{ ...RAW_TRANSACTION_ROW, scenario_name: '' }]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result[0].scenario_name).toBeUndefined();
      });

      it('defaults null numeric fields to 0', async () => {
        mockQuerySequence([{
          ...RAW_TRANSACTION_ROW,
          avg_response_time: null,
          p95_response_time: null,
          p99_response_time: null,
          apdex_score: null,
        }]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result[0].avg_response_time).toBe(0);
        expect(result[0].p95_response_time).toBe(0);
        expect(result[0].p99_response_time).toBe(0);
        expect(result[0].apdex_score).toBe(0);
      });

      it('defaults null active_threshold to 500', async () => {
        mockQuerySequence([{ ...RAW_TRANSACTION_ROW, active_threshold: null }]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result[0].active_threshold).toBe(500);
      });

      it('returns empty array when no rows found', async () => {
        mockQuerySequence([]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result).toEqual([]);
      });

      it('maps multiple rows preserving order', async () => {
        const row2 = { ...RAW_TRANSACTION_ROW, transaction_name: 'login' };
        mockQuerySequence([RAW_TRANSACTION_ROW, row2]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result).toHaveLength(2);
        expect(result[0].transaction_name).toBe('checkout');
        expect(result[1].transaction_name).toBe('login');
      });
    });

    describe('error handling', () => {
      it('wraps raw DB error into DatabaseException', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('connection refused'));

        await expect(
          service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, [])
        ).rejects.toThrow(DatabaseException);
      });

      it('wraps DB error with correct message', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

        await expect(
          service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, [])
        ).rejects.toThrow('Failed to retrieve transaction statistics');
      });

      it('propagates existing DatabaseException wrapped', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(
          new DatabaseException('pre-existing db error')
        );

        await expect(
          service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, [])
        ).rejects.toThrow(DatabaseException);
      });
    });

    // ---------------------------------------------------------------------
    // Rollup fast path (#150, #151)
    // ---------------------------------------------------------------------

    describe('rollup fast path', () => {
      it('reads from test_run_transaction_stats when a rollup row exists', async () => {
        mockWithRollupHit([RAW_TRANSACTION_ROW]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result).toHaveLength(1);
        expect(result[0].transaction_name).toBe('checkout');

        const queryCalls = (testRunRepo.query as jest.Mock).mock.calls;
        const rollupRead = queryCalls.find(([sql]) =>
          typeof sql === 'string' && /FROM\s+test_run_transaction_stats\s+trs/i.test(sql),
        );
        expect(rollupRead).toBeDefined();
        // No SET LOCAL work_mem needed for the rollup path — reads are tiny.
        const hasSetLocal = queryCalls.some(([sql]) =>
          typeof sql === 'string' && /SET\s+LOCAL\s+work_mem/i.test(sql),
        );
        expect(hasSetLocal).toBe(false);
      });

      it('passes excludeRampUp through as ramp_up_excluded param', async () => {
        mockWithRollupHit([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, true, IS_ADMIN, []);

        const queryCalls = (testRunRepo.query as jest.Mock).mock.calls;
        const rollupCall = queryCalls.find(([sql]) =>
          typeof sql === 'string' && /FROM\s+test_run_transaction_stats\s+trs/i.test(sql),
        )!;
        const params = rollupCall[1] as unknown[];
        // $1 = testRunId, $2 = ramp_up_excluded
        expect(params[0]).toBe(TEST_RUN_ID);
        expect(params[1]).toBe(true);
      });

      it('falls back to live aggregation when no rollup row exists', async () => {
        mockQuerySequence([RAW_TRANSACTION_ROW]); // existence check returns []

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result).toHaveLength(1);
        const queryCalls = (testRunRepo.query as jest.Mock).mock.calls;
        // Live path does run SET LOCAL work_mem + live transactions query.
        const hasSetLocal = queryCalls.some(([sql]) =>
          typeof sql === 'string' && /SET\s+LOCAL\s+work_mem/i.test(sql),
        );
        expect(hasSetLocal).toBe(true);
      });

      it('bypasses the rollup when sinceMinutes is set (window not servable)', async () => {
        // Even if a rollup row exists, sinceMinutes forces the live path.
        // Make the existence check match a hit so we prove sinceMinutes wins.
        let sawExistenceCheck = false;
        (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
          if (isSetLocalWorkMem(sql)) return [];
          if (isRollupExistenceCheck(sql)) {
            sawExistenceCheck = true;
            return [{ '?column?': 1 }];
          }
          return [RAW_TRANSACTION_ROW];
        });

        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, [], 5);

        // Existence check should not have been reached because sinceMinutes
        // short-circuits the rollup path before checking.
        expect(sawExistenceCheck).toBe(false);
      });

      it('binds organizationIds to $3 when caller is non-admin', async () => {
        mockWithRollupHit([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, NOT_ADMIN, ORG_IDS);

        const rollupCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]) =>
          typeof sql === 'string' && /FROM\s+test_run_transaction_stats\s+trs/i.test(sql),
        )!;
        const [sql, params] = rollupCall;
        expect(sql).toMatch(/organization_id\s*=\s*ANY\(\$3::uuid\[\]\)/i);
        expect(params[0]).toBe(TEST_RUN_ID);
        expect(params[1]).toBe(false);
        expect(params[2]).toEqual(ORG_IDS);
      });
    });

    // ---------------------------------------------------------------------
    // Rollup-pending gate
    // ---------------------------------------------------------------------

    describe('rollup-pending gate', () => {
      it('returns RollupPendingResult when status is rollup-pending and sinceMinutes is null', async () => {
        jest.spyOn(service as never, 'getRollupStatus').mockResolvedValue({
          status: 'rollup-pending',
          stage: 'transaction-stats-rollup',
          progress: { stageName: 'transaction-stats-rollup', stageIndex: 4, totalStages: 11 },
        } as never);
        // CAGG fast path probes scope after getRollupStatus; null = no CAGG
        // data → fall through to the pending result (controller maps to 202).
        jest.spyOn(service as never, 'loadCaggApdexScope').mockResolvedValue(null as never);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(isRollupPending(result)).toBe(true);
        expect(result).toMatchObject({
          stage: 'transaction-stats-rollup',
          progress: { stageIndex: 4, totalStages: 11 },
        });
      });

      it('falls through to live aggregation when status is unavailable (soft-failed rollup)', async () => {
        jest.spyOn(service as never, 'getRollupStatus').mockResolvedValue({
          status: 'unavailable',
        } as never);
        // Configure remaining query mocks for the live-agg path.
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(isRollupPending(result)).toBe(false);
        expect(Array.isArray(result)).toBe(true);
      });

      it('does NOT gate when sinceMinutes is set, even if rollup would be pending', async () => {
        const getRollupStatusSpy = jest.spyOn(service as never, 'getRollupStatus');
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, [], 5);

        expect(getRollupStatusSpy).not.toHaveBeenCalled();
      });
    });

    // ---------------------------------------------------------------------
    // Safety net (clamp + statement_timeout)
    // ---------------------------------------------------------------------

    describe('safety net (clamp + statement_timeout)', () => {
      const LIVE_WINDOW_MAX_MINUTES = 60;

      it('clamps sinceMinutes to LIVE_WINDOW_MAX_MINUTES on the live path', async () => {
        jest
          .spyOn(service as never, 'getRollupStatus')
          .mockResolvedValue({ status: 'unavailable' } as never);
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, [], 9999);

        // Find the call that ran the live-agg SQL (contains "FROM transactions t")
        const liveCall = (testRunRepo.query as jest.Mock).mock.calls.find(
          (call: [unknown]) =>
            typeof call[0] === 'string' && (call[0] as string).includes('FROM transactions t'),
        );
        expect(liveCall).toBeDefined();
        // sinceMinutes appears in the params array, clamped
        expect(liveCall![1]).toEqual(expect.arrayContaining([LIVE_WINDOW_MAX_MINUTES]));
      });

      it('passes sinceMinutes through unchanged when below the cap', async () => {
        jest
          .spyOn(service as never, 'getRollupStatus')
          .mockResolvedValue({ status: 'unavailable' } as never);
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, [], 5);

        const liveCall = (testRunRepo.query as jest.Mock).mock.calls.find(
          (call: [unknown]) =>
            typeof call[0] === 'string' && (call[0] as string).includes('FROM transactions t'),
        );
        expect(liveCall).toBeDefined();
        expect(liveCall![1]).toEqual(expect.arrayContaining([5]));
      });

      it('wraps live aggregation in a transaction that sets statement_timeout', async () => {
        jest
          .spyOn(service as never, 'getRollupStatus')
          .mockResolvedValue({ status: 'unavailable' } as never);
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, [], 5);

        const calls = (testRunRepo.query as jest.Mock).mock.calls.map(
          (c: [unknown]) => c[0],
        );
        expect(
          calls.some((sql) => typeof sql === 'string' && (sql as string).includes('statement_timeout')),
        ).toBe(true);
      });
    });

    // ---------------------------------------------------------------------
    // CAGG fast path (live-Apdex CAGG plan, Task 4)
    // ---------------------------------------------------------------------

    describe('CAGG fast path', () => {
      const baseScope = {
        sut: 'demo-sut',
        systemUnderTestId: 'sut-uuid-1',
        env: 'prod',
        workload: 'wl-1',
        startTime: new Date('2026-05-09T10:00:00Z'),
        endTime: new Date('2026-05-09T10:30:00Z'),
        cutoffTime: null,
        hasTransactionsCagg: true,
        hasRequestsRawCagg: true,
      };

      const RAW_CAGG_ROW = {
        transaction_name: 'tx',
        scenario_name: 'sc',
        total_count: '100',
        passed_count: '95',
        failed_count: '5',
        avg_response_time: '420.50',
        p95_response_time: '900.00',
        p99_response_time: '1200.00',
        impact_score: '42050.00',
        active_threshold: '500',
        apdex_score: '0.875',
        ranking: '1',
      };

      it('runs the CAGG query and returns mapped stats', async () => {
        jest
          .spyOn(service as never, 'getRollupStatus')
          .mockResolvedValue({ status: 'unavailable' } as never);
        jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue(baseScope as never);
        // CAGG query routes through manager.transaction → mapped query mock.
        (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
          if (isSetLocalWorkMem(sql)) return [];
          if (typeof sql === 'string' && /transactions_passed_5s/.test(sql)) {
            return [RAW_CAGG_ROW];
          }
          return [];
        });

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(Array.isArray(result)).toBe(true);
        expect((result as Array<Record<string, unknown> & { transaction_name?: string }>)[0]).toMatchObject({
          transaction_name: 'tx',
          total_count: 100,
          passed_count: 95,
          failed_count: 5,
          apdex_score: 0.875,
          active_threshold: 500,
        });
      });

      it('JOINs transactions_5s and transactions_passed_5s on (bucket, sut, env, scenario, transaction)', async () => {
        jest
          .spyOn(service as never, 'getRollupStatus')
          .mockResolvedValue({ status: 'unavailable' } as never);
        jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue(baseScope as never);

        const sqlSeen: string[] = [];
        (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
          if (typeof sql === 'string') sqlSeen.push(sql);
          if (isSetLocalWorkMem(sql)) return [];
          return [];
        });

        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        const sql = sqlSeen.find((s) => /transactions_5s/.test(s));
        expect(sql).toBeDefined();
        expect(sql!).toMatch(/FROM\s+transactions_5s/);
        expect(sql!).toMatch(/JOIN\s+transactions_passed_5s/);
        // JOIN keys
        expect(sql!).toMatch(/c\.bucket\s*=\s*p\.bucket/);
        expect(sql!).toMatch(/c\.system_under_test\s*=\s*p\.system_under_test/);
        expect(sql!).toMatch(/c\.transaction_name\s*=\s*p\.transaction_name/);
        // Aggregation: rollup(c.pct_agg) (all rows for percentiles) and
        // rollup(p.pct_agg_passed) (success-filtered for Apdex).
        expect(sql!).toMatch(/rollup\(c\.pct_agg\)/);
        expect(sql!).toMatch(/rollup\(p\.pct_agg_passed\)/);
        // Apdex uses pct_agg_passed (success-filtered) — the post-#298 fix.
        expect(sql!).toMatch(
          /approx_percentile_rank\([\s\S]*?active_threshold[\s\S]*?pct_agg_passed[\s\S]*?\)/,
        );
        // Threshold join uses the SUT UUID (FK from test_runs) rather than
        // matching `systems_under_test.name`, which is not unique across orgs.
        expect(sql!).toMatch(/wat\.system_under_test_id\s*=\s*\$8::uuid/);
        expect(sql!).toMatch(/wtat\.system_under_test_id\s*=\s*\$8::uuid/);
        expect(sql!).not.toMatch(/JOIN\s+systems_under_test\s+sut\s+ON\s+sut\.name\s*=\s*\$1/);
      });

      it('falls through to raw scan when transactions_passed CAGG is empty for the window', async () => {
        jest
          .spyOn(service as never, 'getRollupStatus')
          .mockResolvedValue({ status: 'unavailable' } as never);
        jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue({ ...baseScope, hasTransactionsCagg: false } as never);
        // Live-agg path: rollup existence check + CAGG scope skip + stats query
        mockQuerySequence([RAW_TRANSACTION_ROW]);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(Array.isArray(result)).toBe(true);
        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        // Confirm we did NOT issue the CAGG-specific query (no transactions_passed_5s).
        const ranCagg = calls.some(([sql]: [unknown]) =>
          typeof sql === 'string' && /transactions_passed_5s/.test(sql as string),
        );
        expect(ranCagg).toBe(false);
        // Confirm the raw-scan path ran (FROM transactions t).
        const ranRaw = calls.some(([sql]: [unknown]) =>
          typeof sql === 'string' && /FROM\s+transactions\s+t\b/.test(sql as string),
        );
        expect(ranRaw).toBe(true);
      });

      it('uses the CAGG path even when sinceMinutes is set (live window)', async () => {
        const getRollupStatusSpy = jest.spyOn(service as never, 'getRollupStatus');
        const loadCaggApdexScopeSpy = jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue(baseScope as never);
        const getTransactionStatsFromCaggSpy = jest
          .spyOn(service as never, 'getTransactionStatsFromCagg')
          .mockResolvedValue([] as never);

        const sinceMinutes = 5;
        const before = Date.now();
        await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, [], sinceMinutes);
        const after = Date.now();

        // getRollupStatus must NOT be called when sinceMinutes is set.
        expect(getRollupStatusSpy).not.toHaveBeenCalled();
        expect(loadCaggApdexScopeSpy).toHaveBeenCalled();
        // getTransactionStatsFromCagg called with adjusted scope; startTime
        // is max(scope.startTime, NOW() - sinceMinutes*60_000). The stub
        // baseScope.startTime is from 2026 (well in the past), so the
        // live cutoff wins.
        expect(getTransactionStatsFromCaggSpy).toHaveBeenCalledTimes(1);
        const passedScope = (getTransactionStatsFromCaggSpy.mock.calls[0] as unknown[])[0] as {
          startTime: Date;
        };
        const liveCutoffMs = passedScope.startTime.getTime();
        expect(liveCutoffMs).toBeGreaterThanOrEqual(before - sinceMinutes * 60_000);
        expect(liveCutoffMs).toBeLessThanOrEqual(after - sinceMinutes * 60_000);
      });

      it("returns RollupPendingResult when rollup is 'rollup-pending' AND CAGG is empty", async () => {
        jest.spyOn(service as never, 'getRollupStatus').mockResolvedValue({
          status: 'rollup-pending',
          stage: 'transaction-stats-rollup',
          progress: { stageName: 'transaction-stats-rollup', stageIndex: 4, totalStages: 11 },
        } as never);
        jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue({ ...baseScope, hasTransactionsCagg: false } as never);

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(isRollupPending(result)).toBe(true);
        expect(result).toMatchObject({
          stage: 'transaction-stats-rollup',
          progress: { stageIndex: 4, totalStages: 11 },
        });
      });

      it("prefers CAGG over RollupPendingResult when rollup is 'rollup-pending' AND CAGG has data", async () => {
        jest.spyOn(service as never, 'getRollupStatus').mockResolvedValue({
          status: 'rollup-pending',
          stage: 'transaction-stats-rollup',
          progress: { stageName: 'transaction-stats-rollup', stageIndex: 4, totalStages: 11 },
        } as never);
        jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue(baseScope as never);
        (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
          if (isSetLocalWorkMem(sql)) return [];
          if (typeof sql === 'string' && /transactions_passed_5s/.test(sql)) {
            return [RAW_CAGG_ROW];
          }
          return [];
        });

        const result = await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(isRollupPending(result)).toBe(false);
        expect(Array.isArray(result)).toBe(true);
        expect((result as Array<Record<string, unknown> & { transaction_name?: string }>).length).toBeGreaterThan(0);
        expect((result as Array<Record<string, unknown> & { transaction_name?: string }>)[0].transaction_name).toBe('tx');
      });
    });
  });

  // =========================================================================
  // getTransactionSamples
  // =========================================================================

  describe('getTransactionSamples', () => {
    const TRANSACTION = 'checkout';

    describe('authorization', () => {
      it('returns empty array for non-admin with no org memberships', async () => {
        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, NOT_ADMIN, []);

        expect(result).toEqual([]);
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('queries database for admin with empty org list', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(result).toHaveLength(1);
      });

      it('queries database for non-admin with org memberships', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, NOT_ADMIN, ORG_IDS);

        expect(result).toHaveLength(1);
      });
    });

    describe('ramp-up exclusion', () => {
      it('fetches cutoff time when excludeRampUp is true', async () => {
        const startTime = new Date('2024-01-01T10:00:00Z');
        mockQuerySequence(
          [{ start_time: startTime.toISOString(), ramp_up: '120' }],
          [RAW_SAMPLER_ROW],
        );

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, true, IS_ADMIN, []);

        expect(result).toHaveLength(1);
        // 7 calls: rollup existence check + scope lookup (rollup-pending gate)
        // + CAGG scope lookup (live-Apdex CAGG plan) + ramp-up lookup
        // + SET LOCAL statement_timeout + SET LOCAL work_mem + samples query
        expect(testRunRepo.query).toHaveBeenCalledTimes(7);
      });

      it('does not fetch cutoff when excludeRampUp is false', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        // 6 calls — rollup existence check + scope lookup (rollup-pending gate)
        // + CAGG scope lookup (live-Apdex CAGG plan) + SET LOCAL statement_timeout
        // + SET LOCAL work_mem + samples query (no ramp-up lookup)
        expect(testRunRepo.query).toHaveBeenCalledTimes(6);
      });
    });

    describe('sinceMinutes window filter', () => {
      it('appends sinceMinutes param for admin', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, [], 45);

        // Skip the SET LOCAL prelude — find the samples query
        const samplerCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        expect(samplerCall[0]).toContain("interval '1 minute'");
        // Params: [testRunId, transactionName, excludeRampUp, cutoffTime, endCutoff, sinceMinutes]
        expect(samplerCall[1]).toHaveLength(6);
        expect(samplerCall[1][5]).toBe(45);
      });

      it('appends orgIds after sinceMinutes for non-admin', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, NOT_ADMIN, ORG_IDS, 15);

        const samplerCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        // Params: [testRunId, transactionName, excludeRampUp, cutoffTime, endCutoff, sinceMinutes, orgIds]
        expect(samplerCall[1]).toHaveLength(7);
        expect(samplerCall[1][5]).toBe(15);
        expect(samplerCall[1][6]).toEqual(ORG_IDS);
      });

      it('places orgIds at position 5 when sinceMinutes absent (non-admin)', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, NOT_ADMIN, ORG_IDS);

        const samplerCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        // Params: [testRunId, transactionName, excludeRampUp, cutoffTime, endCutoff, orgIds]
        expect(samplerCall[1]).toHaveLength(6);
        expect(samplerCall[1][5]).toEqual(ORG_IDS);
      });
    });

    describe('SQL structure (query shape regressions)', () => {
      it('uses approx_percentile + percentile_agg (no PERCENTILE_CONT)', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        const samplerCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        expect(samplerCall[0]).toContain('percentile_agg(r.response_time::double precision)');
        expect(samplerCall[0]).toContain('approx_percentile(0.95, a.pct_agg)');
        expect(samplerCall[0]).toContain('approx_percentile(0.99, a.pct_agg)');
        expect(samplerCall[0]).toContain('approx_percentile_rank');
        expect(samplerCall[0]).not.toContain('PERCENTILE_CONT');
      });

      it('joins apdex thresholds on sut.id (no name OR id::text OR-join)', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        const samplerCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        expect(samplerCall[0]).toContain('wat.system_under_test_id = sut.id');
        expect(samplerCall[0]).toContain('wtat.system_under_test_id = sut.id');
        expect(samplerCall[0]).not.toContain('sut.name OR');
        expect(samplerCall[0]).not.toContain('sut.id::text');
      });

      it('joins url_patterns on a.url_hash (no leftover sg.url_hash typo)', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        const samplerCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          sql.includes('approx_percentile')
        )!;
        expect(samplerCall[0]).toContain('a.url_hash');
        expect(samplerCall[0]).not.toContain('sg.url_hash');
      });

      it('wraps query in a transaction with SET LOCAL work_mem', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(testRunRepo.manager.transaction).toHaveBeenCalledTimes(1);
        const setLocalCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
          /SET\s+LOCAL\s+work_mem/i.test(sql)
        );
        expect(setLocalCall).toBeDefined();
      });
    });

    describe('data mapping', () => {
      it('maps all fields correctly from raw row', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(result).toHaveLength(1);
        const row = result[0];
        expect(row.sampler_name).toBe('POST /checkout');
        expect(row.scenario_name).toBe('load_test');
        expect(row.avg_response_time).toBe(115.25);
        expect(row.min_response_time).toBe(50);
        expect(row.max_response_time).toBe(900);
        expect(row.p95_response_time).toBe(295);
        expect(row.p99_response_time).toBe(440);
        expect(row.passed_count).toBe(580);
        expect(row.failed_count).toBe(10);
        expect(row.total_count).toBe(590);
        expect(row.avg_latency).toBe(10);
        expect(row.avg_connect_time).toBe(5);
        expect(row.total_request_size).toBe(102400);
        expect(row.total_response_size).toBe(204800);
        expect(row.apdex_score).toBe(0.94);
        expect(row.active_threshold).toBe(500);
        expect(row.url_hash).toBe('abc123');
        expect(row.url_pattern).toBe('/checkout');
      });

      it('maps null url_hash and url_pattern to null', async () => {
        mockQuerySequence([{ ...RAW_SAMPLER_ROW, url_hash: null, url_pattern: null }]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(result[0].url_hash).toBeNull();
        expect(result[0].url_pattern).toBeNull();
      });

      it('maps null scenario_name to undefined', async () => {
        mockQuerySequence([{ ...RAW_SAMPLER_ROW, scenario_name: null }]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(result[0].scenario_name).toBeUndefined();
      });

      it('returns empty array when no samplers found', async () => {
        mockQuerySequence([]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(result).toEqual([]);
      });

      it('defaults null numeric fields to 0', async () => {
        mockQuerySequence([{
          ...RAW_SAMPLER_ROW,
          avg_response_time: null,
          avg_latency: null,
          apdex_score: null,
        }]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(result[0].avg_response_time).toBe(0);
        expect(result[0].avg_latency).toBe(0);
        expect(result[0].apdex_score).toBe(0);
      });
    });

    describe('error handling', () => {
      it('wraps DB error into DatabaseException', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('db error'));

        await expect(
          service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, [])
        ).rejects.toThrow(DatabaseException);
      });

      it('wraps DB error with correct message', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

        await expect(
          service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, [])
        ).rejects.toThrow('Failed to retrieve transaction sampler statistics');
      });
    });

    // ---------------------------------------------------------------------
    // Rollup fast path (#150, #151)
    // ---------------------------------------------------------------------

    describe('rollup fast path', () => {
      const TRANSACTION = 'checkout';

      it('reads from test_run_sampler_stats when a rollup row exists', async () => {
        mockWithRollupHit([RAW_SAMPLER_ROW]);

        const result = await service.getTransactionSamples(
          TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, [],
        );

        expect(result).toHaveLength(1);
        expect(result[0].sampler_name).toBe('POST /checkout');

        const queryCalls = (testRunRepo.query as jest.Mock).mock.calls;
        const rollupRead = queryCalls.find(([sql]) =>
          typeof sql === 'string' && /FROM\s+test_run_sampler_stats\s+trss/i.test(sql),
        );
        expect(rollupRead).toBeDefined();
      });

      it('passes excludeRampUp through as ramp_up_excluded ($3)', async () => {
        mockWithRollupHit([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(
          TEST_RUN_ID, TRANSACTION, true, IS_ADMIN, [],
        );

        const queryCalls = (testRunRepo.query as jest.Mock).mock.calls;
        const rollupCall = queryCalls.find(([sql]) =>
          typeof sql === 'string' && /FROM\s+test_run_sampler_stats\s+trss/i.test(sql),
        )!;
        const params = rollupCall[1] as unknown[];
        expect(params[0]).toBe(TEST_RUN_ID);
        expect(params[1]).toBe(TRANSACTION);
        expect(params[2]).toBe(true);
      });

      it('falls back to live aggregation when no rollup row exists', async () => {
        mockQuerySequence([RAW_SAMPLER_ROW]);

        const result = await service.getTransactionSamples(
          TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, [],
        );

        expect(result).toHaveLength(1);
        const hasSetLocal = (testRunRepo.query as jest.Mock).mock.calls.some(([sql]) =>
          typeof sql === 'string' && /SET\s+LOCAL\s+work_mem/i.test(sql),
        );
        expect(hasSetLocal).toBe(true);
      });

      it('bypasses the rollup when sinceMinutes is set', async () => {
        let sawExistenceCheck = false;
        (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
          if (isSetLocalWorkMem(sql)) return [];
          if (isRollupExistenceCheck(sql)) {
            sawExistenceCheck = true;
            return [{ '?column?': 1 }];
          }
          return [RAW_SAMPLER_ROW];
        });

        await service.getTransactionSamples(
          TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, [], 10,
        );

        expect(sawExistenceCheck).toBe(false);
      });

      it('binds organizationIds to $4 when caller is non-admin', async () => {
        mockWithRollupHit([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(
          TEST_RUN_ID, TRANSACTION, true, NOT_ADMIN, ORG_IDS,
        );

        const rollupCall = (testRunRepo.query as jest.Mock).mock.calls.find(([sql]) =>
          typeof sql === 'string' && /FROM\s+test_run_sampler_stats\s+trss/i.test(sql),
        )!;
        const [sql, params] = rollupCall;
        expect(sql).toMatch(/organization_id\s*=\s*ANY\(\$4::uuid\[\]\)/i);
        expect(params[0]).toBe(TEST_RUN_ID);
        expect(params[1]).toBe(TRANSACTION);
        expect(params[2]).toBe(true);
        expect(params[3]).toEqual(ORG_IDS);
      });
    });

    // ---------------------------------------------------------------------
    // Rollup-pending gate
    // ---------------------------------------------------------------------

    describe('rollup-pending gate', () => {
      it('returns RollupPendingResult when rollup is pending', async () => {
        jest.spyOn(service as never, 'getRollupStatus').mockResolvedValue({
          status: 'rollup-pending',
          stage: 'transaction-stats-rollup',
        } as never);
        // Stub the CAGG scope explicitly: with the live-Apdex CAGG plan
        // wire-up, a CAGG hit would shadow the pending result. Force the
        // CAGG-empty branch so this test still asserts the pending payload.
        jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue(null as never);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(isRollupPending(result)).toBe(true);
        expect(result).toMatchObject({ stage: 'transaction-stats-rollup' });
      });

      it('does NOT gate samples when sinceMinutes is set', async () => {
        const getRollupStatusSpy = jest.spyOn(service as never, 'getRollupStatus');
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, [], 5);

        expect(getRollupStatusSpy).not.toHaveBeenCalled();
      });
    });

    // ---------------------------------------------------------------------
    // Safety net (clamp + statement_timeout) — samples
    // ---------------------------------------------------------------------

    describe('safety net (clamp + statement_timeout) — samples', () => {
      it('clamps sinceMinutes to LIVE_WINDOW_MAX_MINUTES on the samples live path', async () => {
        jest
          .spyOn(service as never, 'getRollupStatus')
          .mockResolvedValue({ status: 'unavailable' } as never);
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, [], 9999);

        // Tighten the regex to specifically match the raw-scan SQL (`FROM
        // requests_raw r`) rather than `FROM requests_raw` which would also
        // match the `requests_raw_passed_5s` EXISTS subquery in the CAGG
        // scope-lookup added by the live-Apdex CAGG plan.
        const liveCall = (testRunRepo.query as jest.Mock).mock.calls.find(
          (call: [unknown]) =>
            typeof call[0] === 'string' && /FROM\s+requests_raw\s+r\b/.test(call[0] as string),
        );
        expect(liveCall).toBeDefined();
        expect(liveCall![1]).toEqual(expect.arrayContaining([60]));
      });

      it('wraps samples live aggregation in a transaction that sets statement_timeout', async () => {
        jest
          .spyOn(service as never, 'getRollupStatus')
          .mockResolvedValue({ status: 'unavailable' } as never);
        mockQuerySequence([RAW_SAMPLER_ROW]);

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, [], 5);

        const calls = (testRunRepo.query as jest.Mock).mock.calls.map(
          (c: [unknown]) => c[0],
        );
        expect(
          calls.some((sql) => typeof sql === 'string' && (sql as string).includes('statement_timeout')),
        ).toBe(true);
      });
    });

    // ---------------------------------------------------------------------
    // CAGG fast path (live-Apdex CAGG plan, Task 5)
    // ---------------------------------------------------------------------

    describe('CAGG fast path', () => {
      const baseScope = {
        sut: 'demo-sut',
        systemUnderTestId: 'sut-uuid-1',
        env: 'prod',
        workload: 'wl-1',
        startTime: new Date('2026-05-09T10:00:00Z'),
        endTime: new Date('2026-05-09T10:30:00Z'),
        cutoffTime: null,
        hasTransactionsCagg: true,
        hasRequestsRawCagg: true,
      };

      const RAW_SAMPLER_CAGG_ROW = {
        sampler_name: 's1',
        scenario_name: 'sc',
        url_hash: null,
        url_pattern: null,
        avg_response_time: '420.50',
        min_response_time: '10',
        max_response_time: '5000',
        p95_response_time: '900.00',
        p99_response_time: '1200.00',
        passed_count: '95',
        failed_count: '5',
        total_count: '100',
        avg_latency: '50.00',
        avg_connect_time: '20.00',
        total_request_size: '10240',
        total_response_size: '102400',
        active_threshold: '500',
        apdex_score: '0.875',
      };

      it('runs the requests_raw_5s + requests_raw_passed_5s JOIN', async () => {
        jest
          .spyOn(service as never, 'getRollupStatus')
          .mockResolvedValue({ status: 'unavailable' } as never);
        jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue(baseScope as never);

        const sqlSeen: string[] = [];
        (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
          if (typeof sql === 'string') sqlSeen.push(sql);
          if (isSetLocalWorkMem(sql)) return [];
          return [];
        });

        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        const sql = sqlSeen.find((s) => /requests_raw_5s/.test(s) && /JOIN/.test(s));
        expect(sql).toBeDefined();
        expect(sql!).toMatch(/FROM\s+requests_raw_5s/);
        expect(sql!).toMatch(/JOIN\s+requests_raw_passed_5s/);
        // p95/p99 from all-rows sketch; Apdex from success-filtered sketch.
        expect(sql!).toMatch(/rollup\(c\.pct_agg\)/);
        expect(sql!).toMatch(/rollup\(p\.pct_agg_passed\)/);
        // Transaction filter param ($8).
        expect(sql!).toMatch(/c\.transaction_name\s*=\s*\$8/);
        // 7-key JOIN: bucket + sut + env + scenario(IS NOT DISTINCT FROM) +
        // sampler + transaction + location(IS NOT DISTINCT FROM).
        expect(sql!).toMatch(/c\.bucket\s*=\s*p\.bucket/);
        expect(sql!).toMatch(/c\.system_under_test\s*=\s*p\.system_under_test/);
        expect(sql!).toMatch(/c\.test_environment\s*=\s*p\.test_environment/);
        expect(sql!).toMatch(/c\.scenario_name\s+IS\s+NOT\s+DISTINCT\s+FROM\s+p\.scenario_name/);
        expect(sql!).toMatch(/c\.sampler_name\s*=\s*p\.sampler_name/);
        expect(sql!).toMatch(/c\.transaction_name\s*=\s*p\.transaction_name/);
        expect(sql!).toMatch(/c\.location\s+IS\s+NOT\s+DISTINCT\s+FROM\s+p\.location/);
        // Threshold join uses the SUT UUID ($9), not name (cross-org safe).
        expect(sql!).toMatch(/wat\.system_under_test_id\s*=\s*ids\.sut_id/);
        expect(sql!).toMatch(/wtat\.system_under_test_id\s*=\s*ids\.sut_id/);
      });

      it('returns mapped rows with url_hash=null and url_pattern=null (CAGG limitation)', async () => {
        jest
          .spyOn(service as never, 'getRollupStatus')
          .mockResolvedValue({ status: 'unavailable' } as never);
        jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue(baseScope as never);
        (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
          if (isSetLocalWorkMem(sql)) return [];
          if (typeof sql === 'string' && /requests_raw_passed_5s/.test(sql)) {
            return [RAW_SAMPLER_CAGG_ROW];
          }
          return [];
        });

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(Array.isArray(result)).toBe(true);
        const rows = result as Array<Record<string, unknown>>;
        expect(rows[0]).toMatchObject({
          sampler_name: 's1',
          total_count: 100,
          passed_count: 95,
          failed_count: 5,
          apdex_score: 0.875,
          active_threshold: 500,
          url_hash: null,
          url_pattern: null,
        });
      });

      it('falls through to raw scan when requests_raw_passed CAGG is empty for the window', async () => {
        jest
          .spyOn(service as never, 'getRollupStatus')
          .mockResolvedValue({ status: 'unavailable' } as never);
        jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue({ ...baseScope, hasRequestsRawCagg: false } as never);
        // Live-agg path: rollup existence check + CAGG scope skip + samples query
        mockQuerySequence([RAW_SAMPLER_ROW]);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(Array.isArray(result)).toBe(true);
        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        // Confirm we did NOT issue the CAGG-specific JOIN query.
        const ranCagg = calls.some(([sql]: [unknown]) =>
          typeof sql === 'string' && /JOIN\s+requests_raw_passed_5s/.test(sql as string),
        );
        expect(ranCagg).toBe(false);
        // Confirm the raw-scan path ran (FROM requests_raw r).
        const ranRaw = calls.some(([sql]: [unknown]) =>
          typeof sql === 'string' && /FROM\s+requests_raw\s+r\b/.test(sql as string),
        );
        expect(ranRaw).toBe(true);
      });

      it('uses the CAGG path even when sinceMinutes is set (live window) and bypasses getRollupStatus', async () => {
        const getRollupStatusSpy = jest.spyOn(service as never, 'getRollupStatus');
        const loadCaggApdexScopeSpy = jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue(baseScope as never);
        const getTransactionSamplesFromCaggSpy = jest
          .spyOn(service as never, 'getTransactionSamplesFromCagg')
          .mockResolvedValue([] as never);

        const sinceMinutes = 5;
        const before = Date.now();
        await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, [], sinceMinutes);
        const after = Date.now();

        // getRollupStatus must NOT be called when sinceMinutes is set.
        expect(getRollupStatusSpy).not.toHaveBeenCalled();
        expect(loadCaggApdexScopeSpy).toHaveBeenCalled();
        // Adjusted scope: startTime = max(scope.startTime, NOW() - sinceMinutes*60_000).
        // baseScope.startTime is in 2026 (well in the past), so the live cutoff wins.
        expect(getTransactionSamplesFromCaggSpy).toHaveBeenCalledTimes(1);
        const passedScope = (getTransactionSamplesFromCaggSpy.mock.calls[0] as unknown[])[0] as {
          startTime: Date;
        };
        const liveCutoffMs = passedScope.startTime.getTime();
        expect(liveCutoffMs).toBeGreaterThanOrEqual(before - sinceMinutes * 60_000);
        expect(liveCutoffMs).toBeLessThanOrEqual(after - sinceMinutes * 60_000);
        // Transaction name is forwarded as the second argument.
        expect((getTransactionSamplesFromCaggSpy.mock.calls[0] as unknown[])[1]).toBe(TRANSACTION);
      });

      it("returns RollupPendingResult when rollup is 'rollup-pending' AND CAGG is empty", async () => {
        jest.spyOn(service as never, 'getRollupStatus').mockResolvedValue({
          status: 'rollup-pending',
          stage: 'transaction-stats-rollup',
          progress: { stageName: 'transaction-stats-rollup', stageIndex: 4, totalStages: 11 },
        } as never);
        jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue({ ...baseScope, hasRequestsRawCagg: false } as never);

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(isRollupPending(result)).toBe(true);
        expect(result).toMatchObject({
          stage: 'transaction-stats-rollup',
          progress: { stageIndex: 4, totalStages: 11 },
        });
      });

      it("prefers CAGG over RollupPendingResult when rollup is 'rollup-pending' AND CAGG has data", async () => {
        jest.spyOn(service as never, 'getRollupStatus').mockResolvedValue({
          status: 'rollup-pending',
          stage: 'transaction-stats-rollup',
          progress: { stageName: 'transaction-stats-rollup', stageIndex: 4, totalStages: 11 },
        } as never);
        jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue(baseScope as never);
        (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
          if (isSetLocalWorkMem(sql)) return [];
          if (typeof sql === 'string' && /requests_raw_passed_5s/.test(sql)) {
            return [RAW_SAMPLER_CAGG_ROW];
          }
          return [];
        });

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(isRollupPending(result)).toBe(false);
        expect(Array.isArray(result)).toBe(true);
        const rows = result as Array<Record<string, unknown>>;
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].sampler_name).toBe('s1');
      });

      it("uses CAGG when status='ready' AND hasSamplerRollup=false AND CAGG has data", async () => {
        // Existing fall-through: 'ready' rollup but no per-transaction sampler
        // row (e.g. unsampled high-cardinality sampler) used to skip straight
        // to live aggregation. Now it routes through CAGG when present.
        jest
          .spyOn(service as never, 'getRollupStatus')
          .mockResolvedValue({ status: 'ready' } as never);
        jest
          .spyOn(service as never, 'hasSamplerRollup')
          .mockResolvedValue(false as never);
        jest
          .spyOn(service as never, 'loadCaggApdexScope')
          .mockResolvedValue(baseScope as never);
        (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
          if (isSetLocalWorkMem(sql)) return [];
          if (typeof sql === 'string' && /requests_raw_passed_5s/.test(sql)) {
            return [RAW_SAMPLER_CAGG_ROW];
          }
          return [];
        });

        const result = await service.getTransactionSamples(TEST_RUN_ID, TRANSACTION, false, IS_ADMIN, []);

        expect(Array.isArray(result)).toBe(true);
        const rows = result as Array<Record<string, unknown>>;
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0]).toMatchObject({
          sampler_name: 's1',
          total_count: 100,
          apdex_score: 0.875,
          url_hash: null,
          url_pattern: null,
        });
      });
    });
  });

  // =========================================================================
  // getTransactionErrors
  // =========================================================================

  describe('getTransactionErrors', () => {
    describe('authorization', () => {
      it('returns empty array for non-admin with no org memberships', async () => {
        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, NOT_ADMIN, []);

        expect(result).toEqual([]);
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('queries database for admin with empty org list', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, IS_ADMIN, []);

        expect(result).toHaveLength(1);
      });

      it('queries database for non-admin with org memberships', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, NOT_ADMIN, ORG_IDS);

        expect(result).toHaveLength(1);
      });
    });

    describe('UUID resolution', () => {
      it('resolves UUID before querying', async () => {
        mockWithUuidResolution(TEST_RUN_ID, [RAW_ERROR_ROW]);

        const result = await service.getTransactionErrors(UUID, undefined, undefined, IS_ADMIN, []);

        expect(result).toHaveLength(1);
        const firstCall = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(firstCall[0]).toContain('SELECT test_run_id FROM test_runs WHERE id');
      });
    });

    /**
     * #287 routes the errors query through `hasAnySamplerRollup()` first, which
     * runs a `SELECT 1 FROM test_run_sampler_stats … LIMIT 1` existence check.
     * Tests that inspect the *main* query need to skip the existence-check call.
     */
    function getMainErrorsCall() {
      const calls = (testRunRepo.query as jest.Mock).mock.calls;
      const main = calls.find(
        (c) => typeof c[0] === 'string' && /WITH threshold_config AS/i.test(c[0]),
      );
      if (!main) {
        throw new Error('Main errors query was not issued');
      }
      return main;
    }

    describe('optional filters', () => {
      it('builds query without transaction or sampler filter', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, IS_ADMIN, []);

        const call = getMainErrorsCall();
        // Params should only contain testRunId (no extra filters)
        expect(call[1]).toEqual([TEST_RUN_ID]);
      });

      it('appends transaction filter param when transactionName provided', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, 'checkout', undefined, IS_ADMIN, []);

        const call = getMainErrorsCall();
        expect(call[1]).toContain('checkout');
        expect(call[1]).toHaveLength(2);
      });

      it('appends sampler filter param when samplerName provided', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, undefined, 'POST /checkout', IS_ADMIN, []);

        const call = getMainErrorsCall();
        expect(call[1]).toContain('POST /checkout');
        expect(call[1]).toHaveLength(2);
      });

      it('appends both transaction and sampler filter params', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, 'checkout', 'POST /checkout', IS_ADMIN, []);

        const call = getMainErrorsCall();
        expect(call[1]).toContain('checkout');
        expect(call[1]).toContain('POST /checkout');
        expect(call[1]).toHaveLength(3);
      });

      it('appends orgIds as last param for non-admin', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, 'checkout', undefined, NOT_ADMIN, ORG_IDS);

        const call = getMainErrorsCall();
        expect(call[1][call[1].length - 1]).toEqual(ORG_IDS);
      });
    });

    describe('SQL structure (query shape regressions)', () => {
      it('joins workload_apdex_thresholds on sut.id (no name OR id::text OR-join) without transactionName', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, IS_ADMIN, []);

        const call = getMainErrorsCall();
        expect(call[0]).toContain('wat.system_under_test_id = sut.id');
        expect(call[0]).not.toContain('sut.name OR');
        expect(call[0]).not.toContain('sut.id::text');
      });

      it('joins both threshold tables on sut.id when transactionName provided', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, 'checkout', undefined, IS_ADMIN, []);

        const call = getMainErrorsCall();
        expect(call[0]).toContain('wat.system_under_test_id = sut.id');
        expect(call[0]).toContain('wtat.system_under_test_id = sut.id');
        expect(call[0]).not.toContain('sut.name OR');
        expect(call[0]).not.toContain('sut.id::text');
      });

      it('uses test_run_sampler_stats rollup CTE when sampler stats are present (#287)', async () => {
        // Mock the rollup existence check to return a hit; then the main query
        // returns an empty result (we only care about the SQL shape here).
        (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
          if (typeof sql === 'string' && /SELECT 1 FROM test_run_sampler_stats/i.test(sql)) {
            return [{ '?column?': 1 }];
          }
          return [];
        });

        await service.getTransactionErrors(TEST_RUN_ID, 'checkout', undefined, IS_ADMIN, [], true);

        const call = getMainErrorsCall();
        expect(call[0]).toContain('FROM test_run_sampler_stats trss');
        expect(call[0]).toContain('rollup(trss.pct_agg)');
        expect(call[0]).toContain('approx_percentile_rank');
        // Legacy raw-scan path is gone when rollup is present.
        expect(call[0]).not.toContain('FROM requests_raw rr');
        // ramp_up_excluded must be threaded through so Apdex matches the
        // parent Performance Analysis card.
        expect(call[1]).toContain(true);
        // tc.active_threshold is referenced outside aggregates inside the
        // rollup CTE (as the percentile_rank target), so it must appear in
        // the GROUP BY alongside trss.sampler_name. Without it Postgres
        // raises 42803 ("must appear in the GROUP BY clause").
        expect(call[0]).toMatch(/GROUP BY\s+trss\.sampler_name,\s*tc\.active_threshold/);
      });

      it('falls back to the requests_raw scan when no sampler rollup exists', async () => {
        // Default mockQuerySequence makes the existence check return [] →
        // the legacy CTE wins.
        mockQuerySequence([RAW_ERROR_ROW]);

        await service.getTransactionErrors(TEST_RUN_ID, 'checkout', undefined, IS_ADMIN, []);

        const call = getMainErrorsCall();
        expect(call[0]).toContain('FROM requests_raw rr');
        expect(call[0]).not.toContain('rollup(trss.pct_agg)');
        // The CAGG JOIN must NOT be present when the scope lookup returns no
        // CAGG data (default mock behaviour).
        expect(call[0]).not.toMatch(/JOIN\s+requests_raw_passed_5s/);
      });

      // ---------------------------------------------------------------------
      // CAGG fast path (#304)
      // ---------------------------------------------------------------------

      describe('CAGG arm (#304)', () => {
        const baseScope = {
          sut: 'demo-sut',
          systemUnderTestId: 'sut-uuid-1',
          env: 'prod',
          workload: 'wl-1',
          startTime: new Date('2026-05-09T10:00:00Z'),
          endTime: new Date('2026-05-09T10:30:00Z'),
          cutoffTime: null,
          hasTransactionsCagg: true,
          hasRequestsRawCagg: true,
        };

        /**
         * The errors query goes through `loadCaggApdexScope` only when the
         * sampler rollup is empty. Stub the scope helper directly and route
         * the existence check through the same `query` mock as everything
         * else — that keeps the mock setup small and avoids depending on
         * the internal probe SQL.
         */
        function stubScope(scope: typeof baseScope | null) {
          jest.spyOn(service as never, 'loadCaggApdexScope').mockResolvedValue(scope as never);
        }

        it('uses requests_raw_5s + requests_raw_passed_5s CTE when CAGG scope is present', async () => {
          stubScope(baseScope);
          mockQuerySequence([RAW_ERROR_ROW]);

          await service.getTransactionErrors(
            TEST_RUN_ID, 'checkout', undefined, IS_ADMIN, [], true,
          );

          const call = getMainErrorsCall();
          expect(call[0]).toMatch(/FROM\s+requests_raw_5s\s+c/);
          expect(call[0]).toMatch(/JOIN\s+requests_raw_passed_5s\s+p/);
          // Apdex from the success-filtered sketch (post-#298).
          expect(call[0]).toMatch(/rollup\(p\.pct_agg_passed\)/);
          // 7-key JOIN matches the samples-from-CAGG path so duplicate rows
          // can't slip through.
          expect(call[0]).toMatch(/c\.bucket\s*=\s*p\.bucket/);
          expect(call[0]).toMatch(/c\.system_under_test\s*=\s*p\.system_under_test/);
          expect(call[0]).toMatch(/c\.test_environment\s*=\s*p\.test_environment/);
          expect(call[0]).toMatch(/c\.scenario_name\s+IS\s+NOT\s+DISTINCT\s+FROM\s+p\.scenario_name/);
          expect(call[0]).toMatch(/c\.sampler_name\s*=\s*p\.sampler_name/);
          expect(call[0]).toMatch(/c\.transaction_name\s*=\s*p\.transaction_name/);
          expect(call[0]).toMatch(/c\.location\s+IS\s+NOT\s+DISTINCT\s+FROM\s+p\.location/);
          // The legacy raw scan must be gone.
          expect(call[0]).not.toContain('FROM requests_raw rr');
          // tc.active_threshold is referenced outside aggregates — must appear
          // in GROUP BY or Postgres raises 42803.
          expect(call[0]).toMatch(/GROUP BY\s+c\.sampler_name,\s*tc\.active_threshold/);
          // Threshold join still uses sut.id in threshold_config (cross-org safe).
          expect(call[0]).toContain('wat.system_under_test_id = sut.id');
          // sut/env/start/end/excludeRampUp/cutoff params bound after the
          // optional transaction filter ($2).
          expect(call[1]).toContain('demo-sut');
          expect(call[1]).toContain('prod');
          expect(call[1]).toContain(true); // excludeRampUp
        });

        it('binds transaction filter against c.transaction_name in the CAGG arm', async () => {
          stubScope(baseScope);
          mockQuerySequence([RAW_ERROR_ROW]);

          await service.getTransactionErrors(TEST_RUN_ID, 'checkout', undefined, IS_ADMIN, []);

          const call = getMainErrorsCall();
          expect(call[0]).toMatch(/AND\s+c\.transaction_name\s*=\s*\$2/);
        });

        it('binds sampler filter against c.sampler_name in the CAGG arm', async () => {
          stubScope(baseScope);
          mockQuerySequence([RAW_ERROR_ROW]);

          await service.getTransactionErrors(
            TEST_RUN_ID, 'checkout', 'POST /checkout', IS_ADMIN, [],
          );

          const call = getMainErrorsCall();
          expect(call[0]).toMatch(/AND\s+c\.sampler_name\s*=\s*\$3/);
        });

        it('keeps the orgIds tail param at the end for non-admin callers', async () => {
          stubScope(baseScope);
          mockQuerySequence([RAW_ERROR_ROW]);

          await service.getTransactionErrors(
            TEST_RUN_ID, 'checkout', undefined, NOT_ADMIN, ORG_IDS,
          );

          const call = getMainErrorsCall();
          // orgIds remains the last param even though six CAGG params were
          // inserted before it.
          expect(call[1][call[1].length - 1]).toEqual(ORG_IDS);
          // Org filter clause references the correct ($N::uuid[]) slot.
          const orgIndex = call[1].length;
          expect(call[0]).toContain(`sut.organization_id = ANY($${orgIndex}::uuid[])`);
        });

        it('still wins over CAGG when a sampler rollup exists', async () => {
          // Rollup hit short-circuits before loadCaggApdexScope is even called.
          const scopeSpy = jest.spyOn(service as never, 'loadCaggApdexScope');
          (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
            if (typeof sql === 'string' && /SELECT 1 FROM test_run_sampler_stats/i.test(sql)) {
              return [{ '?column?': 1 }];
            }
            return [];
          });

          await service.getTransactionErrors(TEST_RUN_ID, 'checkout', undefined, IS_ADMIN, []);

          const call = getMainErrorsCall();
          expect(call[0]).toContain('FROM test_run_sampler_stats trss');
          expect(call[0]).not.toMatch(/JOIN\s+requests_raw_passed_5s/);
          expect(scopeSpy).not.toHaveBeenCalled();
        });

        it('falls through to legacy raw scan when CAGG scope reports no data', async () => {
          stubScope({ ...baseScope, hasRequestsRawCagg: false });
          mockQuerySequence([RAW_ERROR_ROW]);

          await service.getTransactionErrors(TEST_RUN_ID, 'checkout', undefined, IS_ADMIN, []);

          const call = getMainErrorsCall();
          expect(call[0]).toContain('FROM requests_raw rr');
          expect(call[0]).not.toMatch(/JOIN\s+requests_raw_passed_5s/);
        });
      });
    });

    describe('data mapping', () => {
      it('maps all fields correctly from raw row', async () => {
        mockQuerySequence([RAW_ERROR_ROW]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, IS_ADMIN, []);

        expect(result).toHaveLength(1);
        const row = result[0];
        expect(row.error_type).toBe('HTTP 500');
        expect(row.response_code).toBe('500');
        expect(row.response_message).toBe('Internal Server Error');
        expect(row.sampler_name).toBe('POST /checkout');
        // url should prefer sample_url
        expect(row.url).toBe('http://example.com/checkout?session=1');
        expect(row.url_hash).toBe('abc123');
        expect(row.url_pattern).toBe('/checkout');
        expect(row.count).toBe(10);
        expect(row.first_occurrence).toBe('2024-01-01T10:00:00Z');
        expect(row.last_occurrence).toBe('2024-01-01T11:00:00Z');
        expect(row.sample_response_data).toBe('{"error":"Internal Server Error"}');
        expect(row.total_requests).toBe(600);
        expect(row.apdex_score).toBe(0.85);
      });

      it('falls back to url field when sample_url is null', async () => {
        mockQuerySequence([{ ...RAW_ERROR_ROW, sample_url: null }]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, IS_ADMIN, []);

        expect(result[0].url).toBe('http://example.com/checkout');
      });

      it('maps null url_hash and url_pattern to null', async () => {
        mockQuerySequence([{ ...RAW_ERROR_ROW, url_hash: null, url_pattern: null }]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, IS_ADMIN, []);

        expect(result[0].url_hash).toBeNull();
        expect(result[0].url_pattern).toBeNull();
      });

      it('defaults null sample_response_data to empty string', async () => {
        mockQuerySequence([{ ...RAW_ERROR_ROW, sample_response_data: null }]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, IS_ADMIN, []);

        expect(result[0].sample_response_data).toBe('');
      });

      it('returns empty array when no errors found', async () => {
        mockQuerySequence([]);

        const result = await service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, IS_ADMIN, []);

        expect(result).toEqual([]);
      });
    });

    describe('error handling', () => {
      it('wraps DB error into DatabaseException', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('db error'));

        await expect(
          service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, IS_ADMIN, [])
        ).rejects.toThrow(DatabaseException);
      });

      it('wraps DB error with correct message', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

        await expect(
          service.getTransactionErrors(TEST_RUN_ID, undefined, undefined, IS_ADMIN, [])
        ).rejects.toThrow('Failed to retrieve transaction errors');
      });
    });
  });

  // =========================================================================
  // getVirtualUserStats
  // =========================================================================

  describe('getVirtualUserStats', () => {
    /**
     * getVirtualUserStats issues two parallel queries (overall + by_scenario)
     * via Promise.all. We configure the mock to return results in call order.
     */
    function mockVuQueries(overallRows: unknown[], scenarioRows: unknown[]) {
      let callCount = 0;
      (testRunRepo.query as jest.Mock).mockImplementation(async () => {
        if (callCount === 0) {
          callCount++;
          return overallRows;
        }
        callCount++;
        return scenarioRows;
      });
    }

    function mockVuQueriesWithRampUp(
      rampUpRow: unknown,
      overallRows: unknown[],
      scenarioRows: unknown[]
    ) {
      let callCount = 0;
      (testRunRepo.query as jest.Mock).mockImplementation(async () => {
        if (callCount === 0) {
          callCount++;
          return [rampUpRow];
        }
        if (callCount === 1) {
          callCount++;
          return overallRows;
        }
        callCount++;
        return scenarioRows;
      });
    }

    describe('authorization', () => {
      it('returns empty struct for non-admin with no org memberships', async () => {
        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, NOT_ADMIN, []);

        expect(result).toEqual({
          overall: {
            peak_active_threads: 0,
            avg_active_threads: 0,
            peak_started_threads: 0,
            avg_started_threads: 0,
            peak_finished_threads: 0,
            avg_finished_threads: 0,
            total_data_points: 0,
          },
          by_scenario: [],
        });
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('queries database for admin with empty org list', async () => {
        mockVuQueries([RAW_VU_OVERALL], [RAW_VU_SCENARIO]);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result.overall.peak_active_threads).toBe(100);
        expect(result.by_scenario).toHaveLength(1);
      });

      it('queries database for non-admin with org memberships', async () => {
        mockVuQueries([RAW_VU_OVERALL], []);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, NOT_ADMIN, ORG_IDS);

        expect(result.overall.peak_active_threads).toBe(100);
      });
    });

    describe('UUID resolution', () => {
      it('resolves UUID before querying', async () => {
        // UUID lookup + ramp-up + 2 parallel queries
        let callCount = 0;
        (testRunRepo.query as jest.Mock).mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return [{ test_run_id: TEST_RUN_ID }]; // UUID lookup
          if (callCount === 2) return [RAW_VU_OVERALL]; // overall
          return [RAW_VU_SCENARIO]; // by_scenario
        });

        const result = await service.getVirtualUserStats(UUID, false, IS_ADMIN, []);

        expect(result.overall.peak_active_threads).toBe(100);
        const firstCall = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(firstCall[0]).toContain('WHERE id = $1');
      });
    });

    describe('ramp-up exclusion', () => {
      it('fetches cutoff time when excludeRampUp is true', async () => {
        const startTime = new Date('2024-01-01T10:00:00Z');
        mockVuQueriesWithRampUp(
          { start_time: startTime.toISOString(), ramp_up: '300' },
          [RAW_VU_OVERALL],
          [RAW_VU_SCENARIO],
        );

        await service.getVirtualUserStats(TEST_RUN_ID, true, IS_ADMIN, []);

        // 3 calls: ramp-up + 2 parallel VU queries
        expect(testRunRepo.query).toHaveBeenCalledTimes(3);
      });
    });

    describe('data mapping', () => {
      it('maps overall stats correctly', async () => {
        mockVuQueries([RAW_VU_OVERALL], []);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, IS_ADMIN, []);

        const o = result.overall;
        expect(o.peak_active_threads).toBe(100);
        expect(o.avg_active_threads).toBe(75.5);
        expect(o.peak_started_threads).toBe(100);
        expect(o.avg_started_threads).toBe(80);
        expect(o.peak_finished_threads).toBe(99);
        expect(o.avg_finished_threads).toBe(74);
        expect(o.total_data_points).toBe(360);
      });

      it('maps by_scenario stats correctly', async () => {
        mockVuQueries([RAW_VU_OVERALL], [RAW_VU_SCENARIO]);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result.by_scenario).toHaveLength(1);
        const s = result.by_scenario[0];
        expect(s.scenario_name).toBe('checkout_flow');
        expect(s.peak_active_threads).toBe(50);
        expect(s.avg_active_threads).toBe(40);
        expect(s.total_data_points).toBe(180);
      });

      it('returns zero-filled overall when DB returns empty result', async () => {
        mockVuQueries([], []);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result.overall.peak_active_threads).toBe(0);
        expect(result.overall.total_data_points).toBe(0);
      });

      it('returns empty by_scenario array when no scenarios', async () => {
        mockVuQueries([RAW_VU_OVERALL], []);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result.by_scenario).toEqual([]);
      });

      it('defaults null numeric fields to 0 in overall', async () => {
        mockVuQueries([{
          ...RAW_VU_OVERALL,
          peak_active_threads: null,
          avg_active_threads: null,
        }], []);

        const result = await service.getVirtualUserStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result.overall.peak_active_threads).toBe(0);
        expect(result.overall.avg_active_threads).toBe(0);
      });
    });

    describe('error handling', () => {
      it('wraps DB error into DatabaseException', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('db error'));

        await expect(
          service.getVirtualUserStats(TEST_RUN_ID, false, IS_ADMIN, [])
        ).rejects.toThrow(DatabaseException);
      });

      it('wraps DB error with correct message', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

        await expect(
          service.getVirtualUserStats(TEST_RUN_ID, false, IS_ADMIN, [])
        ).rejects.toThrow('Failed to retrieve virtual user statistics');
      });
    });
  });

  // =========================================================================
  // getThroughputStats
  // =========================================================================

  describe('getThroughputStats', () => {
    /**
     * Sample run-info rows used by the new single-round-trip lookup
     * (`loadThroughputRunInfo`). The lookup returns the SUT name + test
     * environment (the CAGG keying), the run window, and a `has_cagg` flag
     * derived from EXISTS probes against `transactions_5s` / `requests_raw_5s`.
     * See issue #288.
     */
    const RUN_INFO_CAGG = {
      sut: 'webshop',
      env: 'acc',
      start_time: '2024-01-01T10:00:00Z',
      end_time: '2024-01-01T10:30:00Z',
      ramp_up: null,
      has_cagg: true,
    };
    const RUN_INFO_NO_CAGG = { ...RUN_INFO_CAGG, has_cagg: false };

    /** SQL fragment that identifies the run-info / CAGG-existence lookup. */
    const isRunInfoLookup = (sql: unknown): boolean =>
      typeof sql === 'string' && /sut\.name\s+AS\s+sut[\s\S]*has_cagg/i.test(sql);

    /**
     * Mock the throughput call sequence. The service issues:
     *   1) run-info lookup (returns sut/env/start/end/ramp_up + has_cagg)
     *   2..4) three parallel queries (transactions, requests, scenarios) — same
     *         shape regardless of CAGG-vs-raw path, the mock doesn't care which
     *         SQL was issued, only their result rows.
     *
     * Pass `runInfoRow = null` to simulate a missing/inaccessible run.
     */
    function mockThroughputCalls(
      runInfoRow: unknown | null,
      transactionRows: unknown[],
      requestRows: unknown[],
      scenarioRows: unknown[],
    ) {
      let parallelIdx = 0;
      const parallel = [transactionRows, requestRows, scenarioRows];
      (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
        if (isRunInfoLookup(sql)) {
          return runInfoRow === null ? [] : [runInfoRow];
        }
        const r = parallel[parallelIdx] ?? [];
        parallelIdx++;
        return r;
      });
    }

    describe('authorization', () => {
      it('returns empty struct for non-admin with no org memberships', async () => {
        const result = await service.getThroughputStats(TEST_RUN_ID, false, NOT_ADMIN, []);

        expect(result).toEqual({
          overall: {
            peak_transactions_per_second: 0,
            peak_requests_per_second: 0,
          },
          by_scenario: [],
        });
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('queries database for admin with empty org list', async () => {
        mockThroughputCalls(
          RUN_INFO_CAGG,
          [RAW_TRANSACTIONS_TPS],
          [RAW_REQUESTS_RPS],
          [RAW_SCENARIO_THROUGHPUT],
        );

        const result = await service.getThroughputStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result.overall.peak_transactions_per_second).toBe(120);
        expect(result.overall.peak_requests_per_second).toBe(350);
        expect(result.by_scenario).toHaveLength(1);
      });

      it('queries database for non-admin with org memberships', async () => {
        mockThroughputCalls(RUN_INFO_CAGG, [RAW_TRANSACTIONS_TPS], [RAW_REQUESTS_RPS], []);

        const result = await service.getThroughputStats(TEST_RUN_ID, false, NOT_ADMIN, ORG_IDS);

        expect(result.overall.peak_transactions_per_second).toBe(120);
      });

      it('threads organizationIds into the run-info lookup for non-admins', async () => {
        mockThroughputCalls(RUN_INFO_CAGG, [], [], []);

        await service.getThroughputStats(TEST_RUN_ID, false, NOT_ADMIN, ORG_IDS);

        const lookupCall = (testRunRepo.query as jest.Mock).mock.calls.find(
          (c: unknown[]) => isRunInfoLookup(c[0]),
        );
        expect(lookupCall).toBeDefined();
        expect(lookupCall![0]).toContain('AND sut.organization_id = ANY($2::uuid[])');
        expect(lookupCall![1]).toEqual([TEST_RUN_ID, ORG_IDS]);
      });

      it('returns empty struct when run is inaccessible (org filter excludes it)', async () => {
        mockThroughputCalls(null, [], [], []);

        const result = await service.getThroughputStats(TEST_RUN_ID, false, NOT_ADMIN, ORG_IDS);

        expect(result).toEqual({
          overall: { peak_transactions_per_second: 0, peak_requests_per_second: 0 },
          by_scenario: [],
        });
        // Only the run-info lookup ran; the parallel queries were skipped.
        expect(testRunRepo.query).toHaveBeenCalledTimes(1);
      });
    });

    describe('UUID resolution', () => {
      it('resolves UUID before querying', async () => {
        let callCount = 0;
        (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
          callCount++;
          if (callCount === 1) return [{ test_run_id: TEST_RUN_ID }]; // UUID lookup
          if (isRunInfoLookup(sql)) return [RUN_INFO_CAGG];
          if (callCount === 3) return [RAW_TRANSACTIONS_TPS];
          if (callCount === 4) return [RAW_REQUESTS_RPS];
          return [RAW_SCENARIO_THROUGHPUT];
        });

        await service.getThroughputStats(UUID, false, IS_ADMIN, []);

        const firstCall = (testRunRepo.query as jest.Mock).mock.calls[0];
        expect(firstCall[0]).toContain('WHERE id = $1');
      });
    });

    describe('CAGG fast path (issue #288)', () => {
      it('reads from transactions_5s / requests_raw_5s when has_cagg is true', async () => {
        mockThroughputCalls(
          RUN_INFO_CAGG,
          [RAW_TRANSACTIONS_TPS],
          [RAW_REQUESTS_RPS],
          [RAW_SCENARIO_THROUGHPUT],
        );

        await service.getThroughputStats(TEST_RUN_ID, false, IS_ADMIN, []);

        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        const dataCalls = calls.filter((c: unknown[]) => !isRunInfoLookup(c[0]));
        const allSql = dataCalls.map((c: unknown[]) => c[0] as string).join('\n');
        expect(allSql).toContain('FROM transactions_5s c');
        expect(allSql).toContain('FROM requests_raw_5s c');
        // The legacy raw-scan path must not run alongside the CAGG path.
        expect(allSql).not.toMatch(/FROM\s+transactions\s+t\b/);
        expect(allSql).not.toMatch(/FROM\s+requests_raw\s+rr\b/);
      });

      it('passes (sut, env, start, end, excludeRampUp, cutoff) to the CAGG queries', async () => {
        mockThroughputCalls(RUN_INFO_CAGG, [], [], []);

        await service.getThroughputStats(TEST_RUN_ID, false, IS_ADMIN, []);

        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        const dataCalls = calls.filter((c: unknown[]) => !isRunInfoLookup(c[0]));
        // 3 parallel queries, all share the same param tuple.
        expect(dataCalls).toHaveLength(3);
        for (const c of dataCalls) {
          const params = c[1] as unknown[];
          expect(params[0]).toBe('webshop');                 // sut
          expect(params[1]).toBe('acc');                     // env
          expect(params[2]).toEqual(new Date(RUN_INFO_CAGG.start_time));
          expect(params[3]).toEqual(new Date(RUN_INFO_CAGG.end_time));
          expect(params[4]).toBe(false);                     // excludeRampUp
          expect(params[5]).toBeNull();                      // cutoffTime
        }
      });

      it('threads ramp-up cutoff into the CAGG queries when excludeRampUp is true', async () => {
        const runInfo = {
          ...RUN_INFO_CAGG,
          start_time: '2024-01-01T10:00:00Z',
          ramp_up: '600',
        };
        mockThroughputCalls(runInfo, [], [], []);

        await service.getThroughputStats(TEST_RUN_ID, true, IS_ADMIN, []);

        const dataCall = (testRunRepo.query as jest.Mock).mock.calls
          .find((c: unknown[]) => !isRunInfoLookup(c[0]));
        const params = dataCall![1] as unknown[];
        expect(params[4]).toBe(true);                                          // excludeRampUp
        expect(params[5]).toEqual(new Date('2024-01-01T10:10:00Z'));           // start + 600s
      });
    });

    describe('raw-scan fallback (CAGG empty / in-flight runs)', () => {
      it('reads from raw transactions / requests_raw when has_cagg is false', async () => {
        mockThroughputCalls(
          RUN_INFO_NO_CAGG,
          [RAW_TRANSACTIONS_TPS],
          [RAW_REQUESTS_RPS],
          [],
        );

        await service.getThroughputStats(TEST_RUN_ID, false, IS_ADMIN, []);

        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        const dataCalls = calls.filter((c: unknown[]) => !isRunInfoLookup(c[0]));
        const allSql = dataCalls.map((c: unknown[]) => c[0] as string).join('\n');
        expect(allSql).toMatch(/FROM\s+transactions\s+t\b/);
        expect(allSql).toMatch(/FROM\s+requests_raw\s+rr\b/);
        // CAGGs must NOT be queried when the existence check came back false.
        expect(allSql).not.toContain('FROM transactions_5s c');
        expect(allSql).not.toContain('FROM requests_raw_5s c');
      });
    });

    describe('data mapping', () => {
      it('maps overall throughput correctly', async () => {
        mockThroughputCalls(RUN_INFO_CAGG, [RAW_TRANSACTIONS_TPS], [RAW_REQUESTS_RPS], []);

        const result = await service.getThroughputStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result.overall.peak_transactions_per_second).toBe(120);
        expect(result.overall.peak_requests_per_second).toBe(350);
      });

      it('maps by_scenario throughput correctly', async () => {
        mockThroughputCalls(
          RUN_INFO_CAGG,
          [RAW_TRANSACTIONS_TPS],
          [RAW_REQUESTS_RPS],
          [RAW_SCENARIO_THROUGHPUT],
        );

        const result = await service.getThroughputStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result.by_scenario).toHaveLength(1);
        const s = result.by_scenario[0];
        expect(s.scenario_name).toBe('checkout_flow');
        expect(s.peak_transactions_per_second).toBe(60);
        expect(s.peak_requests_per_second).toBe(175);
      });

      it('returns zero overall when DB returns empty result', async () => {
        mockThroughputCalls(RUN_INFO_CAGG, [], [], []);

        const result = await service.getThroughputStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result.overall.peak_transactions_per_second).toBe(0);
        expect(result.overall.peak_requests_per_second).toBe(0);
      });

      it('returns empty by_scenario array when no scenarios', async () => {
        mockThroughputCalls(RUN_INFO_CAGG, [RAW_TRANSACTIONS_TPS], [RAW_REQUESTS_RPS], []);

        const result = await service.getThroughputStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result.by_scenario).toEqual([]);
      });

      it('defaults null peak_transactions_per_second to 0', async () => {
        mockThroughputCalls(
          RUN_INFO_CAGG,
          [{ peak_transactions_per_second: null }],
          [{ peak_requests_per_second: null }],
          [],
        );

        const result = await service.getThroughputStats(TEST_RUN_ID, false, IS_ADMIN, []);

        expect(result.overall.peak_transactions_per_second).toBe(0);
        expect(result.overall.peak_requests_per_second).toBe(0);
      });
    });

    describe('error handling', () => {
      it('wraps DB error into DatabaseException', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('db error'));

        await expect(
          service.getThroughputStats(TEST_RUN_ID, false, IS_ADMIN, [])
        ).rejects.toThrow(DatabaseException);
      });

      it('wraps DB error with correct message', async () => {
        (testRunRepo.query as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

        await expect(
          service.getThroughputStats(TEST_RUN_ID, false, IS_ADMIN, [])
        ).rejects.toThrow('Failed to retrieve throughput statistics');
      });
    });
  });

  // =========================================================================
  // Cross-cutting: mapper integration
  // =========================================================================

  describe('mapper integration', () => {
    it('uses mapper.parseFloat for floating-point response time fields', async () => {
      const parseFloatSpy = jest.spyOn(mapper, 'parseFloat');
      mockQuerySequence([RAW_TRANSACTION_ROW]);

      await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

      // parseFloat called for avg, p95, p99, ranking, apdex_score
      expect(parseFloatSpy).toHaveBeenCalledTimes(5);
    });

    it('uses mapper.parseInt for integer count fields', async () => {
      const parseIntSpy = jest.spyOn(mapper, 'parseInt');
      mockQuerySequence([RAW_TRANSACTION_ROW]);

      await service.getTransactionStats(TEST_RUN_ID, false, IS_ADMIN, []);

      // parseInt called for total_count, passed_count, failed_count, active_threshold
      expect(parseIntSpy).toHaveBeenCalledTimes(4);
    });
  });

  // =========================================================================
  // getRollupStatus (private helper used by the Apdex rollup-pending gate)
  // =========================================================================

  describe('getRollupStatus', () => {
    it('returns "ready" when test_run_transaction_stats has rows for the run', async () => {
      (testRunRepo.query as jest.Mock).mockImplementation(async (sql: string) => {
        if (sql.includes('FROM test_run_transaction_stats')) return [{ '?column?': 1 }];
        throw new Error(`unexpected sql: ${sql}`);
      });

      const result = await (service as unknown as {
        getRollupStatus: (id: string, isAdmin: boolean, orgs: string[]) => Promise<{ status: string }>;
      }).getRollupStatus('test-run-1', true, []);
      expect(result.status).toBe('ready');
    });

    it('returns "rollup-pending" when rollup empty AND an active job exists for the scope', async () => {
      (testRunRepo.query as jest.Mock).mockImplementation(async (sql: string) => {
        if (sql.includes('FROM test_run_transaction_stats')) return [];
        if (sql.includes('FROM test_runs')) {
          return [{
            system_under_test_id: 'sut-1',
            test_environment: 'prod',
            workload: 'wl-1',
          }];
        }
        throw new Error(`unexpected sql: ${sql}`);
      });
      mockJobProgressService.getActiveJobForScope.mockResolvedValue({
        jobId: 'job-1',
        stageName: 'transaction-stats-rollup',
        stageIndex: 4,
        totalStages: 11,
      });

      const result = await (service as unknown as {
        getRollupStatus: (id: string, isAdmin: boolean, orgs: string[]) => Promise<{
          status: string;
          stage?: string;
          progress?: { stageName: string; stageIndex: number; totalStages: number };
        }>;
      }).getRollupStatus('test-run-1', true, []);
      expect(result.status).toBe('rollup-pending');
      expect(result.progress).toEqual({
        stageName: 'transaction-stats-rollup',
        stageIndex: 4,
        totalStages: 11,
      });
    });

    it('returns "unavailable" when rollup empty AND no active job (soft-failure)', async () => {
      (testRunRepo.query as jest.Mock).mockImplementation(async (sql: string) => {
        if (sql.includes('FROM test_run_transaction_stats')) return [];
        if (sql.includes('FROM test_runs')) {
          return [{ system_under_test_id: 'sut-1', test_environment: 'prod', workload: 'wl-1' }];
        }
        throw new Error(`unexpected sql: ${sql}`);
      });
      mockJobProgressService.getActiveJobForScope.mockResolvedValue(null);

      const result = await (service as unknown as {
        getRollupStatus: (id: string, isAdmin: boolean, orgs: string[]) => Promise<{ status: string }>;
      }).getRollupStatus('test-run-1', true, []);
      expect(result.status).toBe('unavailable');
    });

    it('returns "unavailable" when scope lookup fails (defensive)', async () => {
      (testRunRepo.query as jest.Mock).mockImplementation(async (sql: string) => {
        if (sql.includes('FROM test_run_transaction_stats')) return [];
        if (sql.includes('FROM test_runs')) return [];
        throw new Error(`unexpected sql: ${sql}`);
      });

      const result = await (service as unknown as {
        getRollupStatus: (id: string, isAdmin: boolean, orgs: string[]) => Promise<{ status: string }>;
      }).getRollupStatus('test-run-1', true, []);
      expect(result.status).toBe('unavailable');
      expect(mockJobProgressService.getActiveJobForScope).not.toHaveBeenCalled();
    });

    it('returns "unavailable" when run exists but caller has no org membership (cross-tenant guard)', async () => {
      (testRunRepo.query as jest.Mock).mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM test_run_transaction_stats')) return [];
        if (sql.includes('FROM test_runs tr') && sql.includes('JOIN systems_under_test sut')) {
          // Filter by org should produce 0 rows for a non-admin without membership
          const orgs = params[1] as string[];
          if (Array.isArray(orgs) && orgs.length === 0) return [];
          // (Other cases — admin or matching org — would return scope; not exercised in this test.)
          return [];
        }
        throw new Error(`unexpected sql: ${sql}`);
      });

      const result = await (service as unknown as {
        getRollupStatus: (id: string, isAdmin: boolean, orgs: string[]) => Promise<{ status: string }>;
      }).getRollupStatus('test-run-1', false, []);
      expect(result.status).toBe('unavailable');
      // Critically: the active-job lookup should NOT have been called, because
      // we never resolved a scope to look up by.
      expect(mockJobProgressService.getActiveJobForScope).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // loadCaggApdexScope (private helper for the live-Apdex CAGG fast path)
  // =========================================================================

  describe('loadCaggApdexScope', () => {
    type LoadCaggApdexScopeFn = (
      testRunId: string,
      excludeRampUp: boolean,
      isAdmin: boolean,
      orgs: string[],
    ) => Promise<{
      sut: string;
      systemUnderTestId: string;
      env: string;
      workload: string | null;
      startTime: Date;
      endTime: Date;
      cutoffTime: Date | null;
      hasTransactionsCagg: boolean;
      hasRequestsRawCagg: boolean;
    } | null>;

    const callHelper = (
      testRunId: string,
      excludeRampUp: boolean,
      isAdmin: boolean,
      orgs: string[],
    ) =>
      (service as unknown as { loadCaggApdexScope: LoadCaggApdexScopeFn }).loadCaggApdexScope(
        testRunId,
        excludeRampUp,
        isAdmin,
        orgs,
      );

    it('returns scope + workload + has-cagg flags when the run exists and CAGGs are populated', async () => {
      (testRunRepo.query as jest.Mock).mockResolvedValueOnce([
        {
          sut: 'webshop',
          system_under_test_id: 'sut-uuid-1',
          env: 'acc',
          workload: 'loadTest',
          start_time: '2024-01-01T10:00:00Z',
          end_time: '2024-01-01T10:30:00Z',
          ramp_up: '60',
          has_transactions_cagg: true,
          has_requests_raw_cagg: true,
        },
      ]);

      const scope = await callHelper(TEST_RUN_ID, true, IS_ADMIN, []);

      expect(scope).not.toBeNull();
      expect(scope!.sut).toBe('webshop');
      expect(scope!.systemUnderTestId).toBe('sut-uuid-1');
      expect(scope!.env).toBe('acc');
      expect(scope!.workload).toBe('loadTest');
      expect(scope!.startTime).toEqual(new Date('2024-01-01T10:00:00Z'));
      expect(scope!.endTime).toEqual(new Date('2024-01-01T10:30:00Z'));
      // ramp_up = 60s + excludeRampUp=true → cutoffTime = startTime + 60_000ms
      expect(scope!.cutoffTime).toEqual(new Date('2024-01-01T10:01:00Z'));
      expect(scope!.hasTransactionsCagg).toBe(true);
      expect(scope!.hasRequestsRawCagg).toBe(true);
    });

    it('returns null when the run does not exist or the org filter excludes the user', async () => {
      (testRunRepo.query as jest.Mock).mockResolvedValueOnce([]);

      const scope = await callHelper(TEST_RUN_ID, false, NOT_ADMIN, ['org-1']);

      expect(scope).toBeNull();
    });

    it('reports has-cagg flags as false when the CAGG has no rows', async () => {
      (testRunRepo.query as jest.Mock).mockResolvedValueOnce([
        {
          sut: 'webshop',
          system_under_test_id: 'sut-uuid-1',
          env: 'acc',
          workload: null,
          start_time: '2024-01-01T10:00:00Z',
          end_time: '2024-01-01T10:30:00Z',
          ramp_up: null,
          has_transactions_cagg: false,
          has_requests_raw_cagg: false,
        },
      ]);

      const scope = await callHelper(TEST_RUN_ID, true, IS_ADMIN, []);

      expect(scope).not.toBeNull();
      expect(scope!.hasTransactionsCagg).toBe(false);
      expect(scope!.hasRequestsRawCagg).toBe(false);
      expect(scope!.cutoffTime).toBeNull();
      expect(scope!.workload).toBeNull();
    });

    it('passes organizationIds for non-admin and applies the org filter clause', async () => {
      (testRunRepo.query as jest.Mock).mockResolvedValueOnce([]);

      await callHelper(TEST_RUN_ID, false, NOT_ADMIN, ['org-1']);

      const call = (testRunRepo.query as jest.Mock).mock.calls[0];
      expect(call[0]).toMatch(/sut\.organization_id\s*=\s*ANY\(\$2::uuid\[\]\)/);
      expect(call[1]).toEqual([TEST_RUN_ID, ['org-1']]);
    });
  });

  // =========================================================================
  // getSummaryTimeseries
  // =========================================================================

  describe('getSummaryTimeseries', () => {
    it('returns null when no transactions exist', async () => {
      // Arrange: first call resolves test run (start_time + duration), second returns empty bucket data
      (testRunRepo.query as jest.Mock)
        .mockResolvedValueOnce([{ start_time: '2024-01-01T10:00:00Z', duration: 1800 }])
        .mockResolvedValueOnce([]);

      // Act
      const result = await service.getSummaryTimeseries(TEST_RUN_ID);

      // Assert
      expect(result).toBeNull();
    });

    it('returns null when test run not found', async () => {
      // Arrange: first call returns empty (no test run)
      (testRunRepo.query as jest.Mock).mockResolvedValueOnce([]);

      // Act
      const result = await service.getSummaryTimeseries(TEST_RUN_ID);

      // Assert
      expect(result).toBeNull();
    });

    it('returns buckets with throughput, avgResponseTime, errorsPerSecond when data exists', async () => {
      // Arrange
      const duration = 600; // 10 minutes
      const bucketSize = Math.max(5, Math.min(60, Math.round(duration / 100))); // = 6

      (testRunRepo.query as jest.Mock)
        .mockResolvedValueOnce([{ start_time: '2024-01-01T10:00:00Z', duration }])
        .mockResolvedValueOnce([
          { time_seconds: '0', throughput: '25.5', avg_response_time: '120.3', errors_per_second: '0.5' },
          { time_seconds: '6', throughput: '30.2', avg_response_time: '110.0', errors_per_second: '0' },
        ]);

      // Act
      const result = await service.getSummaryTimeseries(TEST_RUN_ID);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.duration).toBe(duration);
      expect(result!.bucketSizeSeconds).toBe(bucketSize);
      expect(result!.buckets).toHaveLength(2);
      expect(result!.buckets[0]).toMatchObject({
        timeSeconds: 0,
        throughput: 25.5,
        avgResponseTime: 120.3,
        errorsPerSecond: 0.5,
      });
      expect(result!.buckets[1]).toMatchObject({
        timeSeconds: 6,
        throughput: 30.2,
        avgResponseTime: 110.0,
        errorsPerSecond: 0,
      });
    });

    it('resolves UUID to test_run_id before querying', async () => {
      // Arrange: UUID → test_run_id lookup, then test run meta, then empty buckets
      (testRunRepo.query as jest.Mock)
        .mockResolvedValueOnce([{ test_run_id: TEST_RUN_ID }])
        .mockResolvedValueOnce([{ start_time: '2024-01-01T10:00:00Z', duration: 300 }])
        .mockResolvedValueOnce([]);

      // Act
      const result = await service.getSummaryTimeseries(UUID);

      // Assert: UUID lookup was first call
      const firstCall = (testRunRepo.query as jest.Mock).mock.calls[0];
      expect(firstCall[0]).toContain('SELECT test_run_id FROM test_runs WHERE id');
      expect(firstCall[1]).toEqual([UUID]);
      expect(result).toBeNull(); // no buckets → null
    });
  });

  // =========================================================================
  // getAggregatedMetricTimeseries
  // =========================================================================

  describe('getAggregatedMetricTimeseries', () => {
    /**
     * Helper: configure the mock for getAggregatedMetricTimeseries calls.
     *
     * Call sequence (non-UUID path):
     *   1. resolveTestRunId → plain test_run_id string, so NO UUID lookup issued
     *   2. getAnalysisBounds → query for start_time, ramp_up, end_time, ramp_down
     *      (only when applyAnalysisWindow=true; returns early with nulls otherwise)
     *   3. Bucket data query  → the actual metric query (uses date_trunc, not time_bucket)
     */
    function mockAggTimeseries(
      opts: {
        applyAnalysisWindow?: boolean;
        bucketRows?: Array<{ time: string; value: string | null }>;
      } = {},
    ) {
      const { applyAnalysisWindow = false, bucketRows = [] } = opts;
      let callIdx = 0;
      (testRunRepo.query as jest.Mock).mockImplementation(async (sql: unknown) => {
        // Skip SET LOCAL preludes (shouldn't appear here, but guard defensively)
        if (isSetLocalWorkMem(sql)) return [];

        // resolveTestRunId: plain test_run_id → skipped (no UUID lookup)
        // getAnalysisBounds query — only issued when applyAnalysisWindow=true
        if (
          applyAnalysisWindow &&
          callIdx === 0 &&
          typeof sql === 'string' &&
          /ramp_up.*ramp_down|ramp_down.*ramp_up/i.test(sql)
        ) {
          callIdx++;
          return [{ start_time: '2024-01-01T10:00:00Z', ramp_up: 60, end_time: '2024-01-01T10:10:00Z', ramp_down: 0 }];
        }

        // Bucket data query (everything else)
        return bucketRows;
      });
    }

    describe('authorization', () => {
      it('returns empty buckets when non-admin with empty orgIds (no DB hit)', async () => {
        // Arrange — no mock needed; method should return early
        // Act
        const result = await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'transaction_response_time',
          'p95',
          false,
          NOT_ADMIN,
          [],
        );

        // Assert
        expect(result.buckets).toHaveLength(0);
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('queries DB for admin even with empty orgIds', async () => {
        // Arrange
        mockAggTimeseries({ bucketRows: [{ time: '2024-01-01T10:01:00Z', value: '120' }] });

        // Act
        const result = await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'transaction_response_time',
          'avg',
          false,
          IS_ADMIN,
          [],
        );

        // Assert
        expect(testRunRepo.query).toHaveBeenCalled();
        expect(result.buckets).toHaveLength(1);
      });

      it('includes org filter clause in SQL for non-admin with org memberships', async () => {
        // Arrange
        mockAggTimeseries({ bucketRows: [{ time: '2024-01-01T10:01:00Z', value: '150' }] });

        // Act
        await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'transaction_response_time',
          'avg',
          false,
          NOT_ADMIN,
          ORG_IDS,
        );

        // Assert: the bucket query contains an org filter
        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        const bucketCall = calls.find(([sql]: [unknown]) =>
          typeof sql === 'string' && /date_trunc/i.test(sql),
        );
        expect(bucketCall).toBeDefined();
        expect(bucketCall[0]).toMatch(/organization_id\s*=\s*ANY\(/i);
      });

      it('omits org filter clause from SQL for admin', async () => {
        // Arrange
        mockAggTimeseries({ bucketRows: [{ time: '2024-01-01T10:01:00Z', value: '150' }] });

        // Act
        await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'transaction_response_time',
          'avg',
          false,
          IS_ADMIN,
          [],
        );

        // Assert: the bucket query does NOT contain an org filter
        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        const bucketCall = calls.find(([sql]: [unknown]) =>
          typeof sql === 'string' && /date_trunc/i.test(sql),
        );
        expect(bucketCall).toBeDefined();
        expect(bucketCall[0]).not.toMatch(/organization_id\s*=\s*ANY\(/i);
      });
    });

    describe('metric variants', () => {
      it('queries transactions table for transaction_response_time', async () => {
        // Arrange
        mockAggTimeseries({ bucketRows: [] });

        // Act
        await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'transaction_response_time',
          'p95',
          false,
          IS_ADMIN,
          [],
        );

        // Assert: query targets transactions table
        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        const bucketCall = calls.find(([sql]: [unknown]) =>
          typeof sql === 'string' && /date_trunc/i.test(sql),
        );
        expect(bucketCall[0]).toMatch(/FROM\s+transactions/i);
      });

      it('queries requests_raw table for request_response_time', async () => {
        // Arrange
        mockAggTimeseries({ bucketRows: [] });

        // Act
        await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'request_response_time',
          'avg',
          false,
          IS_ADMIN,
          [],
        );

        // Assert: query targets requests_raw table
        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        const bucketCall = calls.find(([sql]: [unknown]) =>
          typeof sql === 'string' && /date_trunc/i.test(sql),
        );
        expect(bucketCall[0]).toMatch(/FROM\s+requests_raw/i);
      });

      it('queries requests_raw table and computes error ratio for error_percentage', async () => {
        // Arrange
        mockAggTimeseries({
          bucketRows: [{ time: '2024-01-01T10:01:00Z', value: '5.5' }],
        });

        // Act
        const result = await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'error_percentage',
          'avg', // stat is irrelevant for error_percentage
          false,
          IS_ADMIN,
          [],
        );

        // Assert: query targets requests_raw and computes error ratio
        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        const bucketCall = calls.find(([sql]: [unknown]) =>
          typeof sql === 'string' && /date_trunc/i.test(sql),
        );
        expect(bucketCall[0]).toMatch(/FROM\s+requests_raw/i);
        expect(bucketCall[0]).toMatch(/success/i);
        expect(result.buckets[0].value).toBe(5.5);
      });
    });

    describe('stat variants', () => {
      it('uses approx_percentile(0.95) for p95 stat on transaction_response_time', async () => {
        // Arrange
        mockAggTimeseries({ bucketRows: [] });

        // Act
        await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'transaction_response_time',
          'p95',
          false,
          IS_ADMIN,
          [],
        );

        // Assert
        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        const bucketCall = calls.find(([sql]: [unknown]) =>
          typeof sql === 'string' && /date_trunc/i.test(sql),
        );
        expect(bucketCall[0]).toContain('approx_percentile(0.95,');
      });

      it('uses AVG() for avg stat on request_response_time', async () => {
        // Arrange
        mockAggTimeseries({ bucketRows: [] });

        // Act
        await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'request_response_time',
          'avg',
          false,
          IS_ADMIN,
          [],
        );

        // Assert
        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        const bucketCall = calls.find(([sql]: [unknown]) =>
          typeof sql === 'string' && /date_trunc/i.test(sql),
        );
        expect(bucketCall[0]).toMatch(/AVG\(t\.response_time\)/i);
      });
    });

    describe('bucket mapping', () => {
      it('maps raw DB rows to { time, value } buckets', async () => {
        // Arrange
        mockAggTimeseries({
          bucketRows: [
            { time: '2024-01-01T10:00:00Z', value: '100.5' },
            { time: '2024-01-01T10:01:00Z', value: '200.0' },
          ],
        });

        // Act
        const result = await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'transaction_response_time',
          'avg',
          false,
          IS_ADMIN,
          [],
        );

        // Assert
        expect(result.buckets).toHaveLength(2);
        expect(result.buckets[0]).toEqual({ time: '2024-01-01T10:00:00.000Z', value: 100.5 });
        expect(result.buckets[1]).toEqual({ time: '2024-01-01T10:01:00.000Z', value: 200.0 });
      });

      it('maps null DB value to 0', async () => {
        // Arrange
        mockAggTimeseries({
          bucketRows: [{ time: '2024-01-01T10:00:00Z', value: null }],
        });

        // Act
        const result = await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'transaction_response_time',
          'avg',
          false,
          IS_ADMIN,
          [],
        );

        // Assert
        expect(result.buckets[0].value).toBe(0);
      });

      it('always returns bucketSizeSeconds of 60', async () => {
        // Arrange
        mockAggTimeseries({ bucketRows: [] });

        // Act
        const result = await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'transaction_response_time',
          'avg',
          false,
          IS_ADMIN,
          [],
        );

        // Assert
        expect(result.bucketSizeSeconds).toBe(60);
      });
    });

    describe('analysis window', () => {
      it('issues getAnalysisBounds query when applyAnalysisWindow is true', async () => {
        // Arrange
        mockAggTimeseries({ applyAnalysisWindow: true, bucketRows: [] });

        // Act
        await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'transaction_response_time',
          'avg',
          true, // applyAnalysisWindow
          IS_ADMIN,
          [],
        );

        // Assert: a query touching ramp_up appeared
        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        const boundsCall = calls.find(([sql]: [unknown]) =>
          typeof sql === 'string' && /ramp_up/i.test(sql),
        );
        expect(boundsCall).toBeDefined();
      });

      it('does NOT issue getAnalysisBounds query when applyAnalysisWindow is false', async () => {
        // Arrange
        mockAggTimeseries({ applyAnalysisWindow: false, bucketRows: [] });

        // Act
        await service.getAggregatedMetricTimeseries(
          TEST_RUN_ID,
          'transaction_response_time',
          'avg',
          false, // applyAnalysisWindow
          IS_ADMIN,
          [],
        );

        // Assert: no query touching ramp_up
        const calls = (testRunRepo.query as jest.Mock).mock.calls;
        const boundsCall = calls.find(([sql]: [unknown]) =>
          typeof sql === 'string' && /ramp_up/i.test(sql),
        );
        expect(boundsCall).toBeUndefined();
      });
    });

    describe('error handling', () => {
      it('wraps DB errors in DatabaseException', async () => {
        // Arrange: plain test_run_id → no UUID lookup; applyAnalysisWindow=false → no
        // getAnalysisBounds query. The first (and only) DB call is the bucket query, which throws.
        (testRunRepo.query as jest.Mock)
          .mockRejectedValueOnce(new Error('connection timeout'));
        let caughtError: unknown;
        try {
          await service.getAggregatedMetricTimeseries(
            TEST_RUN_ID,
            'transaction_response_time',
            'avg',
            false,
            IS_ADMIN,
            [],
          );
        } catch (e) {
          caughtError = e;
        }

        expect(caughtError).toBeInstanceOf(DatabaseException);
        const msg =
          caughtError &&
          typeof caughtError === 'object' &&
          'message' in caughtError
            ? (caughtError as DatabaseException).message
            : '';
        expect(msg).toMatch(/aggregated metric timeseries/i);
      });
    });
  });

  describe('getAggregatedMetricStatistics', () => {
    it('returns one value per requested run and null for runs with no rows', async () => {
      // Mock the raw query to return rows for run-a only.
      (testRunRepo.query as jest.Mock).mockResolvedValueOnce([
        { test_run_id: 'run-a', value: '1823.40' },
      ]);

      const result = await service.getAggregatedMetricStatistics(
        ['run-a', 'run-b'],
        'request_response_time',
        'p90',
        true,
        [],
      );

      expect(result).toEqual([
        { testRunId: 'run-a', value: 1823.4 },
        { testRunId: 'run-b', value: null },
      ]);
      // p90 stat expression and requests_raw table used.
      const sql = (testRunRepo.query as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('approx_percentile(0.90');
      expect(sql).toContain('requests_raw');
      expect(sql).toContain('GROUP BY');
    });

    it('adds the org clause and org param for non-admin callers', async () => {
      (testRunRepo.query as jest.Mock).mockResolvedValueOnce([]);
      await service.getAggregatedMetricStatistics(['run-a'], 'error_percentage', 'avg', false, ['org-1']);
      const [sql, params] = (testRunRepo.query as jest.Mock).mock.calls[0];
      expect(sql).toContain('sut.organization_id = ANY');
      expect(params).toEqual([['run-a'], ['org-1']]);
      // error_percentage uses the success-count expression, not a stat expr.
      expect(sql).toContain('FILTER (WHERE NOT r.success)');
    });

    it('short-circuits to all-null for non-admin with no orgs', async () => {
      const result = await service.getAggregatedMetricStatistics(['run-a'], 'request_response_time', 'avg', false, []);
      expect(result).toEqual([{ testRunId: 'run-a', value: null }]);
      expect(testRunRepo.query).not.toHaveBeenCalled();
    });
  });

  describe('getUrlMetricStatistics', () => {
    it('merges tdigests grouped by url_hash and maps response_time rows', async () => {
      // Arrange: single query, no UUID/ramp-up/rollup preludes for this method.
      (testRunRepo.query as jest.Mock).mockResolvedValueOnce([
        {
          test_run_id: 'run-1', normalized_url: '/api/user/{id}',
          avg_response_time: '120.5', p50: '100', p90: '200', p95: '260', p99: '400',
          total_count: '3000', error_percentage: '1.50', throughput: '50.00',
          avg_latency: '30.2', avg_connect_time: '5.1',
        },
      ]);

      const rows = await service.getUrlMetricStatistics(['run-1'], 'response_time', true, []);

      // SQL correctness
      const sql = (testRunRepo.query as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toMatch(/FROM\s+test_run_sampler_stats/i);
      expect(sql).toMatch(/rollup\(\s*s\.pct_agg\s*\)/i);
      expect(sql).toMatch(/GROUP BY[^;]*url_hash/i);
      expect(sql).toMatch(/ramp_up_excluded\s*=\s*true/);
      // Mapping correctness
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        test_run_id: 'run-1',
        metric_name: '/api/user/{id}',
        statistics: { avg: 120.5, q50: 100, q90: 200, q95: 260, q99: 400 },
      });
    });

    it('maps a scalar metric (throughput) into statistics.avg only', async () => {
      (testRunRepo.query as jest.Mock).mockResolvedValueOnce([
        {
          test_run_id: 'run-1', normalized_url: '/orders/{id}',
          avg_response_time: '90', p50: '80', p90: '150', p95: '180', p99: '250',
          total_count: '1200', error_percentage: '0.00', throughput: '20.00',
          avg_latency: '10', avg_connect_time: '2',
        },
      ]);

      const rows = await service.getUrlMetricStatistics(['run-1'], 'throughput', true, []);
      expect(rows[0].statistics).toEqual({ avg: 20, count: 1200 });
    });

    it('returns [] for a non-admin with no organizations', async () => {
      const rows = await service.getUrlMetricStatistics(['run-1'], 'response_time', false, []);
      expect(rows).toEqual([]);
      expect(testRunRepo.query).not.toHaveBeenCalled();
    });
  });

  describe('getUrlDistinctNames', () => {
    it('returns the mapped list of normalized URLs from the query rows (admin path)', async () => {
      (testRunRepo.query as jest.Mock).mockResolvedValueOnce([
        { normalized_url: '/api/user/{id}' },
        { normalized_url: '/orders/{id}' },
      ]);

      const urls = await service.getUrlDistinctNames('run-1', true, []);

      const sql = (testRunRepo.query as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toMatch(/FROM\s+test_run_sampler_stats/i);
      expect(sql).toMatch(/ramp_up_excluded\s*=\s*true/);
      expect(urls).toEqual(['/api/user/{id}', '/orders/{id}']);
    });

    it('returns [] for a non-admin with no organizations', async () => {
      const urls = await service.getUrlDistinctNames('run-1', false, []);
      expect(urls).toEqual([]);
      expect(testRunRepo.query).not.toHaveBeenCalled();
    });
  });

  describe('getSamplerUrlMap', () => {
    it('reduces query rows into a metric_name -> normalized_url map (admin path)', async () => {
      (testRunRepo.query as jest.Mock).mockResolvedValueOnce([
        { metric_name: 'T04_Payment.checkout', normalized_url: '/api/checkout/{id}' },
        { metric_name: 'T01_Home.home', normalized_url: '/home' },
        { metric_name: 'T02_NoUrl.thing', normalized_url: null },
      ]);

      const map = await service.getSamplerUrlMap('run-1', true, []);

      const sql = (testRunRepo.query as jest.Mock).mock.calls[0][0] as string;
      // Key must be transaction_name.sampler_name to match ds_metric_statistics (panel 201).
      expect(sql).toMatch(/s\.transaction_name \|\| '\.' \|\| s\.sampler_name/);
      expect(sql).toMatch(/JOIN\s+url_patterns/i);
      // Requests with no normalized URL are omitted (caller falls back to name).
      expect(map).toEqual({ 'T04_Payment.checkout': '/api/checkout/{id}', 'T01_Home.home': '/home' });
    });

    it('returns {} for a non-admin with no organizations', async () => {
      const map = await service.getSamplerUrlMap('run-1', false, []);
      expect(map).toEqual({});
      expect(testRunRepo.query).not.toHaveBeenCalled();
    });
  });
});

/**
 * Issue #416: `approx_percentile_rank(v, tdigest)` returns NaN when `v` equals
 * the digest's max centroid, poisoning the whole Apdex expression to NaN. The
 * `apdexScoreSql` helper wraps every rank in `LEAST(1.0, COALESCE(NULLIF(rank,
 * 'NaN'), 1.0))` so the boundary resolves to 1.0 (all samples satisfied),
 * matching the raw-count semantics of the worker's `ApdexCalculator`.
 */
describe('apdexScoreSql (issue #416 NaN guard)', () => {
  it('guards BOTH the T rank and the 4T rank', () => {
    const sql = apdexScoreSql('tc.active_threshold', 'a.pct_agg');
    // Every approx_percentile_rank call must sit inside a NULLIF(..., 'NaN')
    const totalRanks = (sql.match(/approx_percentile_rank\(/g) ?? []).length;
    const guardedRanks = (sql.match(/NULLIF\(approx_percentile_rank\(/g) ?? []).length;
    expect(totalRanks).toBe(guardedRanks);
    expect(guardedRanks).toBeGreaterThanOrEqual(2); // T term + 4T term
    // T and 4T probes both present, both clamped to 1.0
    expect(sql).toContain('(tc.active_threshold)::double precision');
    expect(sql).toContain('((tc.active_threshold) * 4)::double precision');
    expect(sql).toContain("COALESCE(NULLIF(approx_percentile_rank((tc.active_threshold)::double precision, a.pct_agg), 'NaN'), 1.0)");
    expect(sql).toContain('LEAST(1.0,');
  });

  /**
   * Mirror of the guarded SQL semantics: each rank is NULLIF('NaN')→1.0 then
   * LEAST(1.0, _). Proves the guard yields a finite Apdex equal to the raw
   * `(satisfied + 0.5·tolerating)/total` count, never NaN.
   */
  const evalGuarded = (rank: number) => (Number.isNaN(rank) ? 1.0 : Math.min(1.0, rank));
  const apdexFromRanks = (rankT: number, rank4T: number) => {
    const gT = evalGuarded(rankT);
    const g4T = evalGuarded(rank4T);
    return gT + (g4T - gT) / 2;
  };
  const rawApdex = (satisfied: number, tolerating: number, total: number) =>
    (satisfied + 0.5 * tolerating) / total;

  it('T == digest max: NaN rank(T) resolves to 1.0, matching all-satisfied counts', () => {
    // 1188 samples, all <= T (T is the max) => rank(T)=NaN, rank(4T)=1.0
    const score = apdexFromRanks(NaN, 1.0);
    expect(Number.isNaN(score)).toBe(false);
    expect(score).toBeCloseTo(1.0, 6);
    expect(score).toBeCloseTo(rawApdex(1188, 0, 1188), 6);
  });

  it('4T == digest max: NaN rank(4T) resolves to 1.0, matching zero-frustrated counts', () => {
    // 60% satisfied, rest tolerating (nothing frustrated: everything <= 4T = max)
    const score = apdexFromRanks(0.6, NaN);
    expect(Number.isNaN(score)).toBe(false);
    // raw: 600 satisfied, 400 tolerating, 0 frustrated of 1000 => 0.8
    expect(score).toBeCloseTo(rawApdex(600, 400, 1000), 6);
    expect(score).toBeCloseTo(0.8, 6);
  });

  it('normal (no boundary hit): equals the raw count Apdex', () => {
    // rank(T)=0.7, rank(4T)=0.9 => 700 satisfied, 200 tolerating, 100 frustrated
    const score = apdexFromRanks(0.7, 0.9);
    expect(score).toBeCloseTo(rawApdex(700, 200, 1000), 6);
    expect(score).toBeCloseTo(0.8, 6);
  });
});
